<script lang="ts">
	import * as Empty from '$lib/components/ui/empty';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { buttonVariants } from '$lib/components/ui/button';
	import {
		FolderOpen,
		FileJson2,
		Puzzle,
		UploadCloud,
		Hexagon,
		Square,
		LineSquiggle,
	} from '@lucide/svelte';
	import Open from './Toolbar/Open.svelte';
	import { getEditorViewContext } from './context/EditorViewContext.svelte';
	import { help } from '$lib/components/help/help';

	const editorViewContext = getEditorViewContext();

	const regionKinds = [
		{
			value: 'HONEYCOMB' as const,
			label: 'Honeycomb',
			icon: Hexagon,
			color: 'text-blue-500',
			help: 'Helices packed on a honeycomb lattice, as in cadnano.',
		},
		{
			value: 'SQUARE' as const,
			label: 'Square',
			icon: Square,
			color: 'text-green-500',
			help: 'Helices on a square lattice, as in cadnano.',
		},
		{
			value: 'FREEFORM' as const,
			label: 'Freeform',
			icon: LineSquiggle,
			color: 'text-purple-500',
			help: 'Helices at any position and angle on the plane, with no lattice to snap to.',
		},
	];

	let isDialogOpen = $state(false);
	let isDragOver = $state(false);

	const toggleDialog = () => {
		isDialogOpen = !isDialogOpen;
	};

	// Handle files dropped directly onto the empty state — open the dialog.
	// The actual parsing is done inside Open.svelte once the dialog is open.
	// We relay the dropped files by triggering a synthetic drop on the hidden
	// FileDropZone that lives inside the dialog.
	let pendingFiles = $state<File[]>([]);

	const handleDragOver = (e: DragEvent) => {
		e.preventDefault();
		isDragOver = true;
	};

	const handleDragLeave = (e: DragEvent) => {
		// Only clear when leaving the root element, not when moving over children
		if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
			isDragOver = false;
		}
	};

	const handleDrop = (e: DragEvent) => {
		e.preventDefault();
		isDragOver = false;
		const dropped = Array.from(e.dataTransfer?.files ?? []);
		if (dropped.length > 0) {
			pendingFiles = dropped;
			isDialogOpen = true;
		}
	};
</script>

<!-- Full-area drop target -->
<div
	class="flex h-full w-full items-center justify-center transition-colors"
	class:bg-blue-50={isDragOver}
	class:dark:bg-blue-950={isDragOver}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	role="region"
	aria-label="Drop zone – drop files to open"
>
	<div class="flex w-full max-w-md flex-col items-center gap-4 px-4">
		<!-- Region-kind launch cards -->
		<div
			class="pointer-events-auto w-full"
			{@attach help({
				area: true,
				placement: 'left',
				title: 'Start with a region',
				text: 'A design is one part made of regions. Each region has its own lattice (or none) and its own base plane; you can add more regions later.',
				doc: 'mental-model',
				newVsCadnano: true,
			})}
		>
			<p
				class="mb-2 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase"
			>
				Start a new design
			</p>
			<div class="grid grid-cols-3 gap-2">
				{#each regionKinds as kind (kind.value)}
					<button
						class="flex flex-col items-center gap-1.5 rounded-md border border-border p-3 text-xs
							transition-colors hover:border-primary hover:bg-accent"
						onclick={() => editorViewContext.enterPlaneSelectionMode(kind.value)}
						{@attach help({ title: `${kind.label} region`, text: kind.help })}
					>
						<kind.icon size={20} class={kind.color} />
						<span class="font-medium">{kind.label}</span>
						<span class="text-muted-foreground">Region</span>
					</button>
				{/each}
			</div>
		</div>

		<div class="flex w-full items-center gap-2">
			<hr class="flex-1 border-border" />
			<span class="text-[10px] tracking-wide text-muted-foreground uppercase"
				>or load an existing design</span
			>
			<hr class="flex-1 border-border" />
		</div>

		<Empty.Root
			class="pointer-events-none w-full border border-dashed"
			{@attach help({
				area: true,
				placement: 'left',
				title: 'Open an existing design',
				text: 'Drop a Foldnano .fn.json or a cadnano .json here; a cadnano file opens as a new document. Plugin .zip files are offered for install.',
				doc: 'creating-a-design',
			})}
		>
			<Empty.Header>
				<Empty.Media>
					{#if isDragOver}
						<UploadCloud class="size-10 animate-bounce text-blue-500 dark:text-blue-400" />
					{:else}
						<FileJson2 class="size-10 text-muted-foreground" />
					{/if}
				</Empty.Media>
				<Empty.Title>
					{isDragOver ? 'Drop to open' : 'No design open'}
				</Empty.Title>
				<Empty.Description>
					Drop a <code>.json</code>, <code>.cadnano.json</code>, or <code>.fn.json</code> file here
					to open it, or drop a plugin <code>.zip</code> to install it.
				</Empty.Description>
			</Empty.Header>

			<Empty.Content>
				<div class="pointer-events-auto flex gap-2">
					<Dialog.Root bind:open={isDialogOpen}>
						<Dialog.Trigger class={buttonVariants({ variant: 'default' })}>
							<FolderOpen />
							Open file…
						</Dialog.Trigger>
						<Dialog.Content class="sm:max-w-2xl">
							<Dialog.Header>
								<Dialog.Title>Load design files here</Dialog.Title>
								<Dialog.Description>
									Works for cadnano <code>.json</code>, <code>.cadnano.json</code>,
									<code>.fn.json</code>, plugin manifests, and local plugin <code>.zip</code> files.
								</Dialog.Description>
							</Dialog.Header>
							<Open {toggleDialog} initialFiles={pendingFiles} />
						</Dialog.Content>
					</Dialog.Root>
					<Button
						variant="outline"
						onclick={() => {
							pendingFiles = [];
							isDialogOpen = true;
						}}
					>
						<Puzzle />
						Install plugin…
					</Button>
				</div>
			</Empty.Content>
		</Empty.Root>
	</div>
</div>
