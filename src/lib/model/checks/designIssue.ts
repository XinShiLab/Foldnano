import type { IntegrityRule } from './integrity';
import type { SimulationRule } from './simulation';
import type { CadnanoRule } from './cadnano';

export type DesignIssueSeverity = 'error' | 'warning' | 'info';

/** Rules of the shape layer (raw JSON, before a Part exists). Plugin errors reuse them as categories. */
export const SHAPE_RULES = [
	'shape',
	'reciprocity',
	'self-connection',
	'slot-coverage',
	'sequence-slot-mismatch',
	'color-bounds',
	'bounds',
	'reference',
	'mirrored-plane',
] as const;
export type ShapeRule = (typeof SHAPE_RULES)[number];

export type DesignRule = ShapeRule | IntegrityRule | SimulationRule | CadnanoRule;

/** Where an issue sits. Raw-JSON checks only know `vhIndex`; model checks also fill the ids. */
export interface DesignIssueAnchor {
	readonly regionId?: string;
	readonly vhId?: string;
	readonly vhIndex?: number;
	readonly strandIndex?: 0 | 1;
	readonly bp?: number;
	readonly segmentId?: string;
	readonly oligoId?: string;
}

export interface DesignIssue<R extends DesignRule = DesignRule> {
	readonly rule: R;
	readonly severity: DesignIssueSeverity;
	readonly message: string;
	readonly anchor?: DesignIssueAnchor;
}

/** Thrown by the shape layer on its first error: later shape checks assume the earlier ones held. */
export class DesignCheckError extends Error {
	constructor(readonly issue: DesignIssue<ShapeRule>) {
		super(issue.message);
		this.name = 'DesignCheckError';
	}
}

export function failShape(message: string, rule: ShapeRule = 'shape'): never {
	throw new DesignCheckError({ rule, severity: 'error', message });
}
