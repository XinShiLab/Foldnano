import { describe, expect, it } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import {
	buildAssemblyNtModel,
	exportedOccurrences,
	offersAssemblyExport,
	simulationExportParts,
} from './assemblyNtModel';
import { RISE_NM } from './simulationNtModel';
import { buildSimulationNtModel } from './simulationNtModel';
import { exportAssemblyToOxDna, exportPartToOxDna } from './oxdnaExport';
import { exportAssemblyToMrdna, exportPartToMrdna } from './mrdnaExport';

const OFFSET = { x: 30, y: -5, z: 12 };

/** One Part (a duplex on one helix) placed twice: at the origin and shifted by OFFSET. */
function twoInstances() {
	const doc = new FoldnanoDocument(undefined, 'Assembly');
	const part = doc.addNewPart('HONEYCOMB');
	const vh = addLatticeVh(part, 0, 0);
	part.createOligo(vh, 0, 20, '#ff0000');
	part.createOligo(vh, 20, 0, '#0000ff');
	const second = doc.assembly.add(part.id, 'Second', {
		transform: { position: OFFSET, quaternion: [0, 0, 0, 1] },
	});
	return { doc, part, second };
}

function expectClose(
	a: { x: number; y: number; z: number },
	b: { x: number; y: number; z: number }
) {
	expect(a.x).toBeCloseTo(b.x, 9);
	expect(a.y).toBeCloseTo(b.y, 9);
	expect(a.z).toBeCloseTo(b.z, 9);
}

describe('buildAssemblyNtModel', () => {
	it('is the single-Part model twice, the second shifted and renumbered', () => {
		const { doc, part, second } = twoInstances();
		const single = buildSimulationNtModel(part);
		const model = buildAssemblyNtModel(doc);
		const n = single.nucleotides.length;

		expect(model.nucleotides).toHaveLength(2 * n);
		expect(model.strandCount).toBe(2 * single.strandCount);
		expect(model.occurrenceIds[1]).toBe(second.id);
		single.nucleotides.forEach((nt, i) => {
			const first = model.nucleotides[i];
			const copy = model.nucleotides[i + n];
			expectClose(first.positionNm, nt.positionNm);
			expectClose(copy.positionNm, {
				x: nt.positionNm.x + OFFSET.x,
				y: nt.positionNm.y + OFFSET.y,
				z: nt.positionNm.z + OFFSET.z,
			});
			expect(copy.id).toBe(nt.id + n);
			expect(copy.strandId).toBe(nt.strandId + single.strandCount);
			expect(copy.next).toBe(nt.next === -1 ? -1 : nt.next + n);
			expect(copy.segmentId).toBe(nt.segmentId);
			expect(copy.occurrenceId).toBe(second.id);
		});
	});

	it('keeps pairs within an instance', () => {
		const { doc } = twoInstances();
		const byKey = new Map<string, string[]>();
		for (const nt of buildAssemblyNtModel(doc).nucleotides) {
			byKey.set(nt.pairKey, [...(byKey.get(nt.pairKey) ?? []), nt.occurrenceId]);
		}
		for (const owners of byKey.values()) {
			expect(owners.length).toBeLessThanOrEqual(2);
			expect(new Set(owners).size).toBe(1);
		}
	});

	it('rotates nucleotide frames with the instance', () => {
		const { doc, part, second } = twoInstances();
		// 180° about z
		second.transform = { position: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 1, 0] };
		const single = buildSimulationNtModel(part).nucleotides[0];
		const copy = buildAssemblyNtModel(doc).nucleotides.find((nt) => nt.occurrenceId === second.id)!;
		expectClose(copy.positionNm, {
			x: -single.positionNm.x,
			y: -single.positionNm.y,
			z: single.positionNm.z,
		});
		expectClose(copy.a1, { x: -single.a1.x, y: -single.a1.y, z: single.a1.z });
	});

	it('leaves out hidden and broken instances', () => {
		const { doc, second } = twoInstances();
		second.visible = false;
		doc.assembly.add('no-such-part', 'Orphan');
		expect(exportedOccurrences(doc)).toHaveLength(1);
		expect(buildAssemblyNtModel(doc).occurrenceIds).toEqual([exportedOccurrences(doc)[0].id]);
	});
});

