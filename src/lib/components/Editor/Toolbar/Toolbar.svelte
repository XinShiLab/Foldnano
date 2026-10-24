<script lang="ts">
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	// import { Badge } from '$lib/components/ui/badge/index.js';

	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toggleMode, mode } from 'mode-watcher';

	import { resolve } from '$app/paths';

	// import { getDocContext } from '../context.ts.d';
	import Open from './Open.svelte';
	import LoadCadnanoAsRegionDialog from './LoadCadnanoAsRegionDialog.svelte';
	import AboutDialog from './AboutDialog.svelte';
	import {
		// BadgeCheckIcon,
		Bolt,
		BookOpen,
		Bug,
		ChevronDown,
		CircleQuestionMark,
		// CloudAlert,
		// CloudCheck,
		Database,
		ExternalLink,
		FileBracesCorner,
		FilePlusCorner,
		FileSpreadsheet,
		FolderOpen,
		GitBranch,
		GitCommitHorizontal,
		HardDriveDownload,
		Hexagon,
		History,
		Keyboard,
		LineSquiggle,
		LoaderCircle,
		Moon,
		Puzzle,
		// PanelRightClose,
		// PanelRightOpen,
		// Redo,
		Redo2,
		Save,
		Square,
		Sun,
		Undo2,
		Workflow,
	} from '@lucide/svelte';
	import { autoStapleCmd } from '$lib/commands/strands';
	import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
	import { checkCadnanoProfile } from '$lib/model/checks/cadnano';
	import { designCheckPrompt, needsDesignCheck } from '../designCheckPrompt.svelte';
	import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
	import { downloadFoldnanoJson, downloadJsonAsTextFile } from './utils';
	import { Input } from '../../ui/input';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import {
		getEditorDocumentSession,
		type RenameDocumentResult,
	} from '../context/EditorDocumentSession.svelte';
	import { exportPartSequencesToCSV } from '../../../model/io/sequenceCSV';
	import { exportBaseName } from '$lib/model/io/designFileName';
	import { help } from '$lib/components/help/help';
	import { modKeySymbol } from '$lib/utils/platform';
	import { goto } from '$app/navigation';
	import SaveStatusIndicator from '../SaveStatusIndicator.svelte';
	import { githubAuth, getAuthStatus, loginWithGitHub } from '$lib/services/github/auth.svelte';
	import { toast } from 'svelte-sonner';
	import { githubExplorerStateStore } from '$lib/services/storage';
	import { errorLogPanelState } from '$lib/errorLogPanel.svelte';
	import { onMount } from 'svelte';
	import ActiveViewerToolbar from './ActiveViewerToolbar.svelte';

	// interface ToolbarProps {
	// history: HistoryStack;
	// }
	// let { history }: ToolbarProps = $props();
	let isDialogOpen = $state(false);
	let loadCadnanoRegionDialogOpen = $state(false);
	let aboutDialogOpen = $state(false);

	// Opened in a new tab so the design stays open beside the docs.
	const helpLinks = [
		{ label: 'User guide', slug: 'guide/getting-started', icon: BookOpen },
		{ label: 'Keyboard shortcuts', slug: 'guide/keyboard-shortcuts', icon: Keyboard },
		{ label: 'Plugin development', slug: 'plugin-development/plugin-quickstart', icon: Puzzle },
	] as const;
	let addPartMenuOpen = $state(false);

	onMount(() => {
		getAuthStatus();
	});

	const toggleDialog = () => {
		isDialogOpen = !isDialogOpen;
	};

	// const foldnanoDoc = getDocContext();
	const editorViewContext = getEditorViewContext();
	const session = getEditorDocumentSession();

	// Whether the current doc was loaded from GitHub (has reactive file metadata)
	const isGitHubFile = $derived(session.currentFileMetadata !== null);
	// Whether local changes exist that haven't been committed to GitHub
	const hasUncommittedChanges = $derived(isGitHubFile && session.hasUncommittedGitHubChanges);
	const foldnanoDoc = $derived(session.currentDoc);
	const history = $derived(session.historyStack);

	// Local working copy of the document name while the user is typing.
	// We avoid bind:value so the model isn't mutated on every keystroke —
	// the rename (which may hit the GitHub API) only fires on blur/Enter.
	let docNameInput: string = $state('');
	let isEditingName: boolean = $state(false);
	$effect(() => {
		// Keep the input in sync with external model changes (e.g. Explorer rename),
		// but don't clobber what the user is actively typing.
		if (!isEditingName) {
			docNameInput = foldnanoDoc.name;
		}
	});

	// Whether the currently open file is a committed GitHub file (requires confirm + commit to rename).
	const isGitHubCommitted = $derived(
		!!session.currentRepoContext && !!session.currentFileMetadata?.sha
	);

	// Rename confirm dialog state
	let renameDialogOpen: boolean = $state(false);
	let pendingNewName: string = $state('');
	let isRenaming: boolean = $state(false);

	function handleRenameResult(result: RenameDocumentResult): void {
		if (result.kind === 'local-only-file-renamed') {
			editorViewContext.localOnlyEntriesVersion++;
			return;
		}
		if (result.kind === 'repo-file-renamed') {
			editorViewContext.repoTreeVersion++;
			toast.success(`Renamed to ${result.filename}`);
		}
	}

	function handleNameBlur() {
		isEditingName = false;
		const trimmed = docNameInput.trim();
		if (!trimmed || trimmed === foldnanoDoc.name) {
			// No real change — snap back to current model name
			docNameInput = foldnanoDoc.name;
			return;
		}
		if (isGitHubCommitted) {
			// For committed GitHub files, ask for confirmation before committing
			pendingNewName = trimmed;
			renameDialogOpen = true;
		} else {
			// Cases 1 & 2: local rename — just do it immediately
			session.renameDocument(trimmed).then((result) => handleRenameResult(result));
		}
	}

	async function confirmRename() {
		renameDialogOpen = false;
		isRenaming = true;
		try {
			const result = await session.renameDocument(pendingNewName);
			handleRenameResult(result);
		} finally {
			isRenaming = false;
		}
	}

	function cancelRename() {
		renameDialogOpen = false;
		docNameInput = foldnanoDoc.name;
	}

	const startAddRegion = (kind: 'HONEYCOMB' | 'SQUARE' | 'FREEFORM') => {
		addPartMenuOpen = false;
		editorViewContext.enterPlaneSelectionMode(kind);
	};

	const undo = () => {
		history.undoOnce();
	};
	const redo = () => {
		history.redoOnce();
	};

	const activeLatticeRegion = $derived(
		editorViewContext.activeRegion instanceof LatticedDesignRegion
			? editorViewContext.activeRegion
			: null
	);

	const onAutoStaple = () => {
		const part = foldnanoDoc.parts[0];
		if (!part) return;
		const region = activeLatticeRegion;
		if (!region) {
			toast.error('Select a lattice region first', {
				description:
					'Click a region header in the StrandView (or a plane in 3D) to make it active.',
			});
			return;
		}
		autoStapleCmd({ part, region }, history);
	};

	const exportToCadnanoJson = async () => {
		const part = foldnanoDoc.parts[0];
		if (!part) return;
		const region = activeLatticeRegion;
		if (!region) {
			toast.error('Cannot export: no active lattice region', {
				description: 'Select a Honeycomb or Square region in the StrandView first.',
			});
			return;
		}
		const issues = checkCadnanoProfile(part, region);
		if (needsDesignCheck(issues)) {
			const proceed = await designCheckPrompt.ask({
				title: `Export "${region.name}" as cadnano JSON?`,
				description: "cadnano JSON is a compatibility format and can't hold all of this region.",
				proceedLabel: 'Export anyway',
				issues,
			});
			if (!proceed) return;
		}
		const { json: cadnanoJSON } = CadnanoJSON.fromRegion(region, part);
		const latticeRegionCount = part.getLatticedRegions().length;
		const fileName = exportBaseName(
			foldnanoDoc.name,
			latticeRegionCount === 1 ? '.cadnano.json' : `.${region.name}.cadnano.json`
		);
		// cadnano2 stores the file's own name here.
		cadnanoJSON.name = fileName;
		const jsonString = JSON.stringify(cadnanoJSON);
		const minifiedJsonString = jsonString.replace(/\s+/g, '');
		downloadJsonAsTextFile(minifiedJsonString, fileName);
	};

	const exportToFoldnanoJson = () => downloadFoldnanoJson(foldnanoDoc);

	const exportOligoSequencesToCSV = () => {
		const part = foldnanoDoc.parts[0];
		if (!part) return;
		try {
			exportPartSequencesToCSV(part, foldnanoDoc.name);
		} catch (error) {
			editorViewContext.strandViewContext.highlightContext.circular_strand = true;
			toast.error('Cannot export oligo CSV', {
				description: error instanceof Error ? error.message : 'The design cannot be exported.',
			});
		}
	};

	// Reactive repo context to decide how "New Document" behaves
	const currentRepoCtx = $derived(session.currentRepoContext);

	const saveToGitHub = () => {
		const repoCtx = session.currentRepoContext;
		if (!repoCtx) {
			toast.error('Connect to GitHub first', {
				description: 'Open the GitHub panel and set up a repository.',
			});
			return;
		}
		if (session.currentFileMetadata) {
			// Already committed — open Changes tab so the user can commit the latest edits
			editorViewContext.openSidePanel('GITHUB');
			editorViewContext.activeGitHubTab = 'changes';
			return;
		}
		// Check if this doc already has a path assigned as a local-only entry
		// (e.g. created via New File dialog or cadnano import — in Changes tab but not yet committed)
		const entries = githubExplorerStateStore.getLocalOnlyEntries(repoCtx.owner, repoCtx.repo);
		if (entries.some((e) => e.docId === session.currentDoc.id)) {
			editorViewContext.openSidePanel('GITHUB');
			editorViewContext.activeGitHubTab = 'changes';
			return;
		}
		// No path assigned yet — open the publish dialog to pick a location and auto-commit
		editorViewContext.publishToGitHubDialogOpen = true;
	};

	const createNewDocument = async () => {
		if (currentRepoCtx && githubAuth.authenticated) {
			// GitHub repo connected and authenticated: open the new-file dialog (local-first workflow)
			editorViewContext.newFileDialogOpen = true;
			return;
		}

		const newDocId = await session.createNewStandaloneDocument();
		goto(resolve(`/editor/${newDocId}`));
	};
