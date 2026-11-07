import type { PosedFrame } from './framePose';

/**
 * Running mean of posed frames. Frames are already rigid-fit onto the design, so averaging the
 * sites directly gives the mean structure in the design's frame (one pass, no re-alignment).
 */
export class MeanStructureAccumulator {
	private readonly _backbone: Float64Array;
	private readonly _base: Float64Array;
	private _count = 0;

	constructor(nucleotideCount: number) {
		this._backbone = new Float64Array(nucleotideCount * 3);
		this._base = new Float64Array(nucleotideCount * 3);
	}

	get count(): number {
		return this._count;
	}

	add(pose: PosedFrame): void {
		for (let i = 0; i < this._backbone.length; i++) {
			this._backbone[i] += pose.backboneNm[i];
			this._base[i] += pose.baseNm[i];
		}
		this._count++;
	}

	result(): PosedFrame {
		const k = this._count || 1;
		return {
			backboneNm: Float32Array.from(this._backbone, (v) => v / k),
			baseNm: Float32Array.from(this._base, (v) => v / k),
		};
	}
}
