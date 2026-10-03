<script lang="ts">
	import SelectPanel from '$lib/components/Editor/ToolPanel/SelectPanel.svelte';
	import ColorPanel from '$lib/components/Editor/ToolPanel/ColorPanel.svelte';
	import ModificationPanel from '$lib/components/Editor/ToolPanel/ModificationPanel.svelte';
	import SequencePanel from '$lib/components/Editor/ToolPanel/SequencePanel.svelte';
	import { getEditorViewContext } from '$lib/components/Editor/context/EditorViewContext.svelte';
	import { getTutorialState } from './tutorialContext.svelte';
	import { getTutorialModeInfo } from './tutorialData';

	const editorViewContext = getEditorViewContext();
	const tutorial = getTutorialState();
	const part = $derived(editorViewContext.currentDoc.parts[0]);
	const panel = $derived(tutorial.activePanel ?? getTutorialModeInfo(tutorial.activeMode).panel);
</script>

{#if part}
	<div
		class="min-h-48 rounded-md border border-border bg-background p-3 text-xs shadow-sm"
		data-tutorial-id="tool-panel"
	>
		{#if panel === 'select'}
			<div class="mb-2 text-xs font-semibold">Selection Tool</div>
			<SelectPanel />
		{:else if panel === 'paint'}
			<div class="mb-2 text-xs font-semibold" data-tutorial-id="panel-color-active-color">
				Paint Tool
			</div>
			<ColorPanel />
		{:else if panel === 'modification'}
			<div class="mb-2 text-xs font-semibold">Modification Tool</div>
			<ModificationPanel {part} />
		{:else if panel === 'sequence'}
			<div class="mb-2 text-xs font-semibold" data-tutorial-id="panel-sequence-fill-type">
				Sequence Tool
			</div>
			<SequencePanel {part} />
		{:else}
			<div
				class="flex min-h-40 items-center justify-center rounded border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground"
			>
				This mode acts directly on the canvas and does not use a side panel.
			</div>
		{/if}
	</div>
{/if}
