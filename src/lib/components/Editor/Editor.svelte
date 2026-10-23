<script lang="ts">
	import { onMount } from 'svelte';
	import * as Resizable from '$lib/components/ui/resizable/index.js';

	import HelixViewer from '$lib/components/Editor/HelixView/HelixViewer.svelte';
	import StrandViewer from '$lib/components/Editor/StrandView/StrandViewer.svelte';

	import Toolbar from './Toolbar/Toolbar.svelte';
	import SaveFailedBanner from './SaveFailedBanner.svelte';
	import GitHubSessionExpiredBanner from './GitHubSessionExpiredBanner.svelte';
	import { githubAuth } from '$lib/services/github/auth.svelte';
	import DocumentRecoveryScreen from './DocumentRecoveryScreen.svelte';
	// import {
	// setCSCursorContext,
	// 	setDocContext,
	// 	setEditorModeContext,
	// 	setFootnoteContext,
	// 	setHistoryContext,
	// 	setShowShortcutsContext,
	// 	type EditorModeContext,
	// 	type Footnote,

	// 	type ShowShortcuts

	// } from './context.ts.d';
	import WorkspaceHelp from '$lib/components/help/WorkspaceHelp.svelte';
	import { markWorkspaceHelpSeen } from '$lib/remote/workspaceHelp.remote';
	import { dismissBrowserNotice } from '$lib/remote/browserNotice.remote';
	import { isChromiumBrowser } from '$lib/browserSupport';
	import { page } from '$app/state';
	import SidePanel from './SidePanel/SidePanel.svelte';
	// import { HistoryStack } from '../../commands/history.svelte';
	// import { createSelection } from '$lib/canvasEditor/services/selection';
	// import { setColorsContext, type ColorContext } from './StrandView/drawingContext';
	// import { Edit } from '@lucide/svelte';
	import { EditorViewContext, setEditorViewContext } from './context/EditorViewContext.svelte';
	import type { SelectionToggle } from './context/types';
	import { setEditorDocumentSession } from './context/EditorDocumentSession.svelte';
	import { githubExplorerStateStore, githubMetadataStore } from '$lib/services/storage';
	import { untrack } from 'svelte';
	import ToolPanel from './ToolPanel/ToolPanel.svelte';
	import BackupsDialog from './BackupsDialog.svelte';
	import PluginInstallConfirmDialog from './Plugin/PluginInstallConfirmDialog.svelte';
	// import { createTx } from '$lib/canvasEditor/services/tx';
	// import ReactiveDoc from '../../states/doc.svelte';
	import { removeSelection, startDuplicate } from './strandActions';
	import {
		deleteFreeformVirtualHelicesCmd,
		deleteLatticeVirtualHelicesCmd,
	} from '$lib/commands/virtualHelix';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { parseDesignRaw, getParseWarnings, type FileMeta } from './Toolbar/parsers';
	import { Part } from '../../model/Part';
	import FoldnanoDocument from '../../model/document.svelte';
	import { stripDesignExtension } from '$lib/model/io/designFileName';
	import { onDestroy } from 'svelte';
	import Sidebar from './Sidebar.svelte';
	import EmptyEditorState from './EmptyEditorState.svelte';

	interface Props {
		docId?: string;
	}

	let { docId }: Props = $props();

	const editorViewContext = new EditorViewContext();
	setEditorViewContext(editorViewContext);
	setEditorDocumentSession(editorViewContext.session);
	const session = editorViewContext.session;
	let foldnanoDoc = $derived(session.currentDoc);

	// Becomes true after IndexedDB stores are hydrated. The document-load $effect
	// waits for this flag so GitHub metadata is available when the doc is loaded,
	// preventing a blank status-bar flash on initial render.
	let storesHydrated = $state(false);

	// Load document when docId prop changes (handles initial mount and back/forward navigation).
	// Waits for storesHydrated so GitHub metadata is in memory before loadDocumentFromLocalStorage
	// reads it — avoids a flash of missing repo/branch info on the status bar.
	// untrack currentDoc so this only re-runs when docId or storesHydrated changes — not when
	// the GitHub panel switches the current doc (which would otherwise fight and revert it).
	$effect(() => {
		const id = docId;
		const hydrated = storesHydrated;
		if (!hydrated) return;
		if (id && untrack(() => session.currentDoc?.id) !== id) {
			session.loadDocumentFromLocalStorage(id).then((success) => {
				// An unreadable snapshot gets the recovery screen instead of "not found".
				if (!success && !session.loadFailure) {
					console.error(`Failed to load document with ID: ${id}`);
					if (confirm(`Document not found. Would you like to view saved documents?`)) {
						goto(resolve('/toc'));
					} else {
						goto(resolve('/editor'));
					}
				}
			});
		}
	});

	let urlLoadAttempted = false;
	let urlLoading = $state(false);

	$effect(() => {
		if (urlLoadAttempted || !storesHydrated) return;
		const rawUrl = new URLSearchParams(window.location.search).get('url');
		if (!rawUrl) return;
		urlLoadAttempted = true;
		urlLoading = true;

		(async () => {
			let parsed: URL;
			try {
				parsed = new URL(rawUrl);
			} catch {
				toast.error('Invalid URL in ?url= parameter');
				return;
			}
			if (!['http:', 'https:'].includes(parsed.protocol)) {
				toast.error('Only http:// and https:// URLs are supported');
				return;
			}

			let raw: Record<string, unknown>;
			try {
				const resp = await fetch(rawUrl, { credentials: 'omit' });
				if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
				raw = await resp.json();
			} catch (e) {
				toast.error(`Could not load from URL: ${(e as Error).message}`);
				return;
			}

			const filename = parsed.pathname.split('/').pop() || 'imported.json';
			const nameParts = filename.split('.');
			const meta: FileMeta = {
				name: filename,
				extension: nameParts.at(-1) ?? '',
				secondaryExtension: nameParts.length > 2 ? nameParts.at(-2) : undefined,
				size: 0,
				type: 'application/json',
			};

			let result: ReturnType<typeof parseDesignRaw>;
			try {
				result = parseDesignRaw(raw, meta);
				for (const w of getParseWarnings()) {
					toast.warning('Cadnano import warning', { description: w });
				}
			} catch (e) {
				toast.error(`Unrecognised file format: ${(e as Error).message}`);
				return;
			}

			let doc: FoldnanoDocument;
			if (result instanceof FoldnanoDocument) {
				doc = result;
			} else {
				// result is Part — wrap in a new document
				doc = new FoldnanoDocument();
				doc.name = stripDesignExtension(filename);
				const part = result as Part;
				part.name = doc.name;
				doc.parts.push(part);
			}

			await session.loadTransientDocument(doc, rawUrl);
		})()
			.catch((e) => {
				toast.error(`Failed to load from URL: ${(e as Error).message}`);
			})
			.finally(() => {
				urlLoading = false;
			});
	});

	// Autosave waits for 10 edits or 60 s, so closing the tab can drop recent edits.
	function hasUnpersistedWork(): boolean {
		return session.isTabOwner && (session.hasUnsavedLocalChanges || !!session.autoSaveError);
	}

	function handleBeforeUnload(e: BeforeUnloadEvent) {
		if (!hasUnpersistedWork()) return;
		// Start a save; it usually finishes while the browser's leave-page prompt is open.
		if (!session.autoSaveError && !session.pendingUrlSave) {
			void session.saveDocumentToLocalStorage({ skipPristineBlank: true });
		}
		e.preventDefault();
		e.returnValue = '';
	}

	function handleVisibilityChange() {
		// Coming back to the tab: GitHub may have changed meanwhile.
		if (document.visibilityState === 'visible') session.recheckRemote();
		else flushWhenHidden();
	}

	function flushWhenHidden() {
		if (!session.isTabOwner || !session.hasUnsavedLocalChanges || session.pendingUrlSave) return;
		void session.saveDocumentToLocalStorage({ skipPristineBlank: true });
	}

	onDestroy(() => {
		editorViewContext.destroy();
	});

	onMount(async () => {
		await Promise.all([githubMetadataStore.hydrate(), githubExplorerStateStore.hydrate()]);
		session.refreshGitHubStateFromStore();
		storesHydrated = true;
	});

	// Handle back/forward navigation for files opened via shallow routing (pushState).
	// Route params don't update with shallow routing, so we listen to popstate directly.
	onMount(() => {
		function handlePopState() {
			const match = window.location.pathname.match(/^\/editor\/(.+)$/);
			const urlDocId = match ? match[1] : null;
			if (urlDocId && session.currentDoc?.id !== urlDocId) {
				session.loadDocumentFromLocalStorage(urlDocId);
			}
		}
		window.addEventListener('popstate', handlePopState);
		return () => window.removeEventListener('popstate', handlePopState);
	});

	// let foldnanoDoc = $state<ReactiveDoc>(new ReactiveDoc());
	// let foldnanoDoc = editorViewContext.currentDoc;
	// $inspect("doc: ", foldnanoDoc);
	// $effect(() => {
	//   console.log("Editor sees doc change:", $state.snapshot(foldnanoDoc));
	// });
	// setDocContext(foldnanoDoc);

	// let history = editorViewContext.historyStack;
	// setHistoryContext(history);

	// const selection = createSelection();
	// const tx = createTx(foldnanoDoc, ()=>{}); // notify runes after edits

	// let editorMode = editorViewContext.editorMode;
	// setEditorModeContext(editorMode);

	// Global state to toggle the overlay
	// let showShortcuts = editorViewContext.showShortcuts;
	// setShowShortcutsContext(showShortcuts);

	// let crossSectionCursor = editorViewContext.strandViewContext.csCursorIdx;
	// setCSCursorContext(crossSectionCursor)

	let setToolBackTo = $state<EditorViewContext['editorMode'] | null>(null);
	// Alt/Option rather than Cmd/Ctrl so the temporary-pan gesture never intercepts
	// system shortcuts (copy/paste, save, print, select-all, ...) that use Cmd/Ctrl.
	const panKey = 'Alt';

	// Pane ref for programmatic collapse/expand — keeps DOM structure stable so
	// paneforge handle-to-pane index mapping never gets confused.
	let ghPane: { collapse: () => void; expand: () => void } | undefined = $state();

	$effect(() => {
		if (!ghPane) return;
		if (editorViewContext.showSidePanel) {
			ghPane.expand();
		} else {
			ghPane.collapse();
		}
	});

	// let footnote = editorViewContext.footnote;
	//
	// setFootnoteContext(footnote);

	// let colorContext = editorViewContext.strandViewContext.colorContext;
	// setColorsContext(colorContext);

	// Centralized key-to-mode mapping
	const modeKeyMap: Record<string, EditorViewContext['editorMode']> = {
		n: 'DRAW',
		v: 'SELECT',
		b: 'BREAK',
		s: 'SKIP',
		i: 'INSERT',
		p: 'PAINT',
		m: 'MODIFICATION',
		a: 'SEQUENCE',
		r: 'SPLIT_REGION',
	};

	// Selection-filter toggle keys — only meaningful in the strand pane, where
	// SelectPanel/SequencePanel render these toggles and the SELECT/SEQUENCE
	// tools read strandViewContext.selectionFilter.
	const filterKeyMap: Record<string, SelectionToggle> = {
		c: 'SCAF',
		t: 'STAP',
		e: 'END',
		x: 'XOVER',
		d: 'SEGMENT',
		o: 'OLIGO',
	};

	function toggleSelectionFilter(toggle: SelectionToggle) {
		const strandCtx = editorViewContext.strandViewContext;
		const toggles = strandCtx.selectionToggles;
		strandCtx.selectionToggles = toggles.includes(toggle)
			? toggles.filter((t) => t !== toggle)
			: [...toggles, toggle];

		// Mirrors SelectPanel's onClickOligoToggle guard: never let OLIGO end up
		// with no OLIGO/XOVER/END/SEGMENT toggle active.
		if (toggle === 'OLIGO') {
			const hasAnyToggle = (['OLIGO', 'XOVER', 'END', 'SEGMENT'] as SelectionToggle[]).some((t) =>
				strandCtx.selectionToggles.includes(t)
			);
			if (!hasAnyToggle) {
				strandCtx.selectionToggles = [...strandCtx.selectionToggles, 'XOVER', 'END', 'SEGMENT'];
			}
		}
	}

	let helixPaneActive = $derived(
		editorViewContext.activeViewer === 'HELIX' || editorViewContext.activeViewer === 'VIEW3D'
	);
	let strandPaneActive = $derived(editorViewContext.activeViewer === 'STRAND');

	// Screen pixels per arrow press, so a press feels the same at any zoom.
	const ARROW_PAN_STEP_PX = 50;
	const ARROW_PAN_SHIFT_MULTIPLIER = 5;
	const arrowPanDirections: Record<string, [number, number]> = {
		ArrowLeft: [1, 0],
		ArrowRight: [-1, 0],
		ArrowUp: [0, 1],
		ArrowDown: [0, -1],
	};

	function handleArrowPan(e: KeyboardEvent): boolean {
		const direction = arrowPanDirections[e.key];
		if (!direction || !strandPaneActive) return false;
		// Menus and code editors consume arrows for their own navigation.
		if (e.defaultPrevented || (e.target instanceof HTMLElement && e.target.isContentEditable)) {
			return false;
		}
		if (e.metaKey || e.ctrlKey || e.altKey) return false;
		if (editorViewContext.editorMode === 'DUPLICATE') return false;
		const controller = editorViewContext.strandToolbarController;
		if (!controller) return false;
		e.preventDefault();
		const step = ARROW_PAN_STEP_PX * (e.shiftKey ? ARROW_PAN_SHIFT_MULTIPLIER : 1);
		controller.panBy(direction[0] * step, direction[1] * step);
		return true;
	}

	// Force PAN mode while this tab is in read-only (not the owner).
	$effect(() => {
		if (!session.isTabOwner) {
			editorViewContext.editorMode = 'PAN';
		}
	});

	let editorRoot = $state<HTMLElement>();

	// Recommend a Chromium browser elsewhere; dismissal is remembered by a cookie.
	let browserNoticeHidden = $state(false);
	const showBrowserNotice = $derived(
		!browserNoticeHidden && !page.data.browserNoticeDismissed && !isChromiumBrowser()
	);
	function hideBrowserNotice() {
		browserNoticeHidden = true;
		void dismissBrowserNotice();
	}

	// First visit: open the workspace help once the document has loaded, independent of the privacy
	// notice. Closing it by any means sets the cookie so it never opens by itself again.
	let helpFirstVisit = $state(false);
	let helpAutoOpened = false;
	$effect(() => {
		if (helpAutoOpened || page.data.workspaceHelpSeen) return;
		if (session.isLoading || urlLoading) return;
		helpAutoOpened = true;
		helpFirstVisit = true;
		editorViewContext.showShortcuts = true;
	});
	$effect(() => {
		if (helpFirstVisit && !editorViewContext.showShortcuts) {
			helpFirstVisit = false;
			void markWorkspaceHelpSeen();
		}
	});

	const handleCtrlKeyDown = (e: KeyboardEvent) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
			return;
		}
		// View-only, so read-only tabs can pan too.
		if (handleArrowPan(e)) return;
		// Block all mutations and mode changes while this tab does not own the document
		if (!session.isTabOwner) return;

		// Normalize single-character keys to lowercase
		const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

		// DUPLICATE placement owns these keys (handled by DuplicateTool via the strand viewer).
		if (
			editorViewContext.editorMode === 'DUPLICATE' &&
			['Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete'].includes(key)
		) {
			return;
		}

		if ((e.metaKey || e.ctrlKey) && key === 'd') {
			e.preventDefault();
			const part = session.currentDoc.parts[0];
			if (part) startDuplicate(part, editorViewContext, { linked: e.shiftKey });
			return;
		}

		// Undo / Redo
		if ((e.metaKey || e.ctrlKey) && !e.shiftKey && key === 'z') {
			e.preventDefault();
			session.historyStack.undoOnce();
			return;
		}
		if ((e.metaKey || e.ctrlKey) && ((e.shiftKey && key === 'z') || key === 'y')) {
			e.preventDefault();
			session.historyStack.redoOnce();
			return;
		}

		// Delete selection
		if (key === 'Backspace' || key === 'Delete') {
			e.preventDefault();
			const part = session.currentDoc.parts[0];
			if (part) {
				const activeRegion = editorViewContext.activeRegion;
				const activeKind = activeRegion?.kind;

				if (editorViewContext.selectedLatticeVhIndices.size > 0) {
					if (activeKind === 'HONEYCOMB' || activeKind === 'SQUARE') {
						const selectedInActiveRegion = Array.from(
							editorViewContext.selectedLatticeVhIndices
						).filter((vhIndex) => part.getVhByIndex(vhIndex)?.regionId === activeRegion!.id);
						if (selectedInActiveRegion.length > 0) {
							deleteLatticeVirtualHelicesCmd(
								{ part, vhIndices: selectedInActiveRegion },
								session.historyStack
							);
						}
					}
					editorViewContext.clearSelectedLatticeVhs();
					return;
				}

				if (editorViewContext.selectedFreeformVhIndices.size > 0) {
					const selectedInActiveRegion =
						activeKind === 'FREEFORM'
							? Array.from(editorViewContext.selectedFreeformVhIndices).filter(
									(vhIndex) => part.getVhByIndex(vhIndex)?.regionId === activeRegion!.id
								)
							: [];
					if (selectedInActiveRegion.length > 0) {
						deleteFreeformVirtualHelicesCmd(
							{ part, vhIndices: selectedInActiveRegion },
							session.historyStack
						);
						editorViewContext.clearSelectedFreeformVhs();
						return;
					}
					editorViewContext.clearSelectedFreeformVhs();
				}

				removeSelection(
					part,
					editorViewContext.strandViewContext.selected,
					editorViewContext.strandViewContext.selectionToggles,
					session.historyStack
				);
			}
			return;
		}

		if (key === '?') {
			e.preventDefault();
			editorViewContext.showShortcuts = !editorViewContext.showShortcuts;
			return;
		}

		// Clear selection — mirrors the clear-on-undo/redo mutation callback in
		// EditorViewContext (strand ends + freeform VHs + lattice VHs).
		if (key === 'Escape') {
			e.preventDefault();
			editorViewContext.strandViewContext.selected.clear();
			editorViewContext.clearSelectedFreeformVhs();
			editorViewContext.clearSelectedLatticeVhs();
			return;
		}

		if (key === panKey) {
			// Prevent Windows/Firefox from shifting focus to the browser menu bar on a bare Alt tap.
			e.preventDefault();
			// Windows repeats keydown for held modifier keys (macOS doesn't), so guard
			// against re-stashing 'PAN' itself as the mode to restore to on keyup.
			if (!e.repeat) {
				setToolBackTo = editorViewContext.editorMode;
			}
			editorViewContext.editorMode = 'PAN';
			return;
		}

		// Ignore mode hotkeys while a system-shortcut modifier is held (e.g. Cmd/Ctrl+V
		// for paste) so this map never swallows browser/OS shortcuts.
		if (!e.metaKey && !e.ctrlKey && !e.altKey) {
			const mode = modeKeyMap[key];
			if (mode) {
				e.preventDefault();
				editorViewContext.editorMode = mode;
				return;
			}
		}

		// Selection-filter toggles — only active when the strand pane is focused,
		// so these never collide with the View3D 'c'/'e' shortcuts below.
		if (strandPaneActive && !e.metaKey && !e.ctrlKey && !e.altKey) {
			const toggle = filterKeyMap[key];
			if (toggle) {
				e.preventDefault();
				toggleSelectionFilter(toggle);
				return;
			}
		}

		// View3D-specific shortcuts — only active when the 3D pane is focused
		if (editorViewContext.activeViewer === 'VIEW3D' && !e.metaKey && !e.ctrlKey && !e.altKey) {
			const ctrl = editorViewContext.view3DToolbarController;
			if (key === 'g') {
				e.preventDefault();
				ctrl?.onToggleShowVH?.();
				return;
			}
			if (key === 'c') {
				e.preventDefault();
				ctrl?.onToggleCursor?.();
				return;
			}
			if (key === 'f') {
				e.preventDefault();
				ctrl?.onTogglePlanes?.();
				return;
			}
			if (key === 'e') {
				e.preventDefault();
				ctrl?.onToggleNtModel?.();
				return;
			}
		}
	};

	const handleKeyUp = (e: KeyboardEvent) => {
		if (e.key === panKey) {
			// Firefox can toggle its hidden menu bar on Alt release; suppress that too.
			e.preventDefault();
			editorViewContext.editorMode = setToolBackTo || 'SELECT';
		}
	};
