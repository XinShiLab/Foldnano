import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type {
	ExternalStructureOverlay,
	MrdnaOverlay,
	OverlayEdge,
	PdbOverlay,
} from './externalStructureOverlay';

const DOT_RADIUS_NM = 0.18;
const TERMINAL_CONE_RADIUS_NM = 0.25;
const TERMINAL_CONE_LENGTH_NM = 0.65;
const CHAIN_LINE_WIDTH = 0.28;
const STACK_LINE_WIDTH = 0.08;

const DOT_COLOR = new THREE.Color(0xf8fafc);
const CHAIN_COLOR = new THREE.Color(0x06b6d4);
const STACK_COLOR = new THREE.Color(0xf59e0b);

const BASE_COLORS: Record<string, THREE.Color> = {
	A: new THREE.Color(0xf97316),
	T: new THREE.Color(0xfacc15),
	G: new THREE.Color(0x3b82f6),
	C: new THREE.Color(0x06b6d4),
};

const PDB_TRACE_LINE_WIDTH = 0.3;
const PDB_CHAIN_PALETTE = [
	0x06b6d4, 0xf59e0b, 0x8b5cf6, 0x10b981, 0xef4444, 0x3b82f6, 0xec4899, 0xeab308,
];
// Normal Cα–Cα ≈ 0.38 nm; a one-residue gap ≈ 0.76 nm. Beyond this we don't bond.
const MAX_CA_BOND_NM = 0.5;

// Ghost mode: grey + translucent, matching the main model's "dimmed when selected" look.
const GHOST_COLOR = new THREE.Color(0xb0b0b0);
const EDGE_OPACITY = 0.88;
const GHOST_LINE_OPACITY = 0.25;
const GHOST_DOT_OPACITY = 0.3;

function edgePoints(overlay: MrdnaOverlay, edges: OverlayEdge[]): number[] {
	const positions: number[] = [];
	for (const edge of edges) {
		const from = overlay.nodes[edge.from]?.position;
		const to = overlay.nodes[edge.to]?.position;
		if (!from || !to) continue;
		positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
	}
	return positions;
}

function addEdgeSegments(
	group: THREE.Group,
	positions: number[],
	color: THREE.Color,
	linewidth: number,
	name: string,
	opacity = EDGE_OPACITY
): void {
	if (positions.length === 0) return;
	const geo = new LineSegmentsGeometry();
	geo.setPositions(positions);
	const mat = new LineMaterial({
		color,
		linewidth,
		worldUnits: true,
		transparent: true,
		opacity,
	});
	const lines = new LineSegments2(geo, mat);
	lines.name = name;
	lines.frustumCulled = false;
	group.add(lines);
}

