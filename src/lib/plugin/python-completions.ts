// Editor-agnostic Python completions for the plugin API, driven by the index that
// scripts/gen_python_api.py generates from the bundled `foldnano` / `foldnano_mini` packages.
// Type inference is deliberately shallow: annotations, `x = <chain>`, `for x in <chain>`.

import generatedIndex from './python-api-index.generated.json';

export interface PythonApiMember {
	name: string;
	kind: 'attribute' | 'property' | 'method';
	type?: string | null;
	settable?: boolean;
	signature?: string;
	returns?: string | null;
	doc?: string;
}

export interface PythonApiIndex {
	modules: Record<string, string[]>;
	functions: Record<
		string,
		{ module: string; signature: string; returns: string | null; doc: string }
	>;
	classes: Record<string, { module: string; doc: string; members: PythonApiMember[] }>;
}

export type PythonCompletionKind =
	'method' | 'property' | 'attribute' | 'class' | 'function' | 'module' | 'variable' | 'keyword';

export interface PythonCompletion {
	label: string;
	kind: PythonCompletionKind;
	detail?: string;
	doc?: string;
	/** Text to insert instead of `label`. */
	insert?: string;
	/** Caret offset within the inserted text, when it shouldn't land at the end. */
	caret?: number;
	boost?: number;
}

export interface PythonCompletionResult {
	from: number;
	options: PythonCompletion[];
}

export const PYTHON_API_INDEX = generatedIndex as PythonApiIndex;

const KEYWORDS = [
	'False',
	'None',
	'True',
	'and',
	'as',
	'assert',
	'break',
	'class',
	'continue',
	'def',
	'del',
	'elif',
	'else',
	'except',
	'finally',
	'for',
	'from',
	'if',
	'import',
	'in',
	'is',
	'lambda',
	'not',
	'or',
	'pass',
	'raise',
	'return',
	'try',
	'while',
	'with',
	'yield',
];

const BUILTINS = [
	'abs',
	'all',
	'any',
	'bool',
	'dict',
	'enumerate',
	'filter',
	'float',
	'getattr',
	'hasattr',
	'int',
	'isinstance',
	'len',
	'list',
	'map',
	'max',
	'min',
	'next',
	'print',
	'range',
	'reversed',
	'round',
	'set',
	'sorted',
	'str',
	'sum',
	'tuple',
	'zip',
];

/** Builtins whose result has the same element type as their (first) argument. */
const PASSTHROUGH_CALLS = new Set(['list', 'sorted', 'reversed', 'tuple', 'set', 'iter']);
const ITERABLE_TYPES = new Set([
	'list',
	'List',
	'set',
	'Set',
	'frozenset',
	'tuple',
	'Sequence',
	'Iterable',
	'Iterator',
]);
const IDENT = /[A-Za-z_]\w*/y;
const MAX_RESOLVE_DEPTH = 8;

interface PyType {
	cls: string;
	/** A list (or other iterable) of `cls`. */
	list: boolean;
}

type Step =
	| { kind: 'name'; name: string }
	| { kind: 'attr'; name: string }
	| { kind: 'call'; args: string }
	| { kind: 'index' };

interface Binding {
	pos: number;
	name: string;
	source: 'annotation' | 'expr' | 'iter';
	text: string;
}

