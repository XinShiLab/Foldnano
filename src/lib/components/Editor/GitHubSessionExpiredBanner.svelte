<script lang="ts">
	import { githubAuth, loginWithGitHub } from '$lib/services/github/auth.svelte';
	import { getEditorDocumentSession } from './context/EditorDocumentSession.svelte';

	const session = getEditorDocumentSession();

	async function signInAgain() {
		// Sign-in leaves the page; make sure the design is stored first.
		await session.saveDocumentToLocalStorage({ skipPristineBlank: true });
		loginWithGitHub(window.location.pathname + window.location.search);
	}
</script>

<div
	role="alert"
	class="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 shadow-md dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
>
	<span class="font-medium">Your GitHub session has expired.</span>
	<span class="text-amber-700 dark:text-amber-300">
		Sign in again to commit or pull. Your work is saved in this browser.
	</span>
	<span class="flex shrink-0 gap-2">
		<button
			class="rounded border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-medium hover:bg-amber-200 dark:border-amber-600 dark:bg-amber-900 dark:hover:bg-amber-800"
			onclick={signInAgain}>Sign in again</button
		>
		<button
			class="rounded px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
			onclick={() => (githubAuth.sessionExpired = false)}>Dismiss</button
		>
	</span>
</div>
