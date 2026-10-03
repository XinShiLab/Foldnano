import { describe, expect, it } from 'vitest';

import { coercePluginFieldValues, isStepAligned, stepBase } from './fieldValidation';
import type { PluginFieldDef } from './types';

describe('stepBase', () => {
	it('defaults to 0 when min is absent', () => {
		expect(stepBase({})).toBe(0);
	});

	it('uses min when present', () => {
		expect(stepBase({ min: -10.5 })).toBe(-10.5);
	});
});

describe('isStepAligned', () => {
	it('accepts a value exactly on a step boundary', () => {
		expect(isStepAligned(4, 0, 2)).toBe(true);
	});

	it('rejects a value off a step boundary', () => {
		expect(isStepAligned(3, 0, 2)).toBe(false);
	});

	it('accounts for a non-zero min as the step base', () => {
		expect(isStepAligned(1.5, -0.5, 0.5)).toBe(true);
		expect(isStepAligned(1.6, -0.5, 0.5)).toBe(false);
	});

	it('handles a very large step', () => {
		expect(isStepAligned(3e12, 0, 1e12)).toBe(true);
		expect(isStepAligned(3e12 + 1, 0, 1e12)).toBe(false);
	});

	it('handles a very small step', () => {
		expect(isStepAligned(3e-9, 0, 1e-9)).toBe(true);
	});

	it('rejects a large value that is only misaligned by more than floating-point tolerance', () => {
		expect(isStepAligned(1e12 + 0.5, 0, 1)).toBe(false);
	});

	it('rejects zero or negative step', () => {
		expect(isStepAligned(4, 0, 0)).toBe(false);
		expect(isStepAligned(4, 0, -2)).toBe(false);
	});

	it('rejects NaN and infinite inputs', () => {
		expect(isStepAligned(NaN, 0, 1)).toBe(false);
		expect(isStepAligned(4, NaN, 1)).toBe(false);
		expect(isStepAligned(4, 0, Infinity)).toBe(false);
		expect(isStepAligned(Infinity, 0, 1)).toBe(false);
	});

	it('rejects a tiny value that is exactly half a tiny step', () => {
		expect(isStepAligned(5e-16, 0, 1e-15)).toBe(false);
	});
});

