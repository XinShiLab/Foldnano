---
covers:
  - src/lib/model/Part/**
  - src/lib/model/Oligo/**
  - src/lib/model/VirtualHelix/**
  - src/lib/model/document.svelte.ts
  - src/lib/model/documentFormat.ts
  - static/schemas/foldnano-v*.schema.json
  - src/lib/model/modifications.ts
---

# DNA Model

This document describes the current domain model in `src/lib/model/`. The core
change since the older single-lattice design is that every `Part` now owns
first-class `Plane` and `DesignRegion` objects, while still remaining the sole
owner of DNA topology and mutations.

---

## Overview

```text
FoldnanoDocument
└── Part[]
    ├── Plane[]
    ├── DesignRegion[]
    ├── VirtualHelix[]
    │   └── StrandSet[2]
    │       └── segmentIds: SvelteSet<string>
    ├── Oligo (SvelteSet)
    │   └── OligoSegment (SvelteSet)
    │       ├── FivePrimeEnd
    │       ├── ThreePrimeEnd
    │       └── Slot[]
    ├── segmentsLookup: Map<string, OligoSegment>
    └── SpatialIndexService
```

Rules that still define the model:

- `Part` is the only mutation owner.
- Oligos and segments are part-global, not region-owned.
- Cross-region topology is legal because regions describe placement, not DNA
  ownership.
- `StrandSet` stores segment IDs, not segment references.

---

## FoldnanoDocument

**File:** `src/lib/model/document.svelte.ts`

`FoldnanoDocument` is the serialization root.

Key fields:

- `id`
- `name`
- `parts: Part[]`

Saved JSON (`DocSnapshot`) also carries a format header: `format: 'foldnano'`,
`formatVersion`, and `savedWith: { app, commit }`. See "Serialization And Migration".

Key methods:

- `toJSON()`
- `snapshot()`: detached deep copy of `toJSON()` (a JSON round-trip). Use it, not
  `$state.snapshot(doc)`, whenever correctness depends on a real copy (history
  before/after states, rollback, autosave). `$state.snapshot` is only a copy in the
  client compile. In Svelte's server compile, which Vitest uses for `.svelte.ts`
  files, `const x = $state.snapshot(y)` becomes `const x = y`, so the "copy" is the
  live document and changes along with it. That made `snapshotTx()` record nothing
  in tests and `tx()` rollback restore the already-edited document. `snapshot()`
  copies in every compile mode, and since `toJSON()` is the save format, the JSON
  round-trip loses nothing. See `commands-and-history.md` and
  `reactivity-patterns.md`.
- `fromJSON()`
- `restore(snapshot)`
- `addNewPart('HONEYCOMB' | 'SQUARE' | 'FREEFORM')`

The model supports multiple parts, although most editor flows still operate on
the first active part.

---

## Part

**File:** `src/lib/model/Part/Part.svelte.ts`

`Part` owns:

- all `VirtualHelix` instances
- all `Oligo` instances
- all segment lookup / spatial indexing state
- all persisted `Plane` objects
- all persisted `DesignRegion` objects

It does **not** assume one geometry model anymore. Instead, it delegates
placement and lattice behavior through regions.

### Core fields

| Field                                   | Purpose                                       |
| --------------------------------------- | --------------------------------------------- |
| `planes`                                | persisted base planes in lab coordinates      |
| `regions`                               | placement/editing rules for subsets of VHs    |
| `_virtualHelices`                       | all VHs in the part                           |
| `oligos`                                | all oligos in the part                        |
| `repeatGroups`                          | repeat groups (mirror copies); see below      |
| `segmentsLookup`                        | authoritative `segmentId -> OligoSegment` map |
| `_spatialIndex`                         | O(1) VH/strand/bp lookup cache                |
| `_vhById`, `_vhByIndex`, `_vhByListRow` | lookup maps maintained by `syncListRows()`    |

### Capability flags

UI and exporters use capability flags instead of `instanceof` checks. The flags live on `DesignRegion` (see below), not on `Part` — a mixed part with both lattice and freeform regions has no honest part-level answer, so callers gate on the _active_ region (`editorViewContext.activeRegion`):

| Getter                          | Meaning                         |
| ------------------------------- | ------------------------------- |
| `supportsLatticeGrid`           | show lattice plane editor       |
| `supportsConstrainedXoverSites` | show constrained xover overlays |
| `supportsLatticeAutoStaple`     | allow auto-staple               |

`DesignRegion` (and `FreeformRegion`) return `false` for all three; `LatticedDesignRegion` (and its `HoneycombRegion` / `SquareRegion` subclasses) return `true`. Cadnano import/export is gated the same way, by checking whether the active region is a lattice region (e.g. `Toolbar.svelte`'s `activeLatticeRegion`), not by a dedicated capability getter.

### Geometry entry point

External geometry consumers should call:

```ts
part.getVirtualHelixFrame(vh): VirtualHelixFrame
```

This delegates to `part.getRegionForVh(vh).getVirtualHelixFrame(vh)`.

That indirection is now the canonical way to obtain lab-frame helix placement
for:

- `View3D`
- rigid-body simulation setup
- oxDNA export
- freeform and lattice viewers

### Region-aware row order

`vh.listRow` is still present, but it is no longer "array position equals row".
`Part.syncListRows()` flattens region-local `vhOrder` into one display order:

1. walk `part.regions` in order
2. walk each region's `vhOrder`
3. assign `vh.regionId`
4. **assign** `vh.listRow` (this is a write, not a getter — `listRow` is plain `$state`)
5. rebuild lookup maps (`_vhById`, `_vhByIndex`, `_vhByListRow`)

`listRow` is therefore a _display_ coordinate, not stable model identity. VH identity comes from `vh.id` (uuid) or `vh.index` (cadnano-style integer). Never write `vh.listRow` directly; reorder a region's `vhOrder` (via `reorderVirtualHelixCmd`) and let `syncListRows()` rebuild.

### Current compatibility getters

`Part.step`, `Part.subStepSize`, and `Part.maxBase` currently proxy through the
default region when regions are present. In the current UI that still behaves
like a part-wide setting, but the underlying storage now lives at region level.

---

## Plane

**File:** `src/lib/model/Part/Plane.svelte.ts`

A `Plane` is a persisted coordinate frame:

```ts
{
	(id, name, origin, u, v, normal);
}
```

Key methods:

- `transformPoint(local)`
- `transformVector(local)`
- `transformFrame(localFrame)`
- `toJSON()`
- `fromJSON()`

Planes are edited from the 3D view. While dragging, the scene updates through
`part.setPlaneTransform(...)`; on commit, history records a `PlaneTransform`.

### Plane creation

Planes are always named with the pattern `Plane N`, where `N` is one greater
than the highest trailing integer found among existing plane names
(`Part.nextPlaneName()`). The pattern survives plane deletion: removing
`Plane 2` from `[Plane 1, Plane 2, Plane 3]` and adding a new one yields
`Plane 4`, not a duplicate `Plane 2`. The first plane created during part
initialization (`_createDefaultPlane()`) follows this same pattern — it is
named `Plane 1` rather than carrying a basis-axis label like `XY Plane`.

Plane creation goes through one of:

| Entry point                                     | When                                                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Part._createDefaultPlane()`                    | called from `Part.initializeDefaultPlaneAndRegion()` to bootstrap the first plane of a new part                                                                                                    |
| `EditorViewContext.confirmRegionCreation()`     | user adds a new region to an existing part; creates a plane oriented to a chosen basis axis (`XY` / `XZ` / `YZ` via `BASIS_PLANE_TRANSFORMS`) and pairs it with a region in `addRegionAndPlaneCmd` |
| `EditorViewContext.addPlaneBasedOnSelected()`   | user duplicates the currently selected plane's transform                                                                                                                                           |
| `EditorViewContext.addPlaneFromAxisPlane(axis)` | user adds a plane oriented to a basis axis without a region                                                                                                                                        |
| `EditorViewContext.loadCadnanoAsRegion(...)`    | cadnano import into a new region of an existing part                                                                                                                                               |

Plane geometry (origin / u / v / normal) is independent of the name: a plane
called `Plane 1` may carry any orientation. `BASIS_PLANE_TRANSFORMS` only
supplies the _initial_ transform for axis-aligned creations and does not affect
naming.

---

## DesignRegion

**File:** `src/lib/model/Part/DesignRegion.ts`

A `DesignRegion` describes how a subset of VHs should be interpreted and drawn.

Common fields:

- `id`
- `name`
- `kind: 'HONEYCOMB' | 'SQUARE' | 'FREEFORM'`
- `planeId`
- `vhOrder: string[]`
- `step`
- `subStepSize`
- `maxBase`

Common responsibilities:

- map region-local placement to lab-frame VH frames
- define adjacency and constrained crossover rules when applicable
- define region-local row order
- define default VH length / step for that region

Concrete types:

- `HoneycombRegion`
- `SquareRegion`
- `FreeformRegion`

### LatticedDesignRegion

`LatticedDesignRegion` adds:

- lattice coordinate helpers
- adjacency calculation
- `potentialXoverSites(vhIdx)`
- `addVhAtCoords(part, col, row)`
- region-local lattice frame generation via `getHelixXY(...)`

### FreeformRegion

`FreeformRegion` does not derive position from lattice coordinates. It expects
its VHs to carry explicit `localFrame` data.

### DesignRegion creation

Region names follow the pattern `KIND Region N` (e.g. `HONEYCOMB Region 1`,
`FREEFORM Region 2`), assigned by `Part.nextRegionName(kind)`. Numbering is
per-kind and survives deletion the same way `nextPlaneName()` does — it scans
existing regions of that kind, takes the max trailing integer, and increments.

Region creation flows:

| Entry point                                                 | When                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Part._createDefaultRegion(kind, planeId, opts)`            | called from `Part.initializeDefaultPlaneAndRegion()` during part bootstrap. Constructs the concrete `HoneycombRegion` / `SquareRegion` / `FreeformRegion` for the kind and seeds `vhOrder` from the part's existing VHs.                          |
| `Part.initializeDefaultPlaneAndRegion(kind, opts)`          | one-shot bootstrap for a new part: creates the default plane, the default region, attaches any pre-existing VHs (`vh.regionId == null` → bound to the new region), and calls `syncListRows()`. No-op if the part already has any plane or region. |
| `EditorViewContext.confirmRegionCreation()`                 | user adds a region of `pendingRegionKind` on a basis-axis plane to an existing part. Creates a fresh `Plane` + region pair and applies them atomically through `addRegionAndPlaneCmd`.                                                            |
| `EditorViewContext.loadCadnanoAsRegion(cadnano, basePlane)` | cadnano import: if the part exists, builds a new plane on the chosen basis axis and calls `cadnano.toRegionInPart(part, plane)`; otherwise creates the part from cadnano and orients its default plane to the chosen basis.                       |

`DesignRegion` instances are created detached and must be wired into the part
via `region.attachToPart(part)` before being added to `part.regions`. The
`addRegionAndPlaneCmd` / `addPlaneCmd` commands handle this and ensure undo /
redo records both the plane and the region together when applicable.

A part is never expected to be without a region at runtime. Bootstrapping
goes through `initializeDefaultPlaneAndRegion()` (called from `Part.forType()`)
so that the first plane and the first region exist together before any UI sees
the part.

---

## VirtualHelix

**File:** `src/lib/model/VirtualHelix/VirtualHelix.svelte.ts`

```text
VirtualHelix
├── id
├── index
├── listRow
├── regionId?
├── latticeCoords?
├── localFrame?
├── length
├── inPart
└── strandSets: [StrandSet, StrandSet]
```

Important changes:

- `localFrame` replaced the older freeform-only `frame` naming.
- `regionId` is now first-class persisted state.
- `latticeCoords` are still used for lattice regions, but they are now
  interpreted as region-local placement data.

Key methods:

- `toJSON()`
- `fromJSON(json, part)`
- `createNewSegment(fivePrimeIdx, threePrimeIdx)`
- `removeSegment(segment)`

### Parity

Parity is still derived from `latticeCoords` for lattice VHs:

```ts
vh.isEvenParity;
vh.isOddParity;
vh.scaffoldStrandIndex;
```

Freeform VHs do not have lattice parity and will throw if parity helpers are
used without `latticeCoords`.

**Lattice coords are assumed non-negative.** Parity is `row % 2 === col % 2`, and
the Python plugin API (`MutableVirtualHelix.parity_is_even`) uses the same
expression. `%` differs for negatives (JS `-1 % 2 === -1`, Python `-1 % 2 == 1`),
so a negative coord would give the two runtimes different parity, and different
scaffold strands and crossover sites. Nothing in the model enforces this today
(`LatticedDesignRegion.addVhAtCoords` takes any integer). If negative coords ever
become possible, switch both sides to a sign-safe parity (e.g. `((row + col) % 2 + 2) % 2 === 0`).

---

## StrandSet

**File:** `src/lib/model/VirtualHelix/StrandSet.svelte.ts`

`StrandSet` stores only segment IDs:

```text
StrandSet
├── ownerVh
├── strandIndex: 0 | 1
└── segmentIds: SvelteSet<string>
```

Segments are resolved through `part.segmentsLookup`.

Paths that create oligos or segments take the caller's ids when given (`createOligo` opts, `breakOligoAt`'s `newOligoId` / `newSegmentId`, `removeSegmentFromOligo`'s `newOligoId`): `foldnano_mini` replay names everything it creates, so later ops in the same log can refer to it.

Any path that destroys a segment must also `part.unregisterSegment` it (e.g. `Oligo.removeEndSegment`, used by the adjacent-end merge `SegmentEnd.mergeTo`); a stale entry makes undo/redo throw when it re-registers the id.

Important helpers:

- `isIndexOccupied(index)`
- `isRangeOccupied(start, end)`
- `isRangeOccupiedBy(start, end)`
- `mergedIntervals`
- `getSegmentEndIndices()`

The merged-interval cache is still used to make occupancy checks cheap.

---

## Oligo And OligoSegment

**Files:** `src/lib/model/Oligo/*`

`Oligo` is still the routed DNA strand object. It owns a `SvelteSet` of
`OligoSegment`s and exposes convenience getters like `fivePrime`, `threePrime`,
and `allEnds`.

`OligoSegment` remains the atomic routed segment:

```text
OligoSegment
├── id
├── inPart
├── inVirtualHelix
├── fivePrime
├── threePrime
├── slots
└── inStrandIndex
```

Slots still hold:

- sequence text
- skip / insertion information
- per-base sequence assignment state

Crossovers still connect `ThreePrimeEnd` to `FivePrimeEnd`.

**Every segment spans at least 2 bp.** A segment's strand is never stored:
`inStrandIndex` derives it from direction (5' < 3' → strand 0), so a 1-bp
segment (5' = 3') would read as strand 1 whichever strand it is on, and on
reload it would be registered on both. 1-nt strands aren't a valid design
element anyway. `VirtualHelix.createNewSegment` rejects them, and end moves are
gated by `keepsSegmentDirection` (in `SegmentEnd.canMoveTo` and the drag
preview's `canBatchMoveByDelta`), which rejects an end landing on its
segment's other end.

### Repeat groups and mirror oligos

`Oligo.repeatGroupId` marks the originals of a `Part.repeatGroups` entry;
`Oligo.mirrorOf` marks a **mirror**: a real oligo that is a derived copy of an
original shifted by a repeat instance's bp offset, rebuilt by `syncRepeatGroups`
at the end of every history transaction. Mirrors can't be edited directly
(`Part` guards break / connect / remove), and exports and oligo lists use
`Part.realOligos`. Full design: `docs/repeat-units.md`.

### Moving a segment: resize vs translate

`Part` owns two distinct ways to change a segment's endpoints, and they treat
slot content differently:

- `moveOligoTerminusTo(end, toIdx)` — moves **one** end (a resize/stretch).
  Slot content whose `bpIndex` falls outside the segment's new range is
  dropped; newly-covered positions start as blank `'N'` slots, then
  `updateSlotsAfterEndMove()` immediately calls `fillNsFromComplementary()`,
  which auto-fills each new `'N'` from the reverse-complement of whatever the
  complementary strand already has there. This is safe to do silently because
  it only ever fills a slot that had **no** prior content — there's no
  competing, previously-authored value to choose between.
- `translateOligoSegments(moves)` — moves a **batch** of whole segments (both
  ends of each, by the same delta — a body-drag slide). Every slot's
  `bpIndex` shifts by that delta instead, so sequence and skip/insert content
  moves with the strand rather than being clipped and reinitialized. Unlike
  the resize path, translate never calls `fillNsFromComplementary()` and never
  writes to the complementary strand's sequence (skip/insert state is still
  mirrored there, same as `addSkipOrInsertion` does — that invariant stays
  hard). The moved strand's own already-authored bases are preserved exactly
  as they were; if that now conflicts with the stationary complementary
  strand's already-authored bases, both sides are **left as-is** rather than
  either being silently overwritten — see Sequence mismatch detection below
  for why.

`translateOligoSegments` takes the _whole_ batch of moving segments at once,
not one segment at a time, because it needs to resolve each segment's
complementary-strand partner (same VH, other strand — for skip/insert
mirroring) and crossover partner (different VH, connected end) while every
position in the batch is still pristine. Segments that are each other's
partner and are translating by the same delta are treated as moving in
lockstep — their pairing (skip/insert alignment, or a shared crossover bp) is
preserved automatically with no mutation between them, since both sides shift
identically. A constrained (crossover-connected) end is only accepted here
when its partner is in the same batch, translating by the same delta;
otherwise the crossover invariant (both ends always share one bp) can't be
preserved without moving something outside the batch, so the whole translate
is rejected. See `docs/commands-and-history.md` § Batch Semantics for how
`moveOligoEndCmd` decides which path a given move takes, and its Boundaries
section for why this can't be called in a per-segment loop.

### Sequence mismatch detection

Sequence text is a soft, unvalidated property everywhere in this model — no
mutation path checks that two complementary bases are actually Watson-Crick
paired. A translate can leave a carried base mismatched against a
complementary strand that didn't move (see above), and by design the model
does not try to auto-resolve that: doing so would mean silently picking a
side (overwrite the strand that moved, or overwrite the one that didn't)
between two values a person deliberately assigned. There's no way to infer
which one is "wrong" from the model alone, so instead of guessing, the tool
surfaces the conflict and lets the person decide which strand to fix.

`OligoSegment.mismatchedBps(): number[]` is a read-only, advisory query (not a
validation gate — nothing throws or blocks on its result) that flags plain
single-base slots (`seq.length === 1`, excluding skip/insert and unassigned
`'N'`) whose complementary slot is also assigned and not Watson-Crick
complementary. It's consumed by the StrandView's mismatch-warning overlay
(`docs/editor-strand-viewer.md`) and by the post-translate warning toast in
`movingEndsOps.ts` — both are UI affordances for finding and fixing mismatches
manually, not model-level enforcement.

### OligoID vs OligoKey

An `Oligo` has two identifiers with different stability guarantees:

|                                          | `oligo.id` (OligoID)                                                                                                           | OligoKey                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| **Format**                               | UUID v4 string                                                                                                                 | `oligo-<8 hex chars>`             |
| **Stable within a session**              | Yes                                                                                                                            | Yes, unless structure changes     |
| **Stable across re-import of same file** | Only for `.fn.json` (serialized and restored); regenerated when importing from formats that don't carry it (e.g. cadnano JSON) | Yes — derived from structure      |
| **Stable across edits**                  | Yes — survives end moves, recoloring                                                                                           | No — any endpoint move changes it |
| **Source**                               | `Oligo.svelte.ts`                                                                                                              | `src/lib/model/Oligo/oligoKey.ts` |

**OligoID** is the runtime identity token. All internal code — commands, hit system, undo/redo, plugin ops — uses OligoID. Use `part.getOligoById(id)` to look up an oligo. This is the right identifier for anything that must survive editing.

**OligoKey** is a content-addressed hash of the oligo's structural signature: the ordered list of `vhIdx[bpIdx]>vhIdx[bpIdx]` segment spans. It is stable across different imports of the same design file, which makes it useful for cross-import comparison (oligo report diff page). It changes whenever segment endpoints move, so it is unsuitable as a user-visible or persistent reference in the live editor.

The key is computed via `buildOligoSignature(oligo)` + `formatOligoKey(signature)` from `oligoKey.ts`. `oligoReport.ts` imports from there; no other runtime path should need it.

---

## Spatial Index

**Files:** `Part/SpatialIndexService.ts`, `Part/Part.svelte.ts`

The spatial index no longer keys on `(listRow, strandIdx, bpIdx)`. It now keys
on VH identity plus strand/bp:

```text
vhId -> Map(strand/bp packed key -> segment)
vhId -> Map(strand/bp packed key -> SegmentEnd[])
segmentId -> oligo
```

Important consequence:

- reordering visible strand rows or collapsing regions no longer invalidates the
  topology cache
- view layout and topology are now decoupled

`Part` exposes both:

- `getEntitiesAt(vhRow, strandIdx, bpIdx)` for row-based view code
- `getEntitiesAtVh(vhId, strandIdx, bpIdx)` for identity-based lookups

See `docs/spatial-index.md` for more detail.

---

## Part Is A Single Class

There is no `LatticedPart`/`HoneycombPart`/`SquarePart`/`FreeformPart` class hierarchy — `Part` (`Part.svelte.ts`) is the only concrete `Part` class. Lattice vs. freeform behavior lives entirely on the region (`DesignRegion` / `LatticedDesignRegion` / `HoneycombRegion` / `SquareRegion` / `FreeformRegion`, see above), so a single part can hold both kinds of region at once.

`Part.autoStaple()` iterates `part.regions` and calls `region.autoStaple()` on each `LatticedDesignRegion`; `Part.autoStapleRegion(regionId)` targets one region and throws if it isn't a lattice region. Freeform placement is expressed through `vh.localFrame`, not lattice coords.

---

## Serialization And Migration

### Document format version

**File:** `src/lib/model/documentFormat.ts`

The public contract for the file (field meanings, units, compatibility promise) is the doc-site
page `src/content/contributors/09-file-format.md`, backed by the JSON Schema
`static/schemas/foldnano-v<N>.schema.json`. `DocumentSchema.spec.ts` validates the fixtures and
a document exercising every optional field against it; the schema rejects unknown fields, so any
new `toJSON()` field fails the test until the schema, page and version move together. Don't
restate field lists here; this section covers the mechanics.

Every saved document starts with a header written by `FoldnanoDocument.toJSON()`:

- `format: 'foldnano'`: a fixed tag, so file-open can tell Foldnano JSON from other formats
- `formatVersion`: an integer, `CURRENT_FORMAT_VERSION`; the only field load logic reads
- `savedWith: { app, commit }`: provenance for bug reports and papers' supplementary data;
  never branch on it

`FoldnanoDocument.fromJSON()` accepts `unknown` and runs `migrateDocumentJson()` first, so
every load path (IndexedDB, GitHub open/pull, file import, undo restore) is checked. It:

1. treats a missing `formatVersion` as version 1 (files saved before versioning)
2. refuses a version newer than `CURRENT_FORMAT_VERSION` with a `DocumentFormatError`
   (`reason: 'too-new'`) whose message is safe to show the user as-is
3. refuses malformed input (wrong `format` tag, non-integer version, no `parts`) with
   `reason: 'malformed'`
4. runs `MIGRATIONS[n]` (version n → n + 1) in order up to the current version

Paths that write raw JSON to IndexedDB before calling `fromJSON` (GitHub open in
`EditorDocumentSession.loadDocumentFromGitHub`, `GitHubStorageProvider.pullDocument`) call
`migrateDocumentJson()` themselves first, so a too-new file never overwrites the local copy.

Why an integer, not a timestamp or commit hash: the version must be ordered (to detect
"newer than this app"), key the migration registry, and change only when the format does.
A hash has no order; a save timestamp or build hash would change on every save or deploy and
add noise to users' git diffs.

**Bumping the version.** Bump when an older app would misread the JSON _or silently drop
part of it on re-save_, which includes adding new fields: the too-new refusal is what stops an
old tab from erasing data it doesn't know about. Then:

1. increment `CURRENT_FORMAT_VERSION`
2. add `MIGRATIONS[old]` (pure JSON → JSON; don't touch model classes)
3. save a fixture `test_files/fixtures/document_format/v<new>.fn.json`; keep the older
   fixtures, they are the proof old files still load (`DocumentFormat.spec.ts` enforces one
   fixture per version and one migration per step)
4. add `static/schemas/foldnano-v<new>.schema.json` (keep the old ones) and update the contract
   page, including its schema table

The `??` backfills inside `Part.fromJSON()` / `Oligo.fromJSON()` / `DesignRegion.fromJSON()`
predate versioning. Leave them in place for version 1; new format changes go in `MIGRATIONS`.

### Part JSON

Current persisted part JSON includes:

- `planes`
- `regions`
- `virtualHelices`
- `oligos` (with optional `repeatGroupId` / `mirrorOf`, written only when set)
- optional `customModifications`
- optional `repeatGroups`

There is no backward-compat loader for pre-region documents: `Part.fromJSON()` throws (`'Document predates region schema; not supported'`) if `planes`, `regions`, or `virtualHelices` is missing from the JSON. Every `.fn.json` document on disk is expected to already carry the plane/region schema.

`Part.fromJSON()` does still backfill a couple of older-but-still-region-schema fields for forward compatibility within the current schema:

- `customModifications` entries saved before modifications had colors (only `.symbol`) get a deterministic `.color` backfilled via `hashNameToColor()`
- `overlayPlacements` saved before duplicate-file support get `sourceKey` defaulted to `id`

---

## Boundaries / Don'ts

- **Don't change the saved JSON shape without bumping `formatVersion`** and adding a migration and fixture (see "Document format version"). New fields count: an older app drops them on re-save.
- **Don't branch on `savedWith`.** It is provenance only; `formatVersion` is the sole compatibility signal.

- **Don't mutate the model outside a command.** Wrap every mutation in `historyStack.tx(...)` (targeted patches) or `historyStack.snapshotTx(...)` (whole-doc snapshot). Direct mutations are reactive but won't undo.
- **Don't bypass `Part`.** All segment create/connect/break/move/remove operations go through `Part` methods so `segmentsLookup` and `SpatialIndexService` stay in sync.
- **Don't write to `vh.listRow` directly** — change region order or `vhOrder`, then `Part.syncListRows()` propagates.
- **Don't write to `vh.latticeCoords` directly** — go through region helpers (`addVhAtCoords`, `moveLatticeVirtualHelicesCmd`). Lattice geometry is owned by `LatticedDesignRegion`.
- **Don't store segment references in `StrandSet`.** It stores `segmentIds: SvelteSet<string>`; resolve through `part.segmentsLookup`.
- **Don't read parity helpers (`isEvenParity`, `scaffoldStrandIndex`) on freeform VHs** — they require `latticeCoords` and will throw.
- **Don't bypass `part.getVirtualHelixFrame(vh)`** for lab-frame placement. It is the only entry point that handles both lattice and freeform regions correctly (also used by 3D, RBS, oxDNA export).
- **Use `SvelteSet`/`SvelteMap`** for any model-side collection that participates in reactivity. Plain `Set`/`Map` is fine only inside non-reactive caches (e.g. some inner `SpatialIndexService` maps — see `spatial-index.md`).
- **Class files using `$state` / `$derived` must use `.svelte.ts`.** Otherwise the runes compile to plain function calls and explode at runtime.
- **Don't call `translateOligoSegments` with one segment at a time.** Pass the whole moving batch in a single call — see "Moving a segment: resize vs translate" above and `commands-and-history.md`'s Boundaries section.
- **Don't create or allow a 1-bp segment.** Its strand can't be derived (see "Oligo And OligoSegment"). New end-move or segment-creating paths must reject 5' = 3', e.g. via `keepsSegmentDirection`; don't loosen that check to `<=`.
- **Don't set `SegmentEnd.index` directly inside a routine that moves more than one end before resyncing slots.** The setter schedules `OligoSegment.updateSlotsAfterEndMove()` as a side effect and will run against a half-updated segment. Use `moveIndexWithoutSlotSync` and resync explicitly once every end has settled.

## Related

- `spatial-index.md` — the O(1) hit-test cache keyed by `vhId`
- `reactivity-patterns.md` — runes inside classes, snapshot semantics
- `commands-and-history.md` — how mutations get into the model
- `cadnano-import.md` — the lattice-only import path
