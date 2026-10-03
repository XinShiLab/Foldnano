<script lang="ts">
	import { Box, Layers, Move3d, Plus, Rotate3d, Trash2 } from '@lucide/svelte/icons';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import type { Part } from '$lib/model/Part';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import type { RegionKind } from '$lib/model/Part/DesignRegion';

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

	function startAddRegion(kind: RegionKind) {
		editorViewContext.enterPlaneSelectionMode(kind);
	}
</script>

{#if !view3DToolbar}
	<div class="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
		3D panel is waiting for the active 3D view to register.
	</div>
{:else}
	<div class="flex flex-col gap-3 text-xs">
		<!-- Add Region -->
		{#if part.regions.length >= 1}
			<div class="rounded-md border border-border p-2">
				<Label class="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
					Add Region
				</Label>
				<p class="mt-1 mb-2 text-muted-foreground">
					Add a new design region on its own base plane.
				</p>
				<div class="flex gap-1">
					{#each ['HONEYCOMB', 'SQUARE', 'FREEFORM'] as const as kind (kind)}
						<button
							class="flex-1 rounded border border-border px-2 py-1 text-[11px] transition-colors hover:bg-accent"
							onclick={() => startAddRegion(kind)}
						>
							{kind === 'HONEYCOMB' ? 'Honeycomb' : kind === 'SQUARE' ? 'Square' : 'Freeform'}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Plane Overlay -->
		<div class="flex items-center justify-between gap-2 rounded-md border border-border p-2">
			<div class="space-y-1">
				<Label class="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
					Plane Overlay
				</Label>
				<p class="text-muted-foreground">
					{view3DToolbar.showPlanes ? 'Planes are visible in the 3D scene.' : 'Planes are hidden.'}
				</p>
			</div>
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

		{#if view3DToolbar.showPlanes}
			<button
				class="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs transition-colors hover:bg-accent"
				onclick={() => view3DToolbar.onAddPlane?.()}
			>
				<Plus size={11} /> Add Plane
			</button>
		{/if}

		<div class="rounded-md border border-border p-2">
			<div class="flex items-start justify-between gap-3">
				<div class="space-y-1">
					<Label class="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
						Selected Plane
					</Label>
					{#if selectedPlane}
						<div class="space-y-1">
							<p class="font-medium text-foreground">{selectedPlane.name}</p>
							<p class="font-mono text-muted-foreground">{selectedPlane.id}</p>
						</div>
					{:else}
						<div class="space-y-1 text-muted-foreground">
							<p>No plane selected.</p>
							<p>Enable planes, then click a plane in the 3D view.</p>
						</div>
					{/if}
				</div>

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
				<Separator class="my-2" />
				<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
					<span>Origin</span>
					<span class="font-mono text-foreground">{formatVec3(selectedPlane.origin)}</span>
					<span>Normal</span>
					<span class="font-mono text-foreground">{formatVec3(selectedPlane.normal)}</span>
				</div>
				{#if canRemovePlane}
					<Separator class="my-2" />
					<button
						class="flex w-full items-center justify-center gap-1.5 rounded-md border border-destructive/40 px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
						onclick={() => view3DToolbar.onRemovePlane?.()}
					>
						<Trash2 size={11} /> Remove Plane
					</button>
				{/if}
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

		<div class="rounded-md border border-dashed border-border p-2 text-muted-foreground">
			<div class="flex items-center gap-2 font-medium text-foreground">
				<Box size={14} />
				<span>3D workflow</span>
			</div>
			<p class="mt-1">
				Use the region buttons above to add honeycomb, square, or freeform regions to this part.
			</p>
		</div>
	</div>
{/if}
