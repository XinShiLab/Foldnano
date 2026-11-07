import { SvelteMap } from 'svelte/reactivity';
import type { Part } from '$lib/model/Part';
import { computeSimulationFreshnessSignature } from '../view3dSimulationState';
import {
	buildReplayReference,
	poseFrame,
	type PosedFrame,
	type ReplayReference,
} from '$lib/model/oxdnaReplay/framePose';
import { DEFAULT_OXDNA_DT } from '$lib/model/oxdnaReplay/oxdnaTime';
import { parseOxDnaTopology } from '$lib/model/oxdnaReplay/oxdnaTopology';
import type { OxDnaFrame } from '$lib/model/oxdnaReplay/oxdnaTrajectory';
import { matchTopologyToDesign, type ReplayMapping } from '$lib/model/oxdnaReplay/replayMapping';
import type { ReplayWorkerRequest, ReplayWorkerResponse } from './oxdnaReplayWorker';
import {
	encodeReplayVideo,
	findVideoCodec,
	videoFrameIndices,
	type ReplayFrameRenderer,
	type ReplayVideoFrame,
} from './replayVideoExport';

export type ReplayStatus = 'idle' | 'indexing' | 'ready' | 'error';
export type VideoExportStatus = 'idle' | 'exporting' | 'done' | 'error';

export interface ReplayVideoRequest {
	renderer: ReplayFrameRenderer;
	fps: number;
	/** 0-based, inclusive. */
	from: number;
	to: number;
	stride: number;
	caption: ((frame: ReplayVideoFrame) => string) | null;
}
export type MeanStatus = 'none' | 'computing' | 'ready' | 'error';

export const REPLAY_SPEEDS_FPS = [5, 10, 20, 30, 60] as const;

const CACHE_FRAMES = 48;
const PREFETCH_FRAMES = 8;

/**
 * One loaded oxDNA trajectory, replayed over the design it was exported from. Session-only:
 * nothing here is persisted, and the user drops the files again to replay after a reload.
 */
export class OxDnaReplay {
	status = $state<ReplayStatus>('idle');
	error = $state<string | null>(null);
	topologyFile = $state<File | null>(null);
	trajectoryFile = $state<File | null>(null);
	indexProgress = $state(0);
	frameCount = $state(0);
	frameIndex = $state(0);
	playing = $state(false);
	fps = $state<number>(10);
	loop = $state(true);
	alignToDesign = $state(true);
	showDesign = $state(false);
	/** MD step of the shown frame (the header's `t`). */
	shownTime = $state<number | null>(null);
	/** The run's time step, from its oxDNA input file; only used to show real time. */
	dt = $state(DEFAULT_OXDNA_DT);
	shownIndex = $state<number | null>(null);
	pose = $state.raw<PosedFrame | null>(null);
	mapping = $state.raw<ReplayMapping | null>(null);
	reference = $state.raw<ReplayReference | null>(null);
	designSignature = $state<string | null>(null);

	meanStatus = $state<MeanStatus>('none');
	meanProgress = $state(0);
	meanError = $state<string | null>(null);
	meanFrameCount = $state(0);
	meanPose = $state.raw<PosedFrame | null>(null);
	/** Show the mean structure instead of the current frame. */
	showMean = $state(false);
	/** Trajectory row under the pointer in the 3D view. */
	hoveredRow = $state<number | null>(null);
	/** Frames that could not be read (e.g. cut off by an interrupted run), with the reason. */
	readonly badFrames = new SvelteMap<number, string>();
	/** Frames the last mean-structure pass left out because they could not be read. */
	skippedFrames = $state(0);

	videoStatus = $state<VideoExportStatus>('idle');
	videoProgress = $state(0);
	/** Error, or what the last export wrote (frames left out included). */
	videoMessage = $state<string | null>(null);

	/** Why the frame at the play head could not be read, if it could not. */
	get frameError(): string | null {
		return this.badFrames.get(this.frameIndex) ?? null;
	}

