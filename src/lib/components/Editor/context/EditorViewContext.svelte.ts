import { collectDesignIssues, type DesignCheckSelection } from '$lib/model/checks/collect';
import type { DesignIssue } from '$lib/model/checks/designIssue';
import { designCheckPrompt } from '../designCheckPrompt.svelte';
import { checkPartIntegrity } from '$lib/model/checks/integrity';
import { notifyDesignIssues } from './documentRecovery';
import type { CadnanoLattice } from '$lib/model/io/cadnanoLattice';
import { createContext, untrack } from 'svelte';
import type { Stage } from 'svelte-konva';
import { SvelteSet } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';

import type { Category, EditorMode, LeafTarget } from '$lib/canvasEditor/core/modes';
import { PluginCoordinator } from '$lib/plugin/PluginCoordinator.svelte';
import { PluginRegistry } from '$lib/plugin/PluginRegistry.svelte';
import { PluginInstallGate } from '../Plugin/PluginInstallGate.svelte';
import { PluginDevMode } from '$lib/plugin/PluginDevMode.svelte';
import { LinkedPluginReviewGate } from '../Plugin/LinkedPluginReviewGate.svelte';
import type { SegmentEnd, OligoSegment } from '$lib/model/Oligo';
import type Oligo from '$lib/model/Oligo';
import type { Part } from '$lib/model/Part';
import type { DuplicateCheck } from '$lib/model/Part/Part.svelte';
import {
	type DesignRegion,
	type RegionKind,
	FreeformRegion,
	HoneycombRegion,
	SquareRegion,
} from '$lib/model/Part/DesignRegion';
import { Plane } from '$lib/model/Part/Plane.svelte';
import type { SolverParams } from '$lib/model/rbs/rbsTypes';
import type { GizmoMode } from '../View3D/transformGizmo';
import type { OverlayInstance } from '../View3D/overlayInstance';
import { addPlaneCmd, removePlaneCmd } from '$lib/commands/planes';
import { addRegionAndPlaneCmd } from '$lib/commands/regions';
import { BUILTIN_MODIFICATIONS } from '$lib/model/modifications';
import FoldnanoDocument from '$lib/model/document.svelte';
import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import type {
	CanHide,
	CanHighlight,
	CanWarn,
	ColorContext,
	ContextMenuInfo,
	ModificationContext,
	SelectAllMode,
	SelectionToggle,
	SequenceContext,
	SkipInsertContext,
	TemporalPartInfo,
} from './types';
import { EditorDocumentSession } from './EditorDocumentSession.svelte';
import type { StorageManager } from '$lib/services/storage';
import type { SidePanelId } from '../sidePanels';

export type ActiveViewer = 'STRAND' | 'HELIX' | 'VIEW3D';

/** Placement state of an in-progress Duplicate (DUPLICATE mode). `anchorBp` is the pointer bp
 * at which `baseDelta` was last pinned; null until the pointer next moves. `linked` places
 * mirror copies: a new repeat group, or another instance of `groupId`. */
export interface DuplicateState {
	oligos: Oligo[];
	linked: boolean;
	groupId: string | null;
	snapStep: number;
	anchorBp: number | null;
	baseDelta: number;
	delta: number;
	check: DuplicateCheck;
}

export interface StrandToolbarController {
	part: Part;
	stage: Stage | undefined;
	updateViewportBounds: () => void;
	updateViewportScale: () => void;
	/** Shifts the view by screen pixels; positive dx/dy moves the content right/down. */
	panBy: (dx: number, dy: number) => void;
	/** Centers the view on a helix's base, expanding its region if collapsed; false if not shown. */
	centerOn: (vhId: string, bp: number) => boolean;
}

export interface HelixToolbarController {
	stage: Stage | undefined;
}

export interface View3DToolbarDiagnostics {
	maxConstraintError: number;
	rmsConstraintError: number;
	maxOverlap: number;
	blockCount: number;
	constraintCount: number;
}

