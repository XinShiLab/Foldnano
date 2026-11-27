import * as THREE from 'three';
import type { Part } from '$lib/model/Part';
import type { Occurrence } from '$lib/model/Assembly';
import { backbonePoint, type Vec3 } from '$lib/model/geometry3d/dnaGeometry';
import {
	sidePositions,
	type StickyLinkMode,
	type StickySide,
} from '$lib/model/stickyEnds/stickyEnds';
import type { ColoredStickyMatch } from '$lib/services/stickyEnds/StickyEndMatcher.svelte';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { occurrenceMatrix } from './assemblyScene';
import { drawOncePerPixel, STICKY_STENCIL_REF } from './drawOncePerPixel';
import { LINE_WIDTH } from './helixGeometry';

// Sticky-end matches in 3D (docs/sticky-ends.md): each matched stretch of every visible instance
// is sleeved in its match colour, like a strand drawn in another colour, and dashed lines join its
// sides: between every pair of instances that could bind (`linkMode` 'all'), or from each instance
// to the nearest instance of its partner ('nearest'). Drawn in lab space, from the design
// positions (the line view's).

/** One backbone step of a matched stretch, between two neighbouring bases. */
export interface StickyPiece {
	from: Vec3;
	to: Vec3;
	color: string;
	hovered: boolean;
}

export interface StickyLink {
	from: Vec3;
	to: Vec3;
	color: string;
	hovered: boolean;
}

export interface StickyEndGeometry {
	pieces: StickyPiece[];
	links: StickyLink[];
	/** A listed match is under the pointer: the others fade. */
	anyHovered: boolean;
}

export interface StickyEndScene {
	parts: readonly Part[];
	/** Every instance of a Part; a Part with none is drawn once, where it is. */
	occurrencesOf(partId: string): readonly Occurrence[];
	linkMode: StickyLinkMode;
	hoveredKey: string | null;
}

interface Placement {
	id: string | null;
	matrix: THREE.Matrix4;
}

function placementsOf(scene: StickyEndScene, partId: string): Placement[] {
	const occurrences = scene.occurrencesOf(partId);
	if (occurrences.length === 0) return [{ id: null, matrix: new THREE.Matrix4() }];
	return occurrences
		.filter((o) => o.visible)
		.map((o) => ({ id: o.id, matrix: occurrenceMatrix(o.transform) }));
}

interface SidePoint {
	vhId: string;
	strandIdx: 0 | 1;
	bpIndex: number;
	point: THREE.Vector3;
}

/** Part-space backbone points of a side's bases, one per bp (an insertion's bases share it). */
function sidePoints(part: Part, side: StickySide): SidePoint[] {
	return sidePositions(side).flatMap((base) => {
		if (base.loopIndex > 0) return [];
		const vh = part.getVhById(base.vhId);
		if (!vh) return [];
		const region = part.getRegionForVh(vh);
		const p = backbonePoint(
			part.getVirtualHelixFrame(vh),
			base.bpIndex,
			base.strandIdx,
			region.twistOffsetInDeg,
			region.twistPerBaseInDeg
		);
		const { vhId, strandIdx, bpIndex } = base;
		return [{ vhId, strandIdx, bpIndex, point: new THREE.Vector3(p.x, p.y, p.z) }];
	});
}

/** Neighbouring bases on one helix are joined; a crossover jump is left out, as for strands. */
const adjacent = (a: SidePoint, b: SidePoint): boolean =>
	a.vhId === b.vhId && a.strandIdx === b.strandIdx && Math.abs(a.bpIndex - b.bpIndex) === 1;

function centroid(points: { point: THREE.Vector3 }[]): THREE.Vector3 {
	const c = new THREE.Vector3();
	for (const { point } of points) c.add(point);
	return points.length ? c.divideScalar(points.length) : c;
}

