import type { WhatsNewEntry } from './entries';

/** One commit as read from `git log`, with the files it touched. */
export interface CommitInfo {
	readonly hash: string;
	/** ISO 8601 author date (preserved across rebases, unlike the commit date). */
	readonly authorDate: string;
	readonly subject: string;
	readonly files: readonly string[];
}

// Checked in order; the area with the most matching files wins, ties go to the earlier rule.
const AREA_RULES: readonly { area: string; pattern: RegExp }[] = [
	{
		area: 'Plugins',
		pattern:
			/^(src\/lib\/plugin\/|src\/lib\/components\/Editor\/(Plugin|SidePanel)\/|static\/plugins\/)/,
	},
	{
		area: 'GitHub',
		pattern:
			/^src\/(lib\/components\/Editor\/(GitHub\w*|GitGraph)\/|lib\/services\/github\/|routes\/api\/github\/)/,
	},
	{ area: '3D view', pattern: /^src\/lib\/components\/Editor\/View3D\// },
	{ area: 'Plane view', pattern: /^src\/lib\/components\/Editor\/HelixView\// },
	{
		area: 'Strand view',
		pattern: /^src\/lib\/(canvasEditor\/|components\/Editor\/(StrandView|ToolPanel)\/)/,
	},
	{ area: 'Reports', pattern: /^src\/(routes\/(oligos|toc)\/|lib\/components\/Oligos\/)/ },
	{ area: 'Export', pattern: /^src\/lib\/model\/io\// },
	{ area: 'Editing', pattern: /^src\/lib\/(model|commands)\// },
];

const DEFAULT_AREA = 'General';

// Accepts `add:`, `feat:`, `fix:`, with an optional `(scope)`, plus `major feat:` / `Bug fix:`.
const USER_FACING_PREFIX = /^(?:major\s+)?(?:bug\s+)?(add|feat|fix)(?:\([^)]*\))?\s*:\s*/i;

/** A changed file that can affect what users see in the app (not tests, docs, or tooling). */
export function isAppFile(path: string): boolean {
	if (!/^(src\/(lib|routes)\/|static\/)/.test(path)) return false;
	if (/\.(spec|test)\.[jt]s$/.test(path) || /\/test\//.test(path)) return false;
	return !path.startsWith('src/routes/docs/');
}

export function classifyArea(files: readonly string[]): string {
	let best = DEFAULT_AREA;
	let bestCount = 0;
	for (const { area, pattern } of AREA_RULES) {
		const count = files.filter((file) => pattern.test(file)).length;
		if (count > bestCount) {
			best = area;
			bestCount = count;
		}
	}
	return best;
}

/** `fix: [3d-overlay] keep view active.` → `Keep view active`; null if not a user-facing type. */
export function subjectToText(subject: string): string | null {
	const match = USER_FACING_PREFIX.exec(subject.trim());
	if (!match) return null;
	const text = subject
		.trim()
		.slice(match[0].length)
		.replace(/^(\[[^\]]*\]\s*)+/, '')
		.replace(/\.$/, '')
		.trim();
	if (!text) return null;
	return text[0].toUpperCase() + text.slice(1);
}

export interface DraftResult {
	readonly drafts: WhatsNewEntry[];
	/** Commits after the watermark that were skipped, with the reason. */
	readonly skipped: { commit: CommitInfo; reason: string }[];
	/** New watermark: the newest author date seen, or the old one when nothing is newer. */
	readonly reviewedThrough: string;
}

/** Turn commits authored after `reviewedThrough` into draft entries, newest first. */
export function buildDrafts(commits: readonly CommitInfo[], reviewedThrough: string): DraftResult {
	const since = Date.parse(reviewedThrough);
	const fresh = commits
		.filter((commit) => Date.parse(commit.authorDate) > since)
		.sort((a, b) => Date.parse(b.authorDate) - Date.parse(a.authorDate));

	const drafts: WhatsNewEntry[] = [];
	const skipped: { commit: CommitInfo; reason: string }[] = [];
	for (const commit of fresh) {
		const text = subjectToText(commit.subject);
		if (text === null) {
			skipped.push({ commit, reason: 'not add/feat/fix' });
			continue;
		}
		const appFiles = commit.files.filter(isAppFile);
		if (appFiles.length === 0) {
			skipped.push({ commit, reason: 'no app files changed' });
			continue;
		}
		drafts.push({
			date: commit.authorDate.slice(0, 10),
			area: classifyArea(appFiles),
			text,
			draft: true,
		});
	}

	const newest = fresh[0]?.authorDate;
	return { drafts, skipped, reviewedThrough: newest ?? reviewedThrough };
}

/** Parse `git log --name-only --format=%x1e%H%x1f%aI%x1f%s` output. */
export function parseGitLog(output: string): CommitInfo[] {
	return output
		.split('\x1e')
		.map((record) => record.trim())
		.filter(Boolean)
		.map((record) => {
			const [header, ...fileLines] = record.split('\n');
			const [hash, authorDate, subject] = header.split('\x1f');
			return {
				hash,
				authorDate,
				subject,
				files: fileLines.map((line) => line.trim()).filter(Boolean),
			};
		});
}

function quote(value: string): string {
	return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function renderEntry(entry: WhatsNewEntry): string {
	const lines = [
		`\t{`,
		`\t\tdate: ${quote(entry.date)},`,
		`\t\tarea: ${quote(entry.area)},`,
		`\t\ttext: ${quote(entry.text)},`,
	];
	if (entry.draft) lines.push(`\t\tdraft: true,`);
	lines.push(`\t},`);
	return lines.join('\n');
}

const LIST_START = 'export const WHATS_NEW: readonly WhatsNewEntry[] = [';
const WATERMARK = /export const WHATS_NEW_REVIEWED_THROUGH = '[^']*';/;

/** Insert drafts at the top of the list in entries.ts source and advance the watermark. */
export function insertDrafts(
	source: string,
	drafts: readonly WhatsNewEntry[],
	reviewedThrough: string
): string {
	const start = source.indexOf(LIST_START);
	if (start < 0 || !WATERMARK.test(source)) {
		throw new Error('entries.ts no longer has the expected WHATS_NEW / watermark declarations');
	}
	const withWatermark = source.replace(
		WATERMARK,
		`export const WHATS_NEW_REVIEWED_THROUGH = ${quote(reviewedThrough)};`
	);
	if (drafts.length === 0) return withWatermark;

	const insertAt = withWatermark.indexOf(LIST_START) + LIST_START.length;
	const block = '\n' + drafts.map(renderEntry).join('\n');
	return withWatermark.slice(0, insertAt) + block + withWatermark.slice(insertAt);
}
