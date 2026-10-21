<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getSidePanelDescriptor } from '../sidePanels';
	import PluginSidePanelHost from './PluginSidePanelHost.svelte';

	const ctx = getEditorViewContext();
	const activePanel = $derived(getSidePanelDescriptor(ctx.sidePanelTab, ctx.pluginRegistry));
	const ActivePanelComponent = $derived(activePanel.component);
	const activePluginId = $derived(activePanel.kind === 'plugin' ? activePanel.pluginId : null);
	// A popped-out panel owns its window, so it stays mounted (hidden) while another tab shows.
	const pluginPanelIds = $derived.by(() => {
		const ids = [...ctx.poppedOutPluginPanels];
		if (activePluginId && !ids.includes(activePluginId)) ids.push(activePluginId);
		return ids;
	});
</script>

<div class="flex h-full flex-col overflow-hidden">
	<div class="min-h-0 flex-1 overflow-hidden">
		{#if activePanel.kind === 'builtIn'}
			<ActivePanelComponent {...activePanel.componentProps ?? {}} />
		{/if}
		{#each pluginPanelIds as pluginId (pluginId)}
			<div class={pluginId === activePluginId ? 'h-full' : 'hidden'}>
				<PluginSidePanelHost {pluginId} />
			</div>
		{/each}
	</div>
</div>
