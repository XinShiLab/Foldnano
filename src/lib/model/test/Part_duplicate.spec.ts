import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import FoldnanoDocument from '$lib/model/document.svelte';
import type Oligo from '$lib/model/Oligo';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import { Part } from '$lib/model/Part';
import { duplicateSnapStep, findNextValidDuplicateDelta } from '$lib/model/Part/duplicateOffsets';
import { HistoryStack } from '$lib/commands/history.svelte';
import { duplicateOligosCmd } from '$lib/commands/strands';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import { addFreeformVh, addLatticeVh, makeFreeformPart, makeHoneycombPart } from './testHelpers';

class MockStorageProvider implements StorageProvider {
	async saveDocument(): Promise<boolean> {
		return true;
	}
	async loadDocument(): Promise<object | null> {
		return null;
	}
	async deleteDocument(): Promise<boolean> {
		return true;
	}
	async getDocumentList(): Promise<[]> {
		return [];
	}
	async saveContext(): Promise<boolean> {
		return true;
	}
	async loadContext(): Promise<object | null> {
		return null;
	}
	getProviderInfo() {
		return { name: 'Mock', type: 'memory' as const, description: 'Mock storage provider' };
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

function historyFor(doc: FoldnanoDocument): HistoryStack {
	const storage = new StorageManager('memory');
	storage.registerProvider('memory', new MockStorageProvider());
	return new HistoryStack(doc, storage);
}

const onlySegment = (oligo: Oligo): OligoSegment => [...oligo.segments][0];

/** An oligo crossing from VH0 (strand 0) to VH1 (strand 1) at the first lattice site past bp 10. */
function makeCrossoverOligo(part: Part): Oligo {
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 1, 0);
	const site = part.potentialXoverSites(vh0.index)[0].find((s) => s.bpIdx > 10);
	if (!site) throw new Error('Expected a crossover site');
	const a = part.createOligo(vh0, 0, site.bpIdx);
	const b = part.createOligo(vh1, site.bpIdx, site.bpIdx - 1);
	part.connectTwoOligos(a, b);
	expect(onlySegment(a).threePrime.isConstrained).toBe(true);
	return onlySegment(a).oligo!;
}

describe('Part.duplicateOligos', () => {
	it('copies a single-segment oligo with fresh ids, keeping sequence, color and modifications', () => {
		const part = makeFreeformPart();
		const vh = addFreeformVh(part, [0, 0, 0]);
		const oligo = part.createOligo(vh, 0, 9, '#123456');
		const seg = onlySegment(oligo);
		seg.sequence = 'ACGTACGTAC';
		seg.fivePrime.modification = 'biotin';

		const [copy] = part.duplicateOligos([oligo], 21);
		const copySeg = onlySegment(copy);

		expect(part.oligos.size).toBe(2);
		expect(copy.id).not.toBe(oligo.id);
		expect(copySeg.id).not.toBe(seg.id);
		expect([copySeg.fivePrime.index, copySeg.threePrime.index]).toEqual([21, 30]);
		expect(copySeg.sequence).toBe('ACGTACGTAC');
		expect(copySeg.fivePrime.modification).toBe('biotin');
		expect(copy.color).toBe('#123456');
		expect(part.getEntitiesAtVh(vh.id, 0, 25).oligo).toBe(copy);
	});

	it('keeps a constrained crossover when the offset is a lattice period', () => {
		const part = makeHoneycombPart();
		const oligo = makeCrossoverOligo(part);

		expect(part.canDuplicateOligosBy([oligo], 21)).toEqual({ ok: true });
		const [copy] = part.duplicateOligos([oligo], 21);

		const ends = [...copy.segments].flatMap((s) => [s.fivePrime, s.threePrime]);
		const xoverEnds = ends.filter((e) => e.isConstrained);
		expect(xoverEnds).toHaveLength(2);
		for (const end of xoverEnds) expect(end.connectedEnd?.segment.oligo).toBe(copy);
	});

	it('rejects an offset that lands a crossover on a site toward the wrong neighbor', () => {
		const part = makeHoneycombPart();
		const oligo = makeCrossoverOligo(part);

		const check = part.canDuplicateOligosBy([oligo], 28);
		expect(check.ok).toBe(false);
		if (!check.ok) expect(check.reason).toMatch(/crossover site/);
		expect(() => part.duplicateOligos([oligo], 28)).toThrow(/crossover site/);
	});

	it('rejects a copy overlapping the original or another strand', () => {
		const part = makeFreeformPart();
		const vh = addFreeformVh(part, [0, 0, 0]);
		const oligo = part.createOligo(vh, 0, 9);
		part.createOligo(vh, 25, 30);

		expect(part.canDuplicateOligosBy([oligo], 5).ok).toBe(false);
		const check = part.canDuplicateOligosBy([oligo], 21);
		expect(check.ok).toBe(false);
		if (!check.ok) expect(check.reason).toMatch(/overlap/);
	});

	it('grows the region by whole steps when the copy runs past its end', () => {
		const part = makeHoneycombPart();
		const oligo = makeCrossoverOligo(part);
		expect(part.getDefaultRegion().maxBase).toBe(42);

		part.duplicateOligos([oligo], 42);

		expect(part.getDefaultRegion().maxBase).toBe(63);
		for (const vh of part.virtualHelices) expect(vh.length).toBe(63);
	});

	describe('skips and insertions', () => {
		it('carries a skip when both strands of the duplex are copied together', () => {
			const part = makeFreeformPart();
			const vh = addFreeformVh(part, [0, 0, 0]);
			const top = part.createOligo(vh, 0, 9);
			const bottom = part.createOligo(vh, 9, 0);
			onlySegment(top).addSkipOrInsertion(5, -1);

			const copies = part.duplicateOligos([top, bottom], 21);

			for (const copy of copies) expect(onlySegment(copy).slotSeq(26)).toBe('');
		});

		it('mirrors a copied skip onto an existing complementary strand', () => {
			const part = makeFreeformPart();
			const vh = addFreeformVh(part, [0, 0, 0]);
			const top = part.createOligo(vh, 0, 9);
			part.createOligo(vh, 9, 0);
			const target = part.createOligo(vh, 30, 21);
			onlySegment(top).addSkipOrInsertion(5, -1);

			part.duplicateOligos([top], 21);

			expect(onlySegment(target).slotSeq(26)).toBe('');
		});

		it('rejects a copied skip with no complementary strand at the target', () => {
			const part = makeFreeformPart();
			const vh = addFreeformVh(part, [0, 0, 0]);
			const top = part.createOligo(vh, 0, 9);
			part.createOligo(vh, 9, 0);
			onlySegment(top).addSkipOrInsertion(5, -1);

			const check = part.canDuplicateOligosBy([top], 21);
			expect(check.ok).toBe(false);
			if (!check.ok) expect(check.reason).toMatch(/complementary strand/);
		});
	});

	it('is undone and redone as one step by duplicateOligosCmd', () => {
		const doc = new FoldnanoDocument();
		const part = doc.addNewPart('HONEYCOMB');
		const history = historyFor(doc);
		const oligo = makeCrossoverOligo(part);

		duplicateOligosCmd({ part, oligos: [oligo], delta: 42 }, history);
		expect(doc.parts[0].oligos.size).toBe(2);
		expect(doc.parts[0].getDefaultRegion().maxBase).toBe(63);

		history.undoOnce();
		expect(doc.parts[0].oligos.size).toBe(1);
		expect(doc.parts[0].getDefaultRegion().maxBase).toBe(42);
		for (const vh of doc.parts[0].virtualHelices) expect(vh.length).toBe(42);

		history.redoOnce();
		expect(doc.parts[0].oligos.size).toBe(2);
		expect(doc.parts[0].getDefaultRegion().maxBase).toBe(63);
	});

	it('duplicates the whole 10hb tube unit by one repeat period', () => {
		const json = JSON.parse(
			readFileSync(join(process.cwd(), 'test_files/fn_designs/10hb_tube.fn.json'), 'utf-8')
		);
		const part = Part.fromJSON(json.parts[0]);
		const oligos = [...part.oligos];

		part.duplicateOligos(oligos, 20);

		expect(part.oligos.size).toBe(20);
		for (const vh of part.virtualHelices) expect(vh.length).toBe(63);
		for (const vh of part.virtualHelices) {
			for (const strandSet of vh.strandSets) {
				const ranges = [...strandSet.segmentIds]
					.map((id) => part.getSegmentById(id)!)
					.map((s) => [s.lowIndex, s.highIndex])
					.sort((a, b) => a[0] - b[0]);
				for (let i = 1; i < ranges.length; i++) {
					expect(ranges[i][0]).toBeGreaterThan(ranges[i - 1][1]);
				}
			}
		}
	});
});

describe('duplicate offset search', () => {
	it('snaps to the region step and finds the first free position to the right', () => {
		const part = makeFreeformPart();
		const vh = addFreeformVh(part, [0, 0, 0]);
		const oligo = part.createOligo(vh, 0, 9);
		part.createOligo(vh, 22, 25);

		const step = duplicateSnapStep(part, [oligo]);
		expect(step).toBe(21);
		expect(findNextValidDuplicateDelta(part, [oligo], 0, 1, step)).toBe(42);
		expect(findNextValidDuplicateDelta(part, [oligo], 0, -1, step)).toBeNull();
	});
});
