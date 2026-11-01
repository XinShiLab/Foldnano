import type { Part } from '$lib/model/Part';
import { applyTransform, rotateVec } from '$lib/model/geometry3d/dnaGeometry';
import type { Vec3 } from '$lib/model/geometry3d/types';
import type { BlockTransformOverride } from '$lib/model/rbs/rbsTypes';
import {
	buildSimulationNtModel,
	type SimulationFallbackBase,
} from '$lib/model/io/simulationNtModel';

import { OXDNA_NM } from './oxdnaConstants';

export type OxDnaFallbackBase = SimulationFallbackBase;

export interface OxDnaExportResult {
	dat: string;
	top: string;
	nucleotideCount: number;
	strandCount: number;
}

export interface OxDnaNucleotide {
	id: number;
	strandId: number;
	base: string;
	segmentId: string;
	position: Vec3;
	a1: Vec3;
	a3: Vec3;
	prev: number;
	next: number;
}

export function hasRealSequence(part: Part): boolean {
	for (const oligo of part.oligos) {
		for (const seg of oligo.segments) {
			for (const slot of seg.slots) {
				for (const base of slot.seq) {
					const b = base.toUpperCase();
					if (b === 'A' || b === 'C' || b === 'G' || b === 'T') return true;
				}
			}
		}
	}
	return false;
}

export function hasUnassignedSequence(part: Part): boolean {
	for (const oligo of part.oligos) {
		for (const seg of oligo.segments) {
			for (const slot of seg.slots) {
				for (const base of slot.seq) {
					const b = base.toUpperCase();
					if (b !== 'A' && b !== 'C' && b !== 'G' && b !== 'T') return true;
				}
			}
		}
	}
	return false;
}

function nmToOx(v: Vec3): Vec3 {
	return { x: v.x / OXDNA_NM, y: v.y / OXDNA_NM, z: v.z / OXDNA_NM };
}

function transformNmFrame(
	positionNm: Vec3,
	a1: Vec3,
	a3: Vec3,
	override?: BlockTransformOverride
): { positionNm: Vec3; a1: Vec3; a3: Vec3 } {
	if (!override) return { positionNm, a1, a3 };
	return {
		positionNm: applyTransform(positionNm, override),
		a1: rotateVec(override.quaternion, a1),
		a3: rotateVec(override.quaternion, a3),
	};
}

/** Mirror oligos (repeat copies) are left out unless `includeMirrors`, which exports the
 * assembled multimer. */
export function collectOxDnaNucleotides(
	part: Part,
	segPositionOverrides?: Map<string, BlockTransformOverride>,
	fallbackBase: OxDnaFallbackBase = 'T',
	includeMirrors = false
): OxDnaNucleotide[] {
	const model = buildSimulationNtModel(part, { fallbackBase, includeMirrors });
	return model.nucleotides.map((nt) => {
		const frame = transformNmFrame(
			nt.positionNm,
			nt.a1,
			nt.a3,
			segPositionOverrides?.get(nt.segmentId)
		);
		return {
			id: nt.id,
			strandId: nt.strandId,
			base: nt.base,
			segmentId: nt.segmentId,
			position: nmToOx(frame.positionNm),
			a1: frame.a1,
			a3: frame.a3,
			prev: nt.prev,
			next: nt.next,
		};
	});
}

function fmt(n: number): string {
	return Number.isFinite(n) ? n.toFixed(6) : '0.000000';
}

function computeMeanAndMaxDeviation(nts: OxDnaNucleotide[]): { mean: Vec3; maxDev: Vec3 } {
	let sumX = 0,
		sumY = 0,
		sumZ = 0;
	for (const nt of nts) {
		sumX += nt.position.x;
		sumY += nt.position.y;
		sumZ += nt.position.z;
	}
	const mean = { x: sumX / nts.length, y: sumY / nts.length, z: sumZ / nts.length };
	let maxDevX = 0,
		maxDevY = 0,
		maxDevZ = 0;
	for (const nt of nts) {
		maxDevX = Math.max(maxDevX, Math.abs(nt.position.x - mean.x));
		maxDevY = Math.max(maxDevY, Math.abs(nt.position.y - mean.y));
		maxDevZ = Math.max(maxDevZ, Math.abs(nt.position.z - mean.z));
	}
	return { mean, maxDev: { x: maxDevX, y: maxDevY, z: maxDevZ } };
}

