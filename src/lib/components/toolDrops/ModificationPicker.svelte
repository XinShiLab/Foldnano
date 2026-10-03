<script lang="ts">
	import * as Kbd from '$lib/components/ui/kbd/index.js';

	// interface Props {
	// }
</script>

<div
	class="relative -z-1 flex min-w-20 flex-row items-center gap-2 overflow-hidden rounded-sm border bg-white px-4 shadow"
>
	<p class="font-mono text-sm text-gray-400">in this doc:</p>
	<div class="my-2 flex max-w-100 flex-row flex-wrap gap-1">
		<div class="flex h-5 flex-none rounded-sm px-1 font-mono text-sm">
			<span class="flex h-5 flex-none rounded-sm bg-gray-200 px-1 font-mono text-sm">/CY3/</span>:
			20
		</div>
		<div class="flex h-5 flex-none rounded-sm px-1 font-mono text-sm">
			<span class="flex h-5 flex-none rounded-sm bg-gray-200 px-1 font-mono text-sm">/CY5/</span>:
			10
		</div>
		<div class="flex h-5 flex-none rounded-sm px-1 font-mono text-sm">
			<span class="flex h-5 flex-none rounded-sm bg-gray-200 px-1 font-mono text-sm">/chol/</span>:
			5
		</div>
	</div>

	<div class="flex h-5 w-1 flex-none border-l-2"></div>

	<div class="flex h-5 flex-none rounded-sm font-mono text-sm">
		add: <input type="text" placeholder=" new mod" class="mx-1 w-20" /><Kbd.Root>⏎</Kbd.Root>
	</div>
</div>
