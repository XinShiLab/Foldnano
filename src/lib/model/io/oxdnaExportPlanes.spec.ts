import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CadnanoJSON } from '../io/cadnanoJSON';
import { collectOxDnaNucleotides, type OxDnaNucleotide } from './oxdnaExport';
import { isRightHandedBasis, type Vec3 } from '../geometry3d/dnaGeometry';
import { BASIS_PLANE_TRANSFORMS } from '$lib/components/Editor/context/EditorViewContext.svelte';

type BasePlane = keyof typeof BASIS_PLANE_TRANSFORMS;

// Lab = a·u + b·v + c·normal for plane-local (a, b, c); Top is the identity.
const FROM_TOP: Record<BasePlane, (p: Vec3) => Vec3> = {
	XY: (p) => p,
	XZ: (p) => ({ x: p.x, y: p.z, z: -p.y }),
	YZ: (p) => ({ x: p.z, y: p.x, z: p.y }),
};

function exportOn(file: string, plane: BasePlane): OxDnaNucleotide[] {
	const raw = JSON.parse(
		fs.readFileSync(path.resolve('test_files/published_cadnano_designs', file), 'utf-8')
	);
	const part = CadnanoJSON.fromRaw(raw).toPart();
	part.setPlaneTransform(part.getDefaultPlane().id, BASIS_PLANE_TRANSFORMS[plane]);
	return collectOxDnaNucleotides(part);
}

function expectClose(actual: Vec3, expected: Vec3) {
	expect(Math.abs(actual.x - expected.x)).toBeLessThan(1e-9);
	expect(Math.abs(actual.y - expected.y)).toBeLessThan(1e-9);
	expect(Math.abs(actual.z - expected.z)).toBeLessThan(1e-9);
}

describe('base planes', () => {
	it.each(Object.keys(BASIS_PLANE_TRANSFORMS) as BasePlane[])('%s is right-handed', (plane) => {
		const { u, v, normal } = BASIS_PLANE_TRANSFORMS[plane];
		expect(isRightHandedBasis(u, v, normal)).toBe(true);
	});

	// A mirrored plane once made the Side export twist the wrong way (crossovers 1.3-2.5 nm
	// apart); on a right-handed plane the export must be the Top export, rigidly rotated.
	it.each(['XZ', 'YZ'] as BasePlane[])(
		'oxDNA export on %s is exactly the Top export rotated',
		(plane) => {
			const top = exportOn('8hb_2ab_8f.json', 'XY');
			const other = exportOn('8hb_2ab_8f.json', plane);
			expect(other.length).toBe(top.length);
			const rotate = FROM_TOP[plane];
			top.forEach((nt, i) => {
				expect(other[i].next).toBe(nt.next);
				expectClose(other[i].position, rotate(nt.position));
				expectClose(other[i].a1, rotate(nt.a1));
				expectClose(other[i].a3, rotate(nt.a3));
			});
		}
	);
});
