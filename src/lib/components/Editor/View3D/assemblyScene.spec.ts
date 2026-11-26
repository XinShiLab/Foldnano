import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import FoldnanoDocument from '$lib/model/document.svelte';
import { HistoryStack } from '$lib/commands/history.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { PlaneTransform } from '$lib/commands/planes';
import {
	LABELS_NAME,
	ghostifyGroup,
	instanceCopy,
	occurrenceIdOf,
	occurrenceMatrix,
} from './assemblyScene';
import {
	FramedGizmoTarget,
	OccurrenceGizmoTarget,
	poseToPlaneTransform,
	type GizmoTarget,
} from './gizmoDragController';

const PLACED = {
	position: { x: 10, y: -4, z: 2 },
	// 90° about z
	quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number, number],
};

function expectClose(
	a: { x: number; y: number; z: number },
	b: { x: number; y: number; z: number }
) {
	expect(a.x).toBeCloseTo(b.x, 9);
	expect(a.y).toBeCloseTo(b.y, 9);
	expect(a.z).toBeCloseTo(b.z, 9);
}

/** A plane-like target storing its pose in Part space. */
function partSpaceTarget(initial: PlaneTransform) {
	const state = { current: initial, committed: null as [PlaneTransform, PlaneTransform] | null };
	const target: GizmoTarget = {
		readTransform: () => state.current,
		writeTransform: (t) => (state.current = t),
		commit: (start, end) => (state.committed = [start, end]),
	};
	return { state, target };
}

describe('occurrenceMatrix', () => {
	it('maps a Part-space point to the lab and back', () => {
		const m = occurrenceMatrix(PLACED);
		const p = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
		expectClose(p, { x: 10, y: -3, z: 2 });
		expectClose(p.applyMatrix4(m.clone().invert()), { x: 1, y: 0, z: 0 });
	});

	it('is the identity for an unplaced Part', () => {
		expect(occurrenceMatrix(null).equals(new THREE.Matrix4())).toBe(true);
	});
});

describe('FramedGizmoTarget', () => {
	it('shows a Part-space pose in world space and writes back in Part space', () => {
		const start = poseToPlaneTransform({
			position: { x: 1, y: 0, z: 0 },
			quaternion: [0, 0, 0, 1],
		});
		const { state, target } = partSpaceTarget(start);
		const framed = new FramedGizmoTarget(target, () => occurrenceMatrix(PLACED));

		const world = framed.readTransform()!;
		expectClose(world.origin, { x: 10, y: -3, z: 2 });
		expectClose(world.u, { x: 0, y: 1, z: 0 });

		framed.writeTransform(world);
		expectClose(state.current.origin, start.origin);
		expectClose(state.current.u, start.u);

		framed.commit(world, world);
		expectClose(state.committed![1].origin, start.origin);
	});
});

describe('OccurrenceGizmoTarget', () => {
	it('moves an instance live and records one undoable step', () => {
		const doc = new FoldnanoDocument(undefined, 'Doc');
		const part = doc.addNewPart('HONEYCOMB');
		const history = new HistoryStack(doc, new StorageManager('memory'));
		history.setAutoSaveConfig({ enabled: false });
		const [occurrence] = doc.assembly.occurrencesOf(part.id);
		const target = new OccurrenceGizmoTarget(doc, occurrence.id, history);

		const start = target.readTransform()!;
		const end = poseToPlaneTransform(PLACED);
		target.writeTransform(end);
		target.commit(start, end);
		expect(history.numberOfUndos).toBe(1);
		expectClose(occurrence.transform.position, PLACED.position);

		history.undoOnce();
		expectClose(doc.assembly.getById(occurrence.id)!.transform.position, { x: 0, y: 0, z: 0 });
		history.redoOnce();
		expectClose(doc.assembly.getById(occurrence.id)!.transform.position, PLACED.position);
	});
});

describe('instance copies', () => {
	function template() {
		const group = new THREE.Group();
		const labels = new THREE.Group();
		labels.name = LABELS_NAME;
		group.add(labels);
		const material = new THREE.MeshBasicMaterial();
		group.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
		return { group, material };
	}

	it('share geometry, drop labels and remember their instance', () => {
		const { group } = template();
		const copy = instanceCopy(group, PLACED, 'occ-1');
		expect(copy.getObjectByName(LABELS_NAME)).toBeUndefined();
		expect(group.getObjectByName(LABELS_NAME)).toBeDefined();
		const mesh = copy.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
		expect(mesh.geometry).toBe((group.children[1] as THREE.Mesh).geometry);
		expect(occurrenceIdOf(mesh)).toBe('occ-1');
		expectClose(copy.position, PLACED.position);
	});

	it('ghost materials become see-through once each', () => {
		const { group, material } = template();
		group.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
		ghostifyGroup(group, 0.5);
		expect(material.transparent).toBe(true);
		expect(material.opacity).toBe(0.5);
	});
});
