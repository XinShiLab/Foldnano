import { poseFrame, type ReplayReference } from '$lib/model/oxdnaReplay/framePose';
import { MeanStructureAccumulator } from '$lib/model/oxdnaReplay/meanStructure';
import {
	OxDnaTrajectoryParseError,
	parseOxDnaFrame,
	scanFrameStarts,
} from '$lib/model/oxdnaReplay/oxdnaTrajectory';

export type ReplayWorkerRequest =
	| { type: 'open'; file: File; nucleotideCount: number }
	| { type: 'frame'; index: number }
	| { type: 'mean'; reference: ReplayReference }
	| { type: 'cancelMean' };

export type ReplayWorkerResponse =
	| { type: 'progress'; fraction: number }
	| { type: 'indexed'; frameCount: number }
	| {
			type: 'frame';
			index: number;
			time: number;
			box: [number, number, number];
			data: Float32Array;
	  }
	| { type: 'meanProgress'; fraction: number }
	| {
			type: 'mean';
			backboneNm: Float32Array;
			baseNm: Float32Array;
			frameCount: number;
			skippedFrames: number[];
	  }
	| { type: 'frameError'; index: number; message: string }
	| { type: 'meanCancelled' }
	| { type: 'meanError'; message: string }
	| { type: 'error'; message: string; index?: number };

interface WorkerContext {
	postMessage(message: ReplayWorkerResponse, transfer?: Transferable[]): void;
	onmessage: ((event: MessageEvent<ReplayWorkerRequest>) => void) | null;
}

const ctx = self as unknown as WorkerContext;
const CHUNK_BYTES = 8 * 1024 * 1024;

let file: File | null = null;
let nucleotideCount = 0;
// Frame i spans [starts[i], starts[i + 1]); the last entry is the file size.
let starts: number[] = [];
let indexing: Promise<void> | null = null;
let meanRun = 0;

async function buildIndex(target: File): Promise<void> {
	const found: number[] = [];
	for (let offset = 0; offset < target.size; offset += CHUNK_BYTES) {
		const chunk = new Uint8Array(await target.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
		for (const start of scanFrameStarts(chunk, offset)) found.push(start);
		ctx.postMessage({
			type: 'progress',
			fraction: Math.min(1, (offset + chunk.length) / target.size),
		});
	}
	if (found.length === 0) throw new Error('No frames found: this is not an oxDNA trajectory.');
	found.push(target.size);
	starts = found;
	ctx.postMessage({ type: 'indexed', frameCount: found.length - 1 });
}

async function readFrame(index: number) {
	const text = await file!.slice(starts[index], starts[index + 1]).text();
	return parseOxDnaFrame(text, nucleotideCount);
}

async function sendFrame(index: number): Promise<void> {
	await indexing;
	if (!file || index < 0 || index >= starts.length - 1) return;
	const frame = await readFrame(index);
	ctx.postMessage({ type: 'frame', index, ...frame }, [frame.data.buffer]);
}

// Interleaves with frame requests at each await, so playback keeps working meanwhile.
async function computeMean(reference: ReplayReference, run: number): Promise<void> {
	await indexing;
	if (!file) return;
	const frameCount = starts.length - 1;
	const mean = new MeanStructureAccumulator(reference.nucleotideCount);
	// A cut-off frame (interrupted run) is left out rather than failing the whole pass.
	const skippedFrames: number[] = [];
	for (let index = 0; index < frameCount; index++) {
		if (run !== meanRun) return ctx.postMessage({ type: 'meanCancelled' });
		let frame;
		try {
			frame = await readFrame(index);
		} catch (error) {
			if (!(error instanceof OxDnaTrajectoryParseError)) throw error;
			skippedFrames.push(index);
			continue;
		}
		mean.add(poseFrame(frame, reference, { alignToDesign: true }));
		if (index % 10 === 9)
			ctx.postMessage({ type: 'meanProgress', fraction: (index + 1) / frameCount });
	}
	if (mean.count === 0) throw new Error('No frame of the trajectory could be read.');
	const { backboneNm, baseNm } = mean.result();
	ctx.postMessage({ type: 'mean', backboneNm, baseNm, frameCount: mean.count, skippedFrames }, [
		backboneNm.buffer,
		baseNm.buffer,
	]);
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

ctx.onmessage = (event: MessageEvent<ReplayWorkerRequest>) => {
	const message = event.data;
	if (message.type === 'open') {
		file = message.file;
		nucleotideCount = message.nucleotideCount;
		starts = [];
		indexing = buildIndex(message.file).catch((error: unknown) => {
			file = null;
			ctx.postMessage({ type: 'error', message: errorMessage(error) });
		});
		return;
	}
	if (message.type === 'cancelMean') {
		meanRun++;
		return;
	}
	if (message.type === 'mean') {
		const run = ++meanRun;
		void computeMean(message.reference, run).catch((error: unknown) => {
			ctx.postMessage({ type: 'meanError', message: errorMessage(error) });
		});
		return;
	}
	void sendFrame(message.index).catch((error: unknown) => {
		ctx.postMessage(
			error instanceof OxDnaTrajectoryParseError
				? { type: 'frameError', index: message.index, message: error.message }
				: { type: 'error', message: errorMessage(error), index: message.index }
		);
	});
};
