<script lang="ts">
	import {
		Copy,
		Ellipsis,
		ExternalLink,
		Eye,
		EyeOff,
		Hexagon,
		LineSquiggle,
		Link,
		Link2,
		Move3d,
		Pencil,
		Plus,
		Pyramid,
		RefreshCw,
		RotateCcw,
		Square,
		Trash2,
		TriangleAlert,
		Unlink,
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import type { Component } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { help } from '$lib/components/help/help';
	import {
		addOccurrenceCmd,
		deleteOccurrenceCmd,
		deletePartCmd,
		duplicatePartCmd,
		relinkOccurrenceCmd,
		renameOccurrenceCmd,
		renamePartCmd,
		setOccurrenceTransformCmd,
		setOccurrenceVisibleCmd,
	} from '$lib/commands/assembly';
	import { breakPartLinkCmd } from '$lib/commands/partLinks';
	import { IDENTITY_TRANSFORM } from '$lib/model/Assembly';
	import type { PartLinkStatus } from '$lib/services/partLinks/PartLinkService.svelte';
	import { notify } from '$lib/notifications/notify.svelte';
	import type { RegionKind } from '$lib/model/Part/DesignRegion';
	import type { Part } from '$lib/model/Part';
	import type { Occurrence } from '$lib/model/Assembly';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	const ctx = getEditorViewContext();
	const doc = $derived(ctx.currentDoc);
	const history = $derived(ctx.historyStack);
	const readOnly = $derived(!ctx.isTabOwner);
	const activePart = $derived(ctx.activePart);
	const editedOccurrenceId = $derived(ctx.activeOccurrence?.id ?? null);
	const brokenOccurrences = $derived(
		doc.assembly.occurrences.filter((o) => !doc.parts.some((p) => p.id === o.partId))
	);

	const REGION_KINDS: { value: RegionKind; label: string; icon: Component; color: string }[] = [
		{ value: 'HONEYCOMB', label: 'Honeycomb', icon: Hexagon, color: 'text-blue-500' },
		{ value: 'SQUARE', label: 'Square', icon: Square, color: 'text-green-500' },
		{ value: 'FREEFORM', label: 'Freeform', icon: LineSquiggle, color: 'text-purple-500' },
		{ value: 'WIREFRAME', label: 'Wireframe', icon: Pyramid, color: 'text-orange-500' },
	];
	const kindMeta = (kind: RegionKind) => REGION_KINDS.find((k) => k.value === kind)!;

	// --- Inline rename ---

	let renaming: { kind: 'part' | 'occurrence'; id: string } | null = $state(null);
	let draftName = $state('');

	function startRename(kind: 'part' | 'occurrence', id: string, name: string) {
		if (readOnly) return;
		renaming = { kind, id };
		draftName = name;
	}

	function commitRename() {
		if (!renaming) return;
		const { kind, id } = renaming;
		renaming = null;
		if (kind === 'part') {
			const part = doc.parts.find((p) => p.id === id);
			if (part) renamePartCmd(history, part, draftName);
		} else {
			renameOccurrenceCmd(history, doc, id, draftName);
		}
	}

	const focusAndSelect: Attachment<HTMLInputElement> = (input) => {
		input.focus();
		input.select();
	};

	function onRenameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') commitRename();
		else if (event.key === 'Escape') renaming = null;
		event.stopPropagation();
	}

	// --- Part actions ---

	function deletePart(part: Part) {
		// Switch away first so the 2D views never point into a Part that is gone.
		if (activePart?.id === part.id) {
			ctx.setActivePart(doc.parts.find((p) => p.id !== part.id)?.id ?? null);
		}
		deletePartCmd(history, doc, part.id);
	}

	function duplicatePart(part: Part) {
		const copy = duplicatePartCmd(history, doc, part.id);
		if (copy) ctx.setActivePart(copy.id);
	}

	// --- Linked Parts ---

	const partLinks = $derived(ctx.session.partLinks);

	function linkTitle(part: Part, status: PartLinkStatus | null): string {
		const from = part.source?.repoPath ?? 'a design in this browser';
		switch (status?.state) {
			case 'upToDate':
				return `Linked from ${from}, up to date. Read-only here: open the source to change it.`;
			case 'outdated':
				return `Linked from ${from}. The source changed: update to bring the change in.`;
			case 'replaced':
				return `Linked from ${from}, which now holds a different Part. The copy keeps working; relink to take the new Part.`;
			case 'unlinkable':
				return `Linked from ${from}, which can't be linked any more (it ${status.reason}). The copy keeps working.`;
			case 'missing':
				return `Linked from ${from}, which isn't in this browser any more. The copy keeps working.`;
			case 'notLocal':
				return `Linked from ${from}, not opened in this browser yet. Open it from the GitHub explorer to compare.`;
			default:
				return `Linked from ${from}. Checking the source…`;
		}
	}

	async function updateLinked(part: Part, relink = false) {
		if (
			relink &&
			!window.confirm(
				`The design "${part.name}" is linked to now holds a different Part. Replace the copy with that Part in every placement?`
			)
		) {
			return;
		}
		const result = await partLinks.update(history, part.id, {
			relink,
			canEdit: () => ctx.isTabOwner,
		});
		if (result.ok) {
			ctx.afterPartReplaced(part.id);
			return;
		}
		if (result.reason === 'superseded') {
			notify.info(`The link of "${part.name}" changed while its source was read.`, {
				description: 'Nothing was replaced; check its status and update again if needed.',
			});
		} else if (result.reason === 'readOnly') {
			notify.warning(`"${part.name}" can't be updated in this tab.`, {
				description: 'Another tab is editing this design.',
			});
		} else if (result.reason === 'unreadable') {
			notify.warning(`The source of "${part.name}" can't be read in this browser.`);
		} else if (result.reason === 'replaced') {
			notify.warning(`The source of "${part.name}" now holds a different Part.`, {
				description: 'Choose Relink to take it; the copy stays as it is until then.',
			});
		} else {
			notify.warning(`The source of "${part.name}" can't be linked any more.`, {
				description: `It ${result.detail}. The copy keeps working.`,
			});
		}
	}

	const canUpdate = (status: PartLinkStatus | null) =>
		!!status?.sourceDocId && (status.state === 'upToDate' || status.state === 'outdated');

	function openSource(docId: string) {
		window.open(resolve(`/editor/${encodeURIComponent(docId)}`), '_blank', 'noopener');
	}

	const isLastOccurrence = (occurrence: Occurrence) =>
		doc.assembly.occurrencesOf(occurrence.partId).length <= 1;
