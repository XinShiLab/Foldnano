import { buildBlocksAndConstraints, buildSegmentBlockOverrides } from '$lib/model/rbs/buildBlocks';
import { DEFAULT_SOLVER_PARAMS, SimulationRunner } from '$lib/model/rbs/rbsEngine';
import type {
	BlockBody,
	BlockTransformOverride,
	DistanceConstraint,
	SolverParams,
	SolverResult,
} from '$lib/model/rbs/rbsTypes';
import type { Part } from '$lib/model/Part';
import { computeSimulationFreshnessSignature } from '../view3dSimulationState';
import type { RbsWorkerRequest, RbsWorkerResponse } from './rbsWorker';

export type RbsDiagnostics = Pick<
	SolverResult,
	'maxConstraintError' | 'rmsConstraintError' | 'maxOverlap'
> & {
	blockCount: number;
	constraintCount: number;
};

export interface RbsCallbacks {
	onRunning(v: boolean): void;
	onProgress(step: number, total: number): void;
	onDiagnostics(d: RbsDiagnostics | null): void;
	/** Called when simulation produces results (progress or final). */
	onResults(
		overrides: Map<string, BlockTransformOverride>,
		stressMap: Map<string, number>,
		sig: string
	): void;
}

export class RbsSimulation {
	private running = false;
	private segmentToBlockId = new Map<string, string>();
	private blocks: BlockBody[] = [];
	private constraints: DistanceConstraint[] = [];
	private worker: Worker | null = null;
	private workerTimer: ReturnType<typeof setTimeout> | null = null;
	private localStop = false;
	private currentPart: Part | null = null;
	private currentSolverParams: SolverParams = DEFAULT_SOLVER_PARAMS;

	constructor(private cb: RbsCallbacks) {
		this.worker = this.createWorker();
	}

	/** Toggle: if running → stop; if stopped → start simulation. */
	simulate(part: Part, solverParams: SolverParams = DEFAULT_SOLVER_PARAMS): void {
		if (this.running) {
			this.localStop = true;
			this.worker?.postMessage({ type: 'stop' } satisfies RbsWorkerRequest);
			return;
		}

		this.currentPart = part;
		this.currentSolverParams = solverParams;
		this.running = true;
		this.localStop = false;
		this.cb.onRunning(true);
		this.cb.onProgress(0, Math.max(1, solverParams.iterations));
		this.cb.onDiagnostics(null);

		const { blocks, constraints, segmentToBlockId } = buildBlocksAndConstraints(part);
		this.segmentToBlockId = segmentToBlockId;
		this.blocks = this.cloneBlocks(blocks);
		this.constraints = this.cloneConstraints(constraints);
		console.log(`[RBS] blocks: ${blocks.length}, constraints: ${constraints.length}`);

		if (!this.worker) this.worker = this.createWorker();
		if (!this.worker) {
			void this.runLocal(solverParams);
			return;
		}

		this.workerTimer = setTimeout(() => {
			if (this.running) {
				console.warn('[RBS worker] no progress response; falling back to local chunked simulation');
				void this.runLocal(solverParams);
			}
		}, 1500);

		try {
			this.worker.postMessage({
				type: 'run',
				blocks: this.blocks,
				constraints: this.constraints,
				params: this.cloneSolverParams(solverParams),
				progressInterval: 50,
			} satisfies RbsWorkerRequest);
		} catch (error) {
			this.clearTimer();
			console.error('[RBS worker] failed to post simulation input', error);
			void this.runLocal(solverParams);
		}
	}

	/** Stop any in-progress simulation without clearing results. */
	requestStop(): void {
		this.clearTimer();
		this.localStop = true;
		this.worker?.postMessage({ type: 'stop' } satisfies RbsWorkerRequest);
	}

	dispose(): void {
		this.clearTimer();
		this.localStop = true;
		this.worker?.terminate();
		this.worker = null;
	}

	private createWorker(): Worker | null {
		try {
			const w = new Worker(new URL('./rbsWorker.ts', import.meta.url), { type: 'module' });
			w.onmessage = (event: MessageEvent<RbsWorkerResponse>) => {
				this.handleWorkerMessage(event.data);
			};
			w.onerror = (event) => {
				this.clearTimer();
				console.error('[RBS worker] startup/runtime error', event.message);
				// Worker failed — the caller's simulate() already stored blocks; run locally
				if (this.running) void this.runLocal(this.currentSolverParams);
			};
			w.onmessageerror = () => {
				this.clearTimer();
				console.error('[RBS worker] message could not be cloned');
				if (this.running) void this.runLocal(this.currentSolverParams);
			};
			return w;
		} catch (error) {
			console.error('[RBS worker] failed to create worker', error);
			return null;
		}
	}

