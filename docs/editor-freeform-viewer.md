---
covers:
  - src/lib/components/Editor/HelixView/FreeformViewer.svelte
  - src/lib/components/Editor/HelixView/rollDial.ts
  - src/lib/components/Editor/HelixView/planeAxes.ts
  - src/lib/components/Editor/HelixView/radialDistribute.ts
  - src/lib/components/Editor/ToolPanel/FreeformVhPanel.svelte
  - src/lib/components/Editor/ToolPanel/RollDial.svelte
---

# Editor - Freeform Viewer

`FreeformViewer.svelte` is the 2D plane-view editor for freeform regions. It
renders explicit VH frames in the region plane's local frame and provides
lightweight direct manipulation for creating, moving, rotating, connecting, and
resizing freeform DNA.

Unlike the strand viewer, it is VH-centric rather than end-selection-centric.

---

## Location

```text
src/lib/components/Editor/HelixView/
├── PlaneViewer.svelte        # routes FREEFORM regions here
└── FreeformViewer.svelte     # region-scoped freeform 2D editor
```

Related commands:

```text
src/lib/commands/virtualHelix.ts
src/lib/commands/strands.ts
```

---

## Geometry Model

The viewer reads placement through:

```ts
part.getVirtualHelixFrame(vh);
```

For freeform regions that ultimately comes from `vh.localFrame`, transformed by
the owning region's plane.

The 2D viewer draws in the region plane's own local frame (its local XY). The
plane itself is not pinned to lab XY — like any region's plane, it can be
translated and rotated in lab space from the `View3D` plane gizmo
(`transformPlaneCmd`). The 2D canvas always shows that plane's local surface:

- scale: `10 px / nm`
- canvas origin: center of the stage
- local X/Y: the plane's local X/Y in that plane view

### Perpendicular vs in-plane VHs

`FreeformViewer` distinguishes VHs by their axis:

- near `+Z` -> rendered as a circle
- near XY plane -> rendered as a blunt rectangle with strand lines

Helpers:

- `isPerpendicular(frame)`
- `frameAngleDeg(frame)`
- `layerPointToBpIndex(vh, point)`

---

## Selection Model

Freeform selection is separate from strand-view end selection.

It lives in:

```ts
editorViewContext.selectedFreeformVhIndices: SvelteSet<number>
```

That set tracks selected VH indices, not selected ends or segments.

Supported interactions in `SELECT` mode:

- click a VH -> select that VH
- Shift/Cmd/Ctrl-click -> toggle one VH
- drag on empty background -> marquee-select intersecting VHs
- modifier + marquee -> additive marquee
- drag a selected VH -> move the whole selected group
- drag an unselected VH -> select it, then move it
- drag a visible rotate handle -> rotate one in-plane VH

Delete / Backspace is handled at the editor level and calls
`deleteFreeformVirtualHelicesCmd(...)` when the active part is freeform and the
freeform selection is non-empty.

---

## Draw Mode

### Double-click background

Creates a perpendicular VH:

```ts
addFreeformVirtualHelixCmd({ part, x, y }, history);
```

### Drag on empty background

Creates an in-plane VH from the drag line:

```ts
addInPlaneFreeformVirtualHelixCmd({ part, start, end }, history);
```

That command:

- computes the physical length from drag distance
- extends the region's `maxBase` to the next step multiple if needed
- sets `vh.localFrame`
- fills both strand sets across the drawn range

### Click a perpendicular VH

If the pointer did not move far enough to become a drag, `DRAW` mode treats the
interaction as a fill request and calls:

```ts
fillFreeformVirtualHelixCmd({ part, vh }, history);
```

---

`PlaneViewer` explains these gestures on the canvas; see
`docs/editor-helix-viewer.md` § Gesture hint.

---

## Endpoint Interactions

Freeform endpoint interaction is intentionally lightweight and local to this
viewer. It does not reuse the full strand-view hit-target system.

Current hit targets:

- free 5' endpoint
- free 3' endpoint

### Draw mode: freeform connections

Connection flow:

1. click a free 3' end to start a connection
2. a dashed preview line follows the pointer
3. click a valid free 5' end to commit `createCrossoverCmd(...)`

The flow is directional on purpose:

- start: free 3' only
- end: free 5' only

### Select mode: endpoint resizing

Dragging a free endpoint on an in-plane VH calls:

```ts
moveOligoEndCmd({ part, end, toIdx }, history);
```

The drag preview is local to the viewer and uses projected bp indices from the
helix line.

---

## Move And Rotate Behavior

During pointer movement, the viewer mutates the live model for immediate visual
feedback:

- group translation uses `FreeformRegion.moveVh(part, vh, x, y)` per selected VH
- single-VH rotation updates `vh.localFrame.axis` and carries the roll over with
  `withRoll(..., rollDegOf(dragStartFrame))`
- a roll drag updates `radial0` via `withRoll`, then on pointer-up restores the
  start frame and commits `setFreeformVhRollCmd`

On pointer-up it compares the original and current frames:

- one changed VH -> `moveFreeformVirtualHelixCmd`
- multiple changed VHs -> `moveFreeformVirtualHelicesCmd`
- tiny drag under threshold -> revert live preview

This gives smooth drag feedback while still producing clean undo entries.

---

## Rendering

The viewer renders:

- plane axes at the plane origin: U (red), V (green), and W = U × V as ⊗ (into
  the screen); colours come from `planeAxes.ts` and match the panel's U/V/W labels
  and the 3D view's triad for the active freeform region (`createPlaneAxes`)
