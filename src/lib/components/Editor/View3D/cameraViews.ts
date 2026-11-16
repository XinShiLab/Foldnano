import * as THREE from 'three';

/** A view direction on the view cube: each component is -1, 0 or 1 (face, edge or corner). */
export type CubeDir = readonly [number, number, number];

export interface CubeFace {
	readonly label: string;
	/** Outward normal; the camera sits on this side when the face is clicked. */
	readonly normal: CubeDir;
	/** Up on screen when looking at this face. */
	readonly up: CubeDir;
}

// CAD convention for this Z-up scene: front from -Y, right from +X, top from +Z with +Y up.
export const CUBE_FACES: readonly CubeFace[] = [
	{ label: 'Front', normal: [0, -1, 0], up: [0, 0, 1] },
	{ label: 'Back', normal: [0, 1, 0], up: [0, 0, 1] },
	{ label: 'Right', normal: [1, 0, 0], up: [0, 0, 1] },
	{ label: 'Left', normal: [-1, 0, 0], up: [0, 0, 1] },
	{ label: 'Top', normal: [0, 0, 1], up: [0, 1, 0] },
	{ label: 'Bottom', normal: [0, 0, -1], up: [0, -1, 0] },
];

const vec = (d: CubeDir) => new THREE.Vector3(d[0], d[1], d[2]);

/** Screen right when looking at a face: up × normal. */
export function faceRight(face: CubeFace): CubeDir {
	const r = vec(face.up).cross(vec(face.normal));
	return [Math.round(r.x), Math.round(r.y), Math.round(r.z)];
}

/**
 * View direction of a cell in a face's 3×3 grid; `col` runs left to right and `row` top to bottom,
 * each -1, 0 or 1. The centre is the face, the sides are its edges, the corners its corners.
 */
export function cellDir(face: CubeFace, col: number, row: number): CubeDir {
	const r = faceRight(face);
	const out = [0, 1, 2].map((i) => face.normal[i] + col * r[i] - row * face.up[i]);
	return [out[0], out[1], out[2]];
}

export function dirKey(d: CubeDir): string {
	return d.join(',');
}

/** Short name for a cube direction, such as "Front", "Front Top" or "Front Right Top". */
export function dirLabel(d: CubeDir): string {
	return CUBE_FACES.filter((f) => f.normal.every((c, i) => c === 0 || c === d[i]))
		.sort((a, b) => Math.abs(a.normal[2]) - Math.abs(b.normal[2]))
		.map((f) => f.label)
		.join(' ');
}

/** Camera up for a cube direction: +Z, except straight down or up, which use that face's up. */
export function upForDir(d: CubeDir): THREE.Vector3 {
	if (d[0] === 0 && d[1] === 0) return vec(d[2] > 0 ? [0, 1, 0] : [0, -1, 0]);
	return new THREE.Vector3(0, 0, 1);
}

/**
 * Camera distance from the box centre at which the box, seen from `fromDir` with `up` on screen,
 * fits a perspective view of vertical field `fovDeg` and the given aspect, with `margin`
 * (1.2 = 20% extra) around it.
 */
export function fitDistance(
	box: THREE.Box3,
	fromDir: THREE.Vector3,
	up: THREE.Vector3,
	fovDeg: number,
	aspect: number,
	margin: number
): number {
	const size = box.getSize(new THREE.Vector3());
	const f = fromDir.clone().normalize();
	const right = new THREE.Vector3().crossVectors(up, f).normalize();
	const screenUp = new THREE.Vector3().crossVectors(f, right);
	const extent = (axis: THREE.Vector3) =>
		Math.abs(size.x * axis.x) + Math.abs(size.y * axis.y) + Math.abs(size.z * axis.z);
	const halfH = Math.max(extent(screenUp), 1) / 2;
	const halfW = Math.max(extent(right), 1) / 2;
	const halfDepth = extent(f) / 2;
	const tanV = Math.tan((fovDeg * Math.PI) / 360);
	const dist = Math.max(halfH / tanV, halfW / (tanV * Math.max(aspect, 1e-3))) * margin;
	return dist + halfDepth;
}

export interface CameraPose {
	target: THREE.Vector3;
	quaternion: THREE.Quaternion;
	distance: number;
}

