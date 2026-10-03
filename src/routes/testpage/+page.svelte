<script>
	import { generateRandomOKLCHColor, generateOKLCHPalette } from '$lib/model/colorGenerator';

	let color = $state('#000000');
	const clickHandler = () => {
		color = generateRandomOKLCHColor();
	};

	const palette = generateOKLCHPalette(200);
</script>

<div class="flex min-h-screen flex-col items-center justify-center gap-4">
	<h1>This is a test page</h1>
	<button class="h-10 w-10" style:background={color} onclick={() => clickHandler()}>N</button>

	<div class="mt-4 flex w-4/5 flex-row flex-wrap gap-4 overflow-x-auto">
		{#each palette as color (color)}
			<div class="flex h-10 w-10 flex-none" style:background={color}></div>
		{/each}
	</div>
</div>
