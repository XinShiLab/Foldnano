/**
 * Browser support: Foldnano is developed and tested in Chromium browsers and runs
 * noticeably slower elsewhere (Editor shows a dismissible notice).
 */

interface NavigatorUaData {
	brands?: ReadonlyArray<{ brand: string }>;
}

/**
 * True in Chromium-based browsers (Chrome, Edge, Brave, Arc, Opera). Only they expose
 * `navigator.userAgentData`; Firefox, Safari and every iOS browser (all WebKit) don't.
 */
export function isChromiumBrowser(nav: Navigator = navigator): boolean {
	const uaData = (nav as Navigator & { userAgentData?: NavigatorUaData }).userAgentData;
	return uaData?.brands?.some((b) => b.brand === 'Chromium') ?? false;
}
