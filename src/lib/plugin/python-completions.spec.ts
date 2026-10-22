import { execFileSync, spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import {
	completePython,
	parseTypeAnnotation,
	PYTHON_API_INDEX,
	signatureHelpPython,
} from './python-completions';

// Keeps the Python sources in this spec's import graph so `vitest --changed` reruns the drift check.
const PYTHON_SOURCES = import.meta.glob('./python/{foldnano,foldnano_mini}/*.py', {
	query: '?raw',
	eager: true,
});

const HEADER = `from foldnano.plugin import PluginContext
from foldnano_mini import load_part


def run(ctx: PluginContext) -> None:
    part = load_part(
        ctx.get_part_as_foldnano_json(),
        active_region_id=ctx.active_region_id,
    )
`;

function labels(before: string, explicit = false): string[] {
	return completePython(before, { explicit })?.options.map((o) => o.label) ?? [];
}

describe('completePython member access', () => {
	it('completes PluginContext members on an annotated ctx', () => {
		expect(labels(HEADER + '    ctx.')).toEqual(
			expect.arrayContaining(['log', 'set_result_mutation_log', 'active_region_id'])
		);
	});

	it('types the load_part() result as MutablePart', () => {
		const out = labels(HEADER + '    part.');
		expect(out).toEqual(expect.arrayContaining(['oligos', 'oligos_in_region', 'active_region']));
		expect(out).not.toContain('log');
	});

	it('follows property chains through Optional return types', () => {
		const out = labels(HEADER + '    part.active_region.');
		expect(out).toEqual(expect.arrayContaining(['virtual_helices', 'max_base', 'kind']));
		expect(out).not.toContain('oligos');
	});

	it('types for-loop variables from list element types', () => {
		const before =
			HEADER + '    for oligo in part.oligos_in_region(part.active_region_id):\n        oligo.';
		expect(labels(before)).toEqual(expect.arrayContaining(['color', 'segments', 'remove']));
	});

	it('follows indexing and method returns', () => {
		expect(labels(HEADER + '    part.oligos[0].segments[0].slot_at(3).')).toEqual(
			expect.arrayContaining(['seq', 'set_skip'])
		);
	});

	it('resolves variables assigned from other variables', () => {
		const before = HEADER + '    oligos = sorted(part.oligos)\n    first = oligos[0]\n    first.';
		expect(labels(before)).toContain('color');
	});

	it('handles next((x for x in ...), None)', () => {
		const before =
			HEADER +
			'    target = next((oligo for oligo in part.oligos if not oligo.is_scaffold), None)\n    target.';
		expect(labels(before)).toContain('is_scaffold');
	});

	it('includes inherited members on subclasses', () => {
		const before = HEADER + '    region: LatticedRegion = part.regions[0]\n    region.';
		expect(labels(before)).toEqual(expect.arrayContaining(['add_vh_at', 'virtual_helices']));
	});

	it('marks settable properties and inserts method calls with the caret inside', () => {
		const result = completePython(HEADER + '    part.oligos[0].');
		const color = result?.options.find((o) => o.label === 'color');
		expect(color?.detail).toBe('str (settable)');
		const getSegment = result?.options.find((o) => o.label === 'get_segment');
		expect(getSegment).toMatchObject({ insert: 'get_segment()', caret: 'get_segment('.length });
	});

	it('replaces only the partial member name', () => {
		const before = HEADER + '    part.oli';
		expect(completePython(before)?.from).toBe(before.length - 'oli'.length);
	});

	it('offers nothing for unknown receivers unless explicit', () => {
		expect(completePython(HEADER + '    mystery.')).toBeNull();
		expect(labels(HEADER + '    mystery.', true)).toContain('color');
	});

	it('stays quiet in comments and strings', () => {
		expect(completePython(HEADER + '    # part.')).toBeNull();
		expect(completePython(HEADER + '    ctx.log("part.')).toBeNull();
		expect(completePython(HEADER + '    """\n    part.')).toBeNull();
	});
});

describe('completePython names and imports', () => {
	it('completes module exports after from ... import', () => {
		expect(labels('from foldnano_mini import ')).toEqual(
			expect.arrayContaining(['load_part', 'MutablePart'])
		);
		expect(labels('from foldnano.plugin import Plug')).toEqual(['PluginContext']);
	});

	it('completes module names', () => {
		expect(labels('from foldnano')).toEqual(expect.arrayContaining(['foldnano', 'foldnano_mini']));
	});

	it('offers typed scope variables, API names and keywords for a bare identifier', () => {
		const result = completePython(HEADER + '    pa');
		const part = result?.options.find((o) => o.label === 'part');
		expect(part?.detail).toBe('MutablePart');
		const out = result?.options.map((o) => o.label) ?? [];
		expect(out).toEqual(expect.arrayContaining(['load_part', 'for', 'len']));
		expect(out).not.toContain('pa');
	});

	it('does not complete names being defined', () => {
		expect(completePython('def ru')).toBeNull();
	});
});

describe('parseTypeAnnotation', () => {
	it.each([
		['MutableOligo | None', { cls: 'MutableOligo', list: false }],
		['Optional[MutableRegion]', { cls: 'MutableRegion', list: false }],
		["list['MutableVirtualHelix']", { cls: 'MutableVirtualHelix', list: true }],
		['dict[str, Any]', null],
		['str', null],
	])('%s', (text, expected) => {
		expect(parseTypeAnnotation(text, PYTHON_API_INDEX)).toEqual(expected);
	});
});

const hasPython = spawnSync('python3', ['--version']).status === 0;

describe('generated Python API artifacts', () => {
	it.skipIf(!hasPython)('stubs and completion index match the Python sources', () => {
		expect(Object.keys(PYTHON_SOURCES).length).toBeGreaterThan(0);
		// Throws (with the stale paths in stdout) when `pnpm gen:python-api` needs re-running.
		expect(() =>
			execFileSync('python3', ['scripts/gen_python_api.py', '--check'], { encoding: 'utf-8' })
		).not.toThrow();
	});
});

describe('signatureHelpPython', () => {
	const help = (before: string) => signatureHelpPython(before);

	it('shows a method signature right after the open paren', () => {
		const out = help(HEADER + '    part.break_at(');
		expect(out?.label).toBe('part.break_at');
		expect(out?.params).toEqual([
			'vh: MutableVirtualHelix | int',
			'strand_index: int',
			'bp_index: int',
		]);
		expect(out?.activeParam).toBe(0);
	});

	it('tracks the active argument by position and by keyword', () => {
		expect(help(HEADER + '    part.break_at(vh, 0, ')?.activeParam).toBe(2);
		expect(help(HEADER + '    part.create_segment(0, 1, 2, is_scaffold=')?.activeParam).toBe(4);
	});

	it('ignores commas nested in brackets and strings', () => {
		expect(help(HEADER + '    part.create_segment(f(1, 2), "a,b", ')?.activeParam).toBe(2);
	});

	it('maps arguments past a bare `*` to keyword-only params', () => {
		expect(help(HEADER + "    part.add_region('square', 'r', 64, min_base=")?.activeParam).toBe(4);
	});

	it('resolves module-level API functions', () => {
		const out = help('from foldnano_mini import load_part\npart = load_part(s, ');
		expect(out?.label).toBe('load_part');
		expect(out?.returns).toBe('MutablePart');
		expect(out?.activeParam).toBe(1);
	});

	it('uses the innermost open call', () => {
		expect(help(HEADER + '    part.break_at(part.oligos_in_region(')?.label).toBe(
			'part.oligos_in_region'
		);
		expect(help(HEADER + '    part.break_at(part.oligos_in_region(x), ')?.label).toBe(
			'part.break_at'
		);
	});

	it('returns null outside calls, for unknown callees, and in comments', () => {
		expect(help(HEADER + '    part.break_at(1, 2, 3)')).toBeNull();
		expect(help(HEADER + '    unknown_thing(')).toBeNull();
		expect(help(HEADER + '    # part.break_at(')).toBeNull();
	});
});
