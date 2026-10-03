---
title: Storage, Autosave, And GitHub
description: IndexedDB working copies, tab ownership, autosave rules, GitHub proxy routes, and sync boundaries
category: contributors
order: 6
slug: storage-github
---

# Storage, Autosave, And GitHub

## Storage Model

Foldnano is local-first: the live document lives in memory, is persisted to **IndexedDB** as the working copy through `StorageManager`, and is only synced to GitHub when the user explicitly commits or pulls. `localStorage` must not be used at runtime.

Local-first is a deliberate choice, not an accident of implementation order: it means a design is never lost to a flaky network request, a GitHub outage, or a user who's editing offline. The working copy is always the durable, in-browser source of truth. GitHub is layered on top as an explicit sync target, not the primary persistence backend, so a failed GitHub sync degrades to "you still have your local copy," not "you lost your edits."

GitHub-backed documents still keep local working-copy metadata (`GitHubMetadataStore`, `GitHubExplorerStateStore`, both backed by IndexedDB tables) for the same reason: the editor should stay usable and recoverable even if GitHub is briefly unreachable.

## Autosave

Autosave is a browser persistence path, not a publish path: it writes local IndexedDB state when dirty-state thresholds are met, and it must never stage, commit, or push to GitHub on its own.

Autosave and Git commits are deliberately kept as separate actions, even though a commit does persist the in-memory snapshot to IndexedDB first (so autosave and commit share one exact snapshot rather than racing against each other). The reason to keep them separate rather than "just auto-commit": committing is a visible, attributable action in someone else's GitHub history. A user should always be the one who decides a change is ready to be pushed, even though Foldnano is free to save their local progress continuously.

Only the tab owner may write. `EditorDocumentSession` checks `isTabOwner` before writing; preserve that gate when adding any new save path. This exists because IndexedDB is shared across tabs; without a single-writer gate, two tabs open on the same document could autosave over each other's in-progress edits.

## GitHub API Boundary

All GitHub API calls go through `/api/github/*`. The OAuth token is stored in an httpOnly cookie set by the SvelteKit server routes under `/api/auth/github/`; client code never reads or stores it.

This boundary exists specifically so that a client-side vulnerability (e.g. an XSS bug in a dependency) can't exfiltrate a user's GitHub token: the token is never in a place client-side JavaScript can reach, by construction, not by convention. Any new GitHub-touching feature must route through the server proxy rather than calling the GitHub API directly from the browser.

Current GitHub proxy areas include:

- repos
- branches
- contents
- trees
- commits

## Conflict And Overwrite Safety

Pull or overwrite flows must persist the current local snapshot first, then replace the browser working copy through a save that carries a `backup` option with a reason (`before_pull`, `before_accept_remote`, and so on). The storage layer keeps the replaced copy in the design's backup timeline in the *same transaction* as the overwrite, so there is never a moment where the overwrite happened and the backup didn't. Without it, a pull that turns out to be unwanted (wrong branch, stale local edits the user forgot about) would have no way back. The backup is what makes "pull" a safe, reversible action instead of a destructive one.

Any new GitHub write path should keep this same local-first behavior explicit: local autosave and Git commits/pulls stay separate actions, and destructive-looking operations (overwriting the working copy) get a backup first.
