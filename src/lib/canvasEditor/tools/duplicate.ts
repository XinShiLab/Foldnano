import { toast } from 'svelte-sonner';
import type { Tool } from './index';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import { duplicateOligosCmd } from '$lib/commands/strands';
import { addRepeatInstanceCmd, createRepeatGroupCmd } from '$lib/commands/repeatGroups';
import { findNextValidDuplicateDelta } from '$lib/model/Part/duplicateOffsets';
import type { DuplicateState } from '$lib/components/Editor/context/EditorViewContext.svelte';

function setDelta(ctx: ViewContext, state: DuplicateState, patch: Partial<DuplicateState>): void {
	const next = { ...state, ...patch };
	if (next.delta !== state.delta)
		next.check = ctx.part.canDuplicateOligosBy(next.oligos, next.delta);
	ctx.strandCtx.duplicateState = next;
}

function exit(ctx: ViewContext): void {
	ctx.strandCtx.duplicateState = null;
	ctx.editorCtx.editorMode = 'SELECT';
}

function commit(ctx: ViewContext, state: DuplicateState): void {
	if (!state.check.ok) {
		toast.error(state.check.reason);
		return;
	}
	try {
		if (state.linked) {
			// The originals stay selected, so another mirror Duplicate adds the next copy.
			if (state.groupId) {
				addRepeatInstanceCmd(
					{ part: ctx.part, groupId: state.groupId, bpOffset: state.delta },
					ctx.history
				);
			} else {
				createRepeatGroupCmd(
					{ part: ctx.part, oligos: state.oligos, bpOffset: state.delta },
					ctx.history
				);
			}
		} else {
			const copies = duplicateOligosCmd(
				{ part: ctx.part, oligos: state.oligos, delta: state.delta },
				ctx.history
			);
			// Select the copies so another Duplicate places the next repeat.
			ctx.strandCtx.selected.set(copies.flatMap((o) => [...o.allEnds]));
		}
	} catch (err) {
		// A failed command restores the document, so the placement state is stale: exit too.
		toast.error(err instanceof Error ? err.message : String(err));
	}
	exit(ctx);
}

const GRAB_MARGIN_BP = 3;

/** World-space rows (y) and bp range covered by the preview, padded so the copy can be
 * grabbed from just outside it. Null when every preview row is hidden or collapsed. */
function previewZone(
	ctx: ViewContext,
	state: DuplicateState
): { top: number; bottom: number; lowBp: number; highBp: number } | null {
	const d = ctx.drawingDimensions;
	const { sideLength } = d.dimensions;
	let top = Infinity;
	let bottom = -Infinity;
	let lowBp = Infinity;
	let highBp = -Infinity;
	for (const oligo of state.oligos) {
		for (const seg of oligo.segments) {
			const row = d.getEffectiveDisplayRowForVh(seg.inVirtualHelix.id);
			if (!row || row.isCollapsed) continue;
			const [[, yTop], [, yBottom]] = d.getBpCoordsByRowAndBpIdx(row.displayRow, 0);
			top = Math.min(top, yTop);
			bottom = Math.max(bottom, yBottom + sideLength);
			lowBp = Math.min(lowBp, seg.lowIndex + state.delta);
			highBp = Math.max(highBp, seg.highIndex + state.delta);
		}
	}
	if (top === Infinity) return null;
	return {
		top: top - sideLength,
		bottom: bottom + sideLength,
		lowBp: lowBp - GRAB_MARGIN_BP,
		highBp: highBp + GRAB_MARGIN_BP,
	};
}

/** DUPLICATE mode: places copies of `duplicateState.oligos`, entered via `startDuplicate`.
 * Once the pointer reaches the preview it grabs it and drags the offset (snapped to
 * `snapStep`, free with Shift) until it leaves the preview's rows; arrows jump to the next
 * valid offset; click/Enter confirms; Escape cancels. */
export function DuplicateTool(): Tool {
	return {
		name: 'DUPLICATE',

		onEnter(ctx: ViewContext) {
			if (!ctx.strandCtx.duplicateState) ctx.editorCtx.editorMode = 'SELECT';
		},

		onExit(ctx: ViewContext) {
			ctx.strandCtx.duplicateState = null;
		},

		onPointer(evt, ctx) {
			const state = ctx.strandCtx.duplicateState;
			if (!state) return;

			if (evt.type === 'move') {
				const world = ctx.camera.toWorld(evt.clientX, evt.clientY);
				const bp = ctx.hit.hitXAsBpPos(world);
				const zone = previewZone(ctx, state);
				const inRows = zone !== null && world.y >= zone.top && world.y <= zone.bottom;
				if (state.anchorBp === null) {
					// Grab only once the pointer reaches the copy, so it follows the cursor.
					if (zone && inRows && bp >= zone.lowBp && bp <= zone.highBp) {
						setDelta(ctx, state, { anchorBp: bp, baseDelta: state.delta });
					}
					return;
				}
				if (!inRows) {
					setDelta(ctx, state, { anchorBp: null, baseDelta: state.delta });
					return;
				}
				const raw = state.baseDelta + bp - state.anchorBp;
				const delta = evt.shiftKey ? raw : Math.round(raw / state.snapStep) * state.snapStep;
				if (delta !== state.delta) setDelta(ctx, state, { delta });
				return;
			}

			if (evt.type === 'down' && evt.button === 0) commit(ctx, state);
		},

		onKey(e, ctx) {
			const state = ctx.strandCtx.duplicateState;
			if (!state) return;

			if (e.key === 'Escape') {
				exit(ctx);
			} else if (e.key === 'Enter') {
				e.preventDefault();
				commit(ctx, state);
			} else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
				e.preventDefault();
				const step = e.shiftKey ? 1 : state.snapStep;
				const delta = findNextValidDuplicateDelta(
					ctx.part,
					state.oligos,
					state.delta,
					e.key === 'ArrowRight' ? 1 : -1,
					step
				);
				if (delta === null) return;
				// Re-anchor on the next pointer move so the jump isn't undone by the cursor position.
				setDelta(ctx, state, { delta, baseDelta: delta, anchorBp: null });
			}
		},
	};
}
