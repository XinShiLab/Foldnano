import type { LinkedPluginReview } from '$lib/plugin/PluginDevMode.svelte';

/**
 * Parks a dev-mode review (`PluginDevMode.setReviewer`) until the user answers it in
 * <LinkedPluginReviewDialog>, mounted once in Editor.svelte so runs from any panel can ask.
 */
export class LinkedPluginReviewGate {
	pending: LinkedPluginReview | null = $state.raw(null);

	#resolve: ((accepted: boolean) => void) | null = null;

	request(review: LinkedPluginReview): Promise<boolean> {
		// A newer question supersedes an unanswered one.
		this.#settle(false);
		return new Promise<boolean>((resolve) => {
			this.#resolve = resolve;
			this.pending = review;
		});
	}

	accept(): void {
		this.#settle(true);
	}

	decline(): void {
		this.#settle(false);
	}

	#settle(accepted: boolean): void {
		const resolve = this.#resolve;
		this.#resolve = null;
		this.pending = null;
		resolve?.(accepted);
	}
}
