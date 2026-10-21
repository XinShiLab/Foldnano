/**
 * Lets a prism-code-editor instance work inside another same-origin window (the pop-out).
 *
 * prism-code-editor binds to the module-level `document`: edits go through `document.execCommand`
 * and cursor tracking listens for `selectionchange` on it. Neither reaches an editor living in a
 * popup's document, so typing, auto-indent and bracket/selection highlights would silently break.
 * Returns a cleanup that removes the bridge.
 */
export function bridgeForeignDocument(target: Document): () => void {
	if (target === document) return () => {};

	const forwardSelectionChange = (): void => {
		document.dispatchEvent(new Event('selectionchange'));
	};
	target.addEventListener('selectionchange', forwardSelectionChange);

	const nativeExecCommand = Document.prototype.execCommand;
	Object.defineProperty(document, 'execCommand', {
		configurable: true,
		writable: true,
		value: (...args: Parameters<Document['execCommand']>): boolean =>
			target.hasFocus() ? target.execCommand(...args) : nativeExecCommand.apply(document, args),
	});

	return () => {
		target.removeEventListener('selectionchange', forwardSelectionChange);
		// Drops the own property so `document.execCommand` resolves to the prototype again.
		Reflect.deleteProperty(document, 'execCommand');
	};
}
