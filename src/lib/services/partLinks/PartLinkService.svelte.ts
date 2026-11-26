import { SvelteMap } from 'svelte/reactivity';
import type FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type { PartSource } from '$lib/model/Part/Part.svelte';
import {
	linkFromSource,
	matchLinkSource,
	partContentHash,
	readSourceDocument,
	type PartLinkState,
	type PartLinkTarget,
} from '$lib/model/partLinks';
import type { HistoryStack } from '$lib/commands/history.svelte';
import { updateLinkedPartCmd } from '$lib/commands/partLinks';
export type { PartLinkState };
import { DOC_SAVED_CHANNEL, type DocSavedMessage } from '$lib/services/storage/docSavedChannel';

export interface PartLinkStatus {
	state: PartLinkState;
	/** Local document id of the source, when this browser has it. */
	sourceDocId: string | null;
	/** The link has no repo path, so it only resolves in this browser. */
	localOnly: boolean;
	/** Why the source can't be linked any more (`unlinkable` only). */
	reason?: string;
	/** The source design's current name, when this browser has it; the copy keeps its own name. */
	sourceName?: string;
}

/** Outcome of `update`: `ok`, or why nothing changed. */
export type PartLinkUpdateResult =
	| { ok: true }
	| {
			ok: false;
			/** `superseded`: the link changed (another Update or Relink) while the source was read.
			 * `readOnly`: this tab doesn't own the design (any more). */
			reason: 'unreadable' | 'replaced' | 'unlinkable' | 'superseded' | 'readOnly';
			detail?: string;
	  };

/** Storage lookups the service needs; the editor session passes its own. */
export interface PartLinkStorage {
	loadDocument(docId: string): Promise<object | null>;
	/** Local document id of `path` in the assembly's GitHub repo, if it was opened here. */
	findDocIdByRepoPath(path: string): string | null;
	/** Path of `docId` in the assembly's GitHub repo, if it is a file there. */
	repoPathOf(docId: string): string | null;
	/** GitHub blob SHA the local copy of `docId` was last synced at, if it is a repo file. */
	blobShaOf(docId: string): string | undefined;
	/** `owner/repo` of `docId` when it is a file in a repo other than the assembly's. */
	otherRepoOf(docId: string): string | null;
}

/** Linked Parts whose links others can't follow once the design is in its GitHub repo. */
export interface UnfollowableLinks {
	/** No repo path: the source is a design kept only in this browser. */
	localOnly: Part[];
	/** The source is a file in another repo; the link's path would be read in this one. */
	otherRepo: { part: Part; repo: string }[];
}

/**
 * Follows the linked Parts of the open document: where each source is in this browser, and
 * whether it changed since the copy was taken (G6/G7 in the assembly plan; docs/linked-parts.md).
 * Statuses refresh on load, when another tab saves a source, and when the window regains focus.
 */
export class PartLinkService {
	#statuses = new SvelteMap<string, PartLinkStatus>();
	/** `contentHash` each status was computed for, so an update or undo shows as unchecked.
	 * Not reactive on purpose: `#statuses` is what the UI reads. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#checkedHash = new Map<string, string>();
	#generation = 0;
	#refreshQueued = false;

	constructor(
		private readonly getDoc: () => FoldnanoDocument,
		private readonly storage: PartLinkStorage
	) {}

	/** The Part's link status; schedules a check when it has none for the current copy. */
	statusOf(part: Part): PartLinkStatus | null {
		const source = part.source;
		if (!source) return null;
		const status = this.#statuses.get(part.id);
		if (!status || this.#checkedHash.get(part.id) !== source.contentHash) {
			this.#queueRefresh();
			return status ?? { state: 'checking', sourceDocId: null, localOnly: !source.repoPath };
		}
		return status;
	}

	/** Local document id of the source: by repo path in the current repo, else the stored id. */
	resolveDocId(source: PartLinkTarget): string | null {
		if (source.repoPath) {
			const byPath = this.storage.findDocIdByRepoPath(source.repoPath);
			if (byPath) return byPath;
		}
		return source.docId ?? null;
	}

	/** Checked where a design goes to GitHub (publish, commit). */
	unfollowableLinks(): UnfollowableLinks {
		const result: UnfollowableLinks = { localOnly: [], otherRepo: [] };
		for (const part of this.getDoc().parts) {
			const source = part.source;
			if (!source) continue;
			const repo = source.docId ? this.storage.otherRepoOf(source.docId) : null;
			if (repo) result.otherRepo.push({ part, repo });
			else if (!source.repoPath) result.localOnly.push(part);
		}
		return result;
	}

	/** Where a design in this browser is linked from: its repo path too, when it is a file in the
	 * current repo, so the link resolves on other machines. */
	linkTargetFor(docId: string): PartLinkTarget {
		const repoPath = this.storage.repoPathOf(docId);
		return repoPath ? { repoPath, docId, blobSha: this.storage.blobShaOf(docId) } : { docId };
	}

