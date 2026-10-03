/**
 * helixGeometry.ts
 *
 * Converts a cadnano Part model into Three.js scene objects.
 *
 * Coordinate system
 * -----------------
 *  X / Y  — lattice plane (honeycomb or square grid), units: nm
 *  Z      — helix axis, one end at z=0, other end at z = vh.length * BACKBONE_RISE_NM
 *
 * Twist model (mirrors HelixCircle.svelte / HoneycombView.svelte)
 * ---------------------------------------------------------------
 *  angle(strandIdx, bpIdx) = strandIdx * 180 + twistOffsetInDeg + twistPerBaseInDeg * bpIdx
 *  strandIdx 0 → same phase as even-VH scaffold
 *  strandIdx 1 → 180° opposite (complementary strand)
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Part } from '$lib/model/Part';
import type Oligo from '$lib/model/Oligo';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import type { CanHighlight } from '$lib/components/Editor/context/types';
import type { BlockTransformOverride } from '$lib/model/rbs/rbsTypes';
import {
	BACKBONE_RISE_NM,
	BACKBONE_RADIUS_NM,
	applyTransform,
	backbonePointInto,
	buildPhysicalOffsetMaps,
	crossVec,
	getHelixXY,
	getSegmentEndPhysicalIndex,
	getSegmentPhysicalRange,
	getVhXYMap,
	backbonePoint as backbonePointGeom,
	helixCenterPoint,
	type VirtualHelixFrame,
} from '$lib/model/geometry3d/dnaGeometry';
import {
	CM_TO_BACKBONE_NM,
	buildSimulationNtModel,
	type SimulationNtModel,
	type SimulationNucleotide,
} from '$lib/model/io/simulationNtModel';
import { createWatercolorMaterial, softenColor } from './ntWatercolorMaterial';
import { getModificationColor } from '$lib/model/modifications';

export {
	BACKBONE_RISE_NM,
	BACKBONE_RADIUS_NM,
	buildPhysicalOffsetMaps,
	getHelixXY,
	getSegmentEndPhysicalIndex,
	getSegmentPhysicalRange,
	getVhXYMap,
};

// ── Physical constants (nm) ────────────────────────────────────────────────
export const HELIX_VISUAL_RADIUS = 1.0; // ghost cylinder radius (nm)
const LINE_WIDTH = 0.5; // world-unit line half-width → ~1 nm visible diameter
const CROSSOVER_LINE_WIDTH = 0.2; // thinner: crossovers have no base-pair geometry
const DIMMED_FATLINE_OPACITY = 0.25;

// ── NT model (watercolor) ───────────────────────────────────────────────────
const NT_TUBE_RADIUS_NM = 0.28; // backbone tube radius
const NT_TUBE_OPACITY = 0.85;
const NT_TUBE_DIM_OPACITY = 0.4;
// How far the oligo color is lerped toward white before washing — lower = more
// saturated, intense strands; higher = paler, more pastel.
const NT_TUBE_SOFTEN = 0.12;
// Unselected strands (when a selection/highlight is active) render as a neutral
// pale-gray wash so the colored selected strands stand out.
const NT_DIM_COLOR = new THREE.Color(0xcdd1d7);
const RUNG_LINE_WIDTH = 0.13; // world-unit width of base-pair rungs
const RUNG_OPACITY = 0.85;
const RUNG_DIM_OPACITY = 0.28;
const RUNG_COLOR_AT = new THREE.Color(0xd99a5b); // soft amber  (A·T)
const RUNG_COLOR_GC = new THREE.Color(0x4fa8b0); // soft teal   (G·C)
const RUNG_COLOR_UNASSIGNED = new THREE.Color(0xb4bcc6); // pale gray (no sequence)
const NT_CROSSOVER_OPACITY = 0.35; // softened crossover arcs in NT mode

// ── Palette ────────────────────────────────────────────────────────────────
const COLOR_EMPTY = new THREE.Color(0xd0d0d0);
// Shared by strand lines, crossover arcs, and modification flags — grays out
// anything not matching an active highlight filter.
const DIM_COLOR = new THREE.Color(0xb0b0b0);

// ── Modification markers (colored bead at a modified terminus) ──────────────
const MOD_MARKER_RADIUS_NM = 0.45;

// Stress color ramp: green (relaxed) → yellow → red (strained)
const STRESS_GREEN = new THREE.Color(0x00cc44);
const STRESS_YELLOW = new THREE.Color(0xffcc00);
const STRESS_RED = new THREE.Color(0xff2222);

export const STRESS_REST_RATIO = 1;
export const STRESS_YELLOW_RATIO = 5;
export const STRESS_RED_RATIO = 10;

/**
 * Maps crossover length ratio (current distance / rest length) to the
 * diagnostic stress color ramp:
 *
 *   ratio <= 1 → green
 *   ratio = 5  → yellow
 *   ratio >=10 → red
 */
export function stressToColor(stressRatio: number): THREE.Color {
	const ratio = Math.max(0, stressRatio);
	if (ratio <= STRESS_REST_RATIO) return STRESS_GREEN.clone();
	if (ratio <= STRESS_YELLOW_RATIO) {
		const t = (ratio - STRESS_REST_RATIO) / (STRESS_YELLOW_RATIO - STRESS_REST_RATIO);
		return STRESS_GREEN.clone().lerp(STRESS_YELLOW, t);
	}

	const t = Math.min(1, (ratio - STRESS_YELLOW_RATIO) / (STRESS_RED_RATIO - STRESS_YELLOW_RATIO));
	return STRESS_YELLOW.clone().lerp(STRESS_RED, t);
}

// ── Geometry builders ───────────────────────────────────────────────────────

// Label textures are keyed by VH index and reused across rebuilds — canvas
// creation + GPU upload happen once per index for the lifetime of the session.
const _labelTextureCache = new Map<number, THREE.Texture>();

// NT model cache keyed on Part instance: invalidated when VH count, oligo
// count, or total segment count changes; preserved for filter/focus/highlight/
// stress-only rebuilds. WeakMap ensures entries are GC'd with the Part.
const _ntModelCache = new WeakMap<Part, { key: string; model: SimulationNtModel }>();

