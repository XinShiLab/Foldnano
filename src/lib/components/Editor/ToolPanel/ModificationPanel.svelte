<script lang="ts">
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { Plus, Eraser, X, AlertTriangle } from '@lucide/svelte';
	import ColorPicker from 'svelte-awesome-color-picker';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
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

	// bg-muted alone is too faint to show which chip is chosen.
	const CHIP_CLASS =
		'h-6 gap-1.5 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10';

	// Builtin and custom chips are one single-choice set. Clicking the chosen chip again would
	// deselect it (value ''); keep the current choice instead of silently entering remove mode.
	const modificationValue = {
		get: () => modiCtx.currentModification?.name ?? '',
		set: (name: string) => {
			const mod =
				modiCtx.builtinModifications.find((m) => m.name === name) ??
				part.customModifications.find((m) => m.name === name);
			if (mod) selectModification(mod);
		},
	};

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
		class="inline-block size-2.5 flex-none rounded-full border border-black/10"
		style="background-color: {colorString};"
	></span>
{/snippet}

<div class="space-y-1">
	<p class="font-medium">Active:</p>
	{#if modiCtx.currentModification}
		<Badge variant="outline" class="h-6 gap-1.5 text-xs">
			{@render swatch(
				getModificationColor(modiCtx.currentModification.name, part.customModifications)
			)}
			{modiCtx.currentModification.name}
		</Badge>
	{:else}
		<Badge variant="destructive" class="h-6 gap-1.5 text-xs"><Eraser />Remove</Badge>
	{/if}
</div>

<div class="space-y-1">
	<p class="font-medium">Builtin:</p>
	<ToggleGroup.Root
		type="single"
		variant="outline"
		size="sm"
		spacing={1}
		class="flex-wrap"
		bind:value={modificationValue.get, modificationValue.set}
	>
		{#each modiCtx.builtinModifications as mod (mod.name)}
			<ToggleGroup.Item value={mod.name} class="{CHIP_CLASS} px-2">
				{@render swatch(mod.color)}
				{mod.name}
			</ToggleGroup.Item>
		{/each}
	</ToggleGroup.Root>
</div>

<div class="space-y-1">
	<div class="flex items-center justify-between">
		<p class="font-medium">Custom:</p>
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label="Add a custom modification"
			aria-expanded={showAddForm}
			onclick={() => (showAddForm = !showAddForm)}
		>
			<Plus />
		</Button>
	</div>

	{#if part.customModifications.length > 0}
		<ToggleGroup.Root
			type="single"
			variant="outline"
			size="sm"
			spacing={1}
			class="flex-wrap"
			bind:value={modificationValue.get, modificationValue.set}
		>
			{#each part.customModifications as mod (mod.name)}
				<span class="group/mod relative">
					<ToggleGroup.Item value={mod.name} class="{CHIP_CLASS} pr-5 pl-2">
						{@render swatch(getModificationColor(mod.name, part.customModifications))}
						{mod.name}
					</ToggleGroup.Item>
					<button
						type="button"
						aria-label="Remove {mod.name}"
						class="absolute top-1/2 right-1 hidden -translate-y-1/2 text-muted-foreground group-hover/mod:inline-flex hover:text-destructive focus-visible:inline-flex"
						onclick={() => removeCustomModification(mod)}
					>
						<X size={10} />
					</button>
				</span>
			{/each}
		</ToggleGroup.Root>
	{:else if !showAddForm}
		<p class="text-xs text-muted-foreground">No custom modifications. Click + to add.</p>
	{/if}

	{#if showAddForm}
		<div class="flex items-end gap-1.5 border border-border bg-muted/50 p-1.5">
			<div class="flex-1 space-y-1">
				<Label for="new-modification-name" class="text-[10px] text-muted-foreground">Name</Label>
				<Input
					id="new-modification-name"
					bind:value={newName}
					placeholder="e.g. Azide"
					class="h-7 text-xs"
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === 'Enter') addCustomModification();
					}}
				/>
			</div>
			<div class="space-y-1">
				<span class="block text-[10px] text-muted-foreground">Color</span>
				<Popover.Root>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="outline"
								size="icon-sm"
								aria-label="Pick a color"
								class="p-1"
							>
								<span class="size-full" style="background-color: {newColor};"></span>
							</Button>
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
			<Button size="sm" disabled={!newName.trim()} onclick={addCustomModification}>Add</Button>
		</div>
	{/if}
</div>

<Toggle
	variant="outline"
	size="sm"
	class="mt-1 h-7 gap-1 px-2 text-xs data-[state=on]:border-destructive/40 data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive"
	pressed={modiCtx.currentModification === null}
	onPressedChange={(on) => {
		if (on) clearModification();
	}}
>
	<Eraser />
	Remove mode
</Toggle>

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
