import { isLoggedThisSession, reportError } from './errorReporting';

/** New (not repeated) uncaught errors logged per minute; the rest stay in the console only. */
export const MAX_NEW_UNCAUGHT_ERRORS_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;

export type UncaughtErrorSource = 'uncaught' | 'unhandled-rejection' | 'sveltekit';

const NOISE_MESSAGES = [
	// Benign layout notice browsers raise as an error event.
	/^ResizeObserver loop/,
	// A cross-origin script failed; the browser hides everything else, so there is nothing to report.
	/^Script error\.?$/,
];
const EXTENSION_URL = /^(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//;
const URL_IN_STACK = /[a-z][\w+.-]*:\/\/[^\s)]+/gi;

const recentNewErrors: number[] = [];

/** Errors that are not Foldnano bugs: browser notices, cancellations, extension code. */
export function isBrowserNoise(err: unknown, filename?: string): boolean {
	if (err instanceof Error && err.name === 'AbortError') return true;
	const message = err instanceof Error ? err.message : String(err ?? '');
	if (NOISE_MESSAGES.some((re) => re.test(message))) return true;
	// Judged by where it was thrown: an extension wrapping our code still leaves our frame on top.
	const stack = err instanceof Error ? (err.stack ?? '') : '';
	const throwSite = stack.match(URL_IN_STACK)?.[0] ?? filename;
	return !!throwSite && EXTENSION_URL.test(throwSite);
}

function takeRateSlot(now: number): boolean {
	while (recentNewErrors.length > 0 && now - recentNewErrors[0] >= RATE_WINDOW_MS) {
		recentNewErrors.shift();
	}
	if (recentNewErrors.length >= MAX_NEW_UNCAUGHT_ERRORS_PER_MINUTE) return false;
	recentNewErrors.push(now);
	return true;
}

/**
 * Logs an error nothing else caught. Repeats merge into the first entry without a new toast;
 * noise is ignored, and past the rate limit new errors are left to the console (where the
 * browser already printed them).
 */
export function reportUncaughtError(
	err: unknown,
	source: UncaughtErrorSource,
	filename?: string
): void {
	if (isBrowserNoise(err, filename)) return;
	const repeat = isLoggedThisSession(err, source);
	if (!repeat && !takeRateSlot(Date.now())) return;
	reportError(err, source, { notify: !repeat, console: false });
}

/** Listens for uncaught errors and unhandled rejections; returns a function that stops it. */
export function installGlobalErrorCapture(target: Window = window): () => void {
	const onError = (event: ErrorEvent) => {
		reportUncaughtError(event.error ?? event.message, 'uncaught', event.filename);
	};
	const onRejection = (event: PromiseRejectionEvent) => {
		reportUncaughtError(event.reason, 'unhandled-rejection');
	};
	target.addEventListener('error', onError);
	target.addEventListener('unhandledrejection', onRejection);
	return () => {
		target.removeEventListener('error', onError);
		target.removeEventListener('unhandledrejection', onRejection);
	};
}
