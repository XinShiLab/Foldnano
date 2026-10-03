// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MrdnaOverlayParseError, parseMrdnaOverlay } from './externalStructureOverlay';

describe('parseMrdnaOverlay', () => {
	it('parses valid mrDNA rows with comments and sequence', () => {
		const overlay = parseMrdnaOverlay(
			[
				'# coord_x coord_y coord_z bp_idx stack_idx three_prime_idx seq',
				'0 0 0 1 1 1 A',
				'1 0 0 0 -1 -1 T',
			].join('\n'),
			'test.mrdna.txt'
		);

		expect(overlay.name).toBe('test.mrdna.txt');
		expect(overlay.format).toBe('mrdna');
		expect(overlay.nodes).toHaveLength(2);
		expect(overlay.nodes[0].base).toBe('A');
		expect(overlay.chainEdges).toEqual([{ from: 0, to: 1 }]);
		expect(overlay.stackEdges).toEqual([{ from: 0, to: 1 }]);
		expect(overlay.threePrimeTerminalIds).toEqual([1]);
		expect(overlay.stats).toMatchObject({
			nucleotideCount: 2,
			strandCount: 1,
			stackEdgeCount: 1,
		});
		expect(overlay.bounds.center).toEqual({ x: 0.5, y: 0, z: 0 });
	});

	it('parses optional orientation matrices', () => {
		const overlay = parseMrdnaOverlay('0 0 0 -1 -1 -1 G 1 0 0 0 1 0 0 0 1');

		expect(overlay.nodes[0].base).toBe('G');
		expect(overlay.nodes[0].orientation).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
	});

	it('rejects rows with fewer than six fields', () => {
		expect(() => parseMrdnaOverlay('0 0 0 -1 -1')).toThrow(MrdnaOverlayParseError);
		expect(() => parseMrdnaOverlay('0 0 0 -1 -1')).toThrow('Line 1');
	});

	it('rejects non-finite coordinates', () => {
		expect(() => parseMrdnaOverlay('NaN 0 0 -1 -1 -1')).toThrow('coord_x');
	});

	it('rejects out-of-range positive indices', () => {
		expect(() => parseMrdnaOverlay('0 0 0 -1 -1 2')).toThrow('outside the 1-nucleotide file');
	});

	it('accepts -1 sentinels in all index columns', () => {
		const overlay = parseMrdnaOverlay('0 0 0 -1 -1 -1');

		expect(overlay.chainEdges).toEqual([]);
		expect(overlay.stackEdges).toEqual([]);
		expect(overlay.threePrimeTerminalIds).toEqual([0]);
	});

	it('counts a circular strand as one strand', () => {
		// Nucleotides 0→1→2→0 form a loop (no 3′ terminals).
		const overlay = parseMrdnaOverlay(
			['0 0 0 -1 -1 1', '1 0 0 -1 -1 2', '2 0 0 -1 -1 0'].join('\n')
		);

		expect(overlay.threePrimeTerminalIds).toEqual([]);
		expect(overlay.stats.strandCount).toBe(1);
	});

	it('counts mixed linear and circular strands correctly', () => {
		// Two linear (0→1, 2→3) and one circular (4→5→4).
		const overlay = parseMrdnaOverlay(
			[
				'0 0 0 -1 -1 1',
				'1 0 0 -1 -1 -1',
				'2 0 0 -1 -1 3',
				'3 0 0 -1 -1 -1',
				'4 0 0 -1 -1 5',
				'5 0 0 -1 -1 4',
			].join('\n')
		);

		expect(overlay.stats.strandCount).toBe(3);
	});
});
