---
covers:
  - src/lib/components/Editor/StrandView/**
  - src/lib/components/Editor/context/firstPressActivates.ts
  - src/lib/components/Editor/mouseHandler.ts
  - src/lib/utils/wheel.ts
---

# Editor - Strand Viewer

The strand viewer is the main 2D routing canvas. It renders segments,
crossovers, skips, insertions, region headers, VH tags, and the cross-section
cursor, then forwards pointer events into the canvas tool system.

The key recent architectural change is that the viewer is now **region-aware**:
display rows are flattened from region headers plus VH rows instead of being a
simple `vh.listRow -> y` mapping.

---

## Location

```text
src/lib/components/Editor/StrandView/
├── StrandViewer.svelte            # stage, camera, tool wiring
├── StrandRoutes.svelte            # static segment routes (sequence text)
├── MismatchMarkers.svelte         # sequence-mismatch warning rungs
├── RecentFillMarkers.svelte       # transient tint on cells the last Sequence-tool fill assigned
├── DesignIssueMarkers.svelte      # design-check issue frames (editorViewContext.designIssues)
├── DesignIssuesMenu.svelte        # toolbar popover: check toggles + issue list (jump-to)
├── Accessories.svelte             # region headers, VH tags, crossovers, skips, inserts, split preview
├── Highlights.svelte              # dimming / hiding overlays
├── CrossSectionSelector.svelte    # region-scoped cursor column
├── OligoSegmentInPart.svelte      # segment renderer + culling
├── BlockLayer.svelte              # RBS block bands, toggled by strandViewContext.showBlocks
├── Grid/Grid.svelte               # per-visible-row VhGrid instantiation
├── Grid/VhGrid.svelte             # per-VH grid lines
├── Grid/VhTag.svelte              # draggable VH tag
├── Grid/RegionHeader.svelte       # collapsible region header row
├── strandRowLayout.ts             # visible-row flattening
├── drawingDimensions.ts           # coordinate helpers backed by row layout
└── temporalLayer/
    ├── TemporalParts.svelte
    ├── SelectionOverlay.svelte
    └── DuplicatePreview.svelte
```

Related hit-testing and tools:

```text
src/lib/canvasEditor/services/hitEventToModel.ts
src/lib/canvasEditor/tools/select/*
src/lib/canvasEditor/tools/draw/*
```

---

## Row Layout

The viewer no longer assumes one visible row per VH.

`createStrandRowLayout(...)` produces a flattened row model with two row kinds:

```ts
type VisibleStrandRow =
  | { kind: 'REGION_HEADER', displayRow, regionId, ... }
  | { kind: 'VH', displayRow, regionId, regionRow, vh }
```

That layout is derived from:

- `part.regions`
- each region's `vhOrder`
- `strandViewContext.collapsedRegionIds`

Consequences:

- collapsing a region removes its VH rows from the visible layout
- region headers occupy real display rows
- `displayRow` is a view coordinate, not model identity

`drawingDimensions.ts` now delegates row math to this layout.

---

## Coordinate System

The viewer still uses the familiar base-pair grid constants:

| Constant      | Value   |
| ------------- | ------- |
| `radius`      | `16` px |
| `sideLength`  | `12` px |
| `strokeWidth` | `1` px  |

But row lookup now goes through the row layout:

```ts
getRowYByRowIdx(displayRow);
getVisibleVhByDisplayRow(displayRow);
getDisplayRowForVh(vhId);
```

So visible Y positions remain stable even though hidden/collapsed regions may
change the mapping from VH to display row.

---

## Layer Architecture

```text
Stage
├── world layer (listening=false)
│   ├── Grid (VhGrid per visible row)
│   ├── MismatchMarkers
│   ├── StrandRoutes
│   │   └── OligoSegmentInPart
│   ├── DesignIssueMarkers    # above the routes so frames aren't hidden by strands
│   └── BlockLayer            # only when strandViewContext.showBlocks
├── overlay layer (listening=true)
│   ├── EMPTY background rect
│   ├── Accessories
│   │   ├── RegionHeader
│   │   ├── VhTag
│   │   ├── Crossover
│   │   ├── Skip
│   │   └── Insert
│   ├── Highlights
│   ├── XoverSitesAround       # only when the active region supports constrained xover sites
│   └── CrossSectionSelector
└── temporal layer (listening=false)
    ├── SelectionOverlay
    ├── TemporalParts
    └── DuplicatePreview
```

Important split:

- static geometry is in the world layer
- pickable controls and accessories live in the overlay layer
- transient previews and selection visuals live in the temporal layer

Pointer events are forwarded from the `Stage`, not the overlay layer, so a press on bare
canvas past the content (zoomed out, beyond the `EMPTY` rect) still reaches the tools as
`EMPTY`. A left press captures the pointer, so a drag that leaves the canvas still ends with
`up` where it is released; a pointer leaving with no button down sends `cancel`.

Within the world layer, mount order is deliberate, not incidental: `VhGrid`
paints first (bottom), then `MismatchMarkers`' red rungs, then `StrandRoutes`
last (top) so its sequence letters stay legible over both. `VhGrid` used to be
mounted from inside `StrandRoutes`; it was pulled out to `StrandViewer.svelte`
specifically so `MismatchMarkers` could be slotted in between grid and
sequence text without either being buried under the other. `MismatchMarkers`
is intentionally in the non-interactive world layer, not the overlay layer —
it has no hover/click affordance, unlike `Skip`/`Insert` in `Accessories`.
The fill result includes cells at linked mirror positions as well as real strands; its counts refer to real nucleotides, and conflicting targets remain empty.

`RecentFillMarkers` sits between `MismatchMarkers` and `StrandRoutes` for the
same reason: its amber cell tint must stay under the strand line and letters.
It draws every cell from one `Shape` (a whole-design fill can touch tens of
thousands) and shows only while `EditorViewContext.activeRecentFill` is set,
which is purely transient view state, never persisted.

---

## Hit Testing

`makeETMHitTester(...)` combines:

- `drawingDimensions.getHitGridByXY(...)`
- `drawingDimensions.getVisibleVhByDisplayRow(...)`
- `part.getEntitiesAtVh(vh.id, strandIdx, bpIdx)`

That produces typed hits such as:

- `REGION_HEADER`
- `VH_TAG`
- `VH_GRID`
- `END`
- `SEGMENT`
- `OLIGO`
- `XOVER`
- `EMPTY`

Marquee queries use `drawingDimensions.queryRect(...)` plus
`part.queryEntitiesInVhRange(...)`, so they operate on visible VHs rather than
naively scanning display rows as if every row were a helix.

---

## Activating The Pane

The strand viewer and the left pane (plane view / 3D) share one keyboard and toolbar, owned by
`activeViewer`. A **left press on the inactive pane only activates it**: `firstPressActivates`
(capture-phase handlers spread on each pane's wrapper, here and in `HelixViewer.svelte`) stops that
whole gesture (pointerdown, pointerup, click, and a double-click it starts) before Konva, the tools
or the 3D camera see it. Without this, the click that switched to the strand view also ran the
Select tool and cleared a selection just made in 3D. Other buttons and the wheel pass through, so
wheel zoom and 3D right-drag pan work without activating first (strand-view Alt + left-drag pan is a
left press, so it activates first). The bubbling `onpointerdown` / `onfocusin` setters stay
for presses on an already-active pane and for keyboard focus.

## Tool Integration

`StrandViewer.svelte` creates a `ToolController` with:

- `SelectTool`
- `DrawTool`
- `BreakTool`
- `SkipTool`
- `InsertTool`
- `PaintTool`
- `ModificationTool`
- `SequenceTool`
- `SplitRegionTool`
- `DuplicateTool`

The shared `ViewContext` passed to tools contains:

- `part`
- `drawingDimensions`
- `camera`
- `hit`
- `overlay`
- `strandCtx`
- `history`

Select-mode priority now gives control rows precedence:

1. `REGION_HEADER`
2. `CS_CURSOR`
3. `VH_TAG`
4. `VH_GRID`
5. strand targets such as `END`, `XOVER`, `SEGMENT`, `OLIGO`
6. `EMPTY`

That keeps region collapse, cross-section dragging, and VH reordering from being
mistaken for strand selection.

Arrow-key panning is not a tool: `Editor.svelte`'s body keydown handler calls
`StrandToolbarController.panBy` while the strand pane is active. It runs before
the tab-owner gate (panning is view-only), yields to `DUPLICATE` (which owns
←/→) and to events already `defaultPrevented` (menus, CodeMirror). Any code
that moves the stage must call `updateViewportBounds()` afterwards, or culling
keeps hiding rows that scrolled into view.

---

## Region Controls

### RegionHeader

`RegionHeader.svelte` renders one header row per region in the overlay layer.

In `SELECT` mode a click activates the region and a double-click toggles its
membership in `strandViewContext.collapsedRegionIds`; the plane icon at its right
end frames the region's plane in 3D. The active header also shows up / down buttons
left of the plane icon (only when the part has more than one region; dimmed at either
end): they call `moveRegionCmd` to move the region one slot in `part.regions`, then
`panBy` so the header stays under the pointer for repeated clicks. Moving a region
renumbers the derived `R<n>` labels on cross-region crossover marks. Its boxes come
from `regionHeaderGeometry()`,
which the `?` help anchors (`strandCanvasHelp.ts`, see `docs/workspace-help.md`
§ Canvas anchors) reuse to point at the first header in view.

When a region is collapsed, helper state such as hover, active-around, and
context-menu visibility is cleaned up if it now points at hidden rows.

### VhTag

`VhTag.svelte` renders the circular VH label at the left edge of each visible VH
row.

Dragging a VH tag in `SELECT` mode calls `reorderVirtualHelixCmd(...)`, which
reorders the VH **within its region-local row order** rather than globally.

The tag is outlined when its helix is selected in a plane view: freeform helices
from `selectedFreeformVhIndices`, lattice helices from `selectedLatticeVhIndices`.
The plane viewers bring the row into view with `StrandToolbarController.revealVh`
(vertical only, no-op when the row is already on screen) or `centerOn` (in-plane
freeform helices, centred on the clicked base).

**Reset view** calls `StrandToolbarController.resetView`: scale 1 at base 0, scrolled so the
active region's header sits where the first region's header does (so for the first region, or
with no headers, it is the plain origin).

The toolbar's **Fit** button calls `StrandToolbarController.fitView`: the box around every selected
end (expanding collapsed regions, like `centerOn`), or the whole content extent when nothing is
selected, framed by the pure `fitTransform` in `fitView.ts`. It never zooms in: a selection that
fits at the current zoom is only centred, and fitting everything is also capped at the default
scale of 1.

---

## Cross-Section Cursor

The vertical cursor overlay is now region-scoped.

`strandViewContext.activeCsRegionId` is set from the last clicked grid row, and by
`EditorViewContext.setActiveRegion` whenever a region is activated (from any view, even if it is
already active), which also clamps `csCursorIdx` to that region's length.
`CrossSectionSelector.svelte` then renders only across the visible rows that
belong to that region.

Dragging the cursor updates:

```ts
strandViewContext.csCursorIdx;
```

That same bp index is consumed by:

- VH scaffold indicators in the plane view
- the 3D cursor rings / markers
- strand-view visuals that depend on cross-section position

---

## Performance-Sensitive Rendering

The current viewer keeps several optimizations introduced during the region
refactor:

- **Cull against `strandViewContext.renderBounds`, not `viewportBounds`.** The render
  window is the viewport plus a margin, and `nextRenderWindow` (`renderWindow.ts`) replaces
  it only when the viewport nears its edge or has shrunk well inside it. Every segment and
  crossover holds a derived on it, so a pan or wheel step that stays inside re-evaluates
  nothing; `viewportBounds` changes on every step and would re-run all of them.
  `StrandViewer.updateViewportBounds` maintains both, on wheel, on stage `dragmove` (so a
  long pan never shows blank canvas) and on `dragend`.
- **Wheel gestures go through `handleWheel` (`mouseHandler.ts`)**, shared with the plane and
  freeform viewers; each caller passes whether the PAN tool is active. `classifyWheel` decides pan
  vs zoom: Ctrl/Cmd + wheel (and trackpad pinch, which arrives as ctrl+wheel) always zooms; in PAN
  mode or with `altKey` the wheel scrolls both axes (Alt keydown already switches to PAN, but
  `altKey` also covers a wheel over the unfocused pane); otherwise a vertical wheel zooms and only
  horizontal-dominant deltas or Shift + vertical wheel scroll sideways. Don't derive zoom direction
  from `deltaY` alone: a pure-`deltaX` event used to fall into the zoom-out branch.
- **Zoom thresholds go through `strandViewContext.isDetailZoom`** (a derived boolean), not
  a per-node comparison with `viewportScale`, for the same reason.
- `OligoSegmentInPart` always mounts (for every segment in the part) but toggles
  its Konva `visible` attribute from the render window. Sequence text is gated the same
  way, and its `sceneFunc` narrows to the exact viewport at draw time (`stageViewRect`).
- **Sequence changes reach the view through `OligoSegment.seqVersion`**, one signal per
  segment that every slot write bumps. The sequence Shape passes it as a `redrawKey` attr
  (not a Konva attr; changing it is what triggers the layer redraw). Don't read each
  `slot.seq` in a derived to detect changes: that is one subscription per base.
- `VhGrid` draws its lines in one Shape and clips the loop at draw time to the rows and bp
  range the stage shows, and drops the per-bp lines when they would be closer than
  `MIN_BP_LINE_SPACING_PX` device pixels. It measures that from the canvas transform, which
  includes the export pixel ratio, so the image export keeps them.
- `Accessories` wraps crossovers and skip/insert markers in `<Group visible={…}>`
  culled against the render window — again a `visible` toggle, not mount/unmount.
- A crossover's wide pick area is its line's `hitStrokeWidth`; the hover halo is a second
  line mounted only while hovered (hover-driven, not pan/zoom-driven, so `{#if}` is fine).
- `SelectionOverlay` draws highlighted segments, crossovers and selected free ends in one
  batched `Konva.Shape` instead of many per-selection components
- the world layer uses `listening=false` so background strand geometry never
  participates in Konva hit testing
- `MismatchMarkers` is gated behind `warningContext.mismatch` (an `{#if}` at
  the top of the component — this is a structural, edit-driven condition, not
  a pan/zoom one, so it's exempt from the `visible`-only rule below) and culls
  per-segment via `getEffectiveDisplayRowForVh(...)`/`isCollapsed`, same as
  `Accessories`. `mismatchedBps()` finds the opposite strand through the
  non-reactive `SpatialIndexService`, so each segment's block also reads the
  opposite `StrandSet.segmentIds` and those segments' end indices: a strand
  placed or moved opposite an unchanged segment (a new mirror copy, a
  translated partner) re-runs only the segments on that helix, instead of
  staying stale until reload. Don't replace this with a design-wide rescan per
  `historyStack.revision`; that measured about 2× the integrity check on every
  edit. It does **not** further cull mismatched bps against the
  viewport rect — `OligoSegment.mismatchedBps()` does a per-base-pair
  complementary-strand lookup (not just the sparse skip/insert list), so if a
  design-wide live count is ever added on top of this, revisit that first;
  the toggleable overlay alone was judged cheap enough for v1 since it only
  runs while the toggle is on and only over collapsed/visible rows.

### Cull with `visible`, never with `{#if}` (Firefox restyle hazard)

Viewport culling **must** toggle Konva's `visible` attribute, not mount/unmount
components via `{#if}` / `{#each}`. In svelte-konva every Konva node is a Svelte
component backed by a DOM anchor (comment) node. Mounting/unmounting on pan/zoom
therefore mutates the DOM on every frame, and **Firefox restyles siblings on each
DOM mutation** (`RestyleManager::MaybeRestyleForEdgeChildChange` /
`ContentWillBeRemoved`). On a ~900-segment design a Firefox profile of a zoom+pan
was **~40% CPU in restyle**; switching the same culling to `visible` dropped it to
**~0.3%** and left the frame mostly idle (the remainder is plain Konva `_draw` /
`batchDraw` canvas paint, which is the healthy state). Chrome tolerates the DOM
churn, so this regression is invisible there — only Firefox/Safari expose it.

Consequences:

- Only **structural** conditions (does the segment exist? is its region
  collapsed? insert vs. skip?) belong in `{#if}` — those change on edits, not on
  pan/zoom.
- **Viewport / zoom-threshold** conditions belong on `visible`. A `visible={false}`
  node is skipped in both draw and hit testing, so culling still saves paint work
  without any DOM mutation. `sceneFunc` is not invoked for invisible shapes either.
- If perf becomes paint-bound on very large designs, the next lever is collapsing
  per-segment backbones into a single batched `sceneFunc` (as `VhGrid` already does
  for grid lines) — not reintroducing `{#if}` culling.

---

## Relationship To The Model

The strand viewer is now the best example of the current model split:

- topology comes from `Part`, `Oligo`, `OligoSegment`, and the spatial index
- display grouping comes from `DesignRegion` and `strandRowLayout`
- cross-section state comes from `StrandViewContext`

That separation is what allowed the recent region-header and region-collapse
work without rewriting the underlying DNA model.

---

## Hidden Crossover Marks

With `hideContext.crossovers` on, `Accessories` drops the arcs and cross-region arrows and
`crossover/ConnectionMarks.svelte` draws an arrow and `VH[bp]` label at each crossover end
(`R2:12[34]` when the target region is collapsed; text only above a zoom threshold). The same toggle
hides crossovers in 3D, but the marks are strand-view only.

`hideContext.unconstrained_crossovers` does the same for crossovers without two constrained ends and leaves
the constrained arcs drawn. It is strand-view only: 3D draws every arc as one group. `isCrossoverHidden` is the one
rule, used by `Accessories` to skip a line and by `buildConnectionMarks` to add its mark, so each crossover gets one or the other.

- **Batched and non-listening.** Designs reach thousands of marks, so they are one `Shape` fed by
  `buildConnectionMarks` (bucketed by display row), with no Konva node per mark.
- **Placement.** A label extends over its end's own segment, so the two ends of a DX pair point apart,
  and stays in the half of the row gap next to its strand. Centered labels overlapped on most ends.
- **Pointer handling lives in `StrandViewer`.** `hitConnectionMark` visits only the rows `y` can reach.
  Hovering a label or end cell reveals the real `Crossover` in the non-listening temporal layer, where
  it can't steal the pointer. In `forward`, an `EMPTY` target on a label becomes the mark's
  `XOVER#from#to` id, so every tool and the context menu treat it as the hidden line. End cells keep
  their usual END hits. Double-clicking a label calls `centerOn`.
- **Selected crossovers stay visible.** `selectedConnectionMarks` picks those with both ends selected,
  and `StrandViewer` mounts their `Crossover` in the overlay layer, so the arc stays pickable as usual.
  This mounts on selection changes only, never on pan/zoom.

## Design Check Overlay

`EditorViewContext.designIssues` is `collectDesignIssues(part, activeRegion, designChecks)` (see
`design-guards.md`), recomputed when `strandViewContext.designChecks`, the active region, the
document or `historyStack.revision` change. The model is read inside `untrack`, so dragging
(live mutations before the commit) doesn't recompute it; the commit does. The checks walk every
base, so they don't run inside the edit: an effect root owned by `EditorViewContext` schedules
them with `requestIdleCallback` (a short timeout where that is missing) and cancels the pending
run when another change arrives. The markers and the list show the previous result until then.

- `DesignIssueMarkers` frames each `error` (red) / `warning` (amber) issue that names a helix: the
  base column when the anchor has a `bp`, else a frame just left of the helix's first base.
  Region-wide issues (cut cross-region links, metadata) have no spot and only appear in the list.
- `DesignIssuesMenu` (strand toolbar, next to the scaffold indicator) holds the three toggles
  (editor rules on by default; simulation and cadnano export opt-in, saved with the strand view
  context) and the issue list. Clicking an issue calls `strandToolbarController.centerOn(vhId, bp)`,
  which expands the helix's region if collapsed and centers the stage on that base.

## Boundaries / Don'ts

- **Don't activate a pane from inside its canvas handlers.** Activation must stay in the capture-phase `firstPressActivates` on the pane wrapper, or the activating click reaches the tools again.

- **Don't pass `vh.listRow` into `getEntitiesAtVh`.** Topology is keyed by `vh.id`. Use `getVisibleVhByDisplayRow(...)` to translate from a clicked row to a VH.
- **Don't treat `displayRow` as model identity** — collapse/expand and region reorder change it.
- **Don't add interactive shapes to the world layer.** `listening=false` is intentional; pickable controls go on the overlay layer.
- **Don't use Konva mouse events (`onclick`, `ondblclick`, `onmouse*`) on canvas shapes.** Konva fires them only for real mice, and it cancels `touchstart` on listening shapes, so iPad Safari never synthesizes the compat mouse events: Apple Pencil and finger taps are silently dropped. Use `onpointerclick` / `onpointerdblclick` / `onpointer*`, which fire for mouse, pen and touch alike.
- **Don't size per-region rows or headers with `part.maxBase`.** It is the _first_ region's length, so it changes when regions are reordered; use `regionMaxBpIdx(part, regionId)` (`Grid/regionHeaderGeometry.ts`).
- **Don't bypass `drawingDimensions` for coordinate math.** It is the only consistent source of (bpIdx ↔ x) and (displayRow ↔ y) under collapse/region rules.
- **Don't mount one component per segment for selection.** Use the batched `SelectionOverlay`. The "many mounted route components" path was deliberately retired.
- **Don't reorder `VhGrid` / `MismatchMarkers` / `StrandRoutes` in the world layer without checking z-order.** Mount order there is bottom-to-top paint order, and it's intentional (grid under warnings under sequence text) — see Layer Architecture above.
- **Don't read `viewportBounds` or `viewportScale` in a per-segment or per-crossover expression.** They change on every pan/zoom step; use `renderBounds` and `isDetailZoom`, or read the stage inside a `sceneFunc`.
- **Don't viewport-cull with `{#if}` / `{#each}`.** Toggle Konva `visible` instead. Mounting/unmounting svelte-konva nodes on pan/zoom mutates the DOM every frame and pins Firefox at ~40% CPU in `RestyleManager`. See _Cull with `visible`, never with `{#if}`_ above.
- **Don't poke at `strandViewContext.collapsedRegionIds` from inside a tool.** Toggle through the `RegionHeader` interaction so cleanup of `activeAround`, hover, and menu state runs. (`centerOn` sets it directly, but only ever expands a region, which hides nothing.)
- **Don't mount a component per hidden-crossover mark, or draw the hover preview in a listening layer.** See _Hidden Crossover Marks_.
- **Don't read the model reactively in `designIssues`.** Keep the check inside `untrack` and depend on `historyStack.revision`; otherwise every drag frame reruns every check.
