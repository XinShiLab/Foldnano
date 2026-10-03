---
covers:
  - src/lib/components/Editor/View3D/externalStructureOverlay*.ts
  - src/lib/components/Editor/View3D/pdbOverlay.ts
  - src/lib/components/Editor/View3D/overlayInstance.ts
  - src/lib/components/Editor/View3D/overlayTransform.ts
  - src/lib/components/Editor/View3D/gizmoDragController.ts
  - src/lib/commands/overlays.ts
  - src/lib/components/Editor/ToolPanel/View3DOverlayPanel.svelte
---

# Editor — 3D External Structure Overlay

The 3D view can render **external structures** — mrDNA results or PDB proteins —
as non-editable reference overlays in the same lab-frame Three.js scene as the
design. The same structure can be placed **multiple times** (Duplicate); each
copy moves independently with its own gizmo. It is a visualization aid only: the
overlay's **geometry is never persisted** (reload the page and you re-drop the
file). The exception is each **PDB instance's placement**, which is remembered so
re-dropping the file restores every copy in its saved pose.

> This is the **import** direction. Don't confuse it with `mrdna-export.md`
> (design → mrDNA input) — here a coordinate dump is loaded **back in** and drawn
> on top of the design. The two share the mrDNA `.txt` format but are separate
> code paths.

It lives entirely in the view layer; the only model touchpoint is the optional
`Part.overlayPlacements` field (placement memory, below).

---

## Source files

```text
src/lib/components/Editor/
├── View3D/
│   ├── externalStructureOverlay.ts          # IR (union) + mrDNA .txt parser
│   ├── pdbOverlay.ts                         # PDB .pdb parser (Cα, segments, Å→nm)
│   ├── externalStructureOverlayGeometry.ts   # IR → THREE.Group (per format, + ghost)
│   ├── overlayInstance.ts                    # OverlayInstance (one placed copy)
│   ├── overlayTransform.ts                   # placement transform + helpers
│   ├── gizmoDragController.ts                # GizmoTarget abstraction (plane vs overlay)
│   └── View3D.svelte                         # render effects, gizmo wiring
├── ToolPanel/View3DOverlayPanel.svelte       # drop zone + controls
└── HelixView/HelixViewer.svelte              # toolbar controller + load/reset handlers
```

Model side: `Part.overlayPlacements` in `src/lib/model/Part/Part.svelte.ts`.

---

## Data model (IR)

`externalStructureOverlay.ts` defines a format-agnostic shape. A `BaseOverlay`
(`id`, `name`, `bounds`) is shared; topology + `stats` are format-specific via a
discriminated union on `format`:

```ts
type ExternalStructureOverlay = MrdnaOverlay | PdbOverlay;
```

- **`MrdnaOverlay`** — `nodes`, `chainEdges` (5′→3′ backbone), `stackEdges`,
  `threePrimeTerminalIds`; `stats` = nucleotide / strand / stack counts.
- **`PdbOverlay`** — `pdbId?` (RCSB accession), `chains: PdbChain[]`;
  `stats` = chain / residue counts.
  - `PdbChain = { id: string; segments: Vec3[][] }` — each chain's Cα backbone in
    nm, split into **contiguous segments**. Bonds are drawn only _within_ a
    segment, so chain breaks never connect with false bonds (see PDB parser).

All positions are in **nm**, matching the design's physical geometry.

### Runtime instances (`overlayInstance.ts`)

The parsed IR (`data`) is immutable and **shared between duplicates**. Each placed
copy is an `OverlayInstance`:

```ts
interface OverlayInstance {
	id: string; // unique per copy
	sourceKey: string; // pdbId ?? filename ('' for mrDNA → session-only)
	data: ExternalStructureOverlay; // shared
	transform: OverlayTransform;
	ghost: boolean;
	visible: boolean;
}
```

The toolbar controller holds `overlays: OverlayInstance[]` and
`activeOverlayId: string | null` (which copy the gizmo edits). `show3DOverlays`
is a global master toggle gating every instance.

---

## Pipeline

```text
.txt  --parseMrdnaOverlay--\
                            >--  ExternalStructureOverlay  --buildExternalStructureOverlayGroup-->  THREE.Group
.pdb  --parsePdbOverlay----/                                  (switch on overlay.format)
```

1. **Load** — `View3DOverlayPanel.svelte` (in `ToolPanel/`) hosts the file drop
   zone (`accept=".txt,.pdb,…"`). On drop, `HelixViewer.svelte`'s
   `onLoadOverlay(file)` picks the parser by extension (`.pdb` → `parsePdbOverlay`,
   else `parseMrdnaOverlay`), then **rehydrates** instances from any saved
   placements (or creates one — see Remembered placement) and flips
   `show3DOverlays = true`. Parse failures surface as a toast
   (`MrdnaOverlayParseError` / `PdbOverlayParseError`).
2. **Parse** — produces the IR (below).
3. **Build geometry** — `buildExternalStructureOverlayGroup(overlay, ghost)`
   dispatches on `overlay.format` and returns a self-contained `THREE.Group`.
