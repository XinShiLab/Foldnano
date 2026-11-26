import { pushState, replaceState } from '$app/navigation';
import { resolve } from '$app/paths';
import type { EditorDocumentSession } from './context/EditorDocumentSession.svelte';

/**
 * Saves the open design and starts an empty one at /editor. Shallow-routed so the editor (and its
 * plugin worker) isn't remounted; Editor.svelte moves the URL to /editor/<id> once the blank
 * document is first saved.
 */
export async function openBlankDocument(session: EditorDocumentSession): Promise<void> {
	await session.startBlankDocument();
	const editorPath = resolve('/editor');
	if (window.location.pathname === editorPath) replaceState(editorPath, {});
	else pushState(editorPath, {});
}