function computeBoxSize(maxDev: Vec3, padding = 4): Vec3 {
	const side =
		Math.max(
			maxDev.x * 2 + padding * 2,
			maxDev.y * 2 + padding * 2,
			maxDev.z * 2 + padding * 2,
			1
		) * 1.1;
	return { x: side, y: side, z: side };
}

// Same formula as oxView: the angle of each coordinate on a circle one box side around.
function periodicMean(values: number[], side: number): number {
	let cos = 0;
	let sin = 0;
	for (const value of values) {
		const angle = (value / side) * 2 * Math.PI;
		cos += Math.cos(angle);
		sin += Math.sin(angle);
	}
	return (side / (2 * Math.PI)) * (Math.atan2(-sin, -cos) + Math.PI);
}

function survivesPeriodicRecentering(values: number[], mean: number, side: number): boolean {
	const inBox = values.map((value) => value - mean + side / 2);
	const center = periodicMean(inBox, side);
	return inBox.every((value) => Math.abs(value - center) <= side / 2);
}

// A hollow shape can have its periodic mean on the box edge, not its centre, and oxView then
// wraps the far sides across. See docs/oxdna-export.md § Simulation Box.
function computeBoxForPeriodicViewers(nts: OxDnaNucleotide[], mean: Vec3, maxDev: Vec3): Vec3 {
	const box = computeBoxSize(maxDev);
	const fits = (['x', 'y', 'z'] as const).every((axis) =>
		survivesPeriodicRecentering(
			nts.map((nt) => nt.position[axis]),
			mean[axis],
			box[axis]
		)
	);
	if (fits) return box;
	// Within a quarter box of the mean on every axis, the periodic mean can't leave that quarter.
	const side = Math.max(box.x, Math.max(maxDev.x, maxDev.y, maxDev.z) * 4 * 1.1);
	return { x: side, y: side, z: side };
}

// Centering on the mean rather than the bbox midpoint keeps every nucleotide within half a box of
// wherever a viewer recenters to. See docs/oxdna-export.md § Simulation Box.
function anchorNucleotidesInBox(nts: OxDnaNucleotide[], mean: Vec3, box: Vec3): OxDnaNucleotide[] {
	const shift = { x: mean.x - box.x / 2, y: mean.y - box.y / 2, z: mean.z - box.z / 2 };
	return nts.map((nt) => ({
		...nt,
		position: {
			x: nt.position.x - shift.x,
			y: nt.position.y - shift.y,
			z: nt.position.z - shift.z,
		},
	}));
}

function formatDat(nts: OxDnaNucleotide[]): string {
	if (nts.length === 0) {
		return 't = 0\nb = 100.000000 100.000000 100.000000\nE = 0 0 0\n';
	}
	const { mean, maxDev } = computeMeanAndMaxDeviation(nts);
	const box = computeBoxForPeriodicViewers(nts, mean, maxDev);
	const anchored = anchorNucleotidesInBox(nts, mean, box);
	const lines = [
		't = 0',
		`b = ${fmt(box.x)} ${fmt(box.y)} ${fmt(box.z)}`,
		'E = 0 0 0',
		...anchored.map((nt) =>
			[
				nt.position.x,
				nt.position.y,
				nt.position.z,
				nt.a1.x,
				nt.a1.y,
				nt.a1.z,
				nt.a3.x,
				nt.a3.y,
				nt.a3.z,
				0,
				0,
				0,
				0,
				0,
				0,
			]
				.map(fmt)
				.join(' ')
		),
	];
	return `${lines.join('\n')}\n`;
}

function formatTop(nts: OxDnaNucleotide[], strandCount: number): string {
	const lines = [`${nts.length} ${strandCount}`];
	for (const nt of nts) {
		lines.push(`${nt.strandId} ${nt.base} ${nt.next} ${nt.prev}`);
	}
	return `${lines.join('\n')}\n`;
}

export function exportPartToOxDna(
	part: Part,
	segPositionOverrides?: Map<string, BlockTransformOverride>,
	fallbackBase: OxDnaFallbackBase = 'T',
	includeMirrors = false
): OxDnaExportResult {
	const nts = collectOxDnaNucleotides(part, segPositionOverrides, fallbackBase, includeMirrors);
	const strandCount = new Set(nts.map((nt) => nt.strandId)).size;
	return {
		dat: formatDat(nts),
		top: formatTop(nts, strandCount),
		nucleotideCount: nts.length,
		strandCount,
	};
}