4. **Render** — `View3D.svelte` adds the group to the scene and manages it with a
   set of split `$effect`s (below), so common interactions never rebuild GPU
   buffers.

---

## Parsers

### mrDNA (`externalStructureOverlay.ts`)

Whitespace rows: `x y z bp_idx stack_on_three_prime_idx three_prime_idx [base] [9× orientation]`.
`#`/blank lines are skipped, indices validated against the row count, `-1` = none.
`strandCount` walks the 3′ links, counting both linear strands (5′ terminals) and
circular components.

### PDB (`pdbOverlay.ts`)

Fixed-column parse of `ATOM` records — name cols 13–16, altLoc 17, chainID 22,
resSeq 23–26, x/y/z 31–54 (1-based). Scope and rules:

- **Cα only**, **first model only** (stops at `ENDMDL`), blank/`A` altLoc only.
- Coordinates scaled **Å → nm (×0.1)**.
- **`pdbId`** read from the `HEADER` record, cols 63–66 (e.g. `6J6J`), if present.
- **Segmenting:** within a chain a new segment starts on a `TER` record or a
  residue-sequence discontinuity (`resSeq` not consecutive — gap, reset, or
  chain-ID reuse). This is what prevents false long bonds.

> `PDBLoader` (three's loader) is **not** used: it exposes only position + element
> and discards atom names and chain IDs, so it can't drive a Cα trace. The custom
> parser is small and gives us segments + `pdbId`.

---

## Geometry (`externalStructureOverlayGeometry.ts`)

`buildExternalStructureOverlayGroup(overlay, ghost)` is a `switch (overlay.format)`
dispatcher:

- **mrDNA** — instanced NT dots (tinted by base), fat `LineSegments2` for chain +
  stack edges, instanced 3′ terminal cones, faint dotted bounds box.
- **PDB** — one `LineSegments2` polyline per chain (distinct palette color),
  connecting consecutive Cα **within each segment**, with a `MAX_CA_BOND_NM`
  (0.5 nm) distance backstop that drops any pair too far apart to be a real
  Cα–Cα bond. Plus the bounds box.

### Ghost (semi-transparent) mode

When `overlayGhost` is on, the builder recolors everything **grey + translucent**
(`GHOST_COLOR ≈ 0xb0b0b0`, line opacity ~0.25), matching the main model's
"dimmed when selected" look. It is a per-overlay toggle (resets on load). Because
instanced dots use per-instance colors, ghost is applied by **rebuilding** the
group rather than mutating materials — a deliberate, infrequent action.

---

## Render effects (`View3D.svelte`)

View3D keeps one `THREE.Group` per instance in a non-reactive
`Map<id, { group, data, ghost }>`, governed by split effects so common toggles
don't rebuild geometry:

- **reconcile** — for each instance build a group (or **rebuild** when its `ghost`
  or `data` changed); dispose + remove groups whose instance id is gone. This
  effect tracks `overlays` and each instance's `ghost` only — never `transform` or
  `visible`.
- **transform + visibility** — per instance, apply `transform` to its group and set
  `group.visible = show3DOverlays && instance.visible`. No rebuild.
- **placement-restore** — for each PDB instance, apply its stored placement (or
  identity) onto `instance.transform` when `overlays` or `Part.overlayPlacements`
  change, so load / undo / redo reposition every copy. The write is `untrack`ed and
  skips the instance currently being dragged.
- **gizmo visibility + pose** — the **single owner** of
  `transformGizmo.group.visible` (`activeOverlay() || planeActive`) and gizmo pose
  sync. Plane-cleanup effects must not write gizmo visibility.

So a Hide/Show toggle, a gizmo drag, and a ghost toggle each touch only what they
need, per instance.

### Instance reconcile (`HelixViewer.svelte`)

`overlays` is **not** the source of truth for PDB instances — `part.overlayPlacements`
is. A reconcile `$effect` in `HelixViewer` keeps the live list in sync with the
persisted placements + a session cache of parsed structures
(`loadedSources: SvelteMap<sourceKey, data>`): it **adds** a live instance for any
placement with loaded data that isn't live yet, and **removes** any PDB instance
whose placement is gone. It runs on load, undo, and redo — so add / duplicate /
remove can flow purely through `snapshotTx` and stay undo/redo-consistent (the
restore effect alone could only fix transforms, not existence). mrDNA instances
(`sourceKey === ''`) are session-only and never reconciled.

---

## Placement (free, gizmo-driven, per instance)

Each instance carries its own standalone `transform` (`overlayTransform.ts`:
`{ position, quaternion }`) — **not** linked to a persisted `Plane`. The live
transform is view state, mutated in place on the shared reactive instance object.

Movement reuses the plane gizmo via a small abstraction in `gizmoDragController.ts`.
The drag math runs in `PlaneTransform` terms; the edit **target** is behind a
`GizmoTarget` interface:

- `PlaneGizmoTarget` — persisted design plane; `commit()` records `transformPlaneCmd`.
- `OverlayGizmoTarget` — writes the active instance's `transform` live; `commit()`
  calls back to persist its final pose (PDB only — see below).

`View3D` binds the gizmo to the **active instance** (`activeOverlayId`), else to a
selected plane. Overlay placement and plane selection are **mutually exclusive**
(the active overlay wins; clicking a plane clears `activeOverlayId`). Rotate vs.
translate is the shared 3D-toolbar `gizmoMode`, also exposed on the active card.

### Remembered placement (PDB only)

So re-dropping a PDB restores every copy in its pose, each instance's **placement**
— not the geometry — is persisted in the model:

- `Part.overlayPlacements: { id, sourceKey, transform }[]` — optional field, same
  backward-compatible `length > 0 ? … : undefined` pattern as `customModifications`.
  `id` is per-instance; `sourceKey` links copies of one structure. Serialized in
  `Part.toJSON` → **foldnano_json only** (cadnano / oxDNA / mrDNA untouched). Old
  files (entries without `sourceKey`) migrate in `fromJSON` with `sourceKey = id`.
- **`sourceKey`** = `overlayPlacementKey(data)`: the PDB accession (`pdbId`) when
  present, else the filename. mrDNA instances have `sourceKey === ''` and are
  **never** remembered (session-only).
- **All structural ops are undoable, via targeted patches.** Add (first load),
  Duplicate, Move (gizmo release), Reset, and Remove each go through
  `setOverlayPlacementCmd` / `clearOverlayPlacementCmd` (`commands/overlays.ts`),
  which record a single `OverlayPlacementSet`/`Remove` patch through
  `historyStack.tx(…)` — **not** a full-document `snapshotTx`. Undoable + autosaved
  on the history-driven 10-edit / 60-s schedule.
- **The live list is not mutated directly for PDB** — the reconcile effect derives
  it from the placements, so undo/redo add/remove/restore copies faithfully (no
  live-vs-model divergence).
- **Rehydrate** — on (re)load, the structure is cached and the reconcile effect
  recreates one instance per saved placement (or a first placement is created if none
  exist).

---

## Panel controls (`View3DOverlayPanel.svelte`)

A global **Show all / Hide all** master (`show3DOverlays`) sits above a
**scrolling** list (`max-h-[50vh]`) of one card per instance. To keep the floating
panel short with many copies, each card is **collapsed** to a single row — a
name (click to select) + a Hide/Show icon — and **only the selected (active) card
expands** its full controls. Selecting a card sets `activeOverlayId` (gizmo on);
selecting it again collapses it (gizmo off). The active card is outlined.

The expanded card shows format-specific `stats`, the rotate/translate `gizmoMode`
toggle, and:

- **Ghost** — toggles this instance's `ghost`.
- **Duplicate** — places another copy of this structure (offset, persisted, made
  active to move immediately).
- **Reset** — returns this copy to identity (and persists identity).
- **Frame** — fits the camera to this copy's **transformed** bounds.
- **Clear** — removes this copy and forgets its saved placement.

Above the drop zone, a **Saved overlay positions** hint lists any PDB sources that
have remembered placements (`part.overlayPlacements`) but no loaded instance this
session (`pendingSources`), prompting the user to re-drop the matching file.

---

## Current limits

Intentional MVP boundaries (open items tracked in `docs/code_review/todo/beta-release-checklist.md`):

- **No geometry sharing.** Each instance builds its own group — fine for Cα traces;
  revisit (shared geometry / instancing) for many copies of large all-atom structures.
- **Pending placements aren't rendered until re-dropped.** Saved placements whose
  PDB hasn't been loaded this session don't render — the panel only **lists** them
  (key + count) as a hint to drop the matching file.
- **PDB = Cα trace only.** No ball-and-stick / cartoon, no mmCIF. Ball-and-stick
  would use `PDBLoader`'s atom/bond geometry; cartoon needs custom spline geometry.
- **Main-thread build.** `buildExternalStructureOverlayGroup` runs synchronously in
  the reactive effect. Fine for Cα-only / small files; large all-atom structures
  should move to a Web Worker (cf. `rbsWorker.ts`).

---

## Boundaries / Don'ts

- **Don't persist the overlay's geometry.** The parsed nodes/chains are render-only
  — never feed them into `part`, history, or storage. The _only_ persisted piece is
  the lightweight per-instance placement record (`Part.overlayPlacements`, keyed by
  `id` + `sourceKey`); the file itself is re-dropped each session.
- **Share `data` between duplicates; keep everything else per-instance.** Duplicating
  copies the `data` reference, not the geometry; `id`/`transform`/`ghost`/`visible`
  are per copy.
- **Keep `transformGizmo.group.visible` single-owner.** Only the "gizmo visibility +
  pose" effect writes it (`overlayActive || planeActive`). Plane-cleanup effects clear
  hover/selection only — if they also write visibility, overlay Move loses its gizmo.
- **Don't draw bonds across PDB segment boundaries.** Connect Cα only within a
  `PdbChain` segment; keep the `MAX_CA_BOND_NM` distance backstop.
- **Keep the effect split.** Hide/Show is visibility-only; ghost rebuilds; placement
  is transform-only. Don't collapse them into one effect that rebuilds on every toggle.
- **mrDNA placement stays session-only.** `overlayPlacementKey` returns `null` for
  mrDNA; never persist it.
