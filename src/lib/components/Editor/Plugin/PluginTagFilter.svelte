<script lang="ts">
	import { help } from '$lib/components/help/help';
	import type { TagCount } from '$lib/plugin/pluginTags';
	import { Switch } from '$lib/components/ui/switch/index.js';

	let {
		tags,
		selected,
		onToggleTag,
		hasDemos,
		showDemos = $bindable(false),
	}: {
		/** Chips to offer; the Demo tag has the switch instead, so it isn't listed here. */
		tags: readonly TagCount[];
		selected: ReadonlySet<string>;
		onToggleTag: (key: string) => void;
		hasDemos: boolean;
		showDemos?: boolean;
	} = $props();
</script>

<div class="flex flex-wrap items-center gap-1">
	{#each tags as tag (tag.key)}
		{@const on = selected.has(tag.key)}
		<button
			type="button"
			aria-pressed={on}
			class="rounded-full border px-2 text-[11px] leading-5 transition-colors {on
				? 'border-primary bg-primary text-primary-foreground'
				: 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'}"
			onclick={() => onToggleTag(tag.key)}
		>
			{tag.label}
			<span class={on ? 'opacity-80' : 'text-muted-foreground/70'}>{tag.count}</span>
		</button>
	{/each}
	{#if hasDemos}
		<label
			class="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
			{@attach help({
				title: 'Show demos',
				text: 'Turn on to show the example plugins tagged Demo. They are hidden by default.',
			})}
		>
			<Switch bind:checked={showDemos} size="sm" />
			Show demos
		</label>
	{/if}
</div>
