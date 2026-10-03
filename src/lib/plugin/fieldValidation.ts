import type { PluginFieldDef } from './types';

export type CoercedFieldResult =
	{ ok: true; values: Record<string, unknown> } | { ok: false; error: string };

export function stepBase(field: { min?: number }): number {
	return field.min ?? 0;
}

export function isStepAligned(value: number, min: number, step: number): boolean {
	if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(step) || step <= 0) {
		return false;
	}
	const stepsFromMin = (value - min) / step;
	if (!Number.isFinite(stepsFromMin)) return false;
	const n = Math.round(stepsFromMin);
	// Compare in step-count space, not absolute value, so huge and tiny steps both round-trip.
	const tolerance = Number.EPSILON * Math.max(Math.abs(n), 1) * 8;
	return Math.abs(stepsFromMin - n) <= tolerance;
}

// Throws on malformed/duplicate/empty options; callers decide whether to propagate or catch it.
export function normalizeSelectOptions(options: PluginFieldDef['options']): string[] {
	if (!Array.isArray(options) || options.length === 0) {
		throw new Error('"options" must be a non-empty array');
	}
	const values: string[] = [];
	const seen = new Set<string>();
	for (const opt of options) {
		const value = typeof opt === 'string' ? opt : opt?.value;
		const label = typeof opt === 'string' ? opt : opt?.label;
		if (typeof value !== 'string' || value === '') {
			throw new Error('each select option must have a non-empty string value');
		}
		if (typeof label !== 'string' || label === '') {
			throw new Error('each select option must have a non-empty string label');
		}
		if (seen.has(value)) {
			throw new Error(`duplicate select option value "${value}"`);
		}
		seen.add(value);
		values.push(value);
	}
	return values;
}

function coerceBoolean(value: unknown): boolean | null | { error: string } {
	if (value === '' || value === null || value === undefined) return null;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const v = value.trim().toLowerCase();
		if (v === 'false' || v === '0') return false;
		if (v === 'true' || v === '1') return true;
		return { error: `Unrecognized boolean value "${value}"` };
	}
	return { error: `Boolean field cannot accept a value of type ${typeof value}` };
}

export function coercePluginFieldValues(
	fields: PluginFieldDef[],
	values: Record<string, unknown>
): CoercedFieldResult {
	const coerced: Record<string, unknown> = {};

	for (const field of fields) {
		const value = values[field.id];
		const isEmpty = value === '' || value === null || value === undefined;

		if (field.type === 'number') {
			if (isEmpty) {
				if (field.required) {
					return { ok: false, error: `"${field.label}" is required.` };
				}
				coerced[field.id] = null;
				continue;
			}
			if (typeof value !== 'number' && typeof value !== 'string') {
				return { ok: false, error: `"${field.label}" must be a number.` };
			}
			if (typeof value === 'string' && value.trim() === '') {
				return { ok: false, error: `"${field.label}" must be a number.` };
			}
			const num = Number(value);
			if (!Number.isFinite(num)) {
				return { ok: false, error: `"${field.label}" must be a number.` };
			}
			if (field.min !== undefined && num < field.min) {
				return { ok: false, error: `"${field.label}" must be at least ${field.min}.` };
			}
			if (field.max !== undefined && num > field.max) {
				return { ok: false, error: `"${field.label}" must be at most ${field.max}.` };
			}
			if (field.step !== undefined && !isStepAligned(num, stepBase(field), field.step)) {
				const base = stepBase(field);
				return {
					ok: false,
					error:
						base === 0
							? `"${field.label}" must be a multiple of ${field.step}.`
							: `"${field.label}" must start at ${base} and increase in steps of ${field.step}.`,
				};
			}
			coerced[field.id] = num;
			continue;
		}

		if (field.type === 'boolean') {
			if (isEmpty && field.required) {
				return { ok: false, error: `"${field.label}" is required.` };
			}
			const result = coerceBoolean(value);
			if (result !== null && typeof result === 'object') {
				return { ok: false, error: result.error };
			}
			coerced[field.id] = result;
			continue;
		}

		if (field.type === 'select') {
			if (isEmpty) {
				if (field.required) {
					return { ok: false, error: `"${field.label}" is required.` };
				}
				coerced[field.id] = null;
				continue;
			}
			if (typeof value !== 'string') {
				return { ok: false, error: `"${field.label}" must be a string.` };
			}
			let allowed: string[];
			try {
				allowed = normalizeSelectOptions(field.options);
			} catch {
				return { ok: false, error: `"${field.label}" has a malformed options list.` };
			}
			if (!allowed.includes(value)) {
				return { ok: false, error: `"${field.label}" must be one of: ${allowed.join(', ')}.` };
			}
			coerced[field.id] = value;
			continue;
		}

		if (field.type === 'string') {
			if (isEmpty) {
				if (field.required) {
					return { ok: false, error: `"${field.label}" is required.` };
				}
				coerced[field.id] = value === '' ? '' : null;
				continue;
			}
			if (typeof value !== 'string') {
				return { ok: false, error: `"${field.label}" must be a string.` };
			}
			coerced[field.id] = value;
			continue;
		}
	}

	return { ok: true, values: coerced };
}
