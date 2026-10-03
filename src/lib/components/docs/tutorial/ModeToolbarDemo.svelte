<script lang="ts">
	import { getEditorViewContext } from '$lib/components/Editor/context/EditorViewContext.svelte';
	import EditorModeToggleGroup from '$lib/components/Editor/Toolbar/EditorModeToggleGroup.svelte';
	import { getTutorialState } from './tutorialContext.svelte';
	import { getTutorialModeInfo, STRAND_TUTORIAL_MODES } from './tutorialData';
	import TutorialCallout from './TutorialCallout.svelte';
	import type { EditorMode } from '$lib/canvasEditor/core/modes';

	const editorViewContext = getEditorViewContext();
	const tutorial = getTutorialState();

	$effect(() => {
		if (editorViewContext.editorMode !== tutorial.activeMode) {
			editorViewContext.editorMode = tutorial.activeMode;
		}
	});

	function setMode(mode: EditorMode) {
		tutorial.setActiveMode(mode);
		editorViewContext.editorMode = mode;
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center gap-3">
		<EditorModeToggleGroup
			modes={STRAND_TUTORIAL_MODES}
			buttonSize="default"
			value={tutorial.activeMode}
			onModeChange={setMode}
			getTutorialId={(mode) => getTutorialModeInfo(mode).id}
			activeTutorialId={tutorial.highlightedTarget}
		/>
	</div>
	<TutorialCallout />
</div>
