<script lang="ts">
	import type { EditorMode } from '$lib/canvasEditor/core/modes';
	import { cn } from '$lib/utils/utils';
	import { getTutorialState, type TutorialPanelId } from './tutorialContext.svelte';
	import { getTutorialModeInfo } from './tutorialData';

	type Props = {
		id: string;
		target: string;
		mode: EditorMode;
		panel?: TutorialPanelId;
		caption?: string;
		children: import('svelte').Snippet;
	};

	let { id, target, mode, panel, caption = '', children }: Props = $props();

	const tutorial = getTutorialState();
	const resolvedPanel = $derived(panel ?? getTutorialModeInfo(mode).panel);
	const isActive = $derived(tutorial.activeStepId === id || tutorial.highlightedTarget === target);
	const isLocked = $derived(tutorial.lockedStepId === id);

	function stepState() {
		return {
			id,
			target,
			mode,
			panel: resolvedPanel,
			caption,
		};
	}

	function focusStep() {
		tutorial.focusStep(stepState());
	}

	function lockStep() {
		tutorial.lockStep(stepState());
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		lockStep();
	}
</script>

<button
	type="button"
	class={cn(
		'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
		isActive
			? 'border-primary/60 bg-primary/10 text-foreground'
			: 'border-border bg-background hover:bg-muted/60',
		isLocked && 'ring-1 ring-primary'
	)}
	onmouseenter={focusStep}
	onfocus={focusStep}
	onclick={lockStep}
	onkeydown={handleKeydown}
>
	{@render children()}
</button>
