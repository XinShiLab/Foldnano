<script lang="ts">
	import { Megaphone } from '@lucide/svelte';

	import { guideHref } from '$lib/components/help/help';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PendingAnnouncement } from '$lib/whats-new/entries';

	let {
		pending,
		onDismiss,
		onOpenWhatsNew,
	}: {
		pending: PendingAnnouncement;
		onDismiss: () => void;
		onOpenWhatsNew: () => void;
	} = $props();

	const announcement = $derived(pending.announcement);
	const readMoreHref = $derived(pending.link ? guideHref(pending.link) : null);

	function openWhatsNew() {
		onOpenWhatsNew();
		onDismiss();
	}
</script>

<aside
	aria-label="Announcement"
	class="border border-border bg-card p-4 text-sm text-card-foreground shadow-lg"
>
	<div class="flex items-start gap-3">
		<Megaphone class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
		<div class="space-y-2">
			<p class="font-semibold">{announcement.title}</p>
			<p>{announcement.body}</p>
			{#if pending.earlierCount > 0}
				<button
					type="button"
					class="text-muted-foreground underline underline-offset-2 hover:text-foreground"
					onclick={openWhatsNew}
				>
					And {pending.earlierCount} earlier
					{pending.earlierCount === 1 ? 'update' : 'updates'}
				</button>
			{/if}
			<div class="flex items-center gap-3">
				<Button size="sm" onclick={onDismiss}>Got it</Button>
				{#if readMoreHref}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- guideHref() uses resolve() -->
					<a
						href={readMoreHref}
						target="_blank"
						rel="noopener"
						class="text-muted-foreground underline underline-offset-2 hover:text-foreground"
						onclick={onDismiss}>Read more</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{:else}
					<button
						type="button"
						class="text-muted-foreground underline underline-offset-2 hover:text-foreground"
						onclick={openWhatsNew}>Read more</button
					>
				{/if}
			</div>
		</div>
	</div>
</aside>
