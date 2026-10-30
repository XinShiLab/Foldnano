---
covers:
  - src/lib/components/Editor/HelixView/**
---

# Editor - Helix / Plane Viewer

The left editor pane is now a region-aware "plane viewer" rather than a single
hard-coded lattice viewer. In 2D mode it renders each region with the viewer
that matches that region kind:

- `LatticeViewer` for honeycomb and square regions
- `FreeformViewer` for freeform regions

This document focuses on the lattice side of that pane. Freeform behavior is
documented separately in `docs/editor-freeform-viewer.md`.

---

## Location

```text
src/lib/components/Editor/HelixView/
├── HelixViewer.svelte      # pane host; switches between Plane and 3D views
├── HelixView.svelte        # thin wrapper around PlaneViewer
├── PlaneViewer.svelte      # dispatches each region to the right 2D viewer
├── PlaneGestureHint.svelte # DOM hint over the canvas for adding helices
├── LatticeViewer.svelte    # lattice-region renderer
├── HelixGrid.svelte        # empty lattice click targets
├── HelixCircle.svelte      # one VH circle + scaffold indicator
└── utils.ts                # lattice-to-canvas coordinate helpers
```

The active viewer toolbar in `Toolbar/ActiveViewerToolbar.svelte` lets the user
switch the left pane between:

- `Plane`
- `3D`

---

## Gesture hint

Helices are added only in Draw mode, the editor starts in Select, and classic
cadnano users expect to add them from Select. Canvas gestures have no control to
hang a hover card on, and the first-visit `?` overlay opens before most regions
exist, so `PlaneGestureHint` (a `pointer-events-none` DOM overlay; only its Draw
mode button takes clicks) explains them for both region kinds:

- empty region, not in Draw -> a button that switches to Draw mode
- empty region, in Draw -> the kind's creation gestures
- freeform, in Draw, only in-plane or only perpendicular VHs -> the gesture not yet
  used, because a user who finds drag may never try double-click
- non-empty region, in Select, after a plain click on empty space with nothing
  selected -> the Draw mode button for a few seconds. That click has no other
  effect, so it signals someone trying to add a helix; a click that clears a
  selection does not nudge, or this would fire constantly for experts

Everything except the nudge timer is derived from the region's VHs and the mode, so
undo brings the hint back and there is no "seen" flag to store. Don't add helices
in Select to solve this: a background click there means deselect, so stray clicks
would create helices.

---

## What The Plane View Renders

For a lattice region, `LatticeViewer.svelte` renders:

- empty lattice cells from `HelixGrid`
- one `HelixCircle` per VH belonging to that region
- the VH index label
- a scaffold-direction indicator based on the cross-section cursor
- a marquee rectangle during box selection
- drag-preview positions for lattice moves

The viewer is region-scoped:

```ts
part.virtualHelices.filter((vh) => vh.regionId === region.id && vh.latticeCoords != null);
```

So lattice placement is no longer "all VHs in the part"; it is "the VHs owned by
this region".

---

## Coordinate System

Positions still come from region-local lattice coordinates through
`getCanvasPositionByIndex(...)`.

For honeycomb and square regions:

| Region kind | Input        | Output                |
| ----------- | ------------ | --------------------- |
| `HONEYCOMB` | `(col, row)` | honeycomb XY position |
| `SQUARE`    | `(col, row)` | square XY position    |

The stage supports:

- wheel zoom
- stage drag in `PAN` mode
- toolbar reset via the helix viewer controller

Unlike the 3D view, this pane is strictly a 2D region-local editor.

---

## Interaction Model

### Add a lattice VH

**File:** `HelixGrid.svelte`

In `DRAW` mode, clicking an empty lattice cell calls:

```ts
addNewVirtualHelixCmd({ part, region, col, row }, history);
```

The command delegates to `region.addVhAtCoords(part, col, row)`, so:

- parity-aware VH indexing stays region/lattice specific
- the new VH is assigned to the region
- region `vhOrder` is updated

### Fill an existing VH

**File:** `HelixCircle.svelte`

Clicking an active helix twice within the component's double-click window calls
`fillEmptyVhCmd(...)` for that VH's conventional scaffold-side strand set if it
is currently empty.

This is a convenience action, not a general "fill any missing DNA" operation.

### Select lattice helices

**Files:** `LatticeViewer.svelte`, `latticeSelection.ts`, `EditorViewContext.svelte.ts`

In `SELECT` mode the lattice viewer now owns its own VH-based selection state:

- click a helix circle -> select its constrained-move group
- modifier-click -> toggle that constrained-move group in the lattice selection
- drag on empty background -> marquee-select intersecting helix circles
- marquee selection expands through constrained crossovers before being committed

This selection is separate from:

- strand-view end selection
- freeform VH selection

### Move lattice helices

**Files:** `LatticeViewer.svelte`, `virtualHelix.ts`

Dragging a selected helix circle computes a lattice-cell delta from the drag
anchor and previews the whole selected set at the candidate destination.

Validation rules:

- every moved VH gets the same `(deltaCol, deltaRow)`
- the delta must preserve lattice parity
- every destination cell must stay within the fixed lattice canvas bounds
- destination cells may be occupied only by VHs already in the moving set

If validation fails, the preview is shown in an invalid state and pointer-up
does not mutate the model. If validation succeeds, the viewer commits one
history entry through:

```ts
moveLatticeVirtualHelicesCmd({ part, region, vhIndices, fromTo, bounds }, history);
```

Undo/redo restores the previous `vh.latticeCoords` values and re-renders the
helix circles in their prior lattice positions.

### Delete lattice helices

**Files:** `HelixViewerTools.svelte`, `Editor.svelte`, `src/lib/commands/virtualHelix.ts`

In `SELECT` mode, selecting one or more helix circles and pressing `Delete` / `Backspace`, or clicking the **Delete** toolbar button, removes the selected VHs via:

```ts
deleteLatticeVirtualHelicesCmd({ part, vhIndices: selectedInActiveRegion }, history);
```

Only **empty** VHs are deleted — those whose both strand sets carry zero segments. VHs that contain oligos are silently skipped, preventing accidental data loss. The selection is cleared after the command regardless of how many VHs were actually removed.

The toolbar button is enabled whenever at least one lattice VH is selected; the command itself applies the empty-only filter.

The same toolbar's two **Distribute in a circle** buttons are freeform-only; see `docs/editor-freeform-viewer.md` § Radial Distribute.

---

### View switching

**Files:** `HelixViewer.svelte`, `ActiveViewerToolbar.svelte`

The pane host keeps two modes:

- `show3D = false` -> render `HelixView` / `PlaneViewer`
- `show3D = true` -> render `View3D`

Toolbar state for the left pane is registered through
`editorViewContext.registerHelixToolbarController(...)`.

---

## Data Flow

```text
Part.regions
  └─ PlaneViewer picks a renderer per region

LatticedDesignRegion
  ├─ kind
  ├─ vhOrder
  └─ lattice placement rules

VirtualHelix
  ├─ regionId
  ├─ latticeCoords
  └─ index

EditorViewContext
  ├─ editorMode
  ├─ historyStack
  ├─ selectedLatticeVhIndices
  └─ strandViewContext.csCursorIdx
```

The scaffold indicator inside each `HelixCircle` uses the same
cross-section-cursor-driven twist phase as the strand and 3D views.

---

## Relationship To The 3D Plane Model

The model now stores `Plane` and `DesignRegion`, but the lattice plane viewer
still uses region-local lattice coordinates directly for its 2D layout. It does
not apply arbitrary 3D plane transforms to the 2D canvas.

That split is deliberate:

- the plane viewer is the region-local editing view
- the 3D viewer is the lab-frame view that applies plane transforms

Freeform regions follow the same idea but with `vh.localFrame` instead of
lattice coordinates.

---

## Boundaries / Don'ts

- **Don't render every VH in the part.** Each region renderer must filter to its own `regionId` — that is what makes mixed-region parts render correctly.
- **Don't bypass `region.addVhAtCoords` to add a VH.** The region owns parity rules and `vhOrder`; talking directly to `Part` skips this.
- **Don't move VHs through `vh.latticeCoords =`.** Use `moveLatticeVirtualHelicesCmd` so undo/redo and parity validation run.
- **Don't use Konva mouse events (`onclick`, `ondblclick`, `onmouse*`) on canvas shapes.** Konva fires them only for real mice, and it cancels `touchstart` on listening shapes, so iPad Safari never synthesizes the compat mouse events: Apple Pencil and finger taps are silently dropped. Use `onpointerclick` / `onpointerdblclick` / `onpointer*`, which fire for mouse, pen and touch alike.
- **Don't share selection with the strand view or the freeform viewer.** This pane has its own `selectedLatticeVhIndices`.
- **Don't apply plane transforms in this pane.** It's region-local 2D — apply transforms in `View3D`.
- **Don't add lattice VHs to a freeform region.** `region.kind` must match — mismatches break geometry queries.
