import * as THREE from 'three';

export type GizmoAxis = 'x' | 'y' | 'z';
export type GizmoMode = 'rotate' | 'translate';

export interface TransformGizmoResult {
	group: THREE.Group;
	/** All raycasting targets — each has userData.gizmoAxis and userData.gizmoMode */
	handles: THREE.Mesh[];
	setPosition(v: THREE.Vector3): void;
	setQuaternion(q: THREE.Quaternion): void;
	setMode(mode: GizmoMode): void;
	setHover(mesh: THREE.Mesh | null): void;
	setActive(mesh: THREE.Mesh | null): void;
	dispose(): void;
}

const AXIS_COLOR: Record<GizmoAxis, number> = { x: 0xff3333, y: 0x33cc44, z: 0x3388ff };

const RING_RADIUS = 22;
const RING_TUBE = 0.9;
const RING_SEGMENTS = 64;
const RING_TUBE_SEGMENTS = 8;

const ARROW_SHAFT_LENGTH = 30;
const ARROW_SHAFT_RADIUS = 0.55;
const ARROW_CONE_HEIGHT = 4;
const ARROW_CONE_RADIUS = 1.6;

const OPACITY_DEFAULT = 0.55;
const OPACITY_HOVER = 0.85;
const OPACITY_ACTIVE = 1.0;

function makeRingMesh(axis: GizmoAxis): THREE.Mesh {
	const geo = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, RING_TUBE_SEGMENTS, RING_SEGMENTS);
	const mat = new THREE.MeshBasicMaterial({
		color: AXIS_COLOR[axis],
		transparent: true,
		opacity: OPACITY_DEFAULT,
		side: THREE.DoubleSide,
		depthWrite: false,
	});
	const mesh = new THREE.Mesh(geo, mat);
	if (axis === 'x') mesh.rotation.y = Math.PI / 2;
	else if (axis === 'y') mesh.rotation.x = Math.PI / 2;
	mesh.userData.gizmoAxis = axis;
	mesh.userData.gizmoMode = 'rotate' as GizmoMode;
	return mesh;
}

function makeArrowMeshes(axis: GizmoAxis): THREE.Mesh[] {
	const shaftGeo = new THREE.CylinderGeometry(
		ARROW_SHAFT_RADIUS,
		ARROW_SHAFT_RADIUS,
		ARROW_SHAFT_LENGTH,
		8
	);
	const coneGeo = new THREE.ConeGeometry(ARROW_CONE_RADIUS, ARROW_CONE_HEIGHT, 8);
	const mat = () =>
		new THREE.MeshBasicMaterial({
			color: AXIS_COLOR[axis],
			transparent: true,
			opacity: OPACITY_DEFAULT,
		});

	const shaft = new THREE.Mesh(shaftGeo, mat());
	shaft.position.set(0, ARROW_SHAFT_LENGTH / 2, 0);

	const cone = new THREE.Mesh(coneGeo, mat());
	cone.position.set(0, ARROW_SHAFT_LENGTH + ARROW_CONE_HEIGHT / 2, 0);

	for (const m of [shaft, cone]) {
		m.userData.gizmoAxis = axis;
		m.userData.gizmoMode = 'translate' as GizmoMode;
	}

	// Orient: cylinder is along Y by default; rotate to match axis
	if (axis === 'x') {
		shaft.rotation.z = -Math.PI / 2;
		cone.rotation.z = -Math.PI / 2;
		shaft.position.set(ARROW_SHAFT_LENGTH / 2, 0, 0);
		cone.position.set(ARROW_SHAFT_LENGTH + ARROW_CONE_HEIGHT / 2, 0, 0);
	} else if (axis === 'z') {
		shaft.rotation.x = Math.PI / 2;
		cone.rotation.x = Math.PI / 2;
		shaft.position.set(0, 0, ARROW_SHAFT_LENGTH / 2);
		cone.position.set(0, 0, ARROW_SHAFT_LENGTH + ARROW_CONE_HEIGHT / 2);
	}

	return [shaft, cone];
}

