// Mediabunny is loaded on first export, keeping it out of the editor's bundle.
import type { VideoCodec } from 'mediabunny';

import type { PosedFrame } from '$lib/model/oxdnaReplay/framePose';

/** Draws posed frames of the replay, as the 3D view shows them, into its own canvas. */
export interface ReplayFrameRenderer {
	readonly canvas: HTMLCanvasElement;
	readonly width: number;
	readonly height: number;
	draw(pose: PosedFrame): void;
	dispose(): void;
}

export interface VideoSize {
	width: number;
	height: number;
}

export const VIDEO_SIZES: readonly { id: string; label: string; size: VideoSize | null }[] = [
	{ id: 'view', label: 'Same as the 3D view', size: null },
	{ id: '720p', label: '1280 × 720', size: { width: 1280, height: 720 } },
	{ id: '1080p', label: '1920 × 1080', size: { width: 1920, height: 1080 } },
	{ id: '2160p', label: '3840 × 2160', size: { width: 3840, height: 2160 } },
];

export const VIDEO_FPS = [10, 24, 30, 60] as const;

// MP4 can hold all of these; H.264 first, as it plays everywhere (slides, phones).
const MP4_CODECS: VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1'];

/** H.264 and most encoders need even dimensions. */
export function evenSize(width: number, height: number): VideoSize {
	return {
		width: Math.max(2, Math.floor(width / 2) * 2),
		height: Math.max(2, Math.floor(height / 2) * 2),
	};
}

/**
 * Vertical field of view that keeps everything the view shows in a frame of another aspect: a
 * narrower frame widens the vertical angle instead of cropping the sides.
 */
export function fitVerticalFovDeg(fovDeg: number, viewAspect: number, aspect: number): number {
	if (aspect >= viewAspect) return fovDeg;
	const half = (fovDeg * Math.PI) / 360;
	return (Math.atan(Math.tan(half) * (viewAspect / aspect)) * 360) / Math.PI;
}

/** Frame indices `from`…`to` (0-based, inclusive) every `stride`, without known-bad frames. */
export function videoFrameIndices(
	from: number,
	to: number,
	stride: number,
	isBad: (index: number) => boolean = () => false
): number[] {
	const step = Math.max(1, Math.floor(stride));
	const indices: number[] = [];
	for (let i = Math.max(0, from); i <= to; i += step) if (!isBad(i)) indices.push(i);
	return indices;
}

/** The first MP4 codec this browser can encode at this size, or null. */
export function findVideoCodec(size: VideoSize, fps: number): Promise<VideoCodec | null> {
	if (typeof VideoEncoder === 'undefined') return Promise.resolve(null);
	return import('mediabunny').then((mb) =>
		mb.getFirstEncodableVideoCodec(MP4_CODECS, { ...size, frameRate: fps })
	);
}

export interface ReplayVideoFrame {
	pose: PosedFrame;
	step: number;
}

export interface EncodeReplayVideoOptions {
	codec: VideoCodec;
	fps: number;
	indices: readonly number[];
	renderer: ReplayFrameRenderer;
	/** Resolves null for a frame that cannot be read; it is left out. */
	loadFrame(index: number): Promise<ReplayVideoFrame | null>;
	/** Text drawn in the bottom-left corner of each frame, or null for none. */
	caption: ((frame: ReplayVideoFrame) => string) | null;
	isCancelled(): boolean;
	onProgress(fraction: number): void;
}

export interface EncodedReplayVideo {
	blob: Blob;
	written: number;
	skipped: number;
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, width: number, height: number) {
	const size = Math.max(12, Math.round(height / 36));
	const pad = Math.round(size * 0.6);
	ctx.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
	ctx.textBaseline = 'middle';
	const boxWidth = ctx.measureText(text).width + pad * 2;
	const boxHeight = size + pad * 2;
	const x = pad;
	const y = height - boxHeight - pad;
	ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
	ctx.beginPath();
	ctx.roundRect(x, y, Math.min(boxWidth, width - 2 * pad), boxHeight, pad / 2);
	ctx.fill();
	ctx.fillStyle = '#fff';
	ctx.fillText(text, x + pad, y + boxHeight / 2);
}

/**
 * Renders each listed frame offscreen and encodes it into an MP4 at a constant frame rate, so no
 * frame is dropped however long a frame takes to read. Resolves null when cancelled.
 */
export async function encodeReplayVideo(
	options: EncodeReplayVideoOptions
): Promise<EncodedReplayVideo | null> {
	const { renderer, fps, indices } = options;
	const { width, height } = renderer;
	const frameCanvas = document.createElement('canvas');
	frameCanvas.width = width;
	frameCanvas.height = height;
	const ctx = frameCanvas.getContext('2d');
	if (!ctx) throw new Error('The browser could not create a canvas to draw the video frames.');

	const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } =
		await import('mediabunny');
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
	const source = new CanvasSource(frameCanvas, {
		codec: options.codec,
		quality: QUALITY_HIGH,
		keyFrameInterval: 2,
	});
	output.addVideoTrack(source, { frameRate: fps });

	let written = 0;
	let skipped = 0;
	try {
		await output.start();
		for (let k = 0; k < indices.length; k++) {
			if (options.isCancelled()) {
				await output.cancel();
				return null;
			}
			const frame = await options.loadFrame(indices[k]);
			if (!frame) {
				skipped++;
				continue;
			}
			renderer.draw(frame.pose);
			ctx.drawImage(renderer.canvas, 0, 0, width, height);
			if (options.caption) drawCaption(ctx, options.caption(frame), width, height);
			await source.add(written / fps, 1 / fps);
			written++;
			options.onProgress((k + 1) / indices.length);
		}
		if (written === 0) throw new Error('None of the chosen frames could be read.');
		await output.finalize();
	} catch (error) {
		if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
		throw error;
	}
	return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), written, skipped };
}
