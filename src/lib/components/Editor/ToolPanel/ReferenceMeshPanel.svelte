<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { setRegionReferenceGeometryCmd } from '$lib/commands/regions';
	import { help } from '$lib/components/help/help';
	import type { Part } from '$lib/model/Part';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import ReferenceMeshPicker from './ReferenceMeshPicker.svelte';
	import ReferenceMeshSummary from './ReferenceMeshSummary.svelte';

	let { part }: { part: Part } = $props();

	const ctx = getEditorViewContext();
	const region = $derived(ctx.activeRegion);
	const regionId = $derived(region?.id ?? null);
	const isReadOnly = $derived(!ctx.isTabOwner);
	// `referenceGeometry` is a plain field; a change to it always comes with a history revision.
	const currentMesh = $derived.by(() => {
		void ctx.historyStack.revision;
		return region?.referenceMesh;
	});
	let isReplacing = $state(false);
	const isHidden = $derived(regionId !== null && ctx.hiddenReferenceMeshRegionIds.has(regionId));

	$effect(() => {
		void regionId;
		untrack(() => {
			isReplacing = false;
			ctx.clearMeshDraft();
		});
	});
	onDestroy(() => ctx.clearMeshDraft());

	function closeDraft(): void {
		isReplacing = false;
		ctx.clearMeshDraft();
	}

	function commitDraft(): void {
		const mesh = ctx.scaledMeshDraft;
		if (!mesh || !regionId) return;
		setRegionReferenceGeometryCmd(
			ctx.historyStack,
			part,
			regionId,
			{ unit: 'nm', mesh },
			currentMesh ? 'Replace reference mesh' : 'Add reference mesh'
		);
		ctx.hiddenReferenceMeshRegionIds.delete(regionId);
		closeDraft();
	}

	function removeMesh(): void {
		if (!regionId) return;
		setRegionReferenceGeometryCmd(
			ctx.historyStack,
			part,
			regionId,
			undefined,
			'Remove reference mesh'
		);
	}
</script>

<!-- @component
  ReferenceMeshPanel
  Add, replace, remove and show or hide the active wireframe region's reference mesh (docs/editor-3d-view.md).
-->
<div class="flex flex-col gap-3">
	{#if !currentMesh || isReplacing}
		<p class="text-muted-foreground">
			{isReplacing
				? 'The new mesh replaces the current one. Helices stay as they are.'
				: 'Add the shape this region is built from. It is shown for reference and does not change any helices.'}
		</p>
		<ReferenceMeshPicker />
		<div class="flex flex-col gap-1.5">
			<Button size="sm" disabled={!ctx.meshDraft || isReadOnly} onclick={commitDraft}>
				{isReplacing ? 'Replace Mesh' : 'Add Mesh'}
			</Button>
			{#if isReplacing}
				<Button size="sm" variant="outline" onclick={closeDraft}>Cancel</Button>
			{/if}
		</div>
	{:else}
		<ReferenceMeshSummary mesh={currentMesh} />
		<div
			class="flex items-center justify-between gap-2"
			{@attach help({
				title: 'Show mesh',
				text: 'Show or hide the mesh in the 3D view. This is a view setting: it is not saved and cannot be undone.',
				doc: 'wireframe',
			})}
		>
			<Label for="reference-mesh-visible" class="text-xs">Show in 3D view</Label>
			<Switch
				id="reference-mesh-visible"
				checked={!isHidden}
				onCheckedChange={() => regionId && ctx.toggleReferenceMeshHidden(regionId)}
			/>
		</div>
		<div class="flex gap-1.5">
			<Button
				size="sm"
				variant="outline"
				class="flex-1"
				disabled={isReadOnly}
				onclick={() => (isReplacing = true)}
			>
				Replace…
			</Button>
			<Button
				size="sm"
				variant="outline"
				class="flex-1"
				disabled={isReadOnly}
				onclick={removeMesh}
				{@attach help({
					title: 'Remove mesh',
					text: 'Remove the mesh from this region. Helices and strands are not touched. Undo brings the mesh back.',
					doc: 'wireframe',
				})}
			>
				Remove
			</Button>
		</div>
	{/if}
</div>
