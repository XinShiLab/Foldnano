import { SimulationRunner } from '$lib/model/rbs/rbsEngine';
import type {
	BlockBody,
	BlockTransformOverride,
	DistanceConstraint,
	SolverParams,
	SolverResult,
} from '$lib/model/rbs/rbsTypes';

type RbsDiagnostics = Pick<
	SolverResult,
	'maxConstraintError' | 'rmsConstraintError' | 'maxOverlap'
> & {
	blockCount: number;
	constraintCount: number;
};

export interface RbsWorkerRunMessage {
	type: 'run';
	blocks: BlockBody[];
	constraints: DistanceConstraint[];
	params: SolverParams;
	progressInterval?: number;
}

export interface RbsWorkerStopMessage {
	type: 'stop';
}

export type RbsWorkerRequest = RbsWorkerRunMessage | RbsWorkerStopMessage;

interface RbsWorkerStepMessage {
	step: number;
	totalSteps: number;
	transforms: Array<[string, BlockTransformOverride]>;
	stressMap: Array<[string, number]>;
	diagnostics: RbsDiagnostics;
}

export interface RbsWorkerProgressMessage extends RbsWorkerStepMessage {
	type: 'progress';
}

export interface RbsWorkerDoneMessage extends RbsWorkerStepMessage {
	type: 'done';
}

export interface RbsWorkerStoppedMessage {
	type: 'stopped';
	step: number;
	totalSteps: number;
}

export interface RbsWorkerErrorMessage {
	type: 'error';
	message: string;
}

export type RbsWorkerResponse =
	RbsWorkerProgressMessage | RbsWorkerDoneMessage | RbsWorkerStoppedMessage | RbsWorkerErrorMessage;

interface WorkerContext {
	postMessage(message: RbsWorkerResponse): void;
	onmessage: ((event: MessageEvent<RbsWorkerRequest>) => void) | null;
}

const ctx = self as unknown as WorkerContext;
let stopRequested = false;

function diagnosticsFor(
	blocks: BlockBody[],
	constraints: DistanceConstraint[],
	runner: SimulationRunner
): RbsDiagnostics {
	return {
		...runner.getDiagnostics(),
		blockCount: blocks.length,
		constraintCount: constraints.length,
	};
}

function postProgress(
	type: 'progress' | 'done',
	step: number,
	totalSteps: number,
	blocks: BlockBody[],
	constraints: DistanceConstraint[],
	runner: SimulationRunner
): void {
	ctx.postMessage({
		type,
		step,
		totalSteps,
		transforms: [...runner.getResults()],
		stressMap: [...runner.getStressMap()],
		diagnostics: diagnosticsFor(blocks, constraints, runner),
	} satisfies RbsWorkerProgressMessage | RbsWorkerDoneMessage);
}

async function runSimulation({
	blocks,
	constraints,
	params,
	progressInterval = 50,
}: RbsWorkerRunMessage): Promise<void> {
	stopRequested = false;
	const runner = new SimulationRunner(blocks, constraints, params);
	const totalSteps = Math.max(1, Math.round(params.iterations));
	const chunkSize = Math.max(1, Math.round(progressInterval));
	let step = 0;

	while (step < totalSteps) {
		if (stopRequested) {
			ctx.postMessage({ type: 'stopped', step, totalSteps } satisfies RbsWorkerStoppedMessage);
			return;
		}

		const steps = Math.min(chunkSize, totalSteps - step);
		runner.runSteps(steps);
		step += steps;
		postProgress(
			step >= totalSteps ? 'done' : 'progress',
			step,
			totalSteps,
			blocks,
			constraints,
			runner
		);

		// Yield to the worker event loop so a queued stop message can be handled.
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}

ctx.onmessage = (event: MessageEvent<RbsWorkerRequest>) => {
	const message = event.data;
	if (message.type === 'stop') {
		stopRequested = true;
		return;
	}

	void runSimulation(message).catch((error: unknown) => {
		ctx.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error),
		} satisfies RbsWorkerErrorMessage);
	});
};
