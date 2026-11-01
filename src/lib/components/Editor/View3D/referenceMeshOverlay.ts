import * as THREE from 'three';
import type { PlaneTransform } from '$lib/commands/planes';
import type { ReferenceMesh } from '$lib/model/Part/DesignRegion';
import { referenceMeshEdges } from '$lib/model/geometry3d/referenceMesh';
import { disposeGroup } from './threeUtils';

const MESH_COLOR = 0xf97316;
const LINE_OPACITY = 0.85;
const FACE_OPACITY = 0.08;

export interface ReferenceMeshItem {
	key: string;
	mesh: ReferenceMesh;
	plane: PlaneTransform;
}

export interface ReferenceMeshOverlay {
	/** Add to the scene once. Nothing in it is pickable: the 3D view raycasts named meshes only. */
	group: THREE.Group;
	/** Geometry is rebuilt only when a key's mesh object changes; a moved plane just sets a matrix. */
	update(items: ReferenceMeshItem[]): void;
	boundsOf(key: string): THREE.Box3 | null;
	bounds(): THREE.Box3;
	dispose(): void;
}

function buildMeshGroup(mesh: ReferenceMesh): THREE.Group {
	const group = new THREE.Group();
	group.matrixAutoUpdate = false;
	const positions = new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3);

	const lines = new THREE.BufferGeometry();
	lines.setAttribute('position', positions);
	lines.setIndex(referenceMeshEdges(mesh).flat());
	group.add(
		new THREE.LineSegments(
			lines,
			new THREE.LineBasicMaterial({
				color: MESH_COLOR,
				transparent: true,
				opacity: LINE_OPACITY,
			})
		)
	);

	if (mesh.faces.length > 0) {
		const faces = new THREE.BufferGeometry();
		faces.setAttribute('position', positions);
		// Fan triangulation; a reference drawing does not need better for non-convex faces.
		faces.setIndex(
			mesh.faces.flatMap((face) => face.slice(1, -1).flatMap((v, i) => [face[0], v, face[i + 2]]))
		);
		group.add(
			new THREE.Mesh(
				faces,
				new THREE.MeshBasicMaterial({
					color: MESH_COLOR,
					transparent: true,
					opacity: FACE_OPACITY,
					side: THREE.DoubleSide,
					depthWrite: false,
				})
			)
		);
	}
	return group;
}

function planeMatrix({ origin, u, v, normal }: PlaneTransform): THREE.Matrix4 {
	return new THREE.Matrix4()
		.makeBasis(
			new THREE.Vector3(u.x, u.y, u.z),
			new THREE.Vector3(v.x, v.y, v.z),
			new THREE.Vector3(normal.x, normal.y, normal.z)
		)
		.setPosition(origin.x, origin.y, origin.z);
}

export function createReferenceMeshOverlay(): ReferenceMeshOverlay {
	const group = new THREE.Group();
	const built = new Map<string, { mesh: ReferenceMesh; group: THREE.Group }>();

	function remove(key: string): void {
		const entry = built.get(key);
		if (!entry) return;
		group.remove(entry.group);
		disposeGroup(entry.group);
		built.delete(key);
	}

	function update(items: ReferenceMeshItem[]): void {
		const keys = new Set(items.map((item) => item.key));
		for (const key of [...built.keys()]) {
			if (!keys.has(key)) remove(key);
		}
		for (const { key, mesh, plane } of items) {
			if (built.get(key)?.mesh !== mesh) {
				remove(key);
				const meshGroup = buildMeshGroup(mesh);
				group.add(meshGroup);
				built.set(key, { mesh, group: meshGroup });
			}
			const meshGroup = built.get(key)!.group;
			meshGroup.matrix.copy(planeMatrix(plane));
			meshGroup.matrixWorldNeedsUpdate = true;
		}
	}

	return {
		group,
		update,
		boundsOf(key) {
			const entry = built.get(key);
			return entry ? new THREE.Box3().setFromObject(entry.group) : null;
		},
		bounds() {
			return new THREE.Box3().setFromObject(group);
		},
		dispose() {
			for (const key of [...built.keys()]) remove(key);
		},
	};
}