	/** What the 3D view draws: the mean structure when shown, else the current frame. */
	get displayPose(): PosedFrame | null {
		return this.showMean && this.meanPose ? this.meanPose : this.pose;
	}

	private readonly _part: Part;
	private _worker: Worker | null = null;
	// Insertion-ordered for LRU eviction; frames are raw and posed on display.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private _cache = new Map<number, OxDnaFrame>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private _inFlight = new Set<number>();
	private _raf = 0;
	private _lastAdvance = 0;
	// Callers awaiting a frame (video export); answered by the worker's frame / frameError reply.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private _waiters = new Map<number, ((frame: OxDnaFrame | null) => void)[]>();
	private _videoCancelled = false;

	constructor(part: Part) {
		this._part = part;
	}

	/** True when the design changed (topology or planes) after the files were loaded. */
	isStale(part: Part): boolean {
		return (
			this.designSignature !== null &&
			this.designSignature !== computeSimulationFreshnessSignature(part)
		);
	}

	/** Accepts the `.top` and the trajectory together or one at a time; loads once both are in. */
	addFiles(files: readonly File[]): void {
		for (const file of files) {
			if (/\.top$/i.test(file.name)) this.topologyFile = file;
			else this.trajectoryFile = file;
		}
		if (this.topologyFile && this.trajectoryFile) void this._load();
	}

	private _fail(message: string): void {
		this._stopWorker();
		this.status = 'error';
		this.error = message;
	}

