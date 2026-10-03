---
covers:
  - src/lib/services/tabSync.svelte.ts
  - src/lib/services/test/fakeLockManager.ts
---

# Multi-Tab Protection

Prevents two browser tabs from editing the same document simultaneously. The active tab is the "owner" and can save or commit; all other tabs for the same document enter read-only mode.

## How it works

Ownership is an exclusive [Web Lock](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) named `foldnano-editor-{docId}`: same-origin, no server required. The browser guarantees at most one holder and releases the lock automatically when the holder's tab closes, crashes or navigates away. There is no heartbeat, watchdog or message channel.

This replaced a BroadcastChannel claim-and-heartbeat protocol, which could leave two owners: two tabs opening a document at the same moment could both keep their own claim, and a throttled background owner could miss its heartbeat so a read-only tab reclaimed while the owner still believed it owned (`ARCH P1-3` in the 2026-07 architecture review).

### Protocol

| Event                             | What happens                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab opens a document              | Requests the lock with `steal: true` and becomes the owner. If another tab held it, that tab's lock request rejects with `AbortError`.                                                                                          |
| Tab loses the lock (`AbortError`) | Sets itself read-only, then queues a normal request for the lock.                                                                                                                                                               |
| Owner tab closes or crashes       | The browser releases the lock; the first queued tab is granted it and calls `onRegained`. The session reloads the saved copy (the other tab may have saved newer work), which replaces the `TabSync` with one holding the lock. |
| User clicks "Take back control"   | Reloads the latest document snapshot from IndexedDB, which creates a new `TabSync` that steals the lock from the current owner.                                                                                                 |

"Newest tab wins" is kept on purpose: opening a document in a new tab moves editing there, as before. Two tabs opening at once still end with exactly one owner, because the lock manager serializes the steals.

### Key files

| File                                                                | Role                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/services/tabSync.svelte.ts`                                | `TabSync` class (Web Locks logic, reactive `isOwner`) and `isTabSyncSupported()`                                                                                                      |
| `src/lib/components/Editor/context/EditorDocumentSession.svelte.ts` | Owns the `TabSync` per document; exposes `isTabOwner` and `claimTabOwnership()`; passes `onRegained` (reload); `saveDocumentToLocalStorage`/`commitCurrentDocToGitHub` check the gate |
| `src/lib/components/Editor/context/EditorViewContext.svelte.ts`     | Proxies `isTabOwner` from `EditorDocumentSession`; `destroy()` delegates to the session (which destroys the `TabSync`)                                                                |
| `src/lib/components/Editor/Editor.svelte`                           | Renders the amber read-only banner; calls `editorViewContext.destroy()` on unmount, which releases the lock                                                                           |
| `src/lib/services/test/fakeLockManager.ts`                          | In-memory `navigator.locks` for specs (jsdom has none); several `TabSync`s sharing it behave like separate tabs                                                                       |

## TabSync API

```typescript
import { TabSync } from '$lib/services/tabSync.svelte';

const sync = new TabSync(docId, { onRegained }); // takes the lock (steal)

sync.isOwner; // boolean $state — true when this tab holds the lock
sync.destroy(); // release the lock, or stop waiting for it
```

`onRegained?: () => Promise<boolean>` runs when a tab that lost the lock gets it back. Resolve `true` when the caller has taken over (reloaded and replaced this `TabSync`); `false` makes this `TabSync` the owner as-is. `isOwner` stays `false` until then, so nothing saves from the stale copy in between.

`isOwner` is a Svelte 5 `$state` field, so it can be used directly in reactive contexts.

## EditorDocumentSession integration

```typescript
// Read ownership state
session.isTabOwner; // getter — false when another tab holds ownership

// Reload latest snapshot from IndexedDB, then claim ownership
await session.claimTabOwnership();
```

`saveDocumentToLocalStorage` returns `false` early when `!isTabOwner`.  
`commitCurrentDocToGitHub` throws when `!isTabOwner`.

`EditorViewContext.isTabOwner` is a thin getter that proxies `session.isTabOwner`, so view-layer code
(`StrandViewerTools`, etc.) can read ownership without reaching into the session directly. Ownership itself,
and `claimTabOwnership()`, live only on `EditorDocumentSession`.

`#initTabSync(docId)` (private, on `EditorDocumentSession`) is called whenever the active document changes
(load, create, GitHub open). It destroys the previous `TabSync` first, which releases its lock or cancels its
queued request. Its `onRegained` reloads the document with `loadDocumentFromLocalStorage`, but only if that
document is still the current one.

## UI behaviour

When `!isTabOwner`:

- An amber banner floats over the canvas (absolutely positioned, out of document flow so layout is unaffected):
  > **This file is open in another tab.** Editing is disabled. [Take back control]
- Clicking the button calls `claimTabOwnership()` (async — reloads from IndexedDB first).
- `editorMode` is forced to `PAN` via a reactive `$effect`; all keyboard shortcuts for mode changes, undo/redo, and delete are suppressed.
- In `StrandViewerTools`, all tool buttons except PAN, the delete button, and the VH-length controls are `disabled`.
- Plugins still run (a run never touches the design), but applying a result is gated: `EditorViewContext` passes `isTabOwner` to `PluginCoordinator.setEditGate`, `confirmApply()` refuses while it is false and keeps `pendingApply`, and `PluginDiffPreview` disables **Apply** with a note. After taking back control the design is reloaded; if it changed, the existing stale check discards the result.

## Edge cases

- **Different files in two tabs:** each document has its own lock name, so there is no conflict.
- **Single tab:** the tab simply holds the lock; `isTabOwner` is `true`.
- **No Web Locks** (SSR, or an insecure `http://` origin other than localhost): `isTabSyncSupported()` is false, no `TabSync` is created and `isTabOwner` stays `true`, so each tab edits as if alone. Web Locks ship in every current browser, including Safari 15.4+.
- **Tab crash or close:** the browser releases the lock; no timeout is involved.
- **Regained document deleted meanwhile:** the reload fails, `onRegained` resolves `false`, and the tab becomes owner of the copy it has.
- **Remaining window:** a steal is delivered to the old owner asynchronously, so a save the old owner started in the same instant can still land. That only happens when the user opens the document elsewhere; throttling or suspending a tab can no longer cause two owners.

## Boundaries / Don'ts

- **Don't write to IndexedDB without checking `isTabOwner`.** `EditorDocumentSession` already gates auto-save and commits — preserve that gate when adding new write paths.
- **Don't make a regained tab the owner without reloading.** The other tab may have saved newer work; the reclaiming tab's next save would overwrite it with its stale copy. Keep `onRegained` reloading.
- **Don't share a `TabSync` instance across documents.** One lock per `docId`; switching documents must `destroy()` the old one before creating a new one.
- **Don't request the lock with `steal` from anywhere but opening or reloading a document.** Stealing is how a tab takes control; doing it elsewhere would pull ownership away from the tab the user is working in.
- **`isTabOwner` defaults to `true` without a `TabSync`.** Don't add code that treats an absent `TabSync` as "not owner" — single-tab editing, and browsers without Web Locks, must continue to save normally.
