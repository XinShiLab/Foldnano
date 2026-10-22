/**
 * Lets prism-code-editor instances work inside other same-origin windows (the pop-outs).
 *
 * prism-code-editor binds to the module-level `document`: edits go through `document.execCommand`
 * and cursor tracking listens for `selectionchange` on it. Neither reaches an editor living in a
 * popup's document, so typing, auto-indent and bracket/selection highlights would silently break.
 * Several pop-outs can be open at once, so bridged documents are counted and `execCommand` goes to
 * whichever one has focus. Returns a cleanup that releases this bridge.
 */

interface BridgedDocument {
	count: number;
	forwardSelectionChange: () => void;
}

const bridged = new Map<Document, BridgedDocument>();

export function bridgeForeignDocument(target: Document): () => void {
	if (target === document) return () => {};

	let entry = bridged.get(target);
	if (!entry) {
		const forwardSelectionChange = (): void => {
			document.dispatchEvent(new Event('selectionchange'));
		};
		target.addEventListener('selectionchange', forwardSelectionChange);
		entry = { count: 0, forwardSelectionChange };
		bridged.set(target, entry);
		if (bridged.size === 1) routeExecCommand();
	}
	const own = entry;
	own.count++;

	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--own.count > 0) return;
		target.removeEventListener('selectionchange', own.forwardSelectionChange);
		bridged.delete(target);
		// Drops the own property so `document.execCommand` resolves to the prototype again.
		if (bridged.size === 0) Reflect.deleteProperty(document, 'execCommand');
	};
}

function routeExecCommand(): void {
	const nativeExecCommand = Document.prototype.execCommand;
	Object.defineProperty(document, 'execCommand', {
		configurable: true,
		writable: true,
		value: (...args: Parameters<Document['execCommand']>): boolean => {
			for (const target of bridged.keys()) {
				if (target.hasFocus()) return target.execCommand(...args);
			}
			return nativeExecCommand.apply(document, args);
		},
	});
}
