<script lang="ts">
	import type { EditorMode } from '$lib/canvasEditor/core/modes';
	import { setTutorialState, TutorialState } from './tutorialContext.svelte';

	type Props = {
		initialMode?: EditorMode;
		children: import('svelte').Snippet;
	};

	let { initialMode = 'SELECT', children }: Props = $props();

	const tutorial = new TutorialState(initialMode);
	setTutorialState(tutorial);
</script>

<div class="tutorial-controller">
	{@render children()}
</div>
