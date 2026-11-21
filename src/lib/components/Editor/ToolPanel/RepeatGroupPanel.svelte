<script lang="ts">
	import { ChevronDown, ChevronRight, X } from '@lucide/svelte/icons';
	import { SvelteSet } from 'svelte/reactivity';
	import { notify } from '$lib/notifications/notify.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { startDuplicate } from '../strandActions';
	import {
		deleteRepeatGroupCmd,
		detachRepeatGroupCmd,
		removeRepeatInstanceCmd,
	} from '$lib/commands/repeatGroups';
	import type { RepeatGroup } from '$lib/model/Part/Part.svelte';

	const ctx = getEditorViewContext();
	const part = $derived(ctx.currentDoc?.parts[0]);
	const groups = $derived(part?.repeatGroups ?? []);
	const isReadOnly = $derived(!ctx.isTabOwner);

	let sectionOpen = $state(true);
	// Groups the user toggled away from the default (open when it's the only group).
	const toggled = new SvelteSet<string>();
	const isOpen = (group: RepeatGroup) => (groups.length === 1) !== toggled.has(group.id);
	const toggle = (group: RepeatGroup) =>
		toggled.has(group.id) ? toggled.delete(group.id) : toggled.add(group.id);

	const originalsOf = (group: RepeatGroup) =>
		part ? part.realOligos.filter((o) => o.repeatGroupId === group.id) : [];

	function run(action: () => void) {
		try {
			action();
		} catch (err) {
			notify.error(err instanceof Error ? err.message : String(err));
		}
	}

	function selectOriginals(group: RepeatGroup) {
		ctx.strandViewContext.selected.set(originalsOf(group).flatMap((o) => [...o.allEnds]));
	}
</script>

<!-- @component
  RepeatGroupPanel
  Lists the part's repeat groups (docs/repeat-units.md): each group's originals and mirror
  copy offsets, with select / add copy / remove copy / detach / delete actions.
-->

{#if part && groups.length > 0}
	<div class="mt-3 flex flex-col gap-2">
		<button
			class="flex items-center gap-1 text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground"
			aria-expanded={sectionOpen}
			onclick={() => (sectionOpen = !sectionOpen)}
		>
			{#if sectionOpen}
				<ChevronDown class="size-3" />
			{:else}
				<ChevronRight class="size-3" />
			{/if}
			Repeat groups ({groups.length})
		</button>
		{#each sectionOpen ? groups : [] as group (group.id)}
			{@const open = isOpen(group)}
			<div class="flex flex-col gap-1.5 rounded-md border p-2 text-xs">
				<button
					class="flex items-center gap-1 text-left"
					aria-expanded={open}
					onclick={() => toggle(group)}
				>
					{#if open}
						<ChevronDown class="size-3 shrink-0 text-muted-foreground" />
					{:else}
						<ChevronRight class="size-3 shrink-0 text-muted-foreground" />
					{/if}
					<span class="truncate font-medium">{group.name}</span>
					<span class="ml-auto shrink-0 text-muted-foreground">
						{originalsOf(group).length} originals · {group.instances.length}
						{group.instances.length === 1 ? 'copy' : 'copies'}
					</span>
				</button>
				{#if open}
					<div class="flex flex-wrap gap-1">
						{#each group.instances as instance, idx (instance.id)}
							<span class="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5">
								Copy {idx + 1}: {instance.bpOffset > 0 ? '+' : ''}{instance.bpOffset} bp
								<button
									class="text-muted-foreground hover:text-foreground disabled:opacity-50"
									title="Remove this copy"
									disabled={isReadOnly}
									onclick={() =>
										run(() =>
											removeRepeatInstanceCmd(
												{ part, groupId: group.id, instanceId: instance.id },
												ctx.historyStack
											)
										)}
								>
									<X class="size-3" />
								</button>
							</span>
						{/each}
					</div>
					<div class="flex flex-wrap gap-1">
						<Button variant="outline" size="sm" onclick={() => selectOriginals(group)}>
							Select originals
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={isReadOnly || ctx.editorMode !== 'SELECT'}
							onclick={() => startDuplicate(part, ctx, { groupId: group.id })}
						>
							Add copy
						</Button>
						<Button
							variant="outline"
							size="sm"
							title="Keep the copies as independent oligos and dissolve the group"
							disabled={isReadOnly}
							onclick={() =>
								run(() => detachRepeatGroupCmd({ part, groupId: group.id }, ctx.historyStack))}
						>
							Detach
						</Button>
						<Button
							variant="outline"
							size="sm"
							title="Remove the copies; the originals stay as normal oligos"
							disabled={isReadOnly}
							onclick={() =>
								run(() => deleteRepeatGroupCmd({ part, groupId: group.id }, ctx.historyStack))}
						>
							Delete
						</Button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
