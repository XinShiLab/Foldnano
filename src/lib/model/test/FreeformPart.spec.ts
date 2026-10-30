import { addLatticeVh, addFreeformVh } from '$lib/model/test/testHelpers';
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import { FreeformRegion } from '$lib/model/Part/DesignRegion';
import {
	BACKBONE_RISE_NM,
	BACKBONE_RADIUS_NM,
	helixCenterPoint,
	backbonePoint,
	isFrameOrthonormal,
	normalizeFrame,
	normalizeVec,
	PERPENDICULAR_AXIS_DOT,
	referenceRadial0,
	rollDegOf,
	withRoll,
	type VirtualHelixFrame,
} from '$lib/model/geometry3d/dnaGeometry';
import { collectOxDnaNucleotides } from '$lib/model/io/oxdnaExport';

describe('VirtualHelixFrame roll helpers', () => {
	const inPlane: VirtualHelixFrame = {
		origin: { x: 1, y: 2, z: 0 },
		axis: { x: 0.6, y: 0.8, z: 0 },
		radial0: { x: 0, y: 0, z: 1 },
	};

	it('referenceRadial0: plane normal for in-plane axes, +X for axes along Z', () => {
		expect(referenceRadial0({ x: 1, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
		expect(referenceRadial0({ x: 0, y: 0, z: 1 })).toEqual({ x: 1, y: 0, z: 0 });
		expect(referenceRadial0({ x: 0, y: 0, z: -1 })).toEqual({ x: 1, y: 0, z: 0 });
	});

	it('a tilted helix the plane view draws as standing also takes +X as its roll 0', () => {
		const tilted = normalizeVec({ x: 0.3, y: 0, z: 0.954 });
		expect(Math.abs(tilted.z)).toBeGreaterThanOrEqual(PERPENDICULAR_AXIS_DOT);
		expect(referenceRadial0(tilted).x).toBeGreaterThan(0.9);
		const lying = normalizeVec({ x: 0.5, y: 0, z: 0.85 });
		expect(Math.abs(lying.z)).toBeLessThan(PERPENDICULAR_AXIS_DOT);
		expect(referenceRadial0(lying).z).toBeGreaterThan(0.5);
	});

	it('rollDegOf is 0 for the reference and round-trips through withRoll', () => {
		expect(rollDegOf(inPlane)).toBeCloseTo(0);
		for (const deg of [-135, -30, 45, 90, 180]) {
			const rolled = withRoll(inPlane, deg);
			expect(rollDegOf(rolled)).toBeCloseTo(deg);
			expect(rolled.origin).toEqual(inPlane.origin);
			expect(isFrameOrthonormal(rolled, 1e-9)).toBe(true);
		}
	});

	it('positive roll turns radial0 toward axis × radial0, the backbonePoint phase sense', () => {
		const rolled = withRoll({ ...inPlane, axis: { x: 0, y: 0, z: 1 } }, 90);
		expect(rolled.radial0.x).toBeCloseTo(0);
		expect(rolled.radial0.y).toBeCloseTo(1);
	});

	it('normalizeFrame orthogonalizes radial0 and rejects degenerate frames', () => {
		const fixed = normalizeFrame({
			origin: { x: 0, y: 0, z: 0 },
			axis: { x: 0, y: 0, z: 2 },
			radial0: { x: 1, y: 0, z: 1 },
		});
		expect(fixed.axis).toEqual({ x: 0, y: 0, z: 1 });
		expect(fixed.radial0).toEqual({ x: 1, y: 0, z: 0 });
		expect(() => normalizeFrame({ ...fixed, axis: { x: 0, y: 0, z: 0 } })).toThrow();
		expect(() => normalizeFrame({ ...fixed, radial0: { x: 0, y: 0, z: 3 } })).toThrow();
	});
});

describe('VirtualHelixFrame geometry helpers', () => {
	it('helixCenterPoint: +Z axis shifts z with bp index', () => {
		const frame: VirtualHelixFrame = {
			origin: { x: 0, y: 0, z: 5 },
			axis: { x: 0, y: 0, z: 1 },
			radial0: { x: 1, y: 0, z: 0 },
		};
		const pt = helixCenterPoint(frame, 10);
		expect(pt.x).toBeCloseTo(0);
		expect(pt.y).toBeCloseTo(0);
		expect(pt.z).toBeGreaterThan(5);
	});

	it('helixCenterPoint: +X axis shifts x with bp index', () => {
		const frame: VirtualHelixFrame = {
			origin: { x: 0, y: 0, z: 0 },
			axis: { x: 1, y: 0, z: 0 },
			radial0: { x: 0, y: 0, z: 1 },
		};
		const pt = helixCenterPoint(frame, 10);
		expect(pt.x).toBeGreaterThan(0);
		expect(pt.z).toBeCloseTo(0);
	});

	it('backbonePoint: +Z frame matches backbonePointNm convention', () => {
		const hx = 1.3,
			hy = 2.6;
		const frame: VirtualHelixFrame = {
			origin: { x: hx, y: hy, z: 0 },
			axis: { x: 0, y: 0, z: 1 },
			radial0: { x: 1, y: 0, z: 0 },
		};
		const bpIdx = 5;
		const twistOffset = 0,
			twistPerBase = 34.286;
		const pt = backbonePoint(frame, bpIdx, 0, twistOffset, twistPerBase);
		// z should equal bpIdx * BACKBONE_RISE_NM
		expect(pt.z).toBeCloseTo(bpIdx * BACKBONE_RISE_NM, 5);
		// x/y offset should be BACKBONE_RADIUS_NM from helix center
		const distFromAxis = Math.sqrt((pt.x - hx) ** 2 + (pt.y - hy) ** 2);
		expect(distFromAxis).toBeCloseTo(BACKBONE_RADIUS_NM, 5);
	});

	it('backbonePoint: strand 0 and strand 1 are 180° apart', () => {
		const frame: VirtualHelixFrame = {
			origin: { x: 0, y: 0, z: 0 },
			axis: { x: 0, y: 0, z: 1 },
			radial0: { x: 1, y: 0, z: 0 },
		};
		const pt0 = backbonePoint(frame, 0, 0, 0, 34.286);
		const pt1 = backbonePoint(frame, 0, 1, 0, 34.286);
		// The two radials should be exactly opposite
		expect(pt0.x + pt1.x).toBeCloseTo(0, 5);
		expect(pt0.y + pt1.y).toBeCloseTo(0, 5);
	});
});

describe('FreeformPart', () => {
	let doc: FoldnanoDocument;
	let part: Part;

	beforeEach(() => {
		doc = new FoldnanoDocument();
		part = doc.addNewPart('FREEFORM');
	});

	it('potentialXoverSites returns empty arrays', () => {
		addFreeformVh(part, [0, 0, 0]);
		const sites = part.potentialXoverSites(0);
		expect(sites).toEqual([[], []]);
	});

	it('addNewVirtualHelixAt stores localFrame on vh', () => {
		const vh = addFreeformVh(part, [3, 4, 5]);
		expect(vh.localFrame).toBeDefined();
		expect(vh.localFrame!.origin).toEqual({ x: 3, y: 4, z: 5 });
		expect(vh.localFrame!.axis).toEqual({ x: 0, y: 0, z: 1 });
		expect(vh.localFrame!.radial0).toEqual({ x: 1, y: 0, z: 0 });
	});

	it('addNewVirtualHelixAt with custom direction normalizes axis', () => {
		const vh = addFreeformVh(part, [0, 0, 0], [0, 0, 2]); // not unit length
		const ax = vh.localFrame!.axis;
		const len = Math.sqrt(ax.x ** 2 + ax.y ** 2 + ax.z ** 2);
		expect(len).toBeCloseTo(1, 5);
	});

	it('getVirtualHelixFrame returns the plane-composed lab frame', () => {
		const vh = addFreeformVh(part, [1, 2, 3]);
		const frame = part.getVirtualHelixFrame(vh);
		expect(frame.origin).toEqual({ x: 1, y: 2, z: 3 });
	});

	it('default region delegates geometry for freeform VHs', () => {
		const vh = addFreeformVh(part, [2, 3, 4]);
		const frame = part.getDefaultRegion().getVirtualHelixFrame(vh);
		expect(frame.origin).toEqual({ x: 2, y: 3, z: 4 });
	});

	it('getVirtualHelixFrame on latticed VH returns +Z frame', () => {
		const latticeDoc = new FoldnanoDocument();
		const latticePart = latticeDoc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(latticePart, 0, 0);
		const frame = latticePart.getVirtualHelixFrame(vh);
		expect(frame.axis).toEqual({ x: 0, y: 0, z: 1 });
		expect(frame.radial0).toEqual({ x: 1, y: 0, z: 0 });
	});

	it('default region delegates geometry for latticed VHs', () => {
		const latticeDoc = new FoldnanoDocument();
		const latticePart = latticeDoc.addNewPart('SQUARE');
		const vh = addLatticeVh(latticePart, 2, 3);
		const fromPart = latticePart.getVirtualHelixFrame(vh);
		const fromRegion = latticePart.getDefaultRegion().getVirtualHelixFrame(vh);
		expect(fromRegion).toEqual(fromPart);
	});

	it('moveVirtualHelix updates origin while preserving axis', () => {
		const vh = addFreeformVh(part, [0, 0, 0], [0, 1, 0]);
		const originalAxis = { ...vh.localFrame!.axis };
		(part.getDefaultRegion() as FreeformRegion).moveVh(part, vh, 5, 6);
		expect(vh.localFrame!.origin.x).toBeCloseTo(5);
		expect(vh.localFrame!.origin.y).toBeCloseTo(6);
		expect(vh.localFrame!.axis).toEqual(originalAxis);
	});

	it('plane translation changes computed freeform lab frame without mutating localFrame', () => {
		const vh = addFreeformVh(part, [1, 2, 3]);
		part.getDefaultPlane().origin = { x: 10, y: -2, z: 5 };

		expect(vh.localFrame!.origin).toEqual({ x: 1, y: 2, z: 3 });
		expect(part.getVirtualHelixFrame(vh).origin).toEqual({ x: 11, y: 0, z: 8 });
	});

	it('plane translation changes computed lattice lab frame', () => {
		const latticeDoc = new FoldnanoDocument();
		const latticePart = latticeDoc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(latticePart, 0, 0);
		latticePart.getDefaultPlane().origin = { x: 7, y: 8, z: 9 };

		expect(latticePart.getVirtualHelixFrame(vh).origin).toEqual({ x: 7, y: 8, z: 9 });
	});

	it('default region owns step, subStepSize, and maxBase', () => {
		const region = part.getDefaultRegion();
		expect(part.step).toBe(region.step);
		expect(part.subStepSize).toBe(region.subStepSize);
		expect(part.maxBase).toBe(region.maxBase);
	});
});

describe('FreeformPart oxDNA export', () => {
	it('a3 points toward 5-prime end for strand 0', () => {
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('FREEFORM');
		const vh = addFreeformVh(part, [0, 0, 0], [0, 0, 1]);
		part.createOligo(vh, 0, 20, '#ff0000');

		const nts = collectOxDnaNucleotides(part);
		expect(nts.length).toBeGreaterThan(0);
		// oxDNA: a3 points toward the 5' end. Strand 0 ascends in +Z, so 5' is at lower Z → a3 ≈ -Z.
		for (const nt of nts) {
			expect(nt.a3.z).toBeLessThan(-0.9); // ≈ -1
		}
	});

	it('a3 points toward 5-prime end for strand 1 (antiparallel)', () => {
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('FREEFORM');
		const vh = addFreeformVh(part, [0, 0, 0], [0, 0, 1]);
		// Strand 1: threePrime < fivePrime
		part.createOligo(vh, 20, 0, '#00ff00');

		const nts = collectOxDnaNucleotides(part);
		expect(nts.length).toBeGreaterThan(0);
		// Strand 1 descends along +Z axis, so 5' is at higher Z → a3 ≈ +Z.
		for (const nt of nts) {
			expect(nt.a3.z).toBeGreaterThan(0.9); // ≈ +1
		}
	});
});
