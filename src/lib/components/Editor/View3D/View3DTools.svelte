<script lang="ts">
	import {
		Shrink,
		Crosshair,
		Lock,
		ImageDown,
		FileAxis3d,
		FileDown,
		ListFilterPlus,
		Atom,
		Play,
		RotateCcw,
		SlidersHorizontal,
		Eye,
		Activity,
		Layers,
		ChevronDown,
		Axis3d,
		CirclePile,
		Shapes,
		ChartBar,
	} from '@lucide/svelte/icons';
	import type { GizmoMode } from './transformGizmo';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { SolverParams } from '$lib/model/rbs/rbsTypes';
	import EditorModeToggleGroup from '../Toolbar/EditorModeToggleGroup.svelte';
	import {
		clampSolverParam,
		getView3DToolbarState,
		type RbsDiagnostics,
	} from './view3DToolbarState';
	import { help } from '$lib/components/help/help';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	const editorCtx = getEditorViewContext();
	const hasMirrors = $derived(
		[...(editorCtx.currentDoc?.parts[0]?.oligos ?? [])].some((o) => o.isMirror)
	);
	let includeMirrors = $state(false);

	interface Props {
		showVH: boolean;
		showNtModel: boolean;
		showCursor: boolean;
		selectionMode: boolean;
		lockSelection: boolean;
		useRelaxedPositions: boolean;
		hasRelaxedPositions: boolean;
		isSimStale?: boolean;
		showStress: boolean;
		simRunning: boolean;
		simDiagnostics?: RbsDiagnostics | null;
		solverParams: SolverParams;
		showCoordinateAxis: boolean;
		showPlanes: boolean;
		toolPanelMode: 'inspector' | 'overlays';
		selectedPlaneId?: string | null;
		gizmoMode: GizmoMode;
		showStats: boolean;
		onToggleLock: () => void;
		onResetCamera?: () => void;
		onSimulate?: () => void;
		onClearRelaxed?: () => void;
		onDownload?: () => void;
		onExportGlb?: () => void;
		onExportOxDna?: (opts?: { includeMirrors?: boolean }) => void;
		onExportMrdna?: (opts?: { includeMirrors?: boolean }) => void;
	}

	let {
		showVH = $bindable(),
		showNtModel = $bindable(),
		showCursor = $bindable(),
		selectionMode = $bindable(),
		useRelaxedPositions = $bindable(),
		showStress = $bindable(),
		showCoordinateAxis = $bindable(),
		showPlanes = $bindable(),
		toolPanelMode = $bindable(),
		selectedPlaneId = null,
		gizmoMode = $bindable(),
		showStats = $bindable(),
		lockSelection,
		hasRelaxedPositions,
		isSimStale = false,
		simRunning,
		simDiagnostics = null,
		solverParams = $bindable(),
		onToggleLock,
		onResetCamera,
		onSimulate,
		onClearRelaxed,
		onDownload,
		onExportGlb,
		onExportOxDna,
		onExportMrdna,
	}: Props = $props();

	let showRbsParams = $state(false);

	let viewToggleValue = $derived<string[]>([
		...(showVH ? ['showVH'] : []),
		...(showNtModel ? ['showNtModel'] : []),
		...(showCursor ? ['showCursor'] : []),
		...(showCoordinateAxis ? ['showCoordinateAxis'] : []),
		...(showPlanes ? ['showPlanes'] : []),
	]);

	let selectionToggleValue = $derived<string[]>(selectionMode ? ['selectionMode'] : []);

	let simulationToggleValue = $derived<string[]>([
		...(useRelaxedPositions ? ['useRelaxedPositions'] : []),
		...(showStress ? ['showStress'] : []),
	]);

	let toolbarState = $derived(
		getView3DToolbarState({
			showNtModel,
			selectionMode,
			useRelaxedPositions,
			hasRelaxedPositions,
			isSimStale,
			showStress,
			simRunning,
			simDiagnostics,
			showPlanes,
			selectedPlaneId,
			showRbsParams,
		})
	);

	function onViewValueChange(value: string[]) {
		showVH = value.includes('showVH');
		showNtModel = value.includes('showNtModel');
		showCursor = showNtModel ? false : value.includes('showCursor');
		showCoordinateAxis = value.includes('showCoordinateAxis');
		showPlanes = value.includes('showPlanes');
	}

	function onSelectionValueChange(value: string[]) {
		selectionMode = value.includes('selectionMode');
	}

	function onSimulationValueChange(value: string[]) {
		useRelaxedPositions = hasRelaxedPositions && value.includes('useRelaxedPositions');
		showStress = hasRelaxedPositions && useRelaxedPositions && value.includes('showStress');
	}

	function updateSolverParam(key: keyof SolverParams, value: string) {
		const clamped = clampSolverParam(key, value);
		if (clamped === null) return;
		solverParams = { ...solverParams, [key]: clamped };
	}

	function toggleLockSelection() {
		if (!selectionMode) return;
		onToggleLock();
	}

	function toggleOverlayPanel() {
		toolPanelMode = toolPanelMode === 'overlays' ? 'inspector' : 'overlays';
	}
