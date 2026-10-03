<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		EditorViewContext,
		setEditorViewContext,
	} from '$lib/components/Editor/context/EditorViewContext.svelte';
	import { setEditorDocumentSession } from '$lib/components/Editor/context/EditorDocumentSession.svelte';
	import { createTutorialDesign } from './TutorialPartFactory';

	type Props = {
		children: import('svelte').Snippet;
	};

	let { children }: Props = $props();

	const editorViewContext = new EditorViewContext();
	const design = createTutorialDesign();

	editorViewContext.session.replaceCurrentDocumentForTesting(design.doc);
	editorViewContext.setActiveRegion(design.region.id);
	setEditorViewContext(editorViewContext);
	setEditorDocumentSession(editorViewContext.session);

	onDestroy(() => {
		editorViewContext.destroy();
	});
</script>

{@render children()}
