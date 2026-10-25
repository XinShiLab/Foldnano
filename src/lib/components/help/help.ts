import type { Attachment } from 'svelte/attachments';
import { SvelteMap } from 'svelte/reactivity';

import type { Rect } from './helpLayout';

// Slugs of `src/content/guide/*.md` (their `slug:` front matter).
export type GuideSlug =
	| 'getting-started'
	| 'mental-model'
	| 'creating-a-design'
	| 'editing-tools'
	| 'views'
	| 'selection'
	| 'duplicates-repeat-groups'
	| 'simulation-export'
	| '3d-overlays'
	| 'oligo-report'
	| 'saving-github'
	| 'plugins-for-users'
	| 'script-lab'
	| 'interface-reference'
	| 'keyboard-shortcuts';

export interface HelpSpec {
	/** Keyboard shortcut, shown as a badge on the element while help is open. */
	key?: string;
	/** Falls back to the element's `title` / `aria-label` when omitted. */
	title?: string;
	/** One or two sentences. Longer explanations belong in the docs guide. */
	text?: string;
	/** Guide page, rendered as a "Learn more" link. */
	doc?: GuideSlug;
	/** Panes and panels get a pinned caption instead of a hover card. */
	area?: boolean;
	/** Where an area caption sits relative to the area; `inside` (top-left corner) by default. */
	placement?: 'inside' | 'left' | 'right' | 'above' | 'below';
	/** Marks behavior that differs from cadnano, so migrating users notice it. */
	newVsCadnano?: boolean;
}

// Module-level so attachments can register without component context (attachments run after
// init, where getContext is unavailable). HelpLayer filters entries to its own root element.
export const helpRegistry = new SvelteMap<HTMLElement, HelpSpec>();

/**
 * Registers the element as a help target for the `?` workspace help. Registration only; the
 * editor's HelpLayer does all rendering, so this is cheap to leave on every control.
 */
export function help(spec: HelpSpec): Attachment<HTMLElement> {
	return (element) => {
		helpRegistry.set(element, spec);
		return () => {
			if (helpRegistry.get(element) === spec) helpRegistry.delete(element);
		};
	};
}

/** A spot on a canvas (Konva, Three.js) that has no DOM element to attach `help()` to. */
export interface CanvasHelpAnchor {
	/** The canvas host element; decides the help root and clips the anchor. */
	readonly host: HTMLElement;
	/**
	 * Viewport box of the canvas object, or null when it is not drawn. Called every frame while
	 * help is open, so it must not walk the design.
	 */
	getRect(): Rect | null;
}

/** Canvas notes are pinned captions, so the title is required (there is no element to name it). */
export type CanvasHelpSpec = Omit<HelpSpec, 'key' | 'area'> & { title: string };

// The overlay shows at most this many canvas notes, however many anchors register.
export const MAX_CANVAS_HELP_NOTES = 4;

export const canvasHelpRegistry = new SvelteMap<CanvasHelpAnchor, CanvasHelpSpec>();

/** Registers canvas anchors; returns the unregister function. Register only while help is open. */
export function registerCanvasHelp(
	entries: readonly [CanvasHelpAnchor, CanvasHelpSpec][]
): () => void {
	for (const [anchor, spec] of entries) canvasHelpRegistry.set(anchor, spec);
	return () => {
		for (const [anchor] of entries) canvasHelpRegistry.delete(anchor);
	};
}

export function resolveHelpTitle(element: HTMLElement, spec: HelpSpec): string | undefined {
	return (
		spec.title ?? element.getAttribute('title') ?? element.getAttribute('aria-label') ?? undefined
	);
}
