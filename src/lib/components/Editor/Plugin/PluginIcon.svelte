<script lang="ts">
	import { pluginIconDataUrl } from '$lib/plugin/pluginIcon';

	interface Props {
		/** Validated SVG text (`PythonPlugin.iconSvg`). */
		svg: string;
		size?: number;
		class?: string;
	}

	let { svg, size = 20, class: className = '' }: Props = $props();

	// A CSS mask draws the SVG in the current text colour and can't run scripts or fetch files.
	const mask = $derived(`url("${pluginIconDataUrl(svg)}") center / contain no-repeat`);
</script>

<span
	class="inline-block shrink-0 bg-current {className}"
	style:width="{size}px"
	style:height="{size}px"
	style:mask
	style:-webkit-mask={mask}
	aria-hidden="true"
></span>
