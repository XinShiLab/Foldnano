import { type Stage } from 'svelte-konva';

export interface Camera {
	toWorld(_x: number, _y: number): { x: number; y: number };
}

export class KonvaCamera implements Camera {
	constructor(private stage: Stage) {}
	toWorld() {
		const p = this.stage.node.getStage().getRelativePointerPosition();
		return p ?? { x: 0, y: 0 };
	}
	get currentBounds() {
		const stage = this.stage.node.getStage();
		const scale = stage.scaleX() || 1;
		const pos = stage.position();
		const width = stage.width();
		const height = stage.height();
		return {
			x: -pos.x / scale,
			y: -pos.y / scale,
			width: width / scale,
			height: height / scale,
		};
	}
	get scale() {
		return this.stage.node.getStage().scaleX() || 1;
	}
}
