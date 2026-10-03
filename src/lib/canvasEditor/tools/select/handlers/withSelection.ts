import type { HandlerInstance, WorldPt } from '../../types';
import { isDefined } from '../selectUtils';
import {
	commitMovingEnds,
	resetMoveState,
	startMovingEnds,
	updateMovingEnds,
	removeMoveEndBox,
	type MoveEndState,
} from './movingEndsOps';
import { clearAllTempParts } from './drawTempPartsOps';
import type { SegmentEnd } from '$lib/model/Oligo';

export function createWithSelectionHandler(): HandlerInstance {
	let downWorld: WorldPt | null = null;
	let pendingMove: { refIdx: number; ends: SegmentEnd[] } | null = null;
	const movingEnds: MoveEndState = {
		isMoving: false,
		endsToBeMoved: [],
		fromRefIdx: -1,
		toRefIdx: -1,
		tempById: new Map(),
	};

	return {
		kind: 'WITH_SELECTION',

		predicate: ({ ctx }) => ctx.strandCtx.selected.ends.size > 0,

		down(evt, ctx) {
			if (evt.button !== 0) return false;
			downWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const hitXAsBpPos = ctx.hit.hitXAsBpPos(downWorld);
			if (!isDefined(hitXAsBpPos)) return false;
			const allSelectedEnds = Array.from(ctx.strandCtx.selected.ends);
			if (allSelectedEnds.length === 0) return false;
			// Defer MoveEndBox creation until the user actually drags
			pendingMove = { refIdx: hitXAsBpPos, ends: allSelectedEnds };
			return true;
		},

		move(evt, ctx) {
			// Lazy init: only create previews once the user starts dragging
			if (pendingMove) {
				startMovingEnds(ctx, pendingMove.refIdx, pendingMove.ends, movingEnds);
				pendingMove = null;
			}
			if (!movingEnds.isMoving) return true;
			const curWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const hitBp = ctx.hit.hitXAsBpPos(curWorld);
			if (isDefined(hitBp)) updateMovingEnds(ctx, hitBp, movingEnds);
			return true;
		},

		up(evt, ctx) {
			pendingMove = null;
			if (!movingEnds.isMoving) return true;
			commitMovingEnds(ctx, movingEnds); // includes reset + removes MoveEndBox
			clearAllTempParts(ctx); // clear any other temp parts if present
			downWorld = null;
			return true;
		},

		cancel(evt, ctx) {
			pendingMove = null;
			resetMoveState(ctx, movingEnds);
			removeMoveEndBox(ctx);
			downWorld = null;
			return true;
		},

		reset(ctx) {
			pendingMove = null;
			if (movingEnds.isMoving && ctx) {
				// If we still have an active drag when losing capture, commit to avoid dangling boxes.
				commitMovingEnds(ctx, movingEnds);
			} else if (ctx) {
				resetMoveState(ctx, movingEnds);
				removeMoveEndBox(ctx);
			}
			downWorld = null;
		},
	};
}
