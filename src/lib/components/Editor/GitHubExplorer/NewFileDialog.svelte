<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import type { FileNode } from './types';
	import { validateFileStem } from './fileNaming';

	interface Props {
		open: boolean;
		selectedFolderPath: string;
		fileTree: FileNode[];
		onCreated: (path: string, node: FileNode) => void;
	}

	let { open = $bindable(), selectedFolderPath, fileTree, onCreated }: Props = $props();

	const session = getEditorDocumentSession();

	let fileName = $state('');
	let chosenFolder = $state('');
	let creating = $state(false);
	let validationError = $state('');

	// Reset state and pre-fill folder each time the dialog opens
	$effect(() => {
		if (open) {
			fileName = '';
			chosenFolder = selectedFolderPath;
			validationError = '';
		}
	});

	// Collect all folder paths from the tree recursively
	function collectFolderPaths(nodes: FileNode[]): string[] {
		const paths: string[] = [];
		function walk(ns: FileNode[]) {
			for (const n of ns) {
				if (n.type === 'folder') {
					paths.push(n.path);
					if (n.children) walk(n.children);
				}
			}
		}
		walk(nodes);
		return paths.sort();
	}

	const folderOptions = $derived(collectFolderPaths(fileTree));

	async function handleCreate() {
		const trimmed = fileName.trim();
		const invalid = validateFileStem(trimmed);
		if (invalid) {
			validationError = invalid;
			return;
		}
		creating = true;
		validationError = '';
		try {
			const path = await session.createNewLocalDocument(trimmed, chosenFolder);
			const node: FileNode = {
				name: trimmed + '.fn.json',
				path,
				type: 'file',
				sha: '',
				localOnly: true,
			};
			onCreated(path, node);
			open = false;
		} catch (e) {
			validationError = (e as Error).message || 'Failed to create document.';
		} finally {
			creating = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>New Design File</Dialog.Title>
			<Dialog.Description>
				Creates a blank design saved locally. Commit to GitHub when ready.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-3 py-2">
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground" for="new-file-name"
					>File name</label
				>
				<div class="flex items-center gap-1.5">
					<Input
						id="new-file-name"
						placeholder="my-design"
						bind:value={fileName}
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter') handleCreate();
						}}
						class="flex-1"
					/>
					<span class="shrink-0 text-xs text-muted-foreground">.fn.json</span>
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground" for="new-file-folder">Folder</label
				>
				<select
					id="new-file-folder"
					class="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
					bind:value={chosenFolder}
				>
					<option value="">/ (root)</option>
					{#each folderOptions as folder (folder)}
						<option value={folder}>{folder}</option>
					{/each}
				</select>
			</div>

			{#if validationError}
				<p class="text-xs text-red-500">{validationError}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleCreate} disabled={creating}>
				{creating ? 'Creating…' : 'Create'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
