<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { LoaderCircle } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import { githubExplorerStateStore } from '$lib/services/storage';
	import type { FileNode } from './types';

	interface Props {
		open: boolean;
		selectedFolderPath: string;
		fileTree: FileNode[];
		onPublished: (path: string) => void;
	}

	let { open = $bindable(), selectedFolderPath, fileTree, onPublished }: Props = $props();

	const session = getEditorDocumentSession();

	const fileName = $derived(session.currentDoc.name + '.fn.json');
	let chosenFolder = $state('');
	let commitMessage = $state('');
	let publishing = $state(false);
	let error = $state('');

	// Collect all folder paths from the tree (same as NewFileDialog)
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

	// When the dialog opens, pre-fill defaults.
	// If the current doc is already tracked as a local-only entry, use that path's folder.
	$effect(() => {
		if (!open) return;
		error = '';
		commitMessage = `Add ${session.currentDoc.name}`;

		const repoCtx = session.currentRepoContext;
		if (repoCtx) {
			const entries = githubExplorerStateStore.getLocalOnlyEntries(repoCtx.owner, repoCtx.repo);
			const existing = entries.find((e) => e.docId === session.currentDoc.id);
			if (existing) {
				const parts = existing.path.split('/');
				chosenFolder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
			} else {
				chosenFolder = selectedFolderPath;
			}
		} else {
			chosenFolder = selectedFolderPath;
		}
	});

	async function handlePublish() {
		const repoCtx = session.currentRepoContext;
		if (!repoCtx) return;

		const path = chosenFolder ? `${chosenFolder}/${fileName}` : fileName;
		const previousBinding = session.captureGitHubBindingSnapshot();
		publishing = true;
		error = '';

		try {
			// Register GitHub metadata so commitCurrentDocToGitHub knows where to push (sha: '' = new file)
			session.bindCurrentDocumentToGitHubFile({
				path,
				sha: '',
				owner: repoCtx.owner,
				repo: repoCtx.repo,
				branch: repoCtx.branch,
			});

			await session.commitCurrentDocToGitHub(commitMessage.trim() || `Add ${fileName}`);
			toast.success(`Published "${fileName}"`, { description: path });
			onPublished(path);
			open = false;
		} catch (e) {
			// Roll back the optimistic binding registration so any prior session state survives.
			session.restoreGitHubBindingSnapshot(previousBinding);
			error = (e as Error).message || 'Failed to publish to GitHub';
		} finally {
			publishing = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Save to GitHub</Dialog.Title>
			<Dialog.Description>
				Choose where to save <code>{fileName}</code> in the repository. A commit will be created automatically.
				Confirm whether this repository is private or public before publishing sensitive designs.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-3 py-2">
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground" for="publish-file-name"
					>File name</label
				>
				<div class="flex items-center gap-1.5">
					<span
						class="flex-1 rounded border border-input bg-muted px-3 py-1.5 text-sm text-muted-foreground"
					>
						{fileName}
					</span>
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground" for="publish-folder">Folder</label>
				<select
					id="publish-folder"
					class="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
					bind:value={chosenFolder}
				>
					<option value="">/ (root)</option>
					{#each folderOptions as folder (folder)}
						<option value={folder}>{folder}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground" for="publish-message"
					>Commit message</label
				>
				<input
					id="publish-message"
					type="text"
					class="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
					bind:value={commitMessage}
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === 'Enter') handlePublish();
					}}
				/>
			</div>

			{#if error}
				<p class="text-xs text-red-500">{error}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={publishing}>Cancel</Button>
			<Button onclick={handlePublish} disabled={publishing || !commitMessage.trim()}>
				{#if publishing}
					<LoaderCircle class="animate-spin" />Publishing…
				{:else}
					Publish
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
