import { type Stage, type KonvaWheelEvent } from 'svelte-konva';

export const handleWheel = (e: KonvaWheelEvent, stageRef: Stage | undefined | null) => {
	e.evt.preventDefault();
	if (!stageRef) return;

	const stage = stageRef.node;
	const oldScale = stage.scaleX();
	const pointer = stage.getPointerPosition();
	if (!pointer) return;

	const mousePointTo = {
		x: (pointer.x - stage.x()) / oldScale,
		y: (pointer.y - stage.y()) / oldScale,
	};

	// how to scale? Zoom in? Or zoom out?
	let direction = e.evt.deltaY > 0 ? 1 : -1;

	// when we zoom on trackpad, e.evt.ctrlKey is true
	// in that case lets revert direction
	if (e.evt.ctrlKey) {
		direction = -direction;
	}

	const scaleBy = 1.3;
	const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

	stage.scale({ x: newScale, y: newScale });

	const newPos = {
		x: pointer.x - mousePointTo.x * newScale,
		y: pointer.y - mousePointTo.y * newScale,
	};
	stage.position(newPos);
};
