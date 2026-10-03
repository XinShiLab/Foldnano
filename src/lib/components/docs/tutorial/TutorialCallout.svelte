<script lang="ts">
	import { getTutorialState } from './tutorialContext.svelte';
	import { getTutorialModeInfo } from './tutorialData';

	const tutorial = getTutorialState();
	const info = $derived(getTutorialModeInfo(tutorial.activeMode));
</script>

<aside class="rounded-md border border-border bg-muted/30 p-3 text-sm">
	<div class="flex flex-wrap items-center gap-2">
		<span class="font-semibold">{info.label}</span>
		<span
			class="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
		>
			{info.shortcut}
		</span>
	</div>
	<p class="mt-2 text-muted-foreground">{tutorial.activeCaption}</p>
</aside>
