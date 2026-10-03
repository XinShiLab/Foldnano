import { execSync } from 'node:child_process';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import packageJson from './package.json';
import { thirdPartyLicenses } from './scripts/vite-third-party-licenses';
import { sandboxWorkerSource } from './scripts/vite-sandbox-worker';
import { selfHostedPyodide } from './scripts/vite-pyodide';

const licenses = thirdPartyLicenses();

function getCommitHash(): string {
	try {
		return execSync('git rev-parse --short HEAD').toString().trim();
	} catch {
		return 'unknown';
	}
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		devtoolsJson(),
		sandboxWorkerSource(),
		selfHostedPyodide(),
		licenses.client,
		licenses.devNotice,
	],
	worker: {
		plugins: () => [licenses.worker()],
	},
	define: {
		__APP_VERSION__: JSON.stringify(packageJson.version),
		__COMMIT_HASH__: JSON.stringify(getCommitHash()),
		// Preview deployments sit behind Vercel Deployment Protection, which the cookieless
		// plugin sandbox can't pass; they load Pyodide from the CDN (pyodideConfig.ts).
		__PYODIDE_SELF_HOSTED__: JSON.stringify(process.env.VERCEL_ENV !== 'preview'),
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			// {
			// 	extends: './vite.config.ts',
			// 	test: {
			// 		name: 'client',
			// 		environment: 'browser',
			// 		browser: {
			// 			enabled: true,
			// 			provider: 'playwright',
			// 			instances: [{ browser: 'chromium' }]
			// 		},
			// 		include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
			// 		exclude: ['src/lib/server/**'],
			// 		setupFiles: ['./vitest-setup-client.ts']
			// 	}
			// },
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'jsdom',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
				},
			},
		],
	},
});
