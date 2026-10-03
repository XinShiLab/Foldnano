import * as THREE from 'three';
import type { Plane } from '$lib/model/Part/Plane.svelte';
import type { Part } from '$lib/model/Part';
import { PLANE_COLORS } from '$lib/model/Part/planeColors';

export interface PlaneOverlayResult {
	group: THREE.Group;
	/** One mesh per plane — raycasting targets */
	get meshes(): THREE.Mesh[];
	update(planes: Plane[], part: Part): void;
	updatePosePlaneMesh(planeId: string, plane: Plane): void;
	setHover(mesh: THREE.Mesh | null): void;
	setSelected(mesh: THREE.Mesh | null): void;
	dispose(): void;
}

const COLOR_IDLE = 0x888888;
const OPACITY_DEFAULT = 0.05;
const OPACITY_HOVER = 0.12;
const OPACITY_SELECTED = 0.22;
const EDGES_OPACITY_DEFAULT = 0.28;
const EDGES_OPACITY_HOVER = 0.5;
const EDGES_OPACITY_SELECTED = 0.85;
const PADDING = 8; // nm beyond VH bounding box
const DEFAULT_HALF_SIZE = 20; // nm half-size when no VHs

function getEdges(mesh: THREE.Mesh): THREE.LineSegments | undefined {
	return mesh.children[0] as THREE.LineSegments | undefined;
}

function setMeshState(
	mesh: THREE.Mesh,
	opacity: number,
	edgesOpacity: number,
	color: number
): void {
	const mat = mesh.material as THREE.MeshBasicMaterial;
	mat.color.setHex(color);
	mat.opacity = opacity;
	const edges = getEdges(mesh);
	if (edges) {
		const edgesMat = edges.material as THREE.LineBasicMaterial;
		edgesMat.color.setHex(color);
		edgesMat.opacity = edgesOpacity;
	}
}

function applyPlanePoseToMesh(
	mesh: THREE.Mesh,
	plane: Plane,
	centerU: number,
	centerV: number
): void {
	const origin = new THREE.Vector3(plane.origin.x, plane.origin.y, plane.origin.z);
	const u = new THREE.Vector3(plane.u.x, plane.u.y, plane.u.z);
	const v = new THREE.Vector3(plane.v.x, plane.v.y, plane.v.z);
	const normal = new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z);
	// Position = origin + centerU * u + centerV * v
	mesh.position.copy(origin).addScaledVector(u, centerU).addScaledVector(v, centerV);
	const mat = new THREE.Matrix4().makeBasis(u, v, normal);
	mesh.setRotationFromMatrix(mat);
}

