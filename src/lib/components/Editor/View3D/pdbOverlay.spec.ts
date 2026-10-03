// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PdbOverlayParseError, parsePdbOverlay } from './pdbOverlay';

/** Assemble a fixed-column PDB ATOM/HETATM record (cols 1–54). */
function atom(opts: {
	record?: 'ATOM' | 'HETATM';
	serial?: number;
	name?: string;
	altLoc?: string;
	resName?: string;
	chain: string;
	resSeq?: number;
	x: number;
	y: number;
	z: number;
}): string {
	const fmt = (n: number) => n.toFixed(3).padStart(8);
	return (
		(opts.record ?? 'ATOM').padEnd(6) + // 1–6
		String(opts.serial ?? 1).padStart(5) + // 7–11
		' ' + // 12
		(' ' + (opts.name ?? 'CA').padEnd(3)) + // 13–16
		(opts.altLoc ?? ' ') + // 17
		(opts.resName ?? 'ALA').padEnd(3) + // 18–20
		' ' + // 21
		opts.chain + // 22
		String(opts.resSeq ?? 1).padStart(4) + // 23–26
		' ' + // 27
		'   ' + // 28–30
		fmt(opts.x) + // 31–38
		fmt(opts.y) + // 39–46
		fmt(opts.z) // 47–54
	);
}

/** A minimal TER record carrying a chain id in col 22. */
function ter(chain: string): string {
	return 'TER'.padEnd(21) + chain;
}

describe('parsePdbOverlay', () => {
	it('extracts Cα per chain and scales Å → nm', () => {
		const overlay = parsePdbOverlay(
			[
				atom({ chain: 'A', resSeq: 1, x: 10, y: 0, z: 0 }),
				atom({ chain: 'A', resSeq: 2, x: 20, y: 0, z: 0 }),
				atom({ chain: 'B', resSeq: 1, x: 0, y: 30, z: 0 }),
			].join('\n'),
			'test.pdb'
		);

		expect(overlay.name).toBe('test.pdb');
		expect(overlay.format).toBe('pdb');
		expect(overlay.chains).toHaveLength(2);
		expect(overlay.chains.map((c) => c.id)).toEqual(['A', 'B']);
		// Consecutive residues form one segment.
		expect(overlay.chains[0].segments).toHaveLength(1);
		expect(overlay.chains[0].segments[0]).toHaveLength(2);
		// 10 Å → 1 nm
		expect(overlay.chains[0].segments[0][0]).toEqual({ x: 1, y: 0, z: 0 });
		expect(overlay.stats).toMatchObject({ chainCount: 2, residueCount: 3 });
		expect(overlay.bounds.center).toEqual({ x: 1, y: 1.5, z: 0 });
	});

	it('ignores non-Cα atoms and HETATM records', () => {
		const overlay = parsePdbOverlay(
			[
				atom({ chain: 'A', name: 'N', x: 0, y: 0, z: 0 }),
				atom({ chain: 'A', name: 'CA', x: 10, y: 0, z: 0 }),
				atom({ chain: 'A', name: 'CB', x: 11, y: 0, z: 0 }),
				atom({ record: 'HETATM', chain: 'A', name: 'CA', x: 99, y: 0, z: 0 }),
			].join('\n')
		);

		expect(overlay.stats.residueCount).toBe(1);
		expect(overlay.chains[0].segments[0][0]).toEqual({ x: 1, y: 0, z: 0 });
	});

	it('reads only the first model', () => {
		const overlay = parsePdbOverlay(
			[
				'MODEL        1',
				atom({ chain: 'A', x: 10, y: 0, z: 0 }),
				'ENDMDL',
				'MODEL        2',
				atom({ chain: 'B', x: 20, y: 0, z: 0 }),
				'ENDMDL',
			].join('\n')
		);

		expect(overlay.stats).toMatchObject({ chainCount: 1, residueCount: 1 });
		expect(overlay.chains[0].id).toBe('A');
	});

	it('keeps blank/A altLoc and skips others', () => {
		const overlay = parsePdbOverlay(
			[
				atom({ chain: 'A', resSeq: 1, altLoc: 'A', x: 10, y: 0, z: 0 }),
				atom({ chain: 'A', resSeq: 1, altLoc: 'B', x: 99, y: 0, z: 0 }),
			].join('\n')
		);

		expect(overlay.stats.residueCount).toBe(1);
		expect(overlay.chains[0].segments[0][0]).toEqual({ x: 1, y: 0, z: 0 });
	});

	it('throws when the first model has no Cα atoms', () => {
		expect(() => parsePdbOverlay(atom({ chain: 'A', name: 'N', x: 0, y: 0, z: 0 }))).toThrow(
			PdbOverlayParseError
		);
	});

	it('extracts the PDB id from the HEADER record (cols 63-66)', () => {
		const header = 'HEADER'.padEnd(62) + '6J6J';
		const overlay = parsePdbOverlay([header, atom({ chain: 'A', x: 10, y: 0, z: 0 })].join('\n'));
		expect(overlay.pdbId).toBe('6J6J');
	});

	it('leaves pdbId undefined when there is no HEADER', () => {
		const overlay = parsePdbOverlay(atom({ chain: 'A', x: 10, y: 0, z: 0 }));
		expect(overlay.pdbId).toBeUndefined();
	});

	it('keeps a contiguous chain as a single segment', () => {
		const overlay = parsePdbOverlay(
			[
				atom({ chain: 'A', resSeq: 1, x: 0, y: 0, z: 0 }),
				atom({ chain: 'A', resSeq: 2, x: 4, y: 0, z: 0 }),
				atom({ chain: 'A', resSeq: 3, x: 8, y: 0, z: 0 }),
			].join('\n')
		);
		expect(overlay.chains[0].segments).toHaveLength(1);
		expect(overlay.chains[0].segments[0]).toHaveLength(3);
	});

	it('splits a chain at a TER record', () => {
		const overlay = parsePdbOverlay(
			[
				atom({ chain: 'A', resSeq: 1, x: 0, y: 0, z: 0 }),
				atom({ chain: 'A', resSeq: 2, x: 4, y: 0, z: 0 }),
				ter('A'),
				atom({ chain: 'A', resSeq: 3, x: 8, y: 0, z: 0 }),
				atom({ chain: 'A', resSeq: 4, x: 12, y: 0, z: 0 }),
			].join('\n')
		);
		expect(overlay.chains).toHaveLength(1);
		expect(overlay.chains[0].segments).toHaveLength(2);
		expect(overlay.stats.residueCount).toBe(4);
	});

	it('splits a chain at a residue-sequence gap', () => {
		const overlay = parsePdbOverlay(
			[
				atom({ chain: 'A', resSeq: 1, x: 0, y: 0, z: 0 }),
				atom({ chain: 'A', resSeq: 2, x: 4, y: 0, z: 0 }),
				atom({ chain: 'A', resSeq: 5, x: 8, y: 0, z: 0 }),
			].join('\n')
		);
		expect(overlay.chains[0].segments).toHaveLength(2);
		expect(overlay.chains[0].segments[0]).toHaveLength(2);
		expect(overlay.chains[0].segments[1]).toHaveLength(1);
	});
});
