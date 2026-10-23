<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { Part } from '$lib/model/Part';
	import { setupScene } from './sceneSetup';
	import {
		buildScene,
		buildExportScene,
		BACKBONE_RISE_NM,
		getVhXYMap,
		STRESS_RED_RATIO,
		STRESS_REST_RATIO,
		STRESS_YELLOW_RATIO,
		stressToColor,
	} from './helixGeometry';
	import type { CanHighlight, CanHide } from '$lib/components/Editor/context/types';
	import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
	import * as THREE from 'three';
	import type { TrackballControls } from 'three/addons/controls/TrackballControls.js';
	import type { SolverParams } from '$lib/model/rbs/rbsTypes';
	import type { BlockTransformOverride } from '$lib/model/rbs/rbsTypes';
	import {
		exportPartToOxDna,
		hasUnassignedSequence,
		type OxDnaFallbackBase,
	} from '$lib/model/io/oxdnaExport';
	import { exportPartToMrdna, type MrdnaFallbackBase } from '$lib/model/io/mrdnaExport';
	import OxDnaExportDialog from './OxDnaExportDialog.svelte';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';
	import { createCoordinateAxis, type CoordinateAxisResult } from './coordinateAxis';
	import {
		createTransformGizmo,
		type GizmoMode,
		type TransformGizmoResult,
	} from './transformGizmo';
	import { createPlaneOverlay, type PlaneOverlayResult } from './planeOverlay';
	import { getEditorViewContext } from '$lib/components/Editor/context/EditorViewContext.svelte';
	import { exportBaseName } from '$lib/model/io/designFileName';
	import { disposeGroup } from './threeUtils';
	import {
		downloadScreenshot,
		exportGlb,
		downloadMrdnaFile,
		downloadOxDnaFiles,
	} from './exportUtils';
	import { createCursor, type CursorResult } from './cursor';
	import { createPlaneSelector, type PlaneSelectorResult } from './planeSelector';
	import {
		GizmoDragController,
		OverlayGizmoTarget,
		PlaneGizmoTarget,
		type GizmoTarget,
	} from './gizmoDragController';
	import { RbsSimulation, type RbsDiagnostics } from './rbs/rbsSimulation';
	import { DEFAULT_SOLVER_PARAMS } from '$lib/model/rbs/rbsEngine';
	import { computeSimulationFreshnessSignature } from './view3dSimulationState';
	import { buildExternalStructureOverlayGroup } from './externalStructureOverlayGeometry';
	import {
		applyOverlayTransform,
		cloneOverlayTransform,
		identityOverlayTransform,
		overlayTransformsEqual,
		transformedBoundsBox,
	} from './overlayTransform';
	import type { OverlayInstance } from './overlayInstance';
	import { setOverlayPlacementCmd } from '$lib/commands/overlays';

	interface Props {
		part: Part;
		showVH?: boolean;
		showNtModel?: boolean;
		showCursor?: boolean;
		csCursorIdx?: number;
		highlightContext?: Record<CanHighlight, boolean>;
		hideContext?: Record<CanHide, boolean>;
		filterSegments?: Set<OligoSegment> | null;
		focusedSegments?: Set<OligoSegment> | null;
		useRelaxedPositions?: boolean;
		hasRelaxedPositions?: boolean;
		isSimStale?: boolean;
		showStress?: boolean;
		simRunning?: boolean;
		simDiagnostics?: RbsDiagnostics | null;
		solverParams?: SolverParams;
		simulateFn?: (() => void) | undefined;
		resetCameraFn?: (() => void) | undefined;
		frameActivePlaneFn?: (() => void) | undefined;
		clearRelaxedFn?: (() => void) | undefined;
		downloadFn?: (() => void) | undefined;
		exportGlbFn?: (() => void) | undefined;
		exportOxDnaFn?: ((opts?: { includeMirrors?: boolean }) => void) | undefined;
		exportMrdnaFn?: ((opts?: { includeMirrors?: boolean }) => void) | undefined;
		frameOverlayFn?: ((id: string) => void) | undefined;
		showDesign?: boolean;
		showCoordinateAxis?: boolean;
		showPlanes?: boolean;
		show3DOverlays?: boolean;
		overlays?: OverlayInstance[];
		activeOverlayId?: string | null;
		selectedPlaneId?: string | null;
		gizmoMode?: GizmoMode;
		showStats?: boolean;
		onNtModelError?: (message: string) => void;
	}
	let {
		part,
		showVH = true,
		showNtModel = false,
		showCursor = false,
		csCursorIdx = 0,
		highlightContext = {
			scaffold: false,
			circular_strand: false,
			modification_site: false,
			longer_than_90: false,
			shorter_than_15: false,
		},
		hideContext = { crossovers: false, connections: false, sequence: false },
		filterSegments = null,
		focusedSegments = null,
		useRelaxedPositions = $bindable(false),
		hasRelaxedPositions = $bindable(false),
		isSimStale = $bindable(false),
		showStress = $bindable(false),
		simRunning = $bindable(false),
		simDiagnostics = $bindable(null),
		solverParams = DEFAULT_SOLVER_PARAMS,
		simulateFn = $bindable(undefined),
		resetCameraFn = $bindable(undefined),
		frameActivePlaneFn = $bindable(undefined),
		clearRelaxedFn = $bindable(undefined),
		downloadFn = $bindable(undefined),
		exportGlbFn = $bindable(undefined),
		exportOxDnaFn = $bindable(undefined),
		exportMrdnaFn = $bindable(undefined),
		frameOverlayFn = $bindable(undefined),
		showDesign = true,
		showCoordinateAxis = false,
		showPlanes = false,
		show3DOverlays = true,
		overlays = [],
		activeOverlayId = $bindable<string | null>(null),
		selectedPlaneId = $bindable<string | null>(null),
		gizmoMode = $bindable<GizmoMode>('rotate'),
		showStats = false,
		onNtModelError,
	}: Props = $props();

	// ── Performance stats (showStats mode) ───────────────────────────────────
	let statsDrawCalls = $state(0);
	let statsGeometries = $state(0);
	let statsTextures = $state(0);
	let statsFrameMs = $state(0);
	let statsBuildMs = $state(0);

	let canvas: HTMLCanvasElement | undefined = $state();
	let threeRenderer = $state<THREE.WebGLRenderer | undefined>(undefined);

	// ── Three.js object references ────────────────────────────────────────────
	let axisObjects: CoordinateAxisResult | undefined;
	let _activeCamera: THREE.PerspectiveCamera | undefined;
	let _controls: TrackballControls | undefined;
	let currentGroup: THREE.Group | null = null;
	// One THREE.Group per overlay instance, keyed by instance id. `ghost` is cached
	// so the reconcile effect knows when a rebuild is needed.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const overlayGroups = new Map<string, { group: THREE.Group; data: object; ghost: boolean }>();
	let currentCylinders = $state<THREE.Group | null>(null);
	let currentLabels = $state<THREE.Group | null>(null);
	let currentCrossovers = $state<THREE.Group | null>(null);
	let isFirstBuild = true;
	let planeOverlay: PlaneOverlayResult | undefined;
	let transformGizmo: TransformGizmoResult | undefined;
	let _hoveredPlaneMesh: THREE.Mesh | null = null;
	let _hoveredGizmoHandle: THREE.Mesh | null = null;
	let _hoveredAxisPlane: THREE.Mesh | null = null;
	let _selectedAxisPlane: THREE.Mesh | null = null;
	let dragController: GizmoDragController | undefined;
	let activePointerId: number | null = null;
	let _markDirty: (() => void) | undefined;

	// Hoisted from onMount so module-level effects can access them
	let scene: THREE.Scene | undefined;
	let cursor: CursorResult | undefined;
	let planeSelector: PlaneSelectorResult | undefined;
	let vhXYCache = new Map<number, { x: number; y: number }>();

	// ── RBS simulation state (drives geometry rebuild + bindable props) ────────
	let simOverrides = $state<Map<string, BlockTransformOverride> | null>(null);
	let simStressMap = $state<Map<string, number> | null>(null);
	let simProgressStep = $state(0);
	let simProgressTotal = $state(0);
	let simSig = $state<string | null>(null);
	let sim: RbsSimulation | undefined;

	// ── simulation export dialog state ────────────────────────────────────────
	let oxDnaDialogOpen = $state(false);
	let mrdnaDialogOpen = $state(false);
	let pendingExportOverrides = $state<Map<string, BlockTransformOverride> | undefined>(undefined);
	let pendingIncludeMirrors = $state(false);

	const _raycaster = new THREE.Raycaster();
	const _mouse = new THREE.Vector2();
	let _mouseDownPos = { x: 0, y: 0 };

	const editorViewContext = getEditorViewContext();
	const exportFileBase = $derived(exportBaseName(editorViewContext.currentDoc.name));

	// ── Mouse / raycasting helpers ────────────────────────────────────────────

	function _updateMouseCoords(e: { clientX: number; clientY: number }): void {
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		_mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		_mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
	}

	function _raycastMeshes(meshes: THREE.Mesh[]): THREE.Mesh | null {
		if (!_activeCamera || meshes.length === 0) return null;
		_raycaster.setFromCamera(_mouse, _activeCamera);
		const hits = _raycaster.intersectObjects(meshes, false);
		return hits.length > 0 && hits[0].object instanceof THREE.Mesh ? hits[0].object : null;
	}

	function capturePointer(pointerId: number): void {
		if (!canvas) return;
		releaseCapturedPointer();
		canvas.setPointerCapture(pointerId);
		activePointerId = pointerId;
	}

	function releaseCapturedPointer(): void {
		if (!canvas || activePointerId === null) return;
		try {
			canvas.releasePointerCapture(activePointerId);
		} catch {
			// Capture may already be gone if the browser ended the gesture first.
		}
		activePointerId = null;
	}

	function resetCameraToDesign(group: THREE.Object3D, center: THREE.Vector3): void {
		if (!_activeCamera || !_controls) return;
		const camera = _activeCamera;
		const controls = _controls;

		controls.target.copy(center);

		const box = new THREE.Box3().setFromObject(group);
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z);
		if (maxDim > 0) {
			const fov = camera.fov * (Math.PI / 180);
			const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.5;
			camera.position.copy(center).add(new THREE.Vector3(0, -dist * 0.4, dist));
		} else {
			camera.position.set(0, -40, 80);
		}
		camera.up.set(0, 0, 1);
		camera.lookAt(center);
		controls.update();
	}

	function frameBox(box: THREE.Box3): void {
		if (!_activeCamera || !_controls || box.isEmpty()) return;
		const camera = _activeCamera;
		const controls = _controls;
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z, 1);
		const fov = camera.fov * (Math.PI / 180);
		const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.6;
		controls.target.copy(center);
		camera.position.copy(center).add(new THREE.Vector3(0, -dist * 0.35, dist));
		camera.up.set(0, 0, 1);
		camera.lookAt(center);
		controls.update();
	}

	// ── Clear simulation results ───────────────────────────────────────────────

	function clearSim(): void {
		sim?.requestStop();
		simOverrides = null;
		simStressMap = null;
		useRelaxedPositions = false;
		hasRelaxedPositions = false;
		showStress = false;
		simDiagnostics = null;
		simProgressStep = 0;
		simProgressTotal = 0;
		simSig = null;
	}

	// ── Bindable function props wired before mount ────────────────────────────

	simulateFn = () => sim?.simulate(part, solverParams);
	resetCameraFn = () => {
		if (!currentGroup) return;
		const box = new THREE.Box3().setFromObject(currentGroup);
		const center = box.isEmpty() ? new THREE.Vector3(0, 0, 0) : box.getCenter(new THREE.Vector3());
		resetCameraToDesign(currentGroup, center);
	};
	frameActivePlaneFn = () => {
		if (!planeOverlay || !_activeCamera || !_controls) return;
		const planeId = editorViewContext.activeRegion?.planeId ?? null;
		if (!planeId) return;
		const mesh = planeOverlay.meshes.find((m) => m.userData.planeId === planeId);
		if (!mesh) return;
		const box = new THREE.Box3().setFromObject(mesh);
		const sphere = box.getBoundingSphere(new THREE.Sphere());
		const center = sphere.center;
		const radius = Math.max(sphere.radius, 1);
		const plane = part.getPlaneById(planeId);
		const normal = plane
			? new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z).normalize()
			: new THREE.Vector3(0, 0, 1);
		const camera = _activeCamera;
		const controls = _controls;
		const fov = camera.fov * (Math.PI / 180);
		const dist = (radius / Math.tan(fov / 2)) * 1.4;
		controls.target.copy(center);
		camera.position.copy(center).addScaledVector(normal, dist);
		const upGuess =
			Math.abs(normal.dot(new THREE.Vector3(0, 0, 1))) > 0.95
				? new THREE.Vector3(0, 1, 0)
				: new THREE.Vector3(0, 0, 1);
		camera.up.copy(upGuess);
		camera.lookAt(center);
		controls.update();
	};
	clearRelaxedFn = clearSim;

	// ── Stress legend tick positions ──────────────────────────────────────────

	function stressTick(stressRatio: number): number {
		if (stressRatio <= STRESS_REST_RATIO) return 0;
		if (stressRatio <= STRESS_YELLOW_RATIO) {
			return ((stressRatio - STRESS_REST_RATIO) / (STRESS_YELLOW_RATIO - STRESS_REST_RATIO)) * 50;
		}
		return (
			50 +
			((Math.min(stressRatio, STRESS_RED_RATIO) - STRESS_YELLOW_RATIO) /
				(STRESS_RED_RATIO - STRESS_YELLOW_RATIO)) *
				50
		);
	}
	const stressTicks: { label: string; pct: number; color: string }[] = [
		{
			label: `${STRESS_REST_RATIO}×`,
			pct: 0,
			color: `#${stressToColor(STRESS_REST_RATIO).getHexString()}`,
		},
		{
			label: `${STRESS_YELLOW_RATIO}×`,
			pct: stressTick(STRESS_YELLOW_RATIO),
			color: `#${stressToColor(STRESS_YELLOW_RATIO).getHexString()}`,
		},
		{
			label: `${STRESS_RED_RATIO}×`,
			pct: 100,
			color: `#${stressToColor(STRESS_RED_RATIO).getHexString()}`,
		},
	];

	// ── Gizmo target selection ────────────────────────────────────────────────
	// The gizmo edits one thing at a time. Overlay placement takes priority over
	// plane selection so toggling "Move" on the overlay wins regardless of the
	// active region's plane.

	function activeOverlay(): OverlayInstance | undefined {
		return activeOverlayId ? overlays.find((o) => o.id === activeOverlayId) : undefined;
	}

	function makeOverlayTarget(instance: OverlayInstance): GizmoTarget {
		return new OverlayGizmoTarget(
			() => instance.transform,
			(t) => (instance.transform = t),
			() => saveOverlayPlacement(instance)
		);
	}

	// Persist a PDB instance's final pose so reloading the same file restores it.
	// mrDNA instances have an empty sourceKey and are never remembered.
	function saveOverlayPlacement(instance: OverlayInstance): void {
		if (!instance.sourceKey) return;
		setOverlayPlacementCmd(
			editorViewContext.historyStack,
			part,
			instance.id,
			instance.sourceKey,
			instance.transform,
			'Move overlay'
		);
	}

	function makePlaneTarget(planeId: string): GizmoTarget | null {
		if (!planeOverlay) return null;
		return new PlaneGizmoTarget(part, planeId, editorViewContext.historyStack, planeOverlay);
	}

	function currentGizmoTarget(): GizmoTarget | null {
		const instance = activeOverlay();
		if (instance) return makeOverlayTarget(instance);
		if (showPlanes && selectedPlaneId) return makePlaneTarget(selectedPlaneId);
		return null;
	}

	// ── Unified pointer handlers ──────────────────────────────────────────────

	function handlePointerMove(e: PointerEvent) {
		_updateMouseCoords(e);

		if (dragController?.isActive) {
			dragController.update(_mouse, _activeCamera!);
			_markDirty?.();
			return;
		}

		// Gizmo handle hover (priority over plane quads)
		if (transformGizmo && transformGizmo.group.visible) {
			const activeHandles =
				gizmoMode === 'rotate'
					? transformGizmo.handles.filter((h) => h.userData.gizmoMode === 'rotate')
					: transformGizmo.handles.filter((h) => h.userData.gizmoMode === 'translate');
			const hit = _raycastMeshes(activeHandles);
			if (hit !== _hoveredGizmoHandle) {
				transformGizmo.setHover(hit);
				_hoveredGizmoHandle = hit;
				_markDirty?.();
			}
		}

		// Plane quad hover
		if (showPlanes && planeOverlay) {
			const hit = _hoveredGizmoHandle ? null : _raycastMeshes(planeOverlay.meshes);
			if (hit !== _hoveredPlaneMesh) {
				planeOverlay.setHover(hit);
				_hoveredPlaneMesh = hit;
				_markDirty?.();
			}
		}

		// Coordinate axis hover
		if (showCoordinateAxis && axisObjects && _activeCamera) {
			_raycaster.setFromCamera(_mouse, _activeCamera);
			const hits = _raycaster.intersectObjects(axisObjects.planeMeshes, false);
			const hitObj = hits.length > 0 ? hits[0].object : null;
			const next =
				hitObj instanceof THREE.Mesh && axisObjects.planeMeshes.includes(hitObj) ? hitObj : null;
			if (next !== _hoveredAxisPlane) {
				axisObjects.setHover(next);
				_hoveredAxisPlane = next;
				_markDirty?.();
			}
		}
	}

	function handlePointerDown(e: PointerEvent) {
		_mouseDownPos = { x: e.clientX, y: e.clientY };
		_updateMouseCoords(e);

		if (transformGizmo?.group.visible && dragController) {
			const target = currentGizmoTarget();
			if (target && dragController.tryStart(target, gizmoMode, _mouse, _activeCamera!)) {
				capturePointer(e.pointerId);
				return;
			}
		}
	}

	function handlePointerUp(_e: PointerEvent) {
		if (dragController?.isActive) dragController.commit();
		releaseCapturedPointer();
	}

	function handlePointerCancel() {
		dragController?.cancel();
	}

	function handleClick(e: MouseEvent) {
		if (dragController?.isActive) return;
		const dx = e.clientX - _mouseDownPos.x;
		const dy = e.clientY - _mouseDownPos.y;
		if (dx * dx + dy * dy > 16) return; // camera drag

		// Axis plane click → create a new plane with that basis
		if (showCoordinateAxis && axisObjects && _hoveredAxisPlane) {
			const axisPlane = _hoveredAxisPlane.userData.axisPlane as 'xy' | 'xz' | 'yz';
			editorViewContext.addPlaneFromAxisPlane(axisPlane);
			axisObjects.setSelected(null);
			_selectedAxisPlane = null;
			return;
		}

		// Plane quad click — activate the matching region if one exists, or
		// fall back to selecting the bare plane (regionless planes still need
		// to be selectable for the "Add Region on this plane" flow).
		if (showPlanes && planeOverlay) {
			const hit = _raycastMeshes(planeOverlay.meshes);
			if (hit) {
				activeOverlayId = null; // selecting a plane hands the gizmo back to it
				const planeId = hit.userData.planeId as string;
				if (planeId === selectedPlaneId) {
					editorViewContext.setActiveRegion(null);
					selectedPlaneId = null;
				} else {
					const region = part.regions.find((r) => r.planeId === planeId);
					if (region) {
						editorViewContext.setActiveRegion(region.id);
					} else {
						selectedPlaneId = planeId;
					}
				}
				return;
			}
			if (selectedPlaneId) {
				editorViewContext.setActiveRegion(null);
				selectedPlaneId = null;
			}
		}
	}

	// ── Reactive effects (module-level, gated on threeRenderer) ──────────────

	// Background color
	$effect(() => {
		if (!threeRenderer) return;
		threeRenderer.setClearColor(canvasTheme.isDark ? 0x111113 : 0xfafafa);
		_markDirty?.();
	});

	// Coordinate axis visibility
	$effect(() => {
		if (!threeRenderer || !axisObjects) return;
		const shouldShow = showCoordinateAxis || editorViewContext.planeSelectionMode;
		axisObjects.group.visible = shouldShow;
		if (!shouldShow) {
			axisObjects.setHover(null);
			axisObjects.setSelected(null);
			_hoveredAxisPlane = null;
			_selectedAxisPlane = null;
		}
		_markDirty?.();
	});

	// Plane overlay meshes — rebuild when planes or VH count change
	$effect(() => {
		if (!threeRenderer || !planeOverlay) return;
		void part.planes.length;
		for (const plane of part.planes) {
			void plane.origin;
			void plane.u;
			void plane.v;
			void plane.normal;
		}
		void part.virtualHelices.length;
		planeOverlay.group.visible = showPlanes;
		if (showPlanes) {
			planeOverlay.update(part.planes, part);
			if (selectedPlaneId) {
				const mesh =
					planeOverlay.meshes.find((m) => m.userData.planeId === selectedPlaneId) ?? null;
				planeOverlay.setSelected(mesh);
			}
		}
		_markDirty?.();
	});

	// Gizmo visibility and pose
	$effect(() => {
		if (!threeRenderer || !transformGizmo) return;
		const instance = activeOverlay();
		const planeActive = showPlanes && !!selectedPlaneId;
		transformGizmo.group.visible = !!instance || planeActive;
		if (!dragController?.isActive) {
			if (instance) {
				// Sync the gizmo from the persisted placement for PDB (so undo/redo move
				// the gizmo too — history mutates the model), else the live transform
				// (mrDNA / session-only). Reading the values keeps this effect subscribed.
				const stored = instance.sourceKey
					? part.overlayPlacements.find((p) => p.id === instance.id)
					: undefined;
				const t = stored ? stored.transform : instance.transform;
				transformGizmo.setPosition(new THREE.Vector3(t.position.x, t.position.y, t.position.z));
				transformGizmo.setQuaternion(
					new THREE.Quaternion(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3])
				);
			} else if (planeActive) {
				const plane = part.getPlaneById(selectedPlaneId!);
				if (plane) {
					void plane.u;
					void plane.origin;
				}
				const target = makePlaneTarget(selectedPlaneId!);
				if (target) dragController?.syncPose(target);
			}
		}
		transformGizmo.setMode(gizmoMode);
		_markDirty?.();
	});

	// Clear plane-editing UI when showPlanes is toggled off. Gizmo *visibility* is
	// owned solely by the "Gizmo visibility and pose" effect above; this one only
	// clears hover/selection state (an overlay-placement drag must survive).
	$effect(() => {
		if (!threeRenderer) return;
		if (!showPlanes) {
			if (dragController?.isActive && !activeOverlayId) dragController.cancel();
			if (planeOverlay) {
				planeOverlay.setHover(null);
				planeOverlay.setSelected(null);
				_hoveredPlaneMesh = null;
			}
			if (transformGizmo) {
				transformGizmo.setHover(null);
				_hoveredGizmoHandle = null;
			}
			_markDirty?.();
		}
	});

	// Mirror plane-overlay selection visual to the selected plane (highlight only;
	// gizmo visibility is owned by the "Gizmo visibility and pose" effect).
	$effect(() => {
		if (!threeRenderer || !planeOverlay || !showPlanes) return;
		if (selectedPlaneId) {
			const mesh = planeOverlay.meshes.find((m) => m.userData.planeId === selectedPlaneId) ?? null;
			planeOverlay.setSelected(mesh);
		} else {
			planeOverlay.setSelected(null);
		}
		_markDirty?.();
	});

	// Basis-plane selector
	$effect(() => {
		if (!threeRenderer || !planeSelector) return;
		planeSelector.update({
			inSelectionMode: editorViewContext.planeSelectionMode,
			activePlane: editorViewContext.pendingBasePlane,
			regionKind: editorViewContext.pendingRegionKind ?? null,
		});
		_markDirty?.();
	});

	// Reset camera whenever the part reference itself changes (document switch)
	$effect(() => {
		if (!threeRenderer) return;
		void part;
		isFirstBuild = true;
	});

	// Rebuild geometry whenever the part model or rendering options change
	$effect(() => {
		if (!threeRenderer || !scene || !cursor) return;
		void part.oligos.size;
		void part.virtualHelices.length;
		void showNtModel;
		void highlightContext.scaffold;
		void highlightContext.circular_strand;
		void highlightContext.longer_than_90;
		void highlightContext.shorter_than_15;
		void filterSegments;
		void focusedSegments;
		void simOverrides;
		void simStressMap;
		void useRelaxedPositions;
		void showStress;
		for (const plane of part.planes) {
			void plane.u;
		}

		if (currentGroup) {
			scene.remove(currentGroup);
			disposeGroup(currentGroup);
		}

		const _buildStart = performance.now();
		const simOverridesArg = useRelaxedPositions ? (simOverrides ?? undefined) : undefined;
		const stressArg = showStress && simStressMap ? simStressMap : undefined;
		let built: ReturnType<typeof buildScene>;
		try {
			built = buildScene(
				part,
				showNtModel,
				highlightContext,
				filterSegments,
				focusedSegments,
				simOverridesArg,
				stressArg
			);
		} catch (err) {
			// The NT-model builder throws on designs it can't represent (e.g. a deletion
			// on a constrained crossover). Surface it and fall back to the regular strand
			// rendering instead of letting the throw escape the effect and freeze the app.
			if (!showNtModel) throw err;
			const message = err instanceof Error ? err.message : String(err);
			console.error('NT model build failed:', err);
			toast.error('Cannot show NT model', { description: message });
			onNtModelError?.(message);
			built = buildScene(
				part,
				false,
				highlightContext,
				filterSegments,
				focusedSegments,
				simOverridesArg,
				stressArg
			);
		}
		const { group, cylinders, labels, crossovers, center } = built;
		statsBuildMs = performance.now() - _buildStart;
		currentGroup = group;
		currentCylinders = cylinders;
		currentLabels = labels;
		currentCrossovers = crossovers;

		// Use untrack to set initial visibility without tracking showVH/hideContext
		// as rebuild dependencies — the dedicated effects below handle subsequent changes.
		untrack(() => {
			group.visible = showDesign;
			cylinders.visible = showVH;
			labels.visible = showVH;
			crossovers.visible = !hideContext.crossovers;
		});

		scene.add(group);

		untrack(() => {
			vhXYCache = getVhXYMap(part);
			cursor!.rebuildRings(vhXYCache);
			cursor!.updateMarkers(csCursorIdx, part, vhXYCache);
		});

		if (isFirstBuild) {
			isFirstBuild = false;
			resetCameraToDesign(group, center);
		}
		_markDirty?.();
	});

	// Reconcile one THREE.Group per overlay instance. Rebuilds a group only when its
	// instance's `ghost` (or data) changes; transform + visibility are handled in the
	// next effect so a drag or Hide/Show never rebuilds GPU buffers.
	$effect(() => {
		if (!threeRenderer || !scene) return;
		const list = overlays;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();
		for (const inst of list) {
			seen.add(inst.id);
			const ghost = inst.ghost; // track → rebuild on change
			const data = inst.data;
			untrack(() => {
				const existing = overlayGroups.get(inst.id);
				if (existing && existing.data === data && existing.ghost === ghost) return;
				if (existing) {
					scene!.remove(existing.group);
					disposeGroup(existing.group);
				}
				const group = buildExternalStructureOverlayGroup(data, ghost);
				applyOverlayTransform(group, inst.transform);
				group.visible = show3DOverlays && inst.visible;
				scene!.add(group);
				overlayGroups.set(inst.id, { group, data, ghost });
			});
		}
		untrack(() => {
			for (const [id, entry] of overlayGroups) {
				if (seen.has(id)) continue;
				scene!.remove(entry.group);
				disposeGroup(entry.group);
				overlayGroups.delete(id);
			}
		});
		_markDirty?.();
	});

	// Per-instance transform + visibility, without rebuilding geometry.
	$effect(() => {
		if (!threeRenderer) return;
		const master = show3DOverlays;
		for (const inst of overlays) {
			const t = inst.transform;
			const visible = inst.visible;
			const entry = overlayGroups.get(inst.id);
			if (entry) {
				applyOverlayTransform(entry.group, t);
				entry.group.visible = master && visible;
			}
		}
		_markDirty?.();
	});

	// Restore remembered placements onto live instance transforms (load/undo/redo).
	// Runs when the instance list or persisted placements change; the write is
	// untracked so it never feeds back or fights the instance being dragged.
	$effect(() => {
		if (!threeRenderer) return;
		const placements = part.overlayPlacements;
		for (const inst of overlays) {
			if (!inst.sourceKey) continue;
			const stored = placements.find((p) => p.id === inst.id);
			const target = stored ? stored.transform : identityOverlayTransform();
			untrack(() => {
				if (dragController?.isActive && activeOverlayId === inst.id) return;
				if (!overlayTransformsEqual(inst.transform, target)) {
					inst.transform = cloneOverlayTransform(target);
				}
			});
		}
	});

	// Update the stale-relaxation flag whenever topology or sim state changes
	$effect(() => {
		if (!threeRenderer) return;
		void part.oligos.size;
		void part.virtualHelices.length;
		const sig = computeSimulationFreshnessSignature(part);
		isSimStale = hasRelaxedPositions && simSig !== null && simSig !== sig;
	});

	// Toggle cylinder + label visibility
	$effect(() => {
		if (!threeRenderer) return;
		if (currentCylinders) currentCylinders.visible = showVH;
		if (currentLabels) currentLabels.visible = showVH;
		_markDirty?.();
	});

	// Toggle all main design geometry without affecting overlays or scene helpers.
	$effect(() => {
		if (!threeRenderer) return;
		if (currentGroup) currentGroup.visible = showDesign;
		_markDirty?.();
	});

	// Toggle crossover arc visibility
	$effect(() => {
		if (!threeRenderer) return;
		if (currentCrossovers) currentCrossovers.visible = !hideContext.crossovers;
		_markDirty?.();
	});

	// Slide cursor rings and update markers when the CrossSectionSelector moves
	$effect(() => {
		if (!threeRenderer || !cursor) return;
		const bp = csCursorIdx;
		cursor.ringGroup.position.z = bp * BACKBONE_RISE_NM;
		untrack(() => cursor!.updateMarkers(bp, part, vhXYCache));
		_markDirty?.();
	});

	// Toggle cursor indicators
	$effect(() => {
		if (!threeRenderer || !cursor) return;
		cursor.ringGroup.visible = showCursor;
		cursor.markers.visible = showCursor;
		if (showCursor) untrack(() => cursor!.updateMarkers(csCursorIdx, part, vhXYCache));
		_markDirty?.();
	});

	// ── Mount: imperative setup only ─────────────────────────────────────────

	onMount(() => {
		if (!canvas) return;

		// ── RBS simulation ─────────────────────────────────────────────────────
		sim = new RbsSimulation({
			onRunning: (v) => {
				simRunning = v;
			},
			onProgress: (step, total) => {
				simProgressStep = step;
				simProgressTotal = total;
			},
			onDiagnostics: (d) => {
				simDiagnostics = d;
			},
			onResults: (overrides, stressMap, sig) => {
				simOverrides = overrides;
				simStressMap = stressMap;
				simSig = sig;
				hasRelaxedPositions = overrides.size > 0;
				useRelaxedPositions = hasRelaxedPositions;
			},
		});

		const rig = setupScene(canvas);
		const { renderer, scene: localScene, camera, controls } = rig;
		_markDirty = rig.markDirty;
		scene = localScene;
		_activeCamera = camera;
		_controls = controls;

		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (w > 0 && h > 0) {
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		}

		// ── Cursor indicators ──────────────────────────────────────────────────
		cursor = createCursor();
		scene.add(cursor.ringGroup);
		scene.add(cursor.markers);

		// ── Coordinate axis ────────────────────────────────────────────────────
		axisObjects = createCoordinateAxis(20);
		axisObjects.group.visible = false;
		scene.add(axisObjects.group);

		// ── Plane overlay ──────────────────────────────────────────────────────
		planeOverlay = createPlaneOverlay();
		scene.add(planeOverlay.group);

		transformGizmo = createTransformGizmo();
		scene.add(transformGizmo.group);

		// ── Gizmo drag controller ──────────────────────────────────────────────
		dragController = new GizmoDragController(
			transformGizmo,
			_raycaster,
			(enabled) => {
				if (_controls) _controls.enabled = enabled;
			},
			releaseCapturedPointer
		);

		// ── Basis-plane selector ───────────────────────────────────────────────
		planeSelector = createPlaneSelector();
		scene.add(planeSelector.group);

		// ── Expose scene-dependent functions to parent ─────────────────────────
		downloadFn = () => downloadScreenshot(renderer, localScene, camera, `${exportFileBase}.png`);

		exportGlbFn = () => {
			const exportGroup = buildExportScene(
				part,
				true,
				highlightContext,
				filterSegments,
				focusedSegments,
				showVH,
				useRelaxedPositions ? (simOverrides ?? undefined) : undefined
			);
			exportGlb(exportGroup, `${exportFileBase}.glb`);
		};

		exportOxDnaFn = (opts) => {
			const overrides = useRelaxedPositions ? (simOverrides ?? undefined) : undefined;
			pendingIncludeMirrors = opts?.includeMirrors ?? false;
			if (hasUnassignedSequence(part)) {
				pendingExportOverrides = overrides;
				oxDnaDialogOpen = true;
			} else {
				downloadOxDnaFiles(
					exportFileBase,
					exportPartToOxDna(part, overrides, 'T', pendingIncludeMirrors)
				);
			}
		};

		exportMrdnaFn = (opts) => {
			const overrides = useRelaxedPositions ? (simOverrides ?? undefined) : undefined;
			pendingIncludeMirrors = opts?.includeMirrors ?? false;
			if (hasUnassignedSequence(part)) {
				pendingExportOverrides = overrides;
				mrdnaDialogOpen = true;
			} else {
				downloadMrdnaFile(
					exportFileBase,
					exportPartToMrdna(part, {
						segPositionOverrides: overrides,
						includeMirrors: pendingIncludeMirrors,
					})
				);
			}
		};

		frameOverlayFn = (id: string) => {
			const inst = overlays.find((o) => o.id === id);
			if (!inst) return;
			frameBox(transformedBoundsBox(inst.data.bounds, inst.transform));
		};

		// Activate all module-level $effect blocks (they gate on threeRenderer)
		threeRenderer = renderer;

		// Animation loop — only render when dirty; controls.update() runs every frame
		// for TrackballControls inertia. The 'change' event on controls sets dirty.
		let rafId: number;
		let _lastFrameTime = performance.now();
		function animate() {
			rafId = requestAnimationFrame(animate);
			controls.update();
			if (rig.consumeDirty()) {
				renderer.render(localScene, camera);
				if (showStats) {
					const now = performance.now();
					statsFrameMs = now - _lastFrameTime;
					_lastFrameTime = now;
					statsDrawCalls = renderer.info.render.calls;
					statsGeometries = renderer.info.memory.geometries;
					statsTextures = renderer.info.memory.textures;
				}
			}
		}
		animate();

		return () => {
			sim?.dispose();
			sim = undefined;
			dragController?.cancel();
			dragController = undefined;
			releaseCapturedPointer();
			_markDirty = undefined;
			simulateFn = undefined;
			resetCameraFn = undefined;
			frameActivePlaneFn = undefined;
			clearRelaxedFn = undefined;
			downloadFn = undefined;
			exportGlbFn = undefined;
			exportOxDnaFn = undefined;
			exportMrdnaFn = undefined;
			frameOverlayFn = undefined;
			cancelAnimationFrame(rafId);

			if (cursor) {
				scene!.remove(cursor.ringGroup);
				scene!.remove(cursor.markers);
				cursor.dispose();
				cursor = undefined;
			}

			if (axisObjects) {
				scene!.remove(axisObjects.group);
				axisObjects.dispose();
				axisObjects = undefined;
				_activeCamera = undefined;
				_controls = undefined;
				_hoveredAxisPlane = null;
				_selectedAxisPlane = null;
			}
			if (planeOverlay) {
				scene!.remove(planeOverlay.group);
				planeOverlay.dispose();
				planeOverlay = undefined;
				_hoveredPlaneMesh = null;
			}
			if (transformGizmo) {
				scene!.remove(transformGizmo.group);
				transformGizmo.dispose();
				transformGizmo = undefined;
				_hoveredGizmoHandle = null;
			}
			if (planeSelector) {
				planeSelector.dispose();
				scene!.remove(planeSelector.group);
				planeSelector = undefined;
			}

			if (currentGroup) {
				scene!.remove(currentGroup);
				disposeGroup(currentGroup);
			}
			for (const entry of overlayGroups.values()) {
				scene!.remove(entry.group);
				disposeGroup(entry.group);
			}
			overlayGroups.clear();

			// Deactivate all module-level $effect blocks
			scene = undefined;
			threeRenderer = undefined;
			rig.dispose();
		};
	});
