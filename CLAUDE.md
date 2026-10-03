# CLAUDE.md

Pocket reference for Claude Code working in this repo. Read `docs/architecture.md` for the full source-tree map and per-area entry points.

## Commands

```bash
pnpm dev          # dev server
pnpm build        # production build
pnpm preview      # preview production build
pnpm check        # svelte-kit sync + svelte-check (type checking)
pnpm format       # auto-format with prettier
pnpm whats-new:draft  # draft About → What's New entries from add/feat/fix commits since the last review

# Tests — prefer the scoped variants; the full run is slow (~19s, golden suites dominate)
pnpm test         # only suites affected by uncommitted changes (vitest --changed) — default inner loop
pnpm test:branch  # only suites affected by this branch vs main — before pushing/PR
pnpm test:all     # full suite (every spec) — final check / CI
pnpm test:unit    # vitest in watch mode

# Lint — same scoping; the full run checks every file
pnpm lint         # prettier --check + eslint over the whole tree
pnpm lint:changed # prettier + eslint on uncommitted changed files only
pnpm lint:branch  # prettier + eslint on files changed vs main

# Docs sync — see "Keeping docs in sync" below
pnpm docs:check   # docs whose covered code changed (uncommitted) without them; --branch / --staged
pnpm docs:check --file <path>  # which doc(s) cover a source file
pnpm docs:verify  # covers globs + backticked paths in docs still exist (part of `pnpm lint`)

# Run a single test file
pnpm vitest run src/lib/model/test/VirtualHelix.spec.ts
```

Tests run in jsdom; spec files live under `src/lib/model/test/*.spec.ts`.

`pnpm test` / `pnpm lint:changed` select work via git diff + Vitest's import graph, so touching a shared
model file still pulls in the slow golden suites (`sequence-comparison.spec.ts`,
`cadnano-json-roundtrip.spec.ts`, `oxdnaExportFiles.spec.ts`).
Note: a dirty `package.json` or vite/vitest config forces `--changed` to run everything (force-rerun trigger).

**What's New** (About dialog) is data in `src/lib/whats-new/entries.ts`; `pnpm whats-new:draft` adds
hidden drafts from recent commits for a human to rewrite. See `docs/whats-new.md`.

## Tech Stack

- **SvelteKit 2** + **Svelte 5** runes (`$state`, `$derived`, `$props`)
- **TypeScript** strict; class files using runes use the `.svelte.ts` extension
- **Konva.js** (StrandView), **Three.js** (View3D), SVG (HelixView)
- **Dexie.js** over **IndexedDB** for the working copy (no `localStorage` at runtime)
- **Pyodide** Web Worker for the Python plugin runtime
- **Tailwind 4 + shadcn-svelte** (on bits-ui) for UI components — add new ones with the shadcn-svelte CLI, not hand-built from bits-ui (`docs/code-style.md` § UI Components); **paneforge** for resizable panes
- **pnpm**

## Where to look (entry-point docs)

