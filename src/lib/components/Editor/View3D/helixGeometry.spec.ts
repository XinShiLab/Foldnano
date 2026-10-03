import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import {
	buildPhysicalOffsetMaps,
	getSegmentEndPhysicalIndex,
	getSegmentPhysicalRange,
} from '$lib/model/geometry3d/dnaGeometry';
import { buildScene, stressToColor } from './helixGeometry';

function withMockCanvas<T>(fn: () => T): T {
	const originalGetContext = HTMLCanvasElement.prototype.getContext;
	const mockContext = {
		clearRect() {},
		fillText() {},
		fillStyle: '',
		font: '',
		textAlign: 'center',
		textBaseline: 'middle',
	} as unknown as CanvasRenderingContext2D;
	HTMLCanvasElement.prototype.getContext = (() =>
		mockContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
	try {
		return fn();
	} finally {
		HTMLCanvasElement.prototype.getContext = originalGetContext;
	}
}

describe('3D insert/skip physical geometry helpers', () => {
	it('preserves ideal bp indices when insert/skip effects are disabled', () => {
		const part = makeHoneycombPart('ideal');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 10);
		const seg = [...oligo.segments][0];
		seg.skipsAndInserts = [
			[2, 3],
			[7, -1],
		];

		const offsets = buildPhysicalOffsetMaps(part);
		const range = getSegmentPhysicalRange(seg, false, offsets);

		expect(range).toEqual({ lo: 0, hi: 10, totalNts: 11 });
		expect(getSegmentEndPhysicalIndex(seg, 'fivePrime', false, offsets)).toBe(0);
		expect(getSegmentEndPhysicalIndex(seg, 'threePrime', false, offsets)).toBe(10);
	});

	it('adds inserted nucleotides to rendered length and endpoint phase', () => {
		const part = makeHoneycombPart('insert');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 10);
		const seg = [...oligo.segments][0];
		seg.skipsAndInserts = [[5, 4]];

		const offsets = buildPhysicalOffsetMaps(part);
		const range = getSegmentPhysicalRange(seg, true, offsets);

		expect(seg.totalNucleotides).toBe(15);
		expect(range).toEqual({ lo: 0, hi: 14, totalNts: 15 });
		expect(getSegmentEndPhysicalIndex(seg, 'threePrime', true, offsets)).toBe(14);
	});

	it('removes skipped nucleotides from rendered length and endpoint phase', () => {
		const part = makeHoneycombPart('skip');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 10);
		const seg = [...oligo.segments][0];
		seg.skipsAndInserts = [[5, -1]];

		const offsets = buildPhysicalOffsetMaps(part);
		const range = getSegmentPhysicalRange(seg, true, offsets);

		expect(seg.totalNucleotides).toBe(10);
		expect(range).toEqual({ lo: 0, hi: 9, totalNts: 10 });
		expect(getSegmentEndPhysicalIndex(seg, 'threePrime', true, offsets)).toBe(9);
	});

	it('handles reverse-orientation strand endpoints with physical indices', () => {
		const part = makeHoneycombPart('reverse');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 10, 0);
		const seg = [...oligo.segments][0];
		seg.skipsAndInserts = [[5, 2]];

		const offsets = buildPhysicalOffsetMaps(part);
		const range = getSegmentPhysicalRange(seg, true, offsets);

		expect(range).toEqual({ lo: 0, hi: 12, totalNts: 13 });
		expect(getSegmentEndPhysicalIndex(seg, 'fivePrime', true, offsets)).toBe(12);
		expect(getSegmentEndPhysicalIndex(seg, 'threePrime', true, offsets)).toBe(0);
	});
});

describe('3D crossover stress colors', () => {
	it('keeps length ratios at or below rest length green', () => {
		expect(stressToColor(0).getHexString()).toBe('00cc44');
		expect(stressToColor(0.5).getHexString()).toBe('00cc44');
		expect(stressToColor(1).getHexString()).toBe('00cc44');
	});

	it('maps 5x rest length to yellow and 10x rest length to red', () => {
		expect(stressToColor(5).getHexString()).toBe('ffcc00');
		expect(stressToColor(10).getHexString()).toBe('ff2222');
		expect(stressToColor(20).getHexString()).toBe('ff2222');
	});
});

describe('3D strand selection emphasis', () => {
	it('dims non-focused strand segments while keeping focused ones solid', () => {
		const part = makeHoneycombPart('focus');
		const vh = addLatticeVh(part, 0, 0);
		const oligoA = part.createOligo(vh, 0, 10, '#ff0000');
		const _oligoB = part.createOligo(vh, 15, 25, '#00ff00');
		const segA = [...oligoA.segments][0];

		withMockCanvas(() => {
			// Regular strand rendering: focus dimming emits raw-color fat lines (the NT model
			// uses watercolor tubes instead). Focus/dim logic is shared across both modes.
			const { group } = buildScene(part, false, undefined, null, new Set([segA]));
			const strandLines = group.children.filter(
				(child) => child instanceof LineSegments2
			) as LineSegments2[];
			const redLine = strandLines.find(
				(line) => (line.material as LineMaterial).color.getHexString() === 'ff0000'
			);
			const greenLine = strandLines.find(
				(line) => (line.material as LineMaterial).color.getHexString() === '00ff00'
			);

			expect(redLine).toBeDefined();
			expect((redLine!.material as LineMaterial).opacity).toBe(1);
			expect(greenLine).toBeDefined();
			expect((greenLine!.material as LineMaterial).transparent).toBe(true);
			expect((greenLine!.material as LineMaterial).opacity).toBe(0.25);
		});
	});

	it('renders the NT model as watercolor backbone tubes and base-pair rungs', () => {
		const part = makeHoneycombPart('nt-model');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 5, '#ff0000');
		const complement = part.createOligo(vh, 5, 0, '#00ff00');
		const seg = [...oligo.segments][0];
		const compSeg = [...complement.segments][0];
		seg.skipsAndInserts = [[2, 1]];
		compSeg.skipsAndInserts = [[2, 1]];

		withMockCanvas(() => {
			const { group } = buildScene(part, true);

			// One watercolor backbone tube per contiguous (segment, strand) run — both
			// strands of the duplex.
			const tubes = group.children.filter(
				(child) => child.userData.kind === 'nt-model-backbone-tube'
			);
			expect(tubes).toHaveLength(2);

			// Base-pair rungs: 6 bp + 1 insert = 7 paired layers. Sequence is unassigned, so
			// every rung shares one tone bucket → a single LineSegments2 of 7 segments.
			const rungLines = group.children.filter(
				(child): child is LineSegments2 =>
					child instanceof LineSegments2 && child.userData.kind === 'nt-model-base-rungs'
			);
			expect(rungLines).toHaveLength(1);
			const rungSegments = (
				rungLines[0].geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute
			).count;
			expect(rungSegments).toBe(7);
		});
	});
});
