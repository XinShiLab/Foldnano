import type { ReferenceMesh } from '$lib/model/Part/DesignRegion';
import { BACKBONE_RISE_NM } from './dnaGeometry';

export interface ReferenceMeshSummary {
	vertexCount: number;
	faceCount: number;
	edgeCount: number;
	size: [number, number, number];
	shortestEdge: number;
	longestEdge: number;
}

export function scaleReferenceMesh(mesh: ReferenceMesh, factor: number): ReferenceMesh {
	return {
		vertices: mesh.vertices.map(([x, y, z]) => [x * factor, y * factor, z * factor]),
		faces: mesh.faces,
		edges: mesh.edges,
	};
}

/** Every distinct edge: the mesh's own edges plus the sides of its faces. */
export function referenceMeshEdges(mesh: ReferenceMesh): [number, number][] {
	const seen = new Set<number>();
	const edges: [number, number][] = [];
	const add = (a: number, b: number) => {
		const key = Math.min(a, b) * mesh.vertices.length + Math.max(a, b);
		if (a === b || seen.has(key)) return;
		seen.add(key);
		edges.push([a, b]);
	};
	for (const [a, b] of mesh.edges) add(a, b);
	for (const face of mesh.faces) {
		face.forEach((a, i) => add(a, face[(i + 1) % face.length]));
	}
	return edges;
}

export function summarizeReferenceMesh(mesh: ReferenceMesh): ReferenceMeshSummary {
	const size = [0, 1, 2].map((axis) => {
		const values = mesh.vertices.map((v) => v[axis]);
		return values.length > 0 ? Math.max(...values) - Math.min(...values) : 0;
	}) as [number, number, number];

	const edges = referenceMeshEdges(mesh);
	let shortestEdge = Infinity;
	let longestEdge = 0;
	for (const [a, b] of edges) {
		const [ax, ay, az] = mesh.vertices[a];
		const [bx, by, bz] = mesh.vertices[b];
		const length = Math.hypot(ax - bx, ay - by, az - bz);
		if (length > 0) shortestEdge = Math.min(shortestEdge, length);
		longestEdge = Math.max(longestEdge, length);
	}

	return {
		vertexCount: mesh.vertices.length,
		faceCount: mesh.faces.length,
		edgeCount: edges.length,
		size,
		shortestEdge: shortestEdge === Infinity ? 0 : shortestEdge,
		longestEdge,
	};
}

export function nmToApproxBp(nm: number): number {
	return Math.round(nm / BACKBONE_RISE_NM);
}