export interface View3DToolbarController {
	showVH: boolean;
	showNtModel: boolean;
	showCursor: boolean;
	selectionMode: boolean;
	lockSelection: boolean;
	useRelaxedPositions: boolean;
	hasRelaxedPositions: boolean;
	isSimStale: boolean;
	showStress: boolean;
	simRunning: boolean;
	simDiagnostics: View3DToolbarDiagnostics | null;
	solverParams: SolverParams;
	showDesign: boolean;
	showCoordinateAxis: boolean;
	showPlanes: boolean;
	show3DOverlays: boolean;
	overlays: OverlayInstance[];
	activeOverlayId: string | null;
	selectedPlaneId: string | null;
	gizmoMode: GizmoMode;
	showStats: boolean;
	planeSelectionMode: boolean;
	pendingBasePlane: 'XY' | 'XZ' | 'YZ';
	pendingRegionKind: RegionKind | null;
	toolPanelMode: 'inspector' | 'overlays';
	onToggleLock: () => void;
	onResetCamera?: () => void;
	onFrameActivePlane?: () => void;
	onSimulate?: () => void;
	onClearRelaxed?: () => void;
	onDownload?: () => void;
	onExportGlb?: () => void;
	onExportOxDna?: (opts?: { includeMirrors?: boolean }) => void;
	onExportMrdna?: (opts?: { includeMirrors?: boolean }) => void;
	onLoadOverlay?: (file: File) => Promise<void>;
	onDuplicateOverlay?: (id: string) => void;
	onClearOverlay?: (id: string) => void;
	onFrameOverlay?: (id: string) => void;
	onToggleOverlayPlacement?: (id: string) => void;
	onResetOverlayPlacement?: (id: string) => void;
	onToggleOverlayGhost?: (id: string) => void;
	onToggleOverlayVisible?: (id: string) => void;
	onSelectBasePlane?: (plane: 'XY' | 'XZ' | 'YZ') => void;
	onAddPlane?: () => void;
	onRemovePlane?: () => void;
	onToggleShowVH?: () => void;
	onToggleCursor?: () => void;
	onTogglePlanes?: () => void;
	onToggleNtModel?: () => void;
}

/** Mirror oligos can't be edited on their own, so selecting any part of one selects its
 * whole original instead. */
function redirectMirrorEnds(ends: SegmentEnd[]): SegmentEnd[] {
	if (!ends.some((end) => end.segment?.oligo?.isMirror)) return ends;
	return ends.flatMap((end) => {
		const tag = end.segment?.oligo?.mirrorOf;
		if (!tag) return [end];
		const source = end.inPart.getOligoById(tag.sourceOligoId);
		return source ? [...source.allEnds] : [];
	});
}

class EndSelection {
	ends: SvelteSet<SegmentEnd> = $state(new SvelteSet());

	set(newEnds: SegmentEnd[]) {
		this.ends.clear();
		redirectMirrorEnds(newEnds).forEach((end) => this.ends.add(end));
	}

	add(ends: SegmentEnd[]) {
		redirectMirrorEnds(ends).forEach((end) => this.ends.add(end));
	}

	remove(ends: SegmentEnd[]) {
		ends.forEach((end) => this.ends.delete(end));
	}

	clear() {
		this.ends.clear();
	}

	includesAll(ends: SegmentEnd[]): boolean {
		for (const end of ends) {
			if (!this.ends.has(end)) return false;
		}
		return true;
	}
}

export { type EndSelection };

const fromToggleToLeafTarget = (toggles: SelectionToggle[]): Set<LeafTarget | Category> => {
	const withAlwaysOn = [...toggles, 'EMPTY', 'VH', 'VH_TAG', 'VH_GRID', 'CS_CURSOR', 'CONTROL'] as (
		LeafTarget | Category
	)[];
	return new Set<LeafTarget | Category>(withAlwaysOn);
};

const DEFAULT_DESIGN_CHECKS: DesignCheckSelection = {
	integrity: true,
	simulation: false,
	cadnano: false,
};