| Topic                                                          | Doc                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| Top-level source layout and process layers                     | `docs/architecture.md`                                          |
| Domain model (Part / Plane / DesignRegion / VH / Oligo)        | `docs/dna-model.md`                                             |
| Spatial index (O(1) hit-test cache keyed by `vh.id`)           | `docs/spatial-index.md`                                         |
| Svelte 5 runes inside classes, `SvelteSet` / snapshots         | `docs/reactivity-patterns.md`                                   |
| Mode/tool architecture, hit testing                            | `docs/canvas-editor-tools.md`                                   |
| Strand-view selection, hit priority                            | `docs/selection-system.md`                                      |
| Strand viewer (2D Konva)                                       | `docs/editor-strand-viewer.md`                                  |
| Helix / freeform plane viewers                                 | `docs/editor-helix-viewer.md`, `docs/editor-freeform-viewer.md` |
| 3D view + plane gizmo                                          | `docs/editor-3d-view.md`                                        |
| External structure overlay (mrDNA `.txt` / PDB `.pdb` into 3D) | `docs/editor-3d-external-overlay.md`                            |
| Repeat units (duplicate selection, linked mirror oligos)       | `docs/repeat-units.md`                                          |
| Rigid-body simulation (transient, render-only)                 | `docs/rigid-body-simulation.md`                                 |
| Commands, undo/redo, history mementos                          | `docs/commands-and-history.md`                                  |
| Workspace help (`?` overlay, `help()` attachment, first visit) | `docs/workspace-help.md`                                        |
| Routes, page wiring, multi-tab init                            | `docs/routes-guide.md`                                          |
| Landing page (`/`), 3D hero, featured design                   | `docs/landing-page.md`                                          |
| About dialog What's New, `whats-new:draft` script              | `docs/whats-new.md`                                             |
| Local persistence (IndexedDB schema)                           | `docs/storage-architecture.md`                                  |
| Auto-save thresholds and triggers                              | `docs/autosave.md`                                              |
| Multi-tab ownership (`TabSync`)                                | `docs/multi-tab-protection.md`                                  |
| GitHub auth, API proxy, sync flows                             | `docs/github-integration.md`                                    |
| Build config, git hooks, license generator, docs/lint scripts  | `docs/dev-tooling.md`                                           |
| Cadnano import/export                                          | `docs/cadnano-import.md`                                        |
| Simulation NT model (format-agnostic nucleotide model)         | `docs/simulation-nt-model.md`                                   |
| oxDNA export                                                   | `docs/oxdna-export.md`                                          |
| mrDNA export                                                   | `docs/mrdna-export.md`                                          |
| Sequence CSV export                                            | `docs/sequence-csv-export.md`                                   |
| Script Lab (in-editor Python scripting)                        | `docs/script-lab.md`                                            |
| Python plugin host (Foldnano-dev side)                         | `docs/python-plugin-system.md`                                  |
| Plugin authoring (third-party authors)                         | `docs/foldnano-plugin-development-guide.md`                     |
| End-user instructions                                          | `docs/user-manual.md`                                           |

Each per-area doc ends with a "Boundaries / Don'ts" section — load the relevant doc before non-trivial edits in that area.

### Keeping docs in sync

Each `docs/*.md` declares the code it describes in front matter (`covers:` globs; `status: snapshot` for dated reviews).

- **Update the covering doc in the same commit** when you change behavior, public names, ownership, or a boundary in its area. `pnpm docs:check --file <path>` tells you which doc that is; the pre-commit hook warns about covered code staged without its doc.
- **After renaming or moving a symbol/file**, grep `docs/` and `src/content/` for the old name.
- **New area or file outside every `covers:` glob?** Add it to the right focused doc's front matter. Never to `docs/architecture.md`: it maps the whole app and keeps `covers: []` on purpose.
- Document invariants, the _why_, and boundaries; name entry-point symbols instead of copying signatures, schemas, file trees, or counts (those are what rot).

## Hard Invariants (always)

- **All model mutations go through commands**, wrapped in `historyStack.tx(label, rec => ...)` (targeted patches) or `historyStack.snapshotTx(label, () => ...)` (full doc snapshot for structural edits). Mutations outside `tx` are reactive but not undoable.
- **`Part` is the only mutation owner inside the model.** Don't touch `VirtualHelix._length`, `OligoSegment.slots`, `StrandSet.segmentIds`, etc. — go through `Part` methods.
- **Topology is keyed by `vh.id`, not `vh.listRow`.** Display reordering / region collapse must not invalidate `SpatialIndexService`. Use `getEntitiesAtVh(vhId, ...)` for identity lookups; `getEntitiesAt(vhRow, ...)` is a thin row adapter.
- **`vh.listRow` is assigned by `Part.syncListRows()`**, not derived. Reorder a region's `vhOrder` (via `reorderVirtualHelixCmd`) and let it rebuild — don't write `vh.listRow` directly.
- **Don't write `vh.latticeCoords` or `vh.localFrame` directly.** Go through region helpers and movement commands.
- **All lab-frame placement comes from `part.getVirtualHelixFrame(vh)`** (3D, RBS, oxDNA export).
- **Reactive collections must be `SvelteSet` / `SvelteMap`.** Plain `Set` / `Map` only inside non-reactive caches.
- **Class files using `$state` / `$derived` must use the `.svelte.ts` extension.** Plain `.ts` is fine for pure logic.
- **All GitHub API calls go through `/api/github/*`.** The OAuth token sits in an httpOnly cookie; client code never reads it.
- **No `localStorage` in the runtime path.** Working copy and GitHub metadata live in IndexedDB via `StorageManager` / `GitHubMetadataStore` / `GitHubExplorerStateStore`.
- **RBS results are transient.** `BlockTransformOverride` is a render-time override only — never persisted.
- **Saves are tab-owner-gated.** `EditorDocumentSession` checks `isTabOwner` before writing; preserve that gate when adding new write paths.

