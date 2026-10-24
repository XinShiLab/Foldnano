import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CadnanoJSON, type VStrandJSON } from '../io/cadnanoJSON';
import { checkPartIntegrity } from '../checks/integrity';
import { DesignCheckError } from '../checks/designIssue';
import { repairDocumentJson } from '../documentRepair';
import FoldnanoDocument from '../document.svelte';
import type { Part } from '../Part';
import { makeHoneycombPart, addLatticeVh } from './testHelpers';

const PUBLISHED_DIR = path.resolve('test_files/published_cadnano_designs');

function publishedPart(file: string): Part {
	const raw = JSON.parse(fs.readFileSync(path.join(PUBLISHED_DIR, file), 'utf-8'));
	return CadnanoJSON.fromRaw(raw).toPart();
}

function duplexPart(): Part {
	const part = makeHoneycombPart();
	const vh = addLatticeVh(part, 0, 0);
	part.createOligo(vh, 0, 30);
	part.createOligo(vh, 30, 0);
	return part;
}

function slotAt(part: Part, strandIdx: 0 | 1, bp: number) {
	const vh = part.virtualHelices[0];
	return part.getEntitiesAtVh(vh.id, strandIdx, bp).segment!.slots.find((s) => s.bpIndex === bp)!;
}

function emptyNt(): [number, number, number, number] {
	return [-1, -1, -1, -1];
}

function oneHelixCadnano(num: number, row: number, col: number) {
	const vs: VStrandJSON = {
		num,
		row,
		col,
		// cadnano's scaf runs 5'→3' ascending on even helices and descending on odd ones.
		scaf: [
			num % 2 === 0 ? [-1, -1, num, 1] : [num, 1, -1, -1],
			num % 2 === 0 ? [num, 0, -1, -1] : [-1, -1, num, 0],
			...Array.from({ length: 19 }, emptyNt),
		],
		stap: Array.from({ length: 21 }, emptyNt),
		loop: new Array(21).fill(0),
		skip: new Array(21).fill(0),
	};
	return { name: 'Test', vstrands: [vs] };
}

describe('checkPartIntegrity', () => {
	it('finds nothing in published designs or editor-made parts', () => {
		expect(checkPartIntegrity(publishedPart('8hb_2ab_8f.json'))).toEqual([]);
		expect(checkPartIntegrity(publishedPart('Hilbert.json'))).toEqual([]);
		expect(checkPartIntegrity(duplexPart())).toEqual([]);
	});

	it('warns about a helix number whose parity differs from its cell', () => {
		const part = CadnanoJSON.fromRaw(oneHelixCadnano(1, 0, 0)).toPart();

		const issues = checkPartIntegrity(part);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			rule: 'helix-cell-parity',
			severity: 'warning',
			anchor: { vhIndex: 1 },
		});
	});

	it('accepts a skip left on one strand after its partner strand was deleted', () => {
		const part = duplexPart();
		const forward = [...part.oligos].find((o) => [...o.segments][0].inStrandIndex === 0)!;
		[...forward.segments][0].addSkipOrInsertion(10, -1);
		part.removeOligo([...part.oligos].find((o) => o !== forward)!);

		expect(checkPartIntegrity(part)).toEqual([]);
	});

	it('flags a skip/insert that differs between the two strands', () => {
		const part = duplexPart();
		slotAt(part, 0, 10).seq = 'NN';

		const issues = checkPartIntegrity(part);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			rule: 'asymmetric-skip-insert',
			severity: 'error',
			anchor: { bp: 10 },
		});
	});

	it('flags a skip on a constrained crossover site', () => {
		const part = publishedPart('8hb_2ab_8f.json');
		const end = [...part.oligos]
			.flatMap((o) => [...o.segments])
			.flatMap((seg) => [seg.fivePrime, seg.threePrime])
			.find((e) => e.isConstrained && !e.isFree)!;
		const vh = end.segment.inVirtualHelix;
		for (const strandIdx of [0, 1] as const) {
			const seg = part.getEntitiesAtVh(vh.id, strandIdx, end.index).segment;
			const slot = seg?.slots.find((s) => s.bpIndex === end.index);
			if (slot) slot.seq = '';
		}

		const issues = checkPartIntegrity(part);

		expect(issues.map((i) => i.rule)).toContain('skip-insert-on-crossover');
	});

	it('limits the check to the given regions', () => {
		const part = duplexPart();
		slotAt(part, 0, 10).seq = 'NN';

		expect(checkPartIntegrity(part, new Set(['some-other-region']))).toEqual([]);
	});
});

describe('negative lattice cells', () => {
	it('cadnano import refuses negative row/col', () => {
		expect(() => CadnanoJSON.fromRaw(oneHelixCadnano(0, -2, 0))).toThrow(DesignCheckError);
	});

	it('a loaded design is shifted onto non-negative cells without moving in 3D', () => {
		const part = duplexPart();
		const vh = part.virtualHelices[0];
		const doc = new FoldnanoDocument();
		doc.parts.push(part);
		const snapshot = JSON.parse(JSON.stringify(doc.toJSON()));
		snapshot.parts[0].virtualHelices[0].latticeCoords = { row: -1, col: -3 };
		const before = FoldnanoDocument.fromJSON(JSON.parse(JSON.stringify(snapshot))).parts[0];
		// The intended position of (-1, -3) is (1, 1) shifted back by one lattice period.
		const reference = FoldnanoDocument.fromJSON(doc.toJSON()).parts[0];
		reference.virtualHelices[0].latticeCoords = { row: 1, col: 1 };

		const { snapshot: repaired, repairs } = repairDocumentJson(snapshot);
		const after = FoldnanoDocument.fromJSON(repaired).parts[0];

		expect(repairs).toHaveLength(1);
		expect(repairs[0]).toMatch(/2 row\(s\) and 4 column\(s\)/);
		expect(after.virtualHelices[0].latticeCoords).toEqual({ row: 1, col: 1 });
		expect(checkPartIntegrity(after)).toEqual([]);
		expect(checkPartIntegrity(before).map((i) => i.rule)).toContain('negative-cell');
		const moved = after.getVirtualHelixFrame(after.virtualHelices[0]).origin;
		const intended = reference.getVirtualHelixFrame(reference.virtualHelices[0]).origin;
		const shiftBack = { x: (4 * Math.sqrt(3) * (2.55 * 0.8518)) / 2, y: (6 * (2.55 * 0.8518)) / 2 };
		expect(moved.x).toBeCloseTo(intended.x - shiftBack.x, 6);
		expect(moved.y).toBeCloseTo(intended.y - shiftBack.y, 6);
		expect(vh.latticeCoords).toEqual({ row: 0, col: 0 });
	});
});
