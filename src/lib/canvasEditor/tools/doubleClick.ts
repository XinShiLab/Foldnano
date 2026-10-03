export type ClickAction = () => void;

export interface DoubleClickOptions {
	windowMs?: number;
	maxDistPx?: number;
}

export function createDoubleClickDetector(opts?: DoubleClickOptions) {
	const windowMs = opts?.windowMs ?? 150;
	const maxDist = opts?.maxDistPx ?? 6;

	let lastAt = 0;
	let lastPos = { x: 0, y: 0 };
	let timer: number | null = null;
	// new: store undo for optimistic single
	type Undo = () => void;
	let pendingUndo: Undo | null = null;

	function clearTimer() {
		if (timer != null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function pushClick(x: number, y: number, onSingle: ClickAction, onDouble: ClickAction) {
		const now = performance.now();
		const dt = now - lastAt;
		const dx = x - lastPos.x;
		const dy = y - lastPos.y;
		const isDbl = !!lastAt && dt <= windowMs && dx * dx + dy * dy <= maxDist * maxDist;

		if (isDbl) {
			clearTimer();
			onDouble();
			lastAt = 0;
			return;
		}

		clearTimer();
		timer = window.setTimeout(() => {
			onSingle();
			timer = null;
		}, windowMs);

		lastAt = now;
		lastPos = { x, y };
	}

	// new: immediate single with undo on double
	function pushClickImmediate(
		x: number,
		y: number,
		doImmediateSingle: () => void | Undo,
		onDouble: ClickAction
	) {
		const now = performance.now();
		const dt = now - lastAt;
		const dx = x - lastPos.x;
		const dy = y - lastPos.y;
		const isDbl = !!lastAt && dt <= windowMs && dx * dx + dy * dy <= maxDist * maxDist;

		if (isDbl) {
			clearTimer();
			if (pendingUndo) {
				pendingUndo();
				pendingUndo = null;
			}
			onDouble();
			lastAt = 0;
			return;
		}

		clearTimer();
		// do single immediately and keep its undo if provided
		const undo = doImmediateSingle();
		pendingUndo = typeof undo === 'function' ? undo : null;

		// if no second click comes, finalize by just clearing state after window
		timer = window.setTimeout(() => {
			pendingUndo = null;
			timer = null;
		}, windowMs);

		lastAt = now;
		lastPos = { x, y };
	}

	function cancelPending() {
		clearTimer();
		// if you want cancel to also undo the optimistic action:
		if (pendingUndo) {
			pendingUndo();
			pendingUndo = null;
		}
		lastAt = 0;
	}

	return { pushClick, pushClickImmediate, cancelPending };
}
