<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { createOwnedPlugin, type CreatedOwnedPlugin } from '$lib/plugin/ownedPluginActions';
	import { downloadPluginZip, generateOwnedPluginId } from '$lib/plugin/ownedPlugins';
	import PluginIconPicker from '../Plugin/PluginIconPicker.svelte';

	let {
		open = $bindable(false),
		code,
		onOpenEditor,
	}: {
		open?: boolean;
		/** The Script Lab buffer, captured when the dialog opens. */
		code: string;
		onOpenEditor: (pluginId: string) => void;
	} = $props();

	const editorCtx = getEditorViewContext();

	let name = $state('');
	let description = $state('');
	let iconSvg: string | null = $state(null);
	let pluginId = $state(generateOwnedPluginId());
	let downloadBackup = $state(true);
	let creating = $state(false);
	let created: CreatedOwnedPlugin | null = $state.raw(null);
	let backedUp = $state(false);
	let frozenCode = '';

	$effect(() => {
		if (!open) return;
		// Each opening starts a fresh form for the buffer as it is now.
		name = '';
		description = '';
		iconSvg = null;
		pluginId = generateOwnedPluginId();
		downloadBackup = true;
		created = null;
		backedUp = false;
		frozenCode = untrack(() => code);
	});

	async function create() {
		if (creating || !name.trim()) return;
		creating = true;
		try {
			const result = await createOwnedPlugin(
				{ registry: editorCtx.pluginRegistry, coordinator: editorCtx.pluginCoordinator },
				{ id: pluginId, name, description, code: frozenCode, iconSvg }
			);
			created = result;
			if (downloadBackup) await download(result);
		} catch (e) {
			toast.error("Couldn't make the plugin", {
				description: e instanceof Error ? e.message : String(e),
			});
		} finally {
			creating = false;
		}
	}

	async function download(result: CreatedOwnedPlugin) {
		downloadPluginZip(result.manifest, result.zip);
		backedUp = true;
		try {
			await editorCtx.pluginRegistry.markExported(result.manifest.id, result.manifest.version);
		} catch (e) {
			console.warn('[MakePluginDialog] Failed to record the backup:', e);
		}
	}

	function openEditor() {
		if (!created) return;
		const id = created.manifest.id;
		open = false;
		onOpenEditor(id);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		{#if !created}
			<Dialog.Header>
				<Dialog.Title>Save as plugin</Dialog.Title>
				<Dialog.Description>
					Package this script as a plugin in the Plugins panel. You can keep editing it there.
				</Dialog.Description>
			</Dialog.Header>
			<form
				class="space-y-3"
				onsubmit={(e) => {
					e.preventDefault();
					void create();
				}}
			>
				<div class="space-y-1">
					<Label for="make-plugin-name">Name</Label>
					<Input id="make-plugin-name" bind:value={name} placeholder="My tool" maxlength={80} />
				</div>
				<div class="space-y-1">
					<Label for="make-plugin-description">Description (optional)</Label>
					<Textarea
						id="make-plugin-description"
						bind:value={description}
						rows={2}
						placeholder="What it does"
					/>
				</div>
				<div class="space-y-1">
					<Label for="make-plugin-icon">Icon (optional)</Label>
					<PluginIconPicker id="make-plugin-icon" bind:value={iconSvg} />
				</div>
				<div class="space-y-1">
					<Label for="make-plugin-id">ID</Label>
					<Input id="make-plugin-id" value={pluginId} readonly class="font-mono text-xs" />
				</div>
				<div class="flex items-start gap-2 rounded border border-border p-2">
					<Switch id="make-plugin-backup" bind:checked={downloadBackup} class="mt-0.5" />
					<div class="space-y-0.5">
						<Label for="make-plugin-backup">Download a backup (.zip)</Label>
						<p class="text-xs text-muted-foreground">
							Clearing browser data deletes the in-browser copy. Import the zip to restore it.
						</p>
					</div>
				</div>
				<Dialog.Footer>
					<Button variant="outline" type="button" onclick={() => (open = false)}>Cancel</Button>
					<Button type="submit" disabled={creating || !name.trim()}>
						{creating ? 'Saving…' : 'Save plugin'}
					</Button>
				</Dialog.Footer>
			</form>
		{:else}
			<Dialog.Header>
				<Dialog.Title>"{created.manifest.name}" is installed</Dialog.Title>
				<Dialog.Description>
					It's in the Plugins panel as v{created.manifest.version}. Run it from there, or open it in
					its own editor to keep changing it.
				</Dialog.Description>
			</Dialog.Header>
			<p class="text-xs text-muted-foreground">
				{#if backedUp}
					Backup downloaded. Keep it somewhere safe.
				{:else}
					Not backed up yet. Clearing browser data deletes the in-browser copy.
					<button
						class="text-primary underline underline-offset-2"
						onclick={() => created && void download(created)}
					>
						Download backup
					</button>
				{/if}
			</p>
			{#if created.manifest.requirements?.length}
				<p class="text-xs text-muted-foreground">
					Packages: {created.manifest.requirements.join(', ')}
				</p>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)}>Done</Button>
				<Button onclick={openEditor}>Open in editor</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