	private async _load(): Promise<void> {
		const topFile = this.topologyFile!;
		const trajectory = this.trajectoryFile!;
		this._reset();
		let mapping: ReplayMapping;
		try {
			const result = matchTopologyToDesign(this._part, parseOxDnaTopology(await topFile.text()));
			if (!result.ok) return this._fail(result.reason);
			mapping = result.mapping;
		} catch (err) {
			return this._fail(err instanceof Error ? err.message : String(err));
		}
		this.mapping = mapping;
		this.reference = buildReplayReference(mapping.nucleotides);
		this.designSignature = computeSimulationFreshnessSignature(this._part);
		this.status = 'indexing';

		// Vite's worker import form; the URL is never mutated.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const worker = new Worker(new URL('./oxdnaReplayWorker.ts', import.meta.url), {
			type: 'module',
		});
		worker.onmessage = (event: MessageEvent<ReplayWorkerResponse>) =>
			this._onMessage(worker, event.data);
		worker.onerror = (event) => this._fail(event.message || 'The trajectory reader stopped.');
		this._worker = worker;
		this._post({ type: 'open', file: trajectory, nucleotideCount: mapping.nucleotides.length });
	}

	private _post(message: ReplayWorkerRequest): void {
		this._worker?.postMessage(message);
	}

	private _onMessage(worker: Worker, message: ReplayWorkerResponse): void {
		if (worker !== this._worker) return;
		switch (message.type) {
			case 'progress':
				this.indexProgress = message.fraction;
				break;
			case 'indexed':
				this.frameCount = message.frameCount;
				this.status = 'ready';
				this.seek(0);
				break;
			case 'frame':
				this._inFlight.delete(message.index);
				this._cache.set(message.index, {
					time: message.time,
					box: message.box,
					data: message.data,
				});
				while (this._cache.size > CACHE_FRAMES) {
					this._cache.delete(this._cache.keys().next().value!);
				}
				if (message.index === this.frameIndex) this._show(message.index);
				this._answer(message.index, this._cache.get(message.index) ?? null);
				break;
			case 'meanProgress':
				this.meanProgress = message.fraction;
				break;
			case 'mean':
				this.meanPose = { backboneNm: message.backboneNm, baseNm: message.baseNm };
				this.meanFrameCount = message.frameCount;
				this.skippedFrames = message.skippedFrames.length;
				for (const index of message.skippedFrames) {
					if (!this.badFrames.has(index)) this.badFrames.set(index, 'The frame could not be read.');
				}
				this.meanStatus = 'ready';
				this.meanProgress = 1;
				this.showMean = true;
				this.pause();
				break;
			case 'meanCancelled':
				if (this.meanStatus === 'computing') this.meanStatus = this.meanPose ? 'ready' : 'none';
				break;
			case 'meanError':
				this.meanStatus = 'error';
				this.meanError = message.message;
				break;
			case 'frameError':
				this._inFlight.delete(message.index);
				this.badFrames.set(message.index, message.message);
				this._answer(message.index, null);
				break;
			case 'error':
				if (message.index !== undefined) this._inFlight.delete(message.index);
				this._fail(message.message);
				break;
		}
	}

	private _request(index: number): void {
		if (index < 0 || index >= this.frameCount) return;
		if (this._cache.has(index) || this._inFlight.has(index) || this.badFrames.has(index)) return;
		this._inFlight.add(index);
		this._post({ type: 'frame', index });
	}

	private _answer(index: number, frame: OxDnaFrame | null): void {
		const waiting = this._waiters.get(index);
		this._waiters.delete(index);
		for (const resolve of waiting ?? []) resolve(frame);
	}

	/** The raw frame, read by the worker if not cached; null when it cannot be read. */
	private _loadFrame(index: number): Promise<OxDnaFrame | null> {
		const cached = this._cache.get(index);
		if (cached) return Promise.resolve(cached);
		if (this.badFrames.has(index) || !this._worker) return Promise.resolve(null);
		return new Promise((resolve) => {
			this._waiters.set(index, [...(this._waiters.get(index) ?? []), resolve]);
			this._request(index);
		});
	}

	/**
	 * Renders the chosen frames, posed as the replay shows them, into an MP4. Playback pauses; the
	 * camera and everything shown (filter, fading, colours) are those of the 3D view at the start.
	 */
	async exportVideo(request: ReplayVideoRequest): Promise<Blob | null> {
		const reference = this.reference;
		if (this.status !== 'ready' || !reference || this.videoStatus === 'exporting') return null;
		const { renderer, fps } = request;
		this.pause();
		this.showMean = false;
		this.videoStatus = 'exporting';
		this.videoProgress = 0;
		this.videoMessage = null;
		this._videoCancelled = false;
		const alignToDesign = this.alignToDesign;
		const indices = videoFrameIndices(request.from, request.to, request.stride, (i) =>
			this.badFrames.has(i)
		);
		try {
			const codec = await findVideoCodec(renderer, fps);
			if (!codec) throw new Error('This browser cannot encode MP4 video at this size.');
			const result = await encodeReplayVideo({
				codec,
				fps,
				indices,
				renderer,
				caption: request.caption,
				loadFrame: async (index) => {
					// Read ahead while this frame is drawn and encoded.
					const at = indices.indexOf(index);
					for (const next of indices.slice(at + 1, at + 1 + PREFETCH_FRAMES)) this._request(next);
					const frame = await this._loadFrame(index);
					if (!frame) return null;
					return { pose: poseFrame(frame, reference, { alignToDesign }), step: frame.time };
				},
				isCancelled: () => this._videoCancelled || this.status !== 'ready',
				onProgress: (fraction) => (this.videoProgress = fraction),
			});
			if (!result) {
				this.videoStatus = 'idle';
				return null;
			}
			this.videoStatus = 'done';
			this.videoMessage =
				`Wrote ${result.written} frames (${(result.written / fps).toFixed(1)} s)` +
				(result.skipped > 0 ? `; left out ${result.skipped} unreadable.` : '.');
			return result.blob;
		} catch (error) {
			this.videoStatus = 'error';
			this.videoMessage = error instanceof Error ? error.message : String(error);
			return null;
		} finally {
			renderer.dispose();
		}
	}

	cancelVideo(): void {
		this._videoCancelled = true;
	}

	private _prefetch(from: number): void {
		for (let k = 1; k <= PREFETCH_FRAMES; k++) {
			const index = from + k;
			this._request(this.loop ? index % this.frameCount : index);
		}
	}

	private _show(index: number): void {
		const frame = this._cache.get(index);
		if (!frame || !this.reference) return;
		// Re-insert to mark as recently used.
		this._cache.delete(index);
		this._cache.set(index, frame);
		this.pose = poseFrame(frame, this.reference, { alignToDesign: this.alignToDesign });
		this.shownTime = frame.time;
		this.shownIndex = index;
	}

	/** Averages every frame (aligned to the design) in the worker; playback keeps working. */
	computeMean(): void {
		if (this.status !== 'ready' || !this.reference || this.meanStatus === 'computing') return;
		this.meanStatus = 'computing';
		this.meanProgress = 0;
		this.meanError = null;
		this._post({ type: 'mean', reference: this.reference });
	}

	cancelMean(): void {
		if (this.meanStatus !== 'computing') return;
		this._post({ type: 'cancelMean' });
		this.meanStatus = this.meanPose ? 'ready' : 'none';
	}

	/** Re-poses the shown frame (after toggling alignment). */
	refresh(): void {
		if (this.shownIndex !== null) this._show(this.shownIndex);
	}

	seek(index: number): void {
		if (this.frameCount === 0) return;
		const clamped = Math.max(0, Math.min(this.frameCount - 1, Math.round(index)));
		this.frameIndex = clamped;
		if (this._cache.has(clamped)) this._show(clamped);
		else this._request(clamped);
		this._prefetch(clamped);
	}

	step(delta: number): void {
		this.pause();
		this.showMean = false;
		this.seek(this.frameIndex + delta);
	}

	play(): void {
		if (this.status !== 'ready' || this.playing) return;
		this.showMean = false;
		if (!this.loop && this.frameIndex >= this.frameCount - 1) this.seek(0);
		this.playing = true;
		this._lastAdvance = performance.now();
		const tick = (now: number) => {
			if (!this.playing) return;
			this._raf = requestAnimationFrame(tick);
			if (now - this._lastAdvance < 1000 / this.fps) return;
			// Hold on the current frame until it has been shown; an unreadable one is passed over.
			if (this.shownIndex !== this.frameIndex && !this.badFrames.has(this.frameIndex)) return;
			const atEnd = this.frameIndex >= this.frameCount - 1;
			if (atEnd && !this.loop) return this.pause();
			this._lastAdvance = now;
			this.seek(atEnd ? 0 : this.frameIndex + 1);
		};
		this._raf = requestAnimationFrame(tick);
	}

	pause(): void {
		this.playing = false;
		cancelAnimationFrame(this._raf);
	}

	togglePlay(): void {
		if (this.playing) this.pause();
		else this.play();
	}

	private _stopWorker(): void {
		this.pause();
		this._worker?.terminate();
		this._worker = null;
		this._cache.clear();
		this._inFlight.clear();
		for (const index of [...this._waiters.keys()]) this._answer(index, null);
	}

	private _reset(): void {
		this._stopWorker();
		this.status = 'idle';
		this.error = null;
		this.indexProgress = 0;
		this.frameCount = 0;
		this.frameIndex = 0;
		this.shownIndex = null;
		this.shownTime = null;
		this.pose = null;
		this.mapping = null;
		this.reference = null;
		this.designSignature = null;
		this.meanStatus = 'none';
		this.meanProgress = 0;
		this.meanError = null;
		this.meanFrameCount = 0;
		this.meanPose = null;
		this.showMean = false;
		this.hoveredRow = null;
		this.badFrames.clear();
		this.skippedFrames = 0;
		this._videoCancelled = true;
		this.videoStatus = 'idle';
		this.videoProgress = 0;
		this.videoMessage = null;
	}

	/** Drops the loaded files and everything derived from them. */
	clear(): void {
		this._reset();
		this.topologyFile = null;
		this.trajectoryFile = null;
	}

	dispose(): void {
		this.clear();
	}
}
