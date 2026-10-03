import { EditorError } from '$lib/errors';

export const INVARIANT_CATEGORIES = [
	'shape',
	'reciprocity',
	'self-connection',
	'slot-coverage',
	'sequence-slot-mismatch',
	'color-bounds',
	'vh-index-set',
	'missing-vh-mapping',
	'missing-snapshot',
	'missing-region',
	'reconstruction',
	'bounds',
	'reference',
	'missing-doc',
	'missing-apply-target',
	'apply-failed',
] as const;
export type InvariantCategory = (typeof INVARIANT_CATEGORIES)[number];

export type PluginResultPhase = 'result-format-validation' | 'design-verification' | 'final-apply';

export const PHASE_DISPLAY_NAMES: Record<PluginResultPhase, string> = {
	'result-format-validation': 'Result validation',
	'design-verification': 'Design verification',
	'final-apply': 'Apply failed',
};

export abstract class PluginResultError extends EditorError {
	abstract readonly errorLogContext: 'plugin:validation' | 'plugin:apply';
	constructor(
		message: string,
		readonly pluginId: string,
		readonly phase: PluginResultPhase,
		readonly invariantCategory: InvariantCategory
	) {
		super(`${PHASE_DISPLAY_NAMES[phase]}: ${message}`);
	}

	/** Generic, persistable report — never includes design/document content. */
	toSafeReportable(): Error {
		const label = PHASE_DISPLAY_NAMES[this.phase];
		const failure =
			this.phase === 'final-apply' ? label : `${label} failed (${this.invariantCategory})`;
		const safe = new Error(`Plugin "${this.pluginId}": ${failure}.`);
		safe.name = this.name;
		safe.stack = undefined;
		return safe;
	}
}

export class PluginValidationError extends PluginResultError {
	readonly errorLogContext = 'plugin:validation' as const;
	constructor(
		message: string,
		pluginId: string,
		phase: 'result-format-validation' | 'design-verification',
		invariantCategory: InvariantCategory
	) {
		super(message, pluginId, phase, invariantCategory);
		this.name = 'PluginValidationError';
	}
}

// Final Apply failed after passing both checks — a different rejection than validation.
export class PluginApplyError extends PluginResultError {
	readonly errorLogContext = 'plugin:apply' as const;
	constructor(message: string, pluginId: string, invariantCategory: InvariantCategory) {
		super(message, pluginId, 'final-apply', invariantCategory);
		this.name = 'PluginApplyError';
	}
}
