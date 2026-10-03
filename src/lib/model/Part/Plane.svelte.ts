import { v4 as uuidv4 } from 'uuid';
import type { VirtualHelixFrame } from '../geometry3d/dnaGeometry';

export interface PlaneVec3 {
	x: number;
	y: number;
	z: number;
}

export class Plane {
	readonly id: string;
	name: string;
	origin: PlaneVec3;
	u: PlaneVec3;
	v: PlaneVec3;
	normal: PlaneVec3;

	constructor(
		name = 'XY Plane',
		id?: string,
		origin: PlaneVec3 = { x: 0, y: 0, z: 0 },
		u: PlaneVec3 = { x: 1, y: 0, z: 0 },
		v: PlaneVec3 = { x: 0, y: 1, z: 0 },
		normal: PlaneVec3 = { x: 0, y: 0, z: 1 }
	) {
		this.id = id || uuidv4();
		this.name = $state(name);
		this.origin = $state(origin);
		this.u = $state(u);
		this.v = $state(v);
		this.normal = $state(normal);
	}

	toJSON() {
		return {
			id: this.id,
			name: this.name,
			origin: this.origin,
			u: this.u,
			v: this.v,
			normal: this.normal,
		};
	}

	static fromJSON(json: ReturnType<Plane['toJSON']>): Plane {
		return new Plane(json.name, json.id, json.origin, json.u, json.v, json.normal);
	}

	transformPoint(local: PlaneVec3): PlaneVec3 {
		return {
			x: this.origin.x + local.x * this.u.x + local.y * this.v.x + local.z * this.normal.x,
			y: this.origin.y + local.x * this.u.y + local.y * this.v.y + local.z * this.normal.y,
			z: this.origin.z + local.x * this.u.z + local.y * this.v.z + local.z * this.normal.z,
		};
	}

	transformVector(local: PlaneVec3): PlaneVec3 {
		return {
			x: local.x * this.u.x + local.y * this.v.x + local.z * this.normal.x,
			y: local.x * this.u.y + local.y * this.v.y + local.z * this.normal.y,
			z: local.x * this.u.z + local.y * this.v.z + local.z * this.normal.z,
		};
	}

	transformFrame(local: VirtualHelixFrame): VirtualHelixFrame {
		return {
			origin: this.transformPoint(local.origin),
			axis: this.transformVector(local.axis),
			radial0: this.transformVector(local.radial0),
		};
	}
}
