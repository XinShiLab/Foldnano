<script lang="ts">
	import type { DiffHunk } from '$lib/services/github/diff';

	interface Props {
		hunk: DiffHunk;
		/** How many context lines to show on each side of collapsed equal blocks */
		contextLines?: number;
	}

	let { hunk, contextLines = 3 }: Props = $props();

	let expanded = $state(false);

	const isCollapsible = $derived(hunk.type === 'equal' && hunk.lines.length > contextLines * 2 + 1);

	const visibleLines = $derived(
		isCollapsible && !expanded
			? [
					...hunk.lines.slice(0, contextLines),
					null, // sentinel for the "expand" row
					...hunk.lines.slice(hunk.lines.length - contextLines),
				]
			: hunk.lines
	);

	const hiddenCount = $derived(
		isCollapsible && !expanded ? hunk.lines.length - contextLines * 2 : 0
	);

	const lineClass: Record<string, string> = {
		added: 'bg-green-50 dark:bg-green-950 text-green-900 dark:text-green-100',
		removed: 'bg-red-50 dark:bg-red-950 text-red-900 dark:text-red-100',
		equal: 'bg-background text-foreground',
	};

	const prefixChar: Record<string, string> = {
		added: '+',
		removed: '-',
		equal: ' ',
	};

	function lineNumberFor(index: number): { left: number | null; right: number | null } {
		const h = hunk;
		if (h.type === 'equal') {
			const base = h.leftStart ?? 1;
			const rbase = h.rightStart ?? 1;
			if (isCollapsible && !expanded) {
				if (index < contextLines) {
					return { left: base + index, right: rbase + index };
				} else {
					// after the sentinel
					const offset = h.lines.length - contextLines + (index - contextLines - 1);
					return { left: base + offset, right: rbase + offset };
				}
			}
			return { left: base + index, right: rbase + index };
		} else if (h.type === 'removed') {
			return { left: (h.leftStart ?? 1) + index, right: null };
		} else {
			return { left: null, right: (h.rightStart ?? 1) + index };
		}
	}
</script>

{#each visibleLines as line, i (i)}
	{#if line === null}
		<!-- Collapsed rows separator -->
		<tr class="cursor-pointer bg-blue-50 hover:bg-blue-100" onclick={() => (expanded = true)}>
			<td class="w-10 border-r border-border px-1 text-right text-[10px] text-blue-400 select-none"
				>…</td
			>
			<td class="w-10 border-r border-border px-1 text-right text-[10px] text-blue-400 select-none"
				>…</td
			>
			<td class="w-4 text-center text-[10px] text-blue-400 select-none"></td>
			<td class="px-2 text-xs text-blue-500 italic">
				{hiddenCount} unchanged lines — click to expand
			</td>
		</tr>
	{:else}
		{@const nums = lineNumberFor(i)}
		<tr class={lineClass[hunk.type]}>
			<td
				class="w-10 border-r border-border px-1 text-right font-mono text-[10px] leading-5 text-muted-foreground select-none"
			>
				{nums.left ?? ''}
			</td>
			<td
				class="w-10 border-r border-border px-1 text-right font-mono text-[10px] leading-5 text-muted-foreground select-none"
			>
				{nums.right ?? ''}
			</td>
			<td
				class="w-4 text-center font-mono text-[10px] leading-5 select-none {hunk.type === 'added'
					? 'text-green-600'
					: hunk.type === 'removed'
						? 'text-red-500'
						: 'text-muted-foreground'}"
			>
				{prefixChar[hunk.type]}
			</td>
			<td class="px-2 font-mono text-xs leading-5 whitespace-pre">{line}</td>
		</tr>
	{/if}
{/each}