</script>

<div class="mb-2 flex flex-col gap-2 pl-2">
	<div class="flex flex-row items-start gap-1">
		<!-- ****Place for Logo and name **** -->
		<!-- <div>
			<p class="flex-none my-auto ml-1 text-xl font-semibold">
				Foldnano

				<span
					class="relative -top-3 rounded-md bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white"
					>offline</span
				>
			</p>
		</div> -->
		<!-- <Button
				variant="ghost"
				size="icon-sm"
				title="Toggle GitHub Explorer"
				onclick={() => editorViewContext.toggleSidePanel('GITHUB')}
				><PanelRightOpen /></Button
			> -->
		<div class="relative">
			<Button
				onclick={() => (aboutDialogOpen = true)}
				{@attach help({
					title: 'About Foldnano',
					text: "Version, What's New, and licenses.",
				})}
			>
				<p class="flex-none cursor-pointer text-sm font-semibold text-white">Foldnano</p>
			</Button>
			<span
				class="pointer-events-none absolute -top-1.5 -right-1.5 rounded-full bg-amber-400 px-1 py-px text-[9px] leading-none font-bold text-amber-950"
				>beta</span
			>
		</div>
		<!-- <div class="my-auto bg-orange-200 px-2 py-0.5 mr-2 ml-4 rounded-md shadow-grey-200 shadow-sm border-1 border-orange-300">
			<p class=" flex-none text-sm font-semibold text-amber-900 cursor-default">
				Foldnano 
			</p>
		</div> -->
		<div class="flex flex-grow flex-col items-start gap-2 xl:flex-row">
			<div class="my-auto flex flex-none flex-row gap-2">
				<ButtonGroup.Root>
					<Button
						variant="outline"
						size="sm"
						onclick={createNewDocument}
						{@attach help({
							title: 'New Document',
							text: 'Start an empty design. Your current one stays saved in this browser.',
						})}><FilePlusCorner />New Document</Button
					>

					<Dialog.Root bind:open={isDialogOpen}>
						<Dialog.Trigger
							class={buttonVariants({ variant: 'outline', size: 'sm' })}
							{@attach help({
								title: 'Open',
								text: 'Open a Foldnano .fn.json or cadnano .json design, or a design saved in this browser.',
								doc: 'creating-a-design',
							})}><FolderOpen />Open</Dialog.Trigger
						>
						<Dialog.Content class="sm:max-w-2xl">
							<Dialog.Header>
								<Dialog.Title>Load design files here</Dialog.Title>
								<Dialog.Description>
									<p>
										works for cadnano <code>.json</code>, <code>.cadnano.json</code>,
										<code>.fn.json</code>
									</p>
								</Dialog.Description>
							</Dialog.Header>
							<Open {toggleDialog} />
							<!-- <Dialog.Footer>
            <Button type="submit">Load</Button>
          </Dialog.Footer> -->
						</Dialog.Content>
					</Dialog.Root>

					<Button
						variant="outline"
						size="sm"
						onclick={async () => await session.saveDocumentToLocalStorage()}
						{@attach help({
							title: 'Save',
							text: 'Save to this browser now (it also autosaves). The arrow menu has GitHub and file downloads.',
							doc: 'saving-github',
						})}
					>
						<Save />Save
					</Button>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									size="sm"
									class="!pl-2"
									{@attach help({
										title: 'Save menu',
										text: 'Saved documents, oligo report, publish to GitHub, and downloads as cadnano JSON, Foldnano JSON or oligo CSV.',
										doc: 'saving-github',
									})}
								>
									<ChevronDown />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="min-w-60 [--radius:1rem]">
							<DropdownMenu.Group>
								<DropdownMenu.Item
									onclick={async () => {
										await session.saveDocumentToLocalStorage({ skipPristineBlank: true });
										goto(resolve('/toc'));
									}}
								>
									<Database />View Saved Documents
								</DropdownMenu.Item>
								<DropdownMenu.Item
									onclick={async () => {
										await session.saveDocumentToLocalStorage({ skipPristineBlank: true });
										goto(resolve(`/oligos/${foldnanoDoc.id}`));
									}}
								>
									<FileSpreadsheet />View Oligos
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => (editorViewContext.showBackups = true)}>
									<History />Backups…
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item onclick={saveToGitHub}>
									<GitBranch />Save to GitHub Repo
								</DropdownMenu.Item>
								{#if activeLatticeRegion}
									<DropdownMenu.Item onclick={() => exportToCadnanoJson()}>
										<FileBracesCorner />Export as cadnano JSON — {activeLatticeRegion.name}
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Item onclick={() => exportToFoldnanoJson()}>
									<FileBracesCorner />Export as Foldnano JSON
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={exportOligoSequencesToCSV}>
									<FileSpreadsheet />Export Oligos of this Part as CSV
								</DropdownMenu.Item>
								<!-- <DropdownMenu.Item onclick={() => exportDocumentSequencesToCSV(foldnanoDoc)}>
									<FileSpreadsheet />Export Oligos entire Doc as CSV
								</DropdownMenu.Item> -->
								<DropdownMenu.Item disabled>
									<HardDriveDownload />Other Save Options
								</DropdownMenu.Item>
							</DropdownMenu.Group>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</ButtonGroup.Root>

				<ButtonGroup.Root>
					<Button
						variant="outline"
						size="sm"
						onclick={() => startAddRegion('HONEYCOMB')}
						{@attach help({
							title: 'Add Region',
							text: 'Add another region, on its own plane, to this part. The arrow menu picks the lattice or imports a cadnano design as a region.',
							doc: 'creating-a-design',
							newVsCadnano: true,
						})}><Bolt />Add Region</Button
					>
					<DropdownMenu.Root bind:open={addPartMenuOpen}>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									size="sm"
									class="!pl-2"
									{@attach help({
										title: 'Region types',
										text: 'Add a honeycomb, square or freeform region, or load a cadnano design as a new region of this part.',
										doc: 'creating-a-design',
									})}
								>
									<ChevronDown />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="min-w-50 [--radius:1rem]">
							<DropdownMenu.Group>
								<DropdownMenu.Item onclick={() => startAddRegion('HONEYCOMB')}>
									<Hexagon />Add Honeycomb Region
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => startAddRegion('SQUARE')}>
									<Square />Add Square Region
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => startAddRegion('FREEFORM')}>
									<LineSquiggle />Add Freeform Region
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									onclick={() => {
										addPartMenuOpen = false;
										loadCadnanoRegionDialogOpen = true;
									}}
								>
									<FileBracesCorner />Load Cadnano Design as a Region
								</DropdownMenu.Item>
							</DropdownMenu.Group>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</ButtonGroup.Root>

				<LoadCadnanoAsRegionDialog bind:open={loadCadnanoRegionDialogOpen} />

				{#if activeLatticeRegion?.supportsLatticeAutoStaple}
					<ButtonGroup.Root>
						<Button
							variant="outline"
							size="sm"
							onclick={() => onAutoStaple()}
							{@attach help({
								title: 'Auto Staple',
								text: 'Generate staples for the active lattice region from its scaffold routing. Review them before assigning sequences.',
								doc: 'creating-a-design',
							})}><Workflow />Auto Staple — {activeLatticeRegion.name}</Button
						>
					</ButtonGroup.Root>
				{/if}
			</div>

			<div class="flex w-full flex-grow flex-row gap-2">
				<div
					class="my-auto flex flex-grow"
					{@attach help({
						title: 'Document name',
						text: 'Click to rename. The icon next to it shows whether the latest changes are saved.',
					})}
				>
					<Input
						type="text"
						placeholder="Untitled Document"
						class="font-small mx-2 border-0 shadow-none"
						value={docNameInput}
						disabled={isRenaming}
						onfocus={() => {
							isEditingName = true;
						}}
						oninput={(e) => {
							docNameInput = (e.currentTarget as HTMLInputElement).value;
						}}
						onblur={handleNameBlur}
						onkeydown={(e) => {
							if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
							if (e.key === 'Escape') {
								docNameInput = foldnanoDoc.name;
								isEditingName = false;
								(e.currentTarget as HTMLInputElement).blur();
							}
						}}
					/>
					{#if isRenaming}
						<LoaderCircle size={14} class="my-auto shrink-0 animate-spin text-muted-foreground" />
					{/if}
					<SaveStatusIndicator />
					<!-- <Badge class="h-6 min-w-5 rounded-full px-1 font-mono tabular-nums my-auto bg-green-700 font-bold "><CloudCheck /></Badge> -->
					<!-- <CloudCheck class="stroke-2 stroke-green-700 my-auto" size={18}/> -->
					<!-- <CloudAlert class="stroke-3 stroke-amber-500 my-auto" size={18}/> -->
				</div>
				<div class="flex flex-row gap-2">
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={undo}
						disabled={history.numberOfUndos === 0}
						{@attach help({ key: `${modKeySymbol()}Z`, title: 'Undo' })}><Undo2 /></Button
					>
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={redo}
						disabled={history.numberOfRedos === 0}
						{@attach help({ key: `⇧${modKeySymbol()}Z`, title: 'Redo' })}><Redo2 /></Button
					>
				</div>
				<!-- GitHub panel toggle + auth indicator -->
				<div class="flex flex-row items-center gap-1">
					{#if isGitHubFile}
						<Button
							variant="ghost"
							size="sm"
							class="relative gap-1.5 text-xs"
							title="Open Source Control panel"
							{@attach help({
								title: 'Commit',
								text: 'Open the Changes tab to commit this design to GitHub. An amber dot means uncommitted changes.',
								doc: 'saving-github',
							})}
							onclick={() => {
								editorViewContext.openSidePanel('GITHUB');
								editorViewContext.activeGitHubTab = 'changes';
							}}
						>
							<GitCommitHorizontal size={14} />
							<span class="hidden xl:inline">Commit</span>
							{#if hasUncommittedChanges}
								<span class="absolute top-1 right-1 size-1.5 rounded-full bg-amber-400"></span>
							{/if}
						</Button>
					{/if}
					{#if githubAuth.authenticated && githubAuth.user}
						<button
							class="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
							title="Toggle GitHub Explorer"
							onclick={() => editorViewContext.toggleSidePanel('GITHUB')}
							{@attach help({
								title: 'GitHub account',
								text: 'Open or close the Source Control panel.',
								doc: 'saving-github',
							})}
						>
							<img
								src={githubAuth.user.avatar_url}
								alt={githubAuth.user.login}
								class="size-5 rounded-full"
							/>
							<span class="hidden xl:inline">{githubAuth.user.login}</span>
						</button>
					{:else}
						<Button
							variant="ghost"
							size="sm"
							class="gap-1.5 text-xs"
							onclick={() => loginWithGitHub()}
							title="Connect to GitHub"
							{@attach help({
								text: 'Optional. Sign in to sync designs with your GitHub repositories; without it, designs are saved only in this browser.',
								doc: 'saving-github',
							})}
						>
							<GitBranch size={14} />
							<span class="hidden xl:inline">GitHub</span>
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={toggleMode}
						title="Toggle dark mode"
						{@attach help({
							title: 'Light / dark theme',
							text: 'Switch the editor between light and dark colors. It follows your system setting until you change it here.',
						})}
					>
						{#if mode.current === 'dark'}
							<Sun size={15} />
						{:else}
							<Moon size={15} />
						{/if}
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						title="View error log"
						{@attach help({
							text: 'Errors and warnings from this session, with details you can copy into a bug report.',
						})}
						onclick={() => {
							errorLogPanelState.open = true;
							errorLogPanelState.focusedEntryId = null;
						}}
					>
						<Bug size={15} />
					</Button>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon-sm"
									title="Help"
									aria-label="Help"
									{@attach help({
										text: 'Workspace help, the user guide, keyboard shortcuts and the plugin development docs.',
										doc: 'getting-started',
									})}
								>
									<CircleQuestionMark size={15} />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="min-w-56 [--radius:1rem]">
							<DropdownMenu.Group>
								<DropdownMenu.Item onclick={() => (editorViewContext.showShortcuts = true)}>
									<CircleQuestionMark />Workspace help
									<DropdownMenu.Shortcut>?</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								{#each helpLinks as link (link.slug)}
									<DropdownMenu.Item>
										{#snippet child({ props })}
											<a
												{...props}
												href={resolve('/docs/[...slug]', { slug: link.slug })}
												target="_blank"
												rel="noopener"
											>
												<link.icon />{link.label}
												<ExternalLink class="ml-auto size-3 text-muted-foreground" />
											</a>
										{/snippet}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Group>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			</div>
		</div>
	</div>

	<ActiveViewerToolbar />
</div>

<AboutDialog bind:open={aboutDialogOpen} />

<!-- Rename & commit confirmation dialog (GitHub committed files only) -->
<Dialog.Root
	bind:open={renameDialogOpen}
	onOpenChange={(open) => {
		if (!open) cancelRename();
	}}
>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Rename and Commit</Dialog.Title>
			<Dialog.Description>
				Rename <span class="font-medium text-foreground">"{foldnanoDoc.name}"</span> to
				<span class="font-medium text-foreground">"{pendingNewName}"</span>?
				{#if session.hasUncommittedGitHubChanges}
					<br /><br />This will also commit all unsaved local changes to GitHub.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={cancelRename}>Cancel</Button>
			<Button onclick={confirmRename}>Rename &amp; Commit</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