</script>

<svelte:window
	onbeforeunload={handleBeforeUnload}
	onoffline={() => session.markRemoteUnchecked()}
	ononline={() => session.recheckRemote()}
/>
<svelte:document onvisibilitychange={handleVisibilityChange} />

<svelte:body onkeydown={handleCtrlKeyDown} onkeyup={handleKeyUp} />

<div
	bind:this={editorRoot}
	class="relative flex h-full w-full max-w-svw flex-col overflow-hidden pt-2 pr-2"
>
	{#if urlLoading || session.isLoading}
		<div
			class="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
		>
			<p class="text-sm text-muted-foreground">
				{urlLoading ? 'Loading design from URL…' : 'Loading design…'}
			</p>
		</div>
	{/if}
	<!-- Banners stack instead of overlapping when more than one applies. -->
	<div
		class="pointer-events-none absolute top-16 left-1/2 z-50 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col items-center gap-2 *:pointer-events-auto"
	>
		{#if !session.isTabOwner}
			<div
				class="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 shadow-md dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
			>
				<span class="shrink-0 font-medium">This file is open in another tab.</span>
				<span class="text-amber-600 dark:text-amber-400">Editing is disabled.</span>
				<button
					class="ml-2 shrink-0 rounded border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-medium hover:bg-amber-200 dark:border-amber-600 dark:bg-amber-900 dark:hover:bg-amber-800"
					onclick={() => session.claimTabOwnership()}>Take back control</button
				>
			</div>
		{/if}
		{#if showBrowserNotice}
			<div
				role="status"
				class="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-md"
			>
				<span>
					Foldnano is built and tested in Chromium browsers (Chrome, Edge, Brave, Arc). In Firefox
					and Safari it runs noticeably slower.
				</span>
				<a
					href={resolve('/docs/[...slug]', { slug: 'guide/getting-started' })}
					target="_blank"
					rel="noopener"
					class="shrink-0 text-muted-foreground underline underline-offset-2 hover:text-foreground"
					>Supported browsers</a
				>
				<button
					class="ml-1 shrink-0 rounded border border-border px-2 py-0.5 text-xs font-medium hover:bg-muted"
					onclick={hideBrowserNotice}>Dismiss</button
				>
			</div>
		{/if}
		{#if session.isTabOwner && session.autoSaveError && !session.pendingUrlSave}
			<SaveFailedBanner />
		{/if}
		{#if githubAuth.sessionExpired}
			<GitHubSessionExpiredBanner />
		{/if}
	</div>
	{#if session.loadFailure}
		<DocumentRecoveryScreen failure={session.loadFailure} />
	{/if}
	<Toolbar />
	<!-- <Button onclick={()=> history.undoOnce()}>Undo</Button> <Button onclick={()=> testNewVhWithUndo()}>Add VH with Undo</Button> -->
	<div class="relative flex min-h-0 flex-1 border-t border-border bg-background">
		<!-- VSCode-style icon sidebar -->
		<Sidebar />

		<!-- Resizable panes -->
		<Resizable.PaneGroup direction="horizontal" class="relative flex-1">
			<Resizable.Pane
				bind:this={ghPane}
				collapsible
				collapsedSize={0}
				defaultSize={20}
				minSize={14}
				maxSize={35}
			>
				<SidePanel />
			</Resizable.Pane>
			<Resizable.HighlightHandle class={editorViewContext.showSidePanel ? '' : 'hidden'} />
			{#if foldnanoDoc.parts[0]}
				<Resizable.Pane defaultSize={25}>
					<div class="relative h-full overflow-hidden rounded-md border border-transparent">
						<div
							class={`absolute inset-x-0 top-0 z-10 h-0.5 ${helixPaneActive ? 'bg-primary/70' : 'bg-transparent'}`}
						></div>
						<HelixViewer part={foldnanoDoc.parts[0]} />
					</div>
				</Resizable.Pane>
				<Resizable.HighlightHandle />
				<Resizable.Pane defaultSize={75}>
					<div class="relative h-full overflow-hidden rounded-md border border-transparent">
						<div
							class={`absolute inset-x-0 top-0 z-10 h-0.5 ${strandPaneActive ? 'bg-primary/70' : 'bg-transparent'}`}
						></div>
						<StrandViewer part={foldnanoDoc.parts[0]} />
					</div>
				</Resizable.Pane>
			{:else}
				<Resizable.Pane defaultSize={100}>
					<EmptyEditorState />
				</Resizable.Pane>
			{/if}
			<!-- <Resizable.Handle />
      <Resizable.Pane defaultSize={40}><DocViewer /></Resizable.Pane> -->
		</Resizable.PaneGroup>
	</div>
	{#if foldnanoDoc.parts[0]}
		<ToolPanel part={foldnanoDoc.parts[0]} />
	{/if}

	<!-- Status bar -->
	{#snippet statusBar()}
		{@const fileMeta = session.currentFileMetadata}
		{@const repoCtx = session.currentRepoContext}
		{@const hasUncommitted = fileMeta !== null && session.hasUncommittedGitHubChanges}
		{@const remoteAhead = session.remoteAheadOfLocal}
		<div
			class="flex h-7 shrink-0 items-center justify-between border-t border-border bg-muted px-3 text-sm text-muted-foreground"
		>
			<!-- Left: GitHub / file context -->
			<div class="flex items-center gap-2 overflow-hidden">
				{#if fileMeta && repoCtx}
					<!-- Branch -->
					<span class="flex items-center gap-1 font-semibold text-foreground">
						<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" class="shrink-0">
							<path
								d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm3-8.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0z"
							/>
						</svg>
						{repoCtx.branch}
					</span>
					<!-- Uncommitted dot -->
					{#if hasUncommitted}
						<span
							class="flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
							title="Uncommitted local changes"
						>
							<span class="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"></span>
							unsaved to GitHub
						</span>
					{:else if remoteAhead}
						<span
							class="flex items-center gap-0.5 text-blue-600 dark:text-blue-400"
							title="GitHub has newer changes"
						>
							↓ remote ahead
						</span>
					{/if}
					{#if session.remoteCheckFailed}
						<button
							class="flex items-center gap-0.5 text-amber-600 hover:underline dark:text-amber-400"
							title="Couldn't check GitHub for newer changes. Committing still checks and warns if the file changed. Click to try again."
							onclick={() => session.recheckRemote()}
						>
							? GitHub not checked
						</button>
					{/if}
					<!-- File path -->
					<span
						class="truncate text-muted-foreground"
						title="{fileMeta.owner}/{fileMeta.repo}/{fileMeta.path}"
					>
						{fileMeta.owner}/{fileMeta.repo} · {fileMeta.path}
					</span>
					<!-- Current commit SHA -->
					{#if fileMeta.commitSha}
						<span
							class="shrink-0 font-mono text-xs text-muted-foreground"
							title="Current commit: {fileMeta.commitSha}">{fileMeta.commitSha.slice(0, 7)}</span
						>
					{/if}
					<button
						class="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
						title="Earlier versions of this design kept in this browser"
						onclick={() => (editorViewContext.showBackups = true)}
					>
						Backups
					</button>
				{:else if repoCtx}
					<span class="text-muted-foreground"
						>{repoCtx.owner}/{repoCtx.repo} · {repoCtx.branch} · no file open</span
					>
				{/if}
			</div>
			<!-- Right: canvas hover info -->
			<span class="shrink-0 text-muted-foreground"
				>{editorViewContext.strandViewContext.footnote}</span
			>
		</div>
	{/snippet}
	{@render statusBar()}
	{#if editorViewContext.showShortcuts}
		<WorkspaceHelp
			root={editorRoot}
			firstVisit={helpFirstVisit}
			onClose={() => (editorViewContext.showShortcuts = false)}
		/>
	{/if}
</div>

<BackupsDialog bind:open={editorViewContext.showBackups} />
<PluginInstallConfirmDialog gate={editorViewContext.pluginInstallGate} />
