// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	const __APP_VERSION__: string;
	const __COMMIT_HASH__: string;
	/** False on Vercel preview builds, whose Deployment Protection hides the self-hosted Pyodide. */
	const __PYODIDE_SELF_HOSTED__: boolean;

	namespace App {
		// interface Error {}
		interface Locals {
			githubToken?: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

declare module '*.md' {
	import type { Component } from 'svelte';
	const component: Component;
	export const metadata: Record<string, unknown>;
	export default component;
}
