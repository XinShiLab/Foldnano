import * as THREE from 'three';

export type AxisPlane = 'xy' | 'xz' | 'yz';

export interface CoordinateAxisResult {
	group: THREE.Group;
	/** [xyMesh, xzMesh, yzMesh] — targets for raycasting */
	planeMeshes: THREE.Mesh[];
	setHover(mesh: THREE.Mesh | null): void;
	setSelected(mesh: THREE.Mesh | null): void;
	dispose(): void;
}

const PLANE_SIZE = 8;
const PLANE_COLOR: Record<AxisPlane, number> = { xy: 0x3388ff, xz: 0x33cc44, yz: 0xff3333 };

const OPACITY_DEFAULT = 0.0;
const OPACITY_HOVER = 0.25;
const OPACITY_SELECTED = 0.45;

function makePlaneMesh(plane: AxisPlane): THREE.Mesh {
	const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
	const mat = new THREE.MeshBasicMaterial({
		color: PLANE_COLOR[plane],
		transparent: true,
		opacity: OPACITY_DEFAULT,
		side: THREE.DoubleSide,
		depthWrite: false,
	});
	const mesh = new THREE.Mesh(geo, mat);

	// Edges child — shown only when selected
	const edgesGeo = new THREE.EdgesGeometry(geo);
	const edgesMat = new THREE.LineBasicMaterial({
		color: PLANE_COLOR[plane],
		transparent: true,
		opacity: 0.0,
	});
	const edges = new THREE.LineSegments(edgesGeo, edgesMat);
	mesh.add(edges);

	mesh.userData.axisPlane = plane;
	return mesh;
}

function getEdges(mesh: THREE.Mesh): THREE.LineSegments | undefined {
	return mesh.children[0] as THREE.LineSegments | undefined;
}

function setMeshState(mesh: THREE.Mesh, opacity: number, edgesOpacity: number): void {
	(mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
	const edges = getEdges(mesh);
	if (edges) {
		(edges.material as THREE.LineBasicMaterial).opacity = edgesOpacity;
	}
}

function makeAxisLabel(letter: string, color: number, axisLength: number): THREE.Sprite {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const hex = '#' + color.toString(16).padStart(6, '0');
	ctx.clearRect(0, 0, size, size);
	ctx.font = `bold ${Math.round(size * 0.72)}px sans-serif`;
	ctx.fillStyle = hex;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(letter, size / 2, size / 2);
	const texture = new THREE.CanvasTexture(canvas);
	const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
	const sprite = new THREE.Sprite(mat);
	sprite.scale.set(4, 4, 1);
	sprite.renderOrder = 999;
	// Position just past the arrowhead tip
	const offset = axisLength + 4;
	if (letter === 'X') sprite.position.set(offset, 0, 0);
	else if (letter === 'Y') sprite.position.set(0, offset, 0);
	else sprite.position.set(0, 0, offset);
	return sprite;
}

export function createCoordinateAxis(axisLength = 5): CoordinateAxisResult {
	const group = new THREE.Group();
	group.name = 'coordinateAxis';

	// Arrows
	const origin = new THREE.Vector3(0, 0, 0);
	const headLength = 3;
	const headWidth = 1.5;
	group.add(
		new THREE.ArrowHelper(
			new THREE.Vector3(1, 0, 0),
			origin,
			axisLength,
			0xff3333,
			headLength,
			headWidth
		)
	);
	group.add(
		new THREE.ArrowHelper(
			new THREE.Vector3(0, 1, 0),
			origin,
			axisLength,
			0x33cc44,
			headLength,
			headWidth
		)
	);
	group.add(
		new THREE.ArrowHelper(
			new THREE.Vector3(0, 0, 1),
			origin,
			axisLength,
			0x3388ff,
			headLength,
			headWidth
		)
	);

	// Axis labels
	group.add(makeAxisLabel('X', 0xff3333, axisLength));
	group.add(makeAxisLabel('Y', 0x33cc44, axisLength));
	group.add(makeAxisLabel('Z', 0x3388ff, axisLength));

	// Plane squares
	const xyMesh = makePlaneMesh('xy');
	// xyMesh stays at default rotation — already in XY plane

	const xzMesh = makePlaneMesh('xz');
	xzMesh.rotation.x = Math.PI / 2;

	const yzMesh = makePlaneMesh('yz');
	yzMesh.rotation.y = Math.PI / 2;

	group.add(xyMesh, xzMesh, yzMesh);

	const planeMeshes = [xyMesh, xzMesh, yzMesh];
	const planeMeshSet = new Set<THREE.Mesh>(planeMeshes);

	let currentHover: THREE.Mesh | null = null;
	let currentSelected: THREE.Mesh | null = null;

	function refreshMesh(mesh: THREE.Mesh) {
		const isSelected = mesh === currentSelected;
		const isHover = mesh === currentHover;
		if (isSelected) {
			setMeshState(mesh, OPACITY_SELECTED, 0.9);
		} else if (isHover) {
			setMeshState(mesh, OPACITY_HOVER, 0.0);
		} else {
			setMeshState(mesh, OPACITY_DEFAULT, 0.0);
		}
	}

	function setHover(mesh: THREE.Mesh | null) {
		// Guard: only accept known plane meshes (raycaster may return child objects)
		const validated = mesh && planeMeshSet.has(mesh) ? mesh : null;
		const prev = currentHover;
		currentHover = validated;
		if (prev && planeMeshSet.has(prev)) refreshMesh(prev);
		if (validated) refreshMesh(validated);
	}

	function setSelected(mesh: THREE.Mesh | null) {
		const validated = mesh && planeMeshSet.has(mesh) ? mesh : null;
		const prev = currentSelected;
		currentSelected = validated;
		if (prev && planeMeshSet.has(prev)) refreshMesh(prev);
		if (validated) refreshMesh(validated);
	}

	function dispose() {
		group.traverse((obj) => {
			if (obj instanceof THREE.Sprite) {
				(obj.material as THREE.SpriteMaterial).map?.dispose();
				(obj.material as THREE.SpriteMaterial).dispose();
			} else if (obj instanceof THREE.Mesh || (obj as { isLine?: boolean }).isLine) {
				(obj as THREE.Mesh).geometry?.dispose();
				const mat = (obj as THREE.Mesh).material;
				if (Array.isArray(mat)) mat.forEach((m) => (m as THREE.Material).dispose());
				else (mat as THREE.Material)?.dispose();
			} else if (obj instanceof THREE.ArrowHelper) {
				(obj.line as THREE.Line).geometry.dispose();
				(obj.line.material as THREE.Material).dispose();
				(obj.cone as THREE.Mesh).geometry.dispose();
				const coneMat = (obj.cone as THREE.Mesh).material;
				if (Array.isArray(coneMat)) coneMat.forEach((m) => (m as THREE.Material).dispose());
				else (coneMat as THREE.Material)?.dispose();
			}
		});
	}

	return { group, planeMeshes, setHover, setSelected, dispose };
}
