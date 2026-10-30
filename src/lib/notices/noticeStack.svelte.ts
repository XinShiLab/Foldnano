import type { Snippet } from 'svelte';

/**
 * Cards a page hands to the bottom-right notice stack in the root layout, so the layout renders
 * them without importing page state. The page sets and clears its own entry.
 */
class NoticeStackState {
	announcement = $state<Snippet | null>(null);
}

export const noticeStack = new NoticeStackState();