function makeVhLabel(frame: VirtualHelixFrame, clipLo: number, index: number): THREE.Sprite {
	let texture = _labelTextureCache.get(index);
	if (!texture) {
		const W = 128,
			H = 64;
		const canvas = document.createElement('canvas');
		canvas.width = W;
		canvas.height = H;
		const ctx = canvas.getContext('2d')!;
		ctx.clearRect(0, 0, W, H);
		ctx.fillStyle = '#334155';
		ctx.font = 'bold 48px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(String(index), W / 2, H / 2);
		texture = new THREE.CanvasTexture(canvas);
		_labelTextureCache.set(index, texture);
	}
	const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
	const sprite = new THREE.Sprite(mat);
	sprite.scale.set(3, 1.5, 1);
	const base = helixCenterPoint(frame, clipLo);
	sprite.position.set(base.x, base.y - HELIX_VISUAL_RADIUS - 1.2, base.z);
	return sprite;
}

/**
 * Small colored bead marking a modified terminus, sitting directly on the
 * backbone point (no offset). A stick-and-flag pointing outward was tried and
 * discarded: lattice helices sit only ~2.2nm apart center-to-center while each
 * ghost cylinder already has a 1.0nm visual radius, so there's rarely enough
 * genuinely empty space around an interior helix for anything to reach into
 * without colliding with a neighbor. A marker that never leaves its own
 * strand's footprint can't have that problem.
 */
function addModificationMarker(
	group: THREE.Group,
	anchor: THREE.Vector3,
	color: string,
	dim: boolean
): void {
	const geo = new THREE.SphereGeometry(MOD_MARKER_RADIUS_NM, 12, 8);
	const mat = new THREE.MeshBasicMaterial({
		color: new THREE.Color(color),
		...(dim ? { transparent: true, opacity: DIMMED_FATLINE_OPACITY } : {}),
	});
	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.copy(anchor);
	group.add(mesh);
}

function makeCylinder(frame: VirtualHelixFrame, clipLo: number, clipHi: number): THREE.Mesh {
	const height = (clipHi - clipLo + 1) * BACKBONE_RISE_NM;
	const centerBpIdx = clipLo + (clipHi - clipLo) / 2;
	const center = helixCenterPoint(frame, centerBpIdx);
	const geo = new THREE.CylinderGeometry(HELIX_VISUAL_RADIUS, HELIX_VISUAL_RADIUS, height, 16);
	const mat = new THREE.MeshLambertMaterial({
		color: COLOR_EMPTY,
		transparent: true,
		opacity: 0.18,
	});
	const mesh = new THREE.Mesh(geo, mat);
	// CylinderGeometry default axis is Y; align to frame.axis
	mesh.quaternion.setFromUnitVectors(
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(frame.axis.x, frame.axis.y, frame.axis.z)
	);
	mesh.position.set(center.x, center.y, center.z);
	return mesh;
}

