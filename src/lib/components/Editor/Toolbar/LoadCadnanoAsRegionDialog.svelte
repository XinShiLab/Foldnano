<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Progress } from '$lib/components/ui/progress';
	import {
		displaySize,
		FileDropZone,
		MEGABYTE,
		type FileDropZoneProps,
	} from '$lib/components/ui/file-drop-zone';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { SvelteDate } from 'svelte/reactivity';
	import { FileJson2, LoaderCircle, XIcon } from '@lucide/svelte';
	import { CadnanoJSON, type VStrandJSON } from '$lib/model/io/cadnanoJSON';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { getEditorDocumentSession } from '../context/EditorDocumentSession.svelte';

	let { open = $bindable() }: { open: boolean } = $props();

	const editorViewContext = getEditorViewContext();
	const session = getEditorDocumentSession();

	let isLoading = $state(false);
	let files = $state<UploadedFile[]>([]);
	let selectedPlane = $state<'XY' | 'XZ' | 'YZ'>('XY');
	let date = new SvelteDate();

	type UploadedFile = {
		name: string;
		type: string;
		size: number;
		uploadedAt: number;
		url: string;
		parsed: Promise<CadnanoJSON>;
	};

	const basePlanes: { value: 'XY' | 'XZ' | 'YZ'; label: string; description: string }[] = [
		{ value: 'XY', label: 'Top (XY)', description: 'Horizontal — normal points up (Z)' },
		{ value: 'XZ', label: 'Front (XZ)', description: 'Frontal — normal points forward (Y)' },
		{ value: 'YZ', label: 'Side (YZ)', description: 'Sagittal — normal points right (X)' },
	];

	async function parseCadnanoFile(file: File): Promise<CadnanoJSON> {
		const text = await file.text();
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			throw new Error('File is not valid JSON.');
		}
		if (!raw || typeof raw !== 'object') throw new Error('Empty or invalid JSON.');
		const obj = raw as Record<string, unknown>;
		if (!Array.isArray(obj.vstrands) || typeof obj.name !== 'string') {
			throw new Error('Missing required cadnano fields ("name" and "vstrands").');
		}
		const cadnano = new CadnanoJSON(obj.name, obj.vstrands as VStrandJSON[]);
		const numBases = cadnano.vstrands[0]?.scaf.length ?? 0;
		if (!(numBases % 32 === 0 || numBases % 21 === 0)) {
			throw new Error(`Unsupported cadnano lattice (numBases=${numBases}).`);
		}
		return cadnano;
	}

	const onUpload: FileDropZoneProps['onUpload'] = async (uploadedFiles) => {
		await Promise.allSettled(uploadedFiles.map((file) => uploadFile(file)));
	};

	const onFileRejected: FileDropZoneProps['onFileRejected'] = async ({ reason, file }) => {
		toast.error(`${file.name} failed to upload!`, { description: reason });
	};

	const uploadFile = async (file: File) => {
		if (files.find((f) => f.name === file.name)) return;
		const url = URL.createObjectURL(file);
		const parsed = parseCadnanoFile(file);
		files.push({
			name: file.name,
			type: file.type,
			size: file.size,
			uploadedAt: Date.now(),
			url,
			parsed,
		});
	};

	const removeFile = (i: number, url: string) => {
		URL.revokeObjectURL(url);
		files = [...files.slice(0, i), ...files.slice(i + 1)];
	};

	const onLoadClick = async (cadnano: CadnanoJSON) => {
		isLoading = true;
		try {
			editorViewContext.loadCadnanoAsRegion(cadnano, selectedPlane);
			await session.saveDocumentToLocalStorage();
		} catch (err) {
			toast.error('Failed to load cadnano file as region', {
				description: (err as Error).message,
			});
			return;
		} finally {
			isLoading = false;
		}
		open = false;
	};

	$effect(() => {
		const interval = setInterval(() => {
			date.setTime(Date.now());
		}, 10);
		return () => clearInterval(interval);
	});

	onDestroy(async () => {
		for (const file of files) URL.revokeObjectURL(file.url);
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Load Cadnano Design as a Region</Dialog.Title>
			<Dialog.Description>
				Drop a cadnano <code>.json</code> or <code>.cadnano.json</code> file and pick a base plane. The
				cadnano content will be added as a new lattice region.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex w-full flex-col gap-4 p-6">
			<!-- Base plane picker -->
			<div class="flex flex-col gap-1.5">
				<span class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
					Base Plane
				</span>
				<div class="grid grid-cols-3 gap-1">
					{#each basePlanes as plane (plane.value)}
						<button
							class="rounded-md border px-1.5 py-1.5 text-center text-xs transition-colors
								{selectedPlane === plane.value
								? 'border-primary bg-primary/10 font-semibold text-primary'
								: 'border-border hover:bg-accent hover:text-accent-foreground'}"
							onclick={() => (selectedPlane = plane.value)}
						>
							{plane.label}
						</button>
					{/each}
				</div>
				<p class="text-[10px] text-muted-foreground">
					{basePlanes.find((p) => p.value === selectedPlane)?.description ?? ''}
				</p>
			</div>

			<!-- File picker -->
			<FileDropZone
				{onUpload}
				{onFileRejected}
				maxFileSize={2 * MEGABYTE}
				accept="application/json"
				maxFiles={1}
				fileCount={files.length}
			/>
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
								onclick={() => removeFile(i, file.url)}
							>
								<XIcon class="size-3.5" />
							</Button>
						</div>

						<!-- Row 2: parse status + Load action -->
						{#await file.parsed}
							<Progress
								class="h-1.5 w-full"
								value={((date.getTime() - file.uploadedAt) / 1000) * 100}
								max={100}
							/>
						{:then parsed}
							<div class="flex items-center justify-end gap-2">
								{#if isLoading}
									<Button size="sm" disabled><LoaderCircle class="animate-spin" />Load</Button>
								{:else}
									<Button size="sm" onclick={() => onLoadClick(parsed)}>Load</Button>
								{/if}
							</div>
						{:catch error}
							<div class="text-xs text-red-500">Error: {error.message}</div>
						{/await}
					</div>
				{/each}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
