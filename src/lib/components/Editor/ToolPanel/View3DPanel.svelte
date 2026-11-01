<script lang="ts">
	import { Eye, EyeOff, Layers, Move3d, Plus, Rotate3d, Trash2 } from '@lucide/svelte/icons';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import type { Part } from '$lib/model/Part';
	import { getPlaneColor, planeColorAsCss } from '$lib/model/Part/planeColors';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	type Props = {
		part: Part;
	};

	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	let view3DToolbar = $derived(editorViewContext.view3DToolbarController);
	let selectedPlane = $derived.by(() => {
		const selectedPlaneId = view3DToolbar?.selectedPlaneId;
		return selectedPlaneId ? part.getPlaneById(selectedPlaneId) : null;
	});

	let canRemovePlane = $derived(
		selectedPlane !== null &&
			part.planes.length > 1 &&
			!part.regions.some((r) => r.planeId === selectedPlane?.id)
	);

	function formatVec3(vec: { x: number; y: number; z: number } | undefined, digits = 2): string {
		if (!vec) return '0, 0, 0';
		return `${vec.x.toFixed(digits)}, ${vec.y.toFixed(digits)}, ${vec.z.toFixed(digits)}`;
	}

	// Region names and helix membership are plain fields; every change comes with a history revision.
	let regionRows = $derived.by(() => {
		void editorViewContext.historyStack.revision;
		void part.virtualHelices.length;
		return part.regions.map((region) => ({
			id: region.id,
			name: region.name,
			vhCount: part.virtualHelices.filter((vh) => part.getRegionForVh(vh).id === region.id).length,
			color: planeColorAsCss(
				getPlaneColor(part.planes.findIndex((plane) => plane.id === region.planeId))
			),
		}));
	});
</script>

{#if !view3DToolbar}
	<div class="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
		3D panel is waiting for the active 3D view to register.
	</div>
{:else}
	<div class="flex flex-col gap-3 text-xs">
		<!-- Region visibility -->
		{#if regionRows.length >= 1}
			<div class="rounded-md border border-border p-2">
				<Label class="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">Regions</Label>
				<ul class="mt-1 flex flex-col gap-0.5">
					{#each regionRows as row (row.id)}
						{@const hidden = editorViewContext.hidden3DRegionIds.has(row.id)}
						<li class="flex items-center gap-2" class:text-muted-foreground={hidden}>
							<span class="size-2 shrink-0 rounded-full" style:background-color={row.color}></span>
							<span class="min-w-0 flex-1 truncate" title={row.name}>{row.name}</span>
							<span class="font-mono text-muted-foreground">{row.vhCount}</span>
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`${hidden ? 'Show' : 'Hide'} ${row.name} in 3D`}
								aria-pressed={hidden}
								title={hidden ? 'Show in 3D' : 'Hide in 3D'}
								onclick={() => editorViewContext.toggleRegionHiddenIn3D(row.id)}
							>
								{#if hidden}<EyeOff />{:else}<Eye />{/if}
							</Button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- Planes -->
		<div class="rounded-md border border-border p-2">
			<div class="flex items-center justify-between gap-2">
				<Label class="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">Planes</Label>
				<Button
					variant={view3DToolbar.showPlanes ? 'default' : 'outline'}
					size="sm"
					onclick={() => {
						view3DToolbar.showPlanes = !view3DToolbar.showPlanes;
					}}
				>
					<Layers />
					<span>{view3DToolbar.showPlanes ? 'Hide' : 'Show'}</span>
				</Button>
			</div>

			<!-- The gizmo only appears while planes are shown, so the editing controls go with them. -->
			{#if view3DToolbar.showPlanes}
				<Separator class="my-2" />
				<div class="flex items-start justify-between gap-3">
					{#if selectedPlane}
						<div class="min-w-0 space-y-1">
							<p class="font-medium text-foreground">{selectedPlane.name}</p>
							<p class="truncate font-mono text-muted-foreground">{selectedPlane.id}</p>
						</div>
					{:else}
						<p class="text-muted-foreground">Click a plane in the 3D view to select it.</p>
					{/if}

					<ToggleGroup.Root
						type="single"
						variant="outline"
						size="sm"
						value={view3DToolbar.gizmoMode}
						onValueChange={(value) => {
							if (value === 'rotate' || value === 'translate') {
								view3DToolbar.gizmoMode = value;
							}
						}}
					>
						<ToggleGroup.Item value="rotate" title="Rotate selected plane">
							<Rotate3d />
						</ToggleGroup.Item>
						<ToggleGroup.Item value="translate" title="Move selected plane">
							<Move3d />
						</ToggleGroup.Item>
					</ToggleGroup.Root>
				</div>

				{#if selectedPlane}
					<div class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
						<span>Origin</span>
						<span class="font-mono text-foreground">{formatVec3(selectedPlane.origin)}</span>
						<span>Normal</span>
						<span class="font-mono text-foreground">{formatVec3(selectedPlane.normal)}</span>
					</div>
				{/if}

				<div class="mt-2 flex flex-col gap-1">
					<button
						class="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs transition-colors hover:bg-accent"
						onclick={() => view3DToolbar.onAddPlane?.()}
					>
						<Plus size={11} /> Add Plane
					</button>
					{#if canRemovePlane}
						<button
							class="flex w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
							onclick={() => view3DToolbar.onRemovePlane?.()}
						>
							<Trash2 size={11} /> Remove Plane
						</button>
					{/if}
				</div>
			{/if}
		</div>

		{#if view3DToolbar.simDiagnostics}
			<div class="rounded-md border border-border p-2">
				<Label class="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
					Simulation Diagnostics
				</Label>
				<div class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
					<span>Blocks</span>
					<span class="font-mono text-foreground">{view3DToolbar.simDiagnostics.blockCount}</span>
					<span>Constraints</span>
					<span class="font-mono text-foreground"
						>{view3DToolbar.simDiagnostics.constraintCount}</span
					>
					<span>RMS Error</span>
					<span class="font-mono text-foreground"
						>{view3DToolbar.simDiagnostics.rmsConstraintError.toFixed(3)} nm</span
					>
					<span>Max Overlap</span>
					<span class="font-mono text-foreground"
						>{view3DToolbar.simDiagnostics.maxOverlap.toFixed(3)} nm</span
					>
				</div>
			</div>
		{/if}
	</div>
{/if}
