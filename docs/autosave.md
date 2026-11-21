---
covers:
  - src/lib/commands/history.svelte.ts
  - src/lib/components/Editor/context/EditorDocumentSession.svelte.ts
  - src/lib/components/Editor/SaveStatusIndicator.svelte
  - src/lib/components/Editor/SaveFailedBanner.svelte
  - src/lib/components/Editor/SaveFromUrlDialog.svelte
  - src/lib/components/Editor/NameDesignDialog.svelte
---

# Autosave And Local Persistence

This document covers how Foldnano persists the current document locally while the user is editing. It stays separate from `docs/storage-architecture.md` because that document describes the full storage model, while this one focuses on the save lifecycle and dirty-state rules.

## Current Behavior

Autosave is enabled by default through `HistoryStack` in `src/lib/commands/history.svelte.ts`.

By default, the current document snapshot is persisted to IndexedDB when any condition is met:

- **idle**: the user has paused for 2 s after an edit (see § Idle save); this does most saves
- **timer**: 60 seconds have passed and there are unsaved edits (cap for continuous editing)
- **edit-count**: 50 undoable edits since the last save (safety net if input keeps deferring idle)

The active document is also explicitly persisted before operations that could otherwise lose in-memory changes, such as:

- switching files
- opening a file from GitHub
- committing to GitHub
- pulling from GitHub
- creating a new document

## What Is Actually Saved

There are two separate save paths:

### Document snapshot

`HistoryStack` persists the current `FoldnanoDocument` snapshot through `StorageManager.saveDocument(...)`.

That writes a **plain object** (from `FoldnanoDocument.snapshot()`, a JSON round-trip of `toJSON()`) to the `documentSnapshots` and `documents` tables in IndexedDB. In the same transaction, the snapshot being replaced may be kept as a rotating backup generation in `localBackups` (see `storage-architecture.md` § Local backup generations); a document that later fails to load gets the recovery screen, which restores from those. The round-trip guarantees a detached copy in every build (see `commands-and-history.md`); what is stored is the object, not a JSON string, which only appears at GitHub and export boundaries.

### Editor context

`EditorDocumentSession.saveDocumentToLocalStorage()` also saves the serializable strand-view context:

- `colorContext`
- `sequenceContext`
- `modificationContext`
- `hideContext`
- `highlightContext`
- `selectionToggles`
- `csCursorIdx`

That writes to the `documentContexts` table in IndexedDB.

Context objects may contain Svelte `$state` proxy values, so they are normalized through `JSON.parse(JSON.stringify(...))` before writing. Document snapshots do not need this because `toJSON()` already produces a plain object.

So autosave of the document snapshot and persistence of the editor context are related, but not identical.

## Dirty State

`HistoryStack` tracks local dirty state with:

- `editsSinceLastSave`
- `lastSavedTime`
- `hasUnsavedChanges`

`EditorDocumentSession` exposes that through:

- `isSaved`
- `lastSavedTime`
- `editsSinceLastSave`
- `hasUnsavedLocalChanges`

For GitHub-backed files, there is an additional distinction:

- unsaved local changes: edits still only in memory
- uncommitted GitHub changes: either unsaved in-memory edits or a locally persisted snapshot that is newer than the last GitHub sync

That second state is exposed via `hasUncommittedGitHubChanges`.

## Save Lifecycle

### Normal edit flow

1. A command runs inside `historyStack.tx(...)`.
2. `HistoryStack` records granular before/after patches for the affected model state.
3. If the command changed recorded state, the undo stack is updated and the edit counter increments.
4. If the edit threshold is reached, autosave persists the plain snapshot object to IndexedDB.
   Only one write runs at a time: an edit or timer tick that arrives while a write is pending
   starts no second one, it re-checks the threshold when the write finishes. Edits made during
   the write are not in it, so they stay counted as unsaved. `saveNow()` / `saveNowIfDirty()`
   wait for the pending write and then write again, so they always hold the state at call time.
5. Every edit, undo and redo also arms the idle save (below).
6. A timer also checks periodically and saves if the document is dirty.

### Idle save