export function completePython(
	before: string,
	options: { explicit?: boolean; documentText?: string; index?: PythonApiIndex } = {}
): PythonCompletionResult | null {
	const index = options.index ?? PYTHON_API_INDEX;
	const explicit = options.explicit ?? false;
	const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
	if (isInCommentOrString(before, lineBefore)) return null;

	const query = /[A-Za-z_]\w*$/.exec(lineBefore)?.[0] ?? '';
	const from = before.length - query.length;
	const analysis = new ScopeAnalysis(before, index);

	if (before[from - 1] === '.') {
		const exprStart = scanChainBackward(before, from - 1);
		const exprText = before.slice(exprStart, from - 1);
		if (!exprText || /^\d/.test(exprText)) return null;
		if (/^\s*(from|import)\s/.test(lineBefore)) return moduleCompletions(lineBefore, index, before);
		const type = analysis.evalExpression(exprText, before.length);
		if (type && !type.list) return { from, options: memberCompletions(type.cls, index) };
		return explicit ? { from, options: allMemberCompletions(index) } : null;
	}

	const fromImport = /^\s*from\s+([\w.]+)\s+import\s+(?:\(?[\w\s,]*,\s*|\(\s*)?\w*$/.exec(
		lineBefore
	);
	if (fromImport) {
		const names = index.modules[fromImport[1]];
		return names ? { from, options: names.map((n) => apiNameCompletion(n, index)) } : null;
	}
	if (/^\s*(from|import)\s+[\w.]*$/.test(lineBefore)) {
		return moduleCompletions(lineBefore, index, before);
	}
	if (/\b(def|class|as)\s+\w*$/.test(lineBefore)) return null;
	if (!query && !explicit) return null;

	return {
		from,
		options: scopeCompletions(analysis, index, options.documentText ?? before, query),
	};
}

function isInCommentOrString(before: string, lineBefore: string): boolean {
	if ((before.split('"""').length - 1) % 2 === 1) return true;
	if ((before.split("'''").length - 1) % 2 === 1) return true;
	let quote: string | null = null;
	for (let i = 0; i < lineBefore.length; i++) {
		const ch = lineBefore[i];
		if (quote) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === '#') {
			return true;
		}
	}
	return quote !== null;
}

/** Start of the attribute/call/index chain that ends at `end` (exclusive). */
function scanChainBackward(text: string, end: number): number {
	let i = end;
	while (i > 0) {
		const ch = text[i - 1];
		if (/\w/.test(ch) || ch === '.') {
			i--;
		} else if (ch === ')' || ch === ']') {
			const open = ch === ')' ? '(' : '[';
			let depth = 0;
			let j = i - 1;
			for (; j >= 0; j--) {
				if (text[j] === ch) depth++;
				else if (text[j] === open && --depth === 0) break;
			}
			if (j < 0) return i;
			i = j;
		} else {
			break;
		}
	}
	return i;
}

/** Parses a leading `name(.attr | (args) | [i])*` chain; an unclosed bracket ends it as a call/index. */
function parseChain(text: string, start = 0): { steps: Step[]; end: number } {
	const steps: Step[] = [];
	let i = skipSpaces(text, start);
	IDENT.lastIndex = i;
	const head = IDENT.exec(text);
	if (!head) return { steps, end: i };
	steps.push({ kind: 'name', name: head[0] });
	i = IDENT.lastIndex;
	for (;;) {
		const ch = text[i];
		if (ch === '.') {
			IDENT.lastIndex = i + 1;
			const attr = IDENT.exec(text);
			if (!attr) break;
			steps.push({ kind: 'attr', name: attr[0] });
			i = IDENT.lastIndex;
		} else if (ch === '(' || ch === '[') {
			const close = matchBracket(text, i);
			const inner = text.slice(i + 1, close === -1 ? text.length : close);
			steps.push(ch === '(' ? { kind: 'call', args: inner } : { kind: 'index' });
			if (close === -1) return { steps, end: text.length };
			i = close + 1;
		} else {
			break;
		}
	}
	return { steps, end: i };
}

function skipSpaces(text: string, i: number): number {
	while (i < text.length && /\s/.test(text[i])) i++;
	return i;
}

function matchBracket(text: string, openAt: number): number {
	const open = text[openAt];
	const close = open === '(' ? ')' : ']';
	let depth = 0;
	for (let j = openAt; j < text.length; j++) {
		if (text[j] === open) depth++;
		else if (text[j] === close && --depth === 0) return j;
	}
	return -1;
}

/** Splits on `sep` at bracket depth 0. */
function splitTopLevel(text: string, sep: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let last = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '[' || ch === '(') depth++;
		else if (ch === ']' || ch === ')') depth--;
		else if (ch === sep && depth === 0) {
			parts.push(text.slice(last, i));
			last = i + 1;
		}
	}
	parts.push(text.slice(last));
	return parts.map((p) => p.trim());
}