class StrandViewContext {
	selected: EndSelection = $state(new EndSelection());
	selectAllMode: SelectAllMode = $state('NONE');
	tempParts: TemporalPartInfo[] = $state([]);
	footnote: string = $state('nothing');
	hoverOligo: Oligo | null = $state(null);
	hoverSegment: OligoSegment | null = $state(null);

	colorContext: ColorContext = $state({
		currentColor: '#ff0000',
		savedColors: ['#ff0000', '#00ff00', '#0000ff'],
	});
	sequenceContext: SequenceContext = $state({
		mode: 'RANDOM',
		gcContent: 0.5,
		sequence: '',
		fillType: 'ONLY_EMPTY',
		fillResults: [],
	});
	modificationContext: ModificationContext = $state({
		currentModification: null,
		builtinModifications: [...BUILTIN_MODIFICATIONS],
	});
	skipInsertContext: SkipInsertContext = $state({
		applyToAllVh: false,
	});

	hideContext: Record<CanHide, boolean> = $state({
		crossovers: false,
		connections: false,
		sequence: false,
	});
	highlightContext: Record<CanHighlight, boolean> = $state({
		scaffold: false,
		circular_strand: false,
		// free_end: false,
		modification_site: false,
		longer_than_90: false,
		shorter_than_15: false,
	});
	warningContext: Record<CanWarn, boolean> = $state({
		mismatch: true,
	});
	/** Which design checks the issue overlay shows; editor rules on, export profiles opt-in. */
	designChecks: DesignCheckSelection = $state({ ...DEFAULT_DESIGN_CHECKS });
	selectionToggles: SelectionToggle[] = $state(['SCAF', 'STAP', 'END', 'XOVER', 'SEGMENT']);
	selectionFilter: Set<LeafTarget | Category> = $derived(
		fromToggleToLeafTarget(this.selectionToggles)
	);
	collapsedRegionIds: string[] = $state([]);
	showBlocks: boolean = $state(false);
	csCursorIdx: number = $state(0);
	activeCsRegionId: string | null = $state(null);
	splitPreviewState: {
		gapAfterVhId: string;
		regionId: string;
		newRegionName: string;
		gapDisplayRow: number;
	} | null = $state(null);
	// Raw: holds live Oligo instances, and every update replaces the whole object.
	duplicateState: DuplicateState | null = $state.raw(null);
	contextMenu: ContextMenuInfo = $state({
		x: 0,
		y: 0,
		targetId: '',
		targetKind: '',
		visible: false,
		items: [],
	});
	activeAround: { rowIdx: number; bpIdx: number } = $state({ rowIdx: -1, bpIdx: -1 });

	viewportBounds = $state({
		x: 0,
		y: 0,
		width: 1000,
		height: 800,
	});

	viewportScale: number = $state(1.0);
}

export interface SerializableStrandViewContext {
	colorContext: ColorContext;
	sequenceContext: SequenceContext;
	modificationContext: ModificationContext;
	hideContext: Record<CanHide, boolean>;
	highlightContext: Record<CanHighlight, boolean>;
	warningContext?: Record<CanWarn, boolean>;
	designChecks?: DesignCheckSelection;
	selectionToggles: SelectionToggle[];
	collapsedRegionIds: string[];
	csCursorIdx: number;
	activeCsRegionId: string | null;
}

