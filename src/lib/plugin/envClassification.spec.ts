import { describe, expect, it } from 'vitest';

import {
	classifyEnv,
	DIST_LIST_PYODIDE_VERSION,
	pypiRequirements,
	requirementSources,
	STANDARD_ENV_EXTRAS,
} from './envClassification';
import { PYODIDE_VERSION } from './worker/pyodideConfig';

describe('classifyEnv', () => {
	it('classifies plugins with no requirements as standard', () => {
		expect(classifyEnv({})).toBe('standard');
		expect(classifyEnv({ requirements: [] })).toBe('standard');
	});

	it('classifies bare dist-package names as standard', () => {
		expect(classifyEnv({ requirements: ['numpy', 'pandas', 'matplotlib'] })).toBe('standard');
	});

	it('normalizes package names per PEP 503 before dist-list lookup', () => {
		// Dist list contains 'Jinja2' and 'scikit-learn'
		expect(classifyEnv({ requirements: ['jinja2'] })).toBe('standard');
		expect(classifyEnv({ requirements: ['Scikit_Learn'] })).toBe('standard');
	});

	it('classifies standard-extra names as standard', () => {
		expect(classifyEnv({ requirements: ['cadnano2_5_mini'] })).toBe('standard');
		expect(classifyEnv({ requirements: ['cadnano2_5_mini', 'numpy'] })).toBe('standard');
	});

	it('classifies any version specifier as custom, even one matching the dist version', () => {
		expect(classifyEnv({ requirements: ['numpy==1.26.4'] })).toBe('custom');
		expect(classifyEnv({ requirements: ['pandas>=2.0'] })).toBe('custom');
	});

	it('classifies off-dist package names as custom', () => {
		expect(classifyEnv({ requirements: ['some-floating-pypi-package'] })).toBe('custom');
	});

	it('classifies any wheel requirement as custom', () => {
		expect(classifyEnv({ requirements: ['mylib-1.0-py3-none-any.whl'] })).toBe('custom');
		expect(
			classifyEnv({
				requirements: ['https://fold.xinshilab.com/wheels/mylib-1.0-py3-none-any.whl'],
			})
		).toBe('custom');
		expect(
			classifyEnv({
				requirements: ['/plugins/cadnano_mini/v0.1.0/cadnano2_5_mini-0.1.0-py3-none-any.whl'],
			})
		).toBe('custom');
	});

	it('one custom requirement makes the whole plugin custom', () => {
		expect(classifyEnv({ requirements: ['numpy', 'numpy==1.26.4'] })).toBe('custom');
	});
});

describe('network access', () => {
	it('routes any plugin that declares network access to the custom tier', () => {
		expect(classifyEnv({ network: ['api.example.org'] })).toBe('custom');
		expect(classifyEnv({ network: ['*'], requirements: ['numpy'] })).toBe('custom');
	});

	it('treats an empty network list as no network', () => {
		expect(classifyEnv({ network: [] })).toBe('standard');
	});
});

describe('pypiRequirements', () => {
	it('lists only requirements micropip resolves from PyPI', () => {
		expect(
			pypiRequirements({
				requirements: [
					'numpy',
					'NumPy',
					'numpy==1.26.4',
					'humanize',
					'cadnano2_5_mini',
					'pkg-1.0-py3-none-any.whl',
				],
			})
		).toEqual(['numpy==1.26.4', 'humanize']);
	});
});

describe('requirementSources', () => {
	it('groups requirements by where they are installed from', () => {
		expect(
			requirementSources({
				requirements: [
					'numpy',
					'humanize',
					'numpy==1.26.4',
					'cadnano2_5_mini',
					'my_dep-1.0-py3-none-any.whl',
					'/plugins/shared/pkg-1.0-py3-none-any.whl',
				],
			})
		).toEqual({
			distribution: ['numpy'],
			pypi: ['humanize', 'numpy==1.26.4'],
			bundled: ['my_dep-1.0-py3-none-any.whl'],
			firstParty: ['cadnano2_5_mini', '/plugins/shared/pkg-1.0-py3-none-any.whl'],
		});
	});
});

describe('standard environment pins', () => {
	it('vendored dist list matches the pinned Pyodide version', () => {
		// Drift here means someone bumped the Pyodide pin without rerunning
		// `pnpm gen:pyodide-packages` (or vice versa).
		expect(DIST_LIST_PYODIDE_VERSION).toBe(PYODIDE_VERSION);
	});

	it('standard-extra URLs embed the registered version', () => {
		for (const [name, extra] of Object.entries(STANDARD_ENV_EXTRAS)) {
			expect(extra.url, `extra ${name}`).toContain(extra.version);
			expect(extra.url.endsWith('.whl'), `extra ${name}`).toBe(true);
		}
	});
});
