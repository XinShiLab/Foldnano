<script lang="ts">
	import { Ban, Upload } from '@lucide/svelte';
	import { PLUGIN_ICON_PRESETS } from '$lib/plugin/pluginIconPresets';
	import { MAX_PLUGIN_ICON_BYTES, validatePluginIconSvg } from '$lib/plugin/pluginIcon';
	import PluginIcon from './PluginIcon.svelte';

	let {
		value = $bindable(null),
		id,
	}: {
		/** Selected SVG text; null for no icon. */
		value?: string | null;
		id?: string;
	} = $props();

	let error: string | null = $state(null);
	let fileInput: HTMLInputElement | undefined = $state();

	const isPreset = $derived(PLUGIN_ICON_PRESETS.some((preset) => preset.svg === value));
	const uploaded = $derived(value !== null && !isPreset ? value : null);

	function choose(svg: string | null) {
		value = svg;
		error = null;
	}

	async function upload(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			if (file.size > MAX_PLUGIN_ICON_BYTES) {
				throw new Error(`The icon is larger than ${MAX_PLUGIN_ICON_BYTES / 1024} KB.`);
			}
			choose(validatePluginIconSvg(await file.text()));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	const cell =
		'flex h-8 w-8 items-center justify-center rounded border transition-colors hover:bg-accent hover:text-foreground';
	const cellState = (selected: boolean) =>
		selected
			? 'border-primary bg-accent text-foreground'
			: 'border-transparent text-muted-foreground';
</script>

<div {id} class="space-y-1.5" role="radiogroup" aria-label="Plugin icon">
	<div class="flex flex-wrap gap-1">
		<button
			type="button"
			role="radio"
			aria-checked={value === null}
			class="{cell} {cellState(value === null)}"
			title="No icon"
			onclick={() => choose(null)}
		>
			<Ban size={16} />
		</button>
		{#each PLUGIN_ICON_PRESETS as preset (preset.id)}
			<button
				type="button"
				role="radio"
				aria-checked={value === preset.svg}
				class="{cell} {cellState(value === preset.svg)}"
				title={preset.label}
				onclick={() => choose(preset.svg)}
			>
				<PluginIcon svg={preset.svg} size={16} />
			</button>
		{/each}
		{#if uploaded}
			<button
				type="button"
				role="radio"
				aria-checked="true"
				class="{cell} {cellState(true)}"
				title="Uploaded icon"
			>
				<PluginIcon svg={uploaded} size={16} />
			</button>
		{/if}
		<button
			type="button"
			class="{cell} {cellState(false)}"
			title="Upload an SVG icon"
			onclick={() => fileInput?.click()}
		>
			<Upload size={16} />
		</button>
		<input
			bind:this={fileInput}
			type="file"
			accept=".svg,image/svg+xml"
			class="hidden"
			onchange={upload}
		/>
	</div>
	{#if error}
		<p class="text-xs text-destructive">{error}</p>
	{/if}
</div>
