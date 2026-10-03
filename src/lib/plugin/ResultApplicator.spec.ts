import { describe, it, expect, vi } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import { HoneycombRegion, LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import { Plane } from '$lib/model/Part/Plane.svelte';
import type { HistoryStack } from '$lib/commands/history.svelte';
import { applyResult } from './ResultApplicator';
import type { PluginManifest } from './types';

function makeFakeHistoryStack(): HistoryStack {
	return {
		snapshotTx: (_label: string, fn: () => unknown) => fn(),
	} as unknown as HistoryStack;
}

// Two honeycomb regions on separate planes, linked by one crossover across the boundary.
function makeTwoRegionCrossLinkFixture() {
	const part = makeHoneycombPart('Original');
	const region1 = part.getDefaultRegion() as LatticedDesignRegion;
	const vh1 = addLatticeVh(part, 0, 0);
	const oligo1 = part.createOligo(vh1, 0, 5, '#000000');

	const plane2 = new Plane('Plane 2');
	const region2 = new HoneycombRegion('Region 2', plane2.id);
	part.addPlane(plane2);
	part.addRegion(region2);
	const vh2 = region2.addVhAtCoords(part, 0, 0);
	const oligo2 = part.createOligo(vh2, 0, 5, '#000000');

	part.connectTwoOligos(oligo1, oligo2);

	return { part, region: region1 };
}

describe('applyResult — dispatch by declared strategy, not by nullable-snapshot fallback', () => {
	it('replaceRegionKeepAnnotationsWhereMatched with no pre-run snapshot throws instead of falling back to a plain replaceRegion', () => {
		const doc = new FoldnanoDocument('doc-1', 'Doc');
		const part = makeHoneycombPart('Original');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 10, '#000000');
		doc.parts.push(part);
		const region = part.getDefaultRegion() as LatticedDesignRegion;
		const vhCountBefore = part.virtualHelices.length;

		const { json } = CadnanoJSON.fromRegion(region, part);
		const primaryArtifact = JSON.stringify(json);

		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'region-keep-annotations',
			name: 'Region Keep Annotations',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'replaceRegionKeepAnnotationsWhereMatched',
			entrypoint: 'def run(ctx): pass',
		};

		expect(() =>
			applyResult({
				manifest,
				primaryArtifact,
				preRunFoldnanoSnapshot: null,
				doc,
				partIndex: 0,
				historyStack: makeFakeHistoryStack(),
				activeRegionId: region.id,
			})
		).toThrow(/design from before the run is unavailable/);

		// Same objects, not just same count — a same-count replacement would pass a count-only check.
		expect(part.virtualHelices.length).toBe(vhCountBefore);
		expect(part.virtualHelices[0]).toBe(vh);
		expect(part.oligos.size).toBe(1);
		expect([...part.oligos][0]).toBe(oligo);
	});

	it('replacePartKeepAnnotationsWhereMatched with no pre-run snapshot throws instead of silently building an empty annotation map', () => {
		const doc = new FoldnanoDocument('doc-2', 'Doc');
		const part = makeHoneycombPart('Original');
		doc.parts.push(part);

		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'part-keep-annotations',
			name: 'Part Keep Annotations',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'replacePartKeepAnnotationsWhereMatched',
			entrypoint: 'def run(ctx): pass',
		};
		const primaryArtifact = JSON.stringify(makeHoneycombPart('From Plugin').toJSON());

		expect(() =>
			applyResult({
				manifest,
				primaryArtifact,
				preRunFoldnanoSnapshot: null,
				doc,
				partIndex: 0,
				historyStack: makeFakeHistoryStack(),
			})
		).toThrow(/design from before the run is unavailable/);

		expect(doc.parts[0]).toBe(part);
	});
});

describe('applyResult — cross-region link summary', () => {
	it('prints the restored-link summary exactly once after a successful replaceRegion', () => {
		const doc = new FoldnanoDocument('doc-3', 'Doc');
		const { part, region } = makeTwoRegionCrossLinkFixture();
		doc.parts.push(part);
		const { json } = CadnanoJSON.fromRegion(region, part);
		const primaryArtifact = JSON.stringify(json);

		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'region-replace',
			name: 'Region Replace',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'replaceRegion',
			entrypoint: 'def run(ctx): pass',
		};

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		try {
			applyResult({
				manifest,
				primaryArtifact,
				preRunFoldnanoSnapshot: null,
				doc,
				partIndex: 0,
				historyStack: makeFakeHistoryStack(),
				activeRegionId: region.id,
			});

			expect(warnSpy).not.toHaveBeenCalled();
			expect(infoSpy).toHaveBeenCalledTimes(1);
			expect(infoSpy).toHaveBeenCalledWith(
				'[ResultApplicator] Cross-region links: 1 restored, 0 could not be matched.'
			);
			// The restored crossover re-merges the two regions' oligos back into one.
			expect(part.oligos.size).toBe(1);
		} finally {
			warnSpy.mockRestore();
			infoSpy.mockRestore();
		}
	});
});
