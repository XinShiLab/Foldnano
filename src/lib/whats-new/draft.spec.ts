import { describe, expect, it } from 'vitest';
import {
	buildDrafts,
	classifyArea,
	insertDrafts,
	isAppFile,
	parseGitLog,
	subjectToText,
	type CommitInfo,
} from './draft';
import { publishedWhatsNew, splitByRecency, type WhatsNewEntry } from './entries';

function commit(overrides: Partial<CommitInfo>): CommitInfo {
	return {
		hash: 'abc1234',
		authorDate: '2026-10-01T12:00:00+02:00',
		subject: 'add: something',
		files: ['src/lib/components/Editor/StrandView/StrandViewer.svelte'],
		...overrides,
	};
}

describe('subjectToText', () => {
	it('strips the type prefix and capitalizes', () => {
		expect(subjectToText('add: duplicate selected oligos')).toBe('Duplicate selected oligos');
		expect(subjectToText('feat(plugins): persist editor code.')).toBe('Persist editor code');
	});

	it('drops leading [scope] tags', () => {
		expect(subjectToText('fix: [3d-overlay] keep 3D view active')).toBe('Keep 3D view active');
	});

	it('accepts the major feat / Bug fix variants used in this repo', () => {
		expect(subjectToText('major feat: two-step exporter')).toBe('Two-step exporter');
		expect(subjectToText('Bug fix: StrandView fills the space')).toBe('StrandView fills the space');
	});

	it('rejects other commit types', () => {
		expect(subjectToText('docs: update manual')).toBeNull();
		expect(subjectToText('refactor: split context')).toBeNull();
		expect(subjectToText('fix:')).toBeNull();
	});
});

describe('isAppFile', () => {
	it('keeps app sources and static assets', () => {
		expect(isAppFile('src/lib/plugin/PluginRegistry.svelte.ts')).toBe(true);
		expect(isAppFile('src/routes/oligos/+page.svelte')).toBe(true);
		expect(isAppFile('static/plugins/hello_world/plugin.py')).toBe(true);
	});

	it('ignores tests, docs, the doc site, and tooling', () => {
		expect(isAppFile('src/lib/plugin/PluginRegistry.spec.ts')).toBe(false);
		expect(isAppFile('src/lib/model/test/Part.spec.ts')).toBe(false);
		expect(isAppFile('src/routes/docs/+layout.svelte')).toBe(false);
		expect(isAppFile('src/content/guide/01-getting-started.md')).toBe(false);
		expect(isAppFile('docs/user-manual.md')).toBe(false);
		expect(isAppFile('.gitattributes')).toBe(false);
	});
});

describe('classifyArea', () => {
	it('picks the area with the most matching files', () => {
		expect(
			classifyArea([
				'src/lib/plugin/PluginCoordinator.svelte.ts',
				'src/lib/plugin/ResultApplicator.ts',
				'src/lib/components/Editor/StrandView/StrandViewer.svelte',
			])
		).toBe('Plugins');
	});

	it('maps GitHub, 3D, and report paths', () => {
		expect(classifyArea(['src/lib/components/Editor/GitHubExplorer/FilesTab.svelte'])).toBe(
			'GitHub'
		);
		expect(classifyArea(['src/lib/components/Editor/View3D/View3D.svelte'])).toBe('3D view');
		expect(classifyArea(['src/routes/oligos/diff/+page.svelte'])).toBe('Reports');
	});

	it('falls back to General', () => {
		expect(classifyArea(['src/app.css'])).toBe('General');
	});
});

describe('buildDrafts', () => {
	const watermark = '2026-09-24T10:13:34+02:00';

	it('drafts only commits authored after the watermark, newest first', () => {
		const result = buildDrafts(
			[
				commit({ subject: 'add: older', authorDate: '2026-09-24T10:13:34+02:00' }),
				commit({ subject: 'add: first', authorDate: '2026-09-25T09:00:00+02:00' }),
				commit({ subject: 'fix: second', authorDate: '2026-09-26T09:00:00+02:00' }),
			],
			watermark
		);
		expect(result.drafts.map((d) => d.text)).toEqual(['Second', 'First']);
		expect(result.drafts.every((d) => d.draft === true && d.area === 'Strand view')).toBe(true);
		expect(result.drafts[0].date).toBe('2026-09-26');
		expect(result.reviewedThrough).toBe('2026-09-26T09:00:00+02:00');
	});

	it('skips non-feature commits and commits without app files, but still advances', () => {
		const result = buildDrafts(
			[
				commit({ subject: 'docs: guide', authorDate: '2026-09-25T09:00:00+02:00' }),
				commit({
					subject: 'fix: add .pdf to LFS',
					files: ['.gitattributes'],
					authorDate: '2026-09-26T09:00:00+02:00',
				}),
			],
			watermark
		);
		expect(result.drafts).toEqual([]);
		expect(result.skipped.map((s) => s.reason)).toEqual([
			'no app files changed',
			'not add/feat/fix',
		]);
		expect(result.reviewedThrough).toBe('2026-09-26T09:00:00+02:00');
	});

	it('keeps the watermark when nothing is newer', () => {
		const result = buildDrafts([commit({ authorDate: '2026-01-01T00:00:00Z' })], watermark);
		expect(result.drafts).toEqual([]);
		expect(result.reviewedThrough).toBe(watermark);
	});
});

