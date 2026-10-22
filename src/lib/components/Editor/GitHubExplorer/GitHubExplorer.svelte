<script lang="ts">
	import { help } from '$lib/components/help/help';
	import { onDestroy, onMount } from 'svelte';
	import { LoaderCircle, RefreshCw, GitBranch, Unplug, CloudDownload } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { githubAuth, getAuthStatus, loginWithGitHub } from '$lib/services/github/auth.svelte';
	import { githubMetadataStore, githubExplorerStateStore } from '$lib/services/storage';
	import { getFileContent } from '$lib/services/github/api';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import RepoSetupDialog from '../GitHubSetup/RepoSetupDialog.svelte';
	import CommitDialog from '../GitHubCommit/CommitDialog.svelte';
	import DiscardChangesDialog from './DiscardChangesDialog.svelte';
	import GitGraphPanel from '../GitGraph/GitGraphPanel.svelte';
	import NewFileDialog from './NewFileDialog.svelte';
	import PublishToGitHubDialog from './PublishToGitHubDialog.svelte';
	import SourceControlPanel from './SourceControlPanel.svelte';
	import DiffDialog from '../GitHubDiff/DiffDialog.svelte';
	import FilesTab from './FilesTab.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { cadnanoParser } from '../Toolbar/parsers/cadnanojsonParser';
	import type { Part } from '$lib/model/Part';
	import { GitHubExplorerState } from './GitHubExplorerState.svelte';
	import { addLocalOnlyEntry } from './localPersistence';
	import type { FileNode } from './types';

	const editorViewContext = getEditorViewContext();
	const session = getEditorDocumentSession();
	const explorerState = new GitHubExplorerState(session, editorViewContext);

	const repoCtx = $derived(session.currentRepoContext);
	const activeTab = $derived(editorViewContext.activeGitHubTab);
	const currentFileMeta = $derived(session.currentFileMetadata);

	function setActiveTab(tab: 'files' | 'changes' | 'graph') {
		editorViewContext.activeGitHubTab = tab;
	}

	// --- Folder selection ---

	let selectedFolderPath = $state('');

	$effect(() => {
		const meta = session.currentFileMetadata;
		if (meta?.path) {
			const parts = meta.path.split('/');
			selectedFolderPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
		}
	});

	function handleFolderSelect(path: string) {
		selectedFolderPath = path;
	}

	// --- Dialog states ---

	let setupDialogOpen = $state(false);
	let commitDialogOpen = $state(false);
	let cadnanoImportDialogOpen = $state(false);
	let cadnanoImportNode = $state<FileNode | null>(null);
	let diffDialogOpen = $state(false);
	let diffTargetPath = $state<string | null>(null);
	let discardDialogOpen = $state(false);
	let discardEntry = $state<import('./types').ChangeEntry | null>(null);

	// Watch for pending cadnano import signal from explorerState
	$effect(() => {
		const pending = explorerState.pendingCadnanoImportNode;
		if (pending) {
			cadnanoImportNode = pending;
			cadnanoImportDialogOpen = true;
			explorerState.pendingCadnanoImportNode = null;
		}
	});

	// Reset diffTargetPath when the dialog closes so the next open always transitions null → path.
	$effect(() => {
		if (!diffDialogOpen) diffTargetPath = null;
	});

	function openDiscardDialog(path: string) {
		const entry = explorerState.changeEntries.find((e) => e.path === path) ?? null;
		if (!entry) return;
		discardEntry = entry;
		discardDialogOpen = true;
	}

	async function executeDiscard() {
		if (!discardEntry) return;
		await explorerState.executeDiscard(discardEntry);
	}

	// --- Cadnano import (one-time dialog flow, stays in parent) ---

	async function handleCadnanoImportConfirm() {
		if (!repoCtx || !cadnanoImportNode) return;
		cadnanoImportDialogOpen = false;
		const node = cadnanoImportNode;

		const fnPath = node.path.replace(
			/\.cadnano\.json$|\.fn\.json$|\.cweb\.json$|\.json$/,
			'.fn.json'
		);
		const fnName = fnPath.split('/').pop()!;
		const folderPath = fnPath.includes('/') ? fnPath.split('/').slice(0, -1).join('/') : '';

		explorerState.beginLoadingFile(node.path);
		try {
			const file = await getFileContent(repoCtx.owner, repoCtx.repo, node.path, repoCtx.branch);
			const rawContent = atob(file.content.replace(/\s/g, ''));
			const raw = JSON.parse(rawContent) as Record<string, unknown>;
			const meta = {
				name: node.name,
				extension: node.name.split('.').pop() || '',
				secondaryExtension: node.name.split('.').slice(-2, -1)[0] || '',
				size: rawContent.length,
				type: 'application/json',
			};
			if (!cadnanoParser.canParse(raw, meta)) {
				toast.error(`"${node.name}" is not a valid cadnano JSON file.`);
				return;
			}
			const part = cadnanoParser.parse(raw, meta) as Part;
			for (const w of cadnanoParser.getLastWarnings()) {
				toast.warning('Cadnano import warning', { description: w });
			}
			const baseName = fnName.replace(/\.fn\.json$/, '');
			const { docId } = await session.createDocumentFromImportedPart(part, baseName, folderPath);

			addLocalOnlyEntry(repoCtx, { docId, path: fnPath, name: fnName });
			explorerState.localOnlyNodes = [
				...explorerState.localOnlyNodes,
				{ name: fnName, path: fnPath, type: 'file', sha: '', localOnly: true },
			];
		} catch (e) {
			toast.error(`Failed to import "${node.name}": ${(e as Error).message}`);
		} finally {
			explorerState.endLoadingFile(node.path);
		}
	}

	// --- File created / published callbacks ---

	function handleFileCreated(path: string, node: FileNode) {
		explorerState.handleFileCreated(path, node, handleFolderSelect);
	}

	async function handlePublished(path: string) {
		await explorerState.handlePublished(path, setActiveTab);
	}

	// --- Repo connected callback ---

	function onRepoConnected() {
		session.refreshGitHubStateFromStore();
		void explorerState.fetchTree();
	}

	// --- Init ---

	onMount(async () => {
		await getAuthStatus();
		await Promise.all([githubMetadataStore.hydrate(), githubExplorerStateStore.hydrate()]);
		session.refreshGitHubStateFromStore();
		if (repoCtx) {
			explorerState.initFromPersistedState();
			await explorerState.fetchTree();
		}
	});

	onDestroy(() => {
		explorerState.endLoadingFile();
	});
