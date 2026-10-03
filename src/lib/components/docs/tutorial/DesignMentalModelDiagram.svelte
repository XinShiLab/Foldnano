<script lang="ts">
	const levels = [
		{
			title: 'Document',
			detail: 'Named browser working copy plus editor state.',
			items: ['Saved in IndexedDB', 'Exportable as .fn.json'],
		},
		{
			title: 'Part',
			detail: 'The mutation owner for the DNA model.',
			items: ['Owns regions', 'Owns oligos', 'Receives commands'],
		},
		{
			title: 'Design Regions',
			detail: 'Lattice or freeform work areas attached to planes.',
			items: ['Honeycomb', 'Square', 'Freeform'],
		},
		{
			title: 'Virtual Helices',
			detail: 'Addressable helices that carry strand sets.',
			items: ['Placed by region', 'Frame from plane', 'Stable id'],
		},
		{
			title: 'Oligos',
			detail: 'Connected DNA paths made of ordered segments.',
			items: ['Explicit scaffold flag', 'Color/name/sequence', '5 prime to 3 prime'],
		},
		{
			title: 'Segments And Ends',
			detail: 'Editable spans and connection points.',
			items: ['Move ends', 'Break segments', 'Connect 3 prime to 5 prime'],
		},
	];
</script>

<div class="not-prose my-6 border border-border bg-card p-4 print:border-neutral-300">
	<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
		{#each levels as level, index (level.title)}
			<section class="border border-border bg-background p-3">
				<div class="mb-2 flex items-center gap-2">
					<span
						class="grid size-6 shrink-0 place-items-center border border-border bg-muted font-mono text-xs"
					>
						{index + 1}
					</span>
					<h3 class="m-0 text-sm font-semibold">{level.title}</h3>
				</div>
				<p class="mb-2 text-sm text-muted-foreground">{level.detail}</p>
				<ul class="m-0 space-y-1 pl-4 text-xs text-muted-foreground">
					{#each level.items as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</div>
