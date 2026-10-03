import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build, type Plugin as EsbuildPlugin } from 'esbuild';
import type { Plugin } from 'vite';

const QUERY = '?sandbox-worker';
const RAW_NAMESPACE = 'raw';

/** Mirrors Vite's `?raw` imports inside the esbuild bundle. */
const rawTextImports: EsbuildPlugin = {
	name: 'raw-text-imports',
	setup(b) {
		b.onResolve({ filter: /\?raw$/ }, (args) => ({
			path: path.resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)),
			namespace: RAW_NAMESPACE,
		}));
		b.onLoad({ filter: /.*/, namespace: RAW_NAMESPACE }, async (args) => ({
			contents: await readFile(args.path, 'utf8'),
			loader: 'text',
		}));
	},
};

/**
 * `import source from './x.worker.ts?sandbox-worker'` yields the worker bundled into one classic
 * IIFE string. The plugin sandbox starts it from a `blob:` URL inside an opaque-origin iframe,
 * where module workers fail silently — so it bypasses Vite's worker pipeline, identically in dev
 * and build. See docs/python-plugin-system.md § Sandbox.
 */
export function sandboxWorkerSource(): Plugin {
	let env: Record<string, unknown> = {};
	let minify = false;

	return {
		name: 'foldnano:sandbox-worker-source',
		configResolved(config) {
			env = config.env;
			minify = config.command === 'build';
		},
		async load(id) {
			if (!id.endsWith(QUERY)) return null;
			const result = await build({
				entryPoints: [id.slice(0, -QUERY.length)],
				bundle: true,
				write: false,
				format: 'iife',
				target: 'es2022',
				minify,
				metafile: true,
				logLevel: 'silent',
				// A classic script has no `import.meta`; inline Vite's env object instead.
				define: { 'import.meta.env': JSON.stringify(env) },
				plugins: [rawTextImports],
			});
			for (const input of Object.keys(result.metafile.inputs)) {
				if (input.startsWith('<')) continue; // synthetic inputs such as <define:…>
				const file = input.startsWith(`${RAW_NAMESPACE}:`)
					? input.slice(RAW_NAMESPACE.length + 1)
					: input;
				this.addWatchFile(path.resolve(file));
			}
			return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
		},
	};
}
