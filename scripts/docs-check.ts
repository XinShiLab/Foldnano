// Keeps docs/*.md in sync with the code they describe. Each doc declares the code it covers in
// front matter (`covers:` globs); this script reports docs whose covered code changed without them.
// Usage:
//   pnpm docs:check                 changed-but-undocumented areas in uncommitted work (warning)
//   pnpm docs:check --staged        same, for staged files (run by the pre-commit hook)
//   pnpm docs:check --branch        same, for everything on this branch vs main
//   pnpm docs:check --file <path>   which docs cover <path>
//   pnpm docs:verify                every doc has `covers:`, every glob matches a tracked file, and
//                                   every backticked repo path in docs exists (exit 1 on failure)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';

const DOCS_DIR = 'docs';
// Dated reviews and todo lists record a moment in time; they are never updated to track code.
const SNAPSHOT_STATUS = 'snapshot';
const IGNORED_CHANGE = /(\.spec\.ts$|\/test\/|\/tests\/|^test_files\/)/;
const REPO_PATH_IN_BACKTICKS = /`((?:src|scripts|static|test_files)\/[^`*<>\s]+?)[.,:)]*`/g;

interface DocEntry {
	path: string;
	covers: string[];
	status: string | null;
	hasFrontMatter: boolean;
}

function git(args: string[]): string[] {
	return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
		.split('\n')
		.filter(Boolean);
}

// Docs may name generated outputs (fixtures, plugin zips); those are gitignored and absent in a fresh clone.
function gitIgnored(paths: string[]): Set<string> {
	if (paths.length === 0) return new Set();
	const result = spawnSync('git', ['check-ignore', '--stdin'], {
		input: paths.join('\n'),
		encoding: 'utf8',
	});
	return new Set(result.stdout.split('\n').filter(Boolean));
}

function parseFrontMatter(docPath: string, text: string): DocEntry {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
	if (!match) return { path: docPath, covers: [], status: null, hasFrontMatter: false };
	const covers: string[] = [];
	let status: string | null = null;
	let inCovers = false;
	for (const line of match[1].split('\n')) {
		const item = /^\s+-\s+(.+?)\s*$/.exec(line);
		if (inCovers && item) {
			covers.push(item[1].replace(/^['"]|['"]$/g, ''));
			continue;
		}
		inCovers = /^covers:\s*$/.test(line);
		const statusMatch = /^status:\s*(\S+)/.exec(line);
		if (statusMatch) status = statusMatch[1];
	}
	return { path: docPath, covers, status, hasFrontMatter: true };
}

function loadDocs(): DocEntry[] {
	return readdirSync(DOCS_DIR)
		.filter((name) => name.endsWith('.md'))
		.sort()
		.map((name) => {
			const docPath = `${DOCS_DIR}/${name}`;
			return parseFrontMatter(docPath, readFileSync(docPath, 'utf8'));
		});
}

function docsCovering(docs: DocEntry[], file: string): DocEntry[] {
	return docs.filter((doc) => doc.covers.some((glob) => matchesGlob(file, glob)));
}

function changedFiles(mode: 'uncommitted' | 'staged' | 'branch'): string[] {
	if (mode === 'staged') return git(['diff', '--cached', '--name-only', '--diff-filter=ACMRD']);
	const base = mode === 'branch' ? git(['merge-base', 'main', 'HEAD'])[0] : 'HEAD';
	return [
		...new Set([
			...git(['diff', '--name-only', '--diff-filter=ACMRD', base]),
			...git(['ls-files', '--others', '--exclude-standard']),
		]),
	];
}

function reportDrift(docs: DocEntry[], changed: string[]): void {
	const changedSet = new Set(changed);
	const untouched = new Map<string, string[]>();
	for (const file of changed) {
		if (IGNORED_CHANGE.test(file) || file.startsWith(`${DOCS_DIR}/`)) continue;
		for (const doc of docsCovering(docs, file)) {
			if (changedSet.has(doc.path)) continue;
			untouched.set(doc.path, [...(untouched.get(doc.path) ?? []), file]);
		}
	}
	if (untouched.size === 0) return;
	console.log('docs-check: code changed in areas whose docs were not touched:');
	for (const [docPath, files] of untouched) {
		console.log(`  ${docPath}`);
		for (const file of files.slice(0, 5)) console.log(`      ${file}`);
		if (files.length > 5) console.log(`      … and ${files.length - 5} more`);
	}
	console.log(
		'Update those docs if behavior, names, or boundaries changed; otherwise ignore this warning.'
	);
}

function verify(docs: DocEntry[]): number {
	const tracked = git(['ls-files']);
	const problems: string[] = [];
	const missing: { docPath: string; repoPath: string }[] = [];
	for (const doc of docs) {
		if (!doc.hasFrontMatter) {
			problems.push(`${doc.path}: missing front matter with \`covers:\` (or status: snapshot)`);
			continue;
		}
		if (doc.status === SNAPSHOT_STATUS) continue;
		for (const glob of doc.covers) {
			if (!tracked.some((file) => matchesGlob(file, glob))) {
				problems.push(`${doc.path}: covers glob matches no tracked file: ${glob}`);
			}
		}
		const text = readFileSync(doc.path, 'utf8');
		for (const [, repoPath] of text.matchAll(REPO_PATH_IN_BACKTICKS)) {
			if (!existsSync(repoPath)) missing.push({ docPath: doc.path, repoPath });
		}
	}
	const ignored = gitIgnored(missing.map((m) => m.repoPath));
	for (const { docPath, repoPath } of missing) {
		if (!ignored.has(repoPath)) problems.push(`${docPath}: referenced path missing: ${repoPath}`);
	}
	for (const problem of problems) console.error(`docs-verify: ${problem}`);
	if (problems.length === 0) console.log(`docs-verify: ${docs.length} docs OK.`);
	return problems.length === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
const docs = loadDocs();

if (args.includes('--verify')) {
	process.exitCode = verify(docs);
} else if (args.includes('--file')) {
	const file = args[args.indexOf('--file') + 1];
	const covering = file ? docsCovering(docs, file) : [];
	console.log(covering.length ? covering.map((doc) => doc.path).join('\n') : 'no doc covers this');
} else {
	const mode = args.includes('--staged')
		? 'staged'
		: args.includes('--branch')
			? 'branch'
			: 'uncommitted';
	reportDrift(docs, changedFiles(mode));
}