describe('assembly exports', () => {
	// Unassigned paired bases are random per build, so bases are left out of the comparison.
	const withoutBases = (top: string) => top.replace(/^(\d+) \S+ /gm, '$1 ');

	it('a single placement at the origin exports like the Part', () => {
		const { doc, part, second } = twoInstances();
		second.visible = false;
		const assembly = exportAssemblyToOxDna(doc);
		const single = exportPartToOxDna(part);
		expect(assembly.dat).toBe(single.dat);
		expect(withoutBases(assembly.top)).toBe(withoutBases(single.top));
		expect(exportAssemblyToMrdna(doc, { includeSequence: false })).toEqual(
			exportPartToMrdna(part, { includeSequence: false })
		);
	});

	it('two placements double the topology', () => {
		const { doc, part } = twoInstances();
		const single = exportPartToOxDna(part);
		const assembly = exportAssemblyToOxDna(doc);
		expect(assembly.nucleotideCount).toBe(2 * single.nucleotideCount);
		expect(assembly.strandCount).toBe(2 * single.strandCount);
		const mrdna = exportAssemblyToMrdna(doc);
		expect(mrdna.nucleotideCount).toBe(2 * exportPartToMrdna(part).nucleotideCount);
	});

	it('relaxing a Part never changes which bases stack in the mrDNA assembly', () => {
		// Two domains on one strand with an empty base between them: not stacked. Relaxing the
		// second domain one rise closer must not make them stack.
		const doc = new FoldnanoDocument(undefined, 'Gap');
		const part = doc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(part, 0, 0);
		const oligoA = part.createOligo(vh, 2, 8);
		const oligoB = part.createOligo(vh, 10, 18);
		const [segA] = oligoA.segments;
		const [segB] = oligoB.segments;
		segA.threePrime.connectTo(segB.fivePrime);
		oligoA.addSegment(segB);
		part.oligos.delete(oligoB);
		part.createOligo(vh, 8, 2);
		part.createOligo(vh, 18, 10);
		const overrides = new Map([
			[
				segB.id,
				{
					originalCenter: { x: 0, y: 0, z: 0 },
					position: { x: 0, y: 0, z: -RISE_NM },
					quaternion: { x: 0, y: 0, z: 0, w: 1 },
				},
			],
		]);
		const stacks = (txt: string) =>
			txt
				.split('\n')
				.filter((line) => line && !line.startsWith('#'))
				.map((line) => line.split(' ')[4]);
		const relaxedParts = new Map([[part.id, overrides]]);
		expect(
			stacks(exportAssemblyToMrdna(doc, { includeSequence: false, relaxedParts }).txt)
		).toEqual(
			stacks(
				exportPartToMrdna(part, { includeSequence: false, segPositionOverrides: overrides }).txt
			)
		);
	});
});

describe('relaxed Parts in an assembly export', () => {
	it('relaxes every instance of a Part with a result, and only that Part', () => {
		const { doc, part } = twoInstances();
		const other = doc.addNewPart('HONEYCOMB');
		other.createOligo(addLatticeVh(other, 0, 0), 0, 10);
		const segmentId = [...part.segmentsLookup.keys()][0];
		const relaxedParts = new Map([
			[
				part.id,
				new Map([
					[
						segmentId,
						{
							originalCenter: { x: 0, y: 0, z: 0 },
							position: { x: 0, y: 0, z: 5 },
							quaternion: { x: 0, y: 0, z: 0, w: 1 },
						},
					],
				]),
			],
		]);
		const plain = buildAssemblyNtModel(doc).nucleotides;
		const relaxed = buildAssemblyNtModel(doc, { relaxedParts }).nucleotides;
		const moved = relaxed.filter((nt, i) => nt.positionNm.z !== plain[i].positionNm.z);
		const instancesMoved = new Set(moved.map((nt) => nt.occurrenceId));
		expect(instancesMoved.size).toBe(2);
		expect(moved.every((nt) => nt.segmentId === segmentId)).toBe(true);
		for (const nt of moved) {
			const i = relaxed.indexOf(nt);
			expect(nt.positionNm.z - plain[i].positionNm.z).toBeCloseTo(5);
		}
	});
});

describe('simulation export scope', () => {
	it('offers the assembly for several instances or a moved or hidden one', () => {
		const { doc, part, second } = twoInstances();
		expect(offersAssemblyExport(doc)).toBe(true);
		second.visible = false;
		expect(offersAssemblyExport(doc)).toBe(true);
		doc.assembly.remove(second.id);
		expect(offersAssemblyExport(doc)).toBe(false);
		const only = doc.assembly.occurrences[0];
		only.visible = false;
		expect(offersAssemblyExport(doc)).toBe(true);
		expect(simulationExportParts(doc, 'assembly', part)).toEqual([]);
		only.visible = true;
		only.transform = { position: OFFSET, quaternion: [0, 0, 0, 1] };
		expect(offersAssemblyExport(doc)).toBe(true);
	});

	it('an assembly export holds the visible Parts, not the active one', () => {
		const { doc, part } = twoInstances();
		const other = doc.addNewPart('SQUARE');
		for (const o of doc.assembly.occurrencesOf(part.id)) o.visible = false;
		expect(simulationExportParts(doc, 'assembly', part)).toEqual([other]);
		expect(simulationExportParts(doc, 'activePart', part)).toEqual([part]);
		for (const o of doc.assembly.occurrencesOf(other.id)) o.visible = false;
		expect(simulationExportParts(doc, 'assembly', part)).toEqual([]);
	});
});