</script>

<div class="flex h-8 min-w-0 flex-1 items-center overflow-hidden">
	<div
		class="flex min-w-0 flex-1 scrollbar-none items-center gap-x-1 overflow-x-auto overflow-y-hidden px-2 [&::-webkit-scrollbar]:hidden"
	>
		<ButtonGroup.Root class="shrink-0">
			<Button
				variant="ghost"
				size="icon-sm"
				title="Reset camera to default 3D view"
				disabled={!onResetCamera}
				onclick={onResetCamera}
				{@attach help({ text: 'Bring the camera back to the default view of the whole part.' })}
			>
				<Shrink />
			</Button>
		</ButtonGroup.Root>

		<Separator.Root orientation="vertical" class="h-5" />

		<ButtonGroup.Root class="shrink-0">
			<Button
				variant={toolPanelMode === 'overlays' ? 'default' : 'outline'}
				size="sm"
				title={toolPanelMode === 'overlays' ? 'Show 3D inspector panel' : 'Show 3D overlays panel'}
				onclick={toggleOverlayPanel}
				{@attach help({
					title: '3D Overlay',
					text: 'Show a protein structure (PDB) or an mrDNA simulation result next to your design, to check fit or compare. Switches the tool panel to 3D Overlays.',
					doc: '3d-overlays',
				})}
			>
				<Shapes />
				<span>3D Overlay</span>
			</Button>
		</ButtonGroup.Root>

		<Separator.Root orientation="vertical" class="h-5" />

		<div class="flex shrink-0 items-center gap-1">
			<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
				>Mode</span
			>
			<EditorModeToggleGroup modes={['PAN', 'SELECT', 'DRAW']} />
		</div>

		<Separator.Root orientation="vertical" class="h-5" />

		<div class="flex shrink-0 items-center gap-1">
			<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
				>View</span
			>
			<ToggleGroup.Root
				type="multiple"
				variant="outline"
				size="sm"
				value={viewToggleValue}
				onValueChange={onViewValueChange}
			>
				<ToggleGroup.Item
					value="showVH"
					title={showVH ? 'Hide helix grid' : 'Show helix grid'}
					{@attach help({
						key: 'g',
						text: 'Show the empty lattice positions around your helices.',
					})}
				>
					<CirclePile />
				</ToggleGroup.Item>
				<ToggleGroup.Item
					value="showNtModel"
					title={showNtModel ? 'Hide NT model' : 'Show NT model'}
					{@attach help({ key: 'e', text: 'Show the nucleotide-level (NT) model of the design.' })}
				>
					<Atom />
				</ToggleGroup.Item>
				<ToggleGroup.Item
					disabled={toolbarState.cursorDisabled}
					value="showCursor"
					title={showCursor ? 'Hide cross-section cursor' : 'Show cross-section cursor'}
					{@attach help({
						key: 'c',
						text: "Mark the strand viewer's cross-section cursor position in 3D.",
					})}
				>
					<Crosshair />
				</ToggleGroup.Item>
				<ToggleGroup.Item
					value="showCoordinateAxis"
					title={showCoordinateAxis ? 'Hide coordinate axis' : 'Show coordinate axis'}
					{@attach help({ text: 'Show the lab-frame X, Y and Z axes.' })}
				>
					<Axis3d />
				</ToggleGroup.Item>
				<ToggleGroup.Item
					value="showPlanes"
					title={showPlanes ? 'Hide base planes' : 'Show base planes'}
					{@attach help({
						key: 'f',
						text: 'Show the planes regions sit on. Click one to move or rotate it with the gizmo.',
						newVsCadnano: true,
					})}
				>
					<Layers />
				</ToggleGroup.Item>
			</ToggleGroup.Root>
		</div>

		<Separator.Root orientation="vertical" class="h-5" />

		<div class="flex shrink-0 items-center gap-1">
			<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
				>Selection</span
			>
			<ToggleGroup.Root
				type="multiple"
				variant="outline"
				size="sm"
				value={selectionToggleValue}
				onValueChange={onSelectionValueChange}
			>
				<ToggleGroup.Item
					value="selectionMode"
					title={selectionMode ? 'Show all strands' : 'Show only selected strands'}
					{@attach help({
						title: 'Show only selected strands',
						text: 'Limit the 3D view to the strands selected in the strand viewer.',
						doc: 'views',
					})}
				>
					<ListFilterPlus />
				</ToggleGroup.Item>
			</ToggleGroup.Root>
			<Button
				variant="outline"
				size="icon-sm"
				class={lockSelection ? 'bg-muted text-foreground' : ''}
				title={lockSelection ? 'Unlock selection' : 'Lock current selection'}
				disabled={toolbarState.lockDisabled}
				onclick={toggleLockSelection}
				{@attach help({
					title: 'Lock selection filter',
					text: 'Freeze the 3D filter on the current selection, so you can keep selecting in the strand viewer without changing the 3D view. Available while only selected strands are shown.',
					doc: 'views',
				})}
			>
				<Lock />
			</Button>
		</div>

		<Separator.Root orientation="vertical" class="h-5" />

		<div class="flex shrink-0 items-center gap-1">
			<span
				class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
				title="Rigid-body simulation (relaxes the design)">RBS</span
			>
			<ButtonGroup.Root>
				<Button
					variant="outline"
					size="sm"
					class={toolbarState.staleRelaxed && !simRunning
						? 'border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300'
						: ''}
					title={toolbarState.simulateTitle}
					onclick={onSimulate}
					disabled={!onSimulate}
					{@attach help({
						title: 'Rigid-body simulation (RBS)',
						text: 'A quick relaxation preview: rigid blocks of the design are pulled together by their connections to show how strain bends it. Results are not saved; re-run after editing.',
						doc: 'simulation-export',
					})}
				>
					<Play />
					<span>{toolbarState.simulateLabel}</span>
				</Button>
				<ToggleGroup.Root
					type="multiple"
					variant="outline"
					size="sm"
					value={simulationToggleValue}
					onValueChange={onSimulationValueChange}
				>
					<ToggleGroup.Item
						value="useRelaxedPositions"
						title={useRelaxedPositions ? 'Show lattice layout' : 'Show relaxed layout'}
						disabled={toolbarState.relaxedDisabled}
						{@attach help({
							title: 'Relaxed layout',
							text: 'Switch between the lattice layout and the relaxed layout from the last RBS run. oxDNA export uses whichever is shown.',
						})}
					>
						<Eye />
					</ToggleGroup.Item>
					<ToggleGroup.Item
						value="showStress"
						title={showStress ? 'Hide crossover stress' : 'Show crossover stress'}
						disabled={toolbarState.stressDisabled}
						{@attach help({
							title: 'Crossover stress',
							text: 'Color crossovers by how much the relaxed layout strains them, to spot connections pulled out of place.',
						})}
					>
						<Activity />
					</ToggleGroup.Item>
				</ToggleGroup.Root>
				<Button
					variant="outline"
					size="icon-sm"
					title="Clear relaxed layout"
					onclick={onClearRelaxed}
					disabled={toolbarState.clearRelaxedDisabled}
					{@attach help({
						text: 'Discard the RBS result and go back to the lattice layout.',
					})}
				>
					<RotateCcw />
				</Button>
				<DropdownMenu.Root bind:open={showRbsParams}>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="outline"
								size="sm"
								class={toolbarState.paramsActive ? 'bg-muted text-foreground' : ''}
								title="Rigid-body simulation parameters"
								{@attach help({
									text: 'Solver settings: connection stiffness, repulsion between blocks, friction, number of steps, and collision passes.',
									doc: 'simulation-export',
								})}
							>
								<SlidersHorizontal />
								<span>Params</span>
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="start" class="w-64 p-3">
						<div class="space-y-3">
							<div
								class="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
							>
								RBS Parameters
							</div>
							<div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
								<label for="rbs-spring-k" class="text-muted-foreground">Spring k</label>
								<Input
									id="rbs-spring-k"
									class="h-7"
									type="number"
									min="0"
									max="1000"
									step="1"
									value={solverParams.springK}
									oninput={(e) => updateSolverParam('springK', e.currentTarget.value)}
								/>
								<label for="rbs-repulsion-k" class="text-muted-foreground">Repulsion C</label>
								<Input
									id="rbs-repulsion-k"
									class="h-7"
									type="number"
									min="0"
									max="10000"
									step="50"
									value={solverParams.repulsionK}
									oninput={(e) => updateSolverParam('repulsionK', e.currentTarget.value)}
								/>
								<label for="rbs-damping" class="text-muted-foreground">Friction</label>
								<Input
									id="rbs-damping"
									class="h-7"
									type="number"
									min="0"
									max="1"
									step="0.05"
									value={solverParams.damping}
									oninput={(e) => updateSolverParam('damping', e.currentTarget.value)}
								/>
								<label for="rbs-steps" class="text-muted-foreground">Steps</label>
								<Input
									id="rbs-steps"
									class="h-7"
									type="number"
									min="1"
									max="100000"
									step="100"
									value={solverParams.iterations}
									oninput={(e) => updateSolverParam('iterations', e.currentTarget.value)}
								/>
								<label for="rbs-collision-passes" class="text-muted-foreground">Collisions</label>
								<Input
									id="rbs-collision-passes"
									class="h-7"
									type="number"
									min="1"
									max="20"
									step="1"
									value={solverParams.collisionPasses}
									oninput={(e) => updateSolverParam('collisionPasses', e.currentTarget.value)}
								/>
							</div>
							{#if simDiagnostics}
								<div class="border-t border-border pt-2 text-xs text-muted-foreground">
									{simDiagnostics.blockCount} blocks · {simDiagnostics.constraintCount} constraints ·
									RMS
									{simDiagnostics.rmsConstraintError.toFixed(3)} nm
								</div>
							{/if}
						</div>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</ButtonGroup.Root>
		</div>

		<Separator.Root orientation="vertical" class="h-5" />

		<div class="flex shrink-0 items-center gap-1">
			<span class="px-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase"
				>Export</span
			>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							title="Export current 3D view"
							{@attach help({
								title: 'Export',
								text: 'Image (PNG), GLB for 3D tools, or oxDNA / mrDNA input files for full simulation.',
								doc: 'simulation-export',
							})}
						>
							<FileDown />
							<span>Export</span>
							<ChevronDown />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start">
					<DropdownMenu.Item onclick={onDownload} disabled={!onDownload}>
						<ImageDown />
						<span>Image</span>
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={onExportGlb} disabled={!onExportGlb}>
						<FileAxis3d />
						<span>GLB</span>
					</DropdownMenu.Item>
					<DropdownMenu.Item
						onclick={() => onExportOxDna?.({ includeMirrors })}
						disabled={!onExportOxDna}
					>
						<FileDown />
						<span>oxDNA</span>
					</DropdownMenu.Item>
					<DropdownMenu.Item
						onclick={() => onExportMrdna?.({ includeMirrors })}
						disabled={!onExportMrdna}
					>
						<FileDown />
						<span>mrDNA</span>
					</DropdownMenu.Item>
					{#if hasMirrors}
						<DropdownMenu.Separator />
						<DropdownMenu.CheckboxItem bind:checked={includeMirrors} closeOnSelect={false}>
							Include mirror copies (oxDNA / mrDNA)
						</DropdownMenu.CheckboxItem>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>

		<Separator.Root orientation="vertical" class="h-5" />

		<ButtonGroup.Root class="shrink-0">
			<Button
				variant={showStats ? 'default' : 'ghost'}
				size="icon-sm"
				title={showStats ? 'Hide performance stats' : 'Show performance stats'}
				onclick={() => (showStats = !showStats)}
				{@attach help({
					text: 'Frame rate and rendering statistics, useful when the 3D view feels slow.',
				})}
			>
				<ChartBar />
			</Button>
		</ButtonGroup.Root>

		<div class="ml-auto flex shrink-0 items-center justify-end gap-1 pl-2">
			{#each toolbarState.statusChips as chip (chip.kind)}
				<Badge
					variant={chip.kind === 'running' ? 'secondary' : 'outline'}
					class={`px-1.5 py-0 text-[10px] ${
						chip.kind === 'stale'
							? 'border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300'
							: ''
					}`}
					title={chip.label}
				>
					{chip.label}
				</Badge>
			{/each}
		</div>
	</div>
</div>
