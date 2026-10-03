---
covers:
  - src/lib/components/Editor/View3D/**
  - src/lib/model/geometry3d/**
  - src/lib/components/Editor/ToolPanel/View3DPanel.svelte
---

# Editor - 3D View

The 3D view renders the current part in lab coordinates using Three.js. It is
the only viewer that fully applies region plane transforms, and it now also
hosts direct plane editing with a translate/rotate gizmo.

---

## Location

```text
src/lib/components/Editor/View3D/
├── View3D.svelte            # scene lifecycle, pointer handling, RBS, exports
├── View3DTools.svelte       # active-viewer toolbar for 3D
├── sceneSetup.ts            # renderer, camera, controls, resize handling
├── helixGeometry.ts         # part -> Three.js geometry
├── coordinateAxis.ts        # optional world-axis helper
├── planeOverlay.ts          # plane quads for persisted Plane objects
├── externalStructureOverlay.ts          # overlay IR (union) + mrDNA .txt parser
├── pdbOverlay.ts                        # PDB .pdb parser (Cα trace, Å->nm)
├── externalStructureOverlayGeometry.ts  # overlay IR -> Three.js group (per format)
├── overlayTransform.ts                  # transient placement transform helpers
├── transformGizmo.ts        # translate / rotate gizmo
├── view3DToolbarState.ts    # toolbar enable/disable state
└── rbs/
    └── rbsWorker.ts         # worker-backed rigid-body simulation
```

---

## Core Data Flow

The 3D scene is built from:

- `part.getVirtualHelixFrame(vh)` for lab-frame VH placement
- oligo / segment topology from `part.oligos`
- optional simulation overrides from rigid-body relaxation
- optional stress coloring derived from the simulation constraint map

This is the key point where the newer plane/region model matters:

- `PlaneViewer` edits region-local 2D layouts
- `View3D` shows the fully transformed 3D result

---

## Physical Geometry

All geometry in the 3D view uses physical (oxDNA v2) constants defined in
`src/lib/model/geometry3d/dnaGeometry.ts`:

| Constant             | Value    | Used for                                          |
| -------------------- | -------- | ------------------------------------------------- |
| `BACKBONE_RISE_NM`   | 0.332 nm | axial rise per bp along helix axis                |
| `BACKBONE_RADIUS_NM` | 0.852 nm | radial offset of strand tubes from helix axis     |
| `SQ_INTERHELIX_NM`   | 2.215 nm | square-lattice helix centre-to-centre distance    |
| `HEX_INTERHELIX_NM`  | 2.172 nm | honeycomb-lattice helix centre-to-centre distance |

These are the same values used by the NT model and oxDNA exporter, so the 3D
view, the RBS, and the exported `.dat` file all share identical helix positions.

### NT Model Toggle

The "Show NT Model" toolbar button replaces the strand polylines with a
nucleotide-resolution overlay. It does **not** reposition helices — the regular
3D geometry is already at physical spacing.

NT mode renders a soft, watercolor-style DNA illustration (via `addNtModelGeometry`
in `helixGeometry.ts`):

| Element        | Geometry                                                                  | Position                        | Color                              |
| -------------- | ------------------------------------------------------------------------- | ------------------------------- | ---------------------------------- |
| Backbone tube  | `TubeGeometry` along a `CatmullRomCurve3` (`NT_TUBE_RADIUS_NM = 0.28 nm`) | backbone points of a strand run | softened oligo color (pastel wash) |
| Base-pair rung | `Line2` fat line (`RUNG_LINE_WIDTH`)                                      | between paired backbone points  | two-tone by base pair (see below)  |

The backbone tubes use a **fresnel translucent ShaderMaterial**
(`ntWatercolorMaterial.ts`): the colour washes toward white in the interior and
gathers into an "ink" rim at the silhouette, so each sugar-phosphate strand of the
double helix reads as a delicate 2D illustration while staying a rotatable 3D
surface. Per-NT dots / base ticks / 3′ cones from the old representation are gone.

**Rung colour reflects the sequence.** Complementary nucleotides are grouped by
`pairKey`; each pair draws one rung tinted by pair type — A·T (`RUNG_COLOR_AT`,
soft amber) vs G·C (`RUNG_COLOR_GC`, soft teal). When neither partner has an
**assigned** base (`SimulationNucleotide.baseAssigned`), the rung falls back to
pale gray (`RUNG_COLOR_UNASSIGNED`) — so a design with no sequence shows all-gray
rungs. Crossover arcs are softened to `NT_CROSSOVER_OPACITY` in this mode.

---

## What It Renders

Base DNA scene:

- ghost helix cylinders
- VH labels
- strand polylines
- crossover curves
- modification-tag beads at modified termini (colored via `getModificationColor`, dimmed with the rest of the site when highlighted-out/unselected)
- optional cursor rings and markers

Optional scene helpers:

- coordinate axis helper
- persisted plane overlays
- transform gizmo for the selected plane

Optional simulation overlays:

- relaxed segment positions
- crossover stress coloring

---

## Viewer Controls

`View3DTools.svelte` exposes four tool groups.

### View

- show/hide helix cylinders and labels
- show/hide insert/skip physical effects
- show/hide cross-section cursor
- show/hide coordinate axis
- show/hide persisted planes
- reset camera

### Selection

- filter the render to only selected 2D strand segments
- optionally lock the current filtered segment set

Filtering is segment-based and comes from the strand-view end selection. Ghost
helix cylinders are never filtered out.

### RBS

- run or re-run rigid-body simulation (Relax / Re-relax / Stop; the group is labelled "RBS" so it stays distinct from any future MD tool)
- toggle relaxed positions
- toggle stress coloring
- clear relaxed results
- edit solver parameters

### Export

- image download
- GLB export
- oxDNA export

---

## Plane Overlay And Gizmo

This is the biggest recent addition.

### Plane overlay

`planeOverlay.ts` renders a selectable quad for each persisted `part.planes`
entry.

When `showPlanes` is enabled:

- the overlay group is visible
- clicking a plane selects it
- clicking empty space clears the selection

The selected plane ID is stored in the 3D toolbar controller and reflected in
the tool panel.

### Transform gizmo

When a plane is selected, `transformGizmo.ts` shows either:

- rotate handles
- translate handles

depending on `gizmoMode`.

Live drag behavior:

1. pointer-down on a gizmo handle creates a drag state
2. `part.setPlaneTransform(...)` is applied continuously during pointer move
3. the plane overlay and scene update live
4. pointer-up records one `transformPlaneCmd(...)`

So plane motion is previewed live but committed as one undoable edit.

---

## Coordinate Axis

The optional coordinate axis is a world-space orientation aid created by
`coordinateAxis.ts`.

It is separate from persisted design planes:

- axis helper: viewer-only orientation reference
- plane overlay: real model objects stored in `part.planes`

The axis helper can be shown without showing editable planes, and vice versa.

---

## External Structure Overlay

The 3D view can load an **external structure** (mrDNA `.txt` or PDB `.pdb`) and
render it as a non-editable, repositionable reference overlay in the same scene
as the design. This is a self-contained subsystem with its own parsers, geometry
dispatcher, gizmo placement, and (PDB-only) placement persistence.

**See `docs/editor-3d-external-overlay.md`** for the full feature doc — IR,
parsers, geometry, ghost mode, gizmo placement, and remembered placement.

---

## Rigid-Body Simulation

Simulation flow:

1. build blocks and constraints from the current part
2. run the solver in `rbsWorker.ts` when available
3. fall back to local simulation if worker startup fails
4. convert block transforms into per-segment overrides
5. rebuild the scene using those overrides

Important state:

- `simOverrides`
- `simStressMap`
- `hasRelaxedPositions`
- `useRelaxedPositions`
- `isSimStale`
- `simDiagnostics`

`isSimStale` tracks whether the topology changed since the last successful
simulation, so the toolbar can warn when the relaxed view is no longer current.

---

## Cursor Rendering

The cross-section cursor is shared with the strand view.

When `showCursor` is on:

- one ring is drawn around each visible VH
- markers are drawn for occupied nucleotides at `csCursorIdx`

The cursor position is therefore a single editor state used by:

- strand view
- lattice helix circles
- 3D view

---

## Exports

`View3D.svelte` currently exposes three export actions:

- image download of the 3D canvas
- GLB export using `buildExportScene(...)`
- oxDNA export through `exportPartToOxDna(...)`

When relaxed positions are active, export paths can use those block-transform
overrides instead of the canonical lattice/plane geometry.

---

## Rebuild Triggers

The scene rebuild effect tracks:

- topology and oligo changes
- `filterSegments`
- highlight / hide settings
- insert-effect toggle
- relaxed-position toggle
- stress toggle
- plane transforms

Plane transforms are especially important now because a region's 3D pose is no
longer stored only on each VH. Moving a plane changes many derived VH lab
frames at once, so the 3D scene must rebuild even when strand topology did not
change.

---

## Boundaries / Don'ts

- **Don't read VH placement from `vh.latticeCoords` or `vh.localFrame` directly.** Use `part.getVirtualHelixFrame(vh)`; it applies plane transforms.
- **Don't persist RBS overrides.** `simOverrides` is render-only — never feed it back into `vh.localFrame` or `vh.latticeCoords`.
- **Don't commit a plane edit on every move event.** Live drag mutates via `part.setPlaneTransform(...)`; the single `transformPlaneCmd` lands at pointer-up. Calling the command per move floods undo history.
- **Don't add a Tool to `canvasEditor/tools/*` for the 3D view.** This pane uses its own gizmo + Three.js raycasting; it is not part of the strand-view tool stack.
- **Don't hide ghost helix cylinders by selection filter.** Filtering is segment-based and skipping cylinders breaks the orientation reference.
- **Don't dispose the renderer before unmount.** `sceneSetup` registers the `ResizeObserver` and TrackballControls — they must be cleaned up in the cleanup callback.
- **Don't persist the external structure overlay's geometry.** The parsed nodes/chains are render-only — never feed them into `part`, history, or storage. The _only_ thing persisted is the lightweight PDB placement record (`Part.overlayPlacements`); the overlay file itself is re-dropped each session. Keep the data-vs-visibility `$effect` split so a Hide/Show toggle doesn't rebuild GPU buffers.
