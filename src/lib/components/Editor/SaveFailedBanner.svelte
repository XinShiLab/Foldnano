<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { getEditorDocumentSession } from './context/EditorDocumentSession.svelte';
	import { downloadFoldnanoJson } from './Toolbar/utils';

	const session = getEditorDocumentSession();

	let retrying = $state(false);

	async function retry() {
		retrying = true;
		try {
			const ok = await session.saveDocumentToLocalStorage({ force: true });
			if (ok) toast.success('Saved in this browser');
			else toast.error("Still can't save. Download a copy to keep your work.");
		} finally {
			retrying = false;
		}
	}
</script>

<div
	role="alert"
	class="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-800 shadow-md dark:border-red-800 dark:bg-red-950 dark:text-red-200"
>
	<span class="font-medium">Your changes aren't being saved in this browser.</span>
	<span class="text-red-700 dark:text-red-300">
		Storage may be full or blocked. Download a copy so you don't lose work.
	</span>
	<span class="flex shrink-0 gap-2">
		<button
			class="rounded border border-red-400 bg-red-100 px-2 py-0.5 text-xs font-medium hover:bg-red-200 disabled:opacity-60 dark:border-red-700 dark:bg-red-900 dark:hover:bg-red-800"
			disabled={retrying}
			onclick={retry}>{retrying ? 'Retrying…' : 'Retry'}</button
		>
		<button
			class="rounded border border-red-400 bg-red-100 px-2 py-0.5 text-xs font-medium hover:bg-red-200 dark:border-red-700 dark:bg-red-900 dark:hover:bg-red-800"
			onclick={() => downloadFoldnanoJson(session.currentDoc)}>Download .json</button
		>
	</span>
</div>
