<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getSidePanelDescriptor } from '../sidePanels';

	const ctx = getEditorViewContext();
	const activePanel = $derived(getSidePanelDescriptor(ctx.sidePanelTab, ctx.pluginRegistry));
	const ActivePanelComponent = $derived(activePanel.component);
</script>

<div class="flex h-full flex-col overflow-hidden">
	<div class="min-h-0 flex-1 overflow-hidden">
		<ActivePanelComponent {...activePanel.componentProps ?? {}} />
	</div>
</div>
