import { describe, expect, it } from 'vitest';
import { getView3DToolbarState } from './view3DToolbarState';

function makeState(overrides: Partial<Parameters<typeof getView3DToolbarState>[0]> = {}) {
	return getView3DToolbarState({
		showNtModel: false,
		selectionMode: false,
		useRelaxedPositions: false,
		hasRelaxedPositions: false,
		isSimStale: false,
		showStress: false,
		simRunning: false,
		simDiagnostics: null,
		showPlanes: false,
		selectedPlaneId: null,
		showRbsParams: false,
		...overrides,
	});
}

describe('View3D toolbar state', () => {
	it('shows Re-relax when topology changed and RBS is idle', () => {
		expect(makeState({ isSimStale: true }).simulateLabel).toBe('Re-relax');
	});

	it('disables cursor when the NT model is shown', () => {
		expect(makeState({ showNtModel: true }).cursorDisabled).toBe(true);
	});

	it('disables relaxed, stress, and clear actions without relaxed positions', () => {
		const state = makeState({ hasRelaxedPositions: false, useRelaxedPositions: false });

		expect(state.relaxedDisabled).toBe(true);
		expect(state.stressDisabled).toBe(true);
		expect(state.clearRelaxedDisabled).toBe(true);
	});

	it('keeps plane controls as the only contextual row', () => {
		const planeState = makeState({
			showPlanes: true,
			selectedPlaneId: 'plane-1',
			showRbsParams: true,
		});
		const rbsState = makeState({ showRbsParams: true });

		expect(planeState.activeContextRow).toBe('plane');
		expect(planeState.paramsActive).toBe(true);
		expect(rbsState.activeContextRow).toBe(null);
		expect(rbsState.paramsActive).toBe(true);
	});

	it('reports running, stale, plane, and diagnostics status chips', () => {
		const state = makeState({
			simRunning: true,
			isSimStale: true,
			useRelaxedPositions: true,
			showPlanes: true,
			selectedPlaneId: 'plane-1',
			simDiagnostics: {
				blockCount: 6,
				constraintCount: 12,
				maxConstraintError: 0.5,
				rmsConstraintError: 0.1234,
				maxOverlap: 0.01,
			},
		});

		expect(state.statusChips.map((chip) => chip.kind)).toEqual([
			'running',
			'stale',
			'plane',
			'diagnostics',
		]);
		expect(state.statusChips[3]?.label).toContain('RMS 0.123 nm');
	});
});
