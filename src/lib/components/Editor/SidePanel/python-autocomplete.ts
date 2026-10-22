import type { PrismEditor } from 'prism-code-editor';
import {
	autoComplete,
	fuzzyFilter,
	registerCompletions,
	type Completion,
	type CompletionSource,
} from 'prism-code-editor/autocomplete';
import { addTooltip } from 'prism-code-editor/tooltips';
import autocompleteCss from 'prism-code-editor/autocomplete.css?raw';
import autocompleteIconsCss from 'prism-code-editor/autocomplete-icons.css?raw';
import {
	completePython,
	signatureHelpPython,
	type PythonCompletionKind,
	type PythonSignatureHelp,
} from '$lib/plugin/python-completions';

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

// The extension pins the list to an inline `width: min(25em, …)`, which truncates long method
// names; widen it against the editor's own width (the container is made a size container).
const EXTRA_CSS = `
.prism-code-editor { container-type: inline-size; }
.pce-ac-tooltip { width: min(42em, 100cqw - var(--padding-left, 0px) - 1em) !important; }
.pce-ac-label { flex-shrink: 0; max-width: 100%; }
.pce-sig-help {
	position: sticky;
	left: .5em;
	right: .5em;
	pointer-events: auto;
	max-width: min(42em, 100cqw - var(--padding-left, 0px) - 1em);
	box-sizing: border-box;
	padding: .2em .45em;
	border: 1px solid var(--pce-widget-border);
	border-radius: .2em;
	background: var(--pce-widget-bg);
	white-space: pre-wrap;
	word-break: break-word;
}
.pce-sig-help b { color: var(--pce-ac-match, #52b1ff); }
.pce-sig-help .pce-sig-doc { opacity: .75; margin-top: .15em; }
`;

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
	addSignatureHelp(editor);
	// basicEditor renders into a shadow root, so page stylesheets never reach the popup.
	if (shadowRoot) {
		const style = document.createElement('style');
		style.textContent = autocompleteCss + autocompleteIconsCss + EXTRA_CSS;
		shadowRoot.append(style);
	}
}

/** Shows the enclosing call's signature, active argument highlighted, while the caret is inside `(…)`. */
function addSignatureHelp(editor: PrismEditor): void {
	const element = editor.container.ownerDocument.createElement('div');
	element.className = 'pce-sig-help';
	const [show, hide] = addTooltip(editor, element, false);
	let dismissedAt: number | null = null;

	const update = () => {
		const [start, end] = editor.getSelection();
		const help =
			start === end && editor.focused ? signatureHelpPython(editor.value.slice(0, start)) : null;
		if (!help) {
			hide();
			return;
		}
		const key = editor.value.lastIndexOf('(', start);
		if (dismissedAt === key) return;
		dismissedAt = null;
		renderSignature(element, help);
		show(true);
	};

	editor.on('selectionChange', update);
	editor.textarea.addEventListener('blur', hide);
	editor.textarea.addEventListener('focus', update);
	editor.textarea.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape' || !element.isConnected) return;
		dismissedAt = editor.value.lastIndexOf('(', editor.getSelection()[0]);
		hide();
	});
}

function renderSignature(element: HTMLElement, help: PythonSignatureHelp): void {
	const doc = element.ownerDocument;
	const head = doc.createElement('div');
	head.append(`${help.label}(`);
	help.params.forEach((param, i) => {
		if (i > 0) head.append(', ');
		if (i === help.activeParam) {
			const bold = doc.createElement('b');
			bold.textContent = param;
			head.append(bold);
		} else {
			head.append(param);
		}
	});
	head.append(help.returns ? `) -> ${help.returns}` : ')');
	element.replaceChildren(head);
	if (help.doc) {
		const docEl = doc.createElement('div');
		docEl.className = 'pce-sig-doc';
		docEl.textContent = help.doc;
		element.append(docEl);
	}
}