</script>

<div class="relative h-full w-full overflow-hidden">
	<canvas
		bind:this={canvas}
		class="h-full w-full"
		style="display:block;"
		onpointermove={handlePointerMove}
		onpointerdown={handlePointerDown}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		onclick={handleClick}
	></canvas>
	<div class="pointer-events-none absolute right-3 bottom-4 text-xs text-gray-400 select-none">
		drag to rotate · scroll to zoom · right-drag to pan
	</div>
	{#if showStats}
		<div
			class="pointer-events-none absolute top-2 right-2 rounded bg-black/70 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-green-400 select-none"
		>
			<div>draw calls <span class="text-white">{statsDrawCalls}</span></div>
			<div>geometries <span class="text-white">{statsGeometries}</span></div>
			<div>textures <span class="text-white">{statsTextures}</span></div>
			<div>frame <span class="text-white">{statsFrameMs.toFixed(1)} ms</span></div>
			<div>buildScene <span class="text-white">{statsBuildMs.toFixed(1)} ms</span></div>
		</div>
	{/if}
	{#if showStress && simStressMap}
		<div class="pointer-events-none absolute bottom-14 left-3 select-none">
			<div class="mb-1 text-[10px] text-gray-300">Crossover length ratio</div>
			<!-- Gradient bar -->
			<div
				class="relative h-2.5 w-32 rounded"
				style="background: linear-gradient(to right, #00cc44 0%, #ffcc00 50%, #ff2222 100%)"
			>
				<!-- Tick marks -->
				{#each stressTicks as tick, idx (idx)}
					<div
						class="absolute -bottom-0.5 h-3.5 w-px bg-gray-400/60"
						style="left: {tick.pct}%"
					></div>
				{/each}
			</div>
			<!-- Tick labels -->
			<div class="relative mt-1 h-3 w-32">
				{#each stressTicks as tick, idx (idx)}
					<span
						class="absolute -translate-x-1/2 text-[9px] text-gray-400"
						style="left: {tick.pct}%; color: {tick.color}">{tick.label}</span
					>
				{/each}
			</div>
			<div class="mt-0.5 text-[9px] text-gray-500">distance / rest length (0.6 nm)</div>
		</div>
	{/if}
	<div class="pointer-events-none absolute bottom-4 left-3 text-xs text-gray-300 select-none">
		{#if simRunning}
			Running RBS {simProgressStep}/{simProgressTotal}
		{:else if simDiagnostics}
			RBS: {simDiagnostics.blockCount} blocks · {simDiagnostics.constraintCount} constraints · RMS {simDiagnostics.rmsConstraintError.toFixed(
				3
			)} nm · overlap {simDiagnostics.maxOverlap.toFixed(3)} nm
		{/if}
	</div>
</div>

<OxDnaExportDialog
	bind:open={oxDnaDialogOpen}
	onConfirm={(fallback: OxDnaFallbackBase) => {
		downloadOxDnaFiles(
			exportFileBase,
			exportPartToOxDna(part, pendingExportOverrides, fallback, pendingIncludeMirrors)
		);
		pendingExportOverrides = undefined;
	}}
	onCancel={() => {
		pendingExportOverrides = undefined;
	}}
/>

<OxDnaExportDialog
	bind:open={mrdnaDialogOpen}
	onConfirm={(fallback: MrdnaFallbackBase) => {
		downloadMrdnaFile(
			exportFileBase,
			exportPartToMrdna(part, {
				fallbackBase: fallback,
				segPositionOverrides: pendingExportOverrides,
				includeMirrors: pendingIncludeMirrors,
			})
		);
		pendingExportOverrides = undefined;
	}}
	onCancel={() => {
		pendingExportOverrides = undefined;
	}}
/>
