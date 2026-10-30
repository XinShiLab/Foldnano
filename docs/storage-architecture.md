---
covers:
  - src/lib/services/storage/**
  - src/lib/errorReporting.ts
  - src/lib/components/Editor/ErrorLogDialog.svelte
  - src/lib/components/Editor/DocumentRecoveryScreen.svelte
  - src/lib/components/Editor/context/documentRecovery.ts
  - src/lib/model/documentRepair.ts
---

# Storage Architecture

Foldnano is a local-first browser app. The live editor state is held in memory, persisted to **IndexedDB** as the working copy, and only synced to GitHub when the user explicitly commits or pulls.

This document reflects the current implementation in:

- `src/lib/components/Editor/context/EditorDocumentSession.svelte.ts`
- `src/lib/commands/history.svelte.ts`
- `src/lib/services/storage/StorageManager.ts`
- `src/lib/services/storage/indexeddb/FoldnanoIndexedDb.ts`
- `src/lib/services/storage/providers/IndexedDbStorageProvider.ts`
- `src/lib/services/storage/providers/GitHubStorageProvider.ts`
- `src/lib/services/storage/stores/GitHubMetadataStore.ts`
- `src/lib/services/storage/stores/GitHubExplorerStateStore.ts`

## Current Model

The active storage flow is:

```text
FoldnanoDocument in memory
  -> HistoryStack tracks dirty state and auto-save thresholds
  -> StorageManager persists the working copy
  -> IndexedDbStorageProvider writes to IndexedDB (Dexie.js)

GitHub sync is layered on top:
  -> GitHubStorageProvider handles file open / commit / pull / conflict
  -> GitHubMetadataStore owns repo context, file metadata, and backups in IndexedDB
  -> GitHubExplorerStateStore owns local-only file/folder entries per repo in IndexedDB
  -> explicit open / commit / pull operations call GitHub through /api/github/*
```

Two points matter:

- IndexedDB is the only runtime persistence layer. `localStorage` is not written or read at runtime.
- The origin's IndexedDB is evictable under storage pressure unless the browser grants persistent storage; `persistentStorage.ts` checks and requests it (see `autosave.md` § Persistent storage).
- GitHub is not the primary persistence backend. It is an explicit sync target layered around the local working copy.

## Core Components

### `StorageManager`

`StorageManager` is a thin facade that routes reads and writes to a single registered provider.

In the current app:

- `EditorDocumentSession` creates `new StorageManager('indexedDB')`
- only `IndexedDbStorageProvider` is registered
- document and context reads and writes flow through that manager

`StorageManager` has no fallback layer. All operations go to the primary provider; errors are logged and the operation returns a failure result.

### `IndexedDbStorageProvider`

The runtime document/context store. It delegates to the shared `FoldnanoIndexedDb` Dexie instance:

- document snapshot at `documentSnapshots` (keyed by `docId`)
- serialized editor context at `documentContexts` (keyed by `docId`)
- document listing metadata at `documents`

Documents are stored as **plain objects** (not JSON strings). Stringification happens only at GitHub and export boundaries.

### `FoldnanoIndexedDb`

The Dexie database wrapper. Schema (versioned incrementally — `FOLDNANO_INDEXED_DB_VERSION` in
`src/lib/services/storage/indexedDbTypes.ts` is currently `8`):

```ts
db.version(1).stores({
	documents: 'id, name, documentUpdatedAt, lastLocalPersistAt, githubPath, repoKey',
	documentSnapshots: 'docId, lastLocalPersistAt',
	documentContexts: 'docId, updatedAt',
	githubRepoContexts: 'repoKey',
	githubFiles: 'docId, repoKey, lastSyncAt',
	githubBackups: 'id, docId, repoKey, createdAt',
	localOnlyEntries: '[repoKey+path], repoKey, docId',
	localFolderEntries: '[repoKey+path], repoKey',
	migrations: 'key',
});

db.version(2).stores({ plugins: 'id' });
db.version(3).stores({ pluginFiles: 'id' });
db.version(4).stores({ errorLogs: 'id, timestamp' });
db.version(5).stores({ localBackups: 'id, [docId+createdAt]' });
db.version(6).stores({}).upgrade(/* githubBackups rows -> localBackups, see Backups */);
db.version(7).stores({ githubBackups: null });
db.version(FOLDNANO_INDEXED_DB_VERSION /* 8 */).stores({
	fileHandles: 'id, purpose',
	settings: 'key',
});
```

`documents` is a lightweight index/listing record. `documentSnapshots` holds the full plain snapshot object. Saving a document atomically writes both in a single Dexie transaction.

### `GitHubMetadataStore`

A singleton in-memory cache backed by IndexedDB. It stores:

- `githubRepoContexts` — the connected repo (`owner`, `repo`, `branch`)
- `githubFiles` — per-document file metadata (`path`, `sha`, `branch`, `lastSyncAt`)

It holds no backups; those live in the shared `localBackups` timeline (see Backups).

`hydrate()` loads both tables from IndexedDB into memory at startup. Subsequent reads are synchronous (in-memory map lookups). Writes update memory immediately. `setFileMetadata()`, `stampSyncTime()` and `stampCommitSha()` return a promise that settles when IndexedDB has the write (rejecting with a "Couldn't save the GitHub sync state" error): commit, pull, open-from-GitHub and discard flows **await** it, because a lost SHA or `lastSyncAt` means the next commit runs against stale state. Other callers may ignore the promise; failures are logged either way and never become unhandled rejections. Repo-context writes stay fire-and-forget.

**Important:** `hydrate()` must be awaited before any component reads GitHub metadata. Write methods do not set the internal `hydrated` flag — that flag is only set when `hydrate()` completes — so calling a write method before `hydrate()` does not prevent hydration from loading the full stored state.

### `GitHubExplorerStateStore`

A singleton in-memory cache backed by IndexedDB for local-only GitHub explorer state. It stores:

- `localOnlyEntries` — files created in a connected repo but not yet committed, keyed by `[repoKey+path]`
- `localFolderEntries` — virtual folders shown in the explorer, keyed by `[repoKey+path]`

These entries persist across page reloads and are scoped per `owner/repo`.

### `HistoryStack`

`HistoryStack` owns undo/redo and auto-save bookkeeping.

It tracks:

- `editsSinceLastSave`
- `lastSavedTime`
- `hasUnsavedChanges`

Auto-save defaults:

- save after 10 edits
- save after 60 seconds if there are unsaved edits

`HistoryStack` saves the document snapshot only (via `StorageManager.saveDocument`). `EditorDocumentSession.saveDocumentToLocalStorage()` saves both the snapshot and the serialized view context.

### `EditorDocumentSession`

`EditorDocumentSession` (`src/lib/components/Editor/context/EditorDocumentSession.svelte.ts`) coordinates
in-memory document state, local persistence, and GitHub sync state. `EditorViewContext` (which owns
`editorMode`, selection sets, and other view-layer state — see `docs/multi-tab-protection.md` and CLAUDE.md's
"Editor Session Split") holds a reference to the session and proxies a few fields like `isTabOwner`, but does
not own storage itself.

Relevant responsibilities:

- owns the current `FoldnanoDocument`
- wires `HistoryStack` to `StorageManager`
- persists the current snapshot through `persistCurrentDocumentSnapshot()`
- saves and restores serialized strand-view context
- tracks GitHub-specific state such as:
  - `currentRepoContext`
  - `currentFileMetadata`
  - `lastLocalPersistAt`
  - `lastGitHubSyncAt`
  - `remoteAheadOfLocal`

## IndexedDB Tables In Use

### Core document persistence

| Table               | Key     | Contents                                                                      |
| ------------------- | ------- | ----------------------------------------------------------------------------- |
| `documents`         | `id`    | Listing metadata: name, timestamps, githubPath                                |
| `documentSnapshots` | `docId` | Full plain snapshot object (from `toJSON()`)                                  |
| `documentContexts`  | `docId` | Serialized editor/view context object                                         |
| `localBackups`      | `id`    | Backup timeline: earlier snapshots with a reason, indexed `[docId+createdAt]` |

### GitHub integration metadata

| Table                | Key       | Contents                              |
| -------------------- | --------- | ------------------------------------- |
| `githubRepoContexts` | `repoKey` | Connected repo owner/repo/branch      |
| `githubFiles`        | `docId`   | Per-doc path, sha, branch, lastSyncAt |

### GitHub explorer local-only state

| Table                | Key              | Contents                                    |
| -------------------- | ---------------- | ------------------------------------------- |
| `localOnlyEntries`   | `[repoKey+path]` | Files created locally but not yet committed |
| `localFolderEntries` | `[repoKey+path]` | Virtual folder entries in the explorer      |

### Plugin state and file cache

| Table         | Key  | Contents                                                                                                                                                                                                                                                                                                                   |
| ------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins`     | `id` | Plugin manifest + side-panel editor code + builtin enable/disable toggle + for plugins made from Script Lab, `authoring` (ownership) and `draftCode` (unsaved edit) + `iconSvg` (validated bundled icon, unindexed) + for dev-mode linked plugins, `linked` (folder handle id and name; the manifest is the last one read) |
| `pluginFiles` | `id` | Cached plugin file assets: entrypoint `.py` text or `.zip` bytes + pre-fetched `.whl` wheel bytes, keyed by plugin ID. Invalidated when `manifest.version` changes. Also used as the sole file source for locally installed plugins (zip drop).                                                                            |

