import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { build, type Plugin as EsbuildPlugin } from 'esbuild';
import type { Plugin } from 'vite';

const QUERY = '?sandbox-worker';

/** `import files from 'virtual:foldnano-python-packages'`: `{ 'pkg/module.py': source }`. */
const PYTHON_PACKAGES_ID = 'virtual:foldnano-python-packages';
const PYTHON_PACKAGES_NAMESPACE = 'foldnano-python-packages';
const PYTHON_ROOT = 'src/lib/plugin/python';
const PYTHON_PACKAGES = ['foldnano', 'foldnano_mini'];

/** Every `.py` file of the bundled packages, read when the worker is built, so a new module can't
 * be left out of the runtime by a forgotten import. */
function pythonPackages(packageDirs: string[], onRead: (files: string[]) => void): EsbuildPlugin {
	return {
		name: 'foldnano-python-packages',
		setup(b) {
			b.onResolve({ filter: new RegExp(`^${PYTHON_PACKAGES_ID}$`) }, () => ({
				path: PYTHON_PACKAGES_ID,
				namespace: PYTHON_PACKAGES_NAMESPACE,
			}));
			b.onLoad({ filter: /.*/, namespace: PYTHON_PACKAGES_NAMESPACE }, async () => {
				const sources: Record<string, string> = {};
				const read: string[] = [];
				for (const dir of packageDirs) {
					for (const file of (await readdir(dir)).filter((f) => f.endsWith('.py')).sort()) {
						const filePath = path.join(dir, file);
						sources[`${path.basename(dir)}/${file}`] = await readFile(filePath, 'utf8');
						read.push(filePath);
					}
				}
				onRead(read);
				return { contents: JSON.stringify(sources), loader: 'json' };
			});
		},
	};
}

/**
 * `import source from './x.worker.ts?sandbox-worker'` yields the worker bundled into one
 * self-contained ES module string. The plugin sandbox starts it as a module worker from a `data:`
 * URL inside an opaque-origin iframe (a `blob:` module worker fails silently there), so it
 * bypasses Vite's worker pipeline, identically in dev and build. See
 * docs/python-plugin-system.md § Sandbox.
 */
export function sandboxWorkerSource(): Plugin {
	let env: Record<string, unknown> = {};
	let minify = false;
	let packageDirs: string[] = [];

	return {
		name: 'foldnano:sandbox-worker-source',
		configResolved(config) {
			env = config.env;
			minify = config.command === 'build';
			packageDirs = PYTHON_PACKAGES.map((pkg) => path.resolve(config.root, PYTHON_ROOT, pkg));
		},
		configureServer(server) {
			// Edits re-bundle through the watch files; a module added or removed only shows up here.
			const onAddOrRemove = (file: string) => {
				if (!file.endsWith('.py') || !packageDirs.includes(path.dirname(file))) return;
				for (const mod of server.moduleGraph.idToModuleMap.values()) {
					if (mod.id?.endsWith(QUERY)) server.moduleGraph.invalidateModule(mod);
				}
				server.ws.send({ type: 'full-reload' });
			};
			server.watcher.add(packageDirs);
			server.watcher.on('add', onAddOrRemove);
			server.watcher.on('unlink', onAddOrRemove);
		},
		async load(id) {
			if (!id.endsWith(QUERY)) return null;
			let pythonFiles: string[] = [];
			const result = await build({
				entryPoints: [id.slice(0, -QUERY.length)],
				bundle: true,
				write: false,
				format: 'esm',
				target: 'es2022',
				minify,
				metafile: true,
				logLevel: 'silent',
				// A data: worker gets no Vite transform, so inline Vite's env object.
				define: { 'import.meta.env': JSON.stringify(env) },
				plugins: [pythonPackages(packageDirs, (files) => (pythonFiles = files))],
			});
			for (const file of pythonFiles) this.addWatchFile(file);
			for (const input of Object.keys(result.metafile.inputs)) {
				// Synthetic inputs such as <define:…>, and the virtual module (its files are above).
				if (input.startsWith('<') || input.startsWith(`${PYTHON_PACKAGES_NAMESPACE}:`)) continue;
				this.addWatchFile(path.resolve(input));
			}
			return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
		},
	};
}
