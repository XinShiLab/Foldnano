import type { PrismEditor } from 'prism-code-editor';
import {
	autoComplete,
	fuzzyFilter,
	registerCompletions,
	type Completion,
	type CompletionSource,
} from 'prism-code-editor/autocomplete';
import autocompleteCss from 'prism-code-editor/autocomplete.css?raw';
import autocompleteIconsCss from 'prism-code-editor/autocomplete-icons.css?raw';
import { completePython, type PythonCompletionKind } from '$lib/plugin/python-completions';

const ICONS: Record<PythonCompletionKind, Completion['icon']> = {
	method: 'function',
	function: 'function',
	property: 'property',
	attribute: 'property',
	class: 'class',
	module: 'namespace',
	variable: 'variable',
	keyword: 'keyword',
};

const pythonApiSource: CompletionSource = (context, editor) => {
	const result = completePython(context.before, {
		explicit: context.explicit,
		documentText: editor.value,
	});
	if (!result) return null;
	return {
		from: result.from,
		options: result.options.map((option) => ({
			label: option.label,
			detail: option.detail,
			boost: option.boost,
			icon: ICONS[option.kind],
			insert: option.insert,
			tabStops: option.caret === undefined ? undefined : [option.caret],
			renderDocs: option.doc ? () => [option.doc ?? ''] : undefined,
		})),
	};
};

let registered = false;

/** Adds `foldnano` / `foldnano_mini` API completions to a `basicEditor` (which supplies `cursorPosition`). */
export function addPythonAutocomplete(editor: PrismEditor, shadowRoot: ShadowRoot | null): void {
	if (!registered) {
		registerCompletions(['python'], { sources: [pythonApiSource] });
		registered = true;
	}
	editor.addExtensions(autoComplete({ filter: fuzzyFilter }));
	// basicEditor renders into a shadow root, so page stylesheets never reach the popup.
	if (shadowRoot) {
		const style = document.createElement('style');
		style.textContent = autocompleteCss + autocompleteIconsCss;
		shadowRoot.append(style);
	}
}
