---
covers:
  - src/lib/canvasEditor/tools/select/**
  - src/lib/components/Editor/StrandView/temporalLayer/SelectionOverlay.svelte
---

# Selection System

Foldnano currently has two selection systems:

1. strand-view selection, which is end-centric and drives most 2D routing tools
2. freeform-plane selection, which is VH-centric and drives freeform editing

They are intentionally separate because the two viewers manipulate different
objects at different levels of abstraction.

---

## 1. Strand-View Selection

### Core State

**File:** `src/lib/components/Editor/context/EditorViewContext.svelte.ts`

```ts
class EndSelection {
	ends: SvelteSet<SegmentEnd>;
	set(newEnds);
	add(ends);
	remove(ends);
	clear();
	includesAll(ends);
}
```

`StrandViewContext` owns:

- `selected: EndSelection`
- `selectionToggles`
- `selectionFilter`
- `tempParts`
- hover / context-menu state
- collapsed-region and cross-section state used by select-mode controls

The atomic selected item is still `SegmentEnd`.

That means:

- selecting a segment means selecting both of its ends
- selecting an oligo means selecting all ends in that oligo
- moving a selection ultimately means moving endpoints

---

## 2. Selection Filters

`selectionFilter` is derived from the toolbar toggles, plus several
always-enabled control categories:

```ts
['EMPTY', 'VH', 'VH_TAG', 'VH_GRID', 'CS_CURSOR', 'CONTROL'];
```

So selection toggles do **not** disable:

- region header clicks
- VH tag drags
- grid clicks that set the active cross-section region
- cross-section cursor drags

They only gate strand-like targets.

User-facing toggles still cover:

- scaffold vs staple categories
- ends
- crossovers
- segments

The default toggles leave `SCAF` off (`StrandViewContext.selectionToggles`): the scaffold runs
through every helix of an origami and is the easiest strand to mis-click. Saved editor contexts
restore their own toggles, so this only changes new contexts. The same toggles gate 3D picking,
Delete / Duplicate (`strandActions.ts`) and the Sequence panel's fill-empty targets.

Strand hits carry a `SCAF` / `STAP` category (from `oligo.isScaffold`; crossovers
take the 3' side's oligo). `filterHitsByUserFilter` requires **both** the kind
toggle and the category toggle for those hits; non-strand hits pass on either.
Handlers that expand beyond the hit oligo (same-color / same-length /
same-modification, crossover partner ends, marquee) run the final end list
through `filterEndsByStrandType`, so the SCAF/STAP toggles hold for click and
marquee alike.

---

## 3. Hit Priority In Select Mode

`SelectTool` resolves all hits at a pointer location, sorts them by priority,
and dispatches to the first handler that claims the event.

Current order:

1. `REGION_HEADER`
2. `CS_CURSOR`
3. `VH_TAG`
4. `VH_GRID`
5. `END`
6. `XOVER`
7. `OLIGO`
8. `SEGMENT`
9. `XOVER_SITE`
10. `EMPTY`

This is why clicking near the left edge of a row affects the region header or
VH tag before it can fall through to strand-body selection.

---

## 4. Strand Selection Flows

### End click

`onEnd` resolves one `SegmentEnd`.

- plain click -> replace selection
- modifier click -> add or toggle

### Segment click

`onSegment` resolves the segment and selects both termini.

### Oligo click

`onOligo` expands to all ends in that oligo. Additional select-all-style modes
such as same-color and same-length are handled from the same area of the select
stack.

### Marquee selection

`onEmpty` owns rubber-band selection:

1. pointer-down on empty area records the start point
2. pointer-move creates a `Marquee` temp part
3. pointer-up queries hits inside the rect
4. end hits are expanded through `fromHitsCandsToSelectedEnds(...)`

A box can start on any empty canvas and is committed wherever it is released, even outside
the canvas (see `docs/editor-strand-viewer.md`); a real `cancel` hides the marquee unchanged.

That expansion still honors the active selection filter, so marquee selection
can mean:

- only free ends
- whole segments
- whole oligos
- crossover-connected ends

depending on the enabled toggles.

### Selection summary

`summarizeEndSelection(ends)` in `selectionSummary.ts` reads an end selection
as whole oligos, segments, crossovers and loose ends, for the Select tool
panel's count and detail. Its rules match the ones `removeSelection` and
`SelectionOverlay` already use, so the count names what Delete would remove
and what the highlight draws:

- an oligo with every end selected is one whole oligo (its parts aren't
  counted again)
- otherwise a segment with both ends selected, and a connection with both ends
  selected (oriented 3' -> 5')
- remaining ends count on their own

It is pure and recomputed from the `SvelteSet` in a `$derived`; it never
mutates the selection.

---

## 5. Moving Selected Ends

`createWithSelectionHandler()` and `movingEndsOps.ts` manage drag-to-move.

Key rules in the current implementation:

- previews are created lazily, only after the pointer actually starts moving
- only free ends get visible `MoveEndBox` previews
- all selected ends must move by the same delta, or nothing moves
- if the proposed delta is blocked, `findNearestValidDelta` snaps to the nearest
  valid delta (searching up to `MAX_SNAP` positions); if none is found, the drag
  is a no-op
- constrained ends move as part of the batch: `canBatchMoveByDelta` requires the
  new position to be a valid crossover site to the same partner VH, and propagates
  the move to the partner end when that partner is not itself selected

That all-or-nothing-delta rule preserves the relative shape of the selected
routing fragment during drag.

On a linked (read-only) Part, `SelectTool` never calls this handler
(`canEditActivePart` is false), so clicks and marquee still select but nothing
drags; see `docs/linked-parts.md`.

Commit path:

```ts
moveOligoEndCmd([...moves], history);
```

---

## 6. Non-Selection Controls Inside Select Mode

Recent region work added several handlers that are not really "selection", but
they still live inside `SelectTool` because they are pointer interactions in
select mode.

### Region headers

`onRegionHeader.ts`

- click toggles collapse / expand
- hidden hover or context state is cleaned up immediately

### VH tags

`onVhTag.ts`

- drag reorders a VH inside its region-local row order (not on a linked,
  read-only Part: the handler returns after selecting)
- preview is shown with `VhDragPreview`
- commit calls `reorderVirtualHelixCmd(...)`
- on a freeform VH (has `localFrame`), pointer-down also selects it in
  `selectedFreeformVhIndices` (Shift/Cmd/Ctrl toggles), so the Select panel's
  roll/position fields work without the freeform plane view; `VhTag.svelte`
  rings selected freeform tags

### Cross-section cursor

`onCsCursor.ts`

- drag changes `strandViewContext.csCursorIdx`

### Grid clicks

`onGrid.ts`

- set `activeAround`
- set `activeCsRegionId` from the clicked visible VH row

Those handlers are why select mode now manages more than just strand-end
selection.

---

### Clicks from the 3D view

In Select mode, a click in the 3D line view writes the same `selected` set
through the same filter and priority (crossover, oligo, segment; no ends). Oligo picks use
`expandOligoEnds`, shared with `onOligo`. Shift-drag in 3D draws a box that adds every touched
item the same way (no depth test, like marquee here). See `docs/editor-3d-view.md` § Select in 3D.

---

## 7. Visual Feedback

The old many-component selection highlight path has been replaced by a batched
overlay.

### `SelectionOverlay`

**File:** `src/lib/components/Editor/StrandView/temporalLayer/SelectionOverlay.svelte`

This draws selected segments, selected crossovers and selected free ends (the red
terminus glyph) in one custom `Konva.Shape` using canvas drawing commands. The draw
function is rebuilt when the selection size or `historyStack.revision` changes, and
reads the ends at draw time.

### `TemporalParts`

Still used for transient, low-count overlays such as:

- `MoveEndBox`
- `Marquee`
- other temporary previews

Selected free ends are drawn by `SelectionOverlay`, not as mounted end boxes:
every staple has two, so select-all would mount thousands. The "selection equals
many mounted route components" path is gone.

---

## 8. Plane-Viewer VH Selection

Plane editors (lattice and freeform) do **not** use `EndSelection`. They have
their own VH-id sets on `EditorViewContext`:

```ts
selectedFreeformVhIndices: SvelteSet<number>;
selectedLatticeVhIndices: SvelteSet<number>;
```

Each set is manipulated only by its respective viewer (`FreeformViewer.svelte`,
`HelixViewer.svelte`) and the editor shell.

Supported operations (per viewer):

- click / modifier-click VH selection
- marquee VH selection
- group translation
- Delete / Backspace -> `deleteVirtualHelicesCmd(...)` (or `deleteFreeformVirtualHelicesCmd` for freeform-only flows)

Keeping these sets distinct from strand-view end selection means each viewer
has its own pointer model and lifecycle without cross-talk.

---

## 9. History Interaction

Undo and redo clear both selection systems through the `HistoryStack` mutation
callback registered by `EditorViewContext`.

That prevents stale references after:

- structural strand edits
- freeform VH deletion
- history replay that reconstructs VHs or oligos

Selections are therefore treated as editor UI state, not durable model state.

---

## Boundaries / Don'ts

- **The atomic strand-view selection is `SegmentEnd`, not `OligoSegment`.** Selecting a segment means selecting _both_ of its ends; oligo selection means _all_ ends in the oligo.
- **Don't bypass the selection filter in marquee expansion.** `fromHitsCandsToSelectedEnds` honors active toggles and the always-on control categories — silencing it breaks the user's filter expectations.
- **Constrained ends move with the batch, but only to valid crossover sites.** `canBatchMoveByDelta` rejects a delta that would land a constrained end on a non-site or break its partner; the whole move is all-or-nothing per delta, which preserves the relative shape of the routing fragment. Don't special-case constrained ends out of the move path.
- **Don't drive selection state from inside a render.** Mutate `EndSelection` only from tool handlers (`down`/`move`/`up`). Reading inside derived expressions is fine.
- **Don't share selection between viewers.** Strand-view, lattice plane, and freeform plane each own their own selection store; cross-pollinating breaks lifecycle assumptions.
- **Keep the summary rules in step with Delete.** If `removeSelection`'s whole-oligo / segment / crossover classification changes, change `summarizeEndSelection` with it, or the panel's count stops describing what Delete removes.
- **Selections aren't part of the document.** Don't serialize them to IndexedDB or GitHub. They are UI state and must clear on undo/redo (already handled by the `HistoryStack` mutation callback).
