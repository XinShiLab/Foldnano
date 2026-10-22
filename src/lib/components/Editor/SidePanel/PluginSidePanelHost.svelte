<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import PluginCodeEditorSidePanel from './PluginCodeEditorSidePanel.svelte';
	import PluginFormSidePanel from './PluginFormSidePanel.svelte';
	import OwnedPluginEditorPanel from './OwnedPluginEditorPanel.svelte';

	let { pluginId }: { pluginId: string } = $props();

	const editorCtx = getEditorViewContext();
	const plugin = $derived(editorCtx.pluginRegistry.get(pluginId) ?? null);
	const sidePanel = $derived(plugin?.manifest.sidePanel ?? null);
</script>

{#if plugin && !sidePanel && plugin.authoring && editorCtx.pluginEditorIds.has(pluginId)}
	{#key plugin.manifest.id}
		<OwnedPluginEditorPanel {plugin} />
	{/key}
{:else if !plugin || !sidePanel}
	<div
		class="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground"
	>
		This plugin side panel is no longer available.
	</div>
{:else if sidePanel.type === 'codeEditor'}
	<!-- One instance per plugin: a pending editor save flushes on unmount under the right id. -->
	{#key plugin.manifest.id}
		<PluginCodeEditorSidePanel {plugin} />
	{/key}
{:else}
	<PluginFormSidePanel {plugin} />
{/if}
