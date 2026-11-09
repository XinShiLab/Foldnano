<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Progress } from '$lib/components/ui/progress';
	import {
		displaySize,
		FileDropZone,
		MEGABYTE,
		type FileDropZoneProps,
	} from '$lib/components/ui/file-drop-zone';
	import { onDestroy, untrack } from 'svelte';
	import { notify } from '$lib/notifications/notify.svelte';
	import { SvelteDate } from 'svelte/reactivity';
	import { FileJson2, LoaderCircle, XIcon } from '@lucide/svelte';
	import { parseDesignFile, getParseWarnings, LocalPluginZipFile } from './parsers';
	import { withLatticeChoice } from './latticeChoice.svelte';
	import { prepareLocalZipInstall, type PreparedInstall } from '$lib/plugin/PluginInstaller';
	import PluginManifestInfo from '../Plugin/PluginManifestInfo.svelte';

	import { Part } from '../../../model/Part';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import {
		getEditorDocumentSession,
		type ImportedIdChoice,
	} from '../context/EditorDocumentSession.svelte';
	import FoldnanoDocument from '../../../model/document.svelte';
	import { Puzzle } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { githubExplorerStateStore } from '$lib/services/storage';
	import { putFileContent } from '$lib/services/github/api';
	import { stripDesignExtension } from '$lib/model/io/designFileName';
	import { summarizeDesign } from '$lib/model/io/designSummary';

	let { toggleDialog, initialFiles = [] }: { toggleDialog: () => void; initialFiles?: File[] } =
		$props();
	let isLoading = $state(false);
	let addToRepoFolder = $state(false);

	const editorViewContext = getEditorViewContext();
	const session = getEditorDocumentSession();
	const isGitHubConnected = $derived(session.currentRepoContext !== null);

	const onUpload: FileDropZoneProps['onUpload'] = async (uploadedFiles) => {
		await Promise.allSettled(uploadedFiles.map((file) => uploadFile(file)));
	};

	const onFileRejected: FileDropZoneProps['onFileRejected'] = async ({ reason, file }) => {
		notify.error(`${file.name} failed to upload!`, { description: reason });
	};

	const uploadFile = async (file: File) => {
		if (files.length > 0) return;
		if (files.find((f) => f.name === file.name)) return;
		const url = URL.createObjectURL(file);
		const parsed = withLatticeChoice(file.name, (lattice) => parseDesignFile(file, { lattice }));
		const storedAt = parsed.then((p) =>
			p instanceof FoldnanoDocument ? session.storageManager.getLastModified(p.id) : null
		);
		files.push({
			name: file.name,
			type: file.type,
			size: file.size,
			uploadedAt: Date.now(),
			url,
			parsed,
			storedAt,
			file,
		});
	};

	type UploadedFile = {
		name: string;
		type: string;
		size: number;
		uploadedAt: number;
		url: string;
		parsed: Promise<Part | FoldnanoDocument | LocalPluginZipFile>;
		/** When this browser last saved a design with the same id, or null if it has none. */
		storedAt: Promise<number | null>;
		file: File;
	};

	let files = $state<UploadedFile[]>([]);
	let date = new SvelteDate();

	// If the caller pre-populated files (e.g. dropped on the empty-state canvas), queue them.
	$effect(() => {
		const queued = initialFiles;
		// Untracked: uploading reads `files`, and removing a card must not re-add the queued file.
		if (queued.length > 0) untrack(() => onUpload(queued));
	});

	onDestroy(async () => {
		for (const file of files) {
			URL.revokeObjectURL(await file.url);
		}
	});
	$effect(() => {
		const interval = setInterval(() => {
			date.setTime(Date.now());
		}, 10);
		return () => {
			clearInterval(interval);
		};
	});

	async function installPlugin(
		prepare: () => Promise<PreparedInstall>,
		pluginName: string
	): Promise<void> {
		const outcome = await editorViewContext.pluginInstallGate.requestInstall(prepare);
		if (outcome.status === 'installed') {
			editorViewContext.openSidePanel('PLUGIN');
			notify.success(`Plugin "${pluginName}" installed.`, { history: true });
			toggleDialog();
		} else if (outcome.status === 'error') {
			notify.error('Failed to install plugin', { description: outcome.message });
		}
	}

	// Load a .fn.json document, named after its file as GitHub-backed designs are.
	const onLoadClick = async (
		uploadedFile: UploadedFile,
		imported: FoldnanoDocument,
		ifSaved: ImportedIdChoice
	) => {
		imported.name = stripDesignExtension(uploadedFile.name) || imported.name;
		isLoading = true;
		try {
			await session.openImportedDocument(imported, ifSaved);
			toggleDialog();
		} finally {
			isLoading = false;
		}
	};

	// Open a cadnano JSON as a brand-new .fn.json document
	const onLoadCadnanoAsNewDoc = async (uploadedFile: UploadedFile, part: Part) => {
		for (const w of getParseWarnings()) {
			notify.warning('Cadnano import warning', { description: w });
		}
		isLoading = true;
		try {
			const fileBaseName = stripDesignExtension(uploadedFile.name);
			const repoCtx = session.currentRepoContext;

			let folderPath = '';
			if (addToRepoFolder && repoCtx && session.currentFileMetadata?.path) {
				const parts = session.currentFileMetadata.path.split('/');
				folderPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
			}
			const inRepo = addToRepoFolder && !!repoCtx;
			const baseName = await session.uniqueImportName(fileBaseName, inRepo ? folderPath : null);
			if (baseName !== fileBaseName) {
				notify.warning(`Opened as "${baseName}"`, {
					description: inRepo
						? `"${fileBaseName}.fn.json" already exists in this folder.`
						: `A saved design is already named "${fileBaseName}".`,
				});
			}

			const { docId, path: fnPath } = await session.createDocumentFromImportedPart(
				part,
				baseName,
				folderPath
			);

			if (addToRepoFolder && repoCtx) {
				// Auto-commit the original .json to the repo as a reference
				try {
					const targetPath = folderPath ? `${folderPath}/${uploadedFile.name}` : uploadedFile.name;
					const content = btoa(await uploadedFile.file.text());
					await putFileContent(repoCtx.owner, repoCtx.repo, targetPath, {
						message: `Add cadnano reference: ${uploadedFile.name}`,
						content,
						branch: repoCtx.branch,
					});
					notify.success(`"${uploadedFile.name}" committed to repo.`, { history: true });
				} catch (e) {
					notify.error(`Could not commit original .json: ${(e as Error).message}`);
				}
				// Register the new .fn.json as a local-only file in the explorer
				const fnName = fnPath.split('/').pop()!;
				githubExplorerStateStore.addLocalOnlyEntry(repoCtx.owner, repoCtx.repo, {
					docId,
					path: fnPath,
					name: fnName,
				});
			}

			toggleDialog();
			goto(resolve(`/editor/${docId}`));
		} finally {
			isLoading = false;
		}
	};
