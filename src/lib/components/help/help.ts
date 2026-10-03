import type { Attachment } from 'svelte/attachments';
import { SvelteMap } from 'svelte/reactivity';

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

export function resolveHelpTitle(element: HTMLElement, spec: HelpSpec): string | undefined {
	return (
		spec.title ?? element.getAttribute('title') ?? element.getAttribute('aria-label') ?? undefined
	);
}
