/** Worker source bundled as a classic-script string by scripts/vite-sandbox-worker.ts. */
declare module '*?sandbox-worker' {
	const source: string;
	export default source;
}

/** Every `.py` file of the bundled Python packages, keyed `'<package>/<module>.py'`. */
declare module 'virtual:foldnano-python-packages' {
	const files: Record<string, string>;
	export default files;
}
