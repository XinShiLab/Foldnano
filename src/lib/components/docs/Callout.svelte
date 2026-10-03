<script lang="ts">
	import type { Snippet } from 'svelte';
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Construction from '@lucide/svelte/icons/construction';

	type CalloutType = 'tip' | 'note' | 'warning' | 'limit';

	let {
		type = 'note',
		title,
		children,
	}: { type?: CalloutType; title?: string; children: Snippet } = $props();

	const variants = {
		tip: {
			icon: Lightbulb,
			label: 'Tip',
			classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100',
			iconClass: 'text-emerald-600 dark:text-emerald-400',
		},
		note: {
			icon: Info,
			label: 'Note',
			classes: 'border-sky-500/30 bg-sky-500/10 text-sky-950 dark:text-sky-100',
			iconClass: 'text-sky-600 dark:text-sky-400',
		},
		warning: {
			icon: TriangleAlert,
			label: 'Warning',
			classes: 'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100',
			iconClass: 'text-amber-600 dark:text-amber-400',
		},
		limit: {
			icon: Construction,
			label: 'Current limitation',
			classes: 'border-orange-500/30 bg-orange-500/10 text-orange-950 dark:text-orange-100',
			iconClass: 'text-orange-600 dark:text-orange-400',
		},
	} as const;

	const variant = $derived(variants[type]);
	const Icon = $derived(variant.icon);
	const heading = $derived(title ?? variant.label);
</script>

<div class={`not-prose my-5 flex gap-3 rounded-lg border p-4 text-sm ${variant.classes}`}>
	<Icon class={`mt-0.5 size-5 shrink-0 ${variant.iconClass}`} />
	<div
		class="callout-body min-w-0 leading-relaxed *:first:mt-0 *:last:mb-0 [&_a]:font-medium [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-white/10 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5"
	>
		<p class="mb-1 font-semibold">{heading}</p>
		{@render children()}
	</div>
</div>
