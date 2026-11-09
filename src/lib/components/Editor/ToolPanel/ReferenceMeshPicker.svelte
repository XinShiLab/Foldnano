<script lang="ts">
	import { Upload } from '@lucide/svelte';
	import { notify } from '$lib/notifications/notify.svelte';
	import { FileDropZone } from '$lib/components/ui/file-drop-zone';
	import { Input } from '$lib/components/ui/input/index.js';
	import { help } from '$lib/components/help/help';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import ReferenceMeshSummary from './ReferenceMeshSummary.svelte';

	const ctx = getEditorViewContext();

	async function onUpload(files: File[]): Promise<void> {
		if (files[0]) await ctx.loadMeshDraft(files[0]);
	}

	function onScaleChange(e: Event & { currentTarget: HTMLInputElement }): void {
		ctx.setMeshDraftScale(Number(e.currentTarget.value));
		e.currentTarget.value = String(ctx.meshDraft?.scale ?? 1);
	}
</script>

<!-- @component
  ReferenceMeshPicker
  Choose and scale a PLY mesh into `ctx.meshDraft`, which the 3D view previews (docs/editor-3d-view.md).
-->
{#if ctx.meshDraft}
	<div class="flex flex-col gap-2">
		<div class="flex items-center justify-between gap-2">
			<span class="min-w-0 truncate font-medium" title={ctx.meshDraft.fileName}>
				{ctx.meshDraft.fileName}
			</span>
			<button
				class="shrink-0 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
				onclick={() => ctx.clearMeshDraft()}
			>
				Choose another
			</button>
		</div>
		<label
			class="flex items-center gap-2 text-muted-foreground"
			{@attach help({
				title: 'Mesh scale',
				text: 'How many nanometres one unit in the file stands for. PLY files carry no unit. The scale is applied once, when the mesh is added.',
				doc: 'wireframe',
			})}
		>
			1 file unit =
			<Input
				class="h-7 w-20"
				type="number"
				min="0"
				step="any"
				value={ctx.meshDraft.scale}
				onchange={onScaleChange}
			/>
			nm
		</label>
		{#if ctx.scaledMeshDraft}
			<ReferenceMeshSummary mesh={ctx.scaledMeshDraft} />
		{/if}
	</div>
{:else}
	<FileDropZone
		accept=".ply"
		fileCount={1}
		class="h-24 rounded-md border border-border p-3"
		{onUpload}
		onFileRejected={({ reason, file }) => {
			notify.error('File rejected', { description: `${file.name}: ${reason}` });
		}}
	>
		<div class="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
			<div
				class="flex size-8 items-center justify-center rounded-full border border-dashed border-border"
			>
				<Upload size={16} />
			</div>
			<div class="space-y-0.5">
				<p class="text-xs font-medium">Drop an ASCII .ply mesh</p>
				<p class="text-[11px]">or click to select a file</p>
			</div>
		</div>
	</FileDropZone>
{/if}
