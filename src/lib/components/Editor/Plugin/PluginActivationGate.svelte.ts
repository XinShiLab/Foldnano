import { toast } from 'svelte-sonner';
import type { ActivationImpact, PluginCoordinator } from '$lib/plugin/PluginCoordinator.svelte';
import type { PluginRegistry } from '$lib/plugin/PluginRegistry.svelte';

export type PendingActivation = {
	pluginId: string;
	pluginName: string;
	impact: ActivationImpact;
	runningPluginName: string | null;
	pendingApplyPluginName: string | null;
};

/**
 * Per-component controller that gates plugin activation on its environment
 * impact. Destructive custom-slot evictions (running owner / unapplied result)
 * open a confirmation dialog; silent evictions of an idle owner surface as a
 * passive toast. Render <PluginActivationConfirmDialog gate={...} /> next to
 * any component that calls requestActivate().
 */
export class PluginActivationGate {
	pending: PendingActivation | null = $state(null);

	constructor(
		private getCoordinator: () => PluginCoordinator,
		private getRegistry: () => PluginRegistry
	) {}

	/**
	 * Activate a plugin, asking for confirmation first when that would abort
	 * another custom-environment plugin's work. Resolves true when activation
	 * ran; false when it is awaiting the user's answer in the dialog.
	 */
	async requestActivate(pluginId: string): Promise<boolean> {
		const plugin = this.getRegistry().get(pluginId);
		if (!plugin) return false;
		const impact = this.getCoordinator().getActivationImpact(pluginId);
		if (impact.requiresConfirmation) {
			this.pending = {
				pluginId,
				pluginName: plugin.manifest.name,
				impact,
				runningPluginName: this.#pluginName(impact.runningPluginId),
				pendingApplyPluginName: this.#pluginName(impact.pendingApplyPluginId),
			};
			return false;
		}
		await this.#activate(pluginId, plugin.manifest.name, impact);
		return true;
	}

	async confirmPending(): Promise<void> {
		const pending = this.pending;
		if (!pending) return;
		const freshImpact = this.getCoordinator().getActivationImpact(pending.pluginId);
		const impactChanged =
			pending.impact.runningPluginId !== freshImpact.runningPluginId ||
			pending.impact.pendingApplyPluginId !== freshImpact.pendingApplyPluginId ||
			pending.impact.pendingResultToken !== freshImpact.pendingResultToken;
		if (impactChanged) {
			this.pending = {
				...pending,
				impact: freshImpact,
				runningPluginName: this.#pluginName(freshImpact.runningPluginId),
				pendingApplyPluginName: this.#pluginName(freshImpact.pendingApplyPluginId),
			};
			return;
		}
		this.pending = null;
		try {
			await this.#activate(pending.pluginId, pending.pluginName, freshImpact);
		} catch {
			// Activation errors surface via plugin.status / errorMessage in the panel.
		}
	}

	cancelPending(): void {
		this.pending = null;
	}

	async #activate(pluginId: string, pluginName: string, impact: ActivationImpact): Promise<void> {
		const evictedNames = impact.evictedPluginIds.map((id) => this.#pluginName(id) ?? id);
		await this.getCoordinator().activate(pluginId);
		if (evictedNames.length > 0 && !impact.requiresConfirmation) {
			toast.info(
				`${evictedNames.join(', ')} was deactivated to give "${pluginName}" a clean environment.`
			);
		}
	}

	#pluginName(pluginId: string | null): string | null {
		if (!pluginId) return null;
		return this.getRegistry().get(pluginId)?.manifest.name ?? pluginId;
	}
}