### File handles and settings

| Table         | Key   | Contents                                                                                                                                                                                                           |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fileHandles` | `id`  | File System Access handles the user granted (`purpose`: `plugin-dev` or `design`), never the files themselves. Permission is per tab and session, so a stored handle may need a prompt. See `docs/file-access.md`. |
| `settings`    | `key` | Small app-level preferences (`{ key, value }`), e.g. plugin dev mode.                                                                                                                                              |

### Diagnostics

| Table       | Key  | Contents                                                                                                                                                                                                                                                                                                              |
| ----------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errorLogs` | `id` | Capped ring buffer (last 50) of `reportError()` entries — metadata only (timestamp, context, message, stack, severity, appVersion, commitHash). Never contains design/document data; see `src/lib/errorReporting.ts`. Browsable via the toolbar's error-log icon (`src/lib/components/Editor/ErrorLogDialog.svelte`). |

## Startup Sequence

1. `onMount` in `Editor.svelte` awaits `githubMetadataStore.hydrate()` and `githubExplorerStateStore.hydrate()` in parallel.
2. After hydration, `session.refreshGitHubStateFromStore()` (on `EditorDocumentSession`) is called to populate reactive GitHub state.
3. A `storesHydrated` flag is set, which triggers the `$effect` that loads the active document.
4. Document load reads GitHub metadata from the now-hydrated in-memory stores, so the status bar (repo/branch/path) is populated on first render.