</script>

<div class="flex w-full flex-col gap-2 p-6">
	{#if files.length === 0}
		<FileDropZone
			{onUpload}
			{onFileRejected}
			maxFileSize={50 * MEGABYTE}
			accept="application/json,application/zip,.zip"
			maxFiles={1}
			fileCount={files.length}
		/>
	{/if}
	<div class="flex flex-col gap-2">
		{#each files as file, i (file.name)}
			<div class="flex flex-col gap-1.5 rounded-md border p-2">
				<!-- Row 1: icon + name + X button -->
				<div class="flex items-center gap-2">
					<FileJson2 class="size-4 shrink-0 text-muted-foreground" />
					<div class="flex min-w-0 flex-1 flex-col">
						<span class="truncate text-sm font-medium" title={file.name}>{file.name}</span>
						<span class="text-xs text-muted-foreground">{displaySize(file.size)}</span>
					</div>
					<Button
						variant="ghost"
						size="icon"
						class="size-6 shrink-0"
						onclick={() => {
							URL.revokeObjectURL(file.url);
							files = [...files.slice(0, i), ...files.slice(i + 1)];
						}}
					>
						<XIcon class="size-3.5" />
					</Button>
				</div>

				<!-- Row 2: parsed content -->
				{#await file.parsed}
					<Progress
						class="h-1.5 w-full"
						value={((date.getTime() - file.uploadedAt) / 1000) * 100}
						max={100}
					/>
				{:then parsed}
					{#if parsed instanceof LocalPluginZipFile}
						<div class="flex flex-col gap-2">
							<div
								class="flex min-w-0 items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-800"
							>
								<Puzzle size={11} class="shrink-0" />
								<span class="truncate font-medium"
									>{parsed.manifest.name} v{parsed.manifest.version}</span
								>
								<span class="shrink-0 text-green-600">· Local plugin</span>
							</div>
							<PluginManifestInfo manifest={parsed.manifest} />
							<div class="flex justify-end">
								<Button
									size="sm"
									onclick={() =>
										installPlugin(
											() => prepareLocalZipInstall(parsed.file, editorViewContext.pluginRegistry),
											parsed.manifest.name
										)}
								>
									<Puzzle size={12} />
									Install
								</Button>
							</div>
						</div>
					{:else if parsed instanceof Part}
						<div class="flex flex-col gap-2">
							<div
								class="flex min-w-0 flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800"
							>
								<p>
									A new <code>.fn.json</code> doc will be created. Original <code>.json</code> won't be
									modified.
								</p>
								{#if isGitHubConnected}
									<label class="flex cursor-pointer items-center gap-1.5">
										<input
											type="checkbox"
											bind:checked={addToRepoFolder}
											class="accent-amber-600"
										/>
										Add original to current repo folder
									</label>
								{/if}
							</div>
							<div class="flex justify-end">
								{#if isLoading}
									<Button size="sm" disabled><LoaderCircle class="animate-spin" />Opening…</Button>
								{:else}
									<Button size="sm" onclick={() => onLoadCadnanoAsNewDoc(file, parsed)}>Open</Button
									>
								{/if}
							</div>
						</div>
					{:else}
						{#await file.storedAt then storedAt}
							<div class="flex flex-col gap-2">
								<div class="flex min-w-0 flex-col gap-1 text-xs">
									<p class="text-muted-foreground">{summarizeDesign(parsed)}</p>
									{#if storedAt !== null}
										<p
											class="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800"
										>
											This design is already in your browser (last saved {new Date(
												storedAt
											).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}).
											Open the file as a separate copy, or replace the saved design with it (the
											saved version stays in Backups).
										</p>
									{/if}
								</div>
								<div class="flex justify-end gap-2">
									{#if storedAt !== null}
										<Button
											size="sm"
											variant="outline"
											disabled={isLoading}
											onclick={() => onLoadClick(file, parsed, 'replace')}>Replace</Button
										>
									{/if}
									<Button
										size="sm"
										disabled={isLoading}
										onclick={() => onLoadClick(file, parsed, 'copy')}
									>
										{#if isLoading}<LoaderCircle class="animate-spin" />{/if}
										{storedAt !== null ? 'Open as copy' : 'Load'}
									</Button>
								</div>
							</div>
						{/await}
					{/if}
				{:catch error}
					<div class="text-xs text-red-500">Error: {error.message}</div>
				{/await}
			</div>
		{/each}
	</div>
</div>
