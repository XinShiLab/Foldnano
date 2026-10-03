---
covers:
  - src/lib/services/github/**
  - src/routes/api/**
  - src/lib/components/Editor/GitGraph/**
  - src/lib/components/Editor/GitHubCommit/**
  - src/lib/components/Editor/GitHubDiff/**
  - src/lib/components/Editor/GitHubExplorer/**
  - src/lib/components/Editor/GitHubSetup/**
  - src/lib/services/storage/githubTypes.ts
  - src/lib/services/storage/providers/GitHubStorageProvider.ts
---

# GitHub Integration

Foldnano integrates directly with GitHub to let users browse, open, edit, and commit cadnano design files from any GitHub repository. Editing stays local first, with a durable browser-side working copy and explicit commits back to GitHub.

## Architecture

```
GitHub Repo  ←── explicit commit / pull ──→  IndexedDB (working copy + per-doc backups)
                                                   ↕ persist-first save
                                             EditorDocumentSession / HistoryStack (in-memory)
```

The runtime working copy lives in IndexedDB (Dexie) — see `storage-architecture.md`. GitHub is a layered, **explicit** sync target: nothing leaves the browser unless the user invokes commit/pull.

- **Opening** a file from GitHub: fetch via API → write snapshot into IndexedDB → load into editor
- **Editing**: the in-memory document is the live source of truth; local persistence and GitHub sync are tracked separately
- **Committing**: persist the current in-memory snapshot to IndexedDB first, then `PUT` that exact snapshot to GitHub (auto-save and the commit step share one snapshot, never racing)
- **Pulling / overwrite actions**: persist the current snapshot, then overwrite the working copy with remote content using a `backup` save option, so the replaced copy joins the design's backup timeline in the same transaction (see `storage-architecture.md` § Backups)

GitHub-specific metadata (`githubRepoContexts`, `githubFiles`) and explorer state (`localOnlyEntries`, `localFolderEntries`) are kept in dedicated IndexedDB tables, hydrated into in-memory singletons (`GitHubMetadataStore`, `GitHubExplorerStateStore`) at startup.

## Auth Flow (Phase 1)

Authentication uses a **GitHub App** with an httpOnly secure cookie managed by SvelteKit server routes. The browser never sees the raw token — all GitHub API calls are proxied through server endpoints.

GitHub Apps have two distinct concepts that must both happen before private repos are accessible:

- **Authorization** (OAuth): the user proves their identity to the app
- **Installation**: the user grants the app access to specific repositories

The login flow uses standard GitHub OAuth (`login/oauth/authorize`) to obtain a user token. This is the same endpoint used regardless of whether the GitHub App is already installed, so **re-authentication always works** — including when a token expires.

```
Browser → GET /api/auth/github[?returnTo=/editor/<id>]  (redirects to GitHub OAuth authorize page)
GitHub  → user authorizes the app
GitHub  → GET /api/auth/github/callback?code=...&state=...
Server  → exchanges code for tokens, sets httpOnly cookies, redirects to returnTo or /editor
Client  → all subsequent API calls go through /api/github/* (token attached server-side)
```

### Token expiry and renewal

- **Cookies.** `gh_token` holds the access token (`maxAge` = GitHub's `expires_in`, 8 h fallback).
  When the GitHub App has "Expire user authorization tokens" on, GitHub also returns a refresh token;
  it goes in `gh_refresh` (httpOnly, `path: '/api'`, `maxAge` = `refresh_token_expires_in`). Apps
  without expiring tokens get no refresh token, and the 8 h cookie simply ends the session.
- **Server renewal.** Every proxy route and `/status` calls GitHub through
  `githubFetchAsUser(cookies, path, init)` (`server-utils.ts`). A missing access cookie is renewed
  from `gh_refresh` first; a GitHub 401 is renewed once and the request retried. Renewal stores the
  new pair (GitHub rotates the refresh token). If renewal fails the helper throws 401 but **does not
  clear cookies**: a parallel request may already have rotated the refresh token.
- **Client.** `apiFetch()` (`api.ts`) treats a 401 as "maybe expired": it re-checks
  `/api/auth/github/status` (which uses the latest cookies, so it sees a sibling request's renewal)
  and retries once if signed in. Otherwise it calls `markGitHubSessionExpired(wasSignedIn)` and
  throws `GitHubSessionExpiredError` (friendly message). `githubAuth.sessionExpired` is set only
  if the user was signed in before, and drives `GitHubSessionExpiredBanner.svelte` in the editor.
- **Sign in again** saves the design, then `loginWithGitHub(currentPath)`; `/api/auth/github`
  keeps `returnTo` in a 10-minute `gh_oauth_return` cookie after `safeReturnPath()` (same-site path
  only, no control characters or backslashes), and the callback redirects there.
- A commit that fails with 401 leaves the SHA and `lastSyncAt` untouched, so the design stays
  "unsaved to GitHub" and can be committed after signing in.

**Private repo access** requires the GitHub App to be installed (granting it access to specific repos). This is a one-time step separate from authentication:

```
Browser → GET /api/auth/github/install  (redirects to GitHub App installation page)
GitHub  → user selects repos to grant the app access
GitHub  → GET /api/auth/github/callback?setup_action=install  (no code → redirects back to /api/auth/github to complete OAuth)
```

The callback gracefully handles the no-code case from an `installations/new` redirect (GitHub omits `code` when `setup_action=update`, i.e. the app is already installed) by restarting the OAuth flow.

**OAuth state (login CSRF).** `/api/auth/github` stores a random `state` in a 10-minute
`gh_oauth_state` cookie; the callback exchanges a code **only** when the returned `state` equals
that cookie. Without the check, a crafted callback link could sign a victim into the attacker's
account, and designs synced afterwards would land in the attacker's repo. Cases:

- no cookie, no `state` (e.g. returning from installing the app on GitHub): the code is discarded
  and the user is sent through `/api/auth/github`, which sets the state. GitHub skips the consent
  screen for an already-authorized app, so this costs one extra redirect
- no cookie but a `state` (our flow, cookie lost or blocked): 400 with "allow cookies" advice,
  instead of redirecting in a loop
- `state` ≠ cookie: 403

> **`GITHUB_APP_NAME` env var:** Must be set to the app's slug (the last path segment of `https://github.com/apps/{slug}`). Required for the install management link to work.

Users who are already authenticated but can't see a private repo can use the **"Install or configure app access →"** link in the Set Up Repository dialog, or navigate directly to `/api/auth/github/install`, to manage which repos the app can access.

### Server Routes

| Route                       | Method   | Description                                             |
| --------------------------- | -------- | ------------------------------------------------------- |
| `/api/auth/github`          | GET      | Initiate login (optional same-site `returnTo`)          |
| `/api/auth/github/callback` | GET      | Exchange code for tokens, set cookies, go to `returnTo` |
| `/api/auth/github/install`  | GET      | Redirect to GitHub App installation management page     |
| `/api/auth/github/logout`   | POST     | Clear both auth cookies                                 |
| `/api/auth/github/status`   | GET      | Returns `{ authenticated, user }`                       |
| `/api/github/repos`         | GET      | List user's repositories                                |
| `/api/github/contents`      | GET/PUT  | Get or update a file                                    |
| `/api/github/branches`      | GET/POST | List or create branches                                 |
| `/api/github/commits`       | GET      | List commits                                            |
| `/api/github/trees`         | GET      | Fetch repo file tree                                    |

### Client Services

- **`src/lib/services/github/auth.svelte.ts`** — reactive auth state (`githubAuth`, incl. `sessionExpired`), `loginWithGitHub(returnTo?)`, `logout()`, `getAuthStatus()`, `markGitHubSessionExpired()`
- **`src/lib/services/github/api.ts`** — typed wrappers: `listRepos()`, `getRepoTree()`, `getFileContent()`, `putFileContent()`, `listBranches()`, `createBranch()`, `listCommits()`
- **`src/lib/services/github/types.ts`** — TypeScript interfaces for all GitHub API responses

## Storage Provider (Phase 2)

**`src/lib/services/storage/providers/GitHubStorageProvider.ts`**

Tracks per-document metadata (path, SHA, owner, repo, branch, lastSyncAt) in IndexedDB via `GitHubMetadataStore`. Backups are not GitHub-specific: overwrites pass a reason and the storage layer keeps the replaced copy. Key methods:

- `setRepoContext(ctx)` / `getRepoContext()` — persist the connected repo/branch
- `setFileMetadata(docId, meta)` / `getFileMetadata(docId)` — track file SHA for commit updates; the setter returns a promise sync flows await
- `commitDocument(docId, message, snapshot?)` — PUT the provided snapshot (or the persisted working copy) to GitHub, store the new SHA (awaited)
- `pullDocument(docId, reason = 'before_pull')` — fetch latest from GitHub, validate, write it into IndexedDB with a `backup` option labelled `reason` (the replaced copy is kept in the same transaction), store the SHA (awaited)
- `checkRemoteState(docId)` — compare tracked SHA against remote HEAD: `'clean' | 'changed' | 'unknown'`. Errors (network, expired session) are `'unknown'`, never `'clean'`
- `commitDocument()` turns GitHub's refusal of a stale SHA (409, or 422 about `sha`) into `GitHubConflictError` (`isShaConflict()` in `api.ts`)
- `stampSyncTime(docId, now)` — update `lastSyncAt` after a commit or pull (awaitable)

### EditorDocumentSession GitHub State

`EditorDocumentSession` (`src/lib/components/Editor/context/EditorDocumentSession.svelte.ts`) holds:

| Field                 | Type                         | Description                                                          |
| --------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `currentRepoContext`  | `GitHubRepoContext \| null`  | Connected repo/owner/branch                                          |
| `currentFileMetadata` | `GitHubFileMetadata \| null` | Open file path, SHA, repo, lastSyncAt                                |
| `lastLocalPersistAt`  | `number \| null`             | Timestamp of the last durable local save of the current working copy |
| `lastGitHubSyncAt`    | `number \| null`             | Timestamp of last commit/pull                                        |
| `remoteAheadOfLocal`  | `boolean`                    | Remote has changes not in local copy                                 |

`newFileDialogOpen` and `publishToGitHubDialogOpen` are UI-only booleans and live on `EditorViewContext`
(`src/lib/components/Editor/context/EditorViewContext.svelte.ts`) — they control dialog visibility, not
sync state.

Key methods:

- `loadDocumentFromGitHub(owner, repo, path, branch)` — fetch, validate (`migrateDocumentJson`), cache, load
- `commitCurrentDocToGitHub(message)` — delegate to provider, update metadata
- `pullCurrentDocFromGitHub(reason)` — delegate to provider (`before_pull` or `before_accept_remote`), reload editor
- `applyResolvedConflict(docId, json)` — the diff dialog's _Apply resolved JSON_; saves with a `before_conflict_resolve` backup
- `persistCurrentDocumentSnapshot(reason)` — durably save the live in-memory document and return the exact snapshot used
- `listBackups(docId)` / `restoreBackup(docId, entry)` — the design's backup timeline (all reasons); restoring keeps the replaced copy as a `before_restore` backup. Discard's dialog and toast say the local version goes to Backups _and_ that only the last 5 are kept, pointing to **Download .fn.json**
- `createDocumentFromImportedPart(part, name, folderPath?)` — creates a new `.fn.json` document pre-populated with the given Part, persists it locally, and returns `{ docId, path }`. Used when importing cadnano JSON files (both from the Open dialog and from the GitHub Explorer). `currentFileMetadata` is set to `null` — the document is local-only until explicitly published or committed.

### Conflict Detection

`remoteAheadOfLocal` is set by a non-blocking `checkRemoteState()` call on document load. An
`'unknown'` result leaves `remoteAheadOfLocal` as it was and sets `remoteCheckFailed`, shown in
the status bar as **? GitHub not checked** (click → `recheckRemote()`). `Editor.svelte` also sets it
the moment the browser goes offline (`markRemoteUnchecked()`), re-checks on `online` and when the
tab becomes visible again, and a commit or pull of the open design that can't reach GitHub sets it
too. `apiFetch()` turns a rejected `fetch` into `GitHubNetworkError` ("Couldn't reach GitHub…")
instead of the browser's "Failed to fetch". An unknown state never
blocks a commit: the PUT carries the tracked SHA, and if GitHub refuses it,
`commitCurrentDocToGitHub()` sets `remoteAheadOfLocal` and rethrows `GitHubConflictError`. The
commit dialog then shows its **Conflict detected** panel (View diff / Force overwrite / Pull
latest first), and the explorer's multi-file commit lists the file as skipped (remote conflict)
rather than failed. The GitHub Explorer shows a banner:

- **Remote ahead, no local edits** → blue "GitHub has newer changes. Pull." banner
- **Both sides changed (diverged)** → amber "Diverged" banner with "Commit local", "Discard & pull", and "Review changes" actions

"Review changes" opens the **Diff Dialog** (see [Text Diff & Merge](#text-diff--merge-phase-5a)).

## File Explorer UI (Phase 2)

**`src/lib/components/Editor/GitHubExplorer/GitHubExplorer.svelte`**

Opened via the GitHub button in the toolbar. Displays three tabs:

### Files Tab

- Tree view of all `.json` files in the repo (folders, then files, alphabetically)
- Click a `.fn.json` file → loads it into the editor (saves current doc first, reuses local copy if already cached)
- Click a `.json` / `.cadnano.json` file → see [Cadnano JSON Import from GitHub Explorer](#cadnano-json-import-from-github-explorer) below
- Local-only files (not yet committed) shown with amber dot; modified committed files also shown with amber dot
- Folder selection: first click selects a folder (ring highlight) as the target for "New file"; second click toggles expand/collapse
- Pull button (cloud-download icon) in the header refreshes the open file from GitHub
- Disconnect button (unplug icon) clears the repo connection
- After a pull/overwrite, dirty-path state is recomputed immediately so overwritten files disappear from the Changes tab instead of lingering as stale modified entries

### Changes Tab (`SourceControlPanel.svelte`)

Two-section view modelled after VSCode's Source Control panel:

- **Staged Changes** — files queued for the next commit. Header has an "unstage all" button.
- **Changes** (unstaged) — all other pending files. Header has a "stage all" button.

Each file row shows an **A** (green, new local-only) or **M** (amber, modified committed) badge. Hovering reveals a `+` (stage) or `−` (unstage) icon button.

- Clicking a file name navigates to it in the editor
- Commit message textarea + "Commit N files" button — commits only staged files
- Button is disabled until at least one file is staged and a message is entered
- Branch warning when on `main`/`master`
- ⌘↵ keyboard shortcut to commit staged files
- Accessible from toolbar "Commit" button (opens the panel directly on this tab)

> **Limitation:** Each staged file produces a separate GitHub API commit, all sharing the same message. N staged files → N commits in repo history. A future improvement could use the Git Trees/Blobs API for a true single-commit batch.

Because files are committed one by one, a run can partly succeed. `commitAll()` collects a
`CommitAllResult` (committed / changed-on-GitHub / failed with reason) and returns
`summarizeCommitAll()`'s summary (`GitHubExplorer/commitSummary.ts`): one toast, e.g. "Committed 1
of 3 files" with a line per file that didn't go through, repeated in the Changes panel. The commit
message is kept when something is left, so retrying is one click. It never throws for per-file
failures.

### Graph Tab (`GitGraphPanel.svelte`)

Full visual commit DAG — see [Git Graph section](#git-graph-phase-4) below.

## Cadnano JSON File Handling

Foldnano distinguishes between two JSON file types:

| Extension                 | Format            | Meaning                                       |
| ------------------------- | ----------------- | --------------------------------------------- |
| `.fn.json`                | Foldnano document | Native format; opened directly                |
| `.json` / `.cadnano.json` | cadnano 2 export  | Legacy format; must be imported and converted |

Detection is content-based via `cadnanoParser.canParse(raw, meta)` in `src/lib/components/Editor/Toolbar/parsers/cadnanojsonParser.ts`. A file is treated as cadnano JSON if the content has a `vstrands` array and a `name` field, OR if the file's secondary extension is `cadnano`.

### Opening a Cadnano JSON from the Open Dialog

**Toolbar → Open → drag in a `.json` / `.cadnano.json`**

1. A confirmation card appears: "A new `.fn.json` document will be created. The original `.json` won't be modified."
2. If a GitHub repo is connected, an optional checkbox offers: "Add original `.json` to current repo folder". When checked, the original cadnano file is committed to the currently active folder on the current branch as a reference alongside the new `.fn.json`.
3. Clicking **Open as New Document** calls `createDocumentFromImportedPart`, then navigates to `/editor/{docId}`.
4. The new document is local-only. Use **Save to GitHub** (see below) to publish it.

Opening a `.fn.json` from the same dialog is unchanged — it loads the document directly into the editor.

### Load Cadnano JSON as a Part

**Toolbar → Add New Part dropdown → Load Cadnano Design as a Part**

`LoadCadnanoAsPartDialog.svelte` — drag in a `.json` / `.cadnano.json` to add it as an additional Part to the **current** document (no new document is created). Respects the one-Part limit; shows an alert if the limit is already reached.

### Cadnano JSON Import from GitHub Explorer

**GitHub Explorer → Files tab → click a `.json` / `.cadnano.json`**

1. **Collision check**: if a matching `.fn.json` already exists in the same folder (in the repo tree or as a local-only file), a warning toast is shown and no action is taken. The user must rename one of the two files first.
2. Otherwise, a confirmation dialog is shown: "Open as Foldnano document? A new `{name}.fn.json` will be created in the same folder."
3. On confirm: the cadnano file is fetched from GitHub, validated with `cadnanoParser.canParse`, parsed to a `Part`, and `createDocumentFromImportedPart` is called. The resulting document is registered as a local-only entry in `githubExplorerStateStore` and immediately appears in the Files tree and Changes tab.
4. The editor updates reactively in place (no page navigation) — `session.createDocumentFromImportedPart` swaps the session's `currentDoc` (proxied by `editorViewContext.currentDoc`), which Svelte 5 reactivity propagates to the canvas.
5. The original cadnano `.json` file is never modified.

## Publish to GitHub (first-time save)

**Toolbar → Save dropdown → Save to GitHub Repo**

This button handles three cases:

| State                                                                                                               | Action                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GitHub repo not connected                                                                                           | Toast error: "Connect to GitHub first"                                                  |
| `currentFileMetadata` is set (file already committed)                                                               | Opens the GitHub Explorer Changes tab so the user can stage and commit the latest edits |
| Doc is tracked as a local-only entry (created via New File or cadnano import, in Changes tab but not yet committed) | Opens the GitHub Explorer Changes tab — the file is already staged as "added"           |
| Doc has no GitHub path at all                                                                                       | Opens **PublishToGitHubDialog**                                                         |

### PublishToGitHubDialog (`GitHubExplorer/PublishToGitHubDialog.svelte`)

- **File name**: read-only, derived from `currentDoc.name + '.fn.json'`
- **Folder**: dropdown populated from the repo file tree. Pre-filled from the existing local-only entry's folder path (if the doc was previously imported from GitHub), otherwise from the currently selected folder in the Explorer.
- **Commit message**: editable, pre-filled as `Add {docName}`
- On **Publish**:
  1. Registers GitHub metadata (`path`, `sha: ''`, owner/repo/branch) so `commitCurrentDocToGitHub` knows the target
  2. Calls `session.commitCurrentDocToGitHub(message)`
  3. Removes the path from `localOnlyEntries` (if it was tracked)
  4. Refreshes the repo file tree and switches to the Changes tab
  5. On error: rolls back the metadata registration so the doc stays as a local-only file
- After publishing, `currentFileMetadata` is populated and the toolbar Commit button becomes active for future edits

## Commit Workflow (Phase 3 + 4.5a)

The toolbar "Commit" button opens the **Changes tab** of the GitHub Explorer panel (Phase 4.5a). The older single-file `CommitDialog.svelte` still exists and is used from the "Commit local" shortcut in the diverged-state banner.

The Changes tab lists all pending files split into **Staged** and **Unstaged** sections. Users stage individual files (or all at once), then enter a message and click "Commit N files" to commit only the staged subset. See [Changes Tab](#changes-tab-sourcecontrolpanelsvelte) above.

### Repo Setup Dialog

**`src/lib/components/Editor/GitHubSetup/RepoSetupDialog.svelte`**

First-time setup: pick a repository from the user's list, select a branch, click "Connect". The selection is written to the `githubRepoContexts` IndexedDB table via `GitHubMetadataStore`.

## Status Bar

The editor status bar (bottom of screen) shows:

- **Branch icon + branch name** — bold, when a GitHub file is open
- **Amber dot + "unsaved to GitHub"** — when local edits exist that haven't been committed
- **↓ remote ahead** — when GitHub has newer changes
- **? GitHub not checked** — the check for newer changes failed; click to retry
- **Backups** — opens the Backups dialog (the design's backup timeline; also in the Save menu for every design)
- **`owner/repo · path/to/file.json`** — full path (tooltip shows absolute path)
- **Canvas hover footnote** — right-aligned; shows oligo/segment info on hover

## Git Graph (Phase 4)

### Layout Engine (`src/lib/services/github/gitGraph.ts`)

Implements a greedy lane-assignment algorithm producing a per-row SVG commit DAG.

**Algorithm:**

`activeLanes: (string | null)[]` — each slot holds the SHA of the commit that lane is "looking for" going downward. `null` = free.

For each commit (topological order, newest-first by author date):

1. Find `lane = activeLanes.indexOf(commit.sha)` or claim first free slot.
2. Snapshot `entering = [...activeLanes]`.
3. For **first parent**: if already tracked in lane M → free commit's lane, `parentLane[0] = M`; else continue in same lane.
4. For **additional parents** (merge commits): find/create a free slot.
5. Snapshot `exiting = [...activeLanes]`.

**SVG constants:**

| Constant      | Value    | Description                                          |
| ------------- | -------- | ---------------------------------------------------- |
| `LANE_WIDTH`  | 16px     | Horizontal spacing between lane centres              |
| `ROW_HEIGHT`  | 28px     | Pixel height of each commit row                      |
| `DOT_RADIUS`  | 4px      | Commit dot radius                                    |
| `LANE_COLORS` | 8 colors | Blue, red, green, amber, purple, cyan, orange, brown |

**`rowInstructions(node)`** returns `DrawInstruction[]` (lines + dot) for one SVG row:

- Pass-through lanes: full vertical line (`y=0` to `y=28`)
- Entering line: `y=0` to `y=14` for commit's own lane (if lane was active above)
- Dot at `(lx(lane), 14)`
- Parent connections: `(lx(lane), 14)` to `(lx(parentLane), 28)` — straight or diagonal for merges

### GitGraphPanel.svelte

- Fetches up to 8 branches in parallel, 50 commits each (first page)
- Merges into a deduplicated `Map<sha, GitHubCommit>`
- Renders each `CommitNode` as: inline SVG (graph column) + branch label pills + short message + date
- **Branch label pills**: current branch shown bold + double-ring (`box-shadow: 0 0 0 2px white, 0 0 0 4px <color>`); other branches are clickable to switch
- "Load more" paginates by fetching the next 50 commits per branch
- Inline "New branch from `<current>`" form at the footer
- Switching branches is **blocked** (toast error) when any file has uncommitted changes — the user must commit or discard before switching to prevent branch/file metadata from diverging

## Text Diff & Merge (Phase 5a)

### Diff Engine (`src/lib/services/github/diff.ts`)

A dependency-free, linear-space Myers line diff. Shared by the Diff Dialog and the Backups dialog (`BackupsDialog.svelte`, the recovery path), so it must never exhaust the tab.

- `computeDiff(a, b, { maxChanges }?): DiffHunk[] | null` — takes two strings, returns hunks with `type: 'equal' | 'removed' | 'added'`, `lines: string[]`, and line-number offsets (`leftStart`, `rightStart`); or `null` when more than `maxChanges` lines differ (default `MAX_DIFF_CHANGES`, 5,000). Both dialogs show a "too many changes to show line by line" message for `null` and keep their actions available.
- How it stays bounded: the common leading/trailing lines are trimmed first, lines are interned to integers, and the middle is split recursively at Myers' middle snake (`bisect`, after diff-match-patch), so memory is O(N+M). The cap stops the top-level search early. On the 81k-line `test_tetrahedral2.fn.json`, a diff at the cap takes about 140 ms and a too-large one about 80 ms, both under 50 MB. The earlier version kept a full Myers trace (O(changes × lines)) and ran out of memory at about 2,000 changed lines; `diff.spec.ts` keeps that design as a regression case.
- `generateConflictMarkers(local, remote): string` — produces Git-style `<<<<<<< Local / ======= / >>>>>>> Remote` markers for the edit-mode textarea.

JSON is pretty-printed (`JSON.stringify(…, null, 2)`) on every commit and pull so line-by-line diffs are stable and human-readable.

### Diff Dialog (`src/lib/components/Editor/GitHubDiff/DiffDialog.svelte`)

Two-column unified diff view opened from:

- The **"Review changes"** button in the diverged-state amber banner
- The **"View diff"** button in `CommitDialog` when conflict is detected
- **Clicking a file** in the Changes panel (view-only — no resolution buttons)

**Layout:** Remote (committed) on the left, Local (your changes) on the right. Green lines = additions in your local copy; red lines = what was removed from the GitHub version.

**Collapsible equal sections:** unchanged runs longer than ±3 context lines are collapsed to a "N unchanged lines — click to expand" row (`DiffHunk.svelte`).

**Resolution actions** (hidden in view-only mode):

| Action             | Effect                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep local**     | `overwriteGitHubWithLocal()`: fetches the current remote SHA, then commits the local version over it (also used by the commit dialog's **Force overwrite**). No backup of the remote version: it stays in git history |
| **Accept remote**  | `pullCurrentDocFromGitHub('before_accept_remote')`: persists, then overwrites keeping a backup                                                                                                                        |
| **Edit & resolve** | Opens a `<textarea>` pre-filled with conflict markers; "Apply" validates JSON, then `applyResolvedConflict()` (keeps a backup)                                                                                        |

### Pretty-Print JSON

All writes to GitHub and to the IndexedDB working copy use `JSON.stringify(snapshot, null, 2)` for stable, human-readable line-by-line diffs. This applies to:

- `GitHubStorageProvider.commitDocument()` — before base64-encoding for the PUT request
- `GitHubStorageProvider.pullDocument()` — when caching the fetched file into the `documentSnapshots` table
- `EditorDocumentSession.loadDocumentFromGitHub()` — when saving the working copy after opening

## Data Types

`GitHubRepoContext` / `GitHubFileMetadata` live in
`src/lib/services/storage/githubTypes.ts`; API response shapes (`GitHubCommit`, etc.) live in
`src/lib/services/github/types.ts`:

```typescript
interface GitHubRepoContext {
	owner: string;
	repo: string;
	branch: string;
}

interface GitHubFileMetadata {
	path: string;
	sha: string; // blob SHA for next commit
	owner: string;
	repo: string;
	branch: string;
	lastSyncAt?: number; // Date.now() at last commit/pull
	commitSha?: string; // GitHub commit SHA this local copy is based on
}

interface GitHubCommit {
	sha: string;
	commit: {
		message: string;
		author: { name: string; email: string; date: string } | null;
		committer: { name: string; email: string; date: string } | null;
	};
	html_url: string;
	author: { login: string; avatar_url: string } | null;
	parents: { sha: string; url: string }[];
}
```

## Environment Variables

```
GITHUB_APP_CLIENT_ID=...      # Client ID from GitHub App settings
GITHUB_APP_CLIENT_SECRET=...  # Client secret from GitHub App settings
GITHUB_APP_NAME=...           # App slug (last segment of https://github.com/apps/{slug})
```

`GITHUB_APP_NAME` is required for the installation-based login flow (private repo access). Without it the flow falls back to plain OAuth, which only returns public repos.

See `.env.example`. Never commit `.env` — it is in `.gitignore`.

## Limitations / Known Gaps

- One repo connected at a time (by design for simplicity)
- "Commit" (Changes tab) makes one GitHub commit per **staged** file — all with the same message. N staged files → N commits. A future improvement could use the Git Trees/Blobs API to bundle everything into a single commit.
- Graph fetches from up to 8 branches; repos with many active branches may be incomplete
- Files larger than ~1 MB may be slow to load (base64 decode in-browser)
- **Publish can leave an untracked file on GitHub.** `PublishToGitHubDialog.handlePublish()` binds the design to the new path, commits, and on any error restores the previous binding (`restoreGitHubBindingSnapshot()`). If the PUT succeeded but storing the new SHA then failed (`setFileMetadata()` is awaited and throws, typically when browser storage is failing and the save banner is up), the file exists on GitHub while the design is local-only again. Publishing again to the same path is refused as a conflict (GitHub answers 422 "sha wasn't supplied" → `GitHubConflictError`). Recovery: open that file from the Files tab (it has the same content) or publish under another name. Not fixed because it needs a storage failure between two awaited steps; revisit if publish grows a retry path.
- Backups live in the design's local backup timeline (last 5, any reason); they are local recovery points, not cross-device backups

## Boundaries / Don'ts

- **Don't reintroduce a per-step trace in `diff.ts`, or drop the change cap.** Backup and conflict diffs of large designs run on the main thread; memory must stay O(N+M) and callers must handle `null`.

- **Never call `api.github.com` from the client.** All requests go through `/api/github/*` (token attached server-side).
- **Never read or write the OAuth token client-side.** It lives in an httpOnly cookie.
- **Build every proxy URL through the validators in `server-utils.ts`.** `repoApiPath()` (owner/repo `^[\w.-]+$`, not `.`/`..`), `encodePathSegments()` (file paths and ref names: no empty, `.` or `..` segments, each segment URI-encoded, slashes kept), `assertCommitSha()` and `positiveIntParam()`. Never interpolate a query or body value into a GitHub API path directly: `../` would reach other endpoints with the user's token (and plugins can call these routes).
- **Call GitHub from routes only through `githubFetchAsUser()`.** It renews expired tokens; calling `githubApiFetch()` with a cookie token directly skips renewal.
- **Don't clear auth cookies when a refresh fails.** Parallel requests race to rotate the refresh token; the client re-checks `/status` before declaring the session expired.
- **Don't treat a failed remote check as clean.** Handle `'unknown'` from `checkRemoteState()` explicitly, and route `GitHubConflictError` into the conflict UI rather than a generic error.
- **Validate `returnTo` with `safeReturnPath()`** before storing or redirecting; it is user input.
- **Never exchange an OAuth code without a matching state cookie.** Redirect to `/api/auth/github` instead of skipping the check.
- **Auto-save is local only.** A successful `markSaved()` does not push to GitHub — only `commitCurrentDocToGitHub()` does.
- **Don't pull without persisting first.** `pullCurrentDocFromGitHub()` calls `persistCurrentDocumentSnapshot()` before the overwrite so unsaved edits land in the backup the overwrite keeps — keep that order if you fork the flow, and always pass a backup reason to the overwriting write.
- **Await SHA / `lastSyncAt` writes in sync flows.** Commit, pull, open and discard fail loudly if their bookkeeping can't be stored; don't turn those awaits back into fire-and-forget.
- **Don't persist fetched JSON before validating it.** `loadDocumentFromGitHub()` and `GitHubStorageProvider.pullDocument()` run `migrateDocumentJson()` before writing the working copy, so a file from a newer Foldnano (`DocumentFormatError`, reason `too-new`) is refused without overwriting local work. See `dna-model.md` § Document format version.
- **Don't allow branch switching with uncommitted changes.** The hard-block (toast + cancel) is intentional; bypassing it can lose work that hasn't reached the remote.
- **All snapshots cross the boundary as `JSON.stringify(snapshot, null, 2)`.** Don't change the formatting — diffs and SHA stability depend on it.
