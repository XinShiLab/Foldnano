<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { Stage } from 'svelte-konva';
	import type { Part } from '../../../model/Part';
	import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import HelixView from './HelixView.svelte';
	import View3D from '../View3D/View3D.svelte';
	import { getEditorViewContext } from '$lib/components/Editor/context/EditorViewContext.svelte';
	import { DEFAULT_SOLVER_PARAMS } from '$lib/model/rbs/rbsEngine';
	import type { SolverParams, SolverResult } from '$lib/model/rbs/rbsTypes';
	import {
		MrdnaOverlayParseError,
		parseMrdnaOverlay,
		type ExternalStructureOverlay,
	} from '../View3D/externalStructureOverlay';
	import { PdbOverlayParseError, parsePdbOverlay } from '../View3D/pdbOverlay';
	import {
		cloneOverlayTransform,
		identityOverlayTransform,
		overlayPlacementKey,
	} from '../View3D/overlayTransform';
	import type { OverlayInstance } from '../View3D/overlayInstance';
	import { clearOverlayPlacementCmd, setOverlayPlacementCmd } from '$lib/commands/overlays';
	import { toast } from 'svelte-sonner';
	import { help } from '$lib/components/help/help';

	type RbsDiagnostics = Pick<
		SolverResult,
		'maxConstraintError' | 'rmsConstraintError' | 'maxOverlap'
	> & {
		blockCount: number;
		constraintCount: number;
	};

	interface Props {
		part: Part;
	}

	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	let csCursorIdx = $derived(editorViewContext.strandViewContext.csCursorIdx);
	let highlightContext = $derived(editorViewContext.strandViewContext.highlightContext);
	let hideContext = $derived(editorViewContext.strandViewContext.hideContext);
	let show3D = $derived(editorViewContext.show3D);

	let stageRef = $state<Stage>();

	const helixToolbarController = $state({
		stage: undefined as Stage | undefined,
	});

	const view3DToolbarController = $state({
		showVH: false,
		showNtModel: false,
		showCursor: false,
		selectionMode: false,
		lockSelection: false,
		useRelaxedPositions: false,
		hasRelaxedPositions: false,
		isSimStale: false,
		showStress: false,
		simRunning: false,
		simDiagnostics: null as RbsDiagnostics | null,
		solverParams: { ...DEFAULT_SOLVER_PARAMS } as SolverParams,
		showDesign: true,
		showCoordinateAxis: false,
		showPlanes: false,
		show3DOverlays: true,
		overlays: [] as OverlayInstance[],
		activeOverlayId: null as string | null,
		selectedPlaneId: null as string | null,
		gizmoMode: 'rotate' as 'rotate' | 'translate',
		showStats: false,
		planeSelectionMode: false,
		pendingBasePlane: 'XY' as 'XY' | 'XZ' | 'YZ',
		pendingRegionKind: null as import('$lib/model/Part/DesignRegion').RegionKind | null,
		toolPanelMode: 'inspector' as 'inspector' | 'overlays',
		onSimulate: undefined as (() => void) | undefined,
		onResetCamera: undefined as (() => void) | undefined,
		onFrameActivePlane: undefined as (() => void) | undefined,
		onClearRelaxed: undefined as (() => void) | undefined,
		onDownload: undefined as (() => void) | undefined,
		onExportGlb: undefined as (() => void) | undefined,
		onExportOxDna: undefined as ((opts?: { includeMirrors?: boolean }) => void) | undefined,
		onExportMrdna: undefined as ((opts?: { includeMirrors?: boolean }) => void) | undefined,
		onLoadOverlay,
		onDuplicateOverlay,
		onClearOverlay,
		onFrameOverlay,
		onToggleOverlayPlacement,
		onResetOverlayPlacement,
		onToggleOverlayGhost,
		onToggleOverlayVisible,
		onAddPlane: undefined as (() => void) | undefined,
		onRemovePlane: undefined as (() => void) | undefined,
		onToggleLock,
		onToggleShowVH: toggleShowVH,
		onToggleCursor: toggleCursor,
		onTogglePlanes: togglePlanes,
		onToggleNtModel: toggleNtModel,
	});

	function toggleShowVH() {
		view3DToolbarController.showVH = !view3DToolbarController.showVH;
	}
	function toggleCursor() {
		if (!view3DToolbarController.showNtModel) {
			view3DToolbarController.showCursor = !view3DToolbarController.showCursor;
		}
	}
	function togglePlanes() {
		view3DToolbarController.showPlanes = !view3DToolbarController.showPlanes;
	}
	function toggleNtModel() {
		view3DToolbarController.showNtModel = !view3DToolbarController.showNtModel;
		if (view3DToolbarController.showNtModel) {
			view3DToolbarController.showCursor = false;
		}
	}

	const DUPLICATE_OFFSET_NM = 2;

	// Session cache of parsed PDB structures by sourceKey. The reconcile effect
	// below recreates live instances from this + persisted placements, so PDB
	// add/duplicate/remove can flow purely through history (undo/redo-safe).
	const loadedSources = new SvelteMap<string, ExternalStructureOverlay>();

	function addOverlayInstance(instance: OverlayInstance): void {
		view3DToolbarController.overlays = [...view3DToolbarController.overlays, instance];
	}

	function findOverlay(id: string): OverlayInstance | undefined {
		return view3DToolbarController.overlays.find((o) => o.id === id);
	}

	// Keep live PDB instances in sync with persisted placements + loaded data.
	// Runs on load (new cached source), undo, and redo, so add/duplicate/remove
	// stay consistent with what's rendered. mrDNA instances (sourceKey '') are
	// session-only and never touched here.
	$effect(() => {
		const placements = part.overlayPlacements;
		void loadedSources.size;
		untrack(() => {
			const list = view3DToolbarController.overlays;
			const placementById = new Map(placements.filter((p) => p.sourceKey).map((p) => [p.id, p]));
			const liveIds = new Set(list.map((o) => o.id));

			// Drop PDB instances whose placement is gone (e.g. undo of add/duplicate).
			const kept = list.filter((o) => o.sourceKey === '' || placementById.has(o.id));

			// Add instances for placements with loaded data not yet live (rehydrate,
			// redo of add/duplicate, undo of remove).
			const additions: OverlayInstance[] = [];
			for (const p of placements) {
				if (!p.sourceKey || liveIds.has(p.id)) continue;
				const data = loadedSources.get(p.sourceKey);
				if (!data) continue;
				additions.push({
					id: p.id,
					sourceKey: p.sourceKey,
					data,
					transform: cloneOverlayTransform(p.transform),
					ghost: false,
					visible: true,
				});
			}

			if (kept.length !== list.length || additions.length > 0) {
				view3DToolbarController.overlays = [...kept, ...additions];
			}
			const activeId = view3DToolbarController.activeOverlayId;
			if (activeId && !view3DToolbarController.overlays.some((o) => o.id === activeId)) {
				view3DToolbarController.activeOverlayId = null;
			}
		});
	});

	async function onLoadOverlay(file: File): Promise<void> {
		const isPdb = /\.pdb$/i.test(file.name);
		try {
			const text = await file.text();
			const data = isPdb ? parsePdbOverlay(text, file.name) : parseMrdnaOverlay(text, file.name);
			const sourceKey = overlayPlacementKey(data) ?? '';

			if (sourceKey) {
				// PDB: cache the structure; the reconcile effect rehydrates every saved
				// placement. If none exist yet, add a first one (undoable).
				loadedSources.set(sourceKey, data);
				if (part.getOverlayPlacementsForSource(sourceKey).length === 0) {
					setOverlayPlacementCmd(
						editorViewContext.historyStack,
						part,
						crypto.randomUUID(),
						sourceKey,
						identityOverlayTransform(),
						'Add overlay'
					);
				}
			} else {
				// mrDNA: session-only, no persistence.
				addOverlayInstance({
					id: crypto.randomUUID(),
					sourceKey: '',
					data,
					transform: identityOverlayTransform(),
					ghost: false,
					visible: true,
				});
			}

			view3DToolbarController.show3DOverlays = true;
			const description =
				data.format === 'pdb'
					? `${data.stats.chainCount} chains, ${data.stats.residueCount} residues`
					: `${data.stats.nucleotideCount} nts, ${data.stats.strandCount} strands`;
			toast.success(`${isPdb ? 'PDB' : 'mrDNA'} overlay loaded`, { description });
		} catch (err) {
			const description =
				err instanceof MrdnaOverlayParseError ||
				err instanceof PdbOverlayParseError ||
				err instanceof Error
					? err.message
					: 'Could not parse the selected file.';
			toast.error('Could not load overlay', { description });
		}
	}

	function onDuplicateOverlay(id: string): void {
		const src = findOverlay(id);
		if (!src) return;
		const newId = crypto.randomUUID();
		const transform = cloneOverlayTransform(src.transform);
		transform.position.x += DUPLICATE_OFFSET_NM; // nudge so the copy is visible
		if (src.sourceKey) {
			// PDB: persist; the reconcile effect creates the live copy.
			setOverlayPlacementCmd(
				editorViewContext.historyStack,
				part,
				newId,
				src.sourceKey,
				transform,
				'Duplicate overlay'
			);
		} else {
			// mrDNA: session-only.
			addOverlayInstance({
				id: newId,
				sourceKey: '',
				data: src.data,
				transform,
				ghost: src.ghost,
				visible: true,
			});
		}
		view3DToolbarController.activeOverlayId = newId; // ready to move
	}

	function onClearOverlay(id: string): void {
		const inst = findOverlay(id);
		if (view3DToolbarController.activeOverlayId === id) {
			view3DToolbarController.activeOverlayId = null;
		}
		if (inst?.sourceKey) {
			// PDB: remove the placement; the reconcile effect drops the live copy.
			clearOverlayPlacementCmd(editorViewContext.historyStack, part, id, 'Remove overlay');
		} else {
			// mrDNA: session-only.
			view3DToolbarController.overlays = view3DToolbarController.overlays.filter(
				(o) => o.id !== id
			);
		}
	}

	function onToggleOverlayGhost(id: string): void {
		const inst = findOverlay(id);
		if (inst) inst.ghost = !inst.ghost;
	}

	function onToggleOverlayVisible(id: string): void {
		const inst = findOverlay(id);
		if (inst) inst.visible = !inst.visible;
	}

	function onToggleOverlayPlacement(id: string): void {
		view3DToolbarController.activeOverlayId =
			view3DToolbarController.activeOverlayId === id ? null : id;
	}

	function onResetOverlayPlacement(id: string): void {
		const inst = findOverlay(id);
		if (!inst) return;
		inst.transform = identityOverlayTransform();
		if (inst.sourceKey) {
			setOverlayPlacementCmd(
				editorViewContext.historyStack,
				part,
				id,
				inst.sourceKey,
				inst.transform,
				'Reset overlay placement'
			);
		}
	}

	function onFrameOverlay(id: string): void {
		view3DFrameOverlayFn?.(id);
	}

	let lockedSegments = $state<SvelteSet<OligoSegment> | null>(null);

	let liveFocusedSegments = $derived.by(() => {
		const segSet = new SvelteSet<OligoSegment>();
		const selectedEnds = editorViewContext.strandViewContext.selected.ends;
		for (const end of selectedEnds) {
			const segment = end.segment;
			if (!selectedEnds.has(segment.fivePrime) || !selectedEnds.has(segment.threePrime)) continue;
			segSet.add(segment);
		}
		return segSet.size > 0 ? segSet : null;
	});

	// Derive the set of segments that are currently selected
	let liveFilteredSegments = $derived.by(() => {
		if (!view3DToolbarController.selectionMode) return null;
		const segSet = new SvelteSet<OligoSegment>();
		for (const end of editorViewContext.strandViewContext.selected.ends) {
			segSet.add(end.segment);
		}
		return segSet;
	});

	// Final filter: null (show all), live set, or locked snapshot
	let filterSegments = $derived(
		!view3DToolbarController.selectionMode
			? null
			: view3DToolbarController.lockSelection
				? lockedSegments
				: liveFilteredSegments
	);

	function onToggleLock() {
		view3DToolbarController.lockSelection = !view3DToolbarController.lockSelection;
		if (view3DToolbarController.lockSelection) {
			lockedSegments = liveFilteredSegments
				? new SvelteSet<OligoSegment>(liveFilteredSegments)
				: new SvelteSet<OligoSegment>();
		}
	}

	onMount(() => {
		editorViewContext.registerHelixToolbarController(helixToolbarController);
		editorViewContext.registerView3DToolbarController(view3DToolbarController);
		return () => {
			editorViewContext.registerHelixToolbarController(null);
			editorViewContext.registerView3DToolbarController(null);
		};
	});

	$effect(() => {
		helixToolbarController.stage = stageRef;
		view3DToolbarController.onSimulate = view3DSimulateFn;
		view3DToolbarController.onResetCamera = view3DResetCameraFn;
		view3DToolbarController.onFrameActivePlane = view3DFrameActivePlaneFn;
		view3DToolbarController.onClearRelaxed = view3DClearRelaxedFn;
		view3DToolbarController.onDownload = view3DDownloadFn;
		view3DToolbarController.onExportGlb = view3DExportGlbFn;
		view3DToolbarController.onExportOxDna = view3DExportOxDnaFn;
		view3DToolbarController.onExportMrdna = view3DExportMrdnaFn;
	});

	// selectedPlaneId follows the active region. Writing without reading the
	// controller's current value keeps this effect single-direction (active
	// region → controller); View3D may still set selectedPlaneId for regionless
	// planes via $bindable, and that won't get clobbered here unless the
	// active region itself changes.
	$effect(() => {
		view3DToolbarController.selectedPlaneId = editorViewContext.activeRegion?.planeId ?? null;
	});

	let view3DSimulateFn = $state<(() => void) | undefined>(undefined);
	let view3DResetCameraFn = $state<(() => void) | undefined>(undefined);
	let view3DFrameActivePlaneFn = $state<(() => void) | undefined>(undefined);
	let view3DClearRelaxedFn = $state<(() => void) | undefined>(undefined);
	let view3DDownloadFn = $state<(() => void) | undefined>(undefined);
	let view3DExportGlbFn = $state<(() => void) | undefined>(undefined);
	let view3DExportOxDnaFn = $state<((opts?: { includeMirrors?: boolean }) => void) | undefined>(
		undefined
	);
	let view3DExportMrdnaFn = $state<((opts?: { includeMirrors?: boolean }) => void) | undefined>(
		undefined
	);
	let view3DFrameOverlayFn = $state<((id: string) => void) | undefined>(undefined);