Each save is a full synchronous snapshot on the main thread, so the edit-count trigger, which
fires mid-burst by definition, is the one that hitches on a large design. The idle save moves
that cost to a pause. "Idle" is checked in three layers:

1. **No edit** for `idleDelayMs` (2 s): `#markDirty` stamps `#lastActivityAt` and arms one timeout.
2. **No input** for the same window: edits commit only at gesture end, so `Editor.svelte` feeds
   window-level capture listeners (pointer down/move/up/cancel, wheel, keydown) into
   `EditorViewContext.noteInputActivity()`, which calls `HistoryStack.noteActivity()`. That only
   stamps the time; the timer reschedules itself for the remaining quiet window, so there is no
   timer churn per pointer move. Hover moves (no buttons) don't count.
3. **Not busy**: the injected `isBusy` predicate (session hook `isEditorBusy`) defers while a
   pointer is held, a rigid-body simulation runs or an oxDNA replay plays. Plugin runs don't
   count: they run off-thread and only touch the document on apply, which is a normal edit.

Once all pass, the save starts through `requestIdleCallback` (1 s timeout; immediate where
missing). That only picks when the snapshot starts; it cannot chunk it. The delay is
`max(idleDelayMs, 10 × last save duration)`, so a design whose save takes hundreds of ms is not
rewritten after every short pause. The idle save goes through `#performAutoSave('idle')`, so the
in-flight guard, owner-tab gate and `hasSavableName` apply unchanged; if a write was in flight,
the idle save re-arms when it finishes. While `autoSaveStatus.error` is set it stands down: the
quick retry and the timer own retrying, so a broken store isn't hit on every pause.

### Explicit local save

`EditorDocumentSession.saveDocumentToLocalStorage()`:

1. persists the current document snapshot if needed
2. saves the serialized view/context payload

This is the main "save current work now" method used around editor workflows.

### Persist-before-Git rule

Before commit and overwrite flows, `EditorDocumentSession` uses `persistCurrentDocumentSnapshot(...)` so the operation runs against a durable local snapshot instead of only in-memory state.

For overwrite flows, the write that replaces the local copy passes a `backup` save option, so the replaced version (including those just-persisted edits) is kept in the design's backup timeline in the same transaction (see `storage-architecture.md` § Backups).

## Failure Handling

If `#performAutoSave` fails (the underlying `StorageManager.saveDocument` throws, or returns
`false`), `HistoryStack` reports it through `reportError(err, 'autosave', { notify })` in
`src/lib/errorReporting.ts` instead of only logging to the console. `notify` is edge-triggered: the
first failure in a run shows a toast, repeated identical failures from the retrying timer stay
silent, and `autoSaveStatus.error` is set for the duration of the failure (cleared on the next
successful save or on `markSaved()`). `SaveStatusIndicator.svelte` reflects that as a distinct
failed-save state rather than the ambient amber "unsaved" one.

The first failure of a streak also schedules **one quick retry** after `AUTOSAVE_RETRY_DELAY_MS`
(3 s), for transient errors. After that the regular timer keeps retrying every interval while the
document is dirty. A successful save, `markSaved()` or `destroy()` cancels a pending retry.

