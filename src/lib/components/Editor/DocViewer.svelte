<script lang="ts">
	// import { getDocContext, getEditorModeContext } from './context.ts.d';
	import { JsonView } from '@zerodevx/svelte-json-view';

	import { getEditorViewContext } from './context/EditorViewContext.svelte';
	import { getEditorDocumentSession } from './context/EditorDocumentSession.svelte';
	const editorViewContext = getEditorViewContext();
	const session = getEditorDocumentSession();
	// const foldnanoDoc = getDocContext();
	// const editorMode = getEditorModeContext();
</script>

<div
	class="bg-whiterounded-md relative flex h-full max-h-svh w-full flex-col items-start justify-start overflow-auto p-4 font-mono text-sm text-gray-400"
>
	<div>
		<p>EditorMode: {editorViewContext.editorMode}</p>

		<p>foldnanoDoc</p>
		<JsonView json={$state.snapshot(session.currentDoc)} depth={3} />
		<!-- <pre></pre> -->
		<!-- {#each foldnanoDoc.parts as part, partIndex (partIndex)}
			<div class="mb-4">
				<p>Part {partIndex}:</p>
				<div>
					<pre>{JSON.stringify(part, null, 2)}</pre>
				</div>

				<p>.virtualHelices</p>
				{#each part.virtualHelices as vh (vh.index)}
					{@const vh_toshow = `row[${vh.listRow}]: index: ${vh.index}, latticeCoords: { col: ${vh.latticeCoords.col}, row: ${vh.latticeCoords.row} }`}
					<pre>{vh_toshow}</pre>
				{/each}
				<p>.oligos</p>
				<p>  .length {part.oligos.size}</p>
				{#each part.oligos as oligo (oligo.id)}
					{@const oligo_toshow = `3': [${oligo.threePrime?.index}] 5': ${oligo.fivePrime?.index}, in vh: ${oligo.fivePrime?.inVirtualHelix.index}`}
					<pre>{oligo_toshow}</pre>
					<pre>{JSON.stringify(oligo, null, 2)}</pre>
				{/each}
			</div>
		{/each} -->
	</div>
</div>