</script>

{#snippet renameInput()}
	<input
		class="h-5 min-w-0 flex-1 rounded-sm border border-input bg-background px-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
		bind:value={draftName}
		onkeydown={onRenameKeydown}
		onblur={commitRename}
		{@attach focusAndSelect}
	/>
{/snippet}

{#snippet menuButton(label: string)}
	<DropdownMenu.Trigger disabled={readOnly}>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon"
				class="size-5 shrink-0 opacity-60 group-hover:opacity-100"
				title={label}
				aria-label={label}
			>
				<Ellipsis size={12} />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
{/snippet}

<div
	class="flex h-full flex-col overflow-hidden text-sm"
	{@attach help({
		area: true,
		title: 'Assembly',
		text: 'The Parts in this design and where each is placed. The active Part is the one the helix and strand views edit.',
		doc: 'assemblies',
	})}
>
	<div class="flex h-9 items-center justify-between border-b border-border px-3 py-2">
		<span class="text-xs font-semibold tracking-wide uppercase">Assembly</span>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger disabled={readOnly || ctx.planeSelectionMode}>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="sm"
						class="h-6 gap-1 px-2 text-xs"
						title="Add a new Part to this design"
						{@attach help({
							title: 'New Part',
							text: 'Adds an independent Part, folded separately from the others, and switches to it. Pick its first region and plane as usual.',
						})}
					>
						<Plus size={13} />
						New Part
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-44">
				{#each REGION_KINDS as kind (kind.value)}
					<DropdownMenu.Item onclick={() => ctx.startNewPart(kind.value)}>
						<kind.icon size={12} class={kind.color} />
						{kind.label}
					</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					onclick={() => (ctx.insertLinkedPartDialogOpen = true)}
					title="Add a read-only copy of another design that follows it"
				>
					<Link2 size={12} />
					Insert Part from…
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#each doc.parts as part (part.id)}
			{@const isActive = part.id === activePart?.id}
			{@const occurrences = doc.assembly.occurrencesOf(part.id)}
			{@const link = part.source ? partLinks.statusOf(part) : null}
			<div
				class="mb-1.5 rounded-md border bg-card {isActive
					? 'border-primary/60'
					: 'border-border hover:border-foreground/20'}"
			>
				<!-- Part row -->
				<div class="group flex items-center gap-1.5 px-2 py-1.5">
					<button
						class="flex size-4 shrink-0 items-center justify-center rounded-full border {isActive
							? 'border-primary'
							: 'border-muted-foreground/50'}"
						title={isActive ? 'The Part being edited' : 'Edit this Part'}
						aria-label={isActive ? `${part.name} is being edited` : `Edit ${part.name}`}
						aria-pressed={isActive}
						onclick={() => ctx.setActivePart(part.id)}
					>
						{#if isActive}<span class="size-2 rounded-full bg-primary"></span>{/if}
					</button>
					{#if renaming?.kind === 'part' && renaming.id === part.id}
						{@render renameInput()}
					{:else}
						<button
							class="min-w-0 flex-1 truncate text-left text-xs font-medium"
							title="Click to edit this Part, double-click to rename"
							onclick={() => ctx.setActivePart(part.id)}
							ondblclick={() => startRename('part', part.id, part.name)}
						>
							{part.name}
						</button>
					{/if}
					{#if part.source}
						<span
							class="relative shrink-0 {link?.state === 'outdated' || link?.state === 'replaced'
								? 'text-amber-600 dark:text-amber-400'
								: link?.state === 'missing' || link?.state === 'unlinkable'
									? 'text-destructive'
									: 'text-muted-foreground'}"
							title={linkTitle(part, link)}
							aria-label={linkTitle(part, link)}
						>
							<Link2 size={12} />
							{#if link?.state === 'outdated' || link?.state === 'replaced'}
								<span class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500"
								></span>
							{/if}
						</span>
					{/if}
					<span
						class="shrink-0 text-[10px] text-muted-foreground"
						title="{occurrences.length} instance(s) in the design"
					>
						×{occurrences.length}
					</span>
					<DropdownMenu.Root>
						{@render menuButton(`Actions for ${part.name}`)}
						<DropdownMenu.Content align="end" class="w-44">
							<DropdownMenu.Item onclick={() => startRename('part', part.id, part.name)}>
								<Pencil size={12} />
								Rename
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={() => addOccurrenceCmd(history, doc, part.id)}>
								<Plus size={12} />
								Add instance
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={() => duplicatePart(part)}>
								<Copy size={12} />
								Duplicate as new Part
							</DropdownMenu.Item>
							{#if part.source}
								<DropdownMenu.Separator />
								{#if link?.state === 'replaced'}
									<DropdownMenu.Item
										title="The source now holds a different Part: copy that one instead"
										onclick={() => updateLinked(part, true)}
									>
										<RefreshCw size={12} />
										Relink to its current Part…
									</DropdownMenu.Item>
								{:else}
									<DropdownMenu.Item
										disabled={!canUpdate(link)}
										title={link?.state === 'outdated'
											? 'Bring in the changes made to the source'
											: 'Copy the source again and renew the link'}
										onclick={() => updateLinked(part)}
									>
										<RefreshCw size={12} />
										Update from source
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Item
									disabled={!link?.sourceDocId}
									onclick={() => link?.sourceDocId && openSource(link.sourceDocId)}
								>
									<ExternalLink size={12} />
									Open source
								</DropdownMenu.Item>
								<DropdownMenu.Item
									title="Make this an ordinary Part you can edit here; it stops following the source"
									onclick={() => breakPartLinkCmd(history, part)}
								>
									<Unlink size={12} />
									Break link
								</DropdownMenu.Item>
							{/if}
							<DropdownMenu.Separator />
							<DropdownMenu.Item
								variant="destructive"
								disabled={doc.parts.length <= 1}
								onclick={() => deletePart(part)}
							>
								<Trash2 size={12} />
								Delete Part
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>

				<!-- Regions of the active Part -->
				{#if isActive}
					<div class="border-t border-border/60 px-2 py-1">
						{#each part.regions as region (region.id)}
							{@const meta = kindMeta(region.kind)}
							<button
								class="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent {ctx.activeRegionId ===
								region.id
									? 'bg-accent text-foreground'
									: 'text-muted-foreground'}"
								title="Make this the active region"
								onclick={() => ctx.setActiveRegion(region.id)}
							>
								<meta.icon size={11} class="shrink-0 {meta.color}" />
								<span class="truncate">{region.name}</span>
							</button>
						{/each}
					</div>
				{/if}

				<!-- Instances -->
				<div class="border-t border-border/60 px-2 py-1">
					{#each occurrences as occurrence (occurrence.id)}
						<div class="group flex items-center gap-1.5 py-0.5 pl-1">
							<button
								class="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50"
								title={occurrence.visible ? 'Hide this instance' : 'Show this instance'}
								aria-label={occurrence.visible
									? `Hide ${occurrence.name}`
									: `Show ${occurrence.name}`}
								disabled={readOnly}
								onclick={() =>
									setOccurrenceVisibleCmd(history, doc, occurrence.id, !occurrence.visible)}
							>
								{#if occurrence.visible}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
							</button>
							{#if renaming?.kind === 'occurrence' && renaming.id === occurrence.id}
								{@render renameInput()}
							{:else}
								{@const isEdited = occurrence.id === editedOccurrenceId}
								<button
									class="min-w-0 flex-1 truncate text-left text-xs {occurrence.visible
										? 'text-foreground/80'
										: 'text-muted-foreground line-through'} {isEdited
										? 'font-medium text-foreground'
										: ''}"
									title={isEdited
										? 'The 3D view edits this Part in this instance. Double-click to rename.'
										: 'Click to edit this Part in this instance, double-click to rename'}
									onclick={() => ctx.editOccurrence(occurrence.id)}
									ondblclick={() => startRename('occurrence', occurrence.id, occurrence.name)}
								>
									{occurrence.name}
								</button>
								{#if ctx.movingOccurrenceId === occurrence.id}
									<Move3d size={11} class="shrink-0 text-primary" aria-label="Being moved" />
								{/if}
							{/if}
							<DropdownMenu.Root>
								{@render menuButton(`Actions for ${occurrence.name}`)}
								<DropdownMenu.Content align="end" class="w-44">
									<DropdownMenu.Item
										onclick={() => startRename('occurrence', occurrence.id, occurrence.name)}
									>
										<Pencil size={12} />
										Rename
									</DropdownMenu.Item>
									<DropdownMenu.Item onclick={() => ctx.startMovingOccurrence(occurrence.id)}>
										<Move3d size={12} />
										Move in 3D
									</DropdownMenu.Item>
									<DropdownMenu.Item
										onclick={() =>
											setOccurrenceTransformCmd(
												history,
												doc,
												occurrence.id,
												IDENTITY_TRANSFORM,
												'Reset instance placement'
											)}
									>
										<RotateCcw size={12} />
										Reset placement
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										variant="destructive"
										disabled={isLastOccurrence(occurrence)}
										title={isLastOccurrence(occurrence)
											? 'Every Part is placed at least once. Delete the Part instead.'
											: undefined}
										onclick={() => deleteOccurrenceCmd(history, doc, occurrence.id)}
									>
										<Trash2 size={12} />
										Delete instance
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					{/each}
				</div>
			</div>
		{/each}

		{#if brokenOccurrences.length > 0}
			<div
				class="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/40"
				{@attach help({
					title: 'Missing Parts',
					text: 'These instances place a Part this design no longer has. Link each one to a Part, or delete it.',
				})}
			>
				<div
					class="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300"
				>
					<TriangleAlert size={12} />
					Instances with a missing Part
				</div>
				{#each brokenOccurrences as occurrence (occurrence.id)}
					<div class="flex items-center gap-1.5 py-0.5">
						<span class="min-w-0 flex-1 truncate text-xs">{occurrence.name}</span>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger disabled={readOnly || doc.parts.length === 0}>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="outline"
										size="sm"
										class="h-5 gap-1 px-1.5 text-[11px]"
										title="Place one of this design's Parts here instead"
									>
										<Link size={11} />
										Link to…
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="w-44">
								{#each doc.parts as part (part.id)}
									<DropdownMenu.Item
										onclick={() => relinkOccurrenceCmd(history, doc, occurrence.id, part.id)}
									>
										{part.name}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
						<Button
							variant="ghost"
							size="icon"
							class="size-5"
							title="Delete this instance"
							aria-label={`Delete ${occurrence.name}`}
							disabled={readOnly}
							onclick={() => deleteOccurrenceCmd(history, doc, occurrence.id)}
						>
							<Trash2 size={11} />
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
