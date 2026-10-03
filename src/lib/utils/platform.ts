export function isMacPlatform(): boolean {
	return navigator.platform.toUpperCase().includes('MAC');
}

/** Cmd on Mac, Ctrl elsewhere — the modifier used for undo/redo etc. */
export function modKeySymbol(): string {
	return isMacPlatform() ? '⌘' : 'Ctrl';
}

/** Option on Mac, Alt elsewhere — the temporary-pan modifier. Reported as `e.key === 'Alt'` on both platforms. */
export function panKeySymbol(): string {
	return isMacPlatform() ? '⌥' : 'Alt';
}