function buildCylinderInstances(
	entries: { frame: VirtualHelixFrame; clipLo: number; clipHi: number }[]
): THREE.InstancedMesh {
	// Unit-height cylinder; actual height is encoded as Y-scale per instance so all
	// instances share one geometry and one draw call.
	const geo = new THREE.CylinderGeometry(HELIX_VISUAL_RADIUS, HELIX_VISUAL_RADIUS, 1, 16);
	const mat = new THREE.MeshLambertMaterial({
		color: COLOR_EMPTY,
		transparent: true,
		opacity: 0.18,
	});
	const mesh = new THREE.InstancedMesh(geo, mat, entries.length);
	const matrix = new THREE.Matrix4();
	const quat = new THREE.Quaternion();
	const yAxis = new THREE.Vector3(0, 1, 0);
	const axisVec = new THREE.Vector3();
	const centerVec = new THREE.Vector3();
	const scaleVec = new THREE.Vector3();
	for (let i = 0; i < entries.length; i++) {
		const { frame, clipLo, clipHi } = entries[i];
		const height = (clipHi - clipLo + 1) * BACKBONE_RISE_NM;
		const c = helixCenterPoint(frame, clipLo + (clipHi - clipLo) / 2);
		axisVec.set(frame.axis.x, frame.axis.y, frame.axis.z);
		centerVec.set(c.x, c.y, c.z);
		scaleVec.set(1, height, 1);
		quat.setFromUnitVectors(yAxis, axisVec);
		matrix.compose(centerVec, quat, scaleVec);
		mesh.setMatrixAt(i, matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
	mesh.computeBoundingSphere();
	return mesh;
}

// ── Twist helper ────────────────────────────────────────────────────────────

export function backbonePointNm(
	hx: number,
	hy: number,
	bpIdx: number,
	strandIdx: number,
	twistOffsetDeg: number,
	twistPerBaseDeg: number
): THREE.Vector3 {
	// Convenience wrapper for callers that still use the flat (hx, hy) API.
	// Constructs a synthetic +Z frame from the given origin.
	const syntheticFrame: VirtualHelixFrame = {
		origin: { x: hx, y: hy, z: 0 },
		axis: { x: 0, y: 0, z: 1 },
		radial0: { x: 1, y: 0, z: 0 },
	};
	const p = backbonePointGeom(
		syntheticFrame,
		bpIdx,
		strandIdx as 0 | 1,
		twistOffsetDeg,
		twistPerBaseDeg
	);
	return new THREE.Vector3(p.x, p.y, p.z);
}

// ── Block transform helpers ─────────────────────────────────────────────────

/**
 * Apply a block transform to a lattice-frame twistedPoint.
 */
function applyBlockTransform(p: THREE.Vector3, ov: BlockTransformOverride): THREE.Vector3 {
	const transformed = applyTransform(p, ov);
	return new THREE.Vector3(transformed.x, transformed.y, transformed.z);
}

function segmentKey(segmentId: string, end: 'fivePrime' | 'threePrime'): string {
	return `${segmentId}:${end}`;
}

function pointFromNt(
	nt: SimulationNucleotide,
	segPositionOverrides?: Map<string, BlockTransformOverride>
): THREE.Vector3 {
	// Offset from CM to backbone phosphate: backbone = CM - CM_TO_BACKBONE_NM * a1
	// (a1 points inward, so subtracting it moves outward to the backbone)
	const backbone = {
		x: nt.positionNm.x - CM_TO_BACKBONE_NM * nt.a1.x,
		y: nt.positionNm.y - CM_TO_BACKBONE_NM * nt.a1.y,
		z: nt.positionNm.z - CM_TO_BACKBONE_NM * nt.a1.z,
	};
	const override = segPositionOverrides?.get(nt.segmentId);
	const position = override ? applyTransform(backbone, override) : backbone;
	return new THREE.Vector3(position.x, position.y, position.z);
}

// Smooth translucent backbone tube through a run's backbone points — the
// watercolor sugar-phosphate strand of the DNA double helix.
function addBackboneTube(
	group: THREE.Group,
	points: THREE.Vector3[],
	color: THREE.Color,
	opacity: number
): void {
	if (points.length < 2) return;
	const curve = new THREE.CatmullRomCurve3(points);
	const tubularSegments = Math.max(2, (points.length - 1) * 2);
	const geo = new THREE.TubeGeometry(curve, tubularSegments, NT_TUBE_RADIUS_NM, 8, false);
	const mesh = new THREE.Mesh(geo, createWatercolorMaterial({ color, opacity }));
	mesh.name = 'nt-model-backbone-tube';
	mesh.userData.kind = 'nt-model-backbone-tube';
	mesh.frustumCulled = false;
	group.add(mesh);
}

// Watercolor tone for a base-pair rung: two-tone by pair type (A·T vs G·C),
// pale gray when neither partner has an assigned sequence.
function rungTone(a: SimulationNucleotide, b: SimulationNucleotide): THREE.Color {
	if (!a.baseAssigned && !b.baseAssigned) return RUNG_COLOR_UNASSIGNED;
	const base = a.baseAssigned ? a.base : b.base;
	return base === 'A' || base === 'T' ? RUNG_COLOR_AT : RUNG_COLOR_GC;
}

// djb2 hash over every slot sequence — cheap (runs only on scene rebuild) and
// changes whenever any base is (re)assigned, invalidating the NT model cache.
function ntSequenceSignature(part: Part): number {
	let h = 5381;
	for (const oligo of part.oligos) {
		for (const segment of oligo.segments) {
			for (const slot of segment.slots) {
				const seq = slot.seq;
				for (let i = 0; i < seq.length; i++) {
					h = ((h << 5) + h + seq.charCodeAt(i)) | 0;
				}
				h = ((h << 5) + h + 124) | 0; // '|' slot separator
			}
		}
	}
	return h >>> 0;
}

function addNtModelGeometry(
	group: THREE.Group,
	part: Part,
	highlightContext: Record<CanHighlight, boolean>,
	filterSegments: Set<OligoSegment> | null,
	focusedSegments: Set<OligoSegment> | null,
	segPositionOverrides?: Map<string, BlockTransformOverride>
): Map<string, THREE.Vector3> {
	const endpointPositions = new Map<string, THREE.Vector3>();
	const anyHighlightActive = Object.values(highlightContext).some(Boolean);
	const anyFocusActive = (focusedSegments?.size ?? 0) > 0;
	const segmentVisuals = new Map<
		string,
		{ color: THREE.Color; dim: boolean; mirror: boolean; hidden: boolean }
	>();

	for (const oligo of part.oligos) {
		const highlighted = isOligoHighlighted(oligo, highlightContext);
		const highlightDim = anyHighlightActive && !highlighted;
		const color = highlightDim ? DIM_COLOR : new THREE.Color(oligo.color);
		for (const segment of oligo.segments) {
			const focusDim = anyFocusActive && !focusedSegments?.has(segment);
			segmentVisuals.set(segment.id, {
				color,
				dim: highlightDim || focusDim,
				mirror: oligo.isMirror,
				hidden: Boolean(filterSegments && !filterSegments.has(segment)),
			});
		}
	}

	let segTotal = 0;
	for (const oligo of part.oligos) segTotal += oligo.segments.size;
	// Include a sequence hash so re-toggling NT mode (or any rebuild) picks up
	// sequence edits — rungs are tinted by base, so stale bases mis-colour them.
	const ntKey = `${part.virtualHelices.length}:${part.oligos.size}:${segTotal}:${ntSequenceSignature(part)}`;
	const cached = _ntModelCache.get(part);
	if (cached?.key !== ntKey) {
		_ntModelCache.set(part, { key: ntKey, model: buildSimulationNtModel(part) });
	}
	const model = _ntModelCache.get(part)!.model;

	// ── Backbone tubes: one watercolor tube per contiguous (segment, strand) run ──
	let currentRun: SimulationNucleotide[] = [];

	function flushRun(): void {
		if (currentRun.length === 0) return;
		const first = currentRun[0];
		const visual = segmentVisuals.get(first.segmentId);
		if (!visual || visual.hidden) {
			currentRun = [];
			return;
		}

		endpointPositions.set(
			segmentKey(first.segmentId, 'fivePrime'),
			pointFromNt(first, segPositionOverrides)
		);
		endpointPositions.set(
			segmentKey(first.segmentId, 'threePrime'),
			pointFromNt(currentRun[currentRun.length - 1], segPositionOverrides)
		);

		if (currentRun.length >= 2) {
			const points = currentRun.map((nt) => pointFromNt(nt, segPositionOverrides));
			addBackboneTube(
				group,
				points,
				visual.dim ? NT_DIM_COLOR : softenColor(visual.color, NT_TUBE_SOFTEN),
				// Mirror oligos (repeat copies) keep their color but render translucent.
				visual.dim || visual.mirror ? NT_TUBE_DIM_OPACITY : NT_TUBE_OPACITY
			);
		}
		currentRun = [];
	}

	for (const nt of model.nucleotides) {
		if (
			currentRun.length > 0 &&
			(currentRun[currentRun.length - 1].segmentId !== nt.segmentId ||
				currentRun[currentRun.length - 1].strandId !== nt.strandId)
		) {
			flushRun();
		}
		currentRun.push(nt);
	}
	flushRun();

	// ── Base-pair rungs: group complementary NTs by pairKey, tint by sequence ──
	const pairGroups = new Map<string, SimulationNucleotide[]>();
	for (const nt of model.nucleotides) {
		const arr = pairGroups.get(nt.pairKey);
		if (arr) arr.push(nt);
		else pairGroups.set(nt.pairKey, [nt]);
	}
	const rungBuckets = new Map<string, { color: THREE.Color; dim: boolean; positions: number[] }>();
	for (const pair of pairGroups.values()) {
		if (pair.length !== 2) continue; // unpaired overhangs/loops get no rung
		const [a, b] = pair;
		const va = segmentVisuals.get(a.segmentId);
		const vb = segmentVisuals.get(b.segmentId);
		if (!va || !vb || va.hidden || vb.hidden) continue;
		// Rung keeps its sequence tint if either partner is selected; only fully
		// unselected pairs go gray, matching the dimmed backbone tubes.
		const dim = va.dim && vb.dim;
		const tone = dim ? NT_DIM_COLOR : rungTone(a, b);
		const key = `${tone.getHexString()}:${dim ? 'dim' : 'solid'}`;
		let bucket = rungBuckets.get(key);
		if (!bucket) {
			bucket = { color: tone, dim, positions: [] };
			rungBuckets.set(key, bucket);
		}
		const pa = pointFromNt(a, segPositionOverrides);
		const pb = pointFromNt(b, segPositionOverrides);
		bucket.positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
	}
	for (const bucket of rungBuckets.values()) {
		const geo = new LineSegmentsGeometry();
		geo.setPositions(new Float32Array(bucket.positions));
		const mat = new LineMaterial({
			color: bucket.color,
			linewidth: RUNG_LINE_WIDTH,
			worldUnits: true,
			transparent: true,
			opacity: bucket.dim ? RUNG_DIM_OPACITY : RUNG_OPACITY,
		});
		const lines = new LineSegments2(geo, mat);
		lines.name = 'nt-model-base-rungs';
		lines.userData.kind = 'nt-model-base-rungs';
		lines.frustumCulled = false;
		group.add(lines);
	}

	return endpointPositions;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface BuildResult {
	group: THREE.Group;
	/** Sub-group containing only the ghost cylinders — toggle .visible to show/hide grid */
	cylinders: THREE.Group;
	/** Sub-group containing VH index label sprites — toggle .visible with cylinders */
	labels: THREE.Group;
	/** Sub-group containing crossover arcs — toggle .visible reactively */
	crossovers: THREE.Group;
	/** World-space center of all helices — use as OrbitControls target */
	center: THREE.Vector3;
}

const DEFAULT_HIGHLIGHT_CONTEXT: Record<CanHighlight, boolean> = {
	scaffold: false,
	circular_strand: false,
	modification_site: false,
	longer_than_90: false,
	shorter_than_15: false,
};

function isOligoHighlighted(oligo: Oligo, h: Record<CanHighlight, boolean>): boolean {
	if (h.scaffold && oligo.isScaffold) return true;
	if (h.circular_strand && oligo.isCircular) return true;
	if (h.longer_than_90 && oligo.length > 90) return true;
	if (h.shorter_than_15 && oligo.length < 15) return true;
	return false;
}

export function buildScene(
	part: Part,
	showNtModel = false,
	highlightContext: Record<CanHighlight, boolean> = DEFAULT_HIGHLIGHT_CONTEXT,
	filterSegments: Set<OligoSegment> | null = null,
	focusedSegments: Set<OligoSegment> | null = null,
	segPositionOverrides?: Map<string, BlockTransformOverride>,
	/** Crossover length ratio per constraint ID. When present, crossover arcs are colored by stress instead of oligo color. */
	stressMap?: Map<string, number>
): BuildResult {
	const group = new THREE.Group();

	// Collect per-VH frames and twist params for all geometry; keyed by vh.index
	const vhFrames = new Map<number, VirtualHelixFrame>();
	const vhTwist = new Map<number, { twistOffsetDeg: number; twistPerBaseDeg: number }>();

	// ── Step 0: find occupied bp range per VH ────────────────────────────
	const CYLINDER_MARGIN_BP = 7;
	const vhOccupied = new Map<number, { lo: number; hi: number }>();
	for (const oligo of part.oligos) {
		for (const seg of oligo.segments) {
			const idx = seg.inVirtualHelix.index;
			const lo = Math.min(seg.fivePrime.index, seg.threePrime.index);
			const hi = Math.max(seg.fivePrime.index, seg.threePrime.index);
			const cur = vhOccupied.get(idx);
			if (!cur) vhOccupied.set(idx, { lo, hi });
			else {
				cur.lo = Math.min(cur.lo, lo);
				cur.hi = Math.max(cur.hi, hi);
			}
		}
	}

	const helices = part.virtualHelices;

	const physOffsetMaps = showNtModel ? buildPhysicalOffsetMaps(part) : new Map();

	// Precomputed per-VH radial1 = crossVec(axis, radial0) — eliminates the cross-product
	// that backbonePoint recomputes for every nucleotide.
	const vhRadial1 = new Map<number, ReturnType<typeof crossVec>>();
	// Shared scratch buffer reused across all backbone point computations in this call.
	const tmp = new Float32Array(3);

	// ── Step 1: draw ghost cylinders and VH labels ───────────────────────
	const cylinders = new THREE.Group();
	const labels = new THREE.Group();
	const cylEntries: { frame: VirtualHelixFrame; clipLo: number; clipHi: number }[] = [];
	for (const vh of helices) {
		// In NT model mode, use simulation geometry (oxDNA inter-helix spacing) so
		// cylinder axes match where the NT dots actually appear.
		const frame = part.getVirtualHelixFrame(vh);
		vhFrames.set(vh.index, frame);
		vhRadial1.set(vh.index, crossVec(frame.axis, frame.radial0));
		const region = part.getRegionForVh(vh);
		vhTwist.set(vh.index, {
			twistOffsetDeg: region.twistOffsetInDeg,
			twistPerBaseDeg: region.twistPerBaseInDeg,
		});

		const occ = vhOccupied.get(vh.index);
		if (!occ) continue; // no strands → hide cylinder entirely
		const clipLo = Math.max(0, occ.lo - CYLINDER_MARGIN_BP);
		const clipHi = Math.min(vh.length - 1, occ.hi + CYLINDER_MARGIN_BP);
		cylEntries.push({ frame, clipLo, clipHi });
		labels.add(makeVhLabel(frame, clipLo, vh.index));
	}
	if (cylEntries.length > 0) cylinders.add(buildCylinderInstances(cylEntries));
	group.add(cylinders);
	group.add(labels);

	// ── Step 2: draw strands as twisted colored lines ─────────────────────
	const anyHighlightActive = Object.values(highlightContext).some(Boolean);
	const anyFocusActive = (focusedSegments?.size ?? 0) > 0;

	const ntEndpointPositions = showNtModel
		? addNtModelGeometry(
				group,
				part,
				highlightContext,
				filterSegments,
				focusedSegments,
				segPositionOverrides
			)
		: null;

	if (!showNtModel) {
		// Bucket accumulator: one entry per (color, dim) pair → one LineSegments2 draw call each.
		type StrandBucket = { positions: number[]; dim: boolean; color: THREE.Color };
		const strandBuckets = new Map<string, StrandBucket>();
		const prev = new Float32Array(3);

		for (const oligo of part.oligos) {
			const highlighted = isOligoHighlighted(oligo, highlightContext);
			const highlightDim = anyHighlightActive && !highlighted;
			const color = highlightDim ? DIM_COLOR : new THREE.Color(oligo.color);

			for (const seg of oligo.segments) {
				if (filterSegments && !filterSegments.has(seg)) continue;
				const focusDim = anyFocusActive && !focusedSegments?.has(seg);
				const dim = highlightDim || focusDim || oligo.isMirror;
				const vhFrame = vhFrames.get(seg.inVirtualHelix.index);
				if (!vhFrame) continue;
				const tw = vhTwist.get(seg.inVirtualHelix.index)!;

				const s = seg.inStrandIndex as 0 | 1;
				const { lo: physStart, totalNts } = getSegmentPhysicalRange(seg, false, physOffsetMaps);
				if (totalNts < 2) continue;

				const override = segPositionOverrides?.get(seg.id);
				const radial1 = vhRadial1.get(seg.inVirtualHelix.index)!;

				const bucketKey = `${color.getHexString()}:${dim ? '1' : '0'}`;
				let bucket = strandBuckets.get(bucketKey);
				if (!bucket) {
					bucket = { positions: [], dim, color: color.clone() };
					strandBuckets.set(bucketKey, bucket);
				}

				// Emit consecutive point-pairs [p0→p1, p1→p2, …] as flat XYZ triplets.
				// Each pair is an independent LineSegments2 segment; visually continuous
				// because adjacent endpoints share the same coordinates.
				for (let i = 0; i < totalNts; i++) {
					backbonePointInto(
						vhFrame,
						radial1,
						physStart + i,
						s,
						tw.twistOffsetDeg,
						tw.twistPerBaseDeg,
						tmp,
						0
					);
					if (override) {
						const tv = applyBlockTransform(new THREE.Vector3(tmp[0], tmp[1], tmp[2]), override);
						tmp[0] = tv.x;
						tmp[1] = tv.y;
						tmp[2] = tv.z;
					}
					if (i > 0) {
						bucket.positions.push(prev[0], prev[1], prev[2], tmp[0], tmp[1], tmp[2]);
					}
					prev[0] = tmp[0];
					prev[1] = tmp[1];
					prev[2] = tmp[2];
				}
			}
		}

		for (const bucket of strandBuckets.values()) {
			if (bucket.positions.length === 0) continue;
			const geo = new LineSegmentsGeometry();
			geo.setPositions(new Float32Array(bucket.positions));
			const mat = new LineMaterial({
				color: bucket.color,
				linewidth: LINE_WIDTH,
				worldUnits: true,
				transparent: bucket.dim,
				opacity: bucket.dim ? DIMMED_FATLINE_OPACITY : 1,
			});
			group.add(new LineSegments2(geo, mat));
		}
	}

	// ── Step 2.5: draw modification markers ───────────────────────────────
	// Line view only — the NT model is format-agnostic and never touches
	// `.modification`. Only an oligo's overall termini can carry one.
	if (!showNtModel) {
		for (const oligo of part.oligos) {
			const highlightDim = anyHighlightActive && !isOligoHighlighted(oligo, highlightContext);
			for (const end of [oligo.fivePrime, oligo.threePrime]) {
				if (!end || !end.modification) continue;
				const seg = end.segment;
				if (filterSegments && !filterSegments.has(seg)) continue;
				const focusDim = anyFocusActive && !focusedSegments?.has(seg);
				const dim = highlightDim || focusDim || oligo.isMirror;
				const vhFrame = vhFrames.get(seg.inVirtualHelix.index);
				if (!vhFrame) continue;
				const tw = vhTwist.get(seg.inVirtualHelix.index)!;
				const radial1 = vhRadial1.get(seg.inVirtualHelix.index)!;

				backbonePointInto(
					vhFrame,
					radial1,
					end.index,
					seg.inStrandIndex as 0 | 1,
					tw.twistOffsetDeg,
					tw.twistPerBaseDeg,
					tmp,
					0
				);
				const rawAnchor = new THREE.Vector3(tmp[0], tmp[1], tmp[2]);
				const override = segPositionOverrides?.get(seg.id);
				const anchor = override ? applyBlockTransform(rawAnchor, override) : rawAnchor;

				addModificationMarker(
					group,
					anchor,
					getModificationColor(end.modification, part.customModifications),
					dim
				);
			}
		}
	}

	// ── Step 3: draw crossover arcs ───────────────────────────────────────
	// No deduplication: each connection is iterated exactly once (from its 3' end).
	// The old sorted-key deduplication incorrectly dropped one crossover in 2-segment
	// circular oligos where seg1→seg2 and seg2→seg1 are two distinct crossovers.

	const crossovers = new THREE.Group();

	// Buckets for non-stress arcs: one LineSegments2 per distinct (color, dim) pair.
	type XoverBucket = { positions: number[]; dim: boolean; color: THREE.Color };
	const xoverBuckets = new Map<string, XoverBucket>();
	// Stress arcs use vertex colors; at most 2 draw calls (solid + dim).
	const stressSolid = { positions: [] as number[], colors: [] as number[] };
	const stressDim = { positions: [] as number[], colors: [] as number[] };

	for (const oligo of part.oligos) {
		const highlighted = isOligoHighlighted(oligo, highlightContext);
		const highlightDim = anyHighlightActive && !highlighted;
		const oligoColor = highlightDim ? DIM_COLOR : new THREE.Color(oligo.color);
		for (const seg of oligo.segments) {
			const threePrime = seg.threePrime;
			if (!threePrime.connectedSegment) continue;

			const toSeg = threePrime.connectedSegment;
			// Only draw crossover if both endpoint segments are in the filter
			if (filterSegments && (!filterSegments.has(seg) || !filterSegments.has(toSeg))) continue;
			const focusDim =
				anyFocusActive && (!focusedSegments?.has(seg) || !focusedSegments?.has(toSeg));
			const dim = highlightDim || focusDim || oligo.isMirror;

			const fromFrame = vhFrames.get(seg.inVirtualHelix.index);
			const toFrame = vhFrames.get(toSeg.inVirtualHelix.index);
			if (!fromFrame || !toFrame) continue;
			const fromTw = vhTwist.get(seg.inVirtualHelix.index)!;
			const toTw = vhTwist.get(toSeg.inVirtualHelix.index)!;

			const fromOverride = segPositionOverrides?.get(seg.id);
			const toOverride = segPositionOverrides?.get(toSeg.id);

			let from3D = ntEndpointPositions?.get(segmentKey(seg.id, 'threePrime'));
			let to3D = ntEndpointPositions?.get(segmentKey(toSeg.id, 'fivePrime'));
			if (!from3D || !to3D) {
				const fromPhysIdx = getSegmentEndPhysicalIndex(
					seg,
					'threePrime',
					showNtModel,
					physOffsetMaps
				);
				const toPhysIdx = getSegmentEndPhysicalIndex(
					toSeg,
					'fivePrime',
					showNtModel,
					physOffsetMaps
				);

				backbonePointInto(
					fromFrame,
					vhRadial1.get(seg.inVirtualHelix.index)!,
					fromPhysIdx,
					seg.inStrandIndex as 0 | 1,
					fromTw.twistOffsetDeg,
					fromTw.twistPerBaseDeg,
					tmp,
					0
				);
				const fromLatP = new THREE.Vector3(tmp[0], tmp[1], tmp[2]);
				from3D = fromOverride ? applyBlockTransform(fromLatP, fromOverride) : fromLatP;

				backbonePointInto(
					toFrame,
					vhRadial1.get(toSeg.inVirtualHelix.index)!,
					toPhysIdx,
					toSeg.inStrandIndex as 0 | 1,
					toTw.twistOffsetDeg,
					toTw.twistPerBaseDeg,
					tmp,
					0
				);
				const toLatP = new THREE.Vector3(tmp[0], tmp[1], tmp[2]);
				to3D = toOverride ? applyBlockTransform(toLatP, toOverride) : toLatP;
			}

			const dir: -1 | 1 =
				(seg.inStrandIndex === 0 && to3D.y <= from3D.y) ||
				(seg.inStrandIndex === 1 && to3D.y >= from3D.y)
					? -1
					: 1;

			// Bezier control point (same bulge logic as before)
			const mid = from3D.clone().lerp(to3D, 0.5);
			const dx = to3D.x - from3D.x;
			const dy = to3D.y - from3D.y;
			const L = Math.hypot(dx, dy);
			if (L > 0) {
				const nx = -dy / L;
				const ny = dx / L;
				const bulge = Math.min(L * 0.35, 4.0);
				mid.x += dir * bulge * nx;
				mid.y += dir * bulge * ny;
			}

			const constraintId = `${seg.id}:3-${toSeg.id}:5`;
			const stress = stressMap?.get(constraintId);
			const arcPoints = new THREE.QuadraticBezierCurve3(from3D, mid, to3D).getPoints(20);

			if (stress !== undefined) {
				const arcColor = stressToColor(stress);
				const acc = dim ? stressDim : stressSolid;
				const r = arcColor.r,
					g = arcColor.g,
					b = arcColor.b;
				for (let i = 0; i < 20; i++) {
					const p0 = arcPoints[i],
						p1 = arcPoints[i + 1];
					acc.positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
					acc.colors.push(r, g, b, r, g, b);
				}
			} else {
				// In NT mode unselected arcs go gray to match the dimmed backbone tubes.
				const arcColor = showNtModel && dim && !oligo.isMirror ? NT_DIM_COLOR : oligoColor;
				const bucketKey = `${arcColor.getHexString()}:${dim ? '1' : '0'}`;
				let bucket = xoverBuckets.get(bucketKey);
				if (!bucket) {
					bucket = { positions: [], dim, color: arcColor.clone() };
					xoverBuckets.set(bucketKey, bucket);
				}
				for (let i = 0; i < 20; i++) {
					const p0 = arcPoints[i],
						p1 = arcPoints[i + 1];
					bucket.positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
				}
			}
		}
	}

	for (const bucket of xoverBuckets.values()) {
		if (bucket.positions.length === 0) continue;
		const geo = new LineSegmentsGeometry();
		geo.setPositions(new Float32Array(bucket.positions));
		// In NT (watercolor) mode the arcs are softened to blend with the translucent tubes.
		const solidOpacity = showNtModel ? NT_CROSSOVER_OPACITY : 1;
		crossovers.add(
			new LineSegments2(
				geo,
				new LineMaterial({
					color: bucket.color,
					linewidth: CROSSOVER_LINE_WIDTH,
					worldUnits: true,
					transparent: bucket.dim || showNtModel,
					opacity: bucket.dim ? DIMMED_FATLINE_OPACITY : solidOpacity,
				})
			)
		);
	}

	if (stressSolid.positions.length > 0) {
		const geo = new LineSegmentsGeometry();
		geo.setPositions(new Float32Array(stressSolid.positions));
		geo.setColors(new Float32Array(stressSolid.colors));
		crossovers.add(
			new LineSegments2(
				geo,
				new LineMaterial({ linewidth: CROSSOVER_LINE_WIDTH, worldUnits: true, vertexColors: true })
			)
		);
	}
	if (stressDim.positions.length > 0) {
		const geo = new LineSegmentsGeometry();
		geo.setPositions(new Float32Array(stressDim.positions));
		geo.setColors(new Float32Array(stressDim.colors));
		crossovers.add(
			new LineSegments2(
				geo,
				new LineMaterial({
					linewidth: CROSSOVER_LINE_WIDTH,
					worldUnits: true,
					vertexColors: true,
					transparent: true,
					opacity: DIMMED_FATLINE_OPACITY,
				})
			)
		);
	}

	group.add(crossovers);

	// ── Compute center for camera targeting ───────────────────────────────
	// Use the midpoint of each VH's occupied range so the center is correct
	// along the helix axis, not biased toward bp=0 (frame origin).
	const center = new THREE.Vector3();
	for (const { frame, clipLo, clipHi } of cylEntries) {
		const mid = helixCenterPoint(frame, clipLo + (clipHi - clipLo) / 2);
		center.x += mid.x;
		center.y += mid.y;
		center.z += mid.z;
	}
	center.divideScalar(cylEntries.length || 1);

	return { group, cylinders, labels, crossovers, center };
}

// ── Export-safe scene builder ──────────────────────────────────────────────
// Replaces Line2/LineMaterial (not supported by GLTFExporter) with TubeGeometry
// meshes so the exported GLB contains real 3-D geometry openable in Blender,
// Chimera, PowerPoint, Mac Preview, etc.

const STRAND_TUBE_R = 0.3; // nm — backbone tube radius
const XOVER_TUBE_R = 0.15; // nm — crossover arc tube radius
const TUBE_RADIAL_SEGS = 6; // hexagonal cross-section (low-poly, fast)

export function buildExportScene(
	part: Part,
	insertEffects = true,
	highlightContext: Record<CanHighlight, boolean> = DEFAULT_HIGHLIGHT_CONTEXT,
	filterSegments: Set<OligoSegment> | null = null,
	focusedSegments: Set<OligoSegment> | null = null,
	includeGrid = false,
	segPositionOverrides?: Map<string, BlockTransformOverride>
): THREE.Group {
	const group = new THREE.Group();

	// ── Occupied bp range per VH (needed for optional grid cylinders) ─────
	const CYLINDER_MARGIN_BP = 7;
	const vhOccupied = new Map<number, { lo: number; hi: number }>();
	for (const oligo of part.oligos) {
		for (const seg of oligo.segments) {
			const idx = seg.inVirtualHelix.index;
			const lo = Math.min(seg.fivePrime.index, seg.threePrime.index);
			const hi = Math.max(seg.fivePrime.index, seg.threePrime.index);
			const cur = vhOccupied.get(idx);
			if (!cur) vhOccupied.set(idx, { lo, hi });
			else {
				cur.lo = Math.min(cur.lo, lo);
				cur.hi = Math.max(cur.hi, hi);
			}
		}
	}

	const physOffsetMaps = insertEffects ? buildPhysicalOffsetMaps(part) : new Map();

	// ── VH frames + optional grid cylinders ──────────────────────────────
	const vhFrames = new Map<number, VirtualHelixFrame>();
	const vhTwist = new Map<number, { twistOffsetDeg: number; twistPerBaseDeg: number }>();
	for (const vh of part.virtualHelices) {
		const frame = part.getVirtualHelixFrame(vh);
		vhFrames.set(vh.index, frame);
		const region = part.getRegionForVh(vh);
		vhTwist.set(vh.index, {
			twistOffsetDeg: region.twistOffsetInDeg,
			twistPerBaseDeg: region.twistPerBaseInDeg,
		});

		if (includeGrid) {
			const occ = vhOccupied.get(vh.index);
			if (occ) {
				const clipLo = Math.max(0, occ.lo - CYLINDER_MARGIN_BP);
				const clipHi = Math.min(vh.length - 1, occ.hi + CYLINDER_MARGIN_BP);
				group.add(makeCylinder(frame, clipLo, clipHi));
			}
		}
	}

	const anyHighlightActive = Object.values(highlightContext).some(Boolean);
	const anyFocusActive = (focusedSegments?.size ?? 0) > 0;

	// ── Strand tubes ──────────────────────────────────────────────────────
	for (const oligo of part.oligos) {
		const highlighted = isOligoHighlighted(oligo, highlightContext);
		const highlightDim = anyHighlightActive && !highlighted;
		const color = highlightDim ? DIM_COLOR : new THREE.Color(oligo.color);

		for (const seg of oligo.segments) {
			if (filterSegments && !filterSegments.has(seg)) continue;
			const focusDim = anyFocusActive && !focusedSegments?.has(seg);
			const dim = highlightDim || focusDim || oligo.isMirror;
			const vhFrame = vhFrames.get(seg.inVirtualHelix.index);
			if (!vhFrame) continue;
			const tw = vhTwist.get(seg.inVirtualHelix.index)!;

			const s = seg.inStrandIndex as 0 | 1;
			const { lo: physStart, totalNts } = getSegmentPhysicalRange(
				seg,
				insertEffects,
				physOffsetMaps
			);
			const override = segPositionOverrides?.get(seg.id);

			const points: THREE.Vector3[] = [];
			for (let i = 0; i < totalNts; i++) {
				const pt = backbonePointGeom(
					vhFrame,
					physStart + i,
					s,
					tw.twistOffsetDeg,
					tw.twistPerBaseDeg
				);
				const p = new THREE.Vector3(pt.x, pt.y, pt.z);
				points.push(override ? applyBlockTransform(p, override) : p);
			}
			if (points.length < 2) continue;

			const curve =
				points.length === 2
					? new THREE.LineCurve3(points[0], points[1])
					: new THREE.CatmullRomCurve3(points);
			const tubularSegs = Math.max(points.length * 2, 4);
			const geo = new THREE.TubeGeometry(
				curve,
				tubularSegs,
				STRAND_TUBE_R,
				TUBE_RADIAL_SEGS,
				false
			);
			const mat = new THREE.MeshLambertMaterial({
				color,
				...(dim ? { transparent: true, opacity: DIMMED_FATLINE_OPACITY } : {}),
			});
			group.add(new THREE.Mesh(geo, mat));
		}
	}

	// ── Modification markers ──────────────────────────────────────────────
	// No NT-model branch exists in this builder, so this always runs (matches
	// the Line-view-only rule in `buildScene`).
	for (const oligo of part.oligos) {
		const highlightDim = anyHighlightActive && !isOligoHighlighted(oligo, highlightContext);
		for (const end of [oligo.fivePrime, oligo.threePrime]) {
			if (!end || !end.modification) continue;
			const seg = end.segment;
			if (filterSegments && !filterSegments.has(seg)) continue;
			const focusDim = anyFocusActive && !focusedSegments?.has(seg);
			const dim = highlightDim || focusDim || oligo.isMirror;
			const vhFrame = vhFrames.get(seg.inVirtualHelix.index);
			if (!vhFrame) continue;
			const tw = vhTwist.get(seg.inVirtualHelix.index)!;

			const physIdx = getSegmentEndPhysicalIndex(
				seg,
				end === seg.fivePrime ? 'fivePrime' : 'threePrime',
				insertEffects,
				physOffsetMaps
			);
			const pt = backbonePointGeom(
				vhFrame,
				physIdx,
				seg.inStrandIndex as 0 | 1,
				tw.twistOffsetDeg,
				tw.twistPerBaseDeg
			);
			const rawAnchor = new THREE.Vector3(pt.x, pt.y, pt.z);
			const override = segPositionOverrides?.get(seg.id);
			const anchor = override ? applyBlockTransform(rawAnchor, override) : rawAnchor;

			addModificationMarker(
				group,
				anchor,
				getModificationColor(end.modification, part.customModifications),
				dim
			);
		}
	}

	// ── Crossover tubes ───────────────────────────────────────────────────
	for (const oligo of part.oligos) {
		const highlighted = isOligoHighlighted(oligo, highlightContext);
		const highlightDim = anyHighlightActive && !highlighted;
		const oligoColor = highlightDim ? DIM_COLOR : new THREE.Color(oligo.color);

		for (const seg of oligo.segments) {
			const threePrime = seg.threePrime;
			if (!threePrime.connectedSegment) continue;
			const toSeg = threePrime.connectedSegment;
			if (filterSegments && (!filterSegments.has(seg) || !filterSegments.has(toSeg))) continue;
			const focusDim =
				anyFocusActive && (!focusedSegments?.has(seg) || !focusedSegments?.has(toSeg));
			const dim = highlightDim || focusDim || oligo.isMirror;

			const fromFrame = vhFrames.get(seg.inVirtualHelix.index);
			const toFrame = vhFrames.get(toSeg.inVirtualHelix.index);
			if (!fromFrame || !toFrame) continue;
			const fromTw = vhTwist.get(seg.inVirtualHelix.index)!;
			const toTw = vhTwist.get(toSeg.inVirtualHelix.index)!;
			const fromOverride = segPositionOverrides?.get(seg.id);
			const toOverride = segPositionOverrides?.get(toSeg.id);

			const fromPhysIdx = getSegmentEndPhysicalIndex(
				seg,
				'threePrime',
				insertEffects,
				physOffsetMaps
			);
			const toPhysIdx = getSegmentEndPhysicalIndex(
				toSeg,
				'fivePrime',
				insertEffects,
				physOffsetMaps
			);

			const fromPt = backbonePointGeom(
				fromFrame,
				fromPhysIdx,
				seg.inStrandIndex as 0 | 1,
				fromTw.twistOffsetDeg,
				fromTw.twistPerBaseDeg
			);
			const fromLat = new THREE.Vector3(fromPt.x, fromPt.y, fromPt.z);
			const toPt = backbonePointGeom(
				toFrame,
				toPhysIdx,
				toSeg.inStrandIndex as 0 | 1,
				toTw.twistOffsetDeg,
				toTw.twistPerBaseDeg
			);
			const toLat = new THREE.Vector3(toPt.x, toPt.y, toPt.z);
			const from3D = fromOverride ? applyBlockTransform(fromLat, fromOverride) : fromLat;
			const to3D = toOverride ? applyBlockTransform(toLat, toOverride) : toLat;

			// Same bulge logic as makeCrossoverArc
			const mid = from3D.clone().lerp(to3D, 0.5);
			const dx = to3D.x - from3D.x;
			const dy = to3D.y - from3D.y;
			const L = Math.hypot(dx, dy);
			const dir: -1 | 1 =
				(seg.inStrandIndex === 0 && to3D.y <= from3D.y) ||
				(seg.inStrandIndex === 1 && to3D.y >= from3D.y)
					? -1
					: 1;
			if (L > 0) {
				const nx = -dy / L;
				const ny = dx / L;
				const bulge = Math.min(L * 0.35, 4.0);
				mid.x += dir * bulge * nx;
				mid.y += dir * bulge * ny;
			}

			const arcPoints = new THREE.QuadraticBezierCurve3(from3D, mid, to3D).getPoints(20);
			const tubeCurve = new THREE.CatmullRomCurve3(arcPoints);
			const geo = new THREE.TubeGeometry(tubeCurve, 20, XOVER_TUBE_R, TUBE_RADIAL_SEGS, false);
			const mat = new THREE.MeshLambertMaterial({
				color: oligoColor,
				...(dim ? { transparent: true, opacity: DIMMED_FATLINE_OPACITY } : {}),
			});
			group.add(new THREE.Mesh(geo, mat));
		}
	}

	return group;
}
