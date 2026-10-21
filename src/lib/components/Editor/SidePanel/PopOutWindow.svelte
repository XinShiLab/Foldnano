<script lang="ts">
	import { getAllContexts, mount, unmount, untrack } from 'svelte';
	import type { Snippet } from 'svelte';
	import PopOutWindowContent from './PopOutWindowContent.svelte';

	interface Props {
		/** Window name; reopening with the same name reuses the existing window. */
		name: string;
		title: string;
		width?: number;
		height?: number;
		children: Snippet;
		/** The user closed the window (not called when this component closes it). */
		onClose: () => void;
		/** The browser refused to open the window, usually a pop-up blocker. */
		onBlocked?: () => void;
	}

	let { name, title, width = 760, height = 860, children, onClose, onBlocked }: Props = $props();

	// The popup shares this realm, so the snippet keeps its reactivity and contexts over there.
	const context = getAllContexts();
	let popup = $state.raw<Window | null>(null);

	export function focus(): void {
		popup?.focus();
	}

	$effect(() => {
		if (popup) popup.document.title = title;
	});

	$effect(() => {
		return untrack(() => {
			const win = window.open('', name, `popup,width=${width},height=${height}`);
			if (!win) {
				onBlocked?.();
				return;
			}
			const doc = win.document;
			// The popup's about:blank has no doctype, so it renders in quirks mode (which stretches the
			// editor's lines). Rewriting it also clears content left by an earlier same-named opener.
			doc.open();
			doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
			doc.close();
			const base = doc.createElement('base');
			base.href = document.baseURI;
			doc.head.append(base);
			doc.title = title;
			const stopMirroring = mirrorPageStyles(document, doc);
			// Created by the opener: popup-realm nodes fail `instanceof` checks in this realm
			// (bits-ui rejects them as portal targets).
			const root = document.createElement('div');
			doc.body.append(root);
			const content = mount(PopOutWindowContent, {
				target: root,
				props: { children, portalTarget: root },
				context,
			});

			let finished = false;
			const finish = (): void => {
				finished = true;
				clearInterval(closedPoll);
				win.removeEventListener('pagehide', handleUserClose);
				window.removeEventListener('pagehide', closeWithOpener);
				void unmount(content);
				stopMirroring();
				popup = null;
			};
			const handleUserClose = (): void => {
				if (finished) return;
				finish();
				onClose();
			};
			const closeWithOpener = (): void => win.close();
			win.addEventListener('pagehide', handleUserClose);
			// `pagehide` is not guaranteed for every way a popup can go away.
			const closedPoll = setInterval(() => win.closed && handleUserClose(), 500);
			window.addEventListener('pagehide', closeWithOpener);

			popup = win;
			win.focus();

			return () => {
				if (finished) return;
				finish();
				win.close();
			};
		});
	});

	const STYLE_SELECTOR = 'style, link[rel="stylesheet"]';

	/** Keeps the popup's stylesheets and `<html>` attributes (theme class) in step with the opener. */
	function mirrorPageStyles(source: Document, target: Document): () => void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- DOM bookkeeping, never rendered
		const clones = new Map<Element, Element>();

		const syncStyles = (): void => {
			for (const [original, clone] of clones) {
				if (!original.isConnected) {
					clone.remove();
					clones.delete(original);
				}
			}
			for (const original of source.head.querySelectorAll(STYLE_SELECTOR)) {
				const clone = clones.get(original);
				if (!clone) {
					clones.set(original, target.head.appendChild(target.importNode(original, true)));
				} else if (clone.textContent !== original.textContent) {
					// Vite HMR rewrites <style> contents in place.
					clone.textContent = original.textContent;
				}
			}
		};

		const syncRootAttributes = (): void => {
			const from = source.documentElement;
			const to = target.documentElement;
			for (const attr of [...to.attributes]) {
				if (!from.hasAttribute(attr.name)) to.removeAttribute(attr.name);
			}
			for (const attr of from.attributes) to.setAttribute(attr.name, attr.value);
		};

		syncStyles();
		syncRootAttributes();
		const headObserver = new MutationObserver(syncStyles);
		headObserver.observe(source.head, { childList: true, subtree: true, characterData: true });
		const rootObserver = new MutationObserver(syncRootAttributes);
		rootObserver.observe(source.documentElement, { attributes: true });

		return () => {
			headObserver.disconnect();
			rootObserver.disconnect();
		};
	}
</script>
