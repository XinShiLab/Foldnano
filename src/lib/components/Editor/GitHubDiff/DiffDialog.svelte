<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { LoaderCircle, GitMerge, AlertTriangle, Check } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getFileContent } from '$lib/services/github/api';
	import { githubMetadataStore, githubExplorerStateStore } from '$lib/services/storage';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';
	import {
		computeDiff,
		generateConflictMarkers,
		MAX_DIFF_CHANGES,
	} from '$lib/services/github/diff';
	import DiffHunkRow from './DiffHunk.svelte';
	import FoldnanoDocument from '$lib/model/document.svelte';
	import { DocumentFormatError } from '$lib/model/documentFormat';

	interface Props {
		open: boolean;
		/**
		 * Optional: show diff for a specific file path rather than the currently open document.
		 * When set, the dialog finds the docId + metadata via githubStorageProvider.
		 */
		filePath?: string | null;
		/**
		 * When true, hides Keep local / Accept remote / Edit & resolve buttons.
		 * Use when the user just wants to inspect changes, not resolve a conflict.
		 */
		viewOnly?: boolean;
	}

	let { open = $bindable(), filePath = null, viewOnly = false }: Props = $props();

	const session = getEditorDocumentSession();

	// ---- state ----
	let loading = $state(false);
	let error = $state('');

	// local / remote raw JSON strings
	let localText = $state('');
	let remoteText = $state('');
	let remoteCommitSha = $state('');

	// Edit & resolve mode
	let editMode = $state(false);
	let editText = $state('');
	let editError = $state('');

	// Actions
	let busy = $state(false);

	// For local-only ('added') files: look up their docId from githubExplorerStateStore.
	// These files have no entry in githubMetadataStore.
	const localOnlyDocId = $derived.by(() => {
		if (!filePath) return null;
		const ctx = githubMetadataStore.getRepoContext();
		if (!ctx) return null;
		const entries = githubExplorerStateStore.getLocalOnlyEntries(ctx.owner, ctx.repo);
		return entries.find((e) => e.path === filePath)?.docId ?? null;
	});

	// True when the target file is a local-only new file with no remote counterpart.
	const isNewFile = $derived(localOnlyDocId !== null);

	// Resolve target docId + fileMeta: use filePath override when provided
	const fileMeta = $derived.by(() => {
		if (filePath) {
			const ctx = githubMetadataStore.getRepoContext();
			if (!ctx) return session.currentFileMetadata;
			const id = githubMetadataStore.findDocIdByPath(ctx.owner, ctx.repo, filePath);
			if (id) return githubMetadataStore.getFileMetadata(id);
			// Local-only file — no remote metadata; don't fall through to currentFileMetadata.
			if (isNewFile) return null;
		}
		return session.currentFileMetadata;
	});

	const docId = $derived.by(() => {
		if (filePath) {
			const ctx = githubMetadataStore.getRepoContext();
			if (ctx) {
				const id = githubMetadataStore.findDocIdByPath(ctx.owner, ctx.repo, filePath);
				if (id) return id;
			}
			// Local-only file: resolve via githubExplorerStateStore.
			if (localOnlyDocId) return localOnlyDocId;
		}
		return session.currentDoc.id;
	});

	const hunks = $derived.by(() => {
		if (!localText || !remoteText) return [];
		return computeDiff(remoteText, localText);
	});

	// null: too many changes to show line by line.
	const hasChanges = $derived(hunks === null || hunks.some((h) => h.type !== 'equal'));

	// Load both versions when dialog opens
	$effect(() => {
		if (!open) {
			// Reset on close
			localText = '';
			remoteText = '';
			remoteCommitSha = '';
			editMode = false;
			editText = '';
			editError = '';
			error = '';
			return;
		}
		loadVersions();
	});

	async function loadVersions() {
		if (!isNewFile && !fileMeta) return;
		loading = true;
		error = '';
		try {
			// Local version from persisted working copy
			const snapshot = await session.storageManager.loadDocument(docId);
			localText = snapshot ? JSON.stringify(snapshot, null, 2) : '';

			if (isNewFile) {
				// No remote version — show all-added diff (empty remote vs full local).
				remoteText = '';
				return;
			}

			// Remote version from GitHub
			const file = await getFileContent(
				fileMeta!.owner,
				fileMeta!.repo,
				fileMeta!.path,
				fileMeta!.branch
			);
			const decoded = atob(file.content.replace(/\s/g, ''));
			remoteText = JSON.stringify(JSON.parse(decoded), null, 2);
			remoteCommitSha = file.sha.slice(0, 7);
		} catch (e) {
			error = (e as Error).message || 'Failed to load versions';
		} finally {
			loading = false;
		}
	}

	async function keepLocal() {
		if (!fileMeta) return;
		busy = true;
		error = '';
		try {
			await session.overwriteGitHubWithLocal('Resolve conflict: keep local version');
			open = false;
			toast.success('Local version committed to GitHub');
		} catch (e) {
			error = (e as Error).message || 'Commit failed';
		} finally {
			busy = false;
		}
	}

	async function acceptRemote() {
		if (!fileMeta) return;
		const ok = window.confirm('This will overwrite your local changes. Continue?');
		if (!ok) return;
		busy = true;
		error = '';
		try {
			if (!(await session.pullCurrentDocFromGitHub('before_accept_remote'))) {
				error = 'Pull failed';
				return;
			}
			open = false;
			toast.success('Remote version pulled');
		} catch (e) {
			error = (e as Error).message || 'Pull failed';
		} finally {
			busy = false;
		}
	}

	function openEditMode() {
		editText = generateConflictMarkers(localText, remoteText);
		editError = '';
		editMode = true;
	}

	function applyEdit() {
		editError = '';
		let parsed: object;
		try {
			parsed = JSON.parse(editText);
		} catch {
			editError = 'Invalid JSON — cannot apply';
			return;
		}

		// Validate it at least deserializes to a FoldnanoDocument
		try {
			FoldnanoDocument.fromJSON(parsed);
		} catch (e) {
			editError =
				e instanceof DocumentFormatError
					? e.message
					: 'JSON is valid but does not contain a valid cadnano document';
			return;
		}

		session.applyResolvedConflict(docId, parsed).then((ok) => {
			if (!ok) {
				editError = 'Failed to save the resolved document locally';
				return;
			}
			open = false;
			toast.success('Conflict resolved — review the document and commit when ready');
		});
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-4xl">
		<!-- Header -->
		<Dialog.Header class="border-b border-border px-4 py-3">
			<Dialog.Title class="flex items-center gap-2 text-sm">
				<GitMerge size={16} />
				Diff: Remote vs Local
			</Dialog.Title>
			{#if fileMeta || (isNewFile && filePath)}
				<Dialog.Description class="font-mono text-xs">
					{fileMeta?.path ?? filePath}
					{#if fileMeta}
						<span class="ml-1 rounded bg-muted px-1 not-italic">{fileMeta.branch}</span>
					{/if}
					{#if isNewFile}
						<span class="ml-1 rounded bg-green-100 px-1 text-green-700 not-italic">new file</span>
					{/if}
					{#if remoteCommitSha}
						<span class="ml-1 text-muted-foreground">remote HEAD: {remoteCommitSha}</span>
					{/if}
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		<!-- Body -->
		<div class="min-h-0 flex-1 overflow-auto">
			{#if loading}
				<div class="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
					<LoaderCircle size={16} class="animate-spin" />
					Loading versions…
				</div>
			{:else if error}
				<div class="flex items-center gap-2 px-4 py-4 text-sm text-red-600">
					<AlertTriangle size={14} />
					{error}
				</div>
			{:else if editMode}
				<!-- Edit & resolve textarea -->
				<div class="flex flex-col gap-2 p-4">
					<p class="text-xs text-muted-foreground">
						Edit the JSON below. Remove all conflict markers (<code class="font-mono"
							>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code
						>, <code class="font-mono">=======</code>,
						<code class="font-mono">&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code>) before applying.
					</p>
					<textarea
						bind:value={editText}
						rows={24}
						spellcheck={false}
						class="w-full resize-y rounded border border-border bg-muted p-3 font-mono text-xs leading-5 outline-none focus:border-blue-400"
					></textarea>
					{#if editError}
						<p class="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{editError}</p>
					{/if}
				</div>
			{:else if !hasChanges}
				<div class="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
					<Check size={16} class="text-green-500" />
					Files are identical — no differences found.
				</div>
			{:else if hunks === null}
				<div class="px-6 py-12 text-center text-sm text-muted-foreground">
					The two versions differ in more than {MAX_DIFF_CHANGES.toLocaleString()} lines, too many to
					show line by line. The actions below still work.
				</div>
			{:else}
				<!-- Diff table -->
				<div class="overflow-x-auto">
					<!-- Column headers -->
					<div
						class="flex border-b border-border bg-muted text-xs font-medium text-muted-foreground"
					>
						<div class="w-[50%] border-r border-border px-10 py-1.5">
							{isNewFile ? 'Remote (none)' : 'Remote (committed)'}
						</div>
						<div class="w-[50%] px-10 py-1.5">Local (your changes)</div>
					</div>
					<table class="w-full border-collapse text-left">
						<tbody>
							{#each hunks as hunk, index (index)}
								<DiffHunkRow {hunk} />
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-between border-t border-border px-4 py-3">
			<div class="flex gap-2">
				{#if !editMode}
					<Button size="sm" variant="outline" onclick={() => (open = false)} disabled={busy}>
						Cancel
					</Button>
				{:else}
					<Button size="sm" variant="outline" onclick={() => (editMode = false)} disabled={busy}>
						Back to diff
					</Button>
				{/if}
			</div>

			{#if !viewOnly}
				{#if editMode}
					<Button size="sm" onclick={applyEdit} disabled={busy}>Apply resolved JSON</Button>
				{:else}
					<div class="flex gap-2">
						<Button size="sm" variant="outline" onclick={openEditMode} disabled={busy || loading}>
							Edit &amp; resolve
						</Button>
						<Button size="sm" variant="outline" onclick={acceptRemote} disabled={busy || loading}>
							{#if busy}<LoaderCircle size={13} class="animate-spin" />{/if}
							Accept remote
						</Button>
						<Button size="sm" onclick={keepLocal} disabled={busy || loading}>
							{#if busy}<LoaderCircle size={13} class="animate-spin" />{/if}
							Keep local
						</Button>
					</div>
				{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