- dashed drag guides while moving
- dashed line preview while drawing an in-plane VH
- dashed connection preview while creating a crossover
- marquee rectangle during box selection
- selected VH halos
- in-plane strand lines, 5' squares, and 3' triangles
- shallow crossover arcs between connected endpoints
- per-VH rotate handles on hover
- roll markers (see below)

---

## Roll

Roll is the helix's rotation about its own axis, stored in `localFrame.radial0`
(convention in `docs/dna-model.md` § FreeformRegion). Every roll widget shows the
**cross-section seen from the bp-0 end looking along the axis**, so positive roll
turns clockwise on screen. `rollDial.ts` holds the shared screen math
(`rollDialPoint`, `rollFromDialPoint`, `rollReferenceAngle`, 15° snap, Alt for free).

A projection onto the canvas can't show roll for an in-plane helix: `radial0`
turns out of the drawing plane and a projected tick only shows sin(roll). So:

- **Perpendicular VH:** the circle already is the cross-section. When selected it
  shows an arrow along the projected `radial0` whose tip drags the roll; a helix
  pointing at -W is seen from behind, so the drag flips sign. `HelixCircle`'s
  phase indicator also adds the `radial0` screen angle.
- **In-plane VH:** a small cross-section glyph (circle, 0° tick up = plane normal,
  dot at the roll) sits on the axis line just before bp 0, on hover or selection;
  its dot drags when the helix is selected.

`FreeformVhPanel` (shown in the Select tool panel when freeform VHs are selected,
from this viewer or by clicking a freeform VH's tag in the strand view)
has a `RollDial` plus a Roll field, origin U/V/W fields (absolute for one helix,
Δ for several, so a group doesn't collapse onto one point) and, when every
selected helix is in-plane, a direction angle. Mixed values show blank; typing
one applies it to all. Edits go through `setFreeformVhRollCmd` and
`moveFreeformVirtualHelicesCmd`. The dial commits on release only (no live
preview), so the 3D view updates then.

Only VHs in the active freeform region are rendered.

---

## Radial Distribute

Two `HelixViewerTools` buttons (plain, and facing the centre) apply
`planRadialDistribute` (`radialDistribute.ts`) to the selected VHs of the active
freeform region and commit one `moveFreeformVirtualHelicesCmd`. The planner is a
pure frames-in, frames-out function, like the strand view's `endAlignmentOps`;
returning `null` disables the buttons (fewer than 3 VHs, or any in-plane / frameless VH).

- centre = centroid; radius = mean distance from it, floored so neighbours are at
  least `SQ_INTERHELIX_NM` apart (no clash rule exists for freeform, so the floor is the guard)
- slots keep the VHs' angular order and the ring is turned by the circular mean of
  their offsets, so helices move, and crossovers stretch, as little as possible
- `origin.z` and `axis` are kept; roll is kept unless `faceCenter` sets `radial0`
  toward the centre

---

## Commands And History

Freeform editing currently uses these undoable commands:

- `addFreeformVirtualHelixCmd`
- `addInPlaneFreeformVirtualHelixCmd`
- `fillFreeformVirtualHelixCmd`
- `moveFreeformVirtualHelixCmd`
- `moveFreeformVirtualHelicesCmd`
- `setFreeformVhRollCmd`
- `deleteFreeformVirtualHelicesCmd`
- `createCrossoverCmd`
- `moveOligoEndCmd`

That covers:

- VH creation
- line-based VH creation
- fill
- translation
- rotation
- roll
- radial distribute (via `moveFreeformVirtualHelicesCmd`)
- deletion
- endpoint-to-endpoint connection
- endpoint resizing

---

## Current Limits

The current implementation is intentionally focused:

- the 2D viewer edits within the plane's local frame; reposition/reorient the
  plane itself in lab space from the `View3D` plane gizmo (it is not pinned to
  lab XY)
- this viewer's selection is VH-based, not segment-based (the same model the
  lattice plane viewer uses); full strand routing happens in the strand viewer
- only endpoint-level strand editing exists in this viewer
- rotate handles are per-VH, not group-rotation tools
- the viewer is region-scoped and does not yet expose a richer multi-plane 2D UI

Those are current product boundaries, not just documentation gaps.

---

## Boundaries / Don'ts

- **Don't use parity helpers** (`isEvenParity`, `scaffoldStrandIndex`) on freeform VHs — they require lattice coords and will throw.
- **Don't write `vh.localFrame` directly outside live drag.** The transient mutation during pointer-move is intentional but must end with one of the freeform commands so undo/redo captures it.
- **Don't reuse the strand-view priority dispatch here.** This viewer handles Konva pointer events directly with a small handler set; cross-pollination duplicates state.
- **Don't use Konva mouse events (`onclick`, `ondblclick`, `onmouse*`) on canvas shapes.** Konva fires them only for real mice, and it cancels `touchstart` on listening shapes, so iPad Safari never synthesizes the compat mouse events: Apple Pencil and finger taps are silently dropped. Use `onpointerclick` / `onpointerdblclick` / `onpointer*`, which fire for mouse, pen and touch alike.
- **Don't connect a 3' to a 3'.** Connections are 3'→5' only — the directional convention is enforced by `createCrossoverCmd`.
- **Don't reset `radial0` when changing a VH's axis.** That silently drops the user's roll; use `withRoll(newFrame, rollDegOf(oldFrame))`.
- **Don't render VHs from other regions.** Filter by `vh.regionId === region.id` so mixed-region parts work.
- **Don't apply lab-frame plane transforms in this 2D pane.** Use `View3D` for that.