	private handleWorkerMessage(message: RbsWorkerResponse): void {
		this.clearTimer();
		if (message.type === 'error') {
			console.error('[RBS worker]', message.message);
			void this.runLocal(this.currentSolverParams);
			return;
		}

		if (message.type === 'stopped') {
			this.cb.onProgress(message.step, message.totalSteps);
			this.running = false;
			this.cb.onRunning(false);
			return;
		}

		this.cb.onProgress(message.step, message.totalSteps);
		this.cb.onDiagnostics(message.diagnostics);
		this.applyResults(message.transforms, message.stressMap);
		if (message.type === 'done') {
			this.running = false;
			this.cb.onRunning(false);
		}
	}

	private applyResults(
		transforms: Array<[string, BlockTransformOverride]>,
		rawStressMap: Array<[string, number]>
	): void {
		const blockTransforms = new Map<string, BlockTransformOverride>(transforms);
		const overrides = buildSegmentBlockOverrides(this.segmentToBlockId, blockTransforms);
		const sig = this.currentPart ? computeSimulationFreshnessSignature(this.currentPart) : '';
		this.cb.onResults(overrides, new Map(rawStressMap), sig);
	}

	private async runLocal(solverParams: SolverParams): Promise<void> {
		if (this.blocks.length === 0) {
			this.running = false;
			this.cb.onRunning(false);
			return;
		}

		// Recreate worker so it's ready for the next explicit run
		this.worker?.terminate();
		this.worker = this.createWorker();

		this.localStop = false;
		const runner = new SimulationRunner(this.blocks, this.constraints, solverParams);
		const totalSteps = Math.max(1, Math.round(solverParams.iterations));
		const chunkSize = 50;
		let step = 0;

		while (step < totalSteps && !this.localStop) {
			const steps = Math.min(chunkSize, totalSteps - step);
			runner.runSteps(steps);
			step += steps;
			const diagnostics = runner.getDiagnostics();
			this.cb.onProgress(step, totalSteps);
			this.cb.onDiagnostics({
				...diagnostics,
				blockCount: this.blocks.length,
				constraintCount: this.constraints.length,
			});
			this.applyResults([...runner.getResults().entries()], [...runner.getStressMap().entries()]);
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}

		this.running = false;
		this.cb.onRunning(false);
	}

	private clearTimer(): void {
		if (!this.workerTimer) return;
		clearTimeout(this.workerTimer);
		this.workerTimer = null;
	}

	private cloneBlocks(blocks: BlockBody[]): BlockBody[] {
		return blocks.map((b) => ({
			blockId: b.blockId,
			spans: b.spans.map((s) => ({
				spanId: s.spanId,
				vhIndex: s.vhIndex,
				rowIdx: s.rowIdx,
				strandIdx: s.strandIdx,
				lo: s.lo,
				hi: s.hi,
				segmentIds: [...s.segmentIds],
			})),
			collisionCapsules: b.collisionCapsules.map((c) => ({
				id: c.id,
				vhIndex: c.vhIndex,
				lo: c.lo,
				hi: c.hi,
				localStart: { ...c.localStart },
				localEnd: { ...c.localEnd },
				radius: c.radius,
			})),
			originalCenter: { ...b.originalCenter },
			position: { ...b.position },
			quaternion: { ...b.quaternion },
			mass: b.mass,
			inertia: { ...b.inertia },
			radius: b.radius,
		}));
	}

	private cloneConstraints(constraints: DistanceConstraint[]): DistanceConstraint[] {
		return constraints.map((c) => ({
			id: c.id,
			blockIdA: c.blockIdA,
			blockIdB: c.blockIdB,
			localAttachA: { ...c.localAttachA },
			localAttachB: { ...c.localAttachB },
			restLength: c.restLength,
			source: c.source,
		}));
	}

	private cloneSolverParams(p: SolverParams): SolverParams {
		return {
			iterations: p.iterations,
			dt: p.dt,
			springK: p.springK,
			repulsionK: p.repulsionK,
			damping: p.damping,
			collisionPasses: p.collisionPasses,
		};
	}
}
