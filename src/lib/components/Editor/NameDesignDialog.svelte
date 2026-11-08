<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { UNTITLED_DOCUMENT_NAME, designNameKey } from '$lib/model/io/designFileName';
	import { getEditorDocumentSession } from './context/EditorDocumentSession.svelte';
	import { getEditorViewContext } from './context/EditorViewContext.svelte';

	const session = getEditorDocumentSession();
	const editorViewContext = getEditorViewContext();

	// Required: "Untitled Document" is the blank workspace, so a design with content can't keep it.
	const open = $derived(
		session.isTabOwner &&
			session.needsName &&
			!session.isLoading &&
			!session.loadFailure &&
			!session.pendingUrlSave
	);
	// A design stored under the reserved name before it was reserved.
	const wasSaved = $derived(!!session.lastLocalPersistAt);

	let name = $state('');
	let error = $state('');
	let clashWarning = $state('');
	let acceptedClashKey = $state('');
	let saving = $state(false);

	$effect(() => {
		if (open) {
			name = '';
			error = '';
			clashWarning = '';
			acceptedClashKey = '';
		}
	});

	async function save() {
		if (saving) return;
		const trimmed = name.trim();
		saving = true;
		try {
			const check = await session.checkRename(trimmed);
			if (check.kind === 'unchanged') {
				error = 'Name is required.';
				return;
			}
			if (check.kind === 'blocked') {
				error = check.message;
				return;
			}
			error = '';
			if (check.nameClash && acceptedClashKey !== designNameKey(check.name)) {
				clashWarning = `Another saved design is already named "${check.nameClash}". Save anyway, or pick another name.`;
				acceptedClashKey = designNameKey(check.name);
				return;
			}
			const result = await session.renameDocument(check.name);
			if (result.kind === 'local-only-file-renamed') editorViewContext.localOnlyEntriesVersion++;
			if (result.kind === 'repo-file-renamed') editorViewContext.repoTreeVersion++;
		} catch (e) {
			error = (e as Error).message || "Couldn't save the name.";
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root {open}>
	<Dialog.Content
		class="sm:max-w-sm"
		showCloseButton={false}
		escapeKeydownBehavior="ignore"
		interactOutsideBehavior="ignore"
	>
		<Dialog.Header>
			<Dialog.Title>Name this design</Dialog.Title>
			<Dialog.Description>
				{#if wasSaved}
					This design was saved as "{UNTITLED_DOCUMENT_NAME}". Give it a name to keep saving
					changes.
				{:else}
					Your design is saved in this browser once it has a name. "{UNTITLED_DOCUMENT_NAME}" is
					kept for the empty workspace.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-1 py-2">
			<label class="text-xs font-medium text-muted-foreground" for="name-design-input">Name</label>
			<Input
				id="name-design-input"
				placeholder="my-design"
				bind:value={name}
				oninput={() => {
					error = '';
					clashWarning = '';
				}}
				onkeydown={(e: KeyboardEvent) => {
					if (e.key === 'Enter') save();
				}}
			/>
			{#if error}
				<p class="text-xs text-red-500">{error}</p>
			{:else if clashWarning}
				<p class="text-xs text-amber-600 dark:text-amber-500">{clashWarning}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button onclick={save} disabled={saving || !name.trim()}>
				{clashWarning ? 'Save Anyway' : 'Save'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
