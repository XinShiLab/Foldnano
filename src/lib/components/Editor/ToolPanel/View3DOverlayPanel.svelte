<script lang="ts">
	import {
		ChevronDown,
		ChevronRight,
		Copy,
		Eye,
		EyeOff,
		Ghost,
		LocateFixed,
		Move3d,
		RotateCcw,
		Rotate3d,
		Trash2,
		Upload,
	} from '@lucide/svelte/icons';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { FileDropZone } from '$lib/components/ui/file-drop-zone/index.js';
	import type { Part } from '$lib/model/Part';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { toast } from 'svelte-sonner';

	type Props = {
		part: Part;
	};

	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	let view3DToolbar = $derived(editorViewContext.view3DToolbarController);

	// Saved PDB placements whose file isn't currently loaded — re-drop to render.
	let pendingSources = $derived.by(() => {
		const loaded = new Set(view3DToolbar?.overlays.map((o) => o.sourceKey) ?? []);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const counts = new Map<string, number>();
		for (const p of part.overlayPlacements) {
			if (!p.sourceKey || loaded.has(p.sourceKey)) continue;
			counts.set(p.sourceKey, (counts.get(p.sourceKey) ?? 0) + 1);
		}
		return [...counts.entries()].map(([key, count]) => ({ key, count }));
	});

	async function loadOverlay(files: File[]): Promise<void> {
		const file = files[0];
		if (!file) return;
		await view3DToolbar?.onLoadOverlay?.(file);
	}
</script>

