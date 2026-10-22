const LLMS_TEXT_PATH =
	/^(?:\/docs(?:\/(guide|plugin-development|contributors))?)?\/llms?(-full)?\.txt\/?$/;

/**
 * Canonical path for a near-miss link to the AI text files (`/docs/llms.txt`, `/llm.txt`,
 * `/docs/guide/llm.txt`, …), or `null` when `pathname` is already canonical or unrelated.
 */
export function llmsTextRedirectPath(pathname: string): string | null {
	const match = LLMS_TEXT_PATH.exec(pathname);
	if (!match) return null;
	const [, category, full] = match;
	const target = category ? `/docs/${category}/llms.txt` : full ? '/llms-full.txt' : '/llms.txt';
	return target === pathname ? null : target;
}
