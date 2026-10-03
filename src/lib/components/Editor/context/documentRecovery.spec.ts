import { describe, expect, it } from 'vitest';
import { backupFileName } from './documentRecovery';

describe('backupFileName', () => {
	const at = new Date(2026, 8, 27, 14, 5).getTime();

	it('names the file after the design and the local backup time', () => {
		expect(backupFileName('My design', at)).toBe('My design (backup 2026-09-27 14-05).fn.json');
	});

	it('replaces characters that are not allowed in file names', () => {
		expect(backupFileName('a/b:c', at)).toBe('a-b-c (backup 2026-09-27 14-05).fn.json');
	});

	it('falls back when the design has no name', () => {
		expect(backupFileName('  ', at)).toBe('design (backup 2026-09-27 14-05).fn.json');
	});
});
