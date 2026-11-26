import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import FoldnanoDocument from '$lib/model/document.svelte';
import { buildBlocksAndConstraints } from '$lib/model/rbs/buildBlocks';
import { addLatticeVh } from '$lib/model/test/testHelpers';
import {
	computeSimulationFreshnessSignature,
	keptRelaxedPoses,
	relaxedPartPoses,
	type PartRelaxation,
} from './view3dSimulationState';

describe('computeSimulationFreshnessSignature', () => {
	it('changes when a plane transform changes', () => {
		const doc = new FoldnanoDocument('doc-1', 'View3D signature test');
		const part = doc.addNewPart('HONEYCOMB');
		part.createOligo(addLatticeVh(part, 0, 0), 0, 20);
		const plane = part.getDefaultPlane();

		const before = computeSimulationFreshnessSignature(part);
		part.setPlaneTransform(plane.id, {
			origin: { x: plane.origin.x + 10, y: plane.origin.y, z: plane.origin.z },
			u: plane.u,
			v: plane.v,
			normal: plane.normal,
		});
		const after = computeSimulationFreshnessSignature(part);

		expect(after).not.toBe(before);
	});
});

describe('computeSimulationFreshnessSignature, beyond ids', () => {
	it('changes when a helix moves with every id kept, and is back when it returns', () => {
		const doc = new FoldnanoDocument('doc-2', 'Helix move');
		const part = doc.addNewPart('HONEYCOMB');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 20);
		const start = computeSimulationFreshnessSignature(part);

		// A raw write stands in for a move command (or a linked Part's update).
		vh.latticeCoords = { row: 2, col: 0 };
		expect(computeSimulationFreshnessSignature(part)).not.toBe(start);
		vh.latticeCoords = { row: 0, col: 0 };
		expect(computeSimulationFreshnessSignature(part)).toBe(start);
	});
});

describe('computeSimulationFreshnessSignature follows the solver input', () => {
	function tetrahedral() {
		const raw = JSON.parse(
			readFileSync(
				join(process.cwd(), 'test_files/internal_cadnano_designs/test_tetrahedral2.fn.json'),
				'utf8'
			)
		);
		return FoldnanoDocument.fromJSON(raw).parts[0];
	}

	it('changes when a flexible crossover becomes constrained', () => {
		const part = tetrahedral();
		const before = buildBlocksAndConstraints(part);
		const constraint = before.constraints[0];
		expect(constraint).toBeDefined();
		const start = computeSimulationFreshnessSignature(part);
		const segId = constraint.id.split(':3-')[0];
		// A raw write stands in for the command; only the signature is under test.
		part.segmentsLookup.get(segId)!.threePrime.isConstrained = true;
		expect(buildBlocksAndConstraints(part).constraints.length).toBeLessThan(
			before.constraints.length
		);
		expect(computeSimulationFreshnessSignature(part)).not.toBe(start);
	});

	it('changes when a region twist offset changes', () => {
		const part = tetrahedral();
		const start = computeSimulationFreshnessSignature(part);
		part.regions[0].twistOffset += 90;
		expect(computeSimulationFreshnessSignature(part)).not.toBe(start);
	});
});

describe('relaxedPartPoses', () => {
	const shift = (z: number) =>
		new Map([
			[
				'seg',
				{
					originalCenter: { x: 0, y: 0, z: 0 },
					position: { x: 0, y: 0, z },
					quaternion: { x: 0, y: 0, z: 0, w: 1 },
				},
			],
		]);

	function design() {
		const doc = new FoldnanoDocument('doc-1', 'Relaxed Parts');
		const active = doc.addNewPart('HONEYCOMB');
		const kept = doc.addNewPart('HONEYCOMB');
		const hidden = doc.addNewPart('SQUARE');
		return { doc, active, kept, hidden };
	}

	it('takes the active result as given and each other Part’s shown, fresh kept one', () => {
		const { doc, active, kept, hidden } = design();
		const activeOverrides = shift(1);
		const keptOverrides = shift(2);
		const relaxations = new Map<string, PartRelaxation>([
			[kept.id, relaxation(keptOverrides, kept, true)],
			[hidden.id, relaxation(shift(3), hidden, false)],
		]);
		const poses = relaxedPartPoses(
			doc.parts,
			{ partId: active.id, overrides: activeOverrides },
			relaxations
		);
		expect(poses.get(active.id)).toBe(activeOverrides);
		expect(poses.get(kept.id)).toBe(keptOverrides);
		expect(poses.has(hidden.id)).toBe(false);
	});

	it('drops a kept result once its Part has changed', () => {
		const { kept } = design();
		kept.createOligo(addLatticeVh(kept, 0, 0), 0, 20);
		const stored = relaxation(shift(2), kept, true);
		expect(keptRelaxedPoses(kept, stored)).toBe(stored.overrides);
		kept.createOligo(addLatticeVh(kept, 0, 1), 0, 20);
		expect(keptRelaxedPoses(kept, stored)).toBeUndefined();
	});

	function relaxation(
		overrides: PartRelaxation['overrides'],
		part: Parameters<typeof computeSimulationFreshnessSignature>[0],
		shown: boolean
	): PartRelaxation {
		return {
			overrides,
			stressMap: new Map(),
			sig: computeSimulationFreshnessSignature(part),
			diagnostics: null,
			shown,
		};
	}
});
