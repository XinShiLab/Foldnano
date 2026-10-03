<script lang="ts">
	import { X } from '@lucide/svelte/icons';
	import { toast } from 'svelte-sonner';
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

	const originalsOf = (group: RepeatGroup) =>
		part ? part.realOligos.filter((o) => o.repeatGroupId === group.id) : [];

	function run(action: () => void) {
		try {
			action();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
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
		<span class="text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
			Repeat groups
		</span>
		{#each groups as group (group.id)}
			<div class="flex flex-col gap-1.5 rounded-md border p-2 text-xs">
				<div class="flex items-center justify-between">
					<span class="font-medium">{group.name}</span>
					<span class="text-muted-foreground">{originalsOf(group).length} originals</span>
				</div>
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
			</div>
		{/each}
	</div>
{/if}