</script>

<div
	class="m-2 flex h-full flex-col overflow-hidden"
	{@attach help(
		show3D
			? {
					area: true,
					title: '3D view',
					text: 'Drag to orbit, scroll to zoom. Planes, simulation and export live in the toolbar above.',
					doc: 'views',
				}
			: {
					area: true,
					title: 'Plane view',
					text: 'Where the helices of the active region sit. Add helices here in Draw mode; each one gets a row in the strand viewer.',
					doc: 'views',
				}
	)}
	onpointerdown={() => editorViewContext.activateHelixPane()}
	onfocusin={() => editorViewContext.activateHelixPane()}
>
	{#if show3D}
		<div class="min-h-0 flex-1">
			<View3D
				{part}
				showVH={view3DToolbarController.showVH}
				showNtModel={view3DToolbarController.showNtModel}
				onNtModelError={() => (view3DToolbarController.showNtModel = false)}
				showCursor={view3DToolbarController.showCursor}
				{csCursorIdx}
				{highlightContext}
				{hideContext}
				{filterSegments}
				focusedSegments={liveFocusedSegments}
				solverParams={view3DToolbarController.solverParams}
				bind:useRelaxedPositions={view3DToolbarController.useRelaxedPositions}
				bind:hasRelaxedPositions={view3DToolbarController.hasRelaxedPositions}
				bind:isSimStale={view3DToolbarController.isSimStale}
				bind:showStress={view3DToolbarController.showStress}
				bind:simRunning={view3DToolbarController.simRunning}
				bind:simDiagnostics={view3DToolbarController.simDiagnostics}
				bind:simulateFn={view3DSimulateFn}
				bind:resetCameraFn={view3DResetCameraFn}
				bind:frameActivePlaneFn={view3DFrameActivePlaneFn}
				bind:clearRelaxedFn={view3DClearRelaxedFn}
				bind:downloadFn={view3DDownloadFn}
				bind:exportGlbFn={view3DExportGlbFn}
				bind:exportOxDnaFn={view3DExportOxDnaFn}
				bind:exportMrdnaFn={view3DExportMrdnaFn}
				bind:frameOverlayFn={view3DFrameOverlayFn}
				showDesign={view3DToolbarController.showDesign}
				showCoordinateAxis={view3DToolbarController.showCoordinateAxis}
				showPlanes={view3DToolbarController.showPlanes}
				show3DOverlays={view3DToolbarController.show3DOverlays}
				overlays={view3DToolbarController.overlays}
				bind:activeOverlayId={view3DToolbarController.activeOverlayId}
				bind:selectedPlaneId={view3DToolbarController.selectedPlaneId}
				bind:gizmoMode={view3DToolbarController.gizmoMode}
				showStats={view3DToolbarController.showStats}
			/>
		</div>
	{/if}

	{#if !show3D}
		<HelixView {part} focusedSegments={liveFocusedSegments} bind:stageRef />
	{/if}
</div>