export function createPlaneOverlay(): PlaneOverlayResult {
	const group = new THREE.Group();
	group.name = 'planeOverlay';

	let _meshes: THREE.Mesh[] = [];
	// Map planeId → { mesh, centerU, centerV }
	const _poseCache = new Map<string, { centerU: number; centerV: number }>();
	let currentHover: THREE.Mesh | null = null;
	let currentSelected: THREE.Mesh | null = null;

	function refreshMesh(mesh: THREE.Mesh): void {
		const planeColor = mesh.userData.planeColor as number;
		const isSelected = mesh === currentSelected;
		const isHover = mesh === currentHover;
		if (isSelected) setMeshState(mesh, OPACITY_SELECTED, EDGES_OPACITY_SELECTED, planeColor);
		else if (isHover) setMeshState(mesh, OPACITY_HOVER, EDGES_OPACITY_HOVER, planeColor);
		else setMeshState(mesh, OPACITY_DEFAULT, EDGES_OPACITY_DEFAULT, COLOR_IDLE);
	}

	function setHover(mesh: THREE.Mesh | null): void {
		const validated = mesh && _meshes.includes(mesh) ? mesh : null;
		const prev = currentHover;
		currentHover = validated;
		if (prev && _meshes.includes(prev)) refreshMesh(prev);
		if (validated) refreshMesh(validated);
	}

	function setSelected(mesh: THREE.Mesh | null): void {
		const validated = mesh && _meshes.includes(mesh) ? mesh : null;
		const prev = currentSelected;
		currentSelected = validated;
		if (prev && _meshes.includes(prev)) refreshMesh(prev);
		if (validated) refreshMesh(validated);
	}

	function update(planes: Plane[], part: Part): void {
		// Reset selection refs that refer to stale meshes
		currentHover = null;
		currentSelected = null;
		_poseCache.clear();

		// Dispose old
		for (const mesh of _meshes) disposeMesh(mesh);
		_meshes = [];
		group.clear();

		for (let i = 0; i < planes.length; i++) {
			const plane = planes[i];
			const color = PLANE_COLORS[i % PLANE_COLORS.length];

			// Gather VH lab-frame origins projected onto plane UV
			const origin = new THREE.Vector3(plane.origin.x, plane.origin.y, plane.origin.z);
			const u = new THREE.Vector3(plane.u.x, plane.u.y, plane.u.z);
			const v = new THREE.Vector3(plane.v.x, plane.v.y, plane.v.z);
			const normal = new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z);

			const regions = part.regions.filter((r) => r.planeId === plane.id);
			const uvCoords: { u: number; v: number }[] = [];

			const regionIds = new Set(regions.map((r) => r.id));
			for (const vh of part.virtualHelices) {
				if (!vh.regionId || !regionIds.has(vh.regionId)) continue;
				const frame = part.getVirtualHelixFrame(vh);
				const rel = new THREE.Vector3(
					frame.origin.x - origin.x,
					frame.origin.y - origin.y,
					frame.origin.z - origin.z
				);
				uvCoords.push({ u: rel.dot(u), v: rel.dot(v) });
			}

			let minU: number, maxU: number, minV: number, maxV: number;
			if (uvCoords.length > 0) {
				minU = Math.min(...uvCoords.map((c) => c.u)) - PADDING;
				maxU = Math.max(...uvCoords.map((c) => c.u)) + PADDING;
				minV = Math.min(...uvCoords.map((c) => c.v)) - PADDING;
				maxV = Math.max(...uvCoords.map((c) => c.v)) + PADDING;
			} else {
				minU = -DEFAULT_HALF_SIZE;
				maxU = DEFAULT_HALF_SIZE;
				minV = -DEFAULT_HALF_SIZE;
				maxV = DEFAULT_HALF_SIZE;
			}

			const width = maxU - minU;
			const height = maxV - minV;
			const centerU = (minU + maxU) / 2;
			const centerV = (minV + maxV) / 2;

			const geo = new THREE.PlaneGeometry(width, height);
			const mat = new THREE.MeshBasicMaterial({
				color: COLOR_IDLE,
				transparent: true,
				opacity: OPACITY_DEFAULT,
				side: THREE.DoubleSide,
				depthWrite: false,
			});
			const mesh = new THREE.Mesh(geo, mat);

			const edgesGeo = new THREE.EdgesGeometry(geo);
			const edgesMat = new THREE.LineBasicMaterial({
				color: COLOR_IDLE,
				transparent: true,
				opacity: EDGES_OPACITY_DEFAULT,
			});
			mesh.add(new THREE.LineSegments(edgesGeo, edgesMat));

			mesh.userData.planeId = plane.id;
			mesh.userData.planeColor = color;
			applyPlanePoseToMesh(mesh, plane, centerU, centerV);
			// THREE.PlaneGeometry lies in the XY plane by default (normal = +Z).
			// applyPlanePoseToMesh uses makeBasis(u, v, normal) as the rotation matrix,
			// which maps local +Z → world normal. No extra rotation needed.

			_poseCache.set(plane.id, { centerU, centerV });
			_meshes.push(mesh);
			group.add(mesh);

			void normal; // suppress unused-variable lint
		}
	}

	function updatePosePlaneMesh(planeId: string, plane: Plane): void {
		const mesh = _meshes.find((m) => m.userData.planeId === planeId);
		if (!mesh) return;
		const cached = _poseCache.get(planeId);
		if (!cached) return;
		applyPlanePoseToMesh(mesh, plane, cached.centerU, cached.centerV);
	}

	function disposeMesh(mesh: THREE.Mesh): void {
		mesh.geometry.dispose();
		(mesh.material as THREE.Material).dispose();
		for (const child of mesh.children) {
			const ls = child as THREE.LineSegments;
			ls.geometry?.dispose();
			(ls.material as THREE.Material)?.dispose();
		}
	}

	function dispose(): void {
		for (const mesh of _meshes) disposeMesh(mesh);
		_meshes = [];
		_poseCache.clear();
		group.clear();
	}

	return {
		group,
		get meshes() {
			return _meshes;
		},
		update,
		updatePosePlaneMesh,
		setHover,
		setSelected,
		dispose,
	};
}
