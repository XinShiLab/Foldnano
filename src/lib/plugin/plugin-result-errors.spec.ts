import { describe, it, expect } from 'vitest';
import { PluginValidationError, PluginApplyError } from './plugin-result-errors';

describe('PluginResultError.toSafeReportable', () => {
	it('produces a generic message from phase/pluginId/invariantCategory, with stack cleared', () => {
		const err = new PluginValidationError(
			'some raw detail with an id',
			'plugin-x',
			'result-format-validation',
			'shape'
		);
		const safe = err.toSafeReportable();

		expect(safe.message).toBe('Plugin "plugin-x": Result validation failed (shape).');
		expect(safe.name).toBe('PluginValidationError');
		// The key must be present with value undefined, not merely absent from the object.
		expect('stack' in safe).toBe(true);
		expect(safe.stack).toBeUndefined();
	});

	it('names the category for Design verification and omits it for Apply', () => {
		const verification = new PluginValidationError(
			'detail',
			'plugin-x',
			'design-verification',
			'vh-index-set'
		);
		expect(verification.toSafeReportable().message).toBe(
			'Plugin "plugin-x": Design verification failed (vh-index-set).'
		);

		const apply = new PluginApplyError('detail', 'plugin-x', 'apply-failed');
		expect(apply.toSafeReportable().message).toBe('Plugin "plugin-x": Apply failed.');
		expect(apply.message).toBe('Apply failed: detail');
	});

	it('never includes the original message text in the safe report', () => {
		const err = new PluginValidationError(
			'leaked-secret-detail-12345',
			'plugin-y',
			'design-verification',
			'reference'
		);
		const safe = err.toSafeReportable();
		expect(safe.message).not.toContain('leaked-secret-detail-12345');
	});

	it('PluginApplyError uses the final-apply phase and plugin:apply context', () => {
		const err = new PluginApplyError('apply failed', 'plugin-z', 'reconstruction');
		expect(err.errorLogContext).toBe('plugin:apply');
		expect(err.phase).toBe('final-apply');
	});

	it('PluginValidationError uses the plugin:validation context', () => {
		const err = new PluginValidationError('x', 'plugin-z', 'result-format-validation', 'shape');
		expect(err.errorLogContext).toBe('plugin:validation');
	});
});
