import { type Stage } from 'svelte-konva';

export interface Camera {
	toWorld(_x: number, _y: number): { x: number; y: number };
	// panBy(dx: number, dy: number): void;
	// zoomAt(factor: number, at: {x:number;y:number}): void;
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
	// panBy(dx: number, dy: number) {
	//   const pos = this.stage.position();
	//   this.stage.position({ x: pos.x + dx, y: pos.y + dy });
	//   this.stage.batchDraw();
	// }
	// zoomAt(factor: number, at: {x:number;y:number}) {
	//   const oldScale = this.stage.scaleX() || 1;
	//   const newScale = Math.max(0.1, Math.min(10, oldScale * factor));
	//   const pos = this.stage.position();
	//   this.stage.scale({ x: newScale, y: newScale });
	//   this.stage.position({
	//     x: at.x - (at.x - pos.x) * (newScale / oldScale),
	//     y: at.y - (at.y - pos.y) * (newScale / oldScale),
	//   });
	//   this.stage.batchDraw();
	// }
}
