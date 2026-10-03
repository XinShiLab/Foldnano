---
covers:
  - src/lib/components/Editor/HelixView/FreeformViewer.svelte
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
- single-VH rotation updates `vh.localFrame.axis` and `radial0` directly

On pointer-up it compares the original and current frames:

- one changed VH -> `moveFreeformVirtualHelixCmd`
- multiple changed VHs -> `moveFreeformVirtualHelicesCmd`
- tiny drag under threshold -> revert live preview

This gives smooth drag feedback while still producing clean undo entries.

---

## Rendering

The viewer renders:

- coordinate axis at the plane origin
- dashed drag guides while moving
- dashed line preview while drawing an in-plane VH
- dashed connection preview while creating a crossover
- marquee rectangle during box selection
- selected VH halos
- in-plane strand lines, 5' squares, and 3' triangles
- shallow crossover arcs between connected endpoints
- per-VH rotate handles on hover

Only VHs in the active freeform region are rendered.

---

## Commands And History

Freeform editing currently uses these undoable commands:

- `addFreeformVirtualHelixCmd`
- `addInPlaneFreeformVirtualHelixCmd`
- `fillFreeformVirtualHelixCmd`
- `moveFreeformVirtualHelixCmd`
- `moveFreeformVirtualHelicesCmd`
- `deleteFreeformVirtualHelicesCmd`
- `createCrossoverCmd`
- `moveOligoEndCmd`

That covers:

- VH creation
- line-based VH creation
- fill
- translation
- rotation
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
- **Don't connect a 3' to a 3'.** Connections are 3'→5' only — the directional convention is enforced by `createCrossoverCmd`.
- **Don't render VHs from other regions.** Filter by `vh.regionId === region.id` so mixed-region parts work.
- **Don't apply lab-frame plane transforms in this 2D pane.** Use `View3D` for that.
