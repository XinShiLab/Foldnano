import { describe, expect, it, vi } from 'vitest';

import { PluginActivationGate } from './PluginActivationGate.svelte';
import type { ActivationImpact, PluginCoordinator } from '$lib/plugin/PluginCoordinator.svelte';
import type { PluginRegistry } from '$lib/plugin/PluginRegistry.svelte';
import type { PythonPlugin } from '$lib/plugin/types';

function makeImpact(overrides: Partial<ActivationImpact> = {}): ActivationImpact {
	return {
		runningPluginId: null,
		pendingApplyPluginId: 'owner',
		pendingResultToken: 't1',
		evictedPluginIds: ['owner'],
		requiresConfirmation: true,
		...overrides,
	};
}

function makeRegistry(names: Record<string, string>): PluginRegistry {
	return {
		get: (id: string) =>
			names[id] ? ({ manifest: { id, name: names[id] } } as PythonPlugin) : undefined,
	} as unknown as PluginRegistry;
}

function makeGate(
	getActivationImpact: ReturnType<typeof vi.fn>,
	activate: ReturnType<typeof vi.fn>
) {
	const coordinator = { getActivationImpact, activate } as unknown as PluginCoordinator;
	const registry = makeRegistry({ target: 'Target', owner: 'Owner' });
	return new PluginActivationGate(
		() => coordinator,
		() => registry
	);
}

describe('PluginActivationGate', () => {
	it('re-prompts with the fresh impact instead of activating when the impact changed since the dialog opened', async () => {
		const getActivationImpact = vi
			.fn()
			.mockReturnValueOnce(makeImpact({ pendingResultToken: 't1' }))
			.mockReturnValueOnce(makeImpact({ pendingResultToken: 't2' }));
		const activate = vi.fn().mockResolvedValue(undefined);
		const gate = makeGate(getActivationImpact, activate);

		const activated = await gate.requestActivate('target');
		expect(activated).toBe(false);

		await gate.confirmPending();

		expect(activate).not.toHaveBeenCalled();
		expect(gate.pending?.impact.pendingResultToken).toBe('t2');
	});

	it('activates once confirmed against an impact that matches the freshly queried one', async () => {
		const getActivationImpact = vi.fn().mockReturnValue(makeImpact());
		const activate = vi.fn().mockResolvedValue(undefined);
		const gate = makeGate(getActivationImpact, activate);

		await gate.requestActivate('target');
		await gate.confirmPending();

		expect(activate).toHaveBeenCalledWith('target');
		expect(gate.pending).toBeNull();
	});

	it('keeps re-prompting across multiple changes, not just once, then activates once it matches', async () => {
		const getActivationImpact = vi
			.fn()
			.mockReturnValueOnce(makeImpact({ pendingResultToken: 't1' }))
			.mockReturnValueOnce(makeImpact({ pendingResultToken: 't2' }))
			.mockReturnValueOnce(makeImpact({ pendingResultToken: 't3' }))
			.mockReturnValueOnce(makeImpact({ pendingResultToken: 't3' }));
		const activate = vi.fn().mockResolvedValue(undefined);
		const gate = makeGate(getActivationImpact, activate);

		await gate.requestActivate('target');
		await gate.confirmPending();
		expect(activate).not.toHaveBeenCalled();
		await gate.confirmPending();
		expect(activate).not.toHaveBeenCalled();
		await gate.confirmPending();

		expect(activate).toHaveBeenCalledTimes(1);
		expect(gate.pending).toBeNull();
	});

	it('re-prompts when the running owner finishes with a pending result, then activates once confirmed against that unchanged impact', async () => {
		const runningImpact = makeImpact({
			runningPluginId: 'owner',
			pendingApplyPluginId: null,
			pendingResultToken: null,
		});
		const finishedImpact = makeImpact({
			runningPluginId: null,
			pendingApplyPluginId: 'owner',
			pendingResultToken: 'owner-result',
		});
		const getActivationImpact = vi
			.fn()
			.mockReturnValueOnce(runningImpact)
			.mockReturnValueOnce(finishedImpact)
			.mockReturnValueOnce(finishedImpact);
		const activate = vi.fn().mockResolvedValue(undefined);
		const gate = makeGate(getActivationImpact, activate);

		await gate.requestActivate('target');
		expect(gate.pending?.impact.runningPluginId).toBe('owner');
		expect(gate.pending?.runningPluginName).toBe('Owner');
		expect(gate.pending?.pendingApplyPluginName).toBeNull();

		await gate.confirmPending();
		expect(activate).not.toHaveBeenCalled();
		expect(gate.pending?.impact.pendingApplyPluginId).toBe('owner');
		expect(gate.pending?.runningPluginName).toBeNull();
		expect(gate.pending?.pendingApplyPluginName).toBe('Owner');

		await gate.confirmPending();
		expect(activate).toHaveBeenCalledTimes(1);
		expect(activate).toHaveBeenCalledWith('target');
		expect(gate.pending).toBeNull();
	});
});
