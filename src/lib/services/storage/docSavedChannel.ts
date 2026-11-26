/** BroadcastChannel name on which every local save of a design is announced to the other tabs. */
export const DOC_SAVED_CHANNEL = 'foldnano-doc-saved';

export interface DocSavedMessage {
	docId: string;
}

/** Tells the other tabs (and this tab's listeners) that `docId` was just written. */
export function announceDocSaved(docId: string): void {
	if (typeof BroadcastChannel === 'undefined') return;
	const channel = new BroadcastChannel(DOC_SAVED_CHANNEL);
	try {
		channel.postMessage({ docId } satisfies DocSavedMessage);
	} finally {
		channel.close();
	}
}
