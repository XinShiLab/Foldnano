---
covers:
  - src/lib/components/Editor/View3D/**
  - src/lib/model/geometry3d/**
  - src/lib/components/Editor/ToolPanel/View3DPanel.svelte
  - src/lib/components/Editor/ToolPanel/selectAllOptions.ts
  - src/lib/components/Editor/ToolPanel/ReferenceMesh*.svelte
  - src/lib/model/io/plyMesh*.ts
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

When the active region is freeform, `createPlaneAxes` (`coordinateAxis.ts`) draws
its plane's U/V/W triad at the plane origin, so the Select panel's plane-local
position fields have something to point at.

Backbone phase comes from the VH frame's `radial0` (`backbonePoint`), so a
freeform helix's roll (`docs/dna-model.md` § FreeformRegion) shows up here, in
the NT model and in export with no extra wiring.

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

**Translucent fat lines blend once per pixel.** Strands and arcs are `LineSegments2`: separate quads
that overlap where pieces meet. Translucent (dimmed buckets, NT-mode arcs, the hover glow), those
overlaps blended twice and showed as dots. `drawOncePerPixel.ts` gives each translucent object a
stencil mark (`nextStencilRef`, cycling 1–253; the glow uses the reserved `GLOW_STENCIL_REF` across
all its layers, the sticky-end sleeves `STICKY_STENCIL_REF` across all their colours) with `NotEqual` / `Replace`, so a pixel blends once per object while different
objects still blend over each other. Every renderer that draws this scene is created with
`stencil: true` (three defaults to false): the live view, PNG export, replay video export, and the
landing hero.

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
- view cube (`ViewCube.svelte`, `cameraViews.ts`): see View Cube below

### View Cube

A CAD-style cube in the top-right corner. Each face is a 3×3 grid of buttons: the centre is the
face, the sides its edges, the corners its corners, so there are 26 directions. An edge or corner
cell belongs to two or three faces and they highlight together (`cellDir`/`dirKey`). Clicking one
turns the camera there in `CUBE_TURN_MS`, framing the design box as seen from that side
(`fitDistance`). The turn eases the camera quaternion along the shortest arc, keeps the position
on the view axis (`tweenPose`/`posePosition`) and is stepped in the render loop before
`controls.update()`; grabbing the view (controls `start`) cancels it, and reduced motion jumps.

- **Axis triad:** Fusion-style X/Y/Z lines along the three edges leaving the front-left-bottom
  corner (`axisTriad`). Drawn as flat SVG, not in the CSS 3D cube: CSS 3D lines have to be
  strips, which thin and thicken with the angle, shimmer edge-on and flip depth order against the
  faces near the outline. `projectOnCube` maps the points as the cube is turned (orthographic),
  and `triadAxisInFront` puts a line (with its letter) in the SVG layer in front of the cube when
  either face along its edge faces the viewer, else in the layer behind. So the cube takes the
  camera quaternion, not a finished transform. Both layers are `pointer-events-none`; tooltips add
  the axes (`dirAxes`). The inset from the viewport corner covers the farthest letter at any angle.
- **Roll arrows:** two outlined SVG band arrows sharing the top-right quarter of a circle centred
  on the cube's top-right corner (tails on the diagonal, heads apart). The radius clears the
  face-on axis letters, which can sit right beside that corner, and the outline uses the cube's
  border colour. Shown while the camera looks straight at a face (`isFaceOn`, judged on where a
  running turn ends so they don't blink mid-turn). A wide transparent stroke is the click target;
  they are keyboard-focusable. Each rolls the view a quarter turn about the line of sight (`rollQuaternion`), through the same tween; target and distance
  stay, and a second click during a turn rolls on from that turn's end.
- **Convention:** Z up; front from -Y, right from +X, top from +Z with +Y up (bottom with -Y up).
  `upForDir` keeps +Z up for every other direction.
- **Why DOM, not WebGL:** the cube is CSS 3D transforms (`cubeCssTransform` mirrors the camera,
  `faceCssTransform` places each face; `backface-visibility: hidden`). Clicks and hover are plain
  DOM events on its own elements, so it never touches the canvas's pick, box-select, gizmo and
  TrackballControls handling, and it costs no render pass or WebGL context.
- **Not three's `ViewHelper`:** it hard-codes Y-up target orientations, assumes OrbitControls and
  needs its own click routing on the canvas. No drag-to-orbit on the cube: dragging the view
  already does that.

### Selection

- filter the render to only selected 2D strand segments
- optionally lock the current filtered segment set

Filtering is segment-based and comes from the strand-view end selection. Ghost
helix cylinders are never filtered out.

### Select in 3D

While the editor-wide `editorMode` is `SELECT` (the 3D toolbar's **Mode** group), a click on the
line view selects into the strand view (`linePickActive` in `View3D.svelte`). Any other mode, Pan
in particular, leaves 3D view-only. It is inactive in NT-model mode and while the oxDNA replay is
shown; replay keeps its own nucleotide pick, which always selects the whole oligo. There is no
separate 3D toggle on purpose: one Select concept, shared with the strand view.

- `buildScene` returns a `pickIndex` (`linePick.ts`) next to the batched lines: every drawn piece
  with the segment or crossover it belongs to and its base range. The batched `LineSegments2`
  carry no identity, so this side table is the only way back to the model. It is built only in
  line mode and holds only what was drawn (hidden regions and "show only selected" leave items out).
- `pickLine` projects pieces to screen and takes the nearest within a **pixel** radius, ties settled
  by depth. A pixel radius keeps zoomed-out picks from grabbing a crowd.
- `pickedEnds` maps the hit through the strand view's `selectionFilter` with the select tool's hit
  priority (crossover, then oligo, then segment) and SCAF/STAP; oligo picks honour `selectAllMode`
  via the shared `expandOligoEnds`. Ends are not drawn in 3D, so END is greyed out in the panel.
- The result goes into `strandViewContext.selected` (plain click replaces, Shift toggles) and the
  strand view scrolls there with
  `centerOn(..., { onlyIfOffscreen: true })`, expanding a collapsed region. The 3D camera never moves.
- A true click on empty space clears the selection, as in the strand view. Rotate (left-drag) and
  pan (right-drag) are not clicks (4 px threshold), so looking around never picks or clears.
- The pick filters and the "Select all with" dropdown show in the 3D inspector panel in Select mode,
  bound to the same `selectionToggles` / `selectAllMode` as the strand view's Select panel
  (options shared via `ToolPanel/selectAllOptions.ts`; Same Modification stays disabled in 3D).

**Box select.** Shift + left-drag draws a rectangle (a `selectBox` div over the canvas) and, on
release, **adds** everything it touches: `itemsInRect` takes items with any piece midpoint inside
the rectangle, front or back (no occlusion, like the strand view's box), then `boxPickedEnds` maps
them through `pickedEnds`, expanding each oligo once. It does not scroll the strand view. The
gesture starts in a **capture-phase** `pointerdown` on the wrapper so `TrackballControls` is
disabled before its own `pointerdown` (disabling mid-gesture would leave it holding the pointer);
`endBox` re-enables it. A drag under 4 px is not a box and falls through to Shift-click.

**Hover.** In Select mode, a pointer move (no button held) schedules one `pickLine` per animation
frame with `sticky` set to the hovered item, so hover only switches when a neighbour is closer by
more than 2 px. The hit drives two things:

- `hoverGlow.ts`: a separate small overlay (not the batched design geometry) under everything a
  click would select: `pickedEnds` → `itemsCoveredBy` → `piecesOf`. So with Oligo on it glows the
  whole oligo, with Same Color every matching one. Each piece is drawn twice, at a world width a bit
  wider than the strand and at a fixed pixel width so it stays visible zoomed out.
  Polygon offset alone does not keep the glow behind these billboarded lines (the glow tinted the
  hovered strand, with rings of its true colour at the joints), so a **stencil mask** does: an
  invisible copy of the hovered _solid_ pieces (`itemDim` 0) at the strand's exact width
  (`LINE_WIDTH` / `CROSSOVER_LINE_WIDTH`), drawn first in the transparent pass. It ties the
  strand's depth only where the strand is front-most and stamps `GLOW_STENCIL_REF`, which the glow
  then skips. The glow still tints strands behind the hovered one; dimmed hovered strands get no
  mask, so the glow shows through them.
- The status-bar footnote, via `formatHoverFootnote` (shared with the strand view's
  `createHoverInfoBehavior`). `ownsFootnote` makes clearing leave the strand view's text alone.

Hover clears on pointer leave, on any TrackballControls `start`/`change` (rotate, pan, zoom), on a
scene rebuild (item indices belong to the old pick index), and when the mode, filters, select-all
mode or crossover visibility change. It reappears on the next pointer move.

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

So plane motion is previewed live but committed as one undoable edit. A read-only
(linked) Part gets no plane gizmo at all (`makePlaneTarget` and the gizmo
visibility check `canEditActivePart`), since the drag writes live. If a commit
throws anyway, `GizmoDragController.commit` puts the target back where the drag
started and still re-enables the camera and releases the pointer; `View3D`
reports the error as a toast. An overlay on a linked Part still moves, but its
placement isn't saved.

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

## oxDNA Trajectory Replay

The **Replay oxDNA** toolbar button switches the tool panel to `toolPanelMode === 'replay'`. In that
mode the 3D view draws a trajectory from the design's own oxDNA export over the design (props
`replay` / `replayActive`) and hides the design unless the panel's **Show design underneath** is on.
**See `docs/oxdna-replay.md`** for mapping, worker, posing, geometry and video export
(`replayFrameRendererFn`, an offscreen renderer of the same scene).

---

## Reference Mesh

A wireframe region's `referenceGeometry` mesh is drawn by `referenceMeshOverlay.ts`, in orange, through
the region's plane. Mesh coordinates are region-local (x, y, z = U, V, W), so moving the plane moves the
mesh without rebuilding geometry. It is not in `currentGroup`: it stays out of raycasts and the GLB export.
`referenceGeometry` is a plain field, so the effect that feeds the overlay subscribes to
`historyStack.revision`; every write goes through history.

Faces are drawn with fan triangulation from each face's first vertex, on purpose: the mesh is a reference
drawing. A concave polygon can therefore fill outside its outline. Triangles and other convex faces are
exact, and the edge lines are always right.

`meshDraft` on `EditorViewContext` is a chosen mesh not yet on a region. `plyMesh.ts` parses the file, and
`ReferenceMeshPicker` (used by `RegionCreationPanel` and `ReferenceMeshPanel`) fills the draft in and sets
its scale. `setMeshDraftScale` refuses a scale that makes a coordinate non-finite, because JSON would save
it as null and the mesh would reopen damaged. The overlay previews `scaledMeshDraft` on the pending base plane or the active region's plane,
in place of any mesh it would replace, and the camera frames the preview because a file's size is unknown
in advance. Hidden meshes are `hiddenReferenceMeshRegionIds`: view state, not saved and not undoable.

## Assembly

A document can place several Parts (`docs/dna-model.md` § Assembly). The view
still builds and edits only the active Part (`part` prop), but draws it inside
`partFrame`, a group posed at its edited instance
(`editorViewContext.activeOccurrence`). Everything stored in Part space goes
under that group: the design, hover glow, cursor, coordinate axis, plane
overlay and axes, plane selector, reference meshes, external overlays and the
replay. So Part-space code needs no change; the few places that mix with world
space go through `partFrameMatrix()`:

- line picking and box select project Part-space pick points with
  `updateViewProjection` (which includes the frame); the replay pick moves the
  ray into Part space;
- gizmo targets for planes and overlays are wrapped in `FramedGizmoTarget`
  (`gizmoDragController.ts`), which shows a Part-space pose in world space and
  writes back in Part space;
- camera framing helpers transform the plane normal, overlay bounds and the
  build's `center`.

The transform gizmo, ViewCube and camera stay in world space.

`assemblyRoot` holds lab-space copies (`assemblyScene.ts` `instanceCopy`, which
shares geometry and materials and drops VH labels):

- the active Part's other visible instances: clones of `currentGroup`, re-made
  after each rebuild (`sceneVersion`), so edits and selection dimming show on
  every instance;
- every other Part: one `PartGhost.svelte` per Part builds it once with
  `buildScene(part)` in its own effect (so it rebuilds only when that Part
  changes), makes its own materials see-through (`ghostifyGroup`), and places a
  copy per visible instance. Instances whose Part is missing are never drawn.

Double-clicking a helix cylinder (`CYLINDERS_NAME`) calls `editOccurrence` for
the instance it belongs to: the nearest shown cylinder of `currentGroup` and
`assemblyRoot` wins (`traverseVisible`), so a click on the edited instance in
front keeps it. **Fit** (`resetCameraFn`) and the view cube frame
`designBounds()`: the visible geometry of `currentGroup` and `assemblyRoot`
(`traverseVisible`, so hidden instances don't count), center and distance from
the same box, with the distance from `fitDistance` (`cameraViews.ts`), which fits
the pane's width as well as its height. Hiding the edited instance hides `currentGroup` and turns off
3D picking (`activeDesignVisible` gates both). Switching Parts does **not**
remount the view (only `HelixViewer`'s plane view is keyed by Part): the `part`
prop changes, the camera stays, and the old Part's gizmo drag is cancelled and its
simulation run abandoned (`RbsSimulation.cancel`, so a result already on its way
is dropped). `HelixViewer` drops the locked selection filter and the session-only
mrDNA overlays when the Part id changes, and rebinds the lock to the new segment
objects when history rebuilds the same Part.
Only a new document (another `doc.id`) refits the camera. Remounting it per Part
left the view blank after a switch.

Moving an instance: `movingOccurrenceId` takes the gizmo (after an active
external overlay, before a selected plane) with `OccurrenceGizmoTarget`, which
writes `occurrence.transform` live and commits one `transformOccurrenceCmd` on
release. A bar at the top of the view switches translate/rotate, resets the
placement and ends the move (`Esc` too). Moving the edited instance moves
`partFrame`, so planes, cursor and gizmo follow.

RBS runs on the active Part only, in Part space; other Parts never take part,
so it doesn't see them bump into each other. Its result is per Part: switching
away keeps it in `keptRelaxations` (`PartRelaxation`, with whether it was shown)
and switching back restores it into the live sim state, while a run still going
is cancelled. Another document clears them all. A kept result draws its Part's
ghost relaxed (`keptRelaxedPoses`, only while it was shown and its freshness
signature still matches, since no stale warning is on screen for it). The active
Part's other instances copy `currentGroup`, so they show its relaxed layout.
Replay, GLB export and the NT model cover only the active Part. oxDNA
and mrDNA export follow one `SimulationExportScope` (`assemblyNtModel.ts`):
`'assembly'` (every visible instance) or `'activePart'`. The Export menu offers
**All visible instances** when `offersAssemblyExport` (more than one instance, or
a moved or hidden one, so hiding instances never takes the choice away and a
hidden single instance is never exported as the active Part);
the mirror checkbox and the export guard read `simulationExportParts` for the
chosen scope, and an assembly with nothing visible disables both exports. The
menu sends a `SimulationExportRequest`; `View3D` builds and names the file from
its scope (`docs/oxdna-export.md`).

## Sticky ends

`stickyEndOverlay.ts` draws the sticky-end matches (`sticky-ends.md`) in lab space, added to the
scene outside `partFrame`: colour sleeves over matched stretches on every visible instance and dashed links between instances (every possible pair, or nearest per instance:
`stickyEndLinkMode`). An effect
in `View3D` rebuilds it from `editorViewContext.stickyEnds.shown` (ignored matches left out), the hovered key, the
instances and the `sticky_end_matches` highlight; it doesn't touch the scene rebuild.

## Hiding regions

`View3DPanel` lists the part's regions with an eye toggle backed by `hidden3DRegionIds` on `EditorViewContext`: view
state, not saved and not undoable. `buildScene` drops a hidden region's segments, cylinders and labels, plus any
crossover touching it; the cursor rings and the region's reference mesh go too. GLB export and screenshots follow the
view. oxDNA, mrDNA and RBS always use the whole part, so hiding a region never changes a simulation or those exports.
Its plane stays under the plane overlay toggle, so a hidden region can still be repositioned.

`toolPanelMode: 'mesh'` opens `ReferenceMeshPanel`. The mode survives a change of region, and `ToolPanel`
falls back to the inspector while the active region lacks `supportsReferenceGeometry`.

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

`isSimStale` tracks whether the design changed since the last successful
simulation, so the toolbar can warn when the relaxed view is no longer current.
It compares `computeSimulationFreshnessSignature`, the `solverInputSignature` of
what `buildBlocksAndConstraints` would hand the solver now (block spans, rest
centers and capsules; constraint blocks, attach points and rest lengths), with the
signature `RbsSimulation` took of its own input when the run **started**, so an
edit made during a run leaves its result stale. Deriving it from the solver input
rather than a list of design fields catches every change the solver sees
(welding a crossover, a twist offset, a helix move with every id kept). Building
that input costs about as much as a small rebuild, so the effect computes it only
while there is a result (`hasRelaxedPositions`).

---

## Cursor Rendering

The cross-section cursor is shared with the strand view.

When `showCursor` is on, `cursorGeometry` (`cursor.ts`) draws, for base `csCursorIdx` of every
helix in the strand view's cursor region (`activeCsRegionId`):

- a ring across the helix axis, centred on that base (`helixCenterPoint`)
- a marker on each strand covering that base (`backbonePoint`, as the line view draws strands)

- **Active region only:** the strand view draws its cursor line across that region's rows alone,
  so the 3D view does the same. No region, or a region hidden in 3D, draws nothing; helices
  shorter than the index are skipped.
- **Each helix's own frame** (`part.getVirtualHelixFrame`): correct on any plane. In lattice
  regions the rings form one flat slice; in freeform and wireframe regions, where helices point in
  different directions, they scatter, still marking "base k" on each helix like the strand view.
- Don't go back to a 2D `(x, y)` helix map slid along world Z: that only holds on the Top (XY)
  plane, which is the bug this replaced.

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

**Throttle.** A rebuild disposes and recreates every strand, crossover and label, and blocks
the main thread while it does. After one, the next waits about twice as long as it took (capped
at `REBUILD_MAX_DELAY_MS`), so changes in between (plane-gizmo drag events, simulation progress,
a burst of edits) fold into one rebuild and at most about a third of the time goes to
rebuilding; a small design still rebuilds on the next task. While waiting, the effect is
subscribed to `rebuildTick` only, and the build run re-reads all of the above. Anything that
reads `currentGroup` right after an edit can therefore see the previous scene for that long.
During a plane drag the plane quad still follows the pointer (`updatePosePlaneMesh`); the
helices catch up at the throttled rate.

Plane transforms are especially important now because a region's 3D pose is no
longer stored only on each VH. Moving a plane changes many derived VH lab
frames at once, so the 3D scene must rebuild even when strand topology did not
change.

---

## Boundaries / Don'ts

- **Don't add Part-space objects to `scene`.** Put them under `partFrame`, and convert world-space points, rays and poses with `partFrameMatrix()`, or they drift off as soon as the edited instance is moved.
- **Don't change materials of `currentGroup` for instance copies.** Copies share them; only a `PartGhost` owns (and ghosts) its own build.

- **Don't write a reference mesh outside history.** The overlay learns of changes from `historyStack.revision`.
- **Don't apply a mesh draft's scale twice.** `scaledMeshDraft` is what gets stored; a stored mesh is already in nm and has no scale.
- **Don't read VH placement from `vh.latticeCoords` or `vh.localFrame` directly.** Use `part.getVirtualHelixFrame(vh)`; it applies plane transforms.
- **Don't persist RBS overrides.** `simOverrides` is render-only — never feed it back into `vh.localFrame` or `vh.latticeCoords`.
- **Don't commit a plane edit on every move event.** Live drag mutates via `part.setPlaneTransform(...)`; the single `transformPlaneCmd` lands at pointer-up. Calling the command per move floods undo history.
- **Don't add a Tool to `canvasEditor/tools/*` for the 3D view.** This pane uses its own gizmo + Three.js raycasting; it is not part of the strand-view tool stack.
- **Don't hide ghost helix cylinders by selection filter.** Filtering is segment-based and skipping cylinders breaks the orientation reference.
- **Don't dispose the renderer before unmount.** `sceneSetup` registers the `ResizeObserver` and TrackballControls — they must be cleaned up in the cleanup callback.
- **Don't persist oxDNA replay frames or poses.** See `docs/oxdna-replay.md`.
- **Don't give the 3D view its own selection.** Select in 3D writes `strandViewContext.selected` and nothing else; 3D only reflects that selection.
- **Don't change the strand line widths without the glow mask.** The mask must match `LINE_WIDTH` / `CROSSOVER_LINE_WIDTH` exactly (it imports them); a narrower mask lets the glow tint the strand's edges.
- **Don't create a renderer for this scene without `stencil: true`.** Without a stencil buffer the test is skipped and translucent lines show dots at every joint again.
- **Don't start the box from the canvas `pointerdown`.** It must disable the camera controls in the capture phase, before TrackballControls handles the same event.
- **Don't run hover picks on every pointer event or while dragging.** One per frame, skipped with a button held; a big design has hundreds of thousands of pieces.
- **Don't add pick pieces out of order.** `LinePickIndexBuilder.addPiece` must follow its item's `addItem` (pieces per item are contiguous; the glow relies on it).
- **Don't draw line-view geometry without adding it to the pick index.** A piece drawn but missing from `LinePickIndexBuilder` can't be clicked; one indexed but not drawn is clickable empty space.
- **Don't persist the external structure overlay's geometry.** The parsed nodes/chains are render-only — never feed them into `part`, history, or storage. The _only_ thing persisted is the lightweight PDB placement record (`Part.overlayPlacements`); the overlay file itself is re-dropped each session. Keep the data-vs-visibility `$effect` split so a Hide/Show toggle doesn't rebuild GPU buffers.