export class EditorViewContext {
	strandViewContext: StrandViewContext = new StrandViewContext();
	selectedFreeformVhIndices: SvelteSet<number> = new SvelteSet();
	selectedLatticeVhIndices: SvelteSet<number> = new SvelteSet();
	otherFootnote: string = $state('');
	editorMode: EditorMode = $state('SELECT');
	activeViewer: ActiveViewer = $state('STRAND');
	show3D: boolean = $state(false);
	showShortcuts: boolean = $state(false);
	aboutDialogOpen: boolean = $state(false);
	showBackups: boolean = $state(false);
	showScaffoldMap: boolean = $state(false);
	showSidePanel: boolean = $state(false);
	sidePanelTab: SidePanelId = $state('GITHUB');
	/** Plugin ids whose code editor is in a pop-out window; their panel stays mounted off-tab. */
	poppedOutPluginPanels: SvelteSet<string> = new SvelteSet();
	/** Owned plugins whose editor panel has a sidebar icon; open editors stay mounted off-tab. */
	pluginEditorIds: SvelteSet<string> = new SvelteSet();
	newFileDialogOpen: boolean = $state(false);
	publishToGitHubDialogOpen: boolean = $state(false);
	activeGitHubTab: 'files' | 'changes' | 'graph' = $state('files');
	localOnlyEntriesVersion: number = $state(0);
	repoTreeVersion: number = $state(0);
	strandToolbarController: StrandToolbarController | null = $state(null);
	helixToolbarController: HelixToolbarController | null = $state(null);
	view3DToolbarController: View3DToolbarController | null = $state(null);
	planeSelectionMode: boolean = $state(false);
	pendingRegionKind: RegionKind | null = $state(null);
	pendingBasePlane: 'XY' | 'XZ' | 'YZ' = $state('XY');
	isAddingRegionToExistingPart: boolean = $state(false);
	activeRegionId: string | null = $state(null);
	footnote: string = $derived(`${this.otherFootnote} | ${this.strandViewContext.footnote}`);

	pluginRegistry: PluginRegistry = new PluginRegistry();
	session: EditorDocumentSession;
	pluginCoordinator: PluginCoordinator;
	pluginInstallGate: PluginInstallGate;
	pluginDevMode: PluginDevMode;
	linkedPluginReviewGate = new LinkedPluginReviewGate();

	constructor() {
		this.session = new EditorDocumentSession({
			resetEphemeralEditorState: () => this.#resetEphemeralEditorState(),
			clearStaleSelectionsAfterReplay: () => this.#clearStaleSelectionsAfterReplay(),
			repairActiveRegion: () => this.repairActiveRegion(),
			loadPersistedContext: () => this.loadContextFromLocalStorage(),
			savePersistedContext: () => this.saveContextToLocalStorage(),
		});
		this.pluginCoordinator = new PluginCoordinator(
			this.pluginRegistry,
			() => this.currentDoc,
			() => this.historyStack,
			() => this.activeRegion
		);
		this.pluginRegistry.setBusyCheck((id) => this.pluginCoordinator.isPluginBusyOrPending(id));
		this.pluginCoordinator.setEditGate(() => this.session.isTabOwner);
		this.pluginCoordinator.setCadnanoInputReviewer((pluginName, issues) =>
			designCheckPrompt.ask({
				title: `Run "${pluginName}" on this region?`,
				description:
					"This plugin works on cadnano JSON, which can't hold all of this region. If you apply its result, what cadnano drops is lost from the region.",
				proceedLabel: 'Run anyway',
				issues,
			})
		);
		this.pluginInstallGate = new PluginInstallGate(() => this.pluginRegistry);
		this.pluginDevMode = new PluginDevMode(this.pluginRegistry, () => this.pluginCoordinator);
		this.pluginCoordinator.setLinkedFolderReader((plugin) => this.pluginDevMode.readFolder(plugin));
		this.pluginDevMode.setReviewer((review) => this.linkedPluginReviewGate.request(review));
		// An unsaved draft brings its editor's icon back after a reload.
		void this.pluginRegistry.ready.then(() => {
			for (const plugin of this.pluginRegistry.all) {
				if (plugin.authoring && plugin.draftCode !== null && plugin.enabled) {
					this.pluginEditorIds.add(plugin.manifest.id);
				}
			}
		});
	}

	get currentDoc(): FoldnanoDocument {
		return this.session.currentDoc;
	}

	get storageManager(): StorageManager {
		return this.session.storageManager;
	}

	get historyStack() {
		return this.session.historyStack;
	}

	get isTabOwner(): boolean {
		return this.session.isTabOwner;
	}

