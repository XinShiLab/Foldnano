<script lang="ts">
	import { FileBox, GitBranch } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import {
		linkFromSource,
		readSourceDocument,
		sameLinkTarget,
		storedUnlinkableReason,
	} from '$lib/model/partLinks';
	import { insertLinkedPartCmd } from '$lib/commands/partLinks';
	import { addOccurrenceCmd } from '$lib/commands/assembly';
	import { notify } from '$lib/notifications/notify.svelte';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const ctx = getEditorViewContext();
	const session = ctx.session;

	interface Candidate {
		docId: string;
		name: string;
		/** Path in the current GitHub repo; null for a design kept only in this browser. */
		repoPath: string | null;
		/** Why it can't be linked, or null. */
		reason: string | null;
	}

	let candidates = $state<Candidate[] | null>(null);
	let busy = $state(false);

	$effect(() => {
		if (open) void loadCandidates();
		// The design a new assembly was started from is listed first only for that opening.
		else ctx.insertLinkedPartFromDocId = null;
	});

	async function loadCandidates() {
		candidates = null;
		const currentId = ctx.currentDoc.id;
		const fromId = ctx.insertLinkedPartFromDocId;
		const list = (await session.getDocumentList())
			.filter((meta) => meta.id !== currentId)
			.sort(
				(a, b) =>
					Number(b.id === fromId) - Number(a.id === fromId) || b.lastModified - a.lastModified
			);
		candidates = await Promise.all(
			list.map(async (meta) => {
				return {
					docId: meta.id,
					name: meta.name,
					repoPath: session.partLinks.linkTargetFor(meta.id).repoPath ?? null,
					reason: storedUnlinkableReason(await session.loadRawDocument(meta.id)),
				};
			})
		);
	}

	// Only the tab that owns the design may change it; checked again after the async read, since
	// ownership or the open design can change meanwhile.
	const readOnlyMessage = 'This design is open in another tab; edit it there.';

	async function insert(candidate: Candidate) {
		if (busy || candidate.reason) return;
		if (!ctx.isTabOwner) {
			notify.warning(readOnlyMessage);
			return;
		}
		busy = true;
		const doc = ctx.currentDoc;
		try {
			const sourceDoc = readSourceDocument(await session.loadRawDocument(candidate.docId));
			if (!sourceDoc) throw new Error(`"${candidate.name}" can't be read.`);
			if (!ctx.isTabOwner || ctx.currentDoc !== doc) throw new Error(readOnlyMessage);
			const firstPart = doc.parts.length === 0;
			const target = session.partLinks.linkTargetFor(candidate.docId);
			const [sourcePart] = sourceDoc.parts;
			// Linking the same source again places the existing copy once more.
			const existing = doc.parts.find(
				(p) => p.source && sameLinkTarget(p.source, target) && p.source.partId === sourcePart?.id
			);
			if (existing) {
				addOccurrenceCmd(ctx.historyStack, doc, existing.id);
				notify.info(`"${existing.name}" is already linked; placed it once more.`);
			} else {
				const { json, source } = await linkFromSource(sourceDoc, target);
				if (!ctx.isTabOwner || ctx.currentDoc !== doc) throw new Error(readOnlyMessage);
				insertLinkedPartCmd(ctx.historyStack, doc, json, source, sourceDoc.name);
			}
			open = false;
			// Starting an assembly from the start screen: show where the next Parts get added.
			if (firstPart) ctx.openSidePanel('ASSEMBLY');
		} catch (e) {
			notify.error(e instanceof Error ? e.message : "Couldn't insert the Part.");
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Link Part from…</Dialog.Title>
			<Dialog.Description>
				Adds a read-only copy of another design that follows it: when the design changes, update the
				copy from the Assembly panel. Designs with one Part and no links of their own can be linked.
			</Dialog.Description>
		</Dialog.Header>

		<div class="max-h-80 min-h-24 overflow-y-auto rounded-md border border-border">
			{#if candidates === null}
				<p class="p-3 text-xs text-muted-foreground">Looking for designs…</p>
			{:else if candidates.length === 0}
				<p class="p-3 text-xs text-muted-foreground">
					No other designs in this browser yet. Open or create the design to link first.
				</p>
			{:else}
				{#each candidates as candidate (candidate.docId)}
					<button
						class="flex w-full items-center gap-2 border-b border-border/60 px-3 py-1.5 text-left last:border-b-0 enabled:hover:bg-accent disabled:opacity-50"
						disabled={busy || !!candidate.reason}
						title={candidate.reason
							? `Can't be linked: it ${candidate.reason}`
							: `Insert ${candidate.name}`}
						onclick={() => insert(candidate)}
					>
						{#if candidate.repoPath}
							<GitBranch size={13} class="shrink-0 text-muted-foreground" />
						{:else}
							<FileBox size={13} class="shrink-0 text-muted-foreground" />
						{/if}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-xs font-medium">{candidate.name}</span>
							<span class="block truncate text-[11px] text-muted-foreground">
								{candidate.reason
									? `Can't be linked: it ${candidate.reason}`
									: (candidate.repoPath ?? 'Only in this browser')}
								{#if candidate.docId === ctx.insertLinkedPartFromDocId}
									· the design you came from
								{/if}
							</span>
						</span>
					</button>
				{/each}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
