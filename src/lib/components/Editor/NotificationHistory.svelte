<script lang="ts">
	import { Bell, Bug, CircleCheck, Info, OctagonX, TriangleAlert } from '@lucide/svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { help } from '$lib/components/help/help';
	import { errorLogPanelState } from '$lib/errorLogPanel.svelte';
	import { formatRelativeTime } from '$lib/relativeTime';
	import {
		clearNotificationHistory,
		markNotificationsSeen,
		notificationHistory,
		type NotificationLevel,
	} from '$lib/notifications/notify.svelte';

	let open = $state(false);
	// Read once per opening so the times don't need a ticking clock.
	let now = $state(Date.now());

	const ICON = { success: CircleCheck, error: OctagonX, warning: TriangleAlert, info: Info };
	const ICON_CLASS: Record<NotificationLevel, string> = {
		success: 'text-emerald-600',
		error: 'text-destructive',
		warning: 'text-amber-600',
		info: 'text-sky-600',
	};

	function onOpenChange(next: boolean): void {
		if (!next) return;
		now = Date.now();
		markNotificationsSeen();
	}

	function openErrorLog(errorLogId: string | null): void {
		open = false;
		errorLogPanelState.focusedEntryId = errorLogId;
		errorLogPanelState.open = true;
	}
</script>

<Popover.Root bind:open {onOpenChange}>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="relative flex shrink-0 items-center rounded p-0.5 hover:bg-primary-foreground/20"
				title="Recent notifications in this tab"
				aria-label="Recent notifications"
				{@attach help({
					title: 'Recent notifications',
					text: 'Messages that popped up in this tab, newest first, kept until you reload the page. The Error Log, with saved error details to share in a bug report, opens from here.',
					doc: 'interface-reference',
				})}
			>
				<Bell class="size-3.5" />
				{#if notificationHistory.hasUnseenAttention}
					<span
						class="absolute top-0 right-0 size-1.5 rounded-full bg-amber-300"
						aria-label="New warnings or errors"
					></span>
				{/if}
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-96 p-0" side="top" align="end">
		<div class="flex items-center justify-between border-b border-border px-3 py-2">
			<p class="text-sm font-medium">Recent notifications</p>
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					class="h-6 gap-1 px-2 text-xs"
					title="Saved error details to share in a bug report"
					onclick={() => openErrorLog(null)}
				>
					<Bug class="size-3" />Error Log
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="h-6 px-2 text-xs"
					disabled={notificationHistory.entries.length === 0}
					onclick={clearNotificationHistory}
				>
					Clear
				</Button>
			</div>
		</div>
		{#if notificationHistory.entries.length === 0}
			<p class="px-3 py-4 text-xs text-muted-foreground italic">Nothing yet in this tab.</p>
		{:else}
			<ul class="max-h-96 overflow-y-auto">
				{#each notificationHistory.entries as entry (entry.id)}
					{@const Icon = ICON[entry.level]}
					<li class="flex gap-2 border-b border-border px-3 py-2 last:border-b-0">
						<Icon class="mt-0.5 size-3.5 shrink-0 {ICON_CLASS[entry.level]}" />
						<div class="min-w-0 flex-1">
							<div class="flex items-baseline gap-2">
								<span class="min-w-0 flex-1 text-xs font-medium break-words text-foreground"
									>{entry.title}</span
								>
								{#if entry.count > 1}
									<span class="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums"
										>×{entry.count}</span
									>
								{/if}
								<span class="shrink-0 text-[10px] text-muted-foreground"
									>{formatRelativeTime(entry.lastAt, now)}</span
								>
							</div>
							{#each entry.details as detail, i (i)}
								<p class="mt-0.5 text-[11px] break-words whitespace-pre-line text-muted-foreground">
									{detail}
								</p>
							{/each}
							{#if entry.errorLogId}
								{@const errorLogId = entry.errorLogId}
								<button
									class="mt-0.5 text-[11px] text-primary hover:underline"
									onclick={() => openErrorLog(errorLogId)}
								>
									Details
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Popover.Content>
</Popover.Root>