	openSidePanel(tab: SidePanelId): void {
		this.sidePanelTab = tab;
		this.showSidePanel = true;
	}

	closeSidePanel(): void {
		this.showSidePanel = false;
	}

	setSidePanelTab(tab: SidePanelId): void {
		this.sidePanelTab = tab;
	}

	/** Opens an owned plugin's editor panel; other open editors keep theirs. */
	openPluginEditor(pluginId: string): void {
		this.pluginEditorIds.add(pluginId);
		this.openSidePanel(`plugin:${pluginId}` as const);
	}

	/** Removes the editor's sidebar icon; a stored draft is kept. */
	closePluginEditor(pluginId: string): void {
		this.pluginEditorIds.delete(pluginId);
		this.poppedOutPluginPanels.delete(pluginId);
		if (this.sidePanelTab === (`plugin:${pluginId}` as const)) this.sidePanelTab = 'PLUGIN';
	}

	toggleSidePanel(tab: SidePanelId): void {
		if (this.showSidePanel && this.sidePanelTab === tab) {
			this.closeSidePanel();
			return;
		}
		this.openSidePanel(tab);
	}

	/** Issues of the checks selected in `designChecks`, recomputed once per edit (not per drag frame). */
	designIssues: DesignIssue[] = $derived.by(() => {
		const { integrity, simulation, cadnano } = this.strandViewContext.designChecks;
		void this.historyStack.revision;
		const part = this.currentDoc.parts[0];
		const region = this.activeRegion;
		return untrack(() => collectDesignIssues(part, region, { integrity, simulation, cadnano }));
	});

	get activeRegion(): DesignRegion | null {
		const part = this.currentDoc.parts[0];
		if (!part || !this.activeRegionId) return null;
		return part.regions.find((region) => region.id === this.activeRegionId) ?? null;
	}

	get activePlane(): Plane | null {
		const region = this.activeRegion;
		const part = this.currentDoc.parts[0];
		if (!region || !part) return null;
		return part.getPlaneById(region.planeId);
	}

	setActiveRegion(regionId: string | null): void {
		if (this.activeRegionId === regionId) return;
		this.strandViewContext.selected.clear();
		this.clearSelectedFreeformVhs();
		this.clearSelectedLatticeVhs();
		this.activeRegionId = regionId;
	}

	repairActiveRegion(): void {
		const part = this.currentDoc.parts[0];
		if (!part || part.regions.length === 0) {
			this.setActiveRegion(null);
			return;
		}
		if (this.activeRegionId && part.regions.some((region) => region.id === this.activeRegionId)) {
			return;
		}
		this.setActiveRegion(part.getDefaultRegion()?.id ?? null);
	}

	setActiveViewer(viewer: ActiveViewer): void {
		this.activeViewer = viewer;
	}

	activateHelixPane(): void {
		this.activeViewer = this.show3D ? 'VIEW3D' : 'HELIX';
	}

	setShow3D(nextShow3D: boolean): void {
		this.show3D = nextShow3D;
		if (this.activeViewer === 'HELIX' || this.activeViewer === 'VIEW3D') {
			this.activeViewer = nextShow3D ? 'VIEW3D' : 'HELIX';
		}
	}

	registerStrandToolbarController(controller: StrandToolbarController | null): void {
		this.strandToolbarController = controller;
	}

	registerHelixToolbarController(controller: HelixToolbarController | null): void {
		this.helixToolbarController = controller;
	}

	registerView3DToolbarController(controller: View3DToolbarController | null): void {
		this.view3DToolbarController = controller;
		if (controller) {
			controller.onAddPlane = () => this.addPlaneBasedOnSelected();
			controller.onRemovePlane = () => this.removePlaneIfEmpty();
		}
	}

