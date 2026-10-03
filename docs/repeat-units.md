---
covers:
  - src/lib/model/Part/repeatGroups.ts
  - src/lib/model/Part/duplicateOffsets.ts
  - src/lib/commands/repeatGroups.ts
  - src/lib/canvasEditor/tools/duplicate.ts
  - src/lib/components/Editor/ToolPanel/RepeatGroupPanel.svelte
  - src/lib/components/Editor/StrandView/temporalLayer/DuplicatePreview.svelte
---

# Repeat Units (Duplicate + Mirror Oligos)

Design doc for representing repetitive DNA structures (tile/SST tubes, origami
that assembles with identical copies of itself) by **literally repeating the
structure in the design**, with the copies marked as linked "mirror oligos".

Status: Feature 1 (Duplicate) and Feature 2 (mirror oligos, including 3D styling
and export filtering) are **implemented**. Rigid-body simulation needs no changes
(mirrors are real topology).

Supersedes an earlier Repeat Bond approach, which was prototyped on a separate branch and
abandoned without being merged (see "Why not Repeat Bonds" below).

Reference design: `test_files/fn_designs/10hb_tube.fn.json` (one unit).

---

## Features and order

1. **Duplicate selection** — copy whole selected oligos into the design as
   independent real oligos, offset along the helix axis. Interactive placement
   (preview, move left/right, confirm).
2. **Mirror (linked) duplicate** — same placement flow, but the copies are
   marked as mirrors of their originals and kept in sync automatically.
3. Mirrors can only be made from real oligos, never from other mirrors.
4. 3D renders mirrors translucent / grey.
5. Rigid-body simulation runs on the whole structure including mirrors.
6. Export and the oligo list only include real oligos (with an opt-in to
   include copies for oxDNA / mrDNA).

---

## Why not Repeat Bonds

Repeat Bonds modeled the neighboring copy as a derived rigid transform fitted
from two sticky-end sites, rendered as a 3D ghost. The model never knew the copy
existed. That fails for interlocking tile designs (e.g. SST tubes), where a
strand in unit _n_ pairs with strands from units _n−1_ and _n+1_: the user needs
to see, draw against, collision-check, and sequence-pair across the unit
boundary. Putting the copies into the design makes all of that native.

---

## Core decision: mirrors are materialized

Mirror oligos are **real `Oligo` / `OligoSegment` objects** living in the
`StrandSet`s, tagged as mirrors, and **regenerated from their original** — not a
derived render-only view.

Rationale: almost every subsystem reads `StrandSet`s / `part.oligos`:
occupancy (`SegmentEnd.canMoveTo`), `SpatialIndexService` and hit testing,
crossover-site computation, the complementary-strand skip/insert invariant,
complement sequence fill, `mismatchedBps()`, `buildScene` (3D),
`buildBlocksAndConstraints` (RBS), and the simulation NT model. A derived-only
mirror would need a parallel code path in each of them — the same trap Repeat
Bonds fell into. Materialized mirrors get all of that for free; the new work is
confined to:

- blocking direct edits on mirrors,
- excluding mirrors from export / oligo list,
- the regeneration step.

A mirror still carries **no independent information** semantically — its
content is always `original + offset`; it is just cached as real objects.

---

## Data model

### Feature 1 (Duplicate)

No new persisted data. Duplicated oligos are ordinary oligos with fresh ids.

Implementation (reuse these for Feature 2):

- `Oligo/cloneOligoJson.ts` — `cloneOligoJsonWithOffset`: whole-oligo JSON copy with
  fresh ids, remapped internal crossovers, shifted ends and slots.
- `Part.canDuplicateOligosBy(oligos, delta)` → `DuplicateCheck` (`{ ok }` or
  `{ ok: false, reason }`) — the single validator for preview and command.
- `Part.duplicateOligos(oligos, delta)` — grows regions, adds copies, mirrors copied
  skips/insertions onto existing complementary strands.
- `Part.hasMatchingXoverSiteAt(end, idx)` — shared with the drag-move validator
  (`movingEndsOps.canBatchMoveByDelta`); checks positions past the VH end `step`s back.
- `Part/duplicateOffsets.ts` — `duplicateSnapStep` (LCM of region steps),
  `findNextValidDuplicateDelta`.
- `commands/strands.ts` — `duplicateOligosCmd` (`snapshotTx`, since it may grow a region).
- `canvasEditor/tools/duplicate.ts` — `DuplicateTool` (DUPLICATE mode);
  `strandActions.startDuplicate` enters it; `StrandView/temporalLayer/DuplicatePreview.svelte`
  draws the ghost; state is `strandViewContext.duplicateState` (`$state.raw`, cleared on
  undo/redo replay).

Skip/insert rule for a copied slot at its new bp: if a copy lands opposite it, both
slot lengths must match; otherwise an existing complementary slot must be plain (a
copied skip/insertion is mirrored onto it), and a copied skip/insertion with no
complementary strand at all is rejected.