The `/toc` page follows the same pattern: hydrate stores, then load documents.

## How Local Persistence Works

### Normal editing

1. The user edits the in-memory `FoldnanoDocument`.
2. Most mutations are wrapped in `historyStack.tx(...)`.
3. `HistoryStack` increments the unsaved-edit counter.
4. When the edit-count or timer threshold is reached, the current **plain snapshot object** is persisted to IndexedDB.
5. `EditorDocumentSession` can also trigger explicit persistence before file switches or Git operations.

Documents are stored as plain objects, not JSON strings. Serialization to JSON only happens at GitHub commit, export, and diff boundaries.

### Loading a local document

When a document is loaded from IndexedDB, `EditorDocumentSession`:

1. restores the document snapshot into a new `FoldnanoDocument`
2. rebuilds `HistoryStack`
3. restores saved view/context data
4. reads GitHub metadata from the hydrated in-memory `GitHubMetadataStore`
5. restores the last local persist timestamp from the `documents` table
6. triggers a non-blocking GitHub conflict check if file metadata exists

If the snapshot exists but `FoldnanoDocument.fromJSON()` throws (damaged data, or a
`DocumentFormatError` for a file from a newer app), nothing is adopted or written. The session
sets `loadFailure` (`DocumentLoadFailure` in `context/documentRecovery.ts`: doc id, name, friendly
message, reason `too-new | malformed | error`) and returns `false`. `Editor.svelte` then renders
`DocumentRecoveryScreen.svelte` over the editor instead of the "Document not found" prompt, which
is kept for a missing snapshot. The screen offers:

