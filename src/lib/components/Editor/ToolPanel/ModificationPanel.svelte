<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { Plus, Eraser, X, AlertTriangle } from '@lucide/svelte';
	import ColorPicker from 'svelte-awesome-color-picker';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { getModificationColor, type ModificationDef } from '$lib/model/modifications';
	import type { Part } from '$lib/model/Part';
	import { setCustomModificationsCmd, removeCustomModificationCmd } from '$lib/commands/strands';

	type Props = {
		part: Part;
	};
	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	const modiCtx = $derived(editorViewContext.strandViewContext.modificationContext);

	let showAddForm = $state(false);
	let newName = $state('');
	let newColor = $state('#22c55e');

	let removeDialogOpen = $state(false);
	let pendingRemoval = $state<{ mod: ModificationDef; affectedCount: number } | null>(null);

	function selectModification(mod: ModificationDef) {
		modiCtx.currentModification = mod;
	}

	function clearModification() {
		modiCtx.currentModification = null;
	}

	function addCustomModification() {
		const name = newName.trim();
		if (!name) return;
		const exists =
			modiCtx.builtinModifications.some((m) => m.name === name) ||
			part.customModifications.some((m) => m.name === name);
		if (exists) return;
		const newMod = { name, color: newColor };
		setCustomModificationsCmd(
			part,
			[...part.customModifications, newMod],
			editorViewContext.historyStack
		);
		modiCtx.currentModification = newMod;
		newName = '';
		newColor = '#22c55e';
		showAddForm = false;
	}

	function finishRemoval(mod: ModificationDef) {
		removeCustomModificationCmd(part, mod.name, editorViewContext.historyStack);
		if (modiCtx.currentModification?.name === mod.name) {
			modiCtx.currentModification = null;
		}
	}

	function removeCustomModification(mod: ModificationDef) {
		const affectedCount = part.getEndsWithModification(mod.name).length;
		if (affectedCount === 0) {
			finishRemoval(mod);
			return;
		}
		pendingRemoval = { mod, affectedCount };
		removeDialogOpen = true;
	}

	function confirmRemoval() {
		if (!pendingRemoval) return;
		finishRemoval(pendingRemoval.mod);
		removeDialogOpen = false;
	}
</script>

{#snippet swatch(colorString: string)}
	<span
		class="inline-block h-3 w-3 flex-none rounded-full border border-black/10"
		style="background-color: {colorString};"
	></span>
{/snippet}

<div class="space-y-2">
	<p class="font-medium">Active:</p>
	<div class="flex items-center gap-2">
		{#if modiCtx.currentModification}
			<span
				class="flex h-7 items-center gap-1.5 rounded border border-blue-300 bg-blue-50 px-2 text-sm font-medium dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200"
			>
				{@render swatch(
					getModificationColor(modiCtx.currentModification.name, part.customModifications)
				)}
				{modiCtx.currentModification.name}
			</span>
		{:else}
			<span
				class="flex h-7 items-center gap-1 rounded border border-red-200 bg-red-50 px-2 text-sm dark:border-red-800 dark:bg-red-950 dark:text-red-200"
			>
				<Eraser size={14} />
				Remove
			</span>
		{/if}
	</div>
</div>

<div class="space-y-1">
	<p class="font-medium">Builtin:</p>
	<div class="flex flex-wrap gap-1">
		{#each modiCtx.builtinModifications as mod (mod.name)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="flex cursor-pointer items-center gap-1.5 rounded border px-1.5 py-0.5 transition-colors
					{modiCtx.currentModification?.name === mod.name
					? 'border-blue-400 bg-blue-100'
					: 'border-border hover:bg-muted'}"
				onclick={() => selectModification(mod)}
			>
				{@render swatch(mod.color)}
				<span class="text-xs">{mod.name}</span>
			</div>
		{/each}
	</div>
</div>

<div class="space-y-1">
	<div class="flex items-center justify-between">
		<p class="font-medium">Custom:</p>
		<button
			class="rounded px-1 py-0.5 text-muted-foreground transition hover:bg-amber-100 hover:text-foreground dark:hover:bg-amber-900"
			onclick={() => (showAddForm = !showAddForm)}
		>
			<Plus size={12} />
		</button>
	</div>

	{#if part.customModifications.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each part.customModifications as mod (mod.name)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="group flex cursor-pointer items-center gap-1.5 rounded border px-1.5 py-0.5 transition-colors
						{modiCtx.currentModification?.name === mod.name
						? 'border-blue-400 bg-blue-100 dark:border-blue-600 dark:bg-blue-950 dark:text-blue-200'
						: 'border-border hover:bg-muted'}"
					onclick={() => selectModification(mod)}
				>
					{@render swatch(getModificationColor(mod.name, part.customModifications))}
					<span class="text-xs">{mod.name}</span>
					<button
						class="ml-0.5 hidden rounded text-muted-foreground group-hover:inline-flex hover:text-red-500"
						onclick={(e: MouseEvent) => {
							e.stopPropagation();
							removeCustomModification(mod);
						}}
					>
						<X size={10} />
					</button>
				</div>
			{/each}
		</div>
	{:else if !showAddForm}
		<p class="text-xs text-muted-foreground">No custom modifications. Click + to add.</p>
	{/if}

	{#if showAddForm}
		<div class="flex items-end gap-1 rounded border border-border bg-muted p-1.5">
			<label class="flex-1">
				<span class="text-[10px] text-muted-foreground">Name</span>
				<input
					type="text"
					bind:value={newName}
					placeholder="e.g. Azide"
					class="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
				/>
			</label>
			<div>
				<span class="block text-[10px] text-muted-foreground">Color</span>
				<Popover.Root>
					<Popover.Trigger>
						{#snippet child({ props })}
							<div
								{...props}
								class="h-5 w-8 cursor-pointer rounded border border-border"
								style="background-color: {newColor};"
							></div>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-auto p-2">
						<ColorPicker
							bind:hex={newColor}
							isAlpha={false}
							isDialog={false}
							isTextInput={false}
							--input-size="0px"
							--picker-height="100px"
							--cp-border-color="#e5e7eb"
						/>
					</Popover.Content>
				</Popover.Root>
			</div>
			<button
				class="rounded bg-blue-500 px-2 py-0.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
				disabled={!newName.trim()}
				onclick={addCustomModification}
			>
				Add
			</button>
		</div>
	{/if}
</div>

<div class="pt-1">
	<button
		class="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs transition-colors
			{modiCtx.currentModification === null
			? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950 dark:text-red-300'
			: 'hover:bg-red-50 dark:hover:bg-red-950 dark:hover:text-red-300'}"
		onclick={clearModification}
	>
		<Eraser size={12} />
		Remove mode
	</button>
</div>

<Dialog.Root bind:open={removeDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<AlertTriangle size={16} class="shrink-0 text-amber-500" />
				Remove "{pendingRemoval?.mod.name}"?
			</Dialog.Title>
			<Dialog.Description>
				This modification is applied to {pendingRemoval?.affectedCount}
				end{pendingRemoval?.affectedCount === 1 ? '' : 's'} in this design. Removing it will clear the
				mark from all of them.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (removeDialogOpen = false)}>Cancel</Button>
			<Button variant="destructive" onclick={confirmRemoval}>Remove</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