/** Orientation of a camera at `fromDir` from its target, looking at it with `up` on screen. */
export function poseQuaternion(fromDir: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
	const m = new THREE.Matrix4().lookAt(fromDir, new THREE.Vector3(), up);
	return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Whether a camera with this orientation looks straight at one of the cube's faces. */
export function isFaceOn(cameraQuaternion: THREE.Quaternion): boolean {
	const f = new THREE.Vector3(0, 0, 1).applyQuaternion(cameraQuaternion);
	return Math.max(Math.abs(f.x), Math.abs(f.y), Math.abs(f.z)) > 0.9995;
}

/** The camera turned a quarter about its view axis, so the picture turns clockwise (or not). */
export function rollQuaternion(
	cameraQuaternion: THREE.Quaternion,
	clockwise: boolean
): THREE.Quaternion {
	const roll = new THREE.Quaternion().setFromAxisAngle(
		new THREE.Vector3(0, 0, 1),
		clockwise ? Math.PI / 2 : -Math.PI / 2
	);
	return cameraQuaternion.clone().multiply(roll);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Camera position for a pose: `distance` back along the camera's view axis from its target. */
export function posePosition(pose: CameraPose): THREE.Vector3 {
	return new THREE.Vector3(0, 0, 1)
		.applyQuaternion(pose.quaternion)
		.multiplyScalar(pose.distance)
		.add(pose.target);
}

/**
 * Camera pose `t` (0–1) of the way from `a` to `b`, eased. The orientation turns along the
 * shortest arc and the position follows it, so the target stays centred throughout.
 */
export function tweenPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
	const k = easeInOut(Math.min(Math.max(t, 0), 1));
	return {
		target: a.target.clone().lerp(b.target, k),
		quaternion: a.quaternion.clone().slerp(b.quaternion, k),
		distance: a.distance + (b.distance - a.distance) * k,
	};
}

// CSS lays out x right, y down, z toward the viewer; three's camera space has y up.
const FLIP_Y = new THREE.Matrix4().makeScale(1, -1, 1);

function cssMatrix(m: THREE.Matrix4): string {
	return `matrix3d(${m.elements.map((v) => +v.toFixed(6)).join(',')})`;
}

/** CSS transform that turns the cube the way the camera sees the world. */
export function cubeCssTransform(cameraQuaternion: THREE.Quaternion): string {
	const view = new THREE.Matrix4().makeRotationFromQuaternion(cameraQuaternion.clone().invert());
	return cssMatrix(FLIP_Y.clone().multiply(view).multiply(FLIP_Y));
}

/** CSS transform that places a face element (centred on the cube) on its side of the cube. */
export function faceCssTransform(face: CubeFace, halfSize: number): string {
	const n = vec(face.normal);
	const basis = new THREE.Matrix4().makeBasis(vec(faceRight(face)), vec(face.up).negate(), n);
	basis.setPosition(n.multiplyScalar(halfSize));
	return cssMatrix(FLIP_Y.clone().multiply(basis));
}

/** Axis directions of a cube direction, such as "+X −Y +Z". */
export function dirAxes(d: CubeDir): string {
	return d
		.map((c, i) => (c === 0 ? '' : `${c > 0 ? '+' : '−'}${'XYZ'[i]}`))
		.filter(Boolean)
		.join(' ');
}

export type Axis = 'X' | 'Y' | 'Z';

export interface TriadAxis {
	readonly axis: Axis;
	/** Line ends and the letter position, in world-aligned cube coordinates (pixels). */
	readonly start: THREE.Vector3;
	readonly end: THREE.Vector3;
	readonly tip: THREE.Vector3;
	/** Outward normals of the two faces sharing the edge the line runs along. */
	readonly faceNormals: readonly [THREE.Vector3, THREE.Vector3];
}

const AXES: readonly Axis[] = ['X', 'Y', 'Z'];

/**
 * Fusion-style XYZ triad on the cube's front-left-bottom corner: each positive axis runs along
 * the edge leaving that corner, `gapPx` outside the cube and `overshootPx` past its far end.
 */
export function axisTriad(
	halfSize: number,
	gapPx: number,
	overshootPx: number,
	labelGapPx: number
): TriadAxis[] {
	const start = new THREE.Vector3(-1, -1, -1).multiplyScalar(halfSize + gapPx);
	const length = 2 * halfSize + gapPx + overshootPx;
	return AXES.map((axis, i) => {
		const dir = new THREE.Vector3().setComponent(i, 1);
		return {
			axis,
			start: start.clone(),
			end: start.clone().addScaledVector(dir, length),
			tip: start.clone().addScaledVector(dir, length + labelGapPx),
			faceNormals: [
				new THREE.Vector3().setComponent((i + 1) % 3, -1),
				new THREE.Vector3().setComponent((i + 2) % 3, -1),
			],
		};
	});
}

/**
 * Where a world-aligned cube point lands on screen, in pixels from the cube's centre (y down),
 * as the cube is turned by `cubeCssTransform` (orthographic, like the CSS cube).
 */
export function projectOnCube(
	cameraQuaternion: THREE.Quaternion,
	point: THREE.Vector3
): { x: number; y: number } {
	const cam = point.clone().applyQuaternion(cameraQuaternion.clone().invert());
	return { x: cam.x, y: -cam.y };
}

/**
 * Whether a triad line belongs in front of the cube: its edge is on the visible side when either
 * face sharing it points toward the viewer. Otherwise the cube covers it.
 */
export function triadAxisInFront(cameraQuaternion: THREE.Quaternion, axis: TriadAxis): boolean {
	const inv = cameraQuaternion.clone().invert();
	return axis.faceNormals.some((n) => n.clone().applyQuaternion(inv).z > 0);
}