describe('parseGitLog', () => {
	it('parses records with their changed files', () => {
		const output =
			'\x1eaaa\x1f2026-09-25T09:00:00+02:00\x1fadd: one\n\nsrc/a.ts\nsrc/b.ts\n' +
			'\x1ebbb\x1f2026-09-24T09:00:00+02:00\x1ffix: two\n\nsrc/c.ts\n';
		expect(parseGitLog(output)).toEqual([
			{
				hash: 'aaa',
				authorDate: '2026-09-25T09:00:00+02:00',
				subject: 'add: one',
				files: ['src/a.ts', 'src/b.ts'],
			},
			{
				hash: 'bbb',
				authorDate: '2026-09-24T09:00:00+02:00',
				subject: 'fix: two',
				files: ['src/c.ts'],
			},
		]);
	});
});

describe('insertDrafts', () => {
	const source = [
		"export const WHATS_NEW_REVIEWED_THROUGH = '2026-09-24T10:13:34+02:00';",
		'',
		'export const WHATS_NEW: readonly WhatsNewEntry[] = [',
		"\t{ date: '2026-09-23', area: 'Export', text: 'Old' },",
		'];',
	].join('\n');

	it('inserts drafts at the top of the list and moves the watermark', () => {
		const drafts: WhatsNewEntry[] = [
			{ date: '2026-09-26', area: 'Plugins', text: "It's new", draft: true },
		];
		const out = insertDrafts(source, drafts, '2026-09-26T09:00:00+02:00');
		expect(out).toContain("WHATS_NEW_REVIEWED_THROUGH = '2026-09-26T09:00:00+02:00'");
		expect(out.indexOf("text: 'It\\'s new'")).toBeLessThan(out.indexOf("text: 'Old'"));
		expect(out).toContain('draft: true');
	});

	it('only moves the watermark when there are no drafts', () => {
		const out = insertDrafts(source, [], '2026-09-26T09:00:00+02:00');
		expect(out).toContain("'2026-09-26T09:00:00+02:00'");
		expect(out).not.toContain('draft: true');
	});

	it('throws if the declarations were renamed', () => {
		expect(() => insertDrafts('export const OTHER = [];', [], 'x')).toThrow();
	});
});

describe('publishedWhatsNew', () => {
	it('hides drafts and sorts newest first', () => {
		const entries: WhatsNewEntry[] = [
			{ date: '2026-05-01', area: 'A', text: 'old' },
			{ date: '2026-09-01', area: 'A', text: 'draft', draft: true },
			{ date: '2026-08-01', area: 'A', text: 'new' },
		];
		expect(publishedWhatsNew(entries).map((e) => e.text)).toEqual(['new', 'old']);
	});
});

describe('splitByRecency', () => {
	const entry = (date: string): WhatsNewEntry => ({ date, area: 'A', text: date });

	it('keeps entries within 3 months of the newest one as recent', () => {
		const { recent, earlier } = splitByRecency([
			entry('2026-09-23'),
			entry('2026-07-01'),
			entry('2026-06-23'),
			entry('2026-06-22'),
			entry('2026-05-08'),
		]);
		expect(recent.map((e) => e.date)).toEqual(['2026-09-23', '2026-07-01', '2026-06-23']);
		expect(earlier.map((e) => e.date)).toEqual(['2026-06-22', '2026-05-08']);
	});

	it('anchors on the newest entry, not today', () => {
		const { recent } = splitByRecency([entry('2020-01-15'), entry('2019-12-01')]);
		expect(recent).toHaveLength(2);
	});

	it('handles an empty list', () => {
		expect(splitByRecency([])).toEqual({ recent: [], earlier: [] });
	});
});
