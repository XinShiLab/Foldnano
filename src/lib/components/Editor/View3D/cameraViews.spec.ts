import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
	CUBE_FACES,
	axisTriad,
	projectOnCube,
	triadAxisInFront,
	dirAxes,
	cellDir,
	cubeCssTransform,
	dirKey,
	dirLabel,
	faceCssTransform,
	faceRight,
	fitDistance,
	isFaceOn,
	rollQuaternion,
	poseQuaternion,
	posePosition,
	tweenPose,
	upForDir,
	type CubeDir,
} from './cameraViews';

const face = (label: string) => CUBE_FACES.find((f) => f.label === label)!;
const v = (d: CubeDir) => new THREE.Vector3(...d);
const clean = (d: CubeDir) => d.map((c) => c + 0); // -0 → 0

function parseMatrix(css: string): THREE.Matrix4 {
	const nums = css.slice('matrix3d('.length, -1).split(',').map(Number);
	return new THREE.Matrix4().fromArray(nums);
}

describe('cube faces', () => {
	it('follows the CAD convention: front from -Y, right from +X, top from +Z', () => {
		expect(face('Front').normal).toEqual([0, -1, 0]);
		expect(face('Right').normal).toEqual([1, 0, 0]);
		expect(face('Top').normal).toEqual([0, 0, 1]);
		expect(clean(faceRight(face('Front')))).toEqual([1, 0, 0]);
		expect(clean(faceRight(face('Top')))).toEqual([1, 0, 0]);
		expect(clean(faceRight(face('Right')))).toEqual([0, 1, 0]);
	});

	it('gives every face, edge and corner direction from the 3×3 cells, each shared by its faces', () => {
		const seen = new Map<string, number>();
		for (const f of CUBE_FACES)
			for (const row of [-1, 0, 1])
				for (const col of [-1, 0, 1]) {
					const key = dirKey(clean(cellDir(f, col, row)) as unknown as CubeDir);
					seen.set(key, (seen.get(key) ?? 0) + 1);
				}
		expect(seen.size).toBe(26);
		const counts = [...seen.entries()].map(([k, n]) => [
			k.split(',').filter((c) => c !== '0').length,
			n,
		]);
		for (const [nonZero, n] of counts) expect(n).toBe(nonZero); // face 1, edge 2, corner 3
	});

	it('maps the top-right cell of the front face to the front-right-top corner', () => {
		expect(clean(cellDir(face('Front'), 1, -1))).toEqual([1, -1, 1]);
		expect(dirLabel([1, -1, 1])).toBe('Front Right Top');
		expect(dirLabel([0, -1, 1])).toBe('Front Top');
		expect(dirLabel([0, 0, -1])).toBe('Bottom');
	});

	it('keeps +Z up except looking straight down or up', () => {
		expect(upForDir([1, -1, 1]).toArray()).toEqual([0, 0, 1]);
		expect(upForDir([0, 0, 1]).toArray()).toEqual([0, 1, 0]);
		expect(upForDir([0, 0, -1]).toArray()).toEqual([0, -1, 0]);
	});
});

describe('fitDistance', () => {
	const fov = 90; // tan(45°) = 1 keeps the numbers readable
	const box = new THREE.Box3(new THREE.Vector3(-10, -2, -1), new THREE.Vector3(10, 2, 1));
	const fit = (d: CubeDir, aspect = 1, margin = 1) =>
		fitDistance(box, v(d), upForDir(d), fov, aspect, margin);

	it('fits the extent seen from each side, plus half the depth', () => {
		expect(fit([0, -1, 0])).toBeCloseTo(10 + 2); // width 20 (x), depth 4 (y)
		expect(fit([1, 0, 0])).toBeCloseTo(2 + 10); // width 4 (y), height 2 (z), depth 20 (x)
		expect(fit([0, 0, 1])).toBeCloseTo(10 + 1); // width 20 (x), depth 2 (z)
	});

	it('accounts for a wide viewport and the margin', () => {
		expect(fit([0, -1, 0], 2)).toBeCloseTo(5 + 2);
		expect(fit([0, -1, 0], 2, 1.5)).toBeCloseTo(7.5 + 2);
	});

	it('handles diagonal views', () => {
		const cube = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
		const d = fitDistance(cube, v([1, -1, 1]), upForDir([1, -1, 1]), fov, 1, 1);
		expect(d).toBeGreaterThan(1);
		expect(Number.isFinite(d)).toBe(true);
	});
});

describe('camera poses', () => {
	it('looks at the target from the given side with the given up', () => {
		const q = poseQuaternion(v([0, -1, 0]), new THREE.Vector3(0, 0, 1));
		const pos = posePosition({ target: new THREE.Vector3(1, 2, 3), quaternion: q, distance: 5 });
		expect(pos.x).toBeCloseTo(1);
		expect(pos.y).toBeCloseTo(-3);
		expect(pos.z).toBeCloseTo(3);
		const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
		expect(camUp.z).toBeCloseTo(1);
	});

	it('tweens target, distance and orientation, reaching both ends exactly', () => {
		const a = {
			target: new THREE.Vector3(0, 0, 0),
			quaternion: poseQuaternion(v([0, -1, 0]), new THREE.Vector3(0, 0, 1)),
			distance: 10,
		};
		const b = {
			target: new THREE.Vector3(4, 0, 0),
			quaternion: poseQuaternion(v([1, 0, 0]), new THREE.Vector3(0, 0, 1)),
			distance: 20,
		};
		expect(tweenPose(a, b, 0).distance).toBe(10);
		const end = tweenPose(a, b, 1);
		expect(end.distance).toBe(20);
		expect(end.target.x).toBe(4);
		expect(end.quaternion.angleTo(b.quaternion)).toBeCloseTo(0);
		const mid = tweenPose(a, b, 0.5);
		expect(mid.distance).toBeCloseTo(15);
		expect(mid.quaternion.angleTo(a.quaternion)).toBeCloseTo(Math.PI / 4);
	});
});

