---
covers:
  - src/lib/services/fileAccess/**
---

# File Access (File System Access API)

A thin, feature-agnostic layer over the browser's File System Access API in
`src/lib/services/fileAccess/fileAccess.ts`. Plugin dev mode uses it to read a linked plugin
folder (`docs/python-plugin-system.md` § Plugin dev mode) and agent runs to exchange request and
result files in it; editing local design files is meant to
reuse it later.

## What it provides

- `supportsFileSystemAccess()`: the API exists only in Chromium-based browsers. Features gate on
  it and explain the limitation; there is no `<input webkitdirectory>` fallback for folders.
- `pickDirectory()`: the folder picker; `null` when the user cancels.
- `queryAccess()` / `ensureAccess()`: permission for a stored handle. Permission is per tab and
  per session unless the user chose "allow on every visit", so a handle loaded from IndexedDB can
  be in the `prompt` state.
- `walkDirectory()`: lists files (path, handle, size) without reading them, with an `ignore`
  callback and `maxFiles` / `maxBytes` limits checked as it goes.
- `listFileNames()` (one folder, no recursion), `removeFile()` (a missing file is fine).
- `readFileBytes()`, `writeFile()` (via `createWritable`), `isEffectivelyEmpty()` (only OS/git
  noise), `isMissingHandleError()` (a moved or deleted folder).
- `memoryFileSystem.ts`: in-memory handles for tests; jsdom has no File System Access API.

Handles are stored in the IndexedDB `fileHandles` table (`docs/storage-architecture.md`), keyed by
an id the feature keeps. Only the handle is stored, never file contents.

## Boundaries / Don'ts

- **No feature knowledge here.** Ignore lists, size caps and what the files mean belong to the
  caller (e.g. `src/lib/plugin/linkedPluginFolder.ts`).
- **Call `ensureAccess()` first in a click handler.** `requestPermission()` needs a live user
  gesture; awaiting other work first can lose it.
- **Never hand a handle to the plugin sandbox.** Read on the app page; only bytes cross into the
  worker.
- **For designs, a linked file is a save target, not a `StorageProvider`.** IndexedDB stays the
  working copy (autosave, backups, multi-tab ownership); writes to a linked file keep the
  `isTabOwner` gate.
