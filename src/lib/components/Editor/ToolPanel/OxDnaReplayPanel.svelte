<script lang="ts">
	import {
		ChevronFirst,
		ChevronLast,
		Film,
		Pause,
		Play,
		Repeat,
		StepBack,
		StepForward,
		Sigma,
		Trash2,
		Upload,
	} from '@lucide/svelte/icons';
	import { toast } from 'svelte-sonner';
	import * as Accordion from '$lib/components/ui/accordion/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { FileDropZone } from '$lib/components/ui/file-drop-zone/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import type { Part } from '$lib/model/Part';
	import { formatRealTime, stepToSeconds } from '$lib/model/oxdnaReplay/oxdnaTime';
	import { REPLAY_SPEEDS_FPS } from '../View3D/replay/OxDnaReplay.svelte';
	import {
		VIDEO_FPS,
		VIDEO_SIZES,
		videoFrameIndices,
		type ReplayVideoFrame,
	} from '../View3D/replay/replayVideoExport';
	import { downloadFile } from '../View3D/threeUtils';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	type Props = {
		part: Part;
	};

	let { part }: Props = $props();

	const editorViewContext = getEditorViewContext();
	let replay = $derived(editorViewContext.view3DToolbarController?.replay ?? null);

	let stale = $derived.by(() => {
		if (!replay || replay.status !== 'ready') return false;
		void part.oligos.size;
		void part.virtualHelices.length;
		return replay.isStale(part);
	});

	let realTime = $derived(
		replay?.shownTime != null && replay.dt > 0
			? formatRealTime(stepToSeconds(replay.shownTime, replay.dt))
			: null
	);

	// The nucleotide under the pointer in 3D, resolved back to the design.
	let hovered = $derived.by(() => {
		const row = replay?.hoveredRow;
		const nt = row != null ? replay?.mapping?.nucleotides[row] : undefined;
		const strandRows = nt ? replay?.reference?.strandRows[nt.strandId - 1] : undefined;
		if (row == null || !nt || !strandRows) return null;
		const oligo = part.segmentsLookup.get(nt.segmentId)?.oligo ?? null;
		return { nt, oligo, position: row - strandRows[0] + 1, strandLength: strandRows.length };
	});

	function formatTime(time: number | null): string {
		if (time === null) return '–';
		return Math.abs(time) >= 1e5 ? time.toExponential(2) : String(time);
	}

	// Video export options; frame numbers are 1-based as shown on the timeline.
	let videoSizeId = $state('1080p');
	let videoFps = $state(30);
	let videoFrom = $state(1);
	let videoTo = $state<number | null>(null);
	let videoStride = $state(1);
	let videoCaption = $state(true);
	// Collapsed by default; the header still shows progress while an export runs.
	let videoSection = $state('');

	let videoRange = $derived.by(() => {
		const count = replay?.frameCount ?? 0;
		const to = Math.min(count, Math.max(1, videoTo ?? count));
		const from = Math.min(to, Math.max(1, videoFrom));
		const frames = videoFrameIndices(from - 1, to - 1, videoStride).length;
		return { from, to, frames, seconds: frames / videoFps };
	});

	function videoCaptionText(frame: ReplayVideoFrame): string {
		const dt = replay?.dt ?? 0;
		const real = dt > 0 ? ` (≈ ${formatRealTime(stepToSeconds(frame.step, dt))})` : '';
		return `step ${formatTime(frame.step)}${real}`;
	}

	async function exportVideo() {
		const controller = editorViewContext.view3DToolbarController;
		if (!replay || !controller) return;
		const size = VIDEO_SIZES.find((s) => s.id === videoSizeId)?.size ?? null;
		const renderer = controller.onCreateReplayFrameRenderer?.(size);
		if (!renderer) {
			toast.error('Show the replay in the 3D view to export a video.');
			return;
		}
		const blob = await replay.exportVideo({
			renderer,
			fps: videoFps,
			from: videoRange.from - 1,
			to: videoRange.to - 1,
			stride: videoStride,
			caption: videoCaption ? videoCaptionText : null,
		});
		if (!blob) return;
		const url = URL.createObjectURL(blob);
		const base = replay.trajectoryFile?.name.replace(/\.[^.]+$/, '') || 'oxdna-replay';
		downloadFile(url, `${base}.mp4`);
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}
</script>

