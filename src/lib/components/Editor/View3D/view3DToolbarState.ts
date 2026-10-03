import type { SolverParams, SolverResult } from '$lib/model/rbs/rbsTypes';

export type RbsDiagnostics = Pick<
	SolverResult,
	'maxConstraintError' | 'rmsConstraintError' | 'maxOverlap'
> & {
	blockCount: number;
	constraintCount: number;
};

export interface View3DToolbarStateInput {
	showNtModel: boolean;
	selectionMode: boolean;
	useRelaxedPositions: boolean;
	hasRelaxedPositions: boolean;
	isSimStale?: boolean;
	showStress: boolean;
	simRunning: boolean;
	simDiagnostics?: RbsDiagnostics | null;
	showPlanes: boolean;
	selectedPlaneId?: string | null;
	showRbsParams: boolean;
}

export interface ToolbarStatusChip {
	kind: 'running' | 'stale' | 'plane' | 'diagnostics';
	label: string;
}

export interface View3DToolbarState {
	activeContextRow: 'plane' | null;
	simulateLabel: 'Relax' | 'Re-relax' | 'Stop';
	simulateTitle: string;
	cursorDisabled: boolean;
	lockDisabled: boolean;
	relaxedDisabled: boolean;
	stressDisabled: boolean;
	clearRelaxedDisabled: boolean;
	paramsActive: boolean;
	staleRelaxed: boolean;
	statusChips: ToolbarStatusChip[];
}

export function clampSolverParam(key: keyof SolverParams, value: string): number | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;

	switch (key) {
		case 'iterations':
			return Math.min(Math.max(1, Math.round(parsed)), 100_000);
		case 'collisionPasses':
			return Math.min(Math.max(1, Math.round(parsed)), 20);
		case 'springK':
			return Math.min(Math.max(0, parsed), 1_000);
		case 'repulsionK':
			return Math.min(Math.max(0, parsed), 10_000);
		case 'damping':
			return Math.min(Math.max(0, parsed), 1);
		default:
			return Math.max(0, parsed);
	}
}

export function getView3DToolbarState(input: View3DToolbarStateInput): View3DToolbarState {
	const activeContextRow = input.showPlanes && input.selectedPlaneId ? 'plane' : null;

	const simulateLabel = input.simRunning ? 'Stop' : input.isSimStale ? 'Re-relax' : 'Relax';

	const simulateTitle = input.simRunning
		? 'Stop rigid-body simulation'
		: input.isSimStale
			? 'Topology changed — re-run rigid-body simulation'
			: 'Run rigid-body simulation to relax the design';

	const staleRelaxed = Boolean(input.isSimStale && input.useRelaxedPositions);

	const statusChips: ToolbarStatusChip[] = [];
	if (input.simRunning) {
		statusChips.push({ kind: 'running', label: 'RBS running' });
	}
	if (staleRelaxed) {
		statusChips.push({ kind: 'stale', label: 'Relaxed layout stale' });
	}
	if (input.showPlanes && input.selectedPlaneId) {
		statusChips.push({ kind: 'plane', label: 'Plane selected' });
	}
	if (input.simDiagnostics) {
		statusChips.push({
			kind: 'diagnostics',
			label: `${input.simDiagnostics.blockCount} blocks · RMS ${input.simDiagnostics.rmsConstraintError.toFixed(3)} nm`,
		});
	}

	return {
		activeContextRow,
		simulateLabel,
		simulateTitle,
		cursorDisabled: input.showNtModel,
		lockDisabled: !input.selectionMode,
		relaxedDisabled: !input.hasRelaxedPositions,
		stressDisabled: !input.hasRelaxedPositions || !input.useRelaxedPositions,
		clearRelaxedDisabled: !input.hasRelaxedPositions || input.simRunning,
		paramsActive: input.showRbsParams,
		staleRelaxed,
		statusChips,
	};
}
