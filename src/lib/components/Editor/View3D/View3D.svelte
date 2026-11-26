<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { notify } from '$lib/notifications/notify.svelte';
	import type { Part } from '$lib/model/Part';
	import { setupScene } from './sceneSetup';
	import {
		buildScene,
		buildExportScene,
		STRESS_RED_RATIO,
		STRESS_REST_RATIO,
		STRESS_YELLOW_RATIO,
		stressToColor,
	} from './helixGeometry';
	import {
		applyPick,
		boxPickedEnds,
		isPickable,
		itemsInRect,
		itemsCoveredBy,
		pickedEnds,
		pickLine,
		piecesOf,
		type LinePickHit,
		type LinePickIndex,
		type LinePickItem,
	} from './linePick';
	import { createHoverGlow, type HoverGlow } from './hoverGlow';
	import { formatHoverFootnote } from '$lib/canvasEditor/tools/behaviors/hoverInfo';
	import type { CanHighlight, CanHide } from '$lib/components/Editor/context/types';
	import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
	import * as THREE from 'three';
	import type { TrackballControls } from 'three/addons/controls/TrackballControls.js';
	import type { SolverParams } from '$lib/model/rbs/rbsTypes';
	import type { BlockTransformOverride } from '$lib/model/rbs/rbsTypes';
	import {
		exportAssemblyToOxDna,
		exportPartToOxDna,
		hasUnassignedSequence,
		type OxDnaFallbackBase,
	} from '$lib/model/io/oxdnaExport';
	import {
		exportAssemblyToMrdna,
		exportPartToMrdna,
		type MrdnaFallbackBase,
	} from '$lib/model/io/mrdnaExport';
	import {
		assemblyHasUnassignedSequence,
		type SimulationExportRequest,
		type SimulationExportScope,
	} from '$lib/model/io/assemblyNtModel';
	import OxDnaExportDialog from './OxDnaExportDialog.svelte';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';
	import {
		createCoordinateAxis,
		createPlaneAxes,
		type CoordinateAxisResult,
		type PlaneAxesResult,
	} from './coordinateAxis';
	import {
		fitDistance,
		isFaceOn,
		poseQuaternion,
		rollQuaternion,
		posePosition,
		tweenPose,
		upForDir,
		type CameraPose,
		type CubeDir,
	} from './cameraViews';
	import ViewCube from './ViewCube.svelte';
	import PartGhost from './PartGhost.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Move3d, Rotate3d } from '@lucide/svelte';
	import {
		CYLINDERS_NAME,
		LABELS_NAME,
		applyOccurrencePose,
		instanceCopy,
		occurrenceIdOf,
		occurrenceMatrix,
	} from './assemblyScene';
	import { IDENTITY_TRANSFORM } from '$lib/model/Assembly';
	import { setOccurrenceTransformCmd } from '$lib/commands/assembly';
	import {
		createTransformGizmo,
		type GizmoMode,
		type TransformGizmoResult,
	} from './transformGizmo';
	import { createPlaneOverlay, type PlaneOverlayResult } from './planeOverlay';
	import {
		BASIS_PLANE_TRANSFORMS,
		getEditorViewContext,
	} from '$lib/components/Editor/context/EditorViewContext.svelte';
	import { exportBaseName } from '$lib/model/io/designFileName';
	import { disposeGroup } from './threeUtils';
	import {
		downloadScreenshot,
		exportGlb,
		downloadMrdnaFile,
		downloadOxDnaFiles,
	} from './exportUtils';
	import { createCursor, type CursorResult } from './cursor';
	import type { PlaneTransform } from '$lib/commands/planes';
	import { createPlaneSelector, type PlaneSelectorResult } from './planeSelector';
	import {
		createReferenceMeshOverlay,
		type ReferenceMeshItem,
		type ReferenceMeshOverlay,
	} from './referenceMeshOverlay';
	import {
		FramedGizmoTarget,
		GizmoDragController,
		OccurrenceGizmoTarget,
		OverlayGizmoTarget,
		PlaneGizmoTarget,
		type GizmoTarget,
	} from './gizmoDragController';
	import { RbsSimulation, type RbsDiagnostics } from './rbs/rbsSimulation';
	import { DEFAULT_SOLVER_PARAMS } from '$lib/model/rbs/rbsEngine';
	import {
		computeSimulationFreshnessSignature,
		keptRelaxedPoses,
		relaxedPartPoses,
		type PartRelaxation,
	} from './view3dSimulationState';
	import { buildExternalStructureOverlayGroup } from './externalStructureOverlayGeometry';
	import {
		applyOverlayTransform,
		cloneOverlayTransform,
		identityOverlayTransform,
		overlayTransformsEqual,
		transformedBoundsBox,
	} from './overlayTransform';
	import type { OverlayInstance } from './overlayInstance';
	import type { OxDnaReplay } from './replay/OxDnaReplay.svelte';
	import {
		buildReplayGeometry,
		pickNucleotide,
		type ReplayGeometry,
	} from './replay/replayGeometry';
	import {
		evenSize,
		fitVerticalFovDeg,
		type ReplayFrameRenderer,
		type VideoSize,
	} from './replay/replayVideoExport';
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
		replayFrameRendererFn?: ((size: VideoSize | null) => ReplayFrameRenderer | null) | undefined;
		exportGlbFn?: (() => void) | undefined;
		exportOxDnaFn?: ((request?: SimulationExportRequest) => void) | undefined;
		exportMrdnaFn?: ((request?: SimulationExportRequest) => void) | undefined;
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
		replay?: OxDnaReplay | null;
		/** The oxDNA replay panel is open: draw the trajectory instead of the design. */
		replayActive?: boolean;
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
		hideContext = { crossovers: false, unconstrained_crossovers: false, sequence: false },
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
		replayFrameRendererFn = $bindable(undefined),
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
		replay = null,
		replayActive = false,
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
	let planeAxes: PlaneAxesResult | undefined;
	let _activeCamera: THREE.PerspectiveCamera | undefined;
	let _controls: TrackballControls | undefined;
	let currentGroup: THREE.Group | null = null;
	// The active Part's edited instance placement; every Part-space object (design, planes,
	// cursor, overlays, replay) lives under it so tools keep working in Part coordinates.
	let partFrame: THREE.Group | undefined;
	// Lab-space copies: other Parts (ghosted) and the active Part's other instances.
	let assemblyRoot = $state.raw<THREE.Group | undefined>(undefined);
	// Bumped after each rebuild so the active Part's instance copies re-clone the new scene.
	let sceneVersion = $state(0);
	let replayGeometry: ReplayGeometry | null = null;
	// One THREE.Group per overlay instance, keyed by instance id. `ghost` is cached
	// so the reconcile effect knows when a rebuild is needed.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const overlayGroups = new Map<string, { group: THREE.Group; data: object; ghost: boolean }>();
	let currentCylinders = $state<THREE.Group | null>(null);
	let currentLabels = $state<THREE.Group | null>(null);
	let currentCrossovers = $state<THREE.Group | null>(null);
	let currentPickIndex: LinePickIndex | null = null;
	let isFirstBuild = true;
	const REBUILD_MAX_DELAY_MS = 250;
	let rebuildTick = $state(0);
	let rebuildDue = true;
	let rebuildTimer: number | null = null;
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
	let referenceMeshOverlay: ReferenceMeshOverlay | undefined;

	// ── RBS simulation state (drives geometry rebuild + bindable props) ────────
	let simOverrides = $state<Map<string, BlockTransformOverride> | null>(null);
	let simStressMap = $state<Map<string, number> | null>(null);
	let simProgressStep = $state(0);
	let simProgressTotal = $state(0);
	let simSig = $state<string | null>(null);
	let sim: RbsSimulation | undefined;
	/** Results of the Parts not active, by Part id; the active Part's lives in the state above. */
	const keptRelaxations = new SvelteMap<string, PartRelaxation>();

	// ── simulation export dialog state ────────────────────────────────────────
	let oxDnaDialogOpen = $state(false);
	let mrdnaDialogOpen = $state(false);
	let pendingExportOverrides = $state<Map<string, BlockTransformOverride> | undefined>(undefined);
	let pendingIncludeMirrors = $state(false);
	let pendingScope = $state<SimulationExportScope>('activePart');
	const pendingWholeAssembly = $derived(pendingScope === 'assembly');

	const _raycaster = new THREE.Raycaster();
	const _mouse = new THREE.Vector2();
	let _mouseDownPos = { x: 0, y: 0 };

	const MESH_DRAFT_KEY = 'mesh-draft';
	const planeTransformOf = ({ origin, u, v, normal }: PlaneTransform) => ({ origin, u, v, normal });

	const editorViewContext = getEditorViewContext();
	const doc = $derived(editorViewContext.currentDoc);
	const ghostParts = $derived(
		doc.parts
			.filter((p) => p.id !== part.id)
			.map((p) => ({
				part: p,
				occurrences: doc.assembly.occurrencesOf(p.id),
				relaxed: keptRelaxedPoses(p, keptRelaxations.get(p.id)),
			}))
	);
	const movingOccurrence = $derived(
		editorViewContext.movingOccurrenceId
			? (doc.assembly.getById(editorViewContext.movingOccurrenceId) ?? null)
			: null
	);

	/** Part space → world for the active Part (its edited instance's placement). */
	function partFrameMatrix(): THREE.Matrix4 {
		return occurrenceMatrix(editorViewContext.activeOccurrence?.transform);
	}

	function framed(target: GizmoTarget): GizmoTarget {
		return new FramedGizmoTarget(target, partFrameMatrix);
	}
	const exportFileBase = $derived(exportBaseName(editorViewContext.currentDoc.name));
	// A one-Part export of a design with several Parts says which Part it holds.
	const simulationFileBase = $derived(
		pendingWholeAssembly || doc.parts.length <= 1
			? exportFileBase
			: exportBaseName(doc.name, `.${part.name}`)
	);

	function needsFallbackBase(): boolean {
		return pendingWholeAssembly
			? assemblyHasUnassignedSequence(doc, hasUnassignedSequence)
			: hasUnassignedSequence(part);
	}

	function buildOxDnaExport(
		overrides: Map<string, BlockTransformOverride> | undefined,
		fallbackBase: OxDnaFallbackBase
	) {
		return pendingWholeAssembly
			? exportAssemblyToOxDna(doc, {
					fallbackBase,
					includeMirrors: pendingIncludeMirrors,
					relaxedParts: exportRelaxedParts(overrides),
				})
			: exportPartToOxDna(part, overrides, fallbackBase, pendingIncludeMirrors);
	}

	function buildMrdnaExport(
		overrides: Map<string, BlockTransformOverride> | undefined,
		fallbackBase: MrdnaFallbackBase
	) {
		return pendingWholeAssembly
			? exportAssemblyToMrdna(doc, {
					fallbackBase,
					includeMirrors: pendingIncludeMirrors,
					relaxedParts: exportRelaxedParts(overrides),
				})
			: exportPartToMrdna(part, {
					fallbackBase,
					segPositionOverrides: overrides,
					includeMirrors: pendingIncludeMirrors,
				});
	}

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

	function resetCameraToDesign(box: THREE.Box3, center: THREE.Vector3): void {
		if (!_activeCamera || !_controls) return;
		const camera = _activeCamera;
		const controls = _controls;

		controls.target.copy(center);

		const up = new THREE.Vector3(0, 0, 1);
		if (!box.isEmpty()) {
			// From above and a little in front; the distance fits the pane's width as well as height.
			const fromDir = new THREE.Vector3(0, -0.4, 1).normalize();
			const dist = fitDistance(box, fromDir, up, camera.fov, camera.aspect, 1.3);
			camera.position.copy(center).addScaledVector(fromDir, dist);
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
		// Cancel, not stop: a result already on its way must not bring the cleared state back.
		sim?.cancel();
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

	/** Keeps the active Part's result (if any) under `partId` before another Part becomes active. */
	function keepRelaxation(partId: string): void {
		for (const id of keptRelaxations.keys()) {
			if (!doc.parts.some((p) => p.id === id)) keptRelaxations.delete(id);
		}
		if (!simOverrides?.size || simSig === null || !doc.parts.some((p) => p.id === partId)) {
			keptRelaxations.delete(partId);
			return;
		}
		keptRelaxations.set(partId, {
			overrides: simOverrides,
			stressMap: simStressMap ?? new Map(),
			sig: simSig,
			diagnostics: simDiagnostics,
			shown: useRelaxedPositions,
		});
	}

	/** Brings back the result kept for `partId`, once `clearSim` has emptied the state. */
	function restoreRelaxation(partId: string): void {
		const kept = keptRelaxations.get(partId);
		if (!kept) return;
		keptRelaxations.delete(partId);
		simOverrides = kept.overrides;
		simStressMap = kept.stressMap;
		simSig = kept.sig;
		simDiagnostics = kept.diagnostics;
		hasRelaxedPositions = true;
		useRelaxedPositions = kept.shown;
	}

	/** What an assembly export relaxes: every Part with a relaxed result on screen. */
	function exportRelaxedParts(activeOverrides: Map<string, BlockTransformOverride> | undefined) {
		return relaxedPartPoses(
			doc.parts,
			{ partId: part.id, overrides: activeOverrides },
			keptRelaxations
		);
	}

	// ── Bindable function props wired before mount ────────────────────────────

	simulateFn = () => sim?.simulate(part, solverParams);
	/**
	 * What Fit and the view cube frame: everything drawn (the active Part and every other visible
	 * instance), in world space. Hidden instances don't count; with nothing drawn, the active Part.
	 */
	function designBounds(): THREE.Box3 {
		const box = new THREE.Box3();
		const piece = new THREE.Box3();
		for (const root of [currentGroup, assemblyRoot]) {
			if (!root) continue;
			root.updateWorldMatrix(true, true);
			root.traverseVisible((object) => {
				if (object instanceof THREE.InstancedMesh) {
					if (object.count === 0) return;
					object.computeBoundingBox();
					box.union(piece.copy(object.boundingBox!).applyMatrix4(object.matrixWorld));
					return;
				}
				const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
				if (!geometry?.attributes?.position) return;
				if (!geometry.boundingBox) geometry.computeBoundingBox();
				box.union(piece.copy(geometry.boundingBox!).applyMatrix4(object.matrixWorld));
			});
		}
		return box.isEmpty() && currentGroup ? box.setFromObject(currentGroup) : box;
	}

	resetCameraFn = () => {
		if (!currentGroup) return;
		const box = designBounds();
		// A wireframe region can hold a mesh and no helices yet.
		if (box.isEmpty() && referenceMeshOverlay && !referenceMeshOverlay.bounds().isEmpty()) {
			frameBox(referenceMeshOverlay.bounds());
			return;
		}
		const center = box.isEmpty() ? new THREE.Vector3(0, 0, 0) : box.getCenter(new THREE.Vector3());
		resetCameraToDesign(box, center);
	};
	// ── View cube: turn the camera to a face, edge or corner ─────────────────

	const CUBE_TURN_MS = 350;
	let viewCubeQuaternion = $state.raw<THREE.Quaternion | null>(null);
	let viewCubeFaceOn = $state(false);
	let cameraTween: { from: CameraPose; to: CameraPose; startMs: number } | null = null;

	function viewFromCube(dir: CubeDir): void {
		if (!currentGroup || !_activeCamera || !_controls) return;
		let box = designBounds();
		if (box.isEmpty() && referenceMeshOverlay) box = referenceMeshOverlay.bounds();
		if (box.isEmpty())
			box = new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10));
		const camera = _activeCamera;
		const fromDir = new THREE.Vector3(...dir).normalize();
		const up = upForDir(dir);
		const to: CameraPose = {
			target: box.getCenter(new THREE.Vector3()),
			quaternion: poseQuaternion(fromDir, up),
			distance: fitDistance(box, fromDir, up, camera.fov, camera.aspect, 1.15),
		};
		startCameraTween(to);
	}

	/** Rolls the view a quarter turn about the line of sight, from where a running turn ends. */
	function rollView(clockwise: boolean): void {
		const to = cameraTween?.to ?? currentPose();
		if (!to) return;
		startCameraTween({ ...to, quaternion: rollQuaternion(to.quaternion, clockwise) });
	}

	function currentPose(): CameraPose | null {
		if (!_activeCamera || !_controls) return null;
		return {
			target: _controls.target.clone(),
			quaternion: _activeCamera.quaternion.clone(),
			distance: _activeCamera.position.distanceTo(_controls.target),
		};
	}

	function startCameraTween(to: CameraPose): void {
		const from = currentPose();
		if (!from) return;
		const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		cameraTween = { from, to, startMs: reduceMotion ? -Infinity : performance.now() };
		_markDirty?.();
	}

	/** Advances a running view-cube turn; called each frame before the controls update. */
	function stepCameraTween(now: number): void {
		if (!cameraTween || !_activeCamera || !_controls) return;
		const t = (now - cameraTween.startMs) / CUBE_TURN_MS;
		const pose = t >= 1 ? cameraTween.to : tweenPose(cameraTween.from, cameraTween.to, t);
		if (t >= 1) cameraTween = null;
		setCameraPose(pose);
	}

	function setCameraPose(pose: CameraPose): void {
		if (!_activeCamera || !_controls) return;
		const camera = _activeCamera;
		_controls.target.copy(pose.target);
		camera.quaternion.copy(pose.quaternion);
		camera.position.copy(posePosition(pose));
		// The controls re-aim with camera.up every frame; keep it on the turning camera.
		camera.up.set(0, 1, 0).applyQuaternion(pose.quaternion);
		_markDirty?.();
	}

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
		const normal = (
			plane
				? new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z)
				: new THREE.Vector3(0, 0, 1)
		)
			.transformDirection(partFrameMatrix())
			.normalize();
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
		// A linked Part is read-only: the overlay still moves, but its placement isn't remembered.
		if (!instance.sourceKey || !editorViewContext.canEditActivePart) return;
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
		// Gate before the gesture: a plane drag writes live, so a read-only Part never gets one.
		if (!planeOverlay || !editorViewContext.canEditActivePart) return null;
		return new PlaneGizmoTarget(part, planeId, editorViewContext.historyStack, planeOverlay);
	}

	function makeMovingOccurrenceTarget(): GizmoTarget | null {
		if (!movingOccurrence) return null;
		return new OccurrenceGizmoTarget(doc, movingOccurrence.id, editorViewContext.historyStack);
	}

	function currentGizmoTarget(): GizmoTarget | null {
		const instance = activeOverlay();
		if (instance) return framed(makeOverlayTarget(instance));
		const moving = makeMovingOccurrenceTarget();
		if (moving) return moving;
		if (showPlanes && selectedPlaneId) {
			const target = makePlaneTarget(selectedPlaneId);
			return target ? framed(target) : null;
		}
		return null;
	}

	// ── Unified pointer handlers ──────────────────────────────────────────────

	function pickReplayRow(): number {
		const backbone = replay?.displayPose?.backboneNm;
		if (!replayShown || !backbone || !_activeCamera) return -1;
		_raycaster.setFromCamera(_mouse, _activeCamera);
		const ray = _raycaster.ray.clone().applyMatrix4(partFrameMatrix().invert());
		return pickNucleotide(ray, backbone, replayVisibleRows);
	}

	// Clicking a replayed nucleotide selects its oligo in the strand view and scrolls to it.
	function selectReplayRow(row: number, additive: boolean): void {
		const nt = replay?.mapping?.nucleotides[row];
		const oligo = nt && part.segmentsLookup.get(nt.segmentId)?.oligo;
		if (!nt || !oligo) return;
		const selection = editorViewContext.strandViewContext.selected;
		if (additive) selection.add([...oligo.allEnds]);
		else selection.set([...oligo.allEnds]);
		editorViewContext.strandToolbarController?.centerOn(nt.vhId, nt.bpIndex);
	}

	// ── Select in 3D (line view) ─────────────────────────────────────────────
	const LINE_PICK_RADIUS_PX = 6;
	const _viewProjection = new THREE.Matrix4();

	const HOVER_STICKY_PX = 2;
	let hoverGlow: HoverGlow | undefined;
	let hoveredItem = -1;
	// Set while the status-bar footnote shows a 3D hover, so clearing never wipes the strand view's.
	let ownsFootnote = false;
	let hoverFrame = 0;
	let hoverPointer: { clientX: number; clientY: number } | null = null;

	/** What a click or box may pick under the current filters and crossover visibility. */
	function pickAccept() {
		const filter = editorViewContext.strandViewContext.selectionFilter;
		const showXovers = !hideContext.crossovers;
		return (item: LinePickItem) =>
			(showXovers || item.kind !== 'xover') && isPickable(item, filter);
	}

	/** Part space → clip space: pick indices hold Part-space points. */
	function updateViewProjection(camera: THREE.PerspectiveCamera): THREE.Matrix4 {
		_viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		return _viewProjection.multiply(partFrameMatrix());
	}

	function pickLineAt(e: { clientX: number; clientY: number }, sticky = false) {
		if (!currentPickIndex || !canvas || !_activeCamera) return null;
		const rect = canvas.getBoundingClientRect();
		updateViewProjection(_activeCamera);
		return pickLine(currentPickIndex, {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
			width: rect.width,
			height: rect.height,
			radiusPx: LINE_PICK_RADIUS_PX,
			viewProjection: _viewProjection,
			accept: pickAccept(),
			sticky:
				sticky && hoveredItem >= 0
					? { itemIndex: hoveredItem, marginPx: HOVER_STICKY_PX }
					: undefined,
		});
	}

	function clearHover(): void {
		if (hoverFrame) cancelAnimationFrame(hoverFrame);
		hoverFrame = 0;
		hoverPointer = null;
		if (hoveredItem < 0) return;
		hoveredItem = -1;
		hoverGlow?.clear();
		if (ownsFootnote) editorViewContext.strandViewContext.footnote = '';
		ownsFootnote = false;
		_markDirty?.();
	}

	function showHover(hit: LinePickHit): void {
		const strandCtx = editorViewContext.strandViewContext;
		const segment = hit.item.segment;
		const bp = hit.item.kind === 'xover' ? segment.threePrime.index : hit.bp;
		strandCtx.footnote = formatHoverFootnote({
			vhIndex: segment.inVirtualHelix.index,
			bp,
			oligoId: segment.oligo?.id,
			slotSeq: segment.slotForBp(bp)?.seq,
		});
		ownsFootnote = true;
		if (hit.itemIndex === hoveredItem) return;
		hoveredItem = hit.itemIndex;
		// Glow everything a click would select (a whole oligo, or every same-colour one).
		const ends = pickedEnds(part, hit.item, strandCtx.selectionFilter, strandCtx.selectAllMode);
		if (currentPickIndex && ends) {
			const covered = itemsCoveredBy(currentPickIndex, new Set(ends));
			const index = currentPickIndex;
			const solid = covered.filter((i) => !index.itemDim[i]);
			hoverGlow?.set(piecesOf(index, covered), piecesOf(index, solid));
		} else {
			hoverGlow?.clear();
		}
		_markDirty?.();
	}

	// At most one pick per frame; rotate/pan drags clear hover instead (see the controls listener).
	function scheduleHover(e: PointerEvent): void {
		hoverPointer = { clientX: e.clientX, clientY: e.clientY };
		if (hoverFrame) return;
		hoverFrame = requestAnimationFrame(() => {
			hoverFrame = 0;
			const pointer = hoverPointer;
			if (!pointer || !linePickActive) return;
			const hit = pickLineAt(pointer, true);
			if (hit) showHover(hit);
			else clearHover();
		});
	}

	/** A click picks into the strand view's selection; true when it hit something pickable. */
	function selectLineAt(e: MouseEvent): boolean {
		const hit = pickLineAt(e);
		if (!hit) return false;
		const strandCtx = editorViewContext.strandViewContext;
		const ends = pickedEnds(part, hit.item, strandCtx.selectionFilter, strandCtx.selectAllMode);
		if (!ends) return false;
		applyPick(strandCtx.selected, ends, e.shiftKey || e.metaKey || e.ctrlKey);
		const vh = hit.item.segment.inVirtualHelix;
		editorViewContext.strandToolbarController?.centerOn(vh.id, hit.bp, { onlyIfOffscreen: true });
		return true;
	}

	// ── Box select (Shift-drag) ──────────────────────────────────────────────
	const BOX_MIN_DRAG_PX = 4;
	let boxStart: { pointerId: number; x: number; y: number } | null = null;
	// Canvas-pixel rectangle while dragging; null until the drag passes BOX_MIN_DRAG_PX.
	let selectBox = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

	function canvasPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
		const rect = canvas!.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	// Capture phase, so the camera controls are off before they see this pointerdown.
	function handlePointerDownCapture(e: PointerEvent) {
		if (e.button !== 0 || !e.shiftKey || !linePickActive || !canvas || !_controls) return;
		if (e.target !== canvas) return;
		_controls.enabled = false;
		boxStart = { pointerId: e.pointerId, ...canvasPoint(e) };
		clearHover();
		capturePointer(e.pointerId);
	}

	function updateBox(e: PointerEvent): void {
		if (!boxStart) return;
		const p = canvasPoint(e);
		if (!selectBox && Math.hypot(p.x - boxStart.x, p.y - boxStart.y) < BOX_MIN_DRAG_PX) return;
		selectBox = { x0: boxStart.x, y0: boxStart.y, x1: p.x, y1: p.y };
	}

	/** Ends the box gesture; `commit` adds what it covers. A tiny drag falls through to the click. */
	function endBox(commit: boolean): void {
		if (!boxStart) return;
		const box = selectBox;
		boxStart = null;
		selectBox = null;
		if (_controls) _controls.enabled = true;
		releaseCapturedPointer();
		if (!commit || !box || !currentPickIndex || !canvas || !_activeCamera) return;
		const rect = canvas.getBoundingClientRect();
		const index = currentPickIndex;
		const items = itemsInRect(index, {
			...box,
			width: rect.width,
			height: rect.height,
			viewProjection: updateViewProjection(_activeCamera),
			accept: pickAccept(),
		});
		const strandCtx = editorViewContext.strandViewContext;
		const ends = boxPickedEnds(
			part,
			items.map((i) => index.items[i]),
			strandCtx.selectionFilter,
			strandCtx.selectAllMode
		);
		if (ends.length > 0) strandCtx.selected.add(ends);
	}

	function handlePointerMove(e: PointerEvent) {
		_updateMouseCoords(e);

		if (boxStart) {
			updateBox(e);
			return;
		}

		if (linePickActive && e.buttons === 0 && !dragController?.isActive) scheduleHover(e);

		if (dragController?.isActive) {
			dragController.update(_mouse, _activeCamera!);
			_markDirty?.();
			return;
		}

		if (replay && replayShown) {
			const row = pickReplayRow();
			const next = row >= 0 ? row : null;
			if (replay.hoveredRow !== next) replay.hoveredRow = next;
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
		if (boxStart) return; // Shift-drag box owns this gesture

		if (transformGizmo?.group.visible && dragController) {
			const target = currentGizmoTarget();
			if (target && dragController.tryStart(target, gizmoMode, _mouse, _activeCamera!)) {
				capturePointer(e.pointerId);
				return;
			}
		}
	}

	function handlePointerUp(_e: PointerEvent) {
		if (boxStart) {
			endBox(true);
			return;
		}
		try {
			if (dragController?.isActive) dragController.commit();
		} catch (error) {
			notify.error('The move could not be saved', {
				description: error instanceof Error ? error.message : undefined,
			});
		}
		releaseCapturedPointer();
	}

	function handlePointerCancel() {
		endBox(false);
		dragController?.cancel();
	}

	/** Double-clicking another instance (a ghost Part or a copy of this one) edits it there. */
	// The nearest shown helix wins, the edited instance's included: double-clicking it keeps it.
	function handleDoubleClick(): void {
		if (!assemblyRoot?.visible || !_activeCamera) return;
		const cylinders: THREE.Object3D[] = [];
		for (const root of [currentGroup, assemblyRoot]) {
			root?.traverseVisible((o) => {
				if (o.name === CYLINDERS_NAME) cylinders.push(o);
			});
		}
		_raycaster.setFromCamera(_mouse, _activeCamera);
		const id = occurrenceIdOf(_raycaster.intersectObjects(cylinders, true)[0]?.object ?? null);
		if (id) editorViewContext.editOccurrence(id);
	}

	function handleWindowKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || !movingOccurrence || dragController?.isActive) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, [contenteditable="true"]')) return;
		editorViewContext.stopMovingOccurrence();
	}

	function resetMovingOccurrence(): void {
		if (!movingOccurrence) return;
		setOccurrenceTransformCmd(
			editorViewContext.historyStack,
			doc,
			movingOccurrence.id,
			IDENTITY_TRANSFORM,
			'Reset instance placement'
		);
	}

	function handleClick(e: MouseEvent) {
		if (dragController?.isActive) return;
		const dx = e.clientX - _mouseDownPos.x;
		const dy = e.clientY - _mouseDownPos.y;
		if (dx * dx + dy * dy > 16) return; // camera drag

		const replayRow = pickReplayRow();
		if (replayRow >= 0) {
			selectReplayRow(replayRow, e.shiftKey || e.metaKey || e.ctrlKey);
			return;
		}

		if (linePickActive && selectLineAt(e)) return;

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

		// A true click on empty space clears, as in the strand viewer; rotate/pan drags aren't clicks.
		if (linePickActive && !(e.shiftKey || e.metaKey || e.ctrlKey)) {
			editorViewContext.strandViewContext.selected.clear();
		}
	}

	// ── Reactive effects (module-level, gated on threeRenderer) ──────────────

	// Background color
	$effect(() => {
		if (!threeRenderer) return;
		threeRenderer.setClearColor(canvasTheme.isDark ? 0x111113 : 0xfafafa);
		_markDirty?.();
	});

	// U/V/W triad of the active freeform region's plane, matching the Select panel's fields
	$effect(() => {
		if (!threeRenderer || !planeAxes) return;
		const region = editorViewContext.activeRegion;
		const plane = region?.supportsFreeformPlacement ? editorViewContext.activePlane : null;
		planeAxes.setPlane(
			plane ? { origin: plane.origin, u: plane.u, v: plane.v, normal: plane.normal } : null
		);
		_markDirty?.();
	});

	// Reference meshes follow their region's plane. `referenceGeometry` is a plain field, and every
	// change to it comes with a history revision. The draft takes the place of the mesh it would replace.
	$effect(() => {
		if (!threeRenderer || !referenceMeshOverlay) return;
		void editorViewContext.historyStack.revision;
		const draft = editorViewContext.scaledMeshDraft;
		const isCreating = editorViewContext.planeSelectionMode;
		const items: ReferenceMeshItem[] = [];
		for (const region of part.regions) {
			const mesh = region.referenceMesh;
			const plane = part.getPlaneById(region.planeId);
			if (
				!mesh ||
				!plane ||
				editorViewContext.hiddenReferenceMeshRegionIds.has(region.id) ||
				editorViewContext.hidden3DRegionIds.has(region.id)
			)
				continue;
			if (draft && !isCreating && region.id === editorViewContext.activeRegionId) continue;
			items.push({ key: region.id, mesh, plane: planeTransformOf(plane) });
		}
		const draftPlane = isCreating
			? BASIS_PLANE_TRANSFORMS[editorViewContext.pendingBasePlane]
			: editorViewContext.activePlane;
		if (draft && draftPlane) {
			items.push({ key: MESH_DRAFT_KEY, mesh: draft, plane: planeTransformOf(draftPlane) });
		}
		referenceMeshOverlay.update(items);
		// A file's size is unknown in advance, so the camera comes to the preview.
		if (draft) frameBox(referenceMeshOverlay.boundsOf(MESH_DRAFT_KEY) ?? new THREE.Box3());
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
		const moving = movingOccurrence;
		// A read-only Part's planes can be selected and framed, but not moved.
		const planeActive = showPlanes && !!selectedPlaneId && editorViewContext.canEditActivePart;
		transformGizmo.group.visible = !!instance || !!moving || planeActive;
		// Planes and overlays sit in the active Part's frame; follow it when that instance moves.
		const frame = partFrameMatrix();
		if (!dragController?.isActive) {
			if (instance) {
				// Sync the gizmo from the persisted placement for PDB (so undo/redo move
				// the gizmo too — history mutates the model), else the live transform
				// (mrDNA / session-only). Reading the values keeps this effect subscribed.
				const stored =
					instance.sourceKey && editorViewContext.canEditActivePart
						? part.overlayPlacements.find((p) => p.id === instance.id)
						: undefined;
				const t = stored ? stored.transform : instance.transform;
				const world = occurrenceMatrix(t).premultiply(frame);
				const position = new THREE.Vector3();
				const quaternion = new THREE.Quaternion();
				world.decompose(position, quaternion, new THREE.Vector3());
				transformGizmo.setPosition(position);
				transformGizmo.setQuaternion(quaternion);
			} else if (moving) {
				void moving.transform;
				const target = makeMovingOccurrenceTarget();
				if (target) dragController?.syncPose(target);
			} else if (planeActive) {
				const plane = part.getPlaneById(selectedPlaneId!);
				if (plane) {
					void plane.u;
					void plane.origin;
				}
				const target = makePlaneTarget(selectedPlaneId!);
				if (target) dragController?.syncPose(framed(target));
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

	// Another document refits the camera and drops every relaxation result. Another Part of the
	// same design keeps the camera; the old Part's result is kept for it (a run still going is
	// cancelled) and the new Part's comes back. A drag in progress belongs to the old Part object,
	// so it ends even when undo only rebuilt the same Part.
	let shownPart: Part | null = null;
	let shownDocId: string | null = null;
	$effect(() => {
		if (!threeRenderer) return;
		const current = part;
		const docId = doc.id;
		untrack(() => {
			const otherDoc = shownDocId !== docId;
			if (otherDoc) keptRelaxations.clear();
			if (shownPart && shownPart !== current) {
				dragController?.cancel();
				if (otherDoc || shownPart.id !== current.id) {
					if (!otherDoc) keepRelaxation(shownPart.id);
					clearSim();
					restoreRelaxation(current.id);
				}
			}
			if (otherDoc) isFirstBuild = true;
			shownPart = current;
			shownDocId = docId;
		});
	});

	// Rebuild geometry whenever the part model or rendering options change.
	// A rebuild blocks the main thread for its whole duration, so after one, the next waits about
	// twice as long as it took: changes in between (a plane drag, simulation progress, a burst of
	// edits) fold into one rebuild, and a small design still rebuilds on the next task. While
	// waiting, the effect is subscribed to `rebuildTick` only; the build run re-reads everything.
	$effect(() => {
		if (!threeRenderer || !scene || !cursor || !partFrame) return;
		void rebuildTick;
		if (!rebuildDue) {
			rebuildTimer ??= window.setTimeout(
				() => {
					rebuildTimer = null;
					rebuildDue = true;
					rebuildTick++;
				},
				Math.min(REBUILD_MAX_DELAY_MS, untrack(() => statsBuildMs) * 2)
			);
			return;
		}
		rebuildDue = false;
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
		const hiddenRegionIds = editorViewContext.hidden3DRegionIds;
		void hiddenRegionIds.size;
		for (const plane of part.planes) {
			void plane.u;
		}

		if (currentGroup) {
			partFrame.remove(currentGroup);
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
				stressArg,
				hiddenRegionIds
			);
		} catch (err) {
			// The NT-model builder throws on designs it can't represent (e.g. a deletion
			// on a constrained crossover). Surface it and fall back to the regular strand
			// rendering instead of letting the throw escape the effect and freeze the app.
			if (!showNtModel) throw err;
			const message = err instanceof Error ? err.message : String(err);
			console.error('NT model build failed:', err);
			notify.error('Cannot show NT model', { description: message });
			onNtModelError?.(message);
			built = buildScene(
				part,
				false,
				highlightContext,
				filterSegments,
				focusedSegments,
				simOverridesArg,
				stressArg,
				hiddenRegionIds
			);
		}
		const { group, cylinders, labels, crossovers, center, pickIndex } = built;
		labels.name = LABELS_NAME;
		cylinders.name = CYLINDERS_NAME;
		statsBuildMs = performance.now() - _buildStart;
		currentGroup = group;
		currentPickIndex = pickIndex;
		untrack(clearHover); // hovered item indices belong to the old index
		currentCylinders = cylinders;
		currentLabels = labels;
		currentCrossovers = crossovers;

		// Use untrack to set initial visibility without tracking showVH/hideContext
		// as rebuild dependencies — the dedicated effects below handle subsequent changes.
		untrack(() => {
			group.visible = activeDesignVisible;
			cylinders.visible = showVH;
			labels.visible = showVH;
			crossovers.visible = !hideContext.crossovers;
		});

		partFrame.add(group);
		sceneVersion = untrack(() => sceneVersion) + 1;

		untrack(updateCursor);

		if (isFirstBuild) {
			isFirstBuild = false;
			// The frame-pose effect runs after this one; pose the frame now so the fit sees it.
			const frame = partFrame;
			untrack(() =>
				applyOccurrencePose(
					frame,
					editorViewContext.activeOccurrence?.transform ?? IDENTITY_TRANSFORM
				)
			);
			resetCameraToDesign(
				new THREE.Box3().setFromObject(group),
				center.clone().applyMatrix4(frame.matrixWorld)
			);
		}
		_markDirty?.();
	});

	// The active Part's frame follows its edited instance (moved by the gizmo, undo, or switching
	// instance). Hiding that instance hides the design, not the planes or cursor.
	$effect(() => {
		if (!threeRenderer || !partFrame) return;
		applyOccurrencePose(
			partFrame,
			editorViewContext.activeOccurrence?.transform ?? IDENTITY_TRANSFORM
		);
		_markDirty?.();
	});

	// The active Part's other visible instances: copies of the scene just built, sharing its
	// geometry and materials, so edits and selection show on every instance.
	$effect(() => {
		if (!threeRenderer || !assemblyRoot) return;
		void sceneVersion;
		void showVH;
		void hideContext.crossovers;
		const source = currentGroup;
		if (!source) return;
		const root = assemblyRoot;
		const edited = editorViewContext.activeOccurrence;
		const copies = doc.assembly
			.occurrencesOf(part.id)
			.filter((o) => o.visible && o.id !== edited?.id)
			.map((o) => instanceCopy(source, o.transform, o.id));
		for (const copy of copies) root.add(copy);
		_markDirty?.();
		return () => {
			for (const copy of copies) root.remove(copy);
			_markDirty?.();
		};
	});

	$effect(() => {
		if (!threeRenderer || !assemblyRoot) return;
		assemblyRoot.visible = designVisible;
		_markDirty?.();
	});

	// Reconcile one THREE.Group per overlay instance. Rebuilds a group only when its
	// instance's `ghost` (or data) changes; transform + visibility are handled in the
	// next effect so a drag or Hide/Show never rebuilds GPU buffers.
	$effect(() => {
		if (!threeRenderer || !partFrame) return;
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
					partFrame!.remove(existing.group);
					disposeGroup(existing.group);
				}
				const group = buildExternalStructureOverlayGroup(data, ghost);
				applyOverlayTransform(group, inst.transform);
				group.visible = show3DOverlays && inst.visible;
				partFrame!.add(group);
				overlayGroups.set(inst.id, { group, data, ghost });
			});
		}
		untrack(() => {
			for (const [id, entry] of overlayGroups) {
				if (seen.has(id)) continue;
				partFrame!.remove(entry.group);
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
		// Building the solver input is real work: skip it while there is no result to compare.
		isSimStale =
			hasRelaxedPositions &&
			simSig !== null &&
			simSig !== computeSimulationFreshnessSignature(part);
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
		if (currentGroup) {
			currentGroup.visible = activeDesignVisible;
		}
		_markDirty?.();
	});

	// ── oxDNA replay (transient, never persisted) ──────────────────────────────
	let replayShown = $derived.by(() => {
		if (!replayActive || !replay?.displayPose) return false;
		void part.oligos.size;
		void part.virtualHelices.length;
		return !replay.isStale(part);
	});
	let designVisible = $derived(showDesign && (!replayShown || !!replay?.showDesign));
	// The active Part as drawn: hiding its edited instance hides it, and picking follows.
	let activeDesignVisible = $derived(
		designVisible && (editorViewContext.activeOccurrence?.visible ?? true)
	);
	// Picking follows the editor's Select mode; Pan (or any other mode) leaves 3D view-only.
	let linePickActive = $derived(
		editorViewContext.editorMode === 'SELECT' && activeDesignVisible && !showNtModel && !replayShown
	);
	// A mode, filter or visibility change makes the current glow wrong; the next move redraws it.
	$effect(() => {
		void linePickActive;
		void editorViewContext.strandViewContext.selectionFilter;
		void editorViewContext.strandViewContext.selectAllMode;
		void hideContext.crossovers;
		untrack(clearHover);
	});
	// "Show only selected strands" (and its lock) hides the other strands' nucleotides too.
	let replayVisibleRows = $derived.by(() => {
		const mapping = replay?.mapping;
		const filter = filterSegments;
		if (!mapping || !filter) return null;
		const mask = new Uint8Array(mapping.nucleotides.length);
		mapping.nucleotides.forEach((nt, row) => {
			const segment = part.segmentsLookup.get(nt.segmentId);
			mask[row] = segment && filter.has(segment) ? 1 : 0;
		});
		return mask;
	});

	// Build the replay mesh once per loaded trajectory; frames only rewrite its buffers.
	$effect(() => {
		if (!threeRenderer || !partFrame) return;
		const mapping = replay?.mapping;
		if (!mapping) return;
		const frame = partFrame;
		const geometry = buildReplayGeometry(mapping.nucleotides);
		replayGeometry = geometry;
		frame.add(geometry.group);
		return () => {
			frame.remove(geometry.group);
			disposeGroup(geometry.group);
			if (replayGeometry === geometry) replayGeometry = null;
			_markDirty?.();
		};
	});

	// Oligo colours, re-read whenever any oligo is recoloured. A strand-view selection dims every
	// other strand, so the selected ones stand out in the replay.
	$effect(() => {
		const mapping = replay?.mapping;
		if (!threeRenderer || !mapping || !replayGeometry) return;
		const fallback = new THREE.Color(0x9ca3af);
		const dimTo = new THREE.Color(canvasTheme.isDark ? 0x3f3f46 : 0xe4e4e7);
		const focus = focusedSegments;
		const colors = mapping.nucleotides.map((nt) => {
			const segment = part.segmentsLookup.get(nt.segmentId);
			const hex = segment?.oligo?.color;
			const color = hex ? new THREE.Color(hex) : fallback.clone();
			return focus && segment && !focus.has(segment) ? color.lerp(dimTo, 0.85) : color;
		});
		replayGeometry.setColors(colors);
		_markDirty?.();
	});

	$effect(() => {
		const pose = replay?.displayPose;
		if (!threeRenderer || !replayGeometry) return;
		if (pose) replayGeometry.update(pose);
		replayGeometry.group.visible = replayShown;
		_markDirty?.();
	});

	$effect(() => {
		const mask = replayVisibleRows;
		if (!threeRenderer || !replayGeometry) return;
		replayGeometry.setVisible(mask);
		untrack(() => {
			if (mask && replay?.hoveredRow != null && !mask[replay.hoveredRow]) replay.hoveredRow = null;
		});
		_markDirty?.();
	});

	$effect(() => {
		const row =
			replayShown && replay?.videoStatus !== 'exporting' ? (replay?.hoveredRow ?? null) : null;
		if (!threeRenderer || !replayGeometry) return;
		replayGeometry.setHovered(row);
		_markDirty?.();
	});

	// Leaving the replay panel stops playback.
	$effect(() => {
		if (!replayActive) untrack(() => replay?.pause());
	});

	// Toggle crossover arc visibility
	$effect(() => {
		if (!threeRenderer) return;
		if (currentCrossovers) currentCrossovers.visible = !hideContext.crossovers;
		_markDirty?.();
	});

	/**
	 * Cross-section cursor at `csCursorIdx` of the strand view's cursor region, as that view draws
	 * it; nothing when no region has the cursor or that region is hidden in 3D.
	 */
	function updateCursor(): void {
		if (!cursor || !showCursor) return;
		const regionId = editorViewContext.strandViewContext.activeCsRegionId;
		const shown = regionId !== null && !editorViewContext.hidden3DRegionIds.has(regionId);
		cursor.update(part, shown ? regionId : null, csCursorIdx);
		_markDirty?.();
	}

	// Follow the cursor as it moves or changes region, and when it is toggled.
	$effect(() => {
		if (!threeRenderer || !cursor) return;
		void csCursorIdx;
		void editorViewContext.strandViewContext.activeCsRegionId;
		void editorViewContext.hidden3DRegionIds.size;
		cursor.rings.visible = showCursor;
		cursor.markers.visible = showCursor;
		untrack(updateCursor);
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
		partFrame = new THREE.Group();
		partFrame.matrixAutoUpdate = false;
		scene.add(partFrame);
		assemblyRoot = new THREE.Group();
		scene.add(assemblyRoot);
		// Hover follows the pointer, not the camera: rotate, pan and zoom drop it until the next move.
		controls.addEventListener('start', () => {
			cameraTween = null; // grabbing the view stops a view-cube turn
			clearHover();
		});
		controls.addEventListener('change', () => {
			if (hoveredItem >= 0) clearHover();
		});
		hoverGlow = createHoverGlow();
		partFrame.add(hoverGlow.group);

		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (w > 0 && h > 0) {
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
		}

		// ── Cursor indicators ──────────────────────────────────────────────────
		cursor = createCursor();
		partFrame.add(cursor.rings);
		partFrame.add(cursor.markers);

		// ── Coordinate axis ────────────────────────────────────────────────────
		axisObjects = createCoordinateAxis(20);
		axisObjects.group.visible = false;
		partFrame.add(axisObjects.group);
		planeAxes = createPlaneAxes(10);
		partFrame.add(planeAxes.group);

		// ── Plane overlay ──────────────────────────────────────────────────────
		planeOverlay = createPlaneOverlay();
		partFrame.add(planeOverlay.group);

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
		partFrame.add(planeSelector.group);
		referenceMeshOverlay = createReferenceMeshOverlay();
		partFrame.add(referenceMeshOverlay.group);

		// ── Expose scene-dependent functions to parent ─────────────────────────
		downloadFn = () => downloadScreenshot(renderer, localScene, camera, `${exportFileBase}.png`);

		// Video export draws the replay offscreen at its own size, from the camera as it is now.
		replayFrameRendererFn = (size) => {
			const geometry = replayGeometry;
			if (!geometry || !replayShown) return null;
			const view = renderer.domElement;
			const { width, height } = evenSize(size?.width ?? view.width, size?.height ?? view.height);
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const offscreen = new THREE.WebGLRenderer({
				canvas,
				antialias: true,
				preserveDrawingBuffer: true,
				stencil: true, // drawOncePerPixel, as in the live view
			});
			offscreen.setPixelRatio(1);
			offscreen.setSize(width, height, false);
			const clearColor = new THREE.Color();
			renderer.getClearColor(clearColor);
			offscreen.setClearColor(clearColor, 1);
			const shot = camera.clone();
			shot.fov = fitVerticalFovDeg(
				camera.fov,
				view.clientWidth / view.clientHeight,
				width / height
			);
			shot.aspect = width / height;
			shot.updateProjectionMatrix();
			geometry.setHovered(null);
			return {
				canvas,
				width,
				height,
				draw(pose) {
					geometry.update(pose);
					offscreen.render(localScene, shot);
				},
				dispose() {
					offscreen.dispose();
					offscreen.forceContextLoss();
					const shown = replay?.displayPose;
					if (shown) geometry.update(shown);
					geometry.setHovered(replay?.hoveredRow ?? null);
					_markDirty?.();
				},
			} satisfies ReplayFrameRenderer;
		};

		exportGlbFn = () => {
			const exportGroup = buildExportScene(
				part,
				true,
				highlightContext,
				filterSegments,
				focusedSegments,
				showVH,
				useRelaxedPositions ? (simOverrides ?? undefined) : undefined,
				editorViewContext.hidden3DRegionIds
			);
			exportGlb(exportGroup, `${exportFileBase}.glb`);
		};

		exportOxDnaFn = (request) => {
			const overrides = useRelaxedPositions ? (simOverrides ?? undefined) : undefined;
			pendingIncludeMirrors = request?.includeMirrors ?? false;
			pendingScope = request?.scope ?? 'activePart';
			if (needsFallbackBase()) {
				pendingExportOverrides = overrides;
				oxDnaDialogOpen = true;
			} else {
				downloadOxDnaFiles(simulationFileBase, buildOxDnaExport(overrides, 'T'));
			}
		};

		exportMrdnaFn = (request) => {
			const overrides = useRelaxedPositions ? (simOverrides ?? undefined) : undefined;
			pendingIncludeMirrors = request?.includeMirrors ?? false;
			pendingScope = request?.scope ?? 'activePart';
			if (needsFallbackBase()) {
				pendingExportOverrides = overrides;
				mrdnaDialogOpen = true;
			} else {
				downloadMrdnaFile(simulationFileBase, buildMrdnaExport(overrides, 'T'));
			}
		};

		frameOverlayFn = (id: string) => {
			const inst = overlays.find((o) => o.id === id);
			if (!inst) return;
			frameBox(
				transformedBoundsBox(inst.data.bounds, inst.transform).applyMatrix4(partFrameMatrix())
			);
		};

		// Activate all module-level $effect blocks (they gate on threeRenderer)
		threeRenderer = renderer;

		// Animation loop — only render when dirty; controls.update() runs every frame
		// for TrackballControls inertia. The 'change' event on controls sets dirty.
		let rafId: number;
		let _lastFrameTime = performance.now();
		function animate() {
			rafId = requestAnimationFrame(animate);
			stepCameraTween(performance.now());
			controls.update();
			if (rig.consumeDirty()) {
				renderer.render(localScene, camera);
				if (!viewCubeQuaternion?.equals(camera.quaternion))
					viewCubeQuaternion = camera.quaternion.clone();
				// Judged on where a turn ends, so the roll buttons stay put while it animates.
				const faceOn = isFaceOn(cameraTween?.to.quaternion ?? camera.quaternion);
				if (faceOn !== viewCubeFaceOn) viewCubeFaceOn = faceOn;
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
			if (rebuildTimer !== null) window.clearTimeout(rebuildTimer);
			rebuildTimer = null;
			_markDirty = undefined;
			simulateFn = undefined;
			resetCameraFn = undefined;
			frameActivePlaneFn = undefined;
			clearRelaxedFn = undefined;
			downloadFn = undefined;
			replayFrameRendererFn = undefined;
			exportGlbFn = undefined;
			exportOxDnaFn = undefined;
			exportMrdnaFn = undefined;
			frameOverlayFn = undefined;
			cancelAnimationFrame(rafId);

			clearHover();
			if (hoverGlow) {
				partFrame?.remove(hoverGlow.group);
				hoverGlow.dispose();
				hoverGlow = undefined;
			}
			if (cursor) {
				scene!.remove(cursor.rings);
				scene!.remove(cursor.markers);
				cursor.dispose();
				cursor = undefined;
			}

			if (planeAxes) {
				scene!.remove(planeAxes.group);
				planeAxes.dispose();
				planeAxes = undefined;
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
			if (referenceMeshOverlay) {
				referenceMeshOverlay.dispose();
				scene!.remove(referenceMeshOverlay.group);
				referenceMeshOverlay = undefined;
			}

			if (currentGroup) {
				partFrame?.remove(currentGroup);
				disposeGroup(currentGroup);
			}
			for (const entry of overlayGroups.values()) {
				partFrame?.remove(entry.group);
				disposeGroup(entry.group);
			}
			overlayGroups.clear();
			partFrame = undefined;
			assemblyRoot = undefined;

			// Deactivate all module-level $effect blocks
			scene = undefined;
			threeRenderer = undefined;
			rig.dispose();
		};
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="relative h-full w-full overflow-hidden" onpointerdowncapture={handlePointerDownCapture}>
	<canvas
		bind:this={canvas}
		class={[
			'h-full w-full',
			replayShown && replay?.hoveredRow != null && 'cursor-pointer',
			linePickActive && 'cursor-crosshair',
		]}
		style="display:block;"
		onpointermove={handlePointerMove}
		onpointerleave={() => {
			if (replay) replay.hoveredRow = null;
			clearHover();
		}}
		onpointerdown={handlePointerDown}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerCancel}
		onclick={handleClick}
		ondblclick={handleDoubleClick}
	></canvas>
	{#if threeRenderer && assemblyRoot}
		{#each ghostParts as ghost (ghost.part)}
			<PartGhost
				parent={assemblyRoot}
				part={ghost.part}
				occurrences={ghost.occurrences}
				relaxed={ghost.relaxed}
				onChange={() => _markDirty?.()}
			/>
		{/each}
	{/if}
	{#if movingOccurrence}
		<div
			class="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-background/95 px-2 py-1 text-xs shadow-sm"
		>
			<span class="mr-1 text-muted-foreground"
				>Moving <span class="font-medium text-foreground">{movingOccurrence.name}</span></span
			>
			<Button
				variant={gizmoMode === 'translate' ? 'secondary' : 'ghost'}
				size="icon"
				class="size-6"
				title="Move along an axis"
				aria-label="Move along an axis"
				onclick={() => (gizmoMode = 'translate')}><Move3d size={13} /></Button
			>
			<Button
				variant={gizmoMode === 'rotate' ? 'secondary' : 'ghost'}
				size="icon"
				class="size-6"
				title="Rotate about an axis"
				aria-label="Rotate about an axis"
				onclick={() => (gizmoMode = 'rotate')}><Rotate3d size={13} /></Button
			>
			<Button
				variant="ghost"
				size="sm"
				class="h-6 px-2 text-xs"
				title="Put this instance back at the origin"
				onclick={resetMovingOccurrence}>Reset</Button
			>
			<Button
				variant="outline"
				size="sm"
				class="h-6 px-2 text-xs"
				title="Stop moving (Esc)"
				onclick={() => editorViewContext.stopMovingOccurrence()}>Done</Button
			>
		</div>
	{/if}
	{#if selectBox}
		<div
			class="pointer-events-none absolute border border-primary bg-primary/10"
			style:left="{Math.min(selectBox.x0, selectBox.x1)}px"
			style:top="{Math.min(selectBox.y0, selectBox.y1)}px"
			style:width="{Math.abs(selectBox.x1 - selectBox.x0)}px"
			style:height="{Math.abs(selectBox.y1 - selectBox.y0)}px"
		></div>
	{/if}
	<div class="pointer-events-none absolute right-3 bottom-4 text-xs text-gray-400 select-none">
		{linePickActive ? 'click to select · shift-drag to box-select · ' : ''}drag to rotate · scroll
		to zoom · right-drag to pan
	</div>
	{#if viewCubeQuaternion}
		<ViewCube
			quaternion={viewCubeQuaternion}
			faceOn={viewCubeFaceOn}
			onPick={viewFromCube}
			onRoll={rollView}
		/>
	{/if}
	{#if showStats}
		<div
			class="pointer-events-none absolute top-40 right-2 rounded bg-black/70 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-green-400 select-none"
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
		downloadOxDnaFiles(simulationFileBase, buildOxDnaExport(pendingExportOverrides, fallback));
		pendingExportOverrides = undefined;
	}}
	onCancel={() => {
		pendingExportOverrides = undefined;
	}}
/>

<OxDnaExportDialog
	bind:open={mrdnaDialogOpen}
	onConfirm={(fallback: MrdnaFallbackBase) => {
		downloadMrdnaFile(simulationFileBase, buildMrdnaExport(pendingExportOverrides, fallback));
		pendingExportOverrides = undefined;
	}}
	onCancel={() => {
		pendingExportOverrides = undefined;
	}}
/>
