<script lang="ts">
	import { Box, ChartNetwork } from '@lucide/svelte/icons';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import HelixViewerTools from '../HelixView/HelixViewerTools.svelte';
	import StrandViewerTools from '../StrandView/StrandViewerTools.svelte';
	import View3DTools from '../View3D/View3DTools.svelte';
	import { help } from '$lib/components/help/help';

	const editorViewContext = getEditorViewContext();
	const session = getEditorDocumentSession();

	let activeViewer = $derived(editorViewContext.activeViewer);
	let strandToolbar = $derived(editorViewContext.strandToolbarController);
	let helixToolbar = $derived(editorViewContext.helixToolbarController);
	let view3DToolbar = $derived(editorViewContext.view3DToolbarController);
	let hasPart = $derived(Boolean(session.currentDoc.parts[0]));
	let helixPaneActive = $derived(activeViewer === 'HELIX' || activeViewer === 'VIEW3D');

	let activeLabel = $derived.by(() => {
		switch (activeViewer) {
			case 'HELIX':
				return 'HelixView';
			case 'VIEW3D':
				return 'HelixView';
			default:
				return 'StrandView';
		}
	});
</script>

{#if hasPart}
	<div
		class="mr-2 ml-0 flex h-10 items-center gap-2 overflow-hidden rounded-md border border-border/80 bg-muted/25 px-2 py-1"
	>
		<div class="flex flex-none items-center gap-2 self-stretch">
			<Badge
				variant="secondary"
				class="shrink-0 px-1.5 py-0 text-[9px] tracking-[0.14em] uppercase"
			>
				{activeLabel}
			</Badge>

			{#if helixPaneActive}
				<ToggleGroup.Root
					type="single"
					variant="outline"
					size="sm"
					value={activeViewer}
					class="self-center"
					onValueChange={(value) => {
						if (value === 'HELIX' || value === 'VIEW3D') {
							editorViewContext.setShow3D(value === 'VIEW3D');
							editorViewContext.setActiveViewer(value);
						}
					}}
				>
					<ToggleGroup.Item
						value="HELIX"
						title="Show lattice view"
						{@attach help({
							title: 'Plane view',
							text: 'Place and move helices on the active region: a lattice grid, or free positions for freeform regions.',
							doc: 'views',
						})}
					>
						<ChartNetwork />
						<span>Plane</span>
					</ToggleGroup.Item>
					<ToggleGroup.Item
						value="VIEW3D"
						title="Show 3D view"
						{@attach help({
							title: '3D view',
							text: 'The whole part in lab coordinates. Move region planes, run the rigid-body simulation, and export.',
							doc: 'views',
						})}
					>
						<Box />
						<span>3D</span>
					</ToggleGroup.Item>
				</ToggleGroup.Root>

				<Separator.Root orientation="vertical" class="h-5 self-center" />
			{/if}
		</div>
		<div class="min-w-0 flex-1 overflow-hidden">
			{#if activeViewer === 'STRAND' && strandToolbar}
				<StrandViewerTools
					part={strandToolbar.part}
					stage={strandToolbar.stage}
					updateViewportBounds={strandToolbar.updateViewportBounds}
					updateViewportScale={strandToolbar.updateViewportScale}
				/>
			{:else if activeViewer === 'HELIX' && helixToolbar}
				<div class="flex h-full items-center">
					<HelixViewerTools stage={helixToolbar.stage} />
				</div>
			{:else if activeViewer === 'VIEW3D' && view3DToolbar}
				<View3DTools
					bind:showVH={view3DToolbar.showVH}
					bind:showNtModel={view3DToolbar.showNtModel}
					bind:showCursor={view3DToolbar.showCursor}
					bind:selectionMode={view3DToolbar.selectionMode}
					bind:useRelaxedPositions={view3DToolbar.useRelaxedPositions}
					bind:showStress={view3DToolbar.showStress}
					bind:solverParams={view3DToolbar.solverParams}
					bind:showCoordinateAxis={view3DToolbar.showCoordinateAxis}
					bind:showPlanes={view3DToolbar.showPlanes}
					bind:gizmoMode={view3DToolbar.gizmoMode}
					bind:toolPanelMode={view3DToolbar.toolPanelMode}
					bind:showStats={view3DToolbar.showStats}
					selectedPlaneId={view3DToolbar.selectedPlaneId}
					lockSelection={view3DToolbar.lockSelection}
					hasRelaxedPositions={view3DToolbar.hasRelaxedPositions}
					isSimStale={view3DToolbar.isSimStale}
					simRunning={view3DToolbar.simRunning}
					simDiagnostics={view3DToolbar.simDiagnostics}
					onToggleLock={view3DToolbar.onToggleLock}
					onResetCamera={view3DToolbar.onResetCamera}
					onSimulate={view3DToolbar.onSimulate}
					onClearRelaxed={view3DToolbar.onClearRelaxed}
					onDownload={view3DToolbar.onDownload}
					onExportGlb={view3DToolbar.onExportGlb}
					onExportOxDna={view3DToolbar.onExportOxDna}
					onExportMrdna={view3DToolbar.onExportMrdna}
				/>
			{:else}
				<div class="flex min-h-8 items-center px-2 text-sm text-muted-foreground">
					Viewer tools are loading.
				</div>
			{/if}
		</div>
	</div>
{/if}
