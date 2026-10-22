import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeForeignDocument } from './prism-foreign-document';

function makePopupDocument(focused: boolean): Document {
	const doc = document.implementation.createHTMLDocument('popup');
	doc.hasFocus = () => focused;
	doc.execCommand = vi.fn(() => true);
	return doc;
}

describe('bridgeForeignDocument', () => {
	afterEach(() => {
		Reflect.deleteProperty(document, 'execCommand');
	});

	it('is a no-op for the main document', () => {
		const release = bridgeForeignDocument(document);
		expect(Object.prototype.hasOwnProperty.call(document, 'execCommand')).toBe(false);
		release();
	});

	it('routes execCommand to whichever of several pop-outs has focus', () => {
		const first = makePopupDocument(false);
		const second = makePopupDocument(true);
		const releaseFirst = bridgeForeignDocument(first);
		const releaseSecond = bridgeForeignDocument(second);

		document.execCommand('insertText', false, 'x');
		expect(second.execCommand).toHaveBeenCalledWith('insertText', false, 'x');
		expect(first.execCommand).not.toHaveBeenCalled();

		first.hasFocus = () => true;
		second.hasFocus = () => false;
		releaseSecond();
		document.execCommand('insertText', false, 'y');
		expect(first.execCommand).toHaveBeenCalledWith('insertText', false, 'y');

		releaseFirst();
		expect(Object.prototype.hasOwnProperty.call(document, 'execCommand')).toBe(false);
	});

	it('keeps the bridge until every editor in a pop-out has released it', () => {
		const popup = makePopupDocument(true);
		const releaseA = bridgeForeignDocument(popup);
		const releaseB = bridgeForeignDocument(popup);
		releaseA();
		releaseA();
		document.execCommand('insertText', false, 'z');
		expect(popup.execCommand).toHaveBeenCalledTimes(1);
		releaseB();
		expect(Object.prototype.hasOwnProperty.call(document, 'execCommand')).toBe(false);
	});

	it('forwards selectionchange from a pop-out to the main document', () => {
		const popup = makePopupDocument(true);
		const listener = vi.fn();
		document.addEventListener('selectionchange', listener);
		const release = bridgeForeignDocument(popup);
		popup.dispatchEvent(new Event('selectionchange'));
		expect(listener).toHaveBeenCalledTimes(1);
		release();
		popup.dispatchEvent(new Event('selectionchange'));
		expect(listener).toHaveBeenCalledTimes(1);
		document.removeEventListener('selectionchange', listener);
	});
});