	#resetViewerChrome(): void {
		this.show3D = false;
		this.activeViewer = 'STRAND';
	}

	#resetEphemeralEditorState(): void {
		this.#clearStaleSelectionsAfterReplay();
		this.#resetViewerChrome();
	}

	// Undo/redo replay can leave selections pointing at deleted entities; clear them
	// without disturbing viewer chrome (show3D / activeViewer), which must survive history navigation.
	#clearStaleSelectionsAfterReplay(): void {
		this.strandViewContext.selected.clear();
		this.strandViewContext.duplicateState = null;
		if (this.editorMode === 'DUPLICATE') this.editorMode = 'SELECT';
		this.clearSelectedFreeformVhs();
		this.clearSelectedLatticeVhs();
	}

	setSelectedFreeformVhs(indices: Iterable<number>): void {
		this.selectedFreeformVhIndices.clear();
		for (const index of indices) this.selectedFreeformVhIndices.add(index);
	}

	addSelectedFreeformVhs(indices: Iterable<number>): void {
		for (const index of indices) this.selectedFreeformVhIndices.add(index);
	}

	toggleSelectedFreeformVh(index: number): void {
		if (this.selectedFreeformVhIndices.has(index)) {
			this.selectedFreeformVhIndices.delete(index);
		} else {
			this.selectedFreeformVhIndices.add(index);
		}
	}

	clearSelectedFreeformVhs(): void {
		this.selectedFreeformVhIndices.clear();
	}

	setSelectedLatticeVhs(indices: Iterable<number>): void {
		this.selectedLatticeVhIndices.clear();
		for (const index of indices) this.selectedLatticeVhIndices.add(index);
	}

	addSelectedLatticeVhs(indices: Iterable<number>): void {
		for (const index of indices) this.selectedLatticeVhIndices.add(index);
	}

	toggleSelectedLatticeVh(index: number): void {
		if (this.selectedLatticeVhIndices.has(index)) {
			this.selectedLatticeVhIndices.delete(index);
		} else {
			this.selectedLatticeVhIndices.add(index);
		}
	}

	clearSelectedLatticeVhs(): void {
		this.selectedLatticeVhIndices.clear();
	}

	enterPlaneSelectionMode(kind: RegionKind): void {
		if (this.currentDoc.parts.length === 0) {
			this.historyStack.tx(() => {
				this.currentDoc.addNewPart(kind);
			});
			this.isAddingRegionToExistingPart = false;
		} else {
			this.isAddingRegionToExistingPart = true;
		}
		this.pendingRegionKind = kind;
		this.pendingBasePlane = 'XY';
		this.planeSelectionMode = true;
		this.show3D = true;
		this.setActiveViewer('VIEW3D');
	}

	selectPendingBasePlane(plane: 'XY' | 'XZ' | 'YZ'): void {
		this.pendingBasePlane = plane;
		if (this.isAddingRegionToExistingPart) return;
		const part = this.currentDoc.parts[0];
		if (!part) return;
		part.setPlaneTransform(part.getDefaultPlane().id, BASIS_PLANE_TRANSFORMS[plane]);
	}

	cancelRegionCreation(): void {
		this.planeSelectionMode = false;
		this.pendingRegionKind = null;
		if (!this.isAddingRegionToExistingPart) {
			this.historyStack.undoOnce();
		}
		this.isAddingRegionToExistingPart = false;
	}

	loadCadnanoAsRegion(
		cadnano: CadnanoJSON,
		basePlane: 'XY' | 'XZ' | 'YZ',
		lattice?: CadnanoLattice
	): void {
		const transform = BASIS_PLANE_TRANSFORMS[basePlane];
		let loaded: { part: Part; regionId: string } | null = null;
		this.historyStack.snapshotTx('Load Cadnano as region', () => {
			let part = this.currentDoc.parts[0];
			if (!part) {
				part = cadnano.toPart({ lattice });
				this.currentDoc.parts.push(part);
				part.setPlaneTransform(part.getDefaultPlane().id, transform);
				this.setActiveRegion(part.getDefaultRegion().id);
				loaded = { part, regionId: part.getDefaultRegion().id };
			} else {
				const plane = new Plane(
					part.nextPlaneName(),
					undefined,
					{ ...transform.origin },
					{ ...transform.u },
					{ ...transform.v },
					{ ...transform.normal }
				);
				const region = cadnano.toRegionInPart(part, plane, { lattice });
				this.setActiveRegion(region.id);
				loaded = { part, regionId: region.id };
			}
		});
		if (loaded) {
			const { part, regionId } = loaded;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off scope, not state
			notifyDesignIssues(this.currentDoc.id, checkPartIntegrity(part, new Set([regionId])));
		}
		for (const w of cadnano.warnings) {
			toast.warning('Cadnano import warning', { description: w });
		}
	}

	confirmRegionCreation(): void {
		const part = this.currentDoc.parts[0];
		if (!part) return;

		if (this.isAddingRegionToExistingPart) {
			if (!this.pendingRegionKind) return;
			const transform = BASIS_PLANE_TRANSFORMS[this.pendingBasePlane];
			const plane = new Plane(
				part.nextPlaneName(),
				undefined,
				{ ...transform.origin },
				{ ...transform.u },
				{ ...transform.v },
				{ ...transform.normal }
			);
			const kind = this.pendingRegionKind;
			const name = part.nextRegionName(kind);
			const region =
				kind === 'SQUARE'
					? new SquareRegion(name, plane.id)
					: kind === 'FREEFORM'
						? new FreeformRegion(name, plane.id)
						: new HoneycombRegion(name, plane.id);
			addRegionAndPlaneCmd(this.historyStack, part, plane, region);
			this.setActiveRegion(region.id);
		} else {
			this.setActiveRegion(part.getDefaultRegion().id);
		}

		this.planeSelectionMode = false;
		this.pendingRegionKind = null;
		this.isAddingRegionToExistingPart = false;
		this.show3D = false;
		this.setActiveViewer('HELIX');
	}

	addPlaneBasedOnSelected(): void {
		const part = this.currentDoc.parts[0];
		if (!part) return;
		const ctrl = this.view3DToolbarController;
		const srcId = ctrl?.selectedPlaneId;
		const src = (srcId ? part.getPlaneById(srcId) : null) ?? part.getDefaultPlane();
		const newPlane = new Plane(
			part.nextPlaneName(),
			undefined,
			{ ...src.origin },
			{ ...src.u },
			{ ...src.v },
			{ ...src.normal }
		);
		addPlaneCmd(this.historyStack, part, newPlane);
		if (ctrl) {
			ctrl.showPlanes = true;
			ctrl.selectedPlaneId = newPlane.id;
		}
	}

	addPlaneFromAxisPlane(axisPlane: 'xy' | 'xz' | 'yz'): void {
		const part = this.currentDoc.parts[0];
		if (!part) return;
		const ctrl = this.view3DToolbarController;
		const key = axisPlane.toUpperCase() as 'XY' | 'XZ' | 'YZ';
		const transform = BASIS_PLANE_TRANSFORMS[key];
		const newPlane = new Plane(
			part.nextPlaneName(),
			undefined,
			{ ...transform.origin },
			{ ...transform.u },
			{ ...transform.v },
			{ ...transform.normal }
		);
		addPlaneCmd(this.historyStack, part, newPlane);
		if (ctrl) {
			ctrl.showPlanes = true;
			ctrl.selectedPlaneId = newPlane.id;
		}
	}

	removePlaneIfEmpty(): void {
		const part = this.currentDoc.parts[0];
		if (!part) return;
		const ctrl = this.view3DToolbarController;
		const planeId = ctrl?.selectedPlaneId;
		if (!planeId) return;
		const plane = part.getPlaneById(planeId);
		if (!plane) return;
		if (part.regions.some((region) => region.planeId === planeId)) {
			toast.error('Cannot remove a plane that has regions attached to it.');
			return;
		}
		if (part.planes.length <= 1) {
			toast.error('Cannot remove the only plane in the part.');
			return;
		}
		removePlaneCmd(this.historyStack, part, plane);
		if (ctrl) ctrl.selectedPlaneId = null;
	}

	private getSerializableContext(): SerializableStrandViewContext {
		return {
			colorContext: this.strandViewContext.colorContext,
			sequenceContext: this.strandViewContext.sequenceContext,
			modificationContext: this.strandViewContext.modificationContext,
			hideContext: this.strandViewContext.hideContext,
			highlightContext: this.strandViewContext.highlightContext,
			warningContext: this.strandViewContext.warningContext,
			designChecks: this.strandViewContext.designChecks,
			selectionToggles: this.strandViewContext.selectionToggles,
			collapsedRegionIds: this.strandViewContext.collapsedRegionIds,
			csCursorIdx: this.strandViewContext.csCursorIdx,
			activeCsRegionId: this.strandViewContext.activeCsRegionId,
		};
	}

	private applySerializedContext(data: SerializableStrandViewContext): void {
		this.strandViewContext.colorContext = data.colorContext;
		this.strandViewContext.sequenceContext = data.sequenceContext;
		if (data.modificationContext) {
			this.strandViewContext.modificationContext = {
				currentModification: data.modificationContext.currentModification,
				builtinModifications: [...BUILTIN_MODIFICATIONS],
			};
		}
		this.strandViewContext.hideContext = data.hideContext;
		this.strandViewContext.highlightContext = data.highlightContext;
		this.strandViewContext.warningContext = data.warningContext ?? { mismatch: true };
		this.strandViewContext.designChecks = { ...DEFAULT_DESIGN_CHECKS, ...data.designChecks };
		this.strandViewContext.selectionToggles = data.selectionToggles;
		this.strandViewContext.collapsedRegionIds = data.collapsedRegionIds ?? [];
		this.strandViewContext.csCursorIdx = data.csCursorIdx;
		this.strandViewContext.activeCsRegionId = data.activeCsRegionId ?? null;
	}

	async saveContextToLocalStorage(): Promise<boolean> {
		try {
			return await this.storageManager.saveContext(
				this.currentDoc.id,
				this.getSerializableContext()
			);
		} catch (e) {
			console.error('[EditorViewContext] Failed to save context:', e);
			return false;
		}
	}

	async loadContextFromLocalStorage(): Promise<boolean> {
		try {
			const data = await this.storageManager.loadContext(this.currentDoc.id);
			if (!data) return false;
			this.applySerializedContext(data as SerializableStrandViewContext);
			return true;
		} catch (e) {
			console.error('[EditorViewContext] Failed to load context:', e);
			return false;
		}
	}

	destroy(): void {
		this.session.destroy();
		this.pluginCoordinator.pendingApply = null;
		this.pluginCoordinator.terminate();
	}
}

