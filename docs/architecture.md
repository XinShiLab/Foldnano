---
# Keep covers empty: this doc maps the whole app, so listing files here would flag it on nearly
# every change. Put new files in the focused doc for their area, or leave them uncovered.
covers: [] # cross-cutting; review manually
---

# Architecture

Top-level map of the codebase. Each area below points to a focused doc — load that doc when working on the area; load this one when you need to find your way around.

## Stack

- **SvelteKit 2** + **Svelte 5** runes (`$state`, `$derived`, `$props`)
- **TypeScript** strict; class files using runes use the `.svelte.ts` extension
- **Konva.js** 2D canvas (StrandView), **Three.js** 3D (View3D), SVG (HelixView)
- **Dexie.js** over **IndexedDB** for the working copy (no `localStorage` at runtime)
- **Pyodide** Web Worker for the Python plugin runtime
- **Tailwind 4 + shadcn-svelte** components (built on **bits-ui**) in `src/lib/components/ui/`, **paneforge** for resizable panes
- **pnpm**

## Process Layers

```
Routes  ──►  UI Components  ──►  Canvas Editor (modes/tools)
                                     │
                                     ▼
                                Commands (history.tx / snapshotTx)
                                     │
                                     ▼
                                DNA Model  ──►  IO  ──►  Storage  ──►  GitHub sync
```

Mutations flow downward only. UI reads from `$state`/`$derived` on model objects; tools call commands; commands mutate the model inside `historyStack.tx(...)`. Anything that mutates the model outside `tx()` will not be undoable.

## Source Layout

```
src/
├── routes/
│   ├── editor/[docId]/        main editor (lazy-loaded, browser-only)
│   ├── editor/                document list
│   ├── toc/                   table of contents
│   ├── oligos/                 oligo report + oligo report diff pages
│   ├── privacy/                privacy policy page
│   ├── api/auth/github/       OAuth: authorize, callback, status, install, logout
│   └── api/github/             proxies: repos, contents, trees, branches, commits
│
└── lib/
    ├── model/                 pure domain (no Svelte components)
    │   ├── document.svelte.ts          FoldnanoDocument (root)
    │   ├── Part/                       Part, Plane, DesignRegion (lattice/freeform capability
    │   │                                flags live on DesignRegion, not Part), SpatialIndexService
    │   ├── VirtualHelix/, Oligo/       VHs, oligos, segments, slots, ends
    │   ├── io/                         cadnanoJSON, sequenceCSV, oxdnaExport, mrdnaExport,
    │   │                                simulationNtModel
    │   ├── geometry3d/                 lattice/twist coords, insert/skip offsets
    │   ├── rbs/                        rigid-body simulation (transient)
    │   └── test/                       vitest unit tests
    │
    ├── canvasEditor/          tool/mode logic for the strand viewer
    │   ├── core/              modes, capabilities, view kinds
    │   ├── services/          hitEventToModel, selection, KonvaCamera
    │   └── tools/             one file/folder per mode (select/, draw, …)
    │
    ├── commands/              undo/redo + command functions
    │   ├── history.svelte.ts  HistoryStack, tx, snapshotTx, mementos
    │   ├── strands.ts, virtualHelix.ts, virtualHelices.ts
    │   ├── planes.ts, regions.ts, overlays.ts, repeatGroups.ts
    │
    ├── plugin/                Python plugin host: PluginRegistry, PluginCoordinator, manifest
    │                          validation, op dispatch, worker/ (Pyodide worker + bridge)
    │
    ├── whats-new/             About → What's New data + commit-based draft script logic
    ├── analytics.ts           cookieless Vercel Web Analytics URL redaction
    │
    ├── components/Editor/
    │   ├── context/           EditorViewContext, EditorDocumentSession
    │   ├── StrandView/        2D strand diagram (Konva)
    │   ├── HelixView/         lattice/freeform plane editors (PlaneViewer routes)
    │   ├── View3D/            Three.js + RBS toolbar
    │   ├── GitHubExplorer/    Files / Changes / Graph tabs
    │   ├── GitHubDiff/, GitHubCommit/, GitHubSetup/, GitGraph/
    │   └── Toolbar/, ToolPanel/, SidePanel/
    │
    └── services/
        ├── storage/           StorageManager + IndexedDbStorageProvider
        │                      + FoldnanoIndexedDb (Dexie schema)
        │                      + GitHubMetadataStore, GitHubExplorerStateStore
        └── github/            auth, api, diff, gitGraph, types
```

