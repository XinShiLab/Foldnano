<script lang="ts">
	const steps = [
		['Edit', 'Every command updates the in-browser working copy.'],
		['Autosave', 'Foldnano writes to IndexedDB after edits or elapsed time.'],
		['Stage', 'Choose which saved file content should be prepared for GitHub.'],
		['Commit', 'Write an explicit commit with a message straight to the branch on GitHub.'],
	];
</script>

<div class="not-prose my-6 border border-border bg-card p-4 print:border-neutral-300">
	<div class="grid gap-3 md:grid-cols-4">
		{#each steps as step, index (step[0])}
			<section class="border border-border bg-background p-3">
				<div class="mb-2 font-mono text-xs text-muted-foreground">0{index + 1}</div>
				<h3 class="m-0 text-sm font-semibold">{step[0]}</h3>
				<p class="mt-2 text-xs text-muted-foreground">{step[1]}</p>
			</section>
		{/each}
	</div>
	<p class="mt-3 text-xs text-muted-foreground">
		Autosave stops at the browser working copy. GitHub changes happen only when you stage and
		commit.
	</p>
</div>