The explicit "Save" button (`SaveStatusIndicator.svelte`'s `handleManualSave`) and the
persist-before-Git path both go through `persistCurrentDocumentSnapshot()`, not
`#performAutoSave`. On a failed write it calls `HistoryStack.markSaveFailed(message)` so
`autoSaveStatus.error` is set the same way (no retry, no report; the caller reports). The manual
button reports through `reportError()`, always notifying since it's a direct user action.

### Failed-save banner

While `autoSaveStatus.error` is set on the owner tab, `Editor.svelte` renders
`SaveFailedBanner.svelte`: a persistent red banner with **Retry** (a forced
`saveDocumentToLocalStorage()`) and **Download .json** (`downloadFoldnanoJson()` in
`Toolbar/utils.ts`, the same serialization as _Download as Foldnano JSON_). The download is the escape
hatch when IndexedDB itself is broken (quota, private browsing, eviction). It is hidden while a
URL-loaded design is still pending its first save.

### Close-tab guard and save on hide

`Editor.svelte` registers:

- `beforeunload`: when the owner tab has unsaved edits or a failed save, the browser shows its
  leave-page prompt. If the last save didn't fail, it also starts a save, which usually completes
  while the prompt is open. Autosave waits for a 2 s pause (or 60 s / 50 edits), so without this
  guard closing the tab inside that window drops the latest edits silently.
- `visibilitychange` → hidden: saves if dirty (owner tab, not a pending URL design). Switching tabs
  or minimising flushes the dirty window, so the leave-page prompt is rarely needed.

### Persistent storage

Without `navigator.storage.persist()` the browser may evict the origin's IndexedDB under storage
pressure. `EditorDocumentSession` reads the state with `checkStoragePersistence()` on start (no
prompt) and, after the first successful save, calls `requestStoragePersistence()` once per page
load (`src/lib/services/storage/persistentStorage.ts`). It asks after a save rather than on load
because Firefox can show a permission prompt, which only makes sense once the user has work to
keep. The result is `session.storagePersistence`, shown in the save indicator's storage-info
tooltip when it is `best-effort` or `persistent`.

## Timestamp Handling

Two timestamp layers are in use:

- `HistoryStack.lastSavedTime`: the last time the current in-memory document was persisted locally
- `documents.lastModified` (in IndexedDB): the durable timestamp written on every `saveDocument` call

When a document is reloaded from IndexedDB, `EditorDocumentSession` restores `HistoryStack`'s last-save time from `documents.lastModified` so dirty-state calculations start from the persisted state rather than from a fresh in-memory session.

For GitHub-backed files, `lastGitHubSyncAt` is tracked separately in `GitHubMetadataStore`.

## Special Cases

### `saveNowIfDirty()`

`HistoryStack.saveNowIfDirty()` only persists if there are actual unsaved edits.

That matters when the app saves before housekeeping operations like file switches. Without this guard, a no-op save could bump `lastModified` and make a GitHub-backed file appear modified even when content has not changed.

### `markSaved()`

After some flows, the code calls `historyStack.markSaved(...)` to reset the unsaved-edit counter without forcing another write. This prevents the auto-save timer from immediately writing again and creating incorrect dirty-state comparisons against GitHub sync timestamps.

### URL-loaded documents (pending save)

When a design is fetched from a `?url=` query parameter, `EditorDocumentSession.loadTransientDocument()` sets a `#pendingUrlSave` flag. While this flag is set, `persistCurrentDocumentSnapshot` is a no-op unless `options.force` is true. This prevents autosave from silently writing the remote file to IndexedDB before the user has explicitly opted in.

The flag is cleared and a forced save is performed by `confirmAndSaveFromUrl()`, which is called when the user clicks through the "Save to Browser" confirmation dialog. Until then, the document exists only in memory.

See `docs/routes-guide.md` § "Loading a Design from an External URL".

### Blank document guard

Blank documents with no user edits do not create IndexedDB entries. The `isPristineUnsavedBlankDocument()` check prevents housekeeping saves from persisting an untouched default blank document during file-switch flows.

`New Document` (local-only) calls `startBlankDocument()`, which saves the current document and swaps in a blank one without persisting it. The toolbar shallow-routes to `/editor`, and `Editor.svelte` replaces that URL with `/editor/<id>` once `lastLocalPersistAt` is set, so a reload reopens the saved document.

### Reserved blank name

`"Untitled Document"` (`UNTITLED_DOCUMENT_NAME`, compared ignoring case) names the blank workspace only; no snapshot is ever written under it. `EditorDocumentSession.hasSavableName` gates every write path: the `HistoryStack` persist callback (autosave, `saveNow`), `persistCurrentDocumentSnapshot` (even with `force`), and `saveDocumentToLocalStorage`. The blank workspace stays a place to drop files or plugin zips without leaving an entry behind.

Once the design has a Part and still has the reserved name (`session.needsName`), `NameDesignDialog.svelte` asks for a name. The dialog is required: it has no close button and ignores Escape and outside clicks. That covers a first region, a cadnano file loaded as a region, a plugin creating a Part, and a design stored under that name before it was reserved (that wording differs). Naming goes through `checkRename` / `renameDocument`, which saves. Until then edits stay unsaved, so the close-tab guard still warns. Designs created by name (New File dialog, typing a name in the toolbar) are saved right away, even with no Part.

## Public API Surface

`HistoryStack` exposes the auto-save knobs:

```ts
historyStack.setAutoSaveConfig({ enabled, editCountThreshold, timeIntervalMs, idleDelayMs })
historyStack.noteActivity()      // stamp user input so the idle save waits for a pause
historyStack.saveNow()           // force-save regardless of dirty
historyStack.saveNowIfDirty()    // save only if dirty (used before file switches)
historyStack.markSaved(time?)    // reset counters without writing (e.g. after a successful Git commit)
historyStack.markSaveFailed(msg) // show a failure from a non-autosave write path (no retry, no report)
historyStack.restoreLastSaveTime(time)  // hydrate from IndexedDB metadata at load
historyStack.destroy()           // tear down the timer
historyStack.autoSaveStatus      // reactive { lastSavedTime, hasUnsavedChanges, editsSinceLastSave, error? }
```

Auto-save trigger labels reported in logs: `'idle' | 'edit-count' | 'timer' | 'manual' | 'retry'`.

## Current Limits

- Autosave writes the full document snapshot each time; undo/redo is granular, but persistence is not incremental.
- Document snapshot and editor context are not saved in a single atomic transaction (two separate IndexedDB writes).
- Multi-tab editing is coordinated by `TabSync` — only the owning tab is allowed to persist. See `docs/multi-tab-protection.md`.

## Boundaries / Don'ts

- **Don't call `markSaved()` before the storage write resolves.** It clears `hasUnsavedChanges`; calling it on an aborted save loses the dirty signal.
- **Don't call `saveNow()` from within a render or a `$derived`.** Auto-save is async — call it from event handlers or effects.
- **Don't bump `documents.lastModified` for a no-op save.** Use `saveNowIfDirty()`; otherwise GitHub-dirty detection produces false positives.
- **Don't replace the snapshot path with stringification.** Working-copy saves are plain objects in IndexedDB. JSON-string round-trips happen only at GitHub and export boundaries.
- **Don't start a write past the in-flight guard.** Each save copies the whole document; on a large design, one per edit while a write is pending stalls editing. Go through `#performAutoSave`.
- **Don't reset the edit counter to zero after a write.** Subtract what the snapshot held; edits made while it was pending are still unsaved.
- **Don't make `noteActivity()` do more than stamp a time.** It runs on every pointer move; the idle timer does the rescheduling.
- **Don't drop the timer or edit-count triggers in favour of idle alone.** Continuous input (a long drag session, a running simulation) defers idle indefinitely; those two bound the unsaved window.
- **Don't autosave from a non-owner tab.** Saves must be gated on `EditorDocumentSession.isTabOwner`.
- **Don't autosave a pristine blank document.** `isPristineUnsavedBlankDocument()` is the guard — preserving it keeps the TOC clean of untouched defaults.
- **Don't add a snapshot write that skips `hasSavableName`.** A design saved as `"Untitled Document"` is what the name prompt exists to prevent.
- **Don't add a write path that can fail without `markSaveFailed()`.** The banner, close-tab guard and status dot all key off `autoSaveStatus.error`.
- **Don't request persistent storage on page load.** Firefox can prompt; ask after the first successful save (`#requestPersistenceAfterSave`).
- **Don't swallow a save failure with only `console.error`.** Route it through `reportError()` (see `src/lib/errorReporting.ts`) so it lands in the local diagnostic log and (on first occurrence) surfaces to the user — a failed save must never be silent.

## Relationship To Other Docs

- `docs/storage-architecture.md` covers the broader storage model and IndexedDB schema.
- `docs/github-integration.md` covers commit, pull, conflict, and explorer behavior.
- `docs/multi-tab-protection.md` covers how TabSync gates writes when the same doc is open in multiple tabs.
