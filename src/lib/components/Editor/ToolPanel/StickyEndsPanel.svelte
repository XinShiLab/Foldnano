<script lang="ts">
	import { tick } from 'svelte';
	import { Eye, EyeOff, Link2, Minus, Plus, Unlink2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { Part } from '$lib/model/Part';
	import {
		MIN_STICKY_LENGTH,
		sidePositions,
		type StickyBase,
	} from '$lib/model/stickyEnds/stickyEnds';
	import type { StickyList, StickyPairStatus } from '$lib/model/stickyEnds/stickyPairs';
	import {
		removeStickyRecordCmd,
		saveStickyMatchCmd,
		stickyMatchBlocker,
	} from '$lib/commands/stickyEnds';
	import type {
		ColoredStickyMatch,
		SavedStickyRecord,
	} from '$lib/services/stickyEnds/StickyEndMatcher.svelte';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	type Props = { part: Part };
	let { part }: Props = $props();

	const ctx = getEditorViewContext();
	const strandCtx = $derived(ctx.strandViewContext);
	const matcher = ctx.stickyEnds;
	const fresh = $derived(matcher.matches.filter((m) => m.state === 'new'));
	const paired = $derived(matcher.saved.filter((r) => r.list === 'pairs'));
	const ignored = $derived(matcher.saved.filter((r) => r.list === 'ignored'));
	const severalParts = $derived(ctx.currentDoc.parts.length > 1);
	// The line choice only matters once a Part is placed more than once.
	const severalInstances = $derived(
		ctx.currentDoc.parts.some((p) => ctx.currentDoc.assembly.occurrencesOf(p.id).length > 1)
	);
	// Long lists are capped: the count above says how many there are.
	const SHOWN = 200;
	const NO_MATCH_COLOR = 'var(--muted-foreground)';

	const STATUS: Record<StickyPairStatus, { label: string; tone: string }> = {
		matching: { label: 'matching', tone: 'text-muted-foreground' },
		partial: { label: 'partly matching', tone: 'text-amber-600 dark:text-amber-400' },
		broken: { label: 'no longer matching', tone: 'text-destructive' },
		missing: { label: 'a side is gone', tone: 'text-destructive' },
		noSequence: { label: 'no sequence yet', tone: 'text-amber-600 dark:text-amber-400' },
	};

	const MAX_LENGTH = 40;
	function setMinLength(value: number) {
		if (!Number.isFinite(value)) return;
		strandCtx.stickyEndMinLength = Math.min(MAX_LENGTH, Math.max(MIN_STICKY_LENGTH, value));
	}

	function where(partId: string, positions: StickyBase[]): string {
		const first = positions[0];
		const last = positions[positions.length - 1];
		const sidePart = ctx.currentDoc.parts.find((p) => p.id === partId);
		const vh = sidePart?.getVhById(first.vhId);
		const bps =
			first.vhId === last.vhId
				? `bp ${Math.min(first.bpIndex, last.bpIndex)}–${Math.max(first.bpIndex, last.bpIndex)}`
				: `bp ${first.bpIndex}…`;
		const helix = vh ? `H${vh.index} ${bps}` : bps;
		return severalParts && sidePart ? `${sidePart.name} · ${helix}` : helix;
	}

	/** Sides as `[partId, positions]`, for a match or a saved record (null where a side is gone). */
	function sidesOf(entry: ColoredStickyMatch | SavedStickyRecord) {
		if ('key' in entry) {
			const sides = entry.self ? [entry.a] : [entry.a, entry.b];
			return sides.map((s) => ({ partId: s.run.partId, positions: sidePositions(s) }));
		}
		const [a, b] = entry.sides;
		const self = a && b && a.part === b.part && a.oligoId === b.oligoId && a.start === b.start;
		return (self ? [a] : [a, b]).map((s) => s && { partId: s.part.id, positions: s.positions });
	}

	/** Shows a side in the strand view: the one in the active Part, else switches to its Part. */
	async function show(entry: ColoredStickyMatch | SavedStickyRecord) {
		const sides = sidesOf(entry).filter(
			(s): s is NonNullable<typeof s> => s !== null && s.positions.length > 0
		);
		const side = sides.find((s) => s.partId === part.id) ?? sides[0];
		if (!side) return;
		if (side.partId !== part.id) ctx.setActivePart(side.partId);
		await tick();
		const [first] = side.positions;
		ctx.strandToolbarController?.centerOn(first.vhId, first.bpIndex);
	}

	function save(match: ColoredStickyMatch, list: StickyList) {
		saveStickyMatchCmd(ctx.historyStack, ctx.currentDoc, match, list);
	}

	function remove(saved: SavedStickyRecord) {
		removeStickyRecordCmd(
			ctx.historyStack,
			ctx.currentDoc,
			saved.home,
			saved.list,
			saved.record.id
		);
	}

	function hover(key: string | undefined) {
		if (key) matcher.hoveredKey = key;
	}
	function unhover(key: string | undefined) {
		if (key && matcher.hoveredKey === key) matcher.hoveredKey = null;
	}
</script>

{#snippet sideLines(entry: ColoredStickyMatch | SavedStickyRecord)}
	{@const sides = sidesOf(entry)}
	<span class="min-w-0 flex-1">
		{#each sides as side, i (i)}
			<span class="block truncate" class:text-muted-foreground={!side}>
				{i > 0 ? '⇄ ' : ''}{side ? where(side.partId, side.positions) : 'gone'}
			</span>
		{/each}
		{#if sides.length === 1}
			<span class="block truncate text-muted-foreground">self-complementary</span>
		{/if}
	</span>
{/snippet}

{#snippet header(title: string, count: number)}
	<div class="flex items-center justify-between border-t border-border pt-2">
		<span class="font-semibold">{title} <span class="tabular-nums">{count}</span></span>
		{#if count > SHOWN}
			<span class="text-muted-foreground">first {SHOWN} listed</span>
		{/if}
	</div>
{/snippet}

<div class="flex flex-col gap-3">
	<p class="text-muted-foreground">
		Single-stranded stretches whose sequences can bind each other, found from the sequences alone.
		Pair the ones you mean, so the design checks warn when an edit breaks them; ignore the rest.
	</p>

	<div class="flex items-center justify-between gap-2">
		<Label for="sticky-min-length">Shortest match</Label>
		<div class="flex items-center gap-1">
			<Button
				variant="outline"
				size="icon-sm"
				aria-label="Shorter"
				disabled={strandCtx.stickyEndMinLength <= MIN_STICKY_LENGTH}
				onclick={() => setMinLength(strandCtx.stickyEndMinLength - 1)}><Minus /></Button
			>
			<input
				id="sticky-min-length"
				type="number"
				min={MIN_STICKY_LENGTH}
				max={MAX_LENGTH}
				class="h-7 w-12 rounded-md border border-input bg-background text-center tabular-nums"
				value={strandCtx.stickyEndMinLength}
				onchange={(e) => setMinLength(Number(e.currentTarget.value))}
			/>
			<Button
				variant="outline"
				size="icon-sm"
				aria-label="Longer"
				disabled={strandCtx.stickyEndMinLength >= MAX_LENGTH}
				onclick={() => setMinLength(strandCtx.stickyEndMinLength + 1)}><Plus /></Button
			>
			<span class="text-muted-foreground">nt</span>
		</div>
	</div>

	<div class="flex items-center justify-between gap-2">
		<Label for="sticky-show">Show in the views</Label>
		<Switch id="sticky-show" bind:checked={strandCtx.highlightContext.sticky_end_matches} />
	</div>

	{#if severalInstances}
		<div
			class="flex items-center justify-between gap-2"
			title="Off: a 3D line between every pair of instances that could bind. On: one line from each instance to the nearest instance of its partner."
		>
			<Label for="sticky-nearest">One line per instance</Label>
			<Switch
				id="sticky-nearest"
				checked={strandCtx.stickyEndLinkMode === 'nearest'}
				onCheckedChange={(on) => (strandCtx.stickyEndLinkMode = on ? 'nearest' : 'all')}
			/>
		</div>
	{/if}

	{@render header('New', fresh.length)}
	{#if fresh.length === 0}
		<p class="text-muted-foreground">
			{#if matcher.matches.length === 0}
				No single-stranded stretches pair over {strandCtx.stickyEndMinLength} bases or more. Stretches
				without an assigned sequence never match.
			{:else}
				Every match found is paired or ignored.
			{/if}
		</p>
	{:else}
		<ul class="-mx-1 flex flex-col">
			{#each fresh.slice(0, SHOWN) as match (match.key)}
				{@const blocker = stickyMatchBlocker(ctx.currentDoc, match)}
				<li
					class="flex items-start gap-1 rounded px-1 py-1 hover:bg-accent"
					onpointerenter={() => hover(match.key)}
					onpointerleave={() => unhover(match.key)}
				>
					<button
						class="flex min-w-0 flex-1 items-start gap-2 text-left"
						onclick={() => void show(match)}
						title="Show in the strand view"
					>
						<span
							class="mt-0.5 size-3 shrink-0 rounded-sm"
							style:background-color={match.color}
							aria-hidden="true"
						></span>
						{@render sideLines(match)}
						<span class="shrink-0 text-muted-foreground tabular-nums">{match.length} nt</span>
					</button>
					<span class="flex shrink-0" title={blocker ?? undefined}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Pair"
							title={blocker ? undefined : 'Pair: warn me if an edit breaks this match'}
							disabled={!!blocker}
							onclick={() => save(match, 'pairs')}><Link2 /></Button
						>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Ignore"
							title={blocker ? undefined : 'Ignore: hide this match from the list and the views'}
							disabled={!!blocker}
							onclick={() => save(match, 'ignored')}><EyeOff /></Button
						>
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if paired.length > 0}
		{@render header('Paired', paired.length)}
		<ul class="-mx-1 flex flex-col">
			{#each paired.slice(0, SHOWN) as saved (saved.record.id)}
				{@const status = STATUS[saved.status ?? 'missing']}
				<li
					class="flex items-start gap-1 rounded px-1 py-1 hover:bg-accent"
					onpointerenter={() => hover(saved.match?.key)}
					onpointerleave={() => unhover(saved.match?.key)}
				>
					<button
						class="flex min-w-0 flex-1 items-start gap-2 text-left"
						onclick={() => void show(saved)}
						title="Show in the strand view"
					>
						<span
							class="mt-0.5 size-3 shrink-0 rounded-sm"
							style:background-color={saved.match?.color ?? NO_MATCH_COLOR}
							aria-hidden="true"
						></span>
						<span class="flex min-w-0 flex-1 flex-col">
							{@render sideLines(saved)}
							<span class="block truncate {status.tone}">{status.label}</span>
						</span>
						<span class="shrink-0 text-muted-foreground tabular-nums">{saved.record.length} nt</span
						>
					</button>
					{#if saved.editable}
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Unpair"
							title="Unpair"
							onclick={() => remove(saved)}><Unlink2 /></Button
						>
					{:else}
						<span
							class="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
							title="Paired in the design this Part is linked from: unpair it there."
							><Link2 class="size-4" /></span
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if ignored.length > 0}
		{@render header('Ignored', ignored.length)}
		<ul class="-mx-1 flex flex-col">
			{#each ignored.slice(0, SHOWN) as saved (saved.record.id)}
				<li class="flex items-start gap-1 rounded px-1 py-1 text-muted-foreground hover:bg-accent">
					<button
						class="flex min-w-0 flex-1 items-start gap-2 text-left"
						onclick={() => void show(saved)}
						title="Show in the strand view"
					>
						{@render sideLines(saved)}
						<span class="shrink-0 tabular-nums">{saved.record.length} nt</span>
					</button>
					{#if saved.editable}
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Stop ignoring"
							title="Stop ignoring"
							onclick={() => remove(saved)}><Eye /></Button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
