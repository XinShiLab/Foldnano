---
covers:
  - src/lib/commands/**
---

# Commands and History

Undoable edits in Foldnano are expressed as command functions that mutate the
live model inside a `HistoryStack` transaction. This document describes the
current command pattern, the patch recorder used by undo/redo, and the command
catalogue in `src/lib/commands/`.

---

## Location

```text
src/lib/commands/
├── history.svelte.ts    # HistoryStack, autosave, tx/snapshotTx
├── historyChanges.ts    # patch recorder, mementos, patch replay
├── historyVerification.ts # replays each tx entry on a scratch copy (tests + opt-in dev)
├── strands.ts           # strand / oligo / sequence / modification commands
├── virtualHelix.ts      # lattice + freeform VH commands
├── virtualHelices.ts    # region-local VH reordering
├── planes.ts            # 3D plane transform commands
├── regions.ts           # region + plane add/remove commands
├── overlays.ts          # external-structure overlay placement commands
└── repeatGroups.ts      # repeat-group definition commands
```

---

## Command Pattern

Commands are plain functions, not classes. The common shape is:

1. Accept typed parameters plus a `HistoryStack`.
2. Mutate the live model only inside `history.tx(...)` or `history.snapshotTx(...)`.
3. Delegate real topology changes to `Part` methods.

```ts
export function someCmd(args: Args, history: HistoryStack): void {
	history.tx('Label', (rec) => {
		args.part.someMutation();
	});
}
```

Use `tx()` when the command can record targeted patches. Use `snapshotTx()` for
broader structural edits where a whole-document snapshot is still the safest
representation.

---

## HistoryStack

**File:** `src/lib/commands/history.svelte.ts`

`HistoryStack` owns:

- `#undo: HistoryEntry[]`
- `#redo: HistoryEntry[]`
- autosave counters and timer state
- the single shared history stream for one editor session

`revision` bumps on every commit, undo and redo (`#markDirty`). Views that derive something
costly from the whole model (the design-check overlay) read it instead of the model, so they
recompute once per edit rather than on every live mutation during a drag.

### History limits

The undo stack is capped by `HistoryLimits` (`DEFAULT_HISTORY_LIMITS`: 100
entries or about 50 MB of entry JSON, whichever comes first;
`setHistoryLimits` changes them). Each entry's JSON length is measured once
when it is recorded; whole-document snapshot entries (auto-staple, add VH,
region edits, repeat groups) dominate it. Beyond either limit the oldest
entries are dropped, always keeping the newest one, and
`droppedEntryCount` counts them. The UI doesn't show undo depth, so nothing
surfaces the truncation yet. JSON length is a proxy: parsed snapshots take
several times that in memory. Converting frequent snapshot commands to
`PartMementoChange` shrinks their entries; lattice VH creation
(`addNewVirtualHelixCmd`) is the most mechanical candidate.

### Transaction APIs

```ts
history.tx(label, (recorder) => { ... })
history.snapshotTx(label, () => { ... })
```

`tx()` creates a `HistoryRecorder`, runs the mutation, then commits only if the
recorded before/after state differs.

`snapshotTx()` captures `before = doc.snapshot()` and `after = doc.snapshot()`
around the mutation and stores a `DocumentSnapshotChange`. `tx()` also takes
`doc.snapshot()` up front, for rollback if the mutation throws.

Document copies use `FoldnanoDocument.snapshot()` (a JSON round-trip of
`toJSON()`), never `$state.snapshot(doc)`: Svelte's server compile, which
Vitest uses, turns `const x = $state.snapshot(y)` into `const x = y`. Before
this was fixed, `snapshotTx()` recorded nothing in tests and `tx()` rollback
restored the already-mutated document.

The legacy `history.tx(fn)` overload still exists and is treated as
`snapshotTx('Unnamed edit', fn)`.

**Repeat-group sync:** both `tx()` and `snapshotTx()` call `syncRepeatGroups(part)`
(`model/Part/repeatGroups.ts`) after the mutation and before recording, to rebuild
mirror oligos whose originals changed; a throw there rolls the edit back like any
other. When the sync changes anything inside a targeted `tx()`, the entry is
recorded as a `DocumentSnapshotChange` (`before` → current) instead of the targeted
patches. Commands in `commands/repeatGroups.ts` edit only group definitions and let
the sync create/remove the mirrors. See `docs/repeat-units.md`.

### Undo / Redo Flow

```text
undoOnce()
  pop #undo
  apply entry.undo patches
  push entry to #redo

redoOnce()
  pop #redo
  apply entry.redo patches
  push entry to #undo
```

Undo and redo both mutate the live document and then call the optional
`onMutation` callback. The editor uses that callback to clear stale strand,
freeform-VH, and lattice-VH selections after history replay.

---

## Recorded Patch Types

**File:** `src/lib/commands/historyChanges.ts`

The recorder emits targeted patch kinds, including:

| Patch type                                   | Purpose                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `FieldChange`                                | Scalar fields such as oligo color, scaffold flag, sequence lock, names, or `vh.localFrame`                          |
| `SlotSeqChange`                              | Per-slot sequence text changes                                                                                      |
| `PartMementoChange`                          | Localized structural restoration of affected VHs, oligos, segments, region ordering, and optional part-level extras |
| `DocumentSnapshotChange`                     | Whole-document fallback for large or awkward edits                                                                  |
| `PlaneTransformChange` / `PlaneAdd`/`Remove` | Undoable transform / add / remove of a persisted `Plane`                                                            |
| `RegionAdd`/`RegionRemove`                   | Undoable add / remove of a `DesignRegion`                                                                           |
| `OverlayPlacementSet`/`Remove`               | Undoable upsert / clear of one external-structure overlay placement (`Part.overlayPlacements`); see `overlays.ts`   |

### `PartScopeCapture`

Many structural commands do not snapshot the entire document. Instead they call
`rec.capturePartScope(part, seed)` and commit a localized memento after the
mutation.

The seed can name affected:

- `vhIndices`
- `oligoIds`
- `segmentIds`
- `includeMaxBase`
- `includeCustomModifications`

On commit, the recorder expands that seed to include newly created or newly
connected entities, then stores:

- affected VH snapshots
- affected oligo snapshots
- affected segment IDs
- `region` JSON, including `vhOrder`
- oligo ordering
- optional `maxBase`
- optional custom modifications

Patch replay rebuilds only that part slice, re-sorts VHs by restored `listRow`,
and then rebuilds the spatial index.

A `tx` may commit several scopes in sequence (e.g. `removeSelection` captures one per
deleted oligo/segment). Redo replays their mementos in commit order; undo replays them in
**reverse** order. A later scope's "before" was captured after earlier scopes had mutated
shared VHs, so replaying it last would overwrite their strandSets and orphan the oligos
the earlier scopes restored.

---

## Autosave

`HistoryStack` owns autosave because it already knows when a transaction
actually committed.

Default config:

```ts
{
  enabled: true,
  editCountThreshold: 10,
  timeIntervalMs: 60_000
}
```

Public API:

- `setAutoSaveConfig(partial)`
- `saveNow()`
- `saveNowIfDirty()`
- `markSaved(time?)`
- `markSaveFailed(message)`
- `restoreLastSaveTime(time)`
- `destroy()`

Reactive UI status lives in `autoSaveStatus`:

```ts
{
  lastSavedTime: number | null,
  hasUnsavedChanges: boolean,
  editsSinceLastSave: number,
  error?: string
}
```

`error` holds the message from the most recent save failure and is cleared on the next successful
save. On failure, `#performAutoSave` reports through `reportError(e, 'autosave', { notify })` (see
`src/lib/errorReporting.ts`) — `notify` is edge-triggered so only the _first_ failure in a run
toasts; repeated failures from a retrying timer stay silent while `error` remains set, and
`SaveStatusIndicator.svelte` reflects it as a distinct failed-save state instead of the normal
amber "unsaved" one. The first failure of a streak also schedules one quick retry
(`AUTOSAVE_RETRY_DELAY_MS`). The optional fifth constructor argument `onSaved` runs after every
successful save; `EditorDocumentSession` uses it to request persistent storage. Banner, close-tab
guard and persistence details: `docs/autosave.md`.

---

## Command Catalogue

### Virtual Helix Commands

**Files:** `virtualHelix.ts`, `virtualHelices.ts`

| Command                                                                     | Description                                                                        |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `addNewVirtualHelixCmd({ part, region, col, row })`                         | Add a lattice VH in a `LatticedDesignRegion`                                       |
| `reorderVirtualHelixCmd(ctx, draggedVhIdx, targetRegionRow)`                | Reorder a VH within its region-local row order                                     |
| `addFreeformVirtualHelixCmd({ part, x, y, z? })`                            | Add a perpendicular freeform VH at an explicit origin                              |
| `fillFreeformVirtualHelixCmd({ part, vh, fillLengthBp? })`                  | Fill both strand sets along a freeform VH                                          |
| `addInPlaneFreeformVirtualHelixCmd({ part, start, end })`                   | Draw an in-plane freeform VH, extend capacity if needed, and fill both strand sets |
| `moveFreeformVirtualHelixCmd({ vh, from, to })`                             | Move or rotate one freeform VH by recording `vh.localFrame`                        |
| `moveFreeformVirtualHelicesCmd({ moves })`                                  | Batch move several freeform VHs                                                    |
| `moveLatticeVirtualHelicesCmd({ part, region, vhIndices, fromTo, bounds })` | Move one constrained lattice selection by recording updated `vh.latticeCoords`     |
| `deleteFreeformVirtualHelicesCmd({ part, vhIndices })`                      | Remove selected freeform VHs while preserving unaffected DNA                       |

`moveLatticeVirtualHelicesCmd(...)` validates the requested delta before
recording history:

- every VH in the batch must share the same lattice delta
- the delta must preserve parity
- the destination cells must stay within the viewer bounds
- occupied targets are allowed only when the occupant is also part of the moving batch

On commit it records `FieldChange` patches for `vh.latticeCoords`, updates the
live model, and invalidates the owning lattice region's cached crossover-site
derivations. Patch replay also invalidates those region caches so undo/redo
restores both the position and the derived constrained-crossover geometry.

### Plane Commands

**File:** `planes.ts`

| Command                                                            | Description                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `transformPlaneCmd(history, part, planeId, before, after, label?)` | Record the committed translation or rotation of a persisted plane |

The 3D gizmo updates plane transforms live with `part.setPlaneTransform(...)`
while dragging, then records a single `PlaneTransformChange` on pointer-up.
`transformPlaneCmd` first rewinds the plane to `before`, then applies `after`
inside its `tx()`, so the transaction itself makes the change (rollback and the
history verifier see the true pre-drag pose).

### Strand / Oligo Commands

**File:** `strands.ts`

| Command                          | Description                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drawStrandCmd`                  | Create one new segment on a VH                                                                                                                        |
| `createCrossoverCmd`             | Join two oligos by connecting 3' to 5'                                                                                                                |
| `makeCrossoverCmd`               | Break source as needed, then create crossover                                                                                                         |
| `breakOligoCmd`                  | Split a segment at one base index                                                                                                                     |
| `moveOligoEndCmd`                | Move one or more termini with collision-aware ordering; slides fully-selected segments as translates (carry sequence + skip/insert), resizes the rest |
| `addSkipOrInsertionCmd`          | Add a skip or insertion at a slot                                                                                                                     |
| `removeSkipOrInsertionCmd`       | Remove a skip or insertion                                                                                                                            |
| `removeOligoCmd`                 | Delete an entire oligo                                                                                                                                |
| `removeSegmentFromOligoCmd`      | Remove one segment from a multi-segment oligo                                                                                                         |
| `fillEmptyVhCmd`                 | Fill one empty strand set on one or more VHs                                                                                                          |
| `autoStapleCmd`                  | Lattice-only auto-staple                                                                                                                              |
| `paintOligoCmd`                  | Recolor one or more oligos                                                                                                                            |
| `toggleOligoAsScaffoldCmd`       | Toggle scaffold state                                                                                                                                 |
| `renameOligoCmd`                 | Set or clear an oligo's optional name label (trimmed; no-op when unchanged; mirrors reject it)                                                        |
| `setModificationCmd`             | Apply or clear end modifications                                                                                                                      |
| `fillRandomSequenceToOligoCmd`   | Random sequence for an oligo; pass `onlyEmpty: true` to skip already-filled slots                                                                     |
| `fillRandomSequenceToSegmentCmd` | Random sequence for one segment; `onlyEmpty` supported                                                                                                |
| `fillSequenceToOligoCmd`         | Explicit sequence for an oligo; `onlyEmpty` skips non-N slots and compacts the input across empty positions                                           |
| `fillSequenceToSegmentCmd`       | Explicit sequence for one segment; `onlyEmpty` supported                                                                                              |
| `clearOligoSequenceCmd`          | Clear one oligo's sequence                                                                                                                            |
| `clearSegmentSequenceCmd`        | Clear one segment's sequence                                                                                                                          |
| `clearPartSequenceCmd`           | Clear all sequences in a part                                                                                                                         |

---

## Batch Semantics

Several strand commands accept either one parameter object or an array. The main
batch-sensitive case is `moveOligoEndCmd`.

### Translate vs resize

`moveOligoEndCmd` splits its batch by segment into two kinds of move:

- **Translate** — both ends of a segment are moving by the same delta (a
  body-drag slide). Delegated to `Part.translateOligoSegments`, which shifts
  every slot's `bpIndex` by that delta instead of clearing and reinitializing
  it — sequence and skip/insert content moves with the strand, and skip/insert
  state is mirrored onto the complementary strand at the new position.
- **Resize** — only one end of a segment is moving (a single-terminus drag).
  Delegated per end to `moveOligoTerminusTo`, which keeps the original
  semantics: slot content whose `bpIndex` falls outside the segment's new
  range is dropped, newly-covered positions are filled with blank `'N'` slots.

Segments in the same translate batch that are each other's **complementary-
strand partner** (e.g. both strands of a duplex dragged together) or
**crossover partner** (both sides of a connection dragged together) are
recognized as moving in lockstep — their skip/insert pairing, or their shared
crossover bp, is preserved automatically since both sides shift by the same
delta, with no cross-segment mutation needed between them.

A segment with a constrained (crossover-connected) end can only translate when
its partner is _also_ in the batch, translating by the same delta — otherwise
the crossover invariant (both ends always share one bp) can't be preserved
without moving something the user didn't select. If that segment has a
skip/insert that the resize fallback would silently clip, `moveOligoEndCmd`
throws `InvalidOperationError` instead of dropping it; the drag preview
(`canBatchMoveByDelta` in `movingEndsOps.ts`) applies the same eligibility
check so the UI never offers a position that would only fail on commit.

### Collision-aware ordering

To reduce self-collisions inside one drag commit:

- rightward moves run rightmost-first
- leftward moves run leftmost-first
- mixed batches execute right movers, then stationary, then left movers

This keeps one move in the batch from blocking another that should still be
valid under the original layout. `Part.translateOligoSegments` applies the same
principle at segment granularity (and, within one segment, orders its own two
ends so a delta larger than the segment's length doesn't spuriously trip the
five≤three / five≥three direction check against a not-yet-moved end).

---

## When Snapshot Transactions Are Still Used

Not every command uses fine-grained patch recording yet.

`snapshotTx()` is still used for commands where the implementation is simpler or
safer with a full document snapshot, including:

- lattice VH creation
- some freeform VH creation flows
- auto-staple

The current model is therefore mixed:

- targeted field / slot / memento patches for most routine edits
- document snapshots for a smaller set of broad structural operations

That split is intentional and reflects the present implementation, not an
outdated transition state.

The catalog above also includes region-level edits (`addRegionAndPlaneCmd`,
`removeRegionAndPlaneCmd` from `regions.ts`) — they are snapshot-style because
they touch many derived caches at once.

---

## Verifying Undo / Redo

Targeted `tx()` entries are only correct if the command's `capturePartScope`
seed (and its `rec.field` / `rec.slot` calls) name everything it mutates, and
caches like the spatial index are only correct if every mutation path updates
them. Three checks catch a miss:

- **History verifier** (`historyVerification.ts`). After each `tx()` commit,
  `HistoryStack` passes the before/after snapshots and the entry to
  `verifyHistoryEntry`. It rebuilds a scratch document from the post-edit
  snapshot, applies the entry's undo and compares with the pre-edit snapshot,
  then applies redo and compares with the post-edit one. The live document is
  never touched. A mismatch throws `History entry "<label>" does not
round-trip…`. It is on whenever `import.meta.env.MODE === 'test'`, so every
  spec that runs a command also checks it; enable it in dev with
  `VITE_VERIFY_UNDO=true`. Production never runs it. Entries that are
  whole-document snapshots are skipped (they restore everything by
  construction). Comparison goes through `canonicalSnapshot`, which ignores
  object key order, `virtualHelices` array order (display order is `listRow`)
  and `strandSets[].segmentIds` order.
- **Derived-state check** (`findDerivedStateMismatch`, same flag). After every
  committed edit (`tx` and `snapshotTx`), undo and redo, `HistoryStack`
  checks that `segmentsLookup` and `segment.oligo` match `part.oligos`, and
  that the live spatial index matches one rebuilt from scratch
  (`SpatialIndexService.rebuildFromOligos`) at every VH, strand and bp. A
  mismatch throws `Derived state is stale after …`. This is the dev-mode
  spatial-index assertion (`ARCH P2-3`); undo/redo replay is where stale
  caches used to hide.
- **Round-trip harness** (`undoRoundTrip.spec.ts`, helpers in
  `test/undoRoundTrip.ts`). `expectUndoRoundTrip(doc, history, edit)` runs one
  edit, then undoes and redoes it twice on the live document, checking the
  canonical snapshot after every step (the derived-state check runs inside
  `HistoryStack`). The spec has one case per
  exported `*Cmd` and fails when a command has no case. It also runs seeded
  random edits on the designs in `test_files/fn_designs/`, including checking
  that rejected edits leave the document untouched.

**Every new command needs a case in `undoRoundTrip.spec.ts`**; the coverage
test enforces it.

---

## Boundaries / Don'ts

- **Never mutate the model outside `tx` / `snapshotTx`.** Reactive UI updates will fire, but the change is silently lost from undo/redo and from any patch-based replay. If a live preview already mutated the model (e.g. a plane drag), rewind it before the `tx` and re-apply inside, as `transformPlaneCmd` does.
- **Don't copy the document with `$state.snapshot(doc)`.** Use `doc.snapshot()`; in the server compile Vitest uses, `const x = $state.snapshot(y)` is just `const x = y`.
- **Don't add a command without a case in `undoRoundTrip.spec.ts`.** The coverage test fails, and the case is what exercises its capture seed.
- **Don't silence the history verifier's error.** It means the capture seed misses something; widen the seed (see how `moveOligoEndCmd` adds complementary segments for resizes) rather than switching the command to `snapshotTx`.
- **Don't reach into `Part` private fields from a command** (`_virtualHelices`, `_spatialIndex`, etc.). Use the documented `Part` methods so caches stay consistent.
- **Don't record a per-frame patch from a live drag.** Drag handlers update the live model for preview only; commit one command on pointer-up.
- **Don't record patches for transient UI state.** Selection, hover, and mode toggles are not part of `HistoryStack` — they live on `EditorViewContext`.
- **Don't use `snapshotTx` for routine field edits.** It serializes the whole document into the undo entry; prefer `tx` + `FieldChange` / `SlotSeqChange` / `PartMementoChange`.
- **Reuse a single `PartScopeCapture` per `tx`.** Calling `rec.capturePartScope` twice for overlapping seeds is fine, but make sure the seed actually names everything you mutate, including newly created VHs/oligos/segments.
- **Don't run `markSaved()` after an aborted save.** It clears `editsSinceLastSave` and `hasUnsavedChanges` — call it only after the storage write resolves.
- **Don't call `Part.translateOligoSegments` once per segment in a loop.** It must see the whole batch at once — it resolves every segment's complementary-strand and crossover partners while positions are still pristine, before any segment in the batch has moved, then plans cross-segment slot mutations as deferred thunks and applies them only after every segment has shifted. Looping it per segment reintroduces exactly the bug it exists to avoid: a segment processed later sees its partner's already-moved (wrong) position, which either corrupts a duplex/crossover pairing or spuriously blocks a valid move.
- **When adding a new segment-position-mutating command, don't reach for the plain `SegmentEnd.index` setter inside a multi-end operation.** It schedules `OligoSegment.updateSlotsAfterEndMove()` (via a microtask, synchronously in Vitest) as a side effect, which will run against a partially-updated segment if you haven't moved every relevant end yet. Use `SegmentEnd.moveIndexWithoutSlotSync(newIndex)` for multi-end operations and resync slots yourself once all ends have settled — see `Part.translateOligoSegments` for the pattern.
