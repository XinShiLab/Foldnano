---
covers:
  - src/lib/components/Editor/StrandView/**
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
├── DesignIssueMarkers.svelte      # design-check issue frames (editorViewContext.designIssues)
├── DesignIssuesMenu.svelte        # toolbar popover: check toggles + issue list (jump-to)
├── Accessories.svelte             # region headers, VH tags, crossovers, skips, inserts
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

Within the world layer, mount order is deliberate, not incidental: `VhGrid`
paints first (bottom), then `MismatchMarkers`' red rungs, then `StrandRoutes`
last (top) so its sequence letters stay legible over both. `VhGrid` used to be
mounted from inside `StrandRoutes`; it was pulled out to `StrandViewer.svelte`
specifically so `MismatchMarkers` could be slotted in between grid and
sequence text without either being buried under the other. `MismatchMarkers`
is intentionally in the non-interactive world layer, not the overlay layer —
it has no hover/click affordance, unlike `Skip`/`Insert` in `Accessories`.

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

Clicking it in `SELECT` mode toggles membership in
`strandViewContext.collapsedRegionIds`.

When a region is collapsed, helper state such as hover, active-around, and
context-menu visibility is cleaned up if it now points at hidden rows.

### VhTag

`VhTag.svelte` renders the circular VH label at the left edge of each visible VH
row.

Dragging a VH tag in `SELECT` mode calls `reorderVirtualHelixCmd(...)`, which
reorders the VH **within its region-local row order** rather than globally.

---

## Cross-Section Cursor

The vertical cursor overlay is now region-scoped.

`strandViewContext.activeCsRegionId` is set from the last clicked grid row.
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

- `OligoSegmentInPart` always mounts (for every segment in the part) but toggles
  its Konva `visible` attribute based on an overscanned viewport window. Sequence
  text is gated the same way.
- `Accessories` wraps crossovers and skip/insert markers in `<Group visible={…}>`
  culled against an overscanned render rect — again a `visible` toggle, not
  mount/unmount.
- `SelectionOverlay` draws highlighted segments and crossovers in one batched
  `Konva.Shape` instead of many per-selection components
- the world layer uses `listening=false` so background strand geometry never
  participates in Konva hit testing
- `MismatchMarkers` is gated behind `warningContext.mismatch` (an `{#if}` at
  the top of the component — this is a structural, edit-driven condition, not
  a pan/zoom one, so it's exempt from the `visible`-only rule below) and culls
  per-segment via `getEffectiveDisplayRowForVh(...)`/`isCollapsed`, same as
  `Accessories`. It does **not** further cull mismatched bps against the
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

## Design Check Overlay

`EditorViewContext.designIssues` is `collectDesignIssues(part, activeRegion, designChecks)` (see
`design-guards.md`), recomputed when `strandViewContext.designChecks`, the active region, the
document or `historyStack.revision` change. The model is read inside `untrack`, so dragging
(live mutations before the commit) doesn't recompute it; the commit does.

- `DesignIssueMarkers` frames each `error` (red) / `warning` (amber) issue that names a helix: the
  base column when the anchor has a `bp`, else a frame just left of the helix's first base.
  Region-wide issues (cut cross-region links, metadata) have no spot and only appear in the list.
- `DesignIssuesMenu` (strand toolbar, next to the scaffold indicator) holds the three toggles
  (editor rules on by default; simulation and cadnano export opt-in, saved with the strand view
  context) and the issue list. Clicking an issue calls `strandToolbarController.centerOn(vhId, bp)`,
  which expands the helix's region if collapsed and centers the stage on that base.

## Boundaries / Don'ts

- **Don't pass `vh.listRow` into `getEntitiesAtVh`.** Topology is keyed by `vh.id`. Use `getVisibleVhByDisplayRow(...)` to translate from a clicked row to a VH.
- **Don't treat `displayRow` as model identity** — collapse/expand and region reorder change it.
- **Don't add interactive shapes to the world layer.** `listening=false` is intentional; pickable controls go on the overlay layer.
- **Don't bypass `drawingDimensions` for coordinate math.** It is the only consistent source of (bpIdx ↔ x) and (displayRow ↔ y) under collapse/region rules.
- **Don't mount one component per segment for selection.** Use the batched `SelectionOverlay`. The "many mounted route components" path was deliberately retired.
- **Don't reorder `VhGrid` / `MismatchMarkers` / `StrandRoutes` in the world layer without checking z-order.** Mount order there is bottom-to-top paint order, and it's intentional (grid under warnings under sequence text) — see Layer Architecture above.
- **Don't viewport-cull with `{#if}` / `{#each}`.** Toggle Konva `visible` instead. Mounting/unmounting svelte-konva nodes on pan/zoom mutates the DOM every frame and pins Firefox at ~40% CPU in `RestyleManager`. See _Cull with `visible`, never with `{#if}`_ above.
- **Don't poke at `strandViewContext.collapsedRegionIds` from inside a tool.** Toggle through the `RegionHeader` interaction so cleanup of `activeAround`, hover, and menu state runs. (`centerOn` sets it directly, but only ever expands a region, which hides nothing.)
- **Don't read the model reactively in `designIssues`.** Keep the check inside `untrack` and depend on `historyStack.revision`; otherwise every drag frame reruns every check.
