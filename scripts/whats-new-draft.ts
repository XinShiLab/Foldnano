// Drafts "What's New" entries from add:/feat:/fix: commits authored since the last review.
// Usage: pnpm whats-new:draft [--dry-run]
// Drafts land at the top of src/lib/whats-new/entries.ts with `draft: true` (hidden in the
// app); rewrite or merge them, remove the flag, and commit.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDrafts, insertDrafts, parseGitLog } from '../src/lib/whats-new/draft.ts';

const ENTRIES_PATH = 'src/lib/whats-new/entries.ts';
const dryRun = process.argv.includes('--dry-run');

const source = readFileSync(ENTRIES_PATH, 'utf8');
const watermark = /WHATS_NEW_REVIEWED_THROUGH = '([^']*)'/.exec(source)?.[1];
if (!watermark) throw new Error(`No WHATS_NEW_REVIEWED_THROUGH found in ${ENTRIES_PATH}`);

// --since filters on commit date, which is never earlier than the author date, so this
// only narrows the scan; buildDrafts applies the exact author-date cutoff.
const log = execFileSync(
	'git',
	['log', '--no-merges', `--since=${watermark}`, '--name-only', '--format=%x1e%H%x1f%aI%x1f%s'],
	{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);
const { drafts, skipped, reviewedThrough } = buildDrafts(parseGitLog(log), watermark);

for (const entry of drafts) console.log(`+ ${entry.date}  [${entry.area}]  ${entry.text}`);
for (const { commit, reason } of skipped) {
	console.log(`- skipped ${commit.hash.slice(0, 8)} (${reason}): ${commit.subject}`);
}

if (drafts.length === 0 && reviewedThrough === watermark) {
	console.log('No new commits since the last review.');
} else if (dryRun) {
	console.log(`\nDry run: ${drafts.length} draft(s); watermark would move to ${reviewedThrough}.`);
} else {
	writeFileSync(ENTRIES_PATH, insertDrafts(source, drafts, reviewedThrough));
	execFileSync('pnpm', ['exec', 'prettier', '--write', ENTRIES_PATH], { stdio: 'ignore' });
	console.log(
		`\nAdded ${drafts.length} draft(s) to ${ENTRIES_PATH}. Edit them, remove draft: true, commit.`
	);
}
