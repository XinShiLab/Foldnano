---
covers:
  - src/lib/canvasEditor/**
---

# Canvas Editor Tools

The canvas editor tools system translates pointer and keyboard events into model
mutations for the strand viewer. Each editor mode (`SELECT`, `DRAW`, `BREAK`,
...) is backed by a `Tool` object; a `ToolController` routes events to whichever
tool is active.

Important scope note:

- the strand viewer uses this `canvasEditor` tool stack
- the freeform plane viewer and lattice plane viewer use component-local Konva pointer handling instead
- those plane viewers still honor the shared `editorViewContext.editorMode`, but they do not dispatch through `canvasEditor/tools/*`

---

## Location

```
src/lib/canvasEditor/
├── core/
│   ├── modes.ts          # EditorMode, LeafTarget, Category, HitResult types
│   ├── capabilities.ts   # which modes are valid in which view
│   └── views.ts          # ViewContext interface
├── services/
│   ├── hitEventToModel.ts   # canvas hit ID → LeafTarget
│   └── cameraKonva.ts       # KonvaCamera (pan/zoom)
└── tools/
    ├── index.ts             # ToolController, Tool, ToolBehavior interfaces
    ├── types.ts             # PointerEvt, HandlerInstance
    ├── select/              # most complex tool (split into sub-handlers)
    │   ├── select.ts
    │   └── handlers/
    │       ├── onEnd.ts
    │       ├── onSegment.ts
    │       ├── onOligo.ts
    │       ├── onXover.ts
    │       ├── onEmpty.ts   # rubber-band marquee
    │       ├── withSelection.ts  # drag-to-move
    │       └── movingEndsOps.ts
    ├── draw/                # DRAW tool
    │   ├── draw.ts          # pointer dispatch
    │   ├── connectUtils.ts  # 3′-end connecting gesture
    │   └── drawUtils.ts     # strand-extend gesture
    ├── break.ts
    ├── skip.ts
    ├── insert.ts
    ├── paint.ts
    ├── sequence.ts
    ├── modification.ts      # MODIFICATION tool
    ├── duplicate.ts          # transient DUPLICATE tool
    ├── splitRegion.ts        # transient SPLIT_REGION tool
    ├── doubleClick.ts
    └── behaviors/            # cross-cutting ToolBehaviors (hover info, context menu)
```

---

## Key Interfaces

### `Tool`

```typescript
interface Tool {
	name: EditorMode;
	onEnter?(ctx: ViewContext): void; // called when this tool becomes active
	onExit?(ctx: ViewContext): void; // called when another tool takes over
	onPointer?(evt: PointerEvt, ctx: ViewContext): void;
	onKey?(e: KeyboardEvent, ctx: ViewContext): void;
}
```

### `ToolBehavior`

Behaviors are cross-cutting concerns that run **before** the active tool on every event. They cannot be mode-specific by design (though `appliesTo` can filter them).

```typescript
interface ToolBehavior {
	name: string;
	appliesTo?(mode: EditorMode): boolean;
	onPointer?(evt: PointerEvt, ctx: ViewContext, activeTool: Tool): void;
	onKey?(e: KeyboardEvent, ctx: ViewContext, activeTool: Tool): void;
}
```

Current behaviors registered in `StrandViewer`:

- `createHoverInfoBehavior` — updates `strandCtx.footnote` with hover info
- `createContextMenuBehavior` — handles right-click context menu

### `ViewContext`

Every tool and behavior receives this context object:

```typescript
interface ViewContext {
	id: ViewportId;
	kind: ViewKind; // 'ROUTING' (StrandView) | 'LATTICE' (HelixView)
	part: Part; // model root — all mutations go here
	drawingDimensions: DrawingDimensions; // coordinate system
	camera: Camera; // viewport / zoom info
	hit: HitTester; // maps canvas coords to model entities
	overlay: Konva.Layer; // Konva layer for temporary shapes
	strandCtx: StrandViewContext; // selection state and UI toggles
	history: HistoryStack; // undo/redo
}
```

### `PointerEvt`

```typescript
type PointerEventType = 'down' | 'move' | 'up' | 'cancel' | 'contextmenu';

interface PointerEvt {
	type: PointerEventType;
	button: 0 | 1 | 2; // mouse button
	clientX: number;
	clientY: number;
	shiftKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	directTargetId: string | null; // Konva node ID under the pointer
}
```

---

## ToolController

**File:** `src/lib/canvasEditor/tools/index.ts`

```
ToolController
  registry: Map<EditorMode, Tool>
  active: Tool                    ← currently active tool
  behaviors: ToolBehavior[]
  getMode: () => EditorMode       ← driven by editorViewContext.editorMode
```

### Event dispatch

```
handlePointer(evt):
  1. Run each behavior's onPointer (cross-cutting, always runs)
  2. If mode has changed since last event, call active.onExit(), swap, call new.onEnter()
  3. Call active.onPointer(evt, ctx)
```

### Mode switching

`setMode(m)` is not called explicitly — the controller reads `getMode()` on each event and detects transitions automatically. This means `onExit` / `onEnter` fire lazily on the next pointer event after a mode change.

---

## Pointer Event Lifecycle

A typical gesture proceeds through three phases:

```
pointerdown  → tool.onPointer({ type: 'down', … })
pointermove  → tool.onPointer({ type: 'move', … })  × N
pointerup    → tool.onPointer({ type: 'up', … })
```

If the user presses Escape or the pointer leaves the canvas: `cancel` fires and the tool should clean up any in-progress state.

The SELECT tool uses **handler capture**: on `down`, whichever sub-handler claims the event is stored as `active`; subsequent `move`/`up` events route directly to it, bypassing priority dispatch.

---

## Per-Mode Tools

| Mode         | File               | Primary action                                                 |
| ------------ | ------------------ | -------------------------------------------------------------- |
| SELECT       | `select/select.ts` | Click/drag/marquee; move ends; region-header / VH-tag handlers |
| DRAW         | `draw/draw.ts`     | Drag to create/extend a strand; drag free 3′ end to connect    |
| BREAK        | `break.ts`         | Click segment to cut at that bp                                |
| SKIP         | `skip.ts`          | Click bp to toggle skip                                        |
| INSERT       | `insert.ts`        | Click bp to add insertion loop                                 |
| PAINT        | `paint.ts`         | Click oligo to repaint color                                   |
| MODIFICATION | `modification.ts`  | Click a slot to attach a custom modification                   |
| SEQUENCE     | `sequence.ts`      | Click oligo/segment to assign or clear sequence                |
| DUPLICATE    | `duplicate.ts`     | Place copies of selected oligos; see `docs/repeat-units.md`    |

PAN mode is handled at the Konva stage level, not via a Tool object.

DUPLICATE is transient (like SPLIT_REGION): it has no toolbar toggle and is entered only
through `startDuplicate` (`strandActions.ts`, `Cmd/Ctrl+D` or the Edit toolbar button),
which seeds `strandViewContext.duplicateState`. Entering it without that state falls back
to SELECT. With `duplicateState.linked` (`Cmd/Ctrl+Shift+D`, or a repeat group's Add copy)
the confirm creates mirror copies via `commands/repeatGroups.ts` instead of plain copies.

This document therefore describes the routing-canvas tool system, not every
interaction in the left-pane HelixView editors.

### SEQUENCE Tool

Reads mode and fill settings from `ctx.strandCtx.sequenceContext` (`SequenceContext`):

| Field         | Values                          | Meaning                                          |
| ------------- | ------------------------------- | ------------------------------------------------ |
| `mode`        | `'RANDOM' \| 'SEQ' \| 'REMOVE'` | What to apply on click                           |
| `sequence`    | `string`                        | Explicit sequence for `SEQ` mode                 |
| `gcContent`   | `number` (0–1)                  | GC fraction for `RANDOM` mode                    |
| `fillType`    | `'WHOLE' \| 'ONLY_EMPTY'`       | Whether to overwrite existing bases or skip them |
| `fillResults` | `{ leftover, missing }[]`       | Feedback written back after each fill            |

`fillType === 'ONLY_EMPTY'` causes the fill to skip any slot whose `seq` is already a non-`N` base, consuming sequence characters only for the empty (`N`) positions. The complement strand is updated only for the slots that were actually written.

---

## DRAW Tool Deep-Dive

The DRAW tool supports two gestures:

**1. Extend/create a strand** — pointer-down on an empty `VH_GRID` cell, drag to a target bp, release. Calls `drawStrandStart` / `drawStrandUpdate` / `drawStrandEnd` (in `draw/drawUtils.ts`). The drag is clamped to the same row and rejects positions already occupied by another strand.

**2. Connect a free 3′ end** — pointer-down on a hit that contains both a `VH_GRID` cell and an `END` target whose id ends with `#3#FREE`, drag to a target position on any segment, release. The connecting gesture is handled by `draw/connectUtils.ts`:

| Function           | Role                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `connectingStart`  | Records start position, creates the `ConnectionInProgress` temp   |
| `connectingUpdate` | Updates the preview line waypoint and highlights a valid end cell |
| `connectingEnd`    | Validates the target and, if accepted, calls `createCrossoverCmd` |

### Rejected connection operations

`connectingEnd` and `Part.createCrossover` each enforce a set of invariants. The table below lists every rejection, where it is enforced, and the user-visible outcome.

| Condition                                                           | Enforced in            | Outcome                               |
| ------------------------------------------------------------------- | ---------------------- | ------------------------------------- |
| Target bp is a **skip** (`slot.seq.length === 0`)                   | `connectingEnd`        | `toast.warning` + operation cancelled |
| Target bp is an **insert** (`slot.seq.length > 1`)                  | `connectingEnd`        | `toast.warning` + operation cancelled |
| Source oligo has no free 3′ end                                     | `Part.createCrossover` | throws `Error`                        |
| Source and target are the **same segment** of the same oligo        | `Part.createCrossover` | throws `Error`                        |
| Either oligo does not belong to this `Part`                         | `Part.createCrossover` | throws `Error`                        |
| Target position is the oligo's own **3′ end**                       | `Part.createCrossover` | throws `Error`                        |
| Connection would produce a **one-nucleotide segment** at the 5′ end | `Part.createCrossover` | throws `Error`                        |

Rejections thrown by `Part.createCrossover` are caught by `connectingEnd`'s `try/finally` block, which always calls `cleanupConnecting` to remove the preview regardless of outcome.

---

## SELECT Tool Deep-Dive

SELECT is split into **priority-ordered sub-handlers**, one per hit target type. On each `down` event the tool iterates the priority list and delegates to the first handler whose `predicate` passes.

**Priority order:**

```
REGION_HEADER → CS_CURSOR → VH_TAG → VH_GRID → END → XOVER → OLIGO → SEGMENT → XOVER_SITE → EMPTY
```

`REGION_HEADER` runs first so clicks on the collapse/expand affordance never fall through to strand-body selection.

After `END`, `SEGMENT`, or `OLIGO` handle a `down`, the `WITH_SELECTION` handler is also tried — it manages drag-to-move for whatever was just selected.

### Sub-handler responsibilities

| Handler          | Trigger                                 | What it does                                                                        |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `onRegionHeader` | click on region collapse/expand strip   | Toggle region collapse; runs first in priority order                                |
| `onCsCursor`     | click/drag on cross-section cursor line | Move the cross-section cursor                                                       |
| `onVhTag`        | click/drag on a VH label                | Select / reorder VHs                                                                |
| `onGrid`         | pointer on an empty `VH_GRID` cell      | Tracks the active row/bp for the cross-section cursor; does not capture the gesture |
| `onEnd`          | click on 5′/3′ terminus                 | Select that end; shift-click toggles                                                |
| `onSegment`      | click on segment body                   | Select both ends of the segment                                                     |
| `onOligo`        | click on oligo label                    | Select all ends in the oligo                                                        |
| `onXover`        | click on crossover arc                  | Select both connected ends                                                          |
| `onEmpty`        | click/drag on background                | Clear selection (or start marquee)                                                  |
| `withSelection`  | follows END/SEGMENT/OLIGO               | Drag selected ends to new positions                                                 |

`withSelection`'s live preview (`canBatchMoveByDelta` in
`select/handlers/movingEndsOps.ts`) snaps the drag to the nearest delta for
which every selected end is a valid move — including, for a segment whose
whole selection (both ends) is moving as a translate, whether its
skip/insert content and any constrained crossover partner can come along.
`moveOligoEndCmd`'s commit-time logic mirrors these same rules exactly, so a
delta the preview accepts never fails on release. See
`docs/commands-and-history.md` § Batch Semantics for the full translate-vs-
resize rules.

After a successful commit, `commitMovingEnds` separately checks whether any
segment that was actually translated (both ends moved together) now has a
sequence mismatch against its complementary strand via
`OligoSegment.mismatchedBps()` — a translate carries sequence along rather
than blanking it (`docs/dna-model.md` § Sequence mismatch detection), so this
is possible even though the move itself succeeded. If so, it shows one
`toast.warning(...)` for the whole batch pointing at the StrandView's
"Warnings → sequence mismatch" toggle (`docs/editor-strand-viewer.md`), rather
than throwing — this is advisory, not a validation failure.

### `HandlerInstance` structure

Sub-handlers implement `HandlerInstance`:

```typescript
interface HandlerInstance {
	kind: string;
	predicate?(args: { filters; ctx; evt; hit }): boolean;
	down?(evt, ctx, hit): boolean | void;
	move?(evt, ctx, hit): boolean | void;
	up?(evt, ctx, hit): boolean | void;
	cancel?(evt, ctx, hit): boolean | void;
	contextmenu?(evt, ctx, hit): boolean | void;
	reset?(ctx?: ViewContext): void; // clean up if handler loses capture
}
```

Returning `true` from a phase method signals that the handler has "captured" the event; the controller stores this handler as `active` and sends all subsequent events to it directly.

---

## Adding a New Tool

1. **Define the mode** — add your string literal to `EditorMode` in `core/modes.ts`.

2. **Create the tool file** — implement the `Tool` interface:

```typescript
// src/lib/canvasEditor/tools/myTool.ts
import type { Tool } from './index';
import type { ViewContext } from '../core/views';

export function MyTool(): Tool {
  // private closure state
  let pendingAction: SomeType | null = null;

  return {
    name: 'MY_MODE',

    onEnter(ctx: ViewContext) {
      // set up cursor, show overlays, etc.
    },

    onExit(ctx: ViewContext) {
      // clean up any in-progress state
      pendingAction = null;
    },

    onPointer(evt, ctx) {
      if (evt.type === 'down') {
        const hit = ctx.hit.hitAt(ctx.camera.toWorld(evt.clientX, evt.clientY), evt.directTargetId);
        if (hit?.kind === 'SEGMENT') {
          // do something
          someCmd({ part: ctx.part, … }, ctx.history);
        }
      }
    },
  };
}
```

3. **Register in `StrandViewer.svelte`** — add to `allTools`:

```typescript
const allTools = [
	SelectTool(),
	MyTool(), // ← add here
	DrawTool(),
	// …
];
```

4. **Filter by view** — `modeAllowedInView('ROUTING', t.name)` already gates which tools appear in StrandView vs HelixView. Update `capabilities.ts` if your mode should be restricted.

5. **Add UI** — add a button in `Toolbar` or `ToolPanel` that sets `editorMode = 'MY_MODE'`.

---

## Hit Testing

`ctx.hit` is an `ETMHitTester` (built by `hitEventToModel.ts`). It maps canvas node IDs and world coordinates to typed `LeafTarget` values:

| `LeafTarget`    | Source                        |
| --------------- | ----------------------------- |
| `END`           | 5′ or 3′ terminus shape       |
| `SEGMENT`       | segment body line/rect        |
| `XOVER`         | crossover arc                 |
| `XOVER_SITE`    | potential crossover indicator |
| `VH_GRID`       | empty backbone grid cell      |
| `VH_TAG`        | VH label                      |
| `CS_CURSOR`     | cross-section cursor line     |
| `REGION_HEADER` | region collapse/expand strip  |
| `EMPTY`         | background rect               |

Key query methods:

```typescript
hit.hitAt(worldPt, directId): HitResult | null    // single point
hit.queryRect(worldRect): HitResult[]              // all hits inside rect
hit.hitXAsBpPos(worldPt): number | null            // world X → bp index
```

---

## Temporary Shapes on the Overlay Layer

Tools that need transient visuals (drag previews, marquees, connection lines) add Konva shapes directly to `ctx.overlay`:

```typescript
const rect = new Konva.Rect({ x, y, width, height, stroke: '#09f', dash: [4, 4] });
ctx.overlay.add(rect);
// later, in up/cancel:
rect.destroy();
```

More structured transient elements (selection boxes, move previews) go through `strandCtx.tempParts` as `TemporalPartInfo` objects, which are rendered declaratively by `TemporalParts.svelte` in the temporal layer. See `docs/selection-system.md` for details.

---

## Boundaries / Don'ts

- **A tool that newly allows or forbids a design state changes a design check.** E.g. letting the skip tool act on crossover sites must relax `skip-insert-on-crossover`; see `design-guards.md` § Changing the checks.

- **Don't mutate the model from a tool directly.** Call a command from `src/lib/commands/*` so the change goes through `historyStack.tx(...)` and lands on the undo stack.
- **Don't read `editorMode` synchronously from `setMode`.** The controller polls `getMode()` on each event; `onExit` / `onEnter` fire on the next pointer event. If a mode change must run setup before the user clicks, do it in the component that flipped the mode.
- **Don't call hit-testing inside a `move`/`up` phase that is already captured.** Once a sub-handler returns `true` from `down`, it owns the gesture — re-running priority dispatch will desync state.
- **Don't add stage-level Konva listeners from a tool.** Draw transient shapes on `ctx.overlay` and clean up in `onExit` / `cancel`. Stage-level listeners survive mode changes and leak.
- **Don't store DOM references on the controller.** Every tool's transient state lives in its own closure or in `ctx.overlay` / `strandCtx.tempParts`.
- **Plane viewers do not use this tool stack.** `FreeformViewer.svelte` and `HelixViewer.svelte` handle Konva pointer events directly. They still observe `editorMode`, but adding to `canvasEditor/tools/*` will not affect them.
- **`PAN` is a stage-level mode, not a tool.** Don't try to register a Tool with `name: 'PAN'`.
