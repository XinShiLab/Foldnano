import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { InterleavedBufferAttribute } from 'three';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';

import type { SimulationNucleotide } from '$lib/model/io/simulationNtModel';
import { buildReplayGeometry, pickNucleotide } from './replayGeometry';

function nt(id: number, next: number, prev: number): SimulationNucleotide {
	return { id, next, prev } as SimulationNucleotide;
}

describe('buildReplayGeometry', () => {
	// Strand 0→1→2, plus a lone nucleotide 3.
	const nts = [nt(0, 1, -1), nt(1, 2, 0), nt(2, -1, 1), nt(3, -1, -1)];

	it('moves spheres, bonds and base sticks in place', () => {
		const geometry = buildReplayGeometry(nts);
		const [spheres, bonds, bases] = geometry.group.children as [
			THREE.InstancedMesh,
			LineSegments2,
			LineSegments2,
		];
		const bondBuffer = (bonds.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute)
			.data;
		const before = bondBuffer.array;

		const backboneNm = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 5, 5, 5]);
		const baseNm = backboneNm.map((v) => v + 0.5);
		geometry.update({ backboneNm, baseNm });

		const m = new THREE.Matrix4();
		spheres.getMatrixAt(3, m);
		expect(new THREE.Vector3().setFromMatrixPosition(m).toArray()).toEqual([5, 5, 5]);

		// Two bonds (0→1, 1→2); the buffer is reused, not reallocated.
		expect(bondBuffer.array).toBe(before);
		expect([...bondBuffer.array]).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]);

		const baseBuffer = (bases.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute)
			.data;
		expect([...baseBuffer.array.slice(18, 24)]).toEqual([5, 5, 5, 5.5, 5.5, 5.5]);
	});

	it('colours bonds by their 5′ nucleotide', () => {
		const geometry = buildReplayGeometry(nts);
		const bonds = geometry.group.children[1] as LineSegments2;
		const red = new THREE.Color(1, 0, 0);
		const blue = new THREE.Color(0, 0, 1);
		geometry.setColors([red, blue, blue, red]);
		const colors = (bonds.geometry.getAttribute('instanceColorStart') as InterleavedBufferAttribute)
			.data.array;
		expect([...colors.slice(0, 6)]).toEqual([1, 0, 0, 1, 0, 0]);
		expect([...colors.slice(6, 12)]).toEqual([0, 0, 1, 0, 0, 1]);
	});

	it('enlarges only the hovered sphere and keeps its position', () => {
		const geometry = buildReplayGeometry(nts);
		const spheres = geometry.group.children[0] as THREE.InstancedMesh;
		geometry.update({ backboneNm: new Float32Array(12).fill(1), baseNm: new Float32Array(12) });
		geometry.setHovered(2);
		geometry.setHovered(1);
		const m = new THREE.Matrix4();
		const scale = new THREE.Vector3();
		spheres.getMatrixAt(2, m);
		expect(scale.setFromMatrixScale(m).x).toBe(1);
		spheres.getMatrixAt(1, m);
		expect(scale.setFromMatrixScale(m).x).toBe(2);
		expect(new THREE.Vector3().setFromMatrixPosition(m).toArray()).toEqual([1, 1, 1]);
	});
});

describe('setVisible', () => {
	const nts = [nt(0, 1, -1), nt(1, 2, 0), nt(2, -1, 1), nt(3, -1, -1)];
	const backboneNm = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 5, 5, 5]);
	const baseNm = backboneNm.map((v) => v + 0.5);

	it('draws only shown nucleotides and bonds whose ends are both shown', () => {
		const geometry = buildReplayGeometry(nts);
		const [spheres, bonds, bases] = geometry.group.children as [
			THREE.InstancedMesh,
			LineSegments2,
			LineSegments2,
		];
		geometry.update({ backboneNm, baseNm });
		geometry.setHovered(1);
		geometry.setVisible(new Uint8Array([0, 1, 1, 0]));

		const m = new THREE.Matrix4();
		const scale = new THREE.Vector3();
		const scaleAt = (row: number) => {
			spheres.getMatrixAt(row, m);
			return scale.setFromMatrixScale(m).x;
		};
		expect([0, 1, 2, 3].map(scaleAt)).toEqual([0, 2, 1, 0]);

		expect(bonds.geometry.instanceCount).toBe(1);
		const bondBuffer = (bonds.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute)
			.data.array;
		expect([...bondBuffer.slice(0, 6)]).toEqual([1, 0, 0, 2, 0, 0]);
		expect(bases.geometry.instanceCount).toBe(2);

		geometry.setVisible(null);
		expect([0, 1, 2, 3].map(scaleAt)).toEqual([1, 2, 1, 1]);
		expect(bonds.geometry.instanceCount).toBe(2);
		expect(bases.geometry.instanceCount).toBe(4);
	});
});

describe('pickNucleotide', () => {
	const backbone = new Float32Array([0, 0, -5, 0, 0, 5, 3, 0, 0]);

	it('returns the site nearest the camera along the ray', () => {
		const ray = new THREE.Ray(new THREE.Vector3(0, 0, 20), new THREE.Vector3(0, 0, -1));
		expect(pickNucleotide(ray, backbone)).toBe(1);
	});

	it('skips hidden sites', () => {
		const ray = new THREE.Ray(new THREE.Vector3(0, 0, 20), new THREE.Vector3(0, 0, -1));
		expect(pickNucleotide(ray, backbone, new Uint8Array([1, 0, 1]))).toBe(0);
	});

	it('misses when no site is within the pick radius', () => {
		const ray = new THREE.Ray(new THREE.Vector3(1.5, 0, 20), new THREE.Vector3(0, 0, -1));
		expect(pickNucleotide(ray, backbone)).toBe(-1);
	});

	it('ignores sites behind the ray origin', () => {
		const ray = new THREE.Ray(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
		expect(pickNucleotide(ray, backbone)).toBe(0);
	});
});