type PlaneVec3 = { x: number; y: number; z: number };
type PlaneTransformDef = { origin: PlaneVec3; u: PlaneVec3; v: PlaneVec3; normal: PlaneVec3 };

// Every basis must be right-handed (u × v = normal; `isRightHandedBasis`): a mirrored plane
// reverses the helix twist in 3D and export relative to the 2D layout.
export const BASIS_PLANE_TRANSFORMS: Record<'XY' | 'XZ' | 'YZ', PlaneTransformDef> = {
	XY: {
		origin: { x: 0, y: 0, z: 0 },
		u: { x: 1, y: 0, z: 0 },
		v: { x: 0, y: 1, z: 0 },
		normal: { x: 0, y: 0, z: 1 },
	},
	XZ: {
		origin: { x: 0, y: 0, z: 0 },
		u: { x: 1, y: 0, z: 0 },
		v: { x: 0, y: 0, z: -1 },
		normal: { x: 0, y: 1, z: 0 },
	},
	YZ: {
		origin: { x: 0, y: 0, z: 0 },
		u: { x: 0, y: 1, z: 0 },
		v: { x: 0, y: 0, z: 1 },
		normal: { x: 1, y: 0, z: 0 },
	},
};

export const [getEditorViewContext, setEditorViewContext] = createContext<EditorViewContext>();
