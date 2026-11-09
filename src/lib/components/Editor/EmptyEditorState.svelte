<script lang="ts">
	import * as Empty from '$lib/components/ui/empty';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button';
	import {
		FolderOpen,
		FileJson2,
		UploadCloud,
		Hexagon,
		Square,
		LineSquiggle,
		Pyramid,
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { notify } from '$lib/notifications/notify.svelte';
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

	// Dropped and picked files take the same route: a mesh starts a region, anything else is previewed.
	const openFiles = (picked: File[]) => {
		if (picked.length > 1) {
			notify.error('Drop one file at a time', {
				description: `${picked.length} files were dropped. Nothing was opened.`,
			});
		} else if (picked.length === 1 && picked[0].name.toLowerCase().endsWith('.ply')) {
			void editorViewContext.startWireframeRegionFromFile(picked[0]);
		} else if (picked.length === 1) {
			pendingFiles = picked;
			isDialogOpen = true;
		}
	};

	const handleDrop = (e: DragEvent) => {
		e.preventDefault();
		isDragOver = false;
		openFiles(Array.from(e.dataTransfer?.files ?? []));
	};

	let fileInput = $state<HTMLInputElement | null>(null);
	const handlePicked = (e: Event) => {
		const input = e.currentTarget as HTMLInputElement;
		openFiles(Array.from(input.files ?? []));
		input.value = '';
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
			<div class="grid grid-cols-4 gap-2">
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
				<div
					class="group relative"
					{@attach help({
						title: 'Wireframe region',
						text: 'Experimental. One routing plugin, pyDAEDALUS, is available in the Hub, and more are in progress. It has not been extensively tested in the lab yet, so simulate before ordering staples.',
						doc: 'wireframe',
					})}
				>
					<button
						class="relative flex h-full w-full flex-col items-center gap-1.5 rounded-md border border-border p-3 text-xs transition-colors hover:border-primary hover:bg-accent"
						onclick={() => editorViewContext.enterPlaneSelectionMode('WIREFRAME')}
					>
						<Badge
							variant="outline"
							class="absolute -top-2 left-1/2 h-4 -translate-x-1/2 bg-background px-1 text-[10px] font-normal text-muted-foreground"
						>
							Experimental
						</Badge>
						<Pyramid size={20} class="text-orange-500" />
						<span class="font-medium">Wireframe</span>
						<span class="text-muted-foreground">Region</span>
					</button>
					<!-- pt-1 bridges the hover gap; touch has no hover, so the link stays visible there. -->
					<div
						class="pointer-events-none absolute top-full right-0 z-10 pt-1 whitespace-nowrap opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
					>
						<a
							class="block rounded-md border border-border bg-popover px-2 py-1 text-xs text-muted-foreground underline underline-offset-2 shadow-sm hover:text-foreground"
							href={resolve('/docs/[...slug]', { slug: 'guide/wireframe' })}
							target="_blank"
							rel="noopener noreferrer"
						>
							Wireframe support: current status
						</a>
					</div>
				</div>
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
				text: 'Drop a file here or click Open file. A Foldnano design opens as it is; a cadnano design opens as a new design; an ASCII .ply mesh starts a wireframe region; a plugin .zip is offered for install.',
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
					<p>Drop a file here, or open one:</p>
					<ul class="mt-1 inline-block text-left">
						<li>a Foldnano design (<code>.fn.json</code>)</li>
						<li>a cadnano design (<code>.json</code>), as a region in a new design</li>
						<li>an ASCII PLY mesh (<code>.ply</code>), to start a wireframe region</li>
						<li>a plugin (<code>.zip</code>), to install it</li>
					</ul>
				</Empty.Description>
			</Empty.Header>

			<Empty.Content>
				<div class="pointer-events-auto">
					<input
						bind:this={fileInput}
						type="file"
						class="hidden"
						accept=".json,.ply,.zip,application/json,application/zip"
						onchange={handlePicked}
					/>
					<Button onclick={() => fileInput?.click()}>
						<FolderOpen />
						Open file…
					</Button>
					<Dialog.Root bind:open={isDialogOpen}>
						<Dialog.Content class="sm:max-w-2xl">
							<Dialog.Header>
								<Dialog.Title>Open file</Dialog.Title>
								<Dialog.Description>
									A Foldnano design opens as it is, a cadnano design opens as a new design, and a
									plugin <code>.zip</code> is offered for install.
								</Dialog.Description>
							</Dialog.Header>
							<Open {toggleDialog} initialFiles={pendingFiles} />
						</Dialog.Content>
					</Dialog.Root>
				</div>
			</Empty.Content>
		</Empty.Root>
	</div>
</div>