function buildTerminalConeInstances(
	overlay: MrdnaOverlay,
	previousByTo: Map<number, number>,
	ghost: boolean
): THREE.InstancedMesh | null {
	const nodeById = new Map(overlay.nodes.map((n) => [n.id, n]));
	type ConeEntry = { px: number; py: number; pz: number; dx: number; dy: number; dz: number };
	const entries: ConeEntry[] = [];

	for (const terminalId of overlay.threePrimeTerminalIds) {
		const terminal = nodeById.get(terminalId);
		if (!terminal) continue;
		const prevId = previousByTo.get(terminalId);
		let dx = 0,
			dy = 0,
			dz = 1;
		if (prevId !== undefined) {
			const prev = nodeById.get(prevId);
			if (prev) {
				dx = terminal.position.x - prev.position.x;
				dy = terminal.position.y - prev.position.y;
				dz = terminal.position.z - prev.position.z;
				const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (len > 1e-9) {
					dx /= len;
					dy /= len;
					dz /= len;
				} else {
					dx = 0;
					dy = 0;
					dz = 1;
				}
			}
		}
		entries.push({
			px: terminal.position.x + dx * TERMINAL_CONE_LENGTH_NM * 0.3,
			py: terminal.position.y + dy * TERMINAL_CONE_LENGTH_NM * 0.3,
			pz: terminal.position.z + dz * TERMINAL_CONE_LENGTH_NM * 0.3,
			dx,
			dy,
			dz,
		});
	}
	if (entries.length === 0) return null;

	const geo = new THREE.ConeGeometry(TERMINAL_CONE_RADIUS_NM, TERMINAL_CONE_LENGTH_NM, 16);
	const mat = new THREE.MeshLambertMaterial({
		color: ghost ? GHOST_COLOR : CHAIN_COLOR,
		transparent: ghost,
		opacity: ghost ? GHOST_DOT_OPACITY : 1,
	});
	const mesh = new THREE.InstancedMesh(geo, mat, entries.length);
	mesh.name = 'external-overlay-three-prime-cone';

	const matrix = new THREE.Matrix4();
	const quat = new THREE.Quaternion();
	const yAxis = new THREE.Vector3(0, 1, 0);
	const unitScale = new THREE.Vector3(1, 1, 1);
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		quat.setFromUnitVectors(yAxis, new THREE.Vector3(e.dx, e.dy, e.dz));
		matrix.compose(new THREE.Vector3(e.px, e.py, e.pz), quat, unitScale);
		mesh.setMatrixAt(i, matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
	mesh.computeBoundingSphere();
	return mesh;
}

function addDottedBounds(group: THREE.Group, overlay: ExternalStructureOverlay): void {
	const { center, size } = overlay.bounds;
	const maxDim = Math.max(size.x, size.y, size.z);
	if (maxDim <= 0) return;

	const box = new THREE.BoxGeometry(size.x || 0.5, size.y || 0.5, size.z || 0.5);
	const edges = new THREE.EdgesGeometry(box);
	const mat = new THREE.LineBasicMaterial({
		color: 0x64748b,
		transparent: true,
		opacity: 0.2,
	});
	const line = new THREE.LineSegments(edges, mat);
	line.name = 'external-overlay-bounds';
	line.position.set(center.x, center.y, center.z);
	group.add(line);
}

export function buildExternalStructureOverlayGroup(
	overlay: ExternalStructureOverlay,
	ghost = false
): THREE.Group {
	switch (overlay.format) {
		case 'mrdna':
			return buildMrdnaOverlayGroup(overlay, ghost);
		case 'pdb':
			return buildPdbOverlayGroup(overlay, ghost);
	}
}

function buildPdbOverlayGroup(overlay: PdbOverlay, ghost: boolean): THREE.Group {
	const group = new THREE.Group();
	group.name = `external-overlay:${overlay.name}`;

	overlay.chains.forEach((chain, idx) => {
		const positions: number[] = [];
		for (const segment of chain.segments) {
			for (let i = 0; i + 1 < segment.length; i++) {
				const a = segment[i];
				const b = segment[i + 1];
				// Backstop: skip any pair too far apart to be a real Cα–Cα bond.
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dz = b.z - a.z;
				if (dx * dx + dy * dy + dz * dz > MAX_CA_BOND_NM * MAX_CA_BOND_NM) continue;
				positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
			}
		}
		addEdgeSegments(
			group,
			positions,
			ghost ? GHOST_COLOR : new THREE.Color(PDB_CHAIN_PALETTE[idx % PDB_CHAIN_PALETTE.length]),
			PDB_TRACE_LINE_WIDTH,
			`external-overlay-pdb-chain-${chain.id}`,
			ghost ? GHOST_LINE_OPACITY : EDGE_OPACITY
		);
	});

	addDottedBounds(group, overlay);
	return group;
}

function buildMrdnaOverlayGroup(overlay: MrdnaOverlay, ghost: boolean): THREE.Group {
	const group = new THREE.Group();
	group.name = `external-overlay:${overlay.name}`;

	addEdgeSegments(
		group,
		edgePoints(overlay, overlay.stackEdges),
		ghost ? GHOST_COLOR : STACK_COLOR,
		STACK_LINE_WIDTH,
		'external-overlay-stack-lines',
		ghost ? GHOST_LINE_OPACITY : EDGE_OPACITY
	);
	addEdgeSegments(
		group,
		edgePoints(overlay, overlay.chainEdges),
		ghost ? GHOST_COLOR : CHAIN_COLOR,
		CHAIN_LINE_WIDTH,
		'external-overlay-chain-lines',
		ghost ? GHOST_LINE_OPACITY : EDGE_OPACITY
	);

	const dotGeo = new THREE.SphereGeometry(DOT_RADIUS_NM, 12, 8);
	const dotMat = new THREE.MeshLambertMaterial({
		color: ghost ? GHOST_COLOR : DOT_COLOR,
		transparent: ghost,
		opacity: ghost ? GHOST_DOT_OPACITY : 1,
	});
	const dots = new THREE.InstancedMesh(dotGeo, dotMat, overlay.nodes.length);
	dots.name = 'external-overlay-nt-dots';
	dots.frustumCulled = false;
	dots.renderOrder = 2;
	const matrix = new THREE.Matrix4();
	const quat = new THREE.Quaternion();
	const scale = new THREE.Vector3(1, 1, 1);
	for (const [idx, node] of overlay.nodes.entries()) {
		matrix.compose(
			new THREE.Vector3(node.position.x, node.position.y, node.position.z),
			quat,
			scale
		);
		dots.setMatrixAt(idx, matrix);
		dots.setColorAt(
			idx,
			ghost ? GHOST_COLOR : node.base ? (BASE_COLORS[node.base] ?? DOT_COLOR) : DOT_COLOR
		);
	}
	dots.instanceMatrix.needsUpdate = true;
	if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
	dots.computeBoundingSphere();
	group.add(dots);

	const previousByTo = new Map<number, number>();
	for (const edge of overlay.chainEdges) previousByTo.set(edge.to, edge.from);
	const conesMesh = buildTerminalConeInstances(overlay, previousByTo, ghost);
	if (conesMesh) group.add(conesMesh);

	addDottedBounds(group, overlay);
	return group;
}