describe('CSS transforms', () => {
	it('shows the front face facing the viewer when the camera looks from the front', () => {
		const q = poseQuaternion(v([0, -1, 0]), new THREE.Vector3(0, 0, 1));
		const cube = parseMatrix(cubeCssTransform(q));
		const front = parseMatrix(faceCssTransform(face('Front'), 10));
		const m = cube.multiply(front);
		// The element's own +z (its front side) must point at the viewer, its +x right, its +y down.
		const e = m.elements;
		expect([e[8], e[9], e[10]].map((c) => +c.toFixed(6) + 0)).toEqual([0, 0, 1]);
		expect([e[0], e[1], e[2]].map((c) => +c.toFixed(6) + 0)).toEqual([1, 0, 0]);
		expect([e[4], e[5], e[6]].map((c) => +c.toFixed(6) + 0)).toEqual([0, 1, 0]);
		expect(e[14]).toBeCloseTo(10);
	});

	it('shows the top face upright, with the front edge at the bottom, from above', () => {
		const q = poseQuaternion(v([0, 0, 1]), upForDir([0, 0, 1]));
		const m = parseMatrix(cubeCssTransform(q)).multiply(
			parseMatrix(faceCssTransform(face('Top'), 10))
		);
		const e = m.elements;
		expect([e[8], e[9], e[10]].map((c) => +c.toFixed(6) + 0)).toEqual([0, 0, 1]);
		expect([e[4], e[5], e[6]].map((c) => +c.toFixed(6) + 0)).toEqual([0, 1, 0]);
	});
});

describe('axis triad', () => {
	it('names the axes of a direction', () => {
		expect(dirAxes([0, -1, 0])).toBe('−Y');
		expect(dirAxes([1, -1, 1])).toBe('+X −Y +Z');
	});

	it('runs each positive axis along an edge from the front-left-bottom corner, just outside', () => {
		const triad = axisTriad(10, 2, 4, 3);
		expect(triad.map((a) => a.axis)).toEqual(['X', 'Y', 'Z']);
		const x = triad[0];
		expect(x.start.toArray()).toEqual([-12, -12, -12]);
		expect(x.end.toArray()).toEqual([-12 + 26, -12, -12]);
		expect(x.tip.toArray()).toEqual([-12 + 29, -12, -12]);
		// The X line runs along the edge shared by the front (-Y) and bottom (-Z) faces.
		expect(x.faceNormals.map((n) => n.toArray().map((c) => c + 0))).toEqual([
			[0, -1, 0],
			[0, 0, -1],
		]);
	});

	it('projects like the CSS cube: from the front, X goes right and Z up the screen', () => {
		const q = poseQuaternion(v([0, -1, 0]), upForDir([0, -1, 0]));
		const right = projectOnCube(q, new THREE.Vector3(10, 0, 0));
		const up = projectOnCube(q, new THREE.Vector3(0, 0, 10));
		expect(right.x).toBeCloseTo(10);
		expect(right.y).toBeCloseTo(0);
		expect(up.x).toBeCloseTo(0);
		expect(up.y).toBeCloseTo(-10);
		// Same place the CSS transform puts that point.
		const css = parseMatrix(cubeCssTransform(q)).elements;
		expect(css[0] * 10).toBeCloseTo(right.x);
		expect(css[1] * 10).toBeCloseTo(right.y);
	});

	it('puts a line in front only when a face along its edge faces the viewer', () => {
		const triad = axisTriad(10, 2, 4, 3);
		const front = poseQuaternion(v([0, -1, 0]), upForDir([0, -1, 0]));
		expect(triad.map((a) => triadAxisInFront(front, a))).toEqual([true, false, true]);
		const backRightTop = poseQuaternion(v([1, 1, 1]), upForDir([1, 1, 1]));
		expect(triad.map((a) => triadAxisInFront(backRightTop, a))).toEqual([false, false, false]);
		const frontLeftBottom = poseQuaternion(v([-1, -1, -1]), upForDir([-1, -1, -1]));
		expect(triad.map((a) => triadAxisInFront(frontLeftBottom, a))).toEqual([true, true, true]);
	});
});

describe('roll', () => {
	const front = poseQuaternion(v([0, -1, 0]), upForDir([0, -1, 0]));

	it('knows when the camera looks straight at a face', () => {
		expect(isFaceOn(front)).toBe(true);
		expect(isFaceOn(poseQuaternion(v([0, -1, 1]), upForDir([0, -1, 1])))).toBe(false);
		expect(isFaceOn(rollQuaternion(front, true))).toBe(true);
	});

	it('turns the picture a quarter clockwise or back, keeping the view direction', () => {
		const cw = rollQuaternion(front, true);
		// +Z pointed up the screen; clockwise it now points right.
		const z = projectOnCube(cw, new THREE.Vector3(0, 0, 10));
		expect(z.x).toBeCloseTo(10);
		expect(z.y).toBeCloseTo(0);
		const ccw = projectOnCube(rollQuaternion(front, false), new THREE.Vector3(0, 0, 10));
		expect(ccw.x).toBeCloseTo(-10);
		const forward = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, 1).applyQuaternion(q);
		expect(forward(cw).distanceTo(forward(front))).toBeCloseTo(0);
		expect(rollQuaternion(cw, false).angleTo(front)).toBeCloseTo(0);
	});
});
