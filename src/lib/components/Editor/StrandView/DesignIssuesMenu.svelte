<script lang="ts">
	import { ShieldAlert } from '@lucide/svelte/icons';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { help } from '$lib/components/help/help';
	import type { DesignIssue } from '$lib/model/checks/designIssue';
	import type { DesignCheckSelection } from '$lib/model/checks/collect';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	const editorViewContext = getEditorViewContext();
	const checks = $derived(editorViewContext.strandViewContext.designChecks);
	const issues = $derived(editorViewContext.designIssues);
	const shown = $derived(issues.filter((issue) => issue.severity !== 'info'));
	const errorCount = $derived(shown.filter((issue) => issue.severity === 'error').length);

	// A long list is a sign of one systematic problem; the first entries are enough to find it.
	const MAX_LISTED = 100;

	const CHECKS: { key: keyof DesignCheckSelection; label: string; hint: string }[] = [
		{ key: 'integrity', label: 'Editor rules', hint: "States the editor wouldn't create itself" },
		{ key: 'simulation', label: 'Simulation export', hint: 'What oxDNA / mrDNA export refuses' },
		{ key: 'cadnano', label: 'Cadnano export', hint: 'What cadnano JSON loses, active region' },
	];

	const DOT = { error: 'bg-destructive', warning: 'bg-amber-500', info: 'bg-muted-foreground' };

	function jumpTo(issue: DesignIssue): void {
		const vhId = issue.anchor?.vhId;
		if (!vhId) return;
		editorViewContext.strandToolbarController?.centerOn(vhId, issue.anchor?.bp ?? 0);
	}
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				size="sm"
				class="h-7 gap-1 px-1.5"
				title="Design checks"
				{@attach help({
					title: 'Design checks',
					text: "Marks spots the editor wouldn't create itself, or that simulation or cadnano export can't handle. Choose which checks to show; click an issue to jump to it.",
					doc: 'creating-a-design',
				})}
			>
				<ShieldAlert
					class={errorCount > 0
						? 'text-destructive'
						: shown.length > 0
							? 'text-amber-600'
							: 'text-muted-foreground'}
				/>
				{#if shown.length > 0}
					<span class="font-mono text-xs tabular-nums">{shown.length}</span>
				{/if}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-96 p-3" align="start">
		<div class="space-y-2">
			<p class="text-sm font-medium">Design checks</p>
			{#each CHECKS as check (check.key)}
				<div class="flex items-center justify-between gap-2">
					<Label for={`design-check-${check.key}`} class="flex flex-col items-start gap-0">
						<span class="text-xs">{check.label}</span>
						<span class="text-[10px] font-normal text-muted-foreground">{check.hint}</span>
					</Label>
					<Switch
						id={`design-check-${check.key}`}
						checked={checks[check.key]}
						onCheckedChange={(on) =>
							(editorViewContext.strandViewContext.designChecks[check.key] = on)}
					/>
				</div>
			{/each}
		</div>
		<div class="mt-3 border-t pt-2">
			{#if shown.length === 0}
				<p class="text-xs text-muted-foreground">Nothing to report for the selected checks.</p>
			{:else}
				<ul class="max-h-72 space-y-1 overflow-y-auto">
					{#each shown.slice(0, MAX_LISTED) as issue, i (i)}
						<li>
							<button
								type="button"
								class="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
								disabled={!issue.anchor?.vhId}
								onclick={() => jumpTo(issue)}
							>
								<span class={`mt-1 size-2 shrink-0 rounded-full ${DOT[issue.severity]}`}></span>
								<span>{issue.message}</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if shown.length > MAX_LISTED}
					<p class="mt-1 text-[10px] text-muted-foreground">
						…and {shown.length - MAX_LISTED} more.
					</p>
				{/if}
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>