## Editor Session Split

- **`EditorDocumentSession`** (`src/lib/components/Editor/context/EditorDocumentSession.svelte.ts`) — owns `currentDoc`, `historyStack`, `StorageManager`, GitHub metadata, `TabSync`.
- **`EditorViewContext`** (`src/lib/components/Editor/context/EditorViewContext.svelte.ts`) — owns `editorMode`, `strandViewContext`, selection sets (`selectedLatticeVhIndices`, `selectedFreeformVhIndices`), UI controllers, derived `isTabOwner`.

These are wired together but distinct — keep responsibilities on the right side.

## Quick Reference

**Editor modes:** `SELECT | PAN | BREAK | DRAW | SKIP | INSERT | PAINT | MODIFICATION | SEQUENCE`

**Strand-view hit targets (`LeafTarget`):** `END | XOVER | XOVER_SITE | SEGMENT | OLIGO | VH_GRID | VH_TAG | CS_CURSOR | REGION_HEADER | EMPTY`

**Capability flags live on `DesignRegion`, not `Part`** (use instead of `instanceof`): `supportsLatticeGrid`, `supportsConstrainedXoverSites`, `supportsLatticeAutoStaple`. Gate UI/IO on the _active_ region (`editorViewContext.activeRegion`), not on the Part — a Part with a mixed lattice + freeform region set has no honest part-level answer.

**Lattice detection (cadnano import):** by base count — `numBases % 32 === 0` → SQUARE, `% 21 === 0` → HONEYCOMB.

**`isScafToStrandSetIdx(vhIdx, isScaf)`** in `cadnanoJSON.ts` is a **file-format directional adapter only**, not a scaffold-identity check. The `isScaf` argument means "this is the cadnano file's `scaf` slot" (a rendering convention of cadnano2), not "this strand is the design's scaffold". Cadnano IO never reads or writes Foldnano's `Oligo.isScaffold` flag. The parity flip (`even VH: scaf↔strandSet[0]`; `odd VH: scaf↔strandSet[1]`) exists because the model pins `strandSets[0]` to ascending bp and cadnano's `scaf` direction flips with VH parity. See `docs/cadnano-import.md` § Strand/StrandSet index convention.

**Crossover direction:** always 3'→5' — `ThreePrimeEnd.connectTo(FivePrimeEnd)`.

**Plugin formats:** `cadnano_json`, `foldnano_json`, `foldnano_mini` (mutable Python API + replayed mutation log). `live` is reserved and rejected by `validateManifest`.

**Apply strategies:** `previewOnly`, `replacePart[KeepAnnotationsWhereMatched]`, `replaceRegion[KeepAnnotationsWhereMatched]`, `replayMutationLog[InRegion]`. `foldnano_mini` is required for replay strategies; manifest validation enforces this.

## Style

Full guide: `docs/code-style.md`. Highlights:

**Naming (Google TS):**

- `UpperCamelCase` — classes, interfaces, type aliases, enums, Svelte components
- `lowerCamelCase` — variables, functions, methods, parameters, `$state`/`$derived` fields
- `SCREAMING_SNAKE_CASE` — module-level `const` true constants (not reactive)
- `_prefixedName` — private class members
- File names: `kebab-case.ts`, `ComponentName.svelte`, `ClassName.svelte.ts`

**Types:**

- `interface` for object shapes; `type` for unions/intersections
- Never `any` — use `unknown` + narrowing
- Don't annotate types TypeScript can infer; do annotate public method return types
- `readonly` on properties that shouldn't change after construction

**Exports:** named exports everywhere; default exports only for Svelte components and SvelteKit routes.

**Comments:** only when the _why_ is non-obvious (hidden constraint, subtle invariant, workaround). Never describe _what_ the code does. One short line max.

**Formatting** is enforced by Prettier (`pnpm format`) — tabs, single quotes, `trailingComma: "es5"`, `printWidth: 100`. Don't argue about formatting in PRs; run the formatter.

**Doc-site prose (`src/content/**`):** avoid em dashes; they read as an AI-generated tic to readers. Rephrase with a period, comma, colon, semicolon, or parentheses instead — reserve an em dash for the rare case where none of those work. This applies only to the public doc site, not to `docs/\*.md` or this file, which are internal, AI-maintained references and can use em dashes freely.
