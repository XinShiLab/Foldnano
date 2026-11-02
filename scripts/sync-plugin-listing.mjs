// Copies the community plugin listing into the app at a pinned commit of the plugins repo.
//
// Run: pnpm plugins:sync-listing <commit-sha>
//
// Writes src/lib/plugin/community/listing.json: the repo's registry.json plus the repo and commit
// it came from. The listing is metadata only (no plugin code); communityPlugins.spec.ts checks it
// with the app's own validators. A listing change reaches users only when Foldnano ships it.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'XinShiLab/foldnano-plugins';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'src/lib/plugin/community/listing.json');

const commit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
	console.error('Usage: pnpm plugins:sync-listing <full 40-character commit sha>');
	process.exit(1);
}

const url = `https://raw.githubusercontent.com/${REPO}/${commit}/registry.json`;
const res = await fetch(url);
if (!res.ok) {
	console.error(`Failed to fetch ${url}: HTTP ${res.status}`);
	process.exit(1);
}
const registry = await res.json();
if (registry.registryVersion !== 1 || !Array.isArray(registry.plugins)) {
	console.error(`Unsupported listing format (registryVersion ${registry.registryVersion}).`);
	process.exit(1);
}

const listing = {
	source: { repo: REPO, commit },
	registryVersion: registry.registryVersion,
	plugins: registry.plugins,
};
writeFileSync(outPath, JSON.stringify(listing, null, '\t') + '\n');
execFileSync('pnpm', ['exec', 'prettier', '--write', outPath], { stdio: 'ignore' });
console.log(
	`Wrote ${registry.plugins.length} entr${registry.plugins.length === 1 ? 'y' : 'ies'} ` +
		`from ${REPO}@${commit.slice(0, 7)}. Run pnpm vitest run src/lib/plugin/communityPlugins.spec.ts`
);