- **Download saved data**: the raw stored object (`loadRawDocument()`), exactly as saved
- **Restore** for each backup from `listBackups()` (the document's timeline, newest first). Each
  is test-loaded first; unreadable ones are shown but can't be restored. `restoreBackup()` saves
  with a `before_restore` backup, so the unreadable snapshot is kept instead of being lost, then
  reloads. It returns a `RestoreBackupResult`
  (`restored | not-allowed | save-failed | still-unreadable`); the screen shows a toast for each
  failure
- **Reload page** for `too-new`, and **Open another design** (`/toc`)

`loadFailure` is cleared at the start of every local load.

### Repair on load

`repairDocumentJson()` (`src/lib/model/documentRepair.ts`) runs on the migrated JSON wherever a
document enters the editor: local load, file import (`foldnanojsonParser`), open from GitHub and
pull. It restores the oligo ↔ strandSet invariants that an earlier undo bug could break, and
returns the fixed snapshot plus one line per kind of fix:

- strandSet ids no oligo owns are dropped (they kept "empty" VHs from being deleted)
- owned segments missing from their VH, or listed in the wrong strand, are re-listed
- segments on a VH that no longer exists are dropped, and so are second claims on one segment id
- crossover links that aren't reciprocal within one oligo are cleared, then any oligo that is no
  longer one connected piece is split (the first piece keeps the id; split-off pieces lose
  repeat-group membership)
- a lattice region with a helix at a negative row/col is shifted up/right by an even number of
  rows/cols (cell parity kept) and its plane moved back by the same lattice distance, so the
  design stays put in 3D; a plane another region shares is copied first
- a mirrored (left-handed) plane, `(u × v)·normal < 0`, gets `v` negated so it is right-handed.
  The Side (YZ) base plane was created mirrored until it was fixed, which reversed helix twist in
  3D and export relative to the 2D layout (crossovers 1.3-2.5 nm apart). Plane-local data is
  untouched, so the 2D view is the same; in 3D the plane's regions flip along V

A consistent document passes through as the same object. When something was fixed,
`notifyDocumentRepairs()` shows a warning toast, and `EditorDocumentSession.#persistRepair()` writes
the repaired copy back (owner tab only). A local load saves with a `before_repair` backup so the
unrepaired copy stays restorable. Open and pull write the GitHub version first, as usual, then the
repair as a newer local save, so the repair shows up as a local change to commit.

After repair, `EditorDocumentSession.#adoptDocument()` (every way a document becomes current:
load, import, open, pull, URL, new) runs the integrity check (`checkDocumentIntegrity`, see
`design-guards.md`) and `notifyDesignIssues()` lists what it found. That check only reports; it
never changes or refuses a design the user already has.

Snapshots handed back to IndexedDB must be plain objects: a Svelte `$state` proxy fails the write
with `DataCloneError`. The recovery screen and Backups dialog keep their lists in `$state.raw`,
and `restoreBackup()` also unwraps with `$state.snapshot()`.

## How GitHub Sync Layers On Top

The GitHub integration is local-first and explicit.

### Open from GitHub

`loadDocumentFromGitHub(owner, repo, path, branch)`:

1. fetches file content through the GitHub API proxy
2. parses the JSON and validates/upgrades it with `migrateDocumentJson()` (see `dna-model.md` § Document format version); a file from a newer app is refused before anything is written locally
3. detects local doc ID collisions and can fork to a new local ID
4. writes the fetched snapshot into IndexedDB; a branch reload passes a `before_branch_reload` backup option (labelled with the old branch) so the replaced copy is kept
5. stores GitHub file metadata (path, SHA, branch, `lastSyncAt`) via `GitHubMetadataStore`, awaited
6. loads the document into the editor

### Commit to GitHub

`commitCurrentDocToGitHub(message)`:

1. persists the current in-memory snapshot locally first
2. derives the commit content via `JSON.stringify(snapshot, null, 2)`
3. sends that content to GitHub via `PUT /api/github/contents`
4. stores the new file SHA (awaited inside `GitHubStorageProvider.commitDocument()`)
5. stamps `lastSyncAt` and the commit SHA (awaited) and clears the remote-ahead flag

### Pull / overwrite from GitHub

`pullCurrentDocFromGitHub()`:

1. persists the current local snapshot first, so unsaved edits are in the copy about to be replaced
2. fetches the latest remote file (`GitHubStorageProvider.pullDocument(docId, reason)`)
3. parses the JSON and validates/upgrades it with `migrateDocumentJson()`; a file from a newer app throws `DocumentFormatError` here, leaving the working copy untouched
4. overwrites the local working copy with a `backup` option (`before_pull` or `before_accept_remote`), so the replaced copy is kept as a backup **in the same transaction**: there is no window where the overwrite happened but the backup didn't
5. stores the SHA and sync timestamps, awaited; if that fails the pull reports an error
6. reloads the editor from the pulled snapshot

Explorer **Discard** on a modified file runs the same overwrite with reason `before_discard`: for the open file through `pullCurrentDocFromGitHub('before_discard')` (via `GitHubExplorerState.doPull(reason)`), for any other file through `pullDocument(docId, 'before_discard')` (it used to delete that local copy).

### Dirty detection

GitHub dirty state is derived from two signals:

- in-memory unsaved edits tracked by `HistoryStack`
- durable local changes where the `documents.lastModified` timestamp exceeds `githubFiles.lastSyncAt`

`GitHubMetadataStore.getUncommittedPaths()` extends that logic across all documents in a repo by querying `documents` from IndexedDB and comparing against the in-memory `githubFiles` cache.

That drives the GitHub explorer Changes tab and branch-switch blocking.

For the comparison to be exact, both stamps come from the same clock, the stored save time:

- `FoldnanoIndexedDb.saveDocument()` makes `lastModified` strictly increasing per document, so two
  saves in one millisecond never share a stamp. `getLastModified()` reads it back
  (`StorageManager.getLastModified()`).
- A commit stamps `lastSyncAt` with the **stored save time of the snapshot it uploaded**
  (`persistCurrentDocumentSnapshot()` returns it as `persistedAt`), not "now". An autosave during
  the upload gets a later stamp, so the design stays "unsaved to GitHub". Pull and open-from-GitHub
  stamp the save time of the snapshot they wrote.
- `EditorDocumentSession.lastLocalPersistAt` follows every save, autosaves included (HistoryStack
  `onSaved` → `#afterSave()`), so the in-memory `hasUncommittedGitHubChanges` agrees with the
  Changes tab.

### Backups

Every document has one backup timeline in `localBackups` (`LocalBackup`: `reason`, optional
`github` source for display, `createdAt`, `snapshot`), capped at `MAX_LOCAL_BACKUPS_PER_DOC` (5)
across all reasons. Backups are written only by `FoldnanoIndexedDb.saveDocument()`, inside the same
transaction as the write that replaces the copy:

- **periodic**: on any save, when the newest backup is at least `LOCAL_BACKUP_INTERVAL_MS`
  (10 min) old
- **overwrite reasons** (`SaveDocumentOptions.backup`): always, when a write replaces the user's
  copy: `before_pull`, `before_accept_remote`, `before_branch_reload`, `before_conflict_resolve`
  (diff dialog _Apply resolved JSON_, `applyResolvedConflict()`), `before_discard`,
  `before_restore`, `before_repair` (load-time repair, see § Repair on load). Because the newest backup's time restarts the 10-minute clock, an overwrite
  also delays the next periodic backup

`createdAt` is when the backup was taken (the moment that version was replaced) and is strictly
increasing per document, so two backups in one millisecond keep their order. Reads go through
`StorageManager.getLocalBackups()` (an optional `StorageProvider` method; providers without it
return none) and `EditorDocumentSession.listBackups()`, which labels each entry
(`toBackupEntries()`, `BACKUP_REASON_LABELS` in `context/documentRecovery.ts`). The same listing
feeds `BackupsDialog.svelte` (Save menu → _Backups…_, and the status-bar **Backups** button for
GitHub files) and the recovery screen; both offer **Download .fn.json** (`backupFileName()`) and
**Restore** per backup (download works for unreadable backups too). Deleting a document deletes
its backups.

User-facing text must not present backups as permanent: only the last 5 are kept, so every
message that says a version is kept as a backup (discard dialog, restore confirmations, toasts,
guide) also says so and points to downloading.

Schema version 6 moved the old `githubBackups` rows into this timeline (reason mapped,
`before_conflict_resolve_overwrite` → `before_conflict_resolve`, GitHub source kept) and trimmed
each document to 5; version 7 dropped the table. `GitHubMetadataStore` no longer handles backups.

## Document Deletion

When a document is deleted from `/toc`:

- `StorageManager.deleteDocument(docId)` removes the `documents`, `documentSnapshots`, `documentContexts` and `localBackups` records.
- `GitHubMetadataStore.clearFileMetadata(docId)` is always called to remove any GitHub metadata.
- `GitHubExplorerStateStore.removeLocalOnlyEntryByDocId(docId)` is always called to remove any local-only explorer entries.

Both cleanup paths run on every delete (not conditioned on whether the doc was GitHub-backed) to handle documents that transitioned from local-only to GitHub-backed without fully cleaning up.

If the deleted document is the currently open document, the editor resets to a fresh blank document.

## Current Design Notes

- Document snapshots are plain objects in IndexedDB; no JSON strings in the working-copy path.
- `StorageManager` has no fallback layer — it routes to one provider and surfaces errors.
- `GitHubExplorerStateStore` and repo-context writes are fire-and-forget; `GitHubMetadataStore` file-metadata writes are awaitable and awaited in sync flows (see `GitHubMetadataStore`). In-memory state is always up to date.
- Explicit `New Document` actions call `createNewStandaloneDocument()`, which always saves the new document. Passive blank editor sessions (no edits, no explicit create) do not create TOC entries.
- Multi-tab editing is coordinated by `TabSync` (BroadcastChannel-based, see `docs/multi-tab-protection.md`); only the owning tab is allowed to write.

## Boundaries / Don'ts

- **Don't read or write `localStorage` for documents, snapshots, or sync metadata.** Everything goes through `StorageManager` → `IndexedDbStorageProvider` → Dexie.
- **Don't await `hydrate()` lazily inside an `$effect`.** Editor and `/toc` entry points await it before document load so the in-memory GitHub stores are populated on first render.
- **Don't write directly to `FoldnanoIndexedDb` from UI code.** Go through `StorageManager`, `GitHubMetadataStore`, or `GitHubExplorerStateStore`. Direct writes bypass the in-memory cache.
- **Don't save without owner check.** `EditorDocumentSession.saveDocumentToLocalStorage` and `commitCurrentDocToGitHub` gate on `isTabOwner` (`persistCurrentDocumentSnapshot` itself does not — callers must check) — bypassing this can race with another tab.
- **Don't set `markSaved()` before the IndexedDB write resolves.** Auto-save state is the user's source of truth for "is my work safe".
- **Don't overwrite a user's copy without a `backup` option.** Any write that replaces the stored snapshot with something the user didn't just author (remote content, a backup, a resolved conflict) passes `SaveDocumentOptions.backup` with a reason, so the replaced copy is kept in the same transaction. Don't reintroduce a separate "create backup, then overwrite" step.
- **Don't await-skip GitHub SHA / `lastSyncAt` writes in sync flows.** Await `setFileMetadata` / `stampSyncTime` / `stampCommitSha` in commit, pull, open and discard paths.
- **Validate remote JSON before persisting it.** Any path that writes fetched JSON into the working copy must run `migrateDocumentJson()` first, or a file from a newer app can replace the user's local copy before `fromJSON` refuses it.
- **Don't call `repairDocumentJson()` inside `FoldnanoDocument.fromJSON()`.** `doc.restore`, undo snapshots and `verifyHistoryEntry` all load through `fromJSON`; repairing there would hide the next history bug instead of failing its round-trip check. Repair only at the entry points listed in § Repair on load.
- **Document snapshots are plain objects.** Don't pre-stringify them on the working-copy path. Stringification is reserved for GitHub commits and exports.
- **Don't add a new IndexedDB table without bumping the Dexie version.** Schema changes require a `db.version(N).stores({...})` step plus, if needed, a migration entry in the `migrations` table.

## Relationship To Other Docs

- `docs/github-integration.md` covers the GitHub UI and sync flows in more detail.
- `docs/autosave.md` focuses on auto-save thresholds and triggers.
- `docs/multi-tab-protection.md` describes the TabSync ownership protocol.