	async #loadSource(source: PartSource): Promise<{ docId: string; doc: FoldnanoDocument } | null> {
		const docId = this.resolveDocId(source);
		if (!docId) return null;
		const doc = readSourceDocument(await this.storage.loadDocument(docId));
		return doc ? { docId, doc } : null;
	}

	async #check(source: PartSource): Promise<PartLinkStatus> {
		const localOnly = !source.repoPath;
		const loaded = await this.#loadSource(source);
		// A portable link whose local id belongs to another browser: not opened here yet.
		if (!loaded) {
			return { state: source.repoPath ? 'notLocal' : 'missing', sourceDocId: null, localOnly };
		}
		const sourceDocId = loaded.docId;
		const sourceName = loaded.doc.name;
		const match = matchLinkSource(loaded.doc, source);
		if (match.kind === 'unlinkable') {
			return { state: 'unlinkable', sourceDocId, sourceName, localOnly, reason: match.reason };
		}
		if (match.kind === 'replaced') return { state: 'replaced', sourceDocId, sourceName, localOnly };
		const hash = await partContentHash(match.part.snapshot());
		const state = hash === source.contentHash ? 'upToDate' : 'outdated';
		return { state, sourceDocId, sourceName, localOnly };
	}

	#queueRefresh(): void {
		if (this.#refreshQueued) return;
		this.#refreshQueued = true;
		queueMicrotask(() => {
			this.#refreshQueued = false;
			void this.refresh();
		});
	}

	/** Checks every linked Part again. A newer refresh wins over one still running. */
	async refresh(): Promise<void> {
		const generation = ++this.#generation;
		const linked = this.getDoc().parts.filter((p) => p.source);
		const results = await Promise.all(
			linked.map(async (part) => {
				const source = part.source!;
				return { part, source, status: await this.#check(source) };
			})
		);
		if (generation !== this.#generation) return;
		const ids = linked.map((p) => p.id);
		for (const id of [...this.#statuses.keys()]) {
			if (!ids.includes(id)) {
				this.#statuses.delete(id);
				this.#checkedHash.delete(id);
			}
		}
		for (const { part, source, status } of results) {
			this.#checkedHash.set(part.id, source.contentHash);
			this.#statuses.set(part.id, status);
		}
	}

	/** Whether a save of `docId` matters: one of the open document's links resolves to it. */
	#isSourceDoc(docId: string | undefined): boolean {
		return this.getDoc().parts.some(
			(part) => !!part.source && !!docId && this.resolveDocId(part.source) === docId
		);
	}

	/**
	 * Replaces the linked Part's copy with the source's current Part, as one undoable step. The
	 * link is renewed too: a source published to the repo since gains its repo path. A source
	 * that now holds a different Part is taken only with `relink`; one that can't be linked any
	 * more never is. The copy stays as it was whenever this doesn't return `ok`. `canEdit` (tab
	 * ownership) is checked before reading and again just before replacing.
	 */
	async update(
		history: HistoryStack,
		partId: string,
		options: { relink?: boolean; canEdit?: () => boolean } = {}
	): Promise<PartLinkUpdateResult> {
		const canEdit = options.canEdit ?? (() => true);
		if (!canEdit()) return { ok: false, reason: 'readOnly' };
		const doc = this.getDoc();
		const current = doc.parts.find((p) => p.id === partId)?.source;
		if (!current) return { ok: false, reason: 'unreadable' };
		const startedFrom = JSON.stringify(current);
		const loaded = await this.#loadSource(current);
		if (!loaded) return { ok: false, reason: 'unreadable' };
		const match = matchLinkSource(loaded.doc, current);
		if (match.kind === 'unlinkable')
			return { ok: false, reason: 'unlinkable', detail: match.reason };
		if (match.kind === 'replaced' && !options.relink) return { ok: false, reason: 'replaced' };
		const { json, source } = await linkFromSource(loaded.doc, this.linkTargetFor(loaded.docId));
		// While the source was read the document may have been switched, the Part deleted, its link
		// changed by another Update or a Relink (which must not be reverted), or ownership lost.
		if (this.getDoc() !== doc) return { ok: false, reason: 'unreadable' };
		const now = doc.parts.find((p) => p.id === partId)?.source;
		if (!now) return { ok: false, reason: 'unreadable' };
		if (JSON.stringify(now) !== startedFrom) return { ok: false, reason: 'superseded' };
		if (!canEdit()) return { ok: false, reason: 'readOnly' };
		updateLinkedPartCmd(history, doc, partId, json, source);
		await this.refresh();
		return { ok: true };
	}

	/** Listens for saves in other tabs and for window focus; returns a function that stops it. */
	start(): () => void {
		const stops: (() => void)[] = [];
		if (typeof BroadcastChannel !== 'undefined') {
			const channel = new BroadcastChannel(DOC_SAVED_CHANNEL);
			channel.onmessage = (event: MessageEvent<DocSavedMessage>) => {
				if (this.#isSourceDoc(event.data?.docId)) void this.refresh();
			};
			stops.push(() => channel.close());
		}
		if (typeof window !== 'undefined') {
			const onFocus = () => {
				if (this.getDoc().parts.some((p) => p.source)) void this.refresh();
			};
			window.addEventListener('focus', onFocus);
			stops.push(() => window.removeEventListener('focus', onFocus));
		}
		return () => stops.forEach((stop) => stop());
	}
}
