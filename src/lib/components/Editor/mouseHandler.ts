import { type Stage, type KonvaWheelEvent } from 'svelte-konva';
import { wheelDeltaPx } from '$lib/utils/wheel';

export type WheelGesture =
	| { readonly kind: 'zoom'; readonly direction: 1 | -1 }
	| { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
	| { readonly kind: 'none' };

export interface WheelContext {
	/** PAN tool active (Alt held switches to it too); `evt.altKey` counts even without focus. */
	readonly panMode: boolean;
	readonly pageWidth: number;
	readonly pageHeight: number;
}

/**
 * What a wheel event asks a 2D canvas to do. Ctrl/Cmd + wheel (and trackpad pinch, which arrives
 * as ctrl+wheel) always zooms. While panning, the wheel scrolls both ways; otherwise a vertical
 * wheel zooms and only a horizontal wheel, sideways swipe or Shift + wheel scrolls (sideways).
 */
export function classifyWheel(evt: WheelEvent, ctx: WheelContext): WheelGesture {
	const { deltaX, deltaY, deltaMode } = evt;
	if (evt.ctrlKey || evt.metaKey) {
		// Browser convention (wheel up zooms in), the reverse of the plain-wheel zoom below.
		return deltaY === 0 ? { kind: 'none' } : { kind: 'zoom', direction: deltaY > 0 ? -1 : 1 };
	}
	// Browsers that don't turn Shift + wheel into deltaX themselves (macOS does).
	const shiftOnly = evt.shiftKey && deltaX === 0;
	const rawDx = shiftOnly ? deltaY : deltaX;
	const rawDy = shiftOnly ? 0 : deltaY;
	const pan = (dx: number, dy: number): WheelGesture => ({
		kind: 'pan',
		dx: wheelDeltaPx(dx, deltaMode, ctx.pageWidth),
		dy: wheelDeltaPx(dy, deltaMode, ctx.pageHeight),
	});
	if (ctx.panMode || evt.altKey) {
		return rawDx === 0 && rawDy === 0 ? { kind: 'none' } : pan(rawDx, rawDy);
	}
	if (rawDx !== 0 && Math.abs(rawDx) > Math.abs(rawDy)) return pan(rawDx, 0);
	if (deltaY === 0) return { kind: 'none' };
	return { kind: 'zoom', direction: deltaY > 0 ? 1 : -1 };
}

export const handleWheel = (
	e: KonvaWheelEvent,
	stageRef: Stage | undefined | null,
	panMode: boolean
) => {
	e.evt.preventDefault();
	if (!stageRef) return;

	const stage = stageRef.node;
	const gesture = classifyWheel(e.evt, {
		panMode,
		pageWidth: stage.width(),
		pageHeight: stage.height(),
	});
	if (gesture.kind === 'none') return;
	if (gesture.kind === 'pan') {
		stage.position({ x: stage.x() - gesture.dx, y: stage.y() - gesture.dy });
		return;
	}

	const oldScale = stage.scaleX();
	const pointer = stage.getPointerPosition();
	if (!pointer) return;

	const mousePointTo = {
		x: (pointer.x - stage.x()) / oldScale,
		y: (pointer.y - stage.y()) / oldScale,
	};

	const scaleBy = 1.3;
	const newScale = gesture.direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

	stage.scale({ x: newScale, y: newScale });

	const newPos = {
		x: pointer.x - mousePointTo.x * newScale,
		y: pointer.y - mousePointTo.y * newScale,
	};
	stage.position(newPos);
};