const plain = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export function stickyEndGeometry(
	matches: readonly ColoredStickyMatch[],
	scene: StickyEndScene
): StickyEndGeometry {
	const partById = new Map(scene.parts.map((p) => [p.id, p]));
	const placementCache = new Map<string, Placement[]>();
	const placements = (partId: string) => {
		let list = placementCache.get(partId);
		if (!list) placementCache.set(partId, (list = placementsOf(scene, partId)));
		return list;
	};

	const pieces: StickyPiece[] = [];
	const links: StickyLink[] = [];
	// Each step is drawn once: a base in several matches keeps the first colour, unless hovered.
	const drawn = new Set<string>();
	let anyHovered = false;

	for (const match of matches) {
		const hovered = match.key === scene.hoveredKey;
		anyHovered ||= hovered;
		const sides = match.self ? [match.a] : [match.a, match.b];
		const points = new Map<StickySide, SidePoint[]>();
		for (const side of sides) {
			const part = partById.get(side.run.partId);
			points.set(side, part ? sidePoints(part, side) : []);
		}

		for (const side of sides) {
			const steps = points.get(side)!;
			for (const placement of placements(side.run.partId)) {
				for (let i = 1; i < steps.length; i++) {
					const [a, b] = [steps[i - 1], steps[i]];
					if (!adjacent(a, b)) continue;
					const lo = Math.min(a.bpIndex, b.bpIndex);
					const key = `${placement.id}:${side.run.partId}:${a.vhId}:${a.strandIdx}:${lo}`;
					if (drawn.has(key) && !hovered) continue;
					drawn.add(key);
					pieces.push({
						from: plain(a.point.clone().applyMatrix4(placement.matrix)),
						to: plain(b.point.clone().applyMatrix4(placement.matrix)),
						color: match.color,
						hovered,
					});
				}
			}
		}

		// 'nearest': every instance links its side to the nearest instance of the other side, both
		// ways, so A1–B1 and A2–B2 both show and a spare B3 still gets one; a line found twice is
		// drawn once. 'all': every pair. A self-complementary stretch binds another copy of itself,
		// never its own, and its pairs are unordered.
		const localA = centroid(points.get(match.a)!);
		const localB = centroid(points.get(match.self ? match.a : match.b)!);
		const endsA = placements(match.a.run.partId).map((pl) =>
			localA.clone().applyMatrix4(pl.matrix)
		);
		const endsB = placements(match.b.run.partId).map((pl) =>
			localB.clone().applyMatrix4(pl.matrix)
		);
		const nearest = (from: THREE.Vector3, ends: THREE.Vector3[], skip: number) => {
			let best = -1;
			for (let j = 0; j < ends.length; j++) {
				if (j === skip) continue;
				if (best < 0 || ends[j].distanceToSquared(from) < ends[best].distanceToSquared(from)) {
					best = j;
				}
			}
			return best;
		};
		const linked = new Set<string>();
		const link = (i: number, j: number) => {
			if (i < 0 || j < 0) return;
			const key = match.self ? `${Math.min(i, j)}:${Math.max(i, j)}` : `${i}:${j}`;
			if (linked.has(key)) return;
			linked.add(key);
			links.push({ from: plain(endsA[i]), to: plain(endsB[j]), color: match.color, hovered });
		};
		if (scene.linkMode === 'all') {
			endsA.forEach((_, i) =>
				endsB.forEach((_, j) => {
					if (!match.self || i !== j) link(i, j);
				})
			);
		} else {
			endsA.forEach((at, i) => link(i, nearest(at, endsB, match.self ? i : -1)));
			if (!match.self) endsB.forEach((at, j) => link(nearest(at, endsA, -1), j));
		}
	}
	return { pieces, links, anyHovered };
}

export interface StickyEndOverlay {
	group: THREE.Group;
	update(geometry: StickyEndGeometry): void;
	dispose(): void;
}

// A sleeve a little wider than a strand (LINE_WIDTH), pulled in front of it so the strand reads
// as recoloured over the matched stretch.
const SLEEVE_WIDTH = LINE_WIDTH * 1.5;
const SLEEVE_OPACITY = 0.85;
const FADED_OPACITY = 0.2;
const LINK_PX = 1.5;
const HOVERED_LINK_PX = 2.5;
const DASHES_PER_LINK = 12;
const MIN_DASH_NM = 0.15;
const MAX_DASH_NM = 2;

export function createStickyEndOverlay(): StickyEndOverlay {
	const group = new THREE.Group();
	group.name = 'sticky-ends';

	function clear() {
		for (const child of [...group.children]) {
			const line = child as LineSegments2;
			line.geometry.dispose();
			(line.material as LineMaterial).dispose();
			group.remove(line);
		}
	}

	function addLines(positions: number[], material: LineMaterial, renderOrder = 0, dashed = false) {
		const geometry = new LineSegmentsGeometry();
		geometry.setPositions(new Float32Array(positions));
		const line = new LineSegments2(geometry, material);
		if (dashed) line.computeLineDistances();
		line.frustumCulled = false;
		line.renderOrder = renderOrder;
		group.add(line);
	}

	function update({ pieces, links, anyHovered }: StickyEndGeometry): void {
		clear();
		const opacity = (hovered: boolean) =>
			hovered ? 1 : anyHovered ? FADED_OPACITY : SLEEVE_OPACITY;

		const buckets = new Map<string, { color: string; hovered: boolean; positions: number[] }>();
		for (const p of pieces) {
			const key = `${p.color}:${p.hovered}`;
			let bucket = buckets.get(key);
			if (!bucket)
				buckets.set(key, (bucket = { color: p.color, hovered: p.hovered, positions: [] }));
			bucket.positions.push(p.from.x, p.from.y, p.from.z, p.to.x, p.to.y, p.to.z);
		}
		for (const { color, hovered, positions } of buckets.values()) {
			const material = new LineMaterial({
				color,
				linewidth: SLEEVE_WIDTH,
				worldUnits: true,
				transparent: true,
				opacity: opacity(hovered),
				depthWrite: false,
				polygonOffset: true,
				polygonOffsetFactor: hovered ? -2 : -1,
				polygonOffsetUnits: hovered ? -8 : -4,
			});
			// One stencil mark for every sleeve: joints, neighbouring matches and a hovered match drawn
			// over another all blend once per pixel. The hovered one goes first so it keeps its pixels.
			addLines(positions, drawOncePerPixel(material, STICKY_STENCIL_REF), hovered ? 0 : 1);
		}

		for (const link of links) {
			const { from: a, to: b } = link;
			// Dashes follow the link's length, so a short link still shows several.
			const dash = Math.min(
				MAX_DASH_NM,
				Math.max(MIN_DASH_NM, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / DASHES_PER_LINK)
			);
			const material = new LineMaterial({
				color: link.color,
				linewidth: link.hovered ? HOVERED_LINK_PX : LINK_PX,
				worldUnits: false,
				dashed: true,
				dashSize: dash,
				gapSize: dash * 0.5,
				transparent: true,
				opacity: opacity(link.hovered),
				depthWrite: false,
			});
			addLines([a.x, a.y, a.z, b.x, b.y, b.z], material, 2, true);
		}
	}

	return { group, update, dispose: clear };
}
