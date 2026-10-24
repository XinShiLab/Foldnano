import type { DesignIssue } from '$lib/model/checks/designIssue';

export interface DesignCheckRequest {
	readonly title: string;
	readonly description: string;
	/** Label of the button that goes ahead despite warnings; errors never offer it. */
	readonly proceedLabel: string;
	readonly issues: readonly DesignIssue[];
}

interface PendingDesignCheck extends DesignCheckRequest {
	readonly resolve: (proceed: boolean) => void;
}

/** One design-check question at a time, answered by the `DesignCheckDialog` mounted in the editor. */
class DesignCheckPrompt {
	pending = $state<PendingDesignCheck | null>(null);

	ask(request: DesignCheckRequest): Promise<boolean> {
		this.pending?.resolve(false);
		return new Promise((resolve) => {
			this.pending = { ...request, resolve };
		});
	}

	answer(proceed: boolean): void {
		const pending = this.pending;
		this.pending = null;
		pending?.resolve(proceed && !pending.issues.some((issue) => issue.severity === 'error'));
	}
}

export const designCheckPrompt = new DesignCheckPrompt();

/** True when `issues` deserve the dialog: anything worse than `info`. */
export function needsDesignCheck(issues: readonly DesignIssue[]): boolean {
	return issues.some((issue) => issue.severity !== 'info');
}
