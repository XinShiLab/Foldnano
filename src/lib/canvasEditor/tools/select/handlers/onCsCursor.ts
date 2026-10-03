import type { HandlerInstance } from '../../types';
import { isDefined } from '../selectUtils';

export function createCsCursorHandler(): HandlerInstance {
	let cursorMoving = false;
	return {
		kind: 'CS_CURSOR',

		down(_evt, _ctx, _hit) {
			cursorMoving = true;
			return true;
		},
		move(evt, ctx) {
			const curWorld = ctx.camera.toWorld(evt.clientX, evt.clientY);
			if (cursorMoving) {
				const hitBp = ctx.hit.hitXAsBpPos(curWorld);
				const maxBase = ctx.editorCtx.activeRegion?.maxBase ?? ctx.part.maxBase;
				if (isDefined(hitBp) && hitBp >= 0 && hitBp < maxBase) {
					ctx.strandCtx.csCursorIdx = hitBp;
				}
				return true;
			}
			return;
		},
		up(_evt, _ctx) {
			if (cursorMoving) {
				cursorMoving = false;
			}
			return true;
		},
	};
}