</script>

<div class="flex h-full flex-col bg-muted/50 text-sm">
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-border px-3 py-2">
		<div class="flex items-center gap-1.5 font-medium text-foreground">
			<GitBranch size={15} />
			GitHub
		</div>
		{#if repoCtx}
			<div class="flex items-center gap-1">
				{#if currentFileMeta}
					<button
						class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-blue-600"
						title="Pull latest from GitHub"
						{@attach help({
							title: 'Pull',
							text: 'Load the latest GitHub version of the open design.',
						})}
						onclick={() => explorerState.pullCurrentFile()}
						disabled={explorerState.pulling}
					>
						{#if explorerState.pulling}
							<LoaderCircle size={13} class="animate-spin" />
						{:else}
							<CloudDownload size={13} />
						{/if}
					</button>
				{/if}
				<button
					class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground"
					title="Refresh file tree"
					{@attach help({
						title: 'Refresh',
						text: "Reload the repository's file list from GitHub.",
					})}
					onclick={() => explorerState.fetchTree()}
				>
					<RefreshCw size={13} />
				</button>
				<button
					class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-500"
					title="Disconnect repository"
					{@attach help({
						title: 'Disconnect',
						text: 'Stop using this repository here. Nothing on GitHub is changed.',
					})}
					onclick={() => explorerState.disconnect()}
				>
					<Unplug size={13} />
				</button>
			</div>
		{/if}
	</div>

	<!-- Body -->
	<div
		class="flex flex-1 flex-col overflow-hidden"
		{@attach help({
			area: true,
			title: 'Source Control',
			text: 'Designs kept in a GitHub repository: open files, commit your changes, and browse branch history.',
			doc: 'saving-github',
		})}
	>
		{#if !githubAuth.authenticated}
			<!-- Not authenticated -->
			<div class="flex flex-col items-center gap-3 p-4 text-center">
				<GitBranch size={32} class="text-muted-foreground" />
				<p class="text-xs text-muted-foreground">
					Sign in to GitHub to browse and open design files.
				</p>
				<p class="text-xs text-muted-foreground">
					Without GitHub, designs stay in this browser's IndexedDB.
				</p>
				<Button
					size="sm"
					onclick={() => loginWithGitHub()}
					{@attach help({
						title: 'Connect to GitHub',
						text: 'Sign in to keep designs in a GitHub repository, with history and branches.',
						doc: 'saving-github',
					})}
				>
					<GitBranch size={14} />
					Connect to GitHub
				</Button>
			</div>
		{:else if !repoCtx}
			<!-- Authenticated, no repo connected -->
			<div class="flex flex-col items-center gap-3 p-4 text-center">
				<p class="text-xs text-muted-foreground">No repository connected.</p>
				<Button
					size="sm"
					variant="outline"
					onclick={() => (setupDialogOpen = true)}
					{@attach help({
						title: 'Setup Repository',
						text: 'Pick or create the GitHub repository where your designs are kept.',
						doc: 'saving-github',
					})}
				>
					Setup Repository
				</Button>
			</div>
		{:else}
			<!-- Repo connected -->
			<div class="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
				<span class="font-medium text-foreground">{repoCtx.owner}/{repoCtx.repo}</span>
				<span class="ml-1 rounded bg-muted px-1">{repoCtx.branch}</span>
			</div>

			<!-- Tabs -->
			<Tabs.Root
				value={activeTab}
				onValueChange={(v) => setActiveTab(v as 'files' | 'changes' | 'graph')}
				class="shrink-0"
			>
				<Tabs.List variant="line" class="w-full border-b border-border">
					<Tabs.Trigger
						value="files"
						class="flex-1 text-xs"
						{@attach help({ title: 'Files', text: 'Browse the repository and open a design.' })}
						>Files</Tabs.Trigger
					>
					<Tabs.Trigger
						value="changes"
						class="flex-1 text-xs"
						{@attach help({
							title: 'Changes',
							text: 'Local edits not yet on GitHub. Stage files and commit them here.',
						})}
					>
						Changes
						{#if explorerState.changeEntries.length > 0}
							<span
								class="rounded-full bg-amber-400 px-1 text-[10px] leading-tight font-bold text-white"
								>{explorerState.changeEntries.length}</span
							>
						{/if}
					</Tabs.Trigger>
					<Tabs.Trigger
						value="graph"
						class="flex-1 text-xs"
						{@attach help({
							title: 'Graph',
							text: 'Commit history across branches. Switch to or create a branch here.',
						})}>Graph</Tabs.Trigger
					>
				</Tabs.List>
			</Tabs.Root>

			{#if activeTab === 'graph'}
				<GitGraphPanel
					onBranchSwitch={() => {
						setActiveTab('files');
						explorerState.fetchTree();
					}}
					changes={explorerState.changeEntries}
				/>
			{:else if activeTab === 'changes'}
				<SourceControlPanel
					changes={explorerState.changeEntries}
					{repoCtx}
					onCommit={(msg, paths) => explorerState.commitAll(msg, paths)}
					onDiscard={openDiscardDialog}
					onCreateBranch={(name) => explorerState.handleCreateBranch(name)}
					onFileClick={async (path) => {
						if (path === session.currentFileMetadata?.path) {
							await session.persistCurrentDocumentSnapshot('before-diff');
						}
						diffTargetPath = path;
						diffDialogOpen = true;
					}}
				/>
			{:else}
				<FilesTab
					{explorerState}
					{selectedFolderPath}
					onFolderSelect={handleFolderSelect}
					onOpenDiff={(path) => {
						diffTargetPath = path;
						diffDialogOpen = true;
					}}
					onOpenNewFileDialog={() => (editorViewContext.newFileDialogOpen = true)}
					onOpenCommitDialog={() => (commitDialogOpen = true)}
				/>
			{/if}
		{/if}
	</div>
</div>

<RepoSetupDialog bind:open={setupDialogOpen} onConnected={onRepoConnected} />
<Dialog.Root bind:open={cadnanoImportDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Open as Foldnano document?</Dialog.Title>
			<Dialog.Description>
				To open <code>{cadnanoImportNode?.name}</code>, a new file
				<code
					>{cadnanoImportNode?.path
						.replace(/\.cadnano\.json$|\.fn\.json$|\.cweb\.json$|\.json$/, '.fn.json')
						.split('/')
						.pop()}</code
				>
				will be created in the same folder. All edits will be saved there; the original
				<code>.json</code> file stays unchanged.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => {
					cadnanoImportDialogOpen = false;
					cadnanoImportNode = null;
				}}
			>
				Cancel
			</Button>
			<Button onclick={handleCadnanoImportConfirm}>Create & Open</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
<CommitDialog bind:open={commitDialogOpen} />
<DiscardChangesDialog
	bind:open={discardDialogOpen}
	entry={discardEntry}
	onConfirm={executeDiscard}
/>
<DiffDialog
	bind:open={diffDialogOpen}
	filePath={diffTargetPath}
	viewOnly={diffTargetPath !== null}
/>
<NewFileDialog
	bind:open={editorViewContext.newFileDialogOpen}
	{selectedFolderPath}
	fileTree={explorerState.fileTree}
	onCreated={handleFileCreated}
/>
<PublishToGitHubDialog
	bind:open={editorViewContext.publishToGitHubDialogOpen}
	{selectedFolderPath}
	fileTree={explorerState.fileTree}
	onPublished={handlePublished}
/>
