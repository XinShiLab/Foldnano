<script lang="ts">
	import { getEditorViewContext } from './context/EditorViewContext.svelte';
	import { getSidePanelDescriptors } from './sidePanels';
	import { help } from '$lib/components/help/help';
	import PluginIcon from './Plugin/PluginIcon.svelte';

	const editorViewContext = getEditorViewContext();
	const sidePanels = $derived(
		getSidePanelDescriptors(editorViewContext.pluginRegistry, editorViewContext.pluginEditorIds)
	);

	const PANEL_HELP: Record<string, string> = {
		GITHUB: 'GitHub files, uncommitted changes and history for designs synced to a repository.',
		PLUGIN: 'Browse, install and run plugins that generate or modify designs.',
	};

	$effect(() => {
		if (!sidePanels.some((panel) => panel.id === editorViewContext.sidePanelTab)) {
			editorViewContext.setSidePanelTab('GITHUB');
		}
	});
</script>

<div
	class="flex w-10 shrink-0 flex-col items-center gap-0.5 border-r border-border bg-muted py-2"
	{@attach help({
		title: 'Side panels',
		text: 'Source Control (GitHub files and sync), Plugins, and panels added by plugins. Click an icon to open or close its panel.',
		doc: 'saving-github',
	})}
>
	{#each sidePanels as panel (panel.id)}
		<button
			class="relative flex h-9 w-9 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground {editorViewContext.showSidePanel &&
			editorViewContext.sidePanelTab === panel.id
				? 'bg-accent text-foreground before:absolute before:top-1 before:bottom-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
				: 'text-muted-foreground'}"
			onclick={() => editorViewContext.toggleSidePanel(panel.id)}
			title={panel.title}
			aria-label={panel.ariaLabel}
			{@attach help({
				title: panel.title,
				text: panel.kind === 'plugin' ? panel.description : PANEL_HELP[panel.id],
			})}
		>
			{#if panel.kind === 'plugin' && panel.iconSvg}
				<PluginIcon svg={panel.iconSvg} />
			{:else}
				<panel.icon size={20} />
			{/if}
			{#if panel.kind === 'plugin' && panel.hasDraft}
				<span
					class="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-500"
					aria-label="Unsaved changes"
				></span>
			{/if}
		</button>
	{/each}
</div>