### Repeat groups (Feature 2)

**Files:** `Part/Part.svelte.ts` (types, `Part.repeatGroups`, guards),
`Oligo/Oligo.svelte.ts` (`repeatGroupId`, `mirrorOf`), `Part/repeatGroups.ts`
(fingerprints, sync, group operations), `commands/repeatGroups.ts`.

```ts
interface RepeatInstance {
	id: string;
	bpOffset: number;
	vhMap?: Record<string, string>; // reserved for lateral (VH→VH) repeats; unused in v1
}
interface RepeatGroup {
	id: string;
	name: string; // "Repeat 1", "Repeat 2", …
	instances: RepeatInstance[];
}
// Part.repeatGroups: RepeatGroup[]           — persisted only when non-empty
// Oligo.repeatGroupId: string | null         — set on originals
// Oligo.mirrorOf: MirrorTag | null           — set on mirrors
interface MirrorTag {
	groupId: string;
	instanceId: string;
	sourceOligoId: string;
	structure: string; // shift-normalized structural fingerprint at generation
}
```

**Membership lives on the oligo**, not as a list of source ids on the group:
oligo ids change on break / crossover / ligation, so a flag that travels with
the oligo is the stable anchor. Rule 3 (no mirror of a mirror) falls out:
sources are never mirrors.

**Persistence:** groups, `repeatGroupId` and `mirrorOf` are serialized only
when set, so files without repeat groups are byte-identical to before. Mirrors
themselves are persisted as ordinary oligos (load path and undo snapshots are
unchanged).

### Membership rules

| Edit on an original                     | Effect                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| Break                                   | Both halves stay originals (`Oligo.breakOligoAt` copies the id) |
| Split by VH deletion                    | Pieces keep `repeatGroupId` / `mirrorOf`                        |
| Delete                                  | Its mirrors are removed by the sync                             |
| Ligate / crossover to a non-group oligo | The resulting oligo joins the group                             |
| Ligate / crossover across two groups    | **Rejected**                                                    |
| Ligate / crossover to a mirror          | **Rejected** (mirrors are immutable)                            |

The join rules live in `Part.connectTwoOligos` / `connectSegmentEnds`.
Mixed units are expected: boundary/edge strands can stay ordinary oligos
alongside group sources.

---

## Offsets and placement

Placement is shared by Feature 1 and Feature 2: select whole oligos → preview
the copy at the first valid offset to the right → move left/right → confirm.
Segments always stay on the same VH; only the bp position changes.

- **Snap:** the offset moves in multiples of the region `step` (21 bp
  honeycomb/freeform, 32 bp square; LCM across regions). That keeps lattice
  crossovers on valid sites and keeps freeform copies in helical phase. `Shift`
  allows any bp offset.
- **Grab:** the preview follows the pointer only once the pointer reaches it
  (its rows × bp range, padded), and lets go when the pointer leaves its rows.
- **Collision / validity:** `Part.canDuplicateOligosBy` (see the Feature 1
  section); the preview turns red with the reason and confirm is refused.
- **VH length:** copies past a region's end grow it by whole steps in the same
  transaction.