{#if !replay}
	<div class="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
		The replay panel is waiting for the 3D view to register.
	</div>
{:else}
	<div class="flex flex-col gap-2 text-xs">
		{#if replay.status === 'ready' || replay.status === 'indexing'}
			<div class="space-y-1 rounded-md border border-border p-2">
				<div class="flex items-center justify-between gap-2">
					<p
						class="min-w-0 truncate font-medium text-foreground"
						title={replay.trajectoryFile?.name}
					>
						{replay.trajectoryFile?.name}
					</p>
					<Button
						variant="ghost"
						size="icon-sm"
						title="Unload the trajectory"
						onclick={() => replay.clear()}
					>
						<Trash2 />
					</Button>
				</div>
				<p class="text-muted-foreground">
					{replay.mapping?.nucleotides.length ?? 0} nts, {replay.mapping?.strandCount ?? 0} strands{replay
						.mapping?.includeMirrors
						? ', with mirror copies'
						: ''}
					{#if replay.status === 'ready'}· {replay.frameCount} frames{/if}
				</p>
				{#if replay.status === 'indexing'}
					<Progress value={replay.indexProgress * 100} class="h-1" />
					<p class="text-muted-foreground">Reading frames…</p>
				{/if}
			</div>
		{/if}

		{#if stale}
			<div class="rounded-md border border-destructive/50 p-2 text-destructive">
				The design changed after the trajectory was loaded, so its nucleotides no longer line up.
				Undo the change, or export again and re-simulate.
			</div>
		{/if}

		{#if replay.status === 'error'}
			<div class="rounded-md border border-destructive/50 p-2 text-destructive">
				{replay.error}
			</div>
		{/if}

		{#if replay.status === 'ready'}
			<!-- Timeline -->
			<div class="space-y-2 rounded-md border border-border p-2">
				<input
					type="range"
					class="w-full accent-primary"
					aria-label="Frame"
					min="0"
					max={Math.max(0, replay.frameCount - 1)}
					step="1"
					value={replay.frameIndex}
					oninput={(e) => {
						replay.pause();
						replay.showMean = false;
						replay.seek(Number((e.target as HTMLInputElement).value));
					}}
				/>
				<div class="flex items-center justify-between text-muted-foreground tabular-nums">
					<span>Frame {replay.frameIndex + 1} / {replay.frameCount}</span>
					<span
						title="MD step from the frame header; real time is step × dt × 3.03 ps (one oxDNA time unit)"
					>
						step {formatTime(replay.shownTime)}{#if realTime}&nbsp;(≈ {realTime}){/if}
					</span>
				</div>
				{#if replay.frameError}
					<p class="text-destructive">
						Frame {replay.frameIndex + 1} can't be read: {replay.frameError}
					</p>
				{/if}
				<div class="flex items-center justify-between gap-1">
					<div class="flex items-center gap-0.5">
						<Button
							variant="ghost"
							size="icon-sm"
							title="First frame"
							onclick={() => replay.step(-replay.frameCount)}
						>
							<ChevronFirst />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							title="Previous frame"
							onclick={() => replay.step(-1)}
						>
							<StepBack />
						</Button>
						<Button
							variant="default"
							size="icon-sm"
							title={replay.playing ? 'Pause' : 'Play'}
							onclick={() => replay.togglePlay()}
						>
							{#if replay.playing}<Pause />{:else}<Play />{/if}
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							title="Next frame"
							onclick={() => replay.step(1)}
						>
							<StepForward />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							title="Last frame"
							onclick={() => replay.step(replay.frameCount)}
						>
							<ChevronLast />
						</Button>
					</div>
					<Button
						variant={replay.loop ? 'default' : 'ghost'}
						size="icon-sm"
						title={replay.loop ? 'Looping' : 'Play once'}
						onclick={() => (replay.loop = !replay.loop)}
					>
						<Repeat />
					</Button>
				</div>
				<div class="flex items-center justify-between gap-2">
					<Label
						for="replay-dt"
						class="text-xs font-normal text-muted-foreground"
						title="The dt line of the simulation's oxDNA input file; it is not in the trajectory"
						>Time step (dt)</Label
					>
					<Input
						id="replay-dt"
						type="number"
						min="0"
						step="0.001"
						class="h-7 w-28 text-xs"
						bind:value={() => replay.dt, (v) => (replay.dt = Number(v) > 0 ? Number(v) : 0)}
					/>
				</div>
				<div class="flex items-center justify-between gap-2">
					<Label class="text-xs font-normal text-muted-foreground">Speed</Label>
					<Select.Root
						type="single"
						bind:value={() => String(replay.fps), (v) => (replay.fps = Number(v))}
					>
						<Select.Trigger size="sm" class="w-28">{replay.fps} frames/s</Select.Trigger>
						<Select.Content>
							{#each REPLAY_SPEEDS_FPS as fps (fps)}
								<Select.Item value={String(fps)} label="{fps} frames/s" />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<!-- Display -->
			<div class="space-y-2 rounded-md border border-border p-2">
				<div class="flex items-center justify-between gap-2">
					<Label for="replay-align" class="text-xs font-normal">Align to design</Label>
					<Switch
						id="replay-align"
						bind:checked={
							() => replay.alignToDesign,
							(v) => {
								replay.alignToDesign = v;
								replay.refresh();
							}
						}
					/>
				</div>
				<div class="flex items-center justify-between gap-2">
					<Label for="replay-design" class="text-xs font-normal">Show design underneath</Label>
					<Switch id="replay-design" bind:checked={replay.showDesign} />
				</div>
			</div>

			<!-- Mean structure -->
			<div class="space-y-2 rounded-md border border-border p-2">
				{#if replay.meanStatus === 'ready'}
					<div class="flex items-center justify-between gap-2">
						<Label for="replay-mean" class="text-xs font-normal">Show mean structure</Label>
						<Switch
							id="replay-mean"
							bind:checked={
								() => replay.showMean,
								(v) => {
									replay.showMean = v;
									if (v) replay.pause();
								}
							}
						/>
					</div>
					<p class="text-muted-foreground">
						Average of {replay.meanFrameCount} frames, each aligned to the design.
						{#if replay.skippedFrames > 0}
							Left out {replay.skippedFrames} unreadable
							{replay.skippedFrames === 1 ? 'frame' : 'frames'}, likely cut off by an interrupted
							run.
						{/if}
					</p>
				{:else if replay.meanStatus === 'computing'}
					<div class="flex items-center justify-between gap-2">
						<span class="text-muted-foreground">Averaging frames…</span>
						<Button variant="ghost" size="sm" onclick={() => replay.cancelMean()}>Cancel</Button>
					</div>
					<Progress value={replay.meanProgress * 100} class="h-1" />
				{:else}
					<div class="flex items-center justify-between gap-2">
						<span class="text-muted-foreground">Mean structure</span>
						<Button variant="outline" size="sm" onclick={() => replay.computeMean()}>
							<Sigma />
							<span>Compute</span>
						</Button>
					</div>
					{#if replay.meanStatus === 'error'}
						<p class="text-destructive">{replay.meanError}</p>
					{/if}
				{/if}
			</div>

			<!-- Video export -->
			<Accordion.Root
				type="single"
				bind:value={videoSection}
				class="rounded-md border border-border px-2"
			>
				<Accordion.Item value="video" class="border-b-0">
					<Accordion.Trigger class="py-2 hover:no-underline">
						<span>
							Video{#if replay.videoStatus === 'exporting'}
								<span class="font-normal text-muted-foreground">
									· exporting {Math.round(replay.videoProgress * 100)}%</span
								>{/if}
						</span>
					</Accordion.Trigger>
					<Accordion.Content class="space-y-2 pb-2 [&_p:not(:last-child)]:mb-0">
						<div class="flex items-center justify-between gap-2">
							<Label class="text-xs font-normal text-muted-foreground">Size</Label>
							<Select.Root type="single" bind:value={videoSizeId}>
								<Select.Trigger size="sm" class="w-40">
									{VIDEO_SIZES.find((s) => s.id === videoSizeId)?.label}
								</Select.Trigger>
								<Select.Content>
									{#each VIDEO_SIZES as size (size.id)}
										<Select.Item value={size.id} label={size.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex items-center justify-between gap-2">
							<Label class="text-xs font-normal text-muted-foreground">Frame rate</Label>
							<Select.Root
								type="single"
								bind:value={() => String(videoFps), (v) => (videoFps = Number(v))}
							>
								<Select.Trigger size="sm" class="w-40">{videoFps} frames/s</Select.Trigger>
								<Select.Content>
									{#each VIDEO_FPS as fps (fps)}
										<Select.Item value={String(fps)} label="{fps} frames/s" />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex items-center justify-between gap-1">
							<Label class="text-xs font-normal text-muted-foreground">Frames</Label>
							<div class="flex items-center gap-1 text-muted-foreground">
								<Input
									type="number"
									min="1"
									max={replay.frameCount}
									class="h-7 w-16 text-xs"
									aria-label="First frame"
									bind:value={
										() => videoRange.from, (v) => (videoFrom = Math.round(Number(v)) || 1)
									}
								/>
								<span>to</span>
								<Input
									type="number"
									min="1"
									max={replay.frameCount}
									class="h-7 w-16 text-xs"
									aria-label="Last frame"
									bind:value={() => videoRange.to, (v) => (videoTo = Math.round(Number(v)) || null)}
								/>
							</div>
						</div>
						<div class="flex items-center justify-between gap-2">
							<Label for="replay-video-stride" class="text-xs font-normal text-muted-foreground"
								>Every Nth frame</Label
							>
							<Input
								id="replay-video-stride"
								type="number"
								min="1"
								class="h-7 w-16 text-xs"
								bind:value={
									() => videoStride, (v) => (videoStride = Math.max(1, Math.round(Number(v)) || 1))
								}
							/>
						</div>
						<div class="flex items-center justify-between gap-2">
							<Label for="replay-video-caption" class="text-xs font-normal"
								>Show step and time</Label
							>
							<Switch id="replay-video-caption" bind:checked={videoCaption} />
						</div>
						{#if replay.videoStatus === 'exporting'}
							<div class="flex items-center justify-between gap-2">
								<span class="text-muted-foreground">
									Rendering frames… {Math.round(replay.videoProgress * 100)}%
								</span>
								<Button variant="ghost" size="sm" onclick={() => replay.cancelVideo()}
									>Cancel</Button
								>
							</div>
							<Progress value={replay.videoProgress * 100} class="h-1" />
						{:else}
							<div class="flex items-center justify-between gap-2">
								<span class="text-muted-foreground tabular-nums">
									{videoRange.frames} frames · {videoRange.seconds.toFixed(1)} s
								</span>
								<Button
									variant="outline"
									size="sm"
									disabled={stale || videoRange.frames === 0}
									onclick={exportVideo}
								>
									<Film />
									<span>Export MP4</span>
								</Button>
							</div>
						{/if}
						{#if replay.videoMessage}
							<p
								class={replay.videoStatus === 'error'
									? 'text-destructive'
									: 'text-muted-foreground'}
							>
								{replay.videoMessage}
							</p>
						{/if}
						<p class="text-muted-foreground">
							Uses the 3D view's camera and what it shows now: strand filter, fading and colours.
						</p>
					</Accordion.Content>
				</Accordion.Item>
			</Accordion.Root>

			<!-- Hovered nucleotide -->
			<div class="space-y-0.5 rounded-md border border-border p-2">
				{#if hovered}
					<div class="flex items-center gap-1.5">
						<span
							class="size-2.5 shrink-0 rounded-full border border-border"
							style:background-color={hovered.oligo?.color}
						></span>
						<span class="truncate font-medium text-foreground">
							{hovered.oligo?.name || (hovered.oligo?.isScaffold ? 'Scaffold' : 'Staple')}
						</span>
						<span class="text-muted-foreground"
							>· {hovered.oligo?.length ?? hovered.strandLength} nt</span
						>
					</div>
					<p class="text-muted-foreground tabular-nums">
						Helix {hovered.nt.vhIndex}, base {hovered.nt.bpIndex}{hovered.nt.loopIndex > 0
							? ` (insert ${hovered.nt.loopIndex})`
							: ''}
					</p>
					<p class="text-muted-foreground tabular-nums">
						Nucleotide {hovered.position} of {hovered.strandLength} from the 5′ end
					</p>
				{:else}
					<p class="text-muted-foreground">
						Hover a nucleotide to see which strand it belongs to. Click it to select that strand in
						the strand view; select strands there to highlight them here.
					</p>
				{/if}
			</div>
		{/if}

		{#if replay.status !== 'ready' && replay.status !== 'indexing'}
			<p class="text-muted-foreground">
				Replay a trajectory simulated from this design's oxDNA export. Drop the trajectory (.dat)
				together with the export's .top.
			</p>
			{#if replay.topologyFile || replay.trajectoryFile}
				<ul class="space-y-0.5">
					<li>
						<span class="text-muted-foreground">Topology:</span>
						<span class="font-mono">{replay.topologyFile?.name ?? 'waiting for .top'}</span>
					</li>
					<li>
						<span class="text-muted-foreground">Trajectory:</span>
						<span class="font-mono">{replay.trajectoryFile?.name ?? 'waiting for .dat'}</span>
					</li>
				</ul>
			{/if}
		{/if}

		<FileDropZone
			accept=".top,.dat,.oxdna,.conf"
			class="h-24 rounded-md border border-border p-3"
			onUpload={async (files) => replay.addFiles(files)}
			onFileRejected={({ reason, file }) => {
				toast.error('File rejected', { description: `${file.name}: ${reason}` });
			}}
		>
			<div
				class="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground"
			>
				<div
					class="flex size-8 items-center justify-center rounded-full border border-dashed border-border"
				>
					<Upload size={16} />
				</div>
				<div class="space-y-0.5">
					<p class="text-xs font-medium">Drop trajectory .dat + .top</p>
					<p class="text-[11px]">or click to select both files</p>
				</div>
			</div>
		</FileDropZone>
	</div>
{/if}
