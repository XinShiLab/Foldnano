import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import FoldnanoDocument from '$lib/model/document.svelte';
import { RbsSimulation, type RbsCallbacks } from './rbsSimulation';
import { computeSimulationFreshnessSignature } from '../view3dSimulationState';

function fixturePart() {
	const raw = JSON.parse(
		readFileSync(
			join(process.cwd(), 'test_files/internal_cadnano_designs/test_tetrahedral2.fn.json'),
			'utf8'
		)
	);
	return FoldnanoDocument.fromJSON(raw).parts[0];
}

const ticks = (n: number) =>
	(async () => {
		for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0));
	})();

describe('RbsSimulation.cancel', () => {
	it('drops everything a cancelled run would still report', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const callbacks: RbsCallbacks = {
			onRunning: vi.fn(),
			onProgress: vi.fn(),
			onDiagnostics: vi.fn(),
			onResults: vi.fn(),
		};
		// No Worker in the test environment, so the run is the local, chunked one.
		const sim = new RbsSimulation(callbacks);
		sim.simulate(fixturePart(), {
			iterations: 400,
			dt: 0.01,
			springK: 1,
			repulsionK: 1,
			damping: 0.9,
			collisionPasses: 1,
		});
		await ticks(1);
		sim.cancel();
		expect(callbacks.onRunning).toHaveBeenLastCalledWith(false);
		const results = vi.mocked(callbacks.onResults).mock.calls.length;
		const running = vi.mocked(callbacks.onRunning).mock.calls.length;
		await ticks(20);
		expect(callbacks.onResults).toHaveBeenCalledTimes(results);
		expect(callbacks.onRunning).toHaveBeenCalledTimes(running);
		sim.dispose();
	});
});

describe('RbsSimulation results', () => {
	it('carry the signature of the design as it was when the run started', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const callbacks: RbsCallbacks = {
			onRunning: vi.fn(),
			onProgress: vi.fn(),
			onDiagnostics: vi.fn(),
			onResults: vi.fn(),
		};
		const part = fixturePart();
		const atStart = computeSimulationFreshnessSignature(part);
		const sim = new RbsSimulation(callbacks);
		sim.simulate(part, {
			iterations: 60,
			dt: 0.01,
			springK: 1,
			repulsionK: 1,
			damping: 0.9,
			collisionPasses: 1,
		});
		// An edit while the run is going: its results must read as stale, not fresh.
		// (A raw write stands in for a helix move command; only the signature is under test.)
		const vh = part.virtualHelices[0];
		vh.latticeCoords = { row: vh.latticeCoords!.row + 4, col: vh.latticeCoords!.col };
		expect(computeSimulationFreshnessSignature(part)).not.toBe(atStart);
		await ticks(40);
		const calls = vi.mocked(callbacks.onResults).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		for (const call of calls) expect(call[2]).toBe(atStart);
		sim.dispose();
	});
});