export function parseTypeAnnotation(text: string, index: PythonApiIndex): PyType | null {
	const optional = /^Optional\[(.+)\]$/.exec(text.trim());
	if (optional) return parseTypeAnnotation(optional[1], index);
	const union = splitTopLevel(text.replace(/['"]/g, ''), '|').filter((p) => p !== 'None');
	if (union.length > 1) {
		for (const part of union) {
			const parsed = parseTypeAnnotation(part, index);
			if (parsed) return parsed;
		}
		return null;
	}
	const t = union[0] ?? '';
	const generic = /^([\w.]+)\[(.+)\]$/.exec(t);
	if (generic) {
		const base = generic[1].split('.').pop() ?? '';
		if (!ITERABLE_TYPES.has(base)) return null;
		const elem = parseTypeAnnotation(splitTopLevel(generic[2], ',')[0], index);
		return elem && !elem.list ? { cls: elem.cls, list: true } : null;
	}
	return t in index.classes ? { cls: t, list: false } : null;
}

class ScopeAnalysis {
	readonly bindings: Binding[] = [];

	constructor(
		private readonly _text: string,
		private readonly _index: PythonApiIndex
	) {
		this._collect();
	}

	private _collect(): void {
		const text = this._text;
		for (const def of text.matchAll(/\bdef\s+\w+\s*\(([^)]*)\)/g)) {
			const paramsAt = (def.index ?? 0) + def[0].indexOf('(') + 1;
			for (const param of def[1].matchAll(/([A-Za-z_]\w*)\s*:\s*([^,=)]+)/g)) {
				this.bindings.push({
					pos: paramsAt + (param.index ?? 0),
					name: param[1],
					source: 'annotation',
					text: param[2],
				});
			}
		}
		for (const m of text.matchAll(
			/^[ \t]*([A-Za-z_]\w*)\s*(?::\s*([^=\n]+?))?\s*=(?!=)\s*(.*)$/gm
		)) {
			const pos = m.index ?? 0;
			if (m[2]) this.bindings.push({ pos, name: m[1], source: 'annotation', text: m[2] });
			else {
				const rhsAt = pos + m[0].length - m[3].length;
				this.bindings.push({ pos, name: m[1], source: 'expr', text: text.slice(rhsAt) });
			}
		}
		for (const m of text.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\s+/g)) {
			const at = (m.index ?? 0) + m[0].length;
			this.bindings.push({ pos: m.index ?? 0, name: m[1], source: 'iter', text: text.slice(at) });
		}
		this.bindings.sort((a, b) => a.pos - b.pos);
	}

	/** Names bound before `pos`, last binding first. */
	visibleNames(pos: number): Map<string, Binding> {
		const out = new Map<string, Binding>();
		for (const b of this.bindings) if (b.pos < pos) out.set(b.name, b);
		return out;
	}

	evalExpression(text: string, pos: number, depth = 0): PyType | null {
		if (depth > MAX_RESOLVE_DEPTH) return null;
		const { steps } = parseChain(text);
		return this._evalSteps(steps, pos, depth);
	}

	resolveName(name: string, pos: number, depth: number): PyType | null {
		const binding = this.visibleNames(pos).get(name);
		if (!binding) return name === 'ctx' ? { cls: 'PluginContext', list: false } : null;
		if (binding.source === 'annotation') return parseTypeAnnotation(binding.text, this._index);
		const type = this.evalExpression(binding.text, binding.pos, depth + 1);
		if (binding.source === 'expr') return type;
		return type?.list ? { cls: type.cls, list: false } : null;
	}

	private _evalSteps(steps: Step[], pos: number, depth: number): PyType | null {
		const [head, ...rest] = steps;
		if (head?.kind !== 'name') return null;
		const index = this._index;
		let type: PyType | null;
		let i = 0;

		const call = rest[0]?.kind === 'call' ? rest[0] : null;
		if (call && PASSTHROUGH_CALLS.has(head.name)) {
			type = this.evalExpression(call.args, pos, depth + 1);
			i = 1;
		} else if (call && head.name === 'next') {
			const gen = /^\s*\(?\s*([A-Za-z_]\w*)\s+for\s+([A-Za-z_]\w*)\s+in\s+/.exec(call.args);
			const iterable =
				gen && gen[1] === gen[2]
					? this.evalExpression(call.args.slice(gen[0].length), pos, depth + 1)
					: this.evalExpression(call.args.replace(/^\s*iter\(/, ''), pos, depth + 1);
			type = iterable?.list ? { cls: iterable.cls, list: false } : null;
			i = 1;
		} else if (call && head.name in index.functions) {
			const returns = index.functions[head.name].returns;
			type = returns ? parseTypeAnnotation(returns, index) : null;
			i = 1;
		} else if (head.name in index.classes && !this.visibleNames(pos).has(head.name)) {
			type = { cls: head.name, list: false };
			if (call) i = 1;
		} else {
			type = this.resolveName(head.name, pos, depth);
		}

		for (; i < rest.length && type; i++) {
			const step = rest[i];
			if (step.kind === 'index') {
				type = type.list ? { cls: type.cls, list: false } : null;
			} else if (step.kind === 'attr' && !type.list) {
				const member = index.classes[type.cls]?.members.find((m) => m.name === step.name);
				if (!member) return null;
				if (member.kind === 'method') {
					if (rest[i + 1]?.kind !== 'call') return null;
					i++;
					type = member.returns ? parseTypeAnnotation(member.returns, index) : null;
				} else {
					type = member.type ? parseTypeAnnotation(member.type, index) : null;
				}
			} else {
				return null;
			}
		}
		return type;
	}
}

function memberCompletion(member: PythonApiMember, owner: string): PythonCompletion {
	if (member.kind === 'method') {
		const signature = member.signature ?? '()';
		const insert = `${member.name}()`;
		return {
			label: member.name,
			kind: 'method',
			detail: member.returns ? `${signature} -> ${member.returns}` : signature,
			doc: member.doc,
			insert,
			caret: signature === '()' ? insert.length : insert.length - 1,
		};
	}
	const type = member.type ?? 'Any';
	return {
		label: member.name,
		kind: member.kind,
		detail: member.settable ? `${type} (settable)` : type,
		doc: member.doc ?? `${owner}.${member.name}`,
	};
}

function memberCompletions(cls: string, index: PythonApiIndex): PythonCompletion[] {
	return (index.classes[cls]?.members ?? []).map((m) => memberCompletion(m, cls));
}

/** Unresolved receiver + Ctrl+Space: every API member, so the name can still be found. */
function allMemberCompletions(index: PythonApiIndex): PythonCompletion[] {
	const seen = new Map<string, PythonCompletion>();
	for (const [cls, info] of Object.entries(index.classes)) {
		for (const member of info.members) {
			if (seen.has(member.name)) continue;
			const option = memberCompletion(member, cls);
			seen.set(member.name, { ...option, detail: `${cls} · ${option.detail ?? ''}`, boost: -1 });
		}
	}
	return [...seen.values()];
}

function apiNameCompletion(name: string, index: PythonApiIndex): PythonCompletion {
	const fn = index.functions[name];
	if (fn) {
		const insert = `${name}()`;
		return {
			label: name,
			kind: 'function',
			detail: fn.returns ? `${fn.signature} -> ${fn.returns}` : fn.signature,
			doc: fn.doc,
			insert,
			caret: fn.signature === '()' ? insert.length : insert.length - 1,
		};
	}
	const cls = index.classes[name];
	if (cls) return { label: name, kind: 'class', detail: cls.module, doc: cls.doc || undefined };
	return { label: name, kind: 'variable' };
}

function moduleCompletions(
	lineBefore: string,
	index: PythonApiIndex,
	before: string
): PythonCompletionResult {
	const dotted = /[\w.]*$/.exec(lineBefore)?.[0] ?? '';
	return {
		from: before.length - dotted.length,
		options: Object.keys(index.modules).map((m) => ({ label: m, kind: 'module' })),
	};
}

function scopeCompletions(
	analysis: ScopeAnalysis,
	index: PythonApiIndex,
	documentText: string,
	query: string
): PythonCompletion[] {
	const options = new Map<string, PythonCompletion>();
	const add = (option: PythonCompletion) => {
		if (option.label !== query && !options.has(option.label)) options.set(option.label, option);
	};

	const pos = Number.MAX_SAFE_INTEGER;
	for (const name of analysis.visibleNames(pos).keys()) {
		const type = analysis.resolveName(name, pos, 0);
		add({
			label: name,
			kind: 'variable',
			detail: type ? (type.list ? `list[${type.cls}]` : type.cls) : undefined,
			boost: 1,
		});
	}
	const importable = [index.modules.foldnano_mini, index.modules['foldnano.plugin']].flat();
	for (const name of importable) add({ ...apiNameCompletion(name, index) });
	for (const word of KEYWORDS) add({ label: word, kind: 'keyword', boost: -1 });
	for (const word of BUILTINS) add({ label: word, kind: 'function', detail: 'builtin', boost: -1 });
	for (const [word] of documentText.matchAll(/\b[A-Za-z_]\w{2,}\b/g)) {
		add({ label: word, kind: 'variable', boost: -2 });
	}
	return [...options.values()];
}
