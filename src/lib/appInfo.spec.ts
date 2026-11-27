import { describe, expect, it } from 'vitest';
import { displayVersion } from './appInfo';

describe('displayVersion', () => {
	it('marks every 0.x version as beta, and nothing from 1.0 on', () => {
		expect(displayVersion('0.11.0')).toBe('0.11.0 (beta)');
		expect(displayVersion('0.9.3')).toBe('0.9.3 (beta)');
		expect(displayVersion('1.0.0')).toBe('1.0.0');
		expect(displayVersion('10.2.0')).toBe('10.2.0');
	});
});