- **Linked placement** (`DuplicateState.linked`): `Cmd/Ctrl+Shift+D`, the
  "Duplicate as linked mirror copies" button, or a group's **Add copy**. On
  confirm it creates a group (selection has no grouped oligo) or adds an instance
  (selection is exactly one group's originals); any other mix is refused.

---

## Mirror regeneration (sync)

`syncRepeatGroups(part)` runs from `HistoryStack` at the end of **every**
`tx` / `snapshotTx`, after the edit and before the entry is recorded:

1. Mirrors whose group, instance or source is gone (or whose source left the
   group) are removed.
2. For each remaining mirror, compare shift-normalized fingerprints
   (`oligoFingerprint(oligo, bpShift, withSequence)`: positions, crossovers,
   slot lengths, end modifications, color, name, scaffold flag):
   - mirror structure ≠ its `tag.structure` **and** source structure unchanged
     → the mirror was edited directly → throw `MIRROR_EDIT_ERROR`;
   - mirror and source fully equal (with sequence) → keep as is;
   - otherwise (source changed, or only the mirror's sequence changed) → remove
     and rebuild.
3. Rebuild instance by instance with `canDuplicateOligosBy` +
   `duplicateOligos`, so each instance validates against copies placed before
   it. A failure throws "Copy N of <group>: <reason>", and the `tx` restores the
   pre-edit document.

Cost is O(oligos) to find group members plus O(nt) of the group's originals
for fingerprints; unchanged mirrors keep their object identity. Parts without
groups return immediately.

**History recording:** a targeted `tx` whose sync changed anything is recorded
as a `documentSnapshot(before, after)` instead of its targeted patches (`before`
is already captured at the start of `tx`), so the sync never has to express
itself as patches. Undo/redo replay does not sync; restored state is consistent.

`Part._repeatSyncing` is set while the sync runs; outside it,
`Part.breakOligoAt`, `removeOligo`, `connectTwoOligos` and `connectSegmentEnds`
refuse to touch a mirror.

No manual "rebuild" button: mirrors occupy positions, so stale mirrors would make
collision checks, 3D, RBS and mismatch markers describe a design that doesn't
exist.

---

## Editing rules for mirrors

- **Selection:** `EndSelection.set/add` replaces any mirror end with every end
  of its original, so a mirror can't be selected, dragged or deleted by itself.
- **Structural edits** (position, crossovers, skips/inserts, modifications,
  color, deletion, joins) → rejected: "Mirror oligos can't be edited. Edit the
  original instead." Adding a skip on a real strand opposite a mirror is
  rejected the same way; add it on the original side.
- **Sequence-only writes** into a mirror (e.g. complement fill from a real
  strand) are silently reverted by the rebuild.
- Drawing a real strand onto positions a mirror occupies is blocked by normal
  occupancy checks.

---

## Sequences

- A mirror's sequence is always its source's sequence (periodic by
  construction).
- **The original's sequence never changes because of a mirror.** Complement
  fill may write _into a real segment_ from a complementary mirror, but writes
  into a mirror are reverted, never forwarded to its source.
- Conflicts show as mismatches via the existing `OligoSegment.mismatchedBps()` +
  `StrandView/MismatchMarkers.svelte` (red rung, `warningContext.mismatch`).

---

## Rendering, RBS, export

- **Strand view:** mirror strands and crossovers are drawn at
  `MIRROR_OPACITY` (`StrandView/drawingContext.ts`).
- **Strand-view SVG export:** each mirror oligo's strands and crossovers are
  wrapped in `<g class="mirror-oligo" opacity="MIRROR_OPACITY">` (`exportSvg.ts`),
  which Preview and Illustrator honor.
- **3D:** `helixGeometry.ts` adds `oligo.isMirror` to each site's `dim` flag, so
  mirrors keep their oligo color but render translucent (NT tubes likewise, via
  `segmentVisuals.mirror`). Don't route them through `highlightDim`, which also
  greys the color. The NT model still includes them (`buildSimulationNtModel`
  `includeMirrors` defaults to true).
- **RBS:** mirrors are real topology; `buildBlocksAndConstraints` is unchanged.
- **Oligo report, sequence CSV, scaffold maps, sequence panel:** `Part.realOligos`.
- **Cadnano export:** mirror segments are skipped per VH strand.
- **oxDNA / mrDNA:** `includeMirrors` (default false); the 3D Export menu shows
  "Include mirror copies" when the part has mirrors, exporting the assembled
  multimer.
- **Plugins** see mirrors as ordinary oligos carrying `mirrorOf`. A
  `replacePart` apply drops group data — known v1 limitation.

---

## Repeat group panel

`ToolPanel/RepeatGroupPanel.svelte`, inside the Select tool panel when the part
has groups. Per group: originals count, one chip per copy (offset, remove ✕),
**Select originals**, **Add copy** (linked placement for that group),
**Detach** (mirrors become independent oligos, group dissolved), **Delete**
(mirrors removed; originals stay as normal oligos). Removing the last copy
deletes the group.

---

## Boundaries / Don'ts

- **Don't add a derived-only mirror path** to occupancy, hit testing, 3D, RBS,
  or sequence code. Mirrors are materialized; keep them flowing through the
  normal model.
- **Don't anchor mirrors on oligo ids alone.** Membership is `Oligo.repeatGroupId`,
  carried through break / split / join; `mirrorOf.sourceOligoId` is re-derived by
  the sync whenever a source is rebuilt.
- **Don't create oligos from an original without carrying `repeatGroupId`** (new
  split/join paths in `Part` must copy it, like `breakOligoAt` does).
- **Don't write to a mirror outside `syncRepeatGroups`.** The Part guards key off
  `_repeatSyncing`; don't set it elsewhere.
- **Don't let a mirror write to its source** (sequence, geometry, or anything
  else). Sync is strictly source → mirror.
- **Don't regenerate mirrors outside the edit's `tx`** — undo would desync.
- **Don't rebuild mirrors that are up to date** — the sync compares fingerprints
  and only rebuilds mirrors whose source (or own sequence) changed; unchanged
  mirrors must keep their object identity.
- **Don't allow collisions to persist** — reject the edit instead.
- **Don't export mirrors** as independent strands (staple lists, cadnano); they
  are the same molecules as their sources. New exporters and oligo lists should
  iterate `part.realOligos`, not `part.oligos`.
- **Don't allow mirrors of mirrors.**