## Where to look

| Topic                                              | Doc                                                   |
| -------------------------------------------------- | ----------------------------------------------------- |
| Domain classes (Part / VH / Oligo / Region)        | `dna-model.md`                                        |
| O(1) hit-test cache                                | `spatial-index.md`                                    |
| Svelte 5 runes inside classes                      | `reactivity-patterns.md`                              |
| Mode/tool architecture, hit testing                | `canvas-editor-tools.md`                              |
| Selection state and hit priority                   | `selection-system.md`                                 |
| Strand viewer (2D Konva)                           | `editor-strand-viewer.md`                             |
| Helix viewer + plane editors                       | `editor-helix-viewer.md`, `editor-freeform-viewer.md` |
| 3D view                                            | `editor-3d-view.md`                                   |
| Build config, git hooks, license/docs/lint scripts | `dev-tooling.md`                                      |
| Rigid-body simulation                              | `rigid-body-simulation.md`                            |
| Commands, undo/redo, mementos                      | `commands-and-history.md`                             |
| Routes / page wiring                               | `routes-guide.md`                                     |
| Local persistence (IndexedDB schema)               | `storage-architecture.md`                             |
| Auto-save thresholds and triggers                  | `autosave.md`                                         |
| Multi-tab ownership                                | `multi-tab-protection.md`                             |
| GitHub auth, API proxy, sync flows                 | `github-integration.md`                               |
| Repeat units (duplicate selection, mirror oligos)  | `repeat-units.md`                                     |
| Cadnano import/export                              | `cadnano-import.md`                                   |
| Oligo sequence CSV export                          | `sequence-csv-export.md`                              |
| Simulation NT model (format-agnostic)              | `simulation-nt-model.md`                              |
| oxDNA export                                       | `oxdna-export.md`                                     |
| mrDNA export                                       | `mrdna-export.md`                                     |
| Python plugin host (Foldnano dev side)             | `python-plugin-system.md`                             |
| Plugin authoring (third-party authors)             | the doc site, `src/content/plugin-development/*.md`   |
| Script Lab built-in plugin + code-editor pattern   | `script-lab.md`                                       |
| About dialog What's New + draft script             | `whats-new.md`                                        |
| End-user instructions                              | the user guide, `src/content/guide/*.md`              |

## Cross-cutting Boundaries

- **Mutations live in `commands/`.** UI/tool code never edits model fields directly. Wrap every mutation in `historyStack.tx(label, rec => ...)` (targeted patches) or `historyStack.snapshotTx(label, () => ...)` (full doc snapshot, structural edits).
- **`Part` is the only mutation owner inside the model.** Don't poke at `VirtualHelix._length`, `OligoSegment.slots`, `StrandSet.segmentIds`, etc. — go through `part.*` methods.
- **Reactive collections must be `SvelteSet`/`SvelteMap`.** Plain `Set`/`Map` are fine only for non-reactive internal caches.
- **All GitHub API calls go through `/api/github/*`.** The browser never sees the OAuth token; never call `api.github.com` directly from client code.
- **Topology is keyed by `vh.id`, not `vh.listRow`.** Display reordering, region collapse, and region reordering must not invalidate the spatial index.
- **`vh.listRow` is assigned by `Part.syncListRows()`, not derived.** Don't write to it directly; reorder regions or `vhOrder` and let `syncListRows` rebuild.
- **RBS results are transient.** `BlockTransformOverride` is a render-time override only — never persisted to the document.
- **Plugin/Editor sessions are split.** `EditorDocumentSession` owns `currentDoc`, `historyStack`, `StorageManager`, and GitHub metadata. `EditorViewContext` owns view state, mode, selection, controllers. They are wired together but distinct.

## Build / test

```bash
pnpm dev          # dev server
pnpm build        # production build
pnpm check        # svelte-check (TS)
pnpm lint         # prettier + eslint over the whole tree (pnpm lint:changed / lint:branch scope it)
pnpm test         # vitest --changed — only suites affected by uncommitted changes (default inner loop)
pnpm test:branch  # only suites affected by this branch vs main
pnpm test:all     # full suite — final check / CI
pnpm test:unit    # vitest watch
```

Tests run in jsdom; specs live under `src/lib/model/test/*.spec.ts`. See `CLAUDE.md` for the full command list (including `whats-new:draft`).

Build config, git hooks, the third-party license generator and the docs/lint scripts: `docs/dev-tooling.md`.
