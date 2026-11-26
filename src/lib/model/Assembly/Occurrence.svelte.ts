import { v4 as uuidv4 } from 'uuid';

export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/** Rigid placement of an occurrence in lab coordinates: rotate by `quaternion` ([x, y, z, w]),
 * then translate by `position` (nm). Same shape as an overlay placement's transform. */
export interface OccurrenceTransform {
	position: Vec3;
	quaternion: [number, number, number, number];
}

export interface OccurrenceJSON {
	id: string;
	partId: string;
	name: string;
	transform: OccurrenceTransform;
	visible: boolean;
}

export const IDENTITY_TRANSFORM: Readonly<OccurrenceTransform> = Object.freeze({
	position: Object.freeze({ x: 0, y: 0, z: 0 }),
	quaternion: Object.freeze([0, 0, 0, 1]) as unknown as [number, number, number, number],
});

export function cloneTransform(transform: OccurrenceTransform): OccurrenceTransform {
	return {
		position: { ...transform.position },
		quaternion: [...transform.quaternion] as [number, number, number, number],
	};
}

/**
 * Length of a quaternion, computed after dividing by its largest component so huge finite values
 * can't overflow to Infinity. 0 for a zero quaternion; NaN only for a non-finite component.
 */
export function quaternionLength(q: readonly number[]): number {
	const scale = Math.max(...q.map(Math.abs));
	if (scale === 0 || !Number.isFinite(scale)) return scale === 0 ? 0 : NaN;
	return scale * Math.hypot(...q.map((c) => c / scale));
}

/** `transform` with its rotation scaled to unit length, so a placement never scales the Part. */
export function normalizedTransform(transform: OccurrenceTransform): OccurrenceTransform {
	const copy = cloneTransform(transform);
	const q = copy.quaternion;
	const scale = Math.max(...q.map(Math.abs));
	if (scale === 0 || !Number.isFinite(scale)) return copy;
	// Divide by the largest component first: squaring huge values would overflow.
	const scaled = q.map((c) => c / scale);
	const length = Math.hypot(...scaled);
	// Leave float noise alone so a saved file round-trips unchanged.
	if (Math.abs(scale * length - 1) > 1e-9) {
		copy.quaternion = scaled.map((c) => c / length) as OccurrenceTransform['quaternion'];
	}
	return copy;
}

/** One placed copy of a Part definition in the assembly. Several occurrences may share a Part. */
export class Occurrence {
	readonly id: string;
	readonly partId: string;
	name: string = $state('');
	transform: OccurrenceTransform = $state.raw(cloneTransform(IDENTITY_TRANSFORM));
	visible: boolean = $state(true);

	constructor(
		partId: string,
		name: string,
		options: { id?: string; transform?: OccurrenceTransform; visible?: boolean } = {}
	) {
		this.id = options.id ?? uuidv4();
		this.partId = partId;
		this.name = name;
		if (options.transform) this.transform = cloneTransform(options.transform);
		if (options.visible !== undefined) this.visible = options.visible;
	}

	toJSON(): OccurrenceJSON {
		return {
			id: this.id,
			partId: this.partId,
			name: this.name,
			transform: cloneTransform(this.transform),
			visible: this.visible,
		};
	}

	static fromJSON(json: OccurrenceJSON): Occurrence {
		return new Occurrence(json.partId, json.name, {
			id: json.id,
			transform: normalizedTransform(json.transform),
			visible: json.visible,
		});
	}
}
