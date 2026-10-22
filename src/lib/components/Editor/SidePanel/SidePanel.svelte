<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getSidePanelDescriptor } from '../sidePanels';
	import PluginSidePanelHost from './PluginSidePanelHost.svelte';

	const ctx = getEditorViewContext();
	const activePanel = $derived(
		getSidePanelDescriptor(ctx.sidePanelTab, ctx.pluginRegistry, ctx.pluginEditorIds)
	);
	const ActivePanelComponent = $derived(activePanel.component);
	const activePluginId = $derived(activePanel.kind === 'plugin' ? activePanel.pluginId : null);
	// Popped-out panels own their window and open owned-plugin editors keep their undo history,
	// cursor and scroll, so both stay mounted (hidden) while another tab shows.
	const pluginPanelIds = $derived.by(() => {
		const openEditors = [...ctx.pluginEditorIds].filter(
			(id) => ctx.pluginRegistry.get(id)?.authoring
		);
		const ids = [...ctx.poppedOutPluginPanels, ...openEditors];
		if (activePluginId) ids.push(activePluginId);
		return ids.filter((id, i) => ids.indexOf(id) === i);
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
