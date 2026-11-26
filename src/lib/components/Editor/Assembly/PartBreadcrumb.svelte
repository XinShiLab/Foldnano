<script lang="ts">
	import { Check, ChevronDown, ChevronRight, Link2 } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { help } from '$lib/components/help/help';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	const ctx = getEditorViewContext();
	const doc = $derived(ctx.currentDoc);
	const activePart = $derived(ctx.activePart);
	const instanceCount = $derived(activePart ? doc.assembly.occurrencesOf(activePart.id).length : 0);
</script>

{#if activePart}
	<div
		class="flex h-7 shrink-0 items-center gap-1 border-b border-border px-3 text-xs text-muted-foreground"
		{@attach help({
			title: 'Active Part',
			text: 'The Part the helix and strand views edit. A design with several Parts edits one at a time; pick another here or in the Assembly panel.',
			doc: 'assemblies',
		})}
	>
		<span class="truncate">{doc.name}</span>
		<ChevronRight size={12} class="shrink-0" />
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 font-medium text-foreground hover:bg-accent"
				title="Switch the Part being edited"
			>
				<span class="truncate">{activePart.name}</span>
				{#if instanceCount > 1}
					<span class="text-[10px] font-normal text-muted-foreground">×{instanceCount}</span>
				{/if}
				<ChevronDown size={12} class="shrink-0" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start" class="w-48">
				{#each doc.parts as part (part.id)}
					<DropdownMenu.Item onclick={() => ctx.setActivePart(part.id)}>
						<Check size={12} class={part.id === activePart.id ? '' : 'invisible'} />
						<span class="truncate">{part.name}</span>
					</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={() => ctx.openSidePanel('ASSEMBLY')}>
					Open Assembly panel
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		{#if activePart.source}
			<span
				class="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]"
				title="This Part is linked from another design and can't be edited here. Open the source from the Assembly panel to change it, or break the link."
			>
				<Link2 size={11} />
				Linked, read-only
			</span>
		{/if}
		{#if ctx.activeRegion}
			<ChevronRight size={12} class="shrink-0" />
			<span class="truncate">{ctx.activeRegion.name}</span>
		{/if}
	</div>
{/if}