describe('coercePluginFieldValues', () => {
	function numberField(overrides: Partial<PluginFieldDef> = {}): PluginFieldDef {
		return { id: 'n', label: 'N', type: 'number', ...overrides };
	}

	function booleanField(overrides: Partial<PluginFieldDef> = {}): PluginFieldDef {
		return { id: 'b', label: 'B', type: 'boolean', ...overrides };
	}

	function selectField(overrides: Partial<PluginFieldDef> = {}): PluginFieldDef {
		return { id: 'sel', label: 'Sel', type: 'select', options: ['a', 'b'], ...overrides };
	}

	function stringField(overrides: Partial<PluginFieldDef> = {}): PluginFieldDef {
		return { id: 's', label: 'S', type: 'string', ...overrides };
	}

	describe('number', () => {
		it('coerces a string submission to a number', () => {
			const result = coercePluginFieldValues([numberField()], { n: '5' });
			expect(result).toEqual({ ok: true, values: { n: 5 } });
		});

		it('accepts negative and fractional values within a fractional range', () => {
			const field = numberField({ min: -10.5, max: 20.75, step: 0.25 });
			expect(coercePluginFieldValues([field], { n: -10.25 })).toEqual({
				ok: true,
				values: { n: -10.25 },
			});
		});

		it('is inclusive at min and max', () => {
			const field = numberField({ min: 0, max: 10 });
			expect(coercePluginFieldValues([field], { n: 0 }).ok).toBe(true);
			expect(coercePluginFieldValues([field], { n: 10 }).ok).toBe(true);
		});

		it('rejects a value immediately below min or above max', () => {
			const field = numberField({ min: 0, max: 10 });
			expect(coercePluginFieldValues([field], { n: -0.0001 })).toEqual({
				ok: false,
				error: '"N" must be at least 0.',
			});
			expect(coercePluginFieldValues([field], { n: 10.0001 })).toEqual({
				ok: false,
				error: '"N" must be at most 10.',
			});
		});

		it('rejects a value misaligned to step, regression case 1e12 + 0.5', () => {
			const field = numberField({ min: 0, step: 1 });
			const result = coercePluginFieldValues([field], { n: 1e12 + 0.5 });
			expect(result.ok).toBe(false);
		});

		it('reports a misaligned step from a zero base as a multiple of the step', () => {
			const field = numberField({ id: 'amount', label: 'Amount', min: 0, step: 2 });
			const result = coercePluginFieldValues([field], { amount: 3 });
			expect(result).toEqual({
				ok: false,
				error: '"Amount" must be a multiple of 2.',
			});
		});

		it('reports a misaligned step from a non-zero base with the base and step', () => {
			const field = numberField({ id: 'amount', label: 'Amount', min: 3, step: 5 });
			const result = coercePluginFieldValues([field], { amount: 4 });
			expect(result).toEqual({
				ok: false,
				error: '"Amount" must start at 3 and increase in steps of 5.',
			});
		});

		it('rejects NaN and both infinities', () => {
			const field = numberField();
			expect(coercePluginFieldValues([field], { n: NaN }).ok).toBe(false);
			expect(coercePluginFieldValues([field], { n: Infinity }).ok).toBe(false);
			expect(coercePluginFieldValues([field], { n: -Infinity }).ok).toBe(false);
			expect(coercePluginFieldValues([field], { n: 'not-a-number' }).ok).toBe(false);
		});

		it('rejects zero/negative step by always failing alignment', () => {
			expect(coercePluginFieldValues([numberField({ step: 0 })], { n: 0 }).ok).toBe(false);
			expect(coercePluginFieldValues([numberField({ step: -1 })], { n: 0 }).ok).toBe(false);
		});

		it('rejects a whitespace-only string instead of silently coercing it to 0', () => {
			const result = coercePluginFieldValues([numberField()], { n: '   ' });
			expect(result.ok).toBe(false);
		});

		it('rejects booleans, arrays, and objects instead of silently coercing them', () => {
			const field = numberField();
			expect(coercePluginFieldValues([field], { n: true }).ok).toBe(false);
			expect(coercePluginFieldValues([field], { n: [5] }).ok).toBe(false);
			expect(coercePluginFieldValues([field], { n: {} }).ok).toBe(false);
		});

		it('requires a value when required, and treats an empty optional field as null', () => {
			expect(coercePluginFieldValues([numberField({ required: true })], { n: '' })).toEqual({
				ok: false,
				error: '"N" is required.',
			});
			expect(coercePluginFieldValues([numberField()], { n: '' })).toEqual({
				ok: true,
				values: { n: null },
			});
			expect(coercePluginFieldValues([numberField()], {})).toEqual({
				ok: true,
				values: { n: null },
			});
		});
	});

	describe('boolean', () => {
		it('coerces recognized strings and passes through actual booleans', () => {
			const field = booleanField();
			expect(coercePluginFieldValues([field], { b: 'false' })).toEqual({
				ok: true,
				values: { b: false },
			});
			expect(coercePluginFieldValues([field], { b: 'true' })).toEqual({
				ok: true,
				values: { b: true },
			});
			expect(coercePluginFieldValues([field], { b: '0' })).toEqual({
				ok: true,
				values: { b: false },
			});
			expect(coercePluginFieldValues([field], { b: '1' })).toEqual({
				ok: true,
				values: { b: true },
			});
			expect(coercePluginFieldValues([field], { b: true })).toEqual({
				ok: true,
				values: { b: true },
			});
			expect(coercePluginFieldValues([field], { b: false })).toEqual({
				ok: true,
				values: { b: false },
			});
		});

		it('recognizes boolean strings case-insensitively', () => {
			const field = booleanField();
			expect(coercePluginFieldValues([field], { b: 'TRUE' })).toEqual({
				ok: true,
				values: { b: true },
			});
			expect(coercePluginFieldValues([field], { b: 'False' })).toEqual({
				ok: true,
				values: { b: false },
			});
		});

		it('rejects an unrecognized string instead of defaulting via Boolean(...)', () => {
			const result = coercePluginFieldValues([booleanField()], { b: 'maybe' });
			expect(result).toEqual({ ok: false, error: 'Unrecognized boolean value "maybe"' });
		});

		it('rejects a non-string, non-boolean value', () => {
			const result = coercePluginFieldValues([booleanField()], { b: 42 });
			expect(result.ok).toBe(false);
		});

		it('treats an empty optional field as null, not false', () => {
			expect(coercePluginFieldValues([booleanField()], { b: '' })).toEqual({
				ok: true,
				values: { b: null },
			});
		});

		it('still rejects an empty value on a required boolean field', () => {
			const result = coercePluginFieldValues([booleanField({ required: true })], { b: '' });
			expect(result).toEqual({ ok: false, error: '"B" is required.' });
		});
	});

	describe('select', () => {
		it('accepts a submitted value matching a bare-string option', () => {
			const result = coercePluginFieldValues([selectField()], { sel: 'a' });
			expect(result).toEqual({ ok: true, values: { sel: 'a' } });
		});

		it("accepts a submitted value matching an object option's value, not its label", () => {
			const field = selectField({ options: [{ value: 'x', label: 'Ex' }] });
			expect(coercePluginFieldValues([field], { sel: 'x' })).toEqual({
				ok: true,
				values: { sel: 'x' },
			});
			expect(coercePluginFieldValues([field], { sel: 'Ex' }).ok).toBe(false);
		});

		it('rejects a value not present in options, listing the allowed values', () => {
			const result = coercePluginFieldValues([selectField()], { sel: 'c' });
			expect(result).toEqual({ ok: false, error: '"Sel" must be one of: a, b.' });
		});

		it('rejects a non-string submitted value', () => {
			const result = coercePluginFieldValues([selectField()], { sel: 42 });
			expect(result.ok).toBe(false);
		});

		it('treats an empty optional selection as null', () => {
			expect(coercePluginFieldValues([selectField()], { sel: '' })).toEqual({
				ok: true,
				values: { sel: null },
			});
		});

		it('rejects an empty value on a required select field', () => {
			const result = coercePluginFieldValues([selectField({ required: true })], { sel: '' });
			expect(result).toEqual({ ok: false, error: '"Sel" is required.' });
		});

		it('rejects defensively when the field carries a malformed options list', () => {
			const field = selectField({ options: [] });
			const result = coercePluginFieldValues([field], { sel: 'a' });
			expect(result.ok).toBe(false);
		});
	});

	describe('string', () => {
		it('leaves an empty submission as an empty string, not null', () => {
			expect(coercePluginFieldValues([stringField()], { s: '' })).toEqual({
				ok: true,
				values: { s: '' },
			});
		});

		it('converts a never-submitted value to null', () => {
			expect(coercePluginFieldValues([stringField()], {})).toEqual({
				ok: true,
				values: { s: null },
			});
		});

		it('still rejects an empty value on a required string field', () => {
			const result = coercePluginFieldValues([stringField({ required: true })], { s: '' });
			expect(result).toEqual({ ok: false, error: '"S" is required.' });
		});

		it('rejects a non-string submitted value', () => {
			const result = coercePluginFieldValues([stringField()], { s: 42 });
			expect(result.ok).toBe(false);
		});
	});
});
