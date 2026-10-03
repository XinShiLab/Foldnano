import { describe, expect, it } from 'vitest';
import { loadedPackageLogs, missingModuleHint } from './scriptImports';

describe('loadedPackageLogs', () => {
	it('logs each newly loaded package with its version', () => {
		expect(
			loadedPackageLogs([
				{ name: 'numpy', version: '2.0.2' },
				{ name: 'scipy', version: '1.14.1' },
			])
		).toEqual(['[env] loaded numpy 2.0.2', '[env] loaded scipy 1.14.1']);
	});

	it('logs nothing when every import was already loaded', () => {
		expect(loadedPackageLogs([])).toEqual([]);
	});
});

describe('missingModuleHint', () => {
	it('names the missing top-level module', () => {
		expect(missingModuleHint("No module named 'humanize'")).toMatch(
			/"humanize" is not a Pyodide package.*"requirements"/
		);
		expect(missingModuleHint("No module named 'foo.bar'")).toMatch(/"foo"/);
	});

	it('ignores other errors', () => {
		expect(missingModuleHint('division by zero')).toBeNull();
	});
});