{#if !view3DToolbar}
	<div class="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
		3D overlay panel is waiting for the active 3D view to register.
	</div>
{:else}
	<div class="flex flex-col gap-2 text-xs">
		<!-- Main design -->
		<div class="flex items-center justify-between gap-2 rounded-md border border-border p-2">
			<div class="space-y-0.5">
				<p class="font-medium text-foreground">Main design</p>
				<p class="text-muted-foreground">
					{view3DToolbar.showDesign ? 'Visible' : 'Hidden'}
				</p>
			</div>
			<Button
				variant={view3DToolbar.showDesign ? 'default' : 'outline'}
				size="sm"
				onclick={() => {
					view3DToolbar.showDesign = !view3DToolbar.showDesign;
				}}
			>
				{#if view3DToolbar.showDesign}
					<Eye />
					<span>Hide</span>
				{:else}
					<EyeOff />
					<span>Show</span>
				{/if}
			</Button>
		</div>

		<!-- Loaded overlays -->
		{#if view3DToolbar.overlays.length > 0}
			<div class="flex items-center justify-between gap-2 rounded-md border border-border p-2">
				<div class="space-y-0.5">
					<p class="font-medium text-foreground">Overlays</p>
					<p class="text-muted-foreground">{view3DToolbar.overlays.length} loaded</p>
				</div>
				<Button
					variant={view3DToolbar.show3DOverlays ? 'default' : 'outline'}
					size="sm"
					title="Show or hide all overlays"
					onclick={() => {
						view3DToolbar.show3DOverlays = !view3DToolbar.show3DOverlays;
					}}
				>
					{#if view3DToolbar.show3DOverlays}
						<Eye />
						<span>Hide all</span>
					{:else}
						<EyeOff />
						<span>Show all</span>
					{/if}
				</Button>
			</div>
		{/if}

		<!-- One card per instance; only the selected (active) card expands its controls,
		     and the list scrolls so many copies don't overflow the floating panel. -->
		{#if view3DToolbar.overlays.length > 0}
			<div class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-0.5">
				{#each view3DToolbar.overlays as ov (ov.id)}
					{@const active = view3DToolbar.activeOverlayId === ov.id}
					<div class={'rounded-md border p-2 ' + (active ? 'border-primary' : 'border-border')}>
						<div class="flex items-center justify-between gap-2">
							<button
								type="button"
								class="flex min-w-0 flex-1 items-center gap-1 text-left"
								title={active ? 'Done editing' : 'Select to move / edit'}
								onclick={() => view3DToolbar.onToggleOverlayPlacement?.(ov.id)}
							>
								{#if active}
									<ChevronDown class="size-3 shrink-0 text-muted-foreground" />
								{:else}
									<ChevronRight class="size-3 shrink-0 text-muted-foreground" />
								{/if}
								<span class="truncate font-medium text-foreground">{ov.data.name}</span>
							</button>
							<Button
								variant={ov.visible ? 'default' : 'outline'}
								size="icon-sm"
								title={ov.visible ? 'Hide' : 'Show'}
								onclick={() => view3DToolbar.onToggleOverlayVisible?.(ov.id)}
							>
								{#if ov.visible}<Eye />{:else}<EyeOff />{/if}
							</Button>
						</div>

						{#if active}
							<Separator class="my-2" />
							<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
								{#if ov.data.format === 'pdb'}
									<span>Chains</span>
									<span class="font-mono text-foreground">{ov.data.stats.chainCount}</span>
									<span>Residues</span>
									<span class="font-mono text-foreground">{ov.data.stats.residueCount}</span>
								{:else}
									<span>NTs</span>
									<span class="font-mono text-foreground">{ov.data.stats.nucleotideCount}</span>
									<span>Strands</span>
									<span class="font-mono text-foreground">{ov.data.stats.strandCount}</span>
									<span>Stacks</span>
									<span class="font-mono text-foreground">{ov.data.stats.stackEdgeCount}</span>
								{/if}
							</div>
							<div class="mt-2 flex items-center justify-between gap-2">
								<span class="text-[11px] text-muted-foreground">Drag the gizmo to place</span>
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
									<ToggleGroup.Item value="rotate" title="Rotate overlay">
										<Rotate3d />
									</ToggleGroup.Item>
									<ToggleGroup.Item value="translate" title="Move overlay">
										<Move3d />
									</ToggleGroup.Item>
								</ToggleGroup.Root>
							</div>
							<div class="mt-2 flex gap-1">
								<Button
									variant={ov.ghost ? 'default' : 'outline'}
									size="sm"
									class="flex-1"
									title="Show semi-transparent and grey"
									onclick={() => view3DToolbar.onToggleOverlayGhost?.(ov.id)}
								>
									<Ghost />
									<span>Ghost</span>
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="flex-1"
									title="Place another copy"
									onclick={() => view3DToolbar.onDuplicateOverlay?.(ov.id)}
								>
									<Copy />
									<span>Duplicate</span>
								</Button>
							</div>
							<div class="mt-1 flex gap-1">
								<Button
									variant="outline"
									size="sm"
									class="flex-1"
									title="Reset placement"
									onclick={() => view3DToolbar.onResetOverlayPlacement?.(ov.id)}
								>
									<RotateCcw />
									<span>Reset</span>
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="flex-1"
									title="Frame in view"
									onclick={() => view3DToolbar.onFrameOverlay?.(ov.id)}
								>
									<LocateFixed />
									<span>Frame</span>
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="flex-1 text-destructive hover:text-destructive"
									title="Remove this copy"
									onclick={() => view3DToolbar.onClearOverlay?.(ov.id)}
								>
									<Trash2 />
									<span>Clear</span>
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Saved-but-not-loaded PDB placements -->
		{#if pendingSources.length > 0}
			<div class="space-y-1 rounded-md border border-dashed border-border p-3 text-xs">
				<p class="font-medium text-foreground">Saved overlay positions</p>
				<p class="text-muted-foreground">
					This design remembers placements for the structures below. Drop the matching file to
					render them:
				</p>
				<ul class="space-y-0.5 pt-0.5">
					{#each pendingSources as src (src.key)}
						<li>
							<span class="font-mono text-foreground">PDB {src.key}</span>
							<span class="text-muted-foreground">
								· {src.count}
								{src.count > 1 ? 'copies' : 'copy'}</span
							>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- Drop zone -->
		<FileDropZone
			accept=".txt,.pdb,text/plain,chemical/x-pdb"
			class="h-24 rounded-md border border-border p-3"
			onUpload={loadOverlay}
			onFileRejected={({ reason, file }) => {
				toast.error('File rejected', { description: `${file.name}: ${reason}` });
			}}
		>
			<div
				class="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground"
			>
				<div
					class="flex size-8 items-center justify-center rounded-full border border-dashed border-border"
				>
					<Upload size={16} />
				</div>
				<div class="space-y-0.5">
					<p class="text-xs font-medium">Drop mrDNA .txt or PDB .pdb</p>
					<p class="text-[11px]">or click to select a file</p>
				</div>
			</div>
		</FileDropZone>
	</div>
{/if}