function setOpacity(mesh: THREE.Mesh, opacity: number): void {
	const mat = mesh.material as THREE.MeshBasicMaterial;
	mat.opacity = opacity;
}

export function createTransformGizmo(): TransformGizmoResult {
	const group = new THREE.Group();
	group.name = 'transformGizmo';
	group.visible = false;

	// Rotation rings
	const rotateGroup = new THREE.Group();
	const xRing = makeRingMesh('x');
	const yRing = makeRingMesh('y');
	const zRing = makeRingMesh('z');
	rotateGroup.add(xRing, yRing, zRing);

	// Translation arrows
	const translateGroup = new THREE.Group();
	const [xShaft, xCone] = makeArrowMeshes('x');
	const [yShaft, yCone] = makeArrowMeshes('y');
	const [zShaft, zCone] = makeArrowMeshes('z');
	translateGroup.add(xShaft, xCone, yShaft, yCone, zShaft, zCone);
	translateGroup.visible = false;

	group.add(rotateGroup, translateGroup);

	const allHandles: THREE.Mesh[] = [
		xRing,
		yRing,
		zRing,
		xShaft,
		xCone,
		yShaft,
		yCone,
		zShaft,
		zCone,
	];
	const ringHandles = new Set([xRing, yRing, zRing]);
	const arrowHandles = new Set([xShaft, xCone, yShaft, yCone, zShaft, zCone]);

	let currentHover: THREE.Mesh | null = null;
	let currentActive: THREE.Mesh | null = null;

	function refreshMesh(mesh: THREE.Mesh): void {
		if (mesh === currentActive) setOpacity(mesh, OPACITY_ACTIVE);
		else if (mesh === currentHover) setOpacity(mesh, OPACITY_HOVER);
		else setOpacity(mesh, OPACITY_DEFAULT);
	}

	function setPosition(v: THREE.Vector3): void {
		group.position.copy(v);
	}

	function setQuaternion(q: THREE.Quaternion): void {
		group.setRotationFromQuaternion(q);
	}

	function setMode(mode: GizmoMode): void {
		rotateGroup.visible = mode === 'rotate';
		translateGroup.visible = mode === 'translate';
	}

	function setHover(mesh: THREE.Mesh | null): void {
		const validated = mesh && allHandles.includes(mesh) ? mesh : null;
		const prev = currentHover;
		currentHover = validated;
		if (prev) refreshMesh(prev);
		if (validated) refreshMesh(validated);
	}

	function setActive(mesh: THREE.Mesh | null): void {
		const validated = mesh && allHandles.includes(mesh) ? mesh : null;
		const prev = currentActive;
		currentActive = validated;
		if (prev) refreshMesh(prev);
		if (validated) refreshMesh(validated);
	}

	function dispose(): void {
		for (const mesh of allHandles) {
			mesh.geometry.dispose();
			(mesh.material as THREE.Material).dispose();
		}
	}

	// Expose which handles are relevant given current mode
	Object.defineProperty(allHandles, 'ringHandles', { value: ringHandles });
	Object.defineProperty(allHandles, 'arrowHandles', { value: arrowHandles });

	return {
		group,
		handles: allHandles,
		setPosition,
		setQuaternion,
		setMode,
		setHover,
		setActive,
		dispose,
	};
}

/** Build a THREE.Quaternion from a plane's u/v/normal basis vectors. */
export function quaternionFromPlaneBasis(
	u: { x: number; y: number; z: number },
	v: { x: number; y: number; z: number },
	normal: { x: number; y: number; z: number }
): THREE.Quaternion {
	const mat = new THREE.Matrix4().makeBasis(
		new THREE.Vector3(u.x, u.y, u.z),
		new THREE.Vector3(v.x, v.y, v.z),
		new THREE.Vector3(normal.x, normal.y, normal.z)
	);
	return new THREE.Quaternion().setFromRotationMatrix(mat);
}
