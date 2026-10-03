/**
 * ResultApplicator
 * ================
 * Applies a plugin's primary artifact back to the Foldnano model according
 * to the plugin's declared applyStrategy.
 *
 * All mutations are wrapped in historyStack.snapshotTx so the change is a
 * single undoable step.
 *
 * Strategies:
 *  - previewOnly                           → no-op; result shown in PluginPanel only
 *  - replacePart                           → full part replacement, no annotation re-grafting
 *  - replacePartKeepAnnotationsWhereMatched → replace topology; re-graft annotations
 *  - replaceRegion                         → replace only active region, no annotation re-grafting
 *  - replaceRegionKeepAnnotationsWhereMatched → replace only active region; re-graft annotations
 */

import type { PluginManifest } from './types';
import type FoldnanoDocument from '$lib/model/document.svelte';
import type { HistoryStack } from '$lib/commands/history.svelte';
import type { VStrandJSON } from '$lib/model/io/cadnanoJSON';
import type { Part } from '$lib/model/Part';
import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import { dispatchOp, type MutationOp } from './opDispatch';
import {
	performReplaceRegion,
	performReplaceRegionKeepAnnotations,
	performReplacePart,
	performReplacePartKeepAnnotations,
	type PartJSON,
	type CrossRegionReconnectDiagnostics,
} from './result-replacement-operations';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function applyResult(opts: {
	manifest: PluginManifest;
	primaryArtifact: string | null;
	preRunFoldnanoSnapshot: PartJSON | null;
	mutationLog?: MutationOp[] | null;
	doc: FoldnanoDocument;
	partIndex: number;
	historyStack: HistoryStack;
	activeRegionId?: string | null;
}): void {
	const {
		manifest,
		primaryArtifact,
		preRunFoldnanoSnapshot,
		mutationLog,
		doc,
		partIndex,
		historyStack,
		activeRegionId,
	} = opts;

	if (manifest.applyStrategy === 'previewOnly') return;
	if (partIndex < 0 || partIndex >= doc.parts.length) return;

	if (
		manifest.applyStrategy === 'replayMutationLog' ||
		manifest.applyStrategy === 'replayMutationLogInRegion'
	) {
		if (!mutationLog || mutationLog.length === 0) return;
		const scope =
			manifest.applyStrategy === 'replayMutationLogInRegion' ? (activeRegionId ?? null) : null;
		applyReplayMutationLog(manifest, mutationLog, doc.parts[partIndex], historyStack, scope);
		return;
	}

	if (!primaryArtifact) return;

	if (
		(manifest.applyStrategy === 'replacePart' ||
			manifest.applyStrategy === 'replacePartKeepAnnotationsWhereMatched') &&
		manifest.format !== 'foldnano_json'
	) {
		throw new Error(
			`Plugin "${manifest.name}" uses ${manifest.applyStrategy} but format "${manifest.format}" is not supported for whole-part replacement.`
		);
	}
	if (
		(manifest.applyStrategy === 'replaceRegion' ||
			manifest.applyStrategy === 'replaceRegionKeepAnnotationsWhereMatched') &&
		manifest.format !== 'cadnano_json'
	) {
		throw new Error(
			`Plugin "${manifest.name}" uses ${manifest.applyStrategy} but format "${manifest.format}" is not supported for region replacement.`
		);
	}

	if (manifest.applyStrategy === 'replacePart') {
		applyReplacePart(manifest, primaryArtifact, doc, partIndex, historyStack);
	} else if (manifest.applyStrategy === 'replacePartKeepAnnotationsWhereMatched') {
		applyReplacePartKeepAnnotations(
			manifest,
			primaryArtifact,
			preRunFoldnanoSnapshot,
			doc,
			partIndex,
			historyStack
		);
	} else if (manifest.applyStrategy === 'replaceRegion') {
		applyReplaceRegion(
			manifest,
			primaryArtifact,
			doc,
			partIndex,
			activeRegionId ?? null,
			historyStack
		);
	} else if (manifest.applyStrategy === 'replaceRegionKeepAnnotationsWhereMatched') {
		applyReplaceRegionKeepAnnotations(
			manifest,
			primaryArtifact,
			preRunFoldnanoSnapshot,
			doc,
			partIndex,
			activeRegionId ?? null,
			historyStack
		);
	}
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

function applyReplacePart(
	manifest: PluginManifest,
	primaryArtifact: string,
	doc: FoldnanoDocument,
	partIndex: number,
	historyStack: HistoryStack
): void {
	historyStack.snapshotTx(`Plugin: ${manifest.name}`, () => {
		const resultPartJson = JSON.parse(primaryArtifact) as PartJSON;
		doc.parts[partIndex] = performReplacePart(resultPartJson);
	});
}

function applyReplacePartKeepAnnotations(
	manifest: PluginManifest,
	primaryArtifact: string,
	preRunSnapshot: PartJSON | null,
	doc: FoldnanoDocument,
	partIndex: number,
	historyStack: HistoryStack
): void {
	if (!preRunSnapshot) {
		throw new Error(
			'The design from before the run is unavailable, so annotations cannot be preserved.'
		);
	}
	historyStack.snapshotTx(`Plugin: ${manifest.name}`, () => {
		const resultPartJson = JSON.parse(primaryArtifact) as PartJSON;
		const { part: newPart, diagnostics } = performReplacePartKeepAnnotations(
			resultPartJson,
			preRunSnapshot
		);
		for (const warning of diagnostics.warnings) {
			console.warn(`[ResultApplicator] ${warning}`);
		}
		doc.parts[partIndex] = newPart;
	});
}

function applyReplayMutationLog(
	manifest: PluginManifest,
	log: MutationOp[],
	part: Part,
	historyStack: HistoryStack,
	activeRegionId: string | null
): void {
	if (activeRegionId) {
		const region = part.getRegionById(activeRegionId);
		if (!region) {
			throw new Error(
				`Plugin "${manifest.name}" uses replayMutationLogInRegion but region "${activeRegionId}" was not found in the active part.`
			);
		}
	}

	historyStack.snapshotTx(`Plugin: ${manifest.name}`, () => {
		for (let i = 0; i < log.length; i++) {
			const op = log[i];
			try {
				dispatchOp(op, part, { activeRegionId });
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				throw new Error(
					`Plugin "${manifest.name}" mutation-log replay failed at op ${i} (${op.op}): ${reason}`
				);
			}
		}
		part.rebuildRspCaches();
	});
}

function applyReplaceRegion(
	manifest: PluginManifest,
	primaryArtifact: string,
	doc: FoldnanoDocument,
	partIndex: number,
	activeRegionId: string | null,
	historyStack: HistoryStack
): void {
	if (!activeRegionId) {
		throw new Error(
			`Plugin "${manifest.name}" uses a region-scoped strategy but no active region was recorded.`
		);
	}

	historyStack.snapshotTx(`Plugin: ${manifest.name}`, () => {
		const part = doc.parts[partIndex];
		const region = part.getRegionById(activeRegionId);
		if (!region || !(region instanceof LatticedDesignRegion)) {
			throw new Error(
				`Region "${activeRegionId}" not found or is not a latticed region — cannot apply plugin result.`
			);
		}

		// VH indices in the cadnano JSON are used as-is (indexOffset = 0) so they match the
		// original indices and cross-region links can be re-established.
		const cadnanoData = JSON.parse(primaryArtifact) as { name: string; vstrands: VStrandJSON[] };
		printCrossRegionLinkMessages(performReplaceRegion(part, region, cadnanoData));
	});
}

function applyReplaceRegionKeepAnnotations(
	manifest: PluginManifest,
	primaryArtifact: string,
	preRunSnapshot: PartJSON | null,
	doc: FoldnanoDocument,
	partIndex: number,
	activeRegionId: string | null,
	historyStack: HistoryStack
): void {
	if (!activeRegionId) {
		throw new Error(
			`Plugin "${manifest.name}" uses a region-scoped strategy but no active region was recorded.`
		);
	}
	if (!preRunSnapshot) {
		throw new Error(
			'The design from before the run is unavailable, so annotations cannot be preserved.'
		);
	}

	historyStack.snapshotTx(`Plugin: ${manifest.name}`, () => {
		const part = doc.parts[partIndex];
		const region = part.getRegionById(activeRegionId);
		if (!region || !(region instanceof LatticedDesignRegion)) {
			throw new Error(
				`Region "${activeRegionId}" not found or is not a latticed region — cannot apply plugin result.`
			);
		}

		const cadnanoData = JSON.parse(primaryArtifact) as { name: string; vstrands: VStrandJSON[] };
		const { diagnostics, crossRegionLinks } = performReplaceRegionKeepAnnotations(
			part,
			region,
			cadnanoData,
			preRunSnapshot
		);
		for (const warning of diagnostics.warnings) {
			console.warn(`[ResultApplicator] ${warning}`);
		}
		printCrossRegionLinkMessages(crossRegionLinks);
	});
}

function printCrossRegionLinkMessages(crossRegionLinks: CrossRegionReconnectDiagnostics): void {
	for (const warning of crossRegionLinks.warnings) {
		console.warn(`[ResultApplicator] ${warning}`);
	}
	if (crossRegionLinks.attempted > 0) {
		console.info(
			`[ResultApplicator] Cross-region links: ${crossRegionLinks.restored} restored, ${crossRegionLinks.skipped} could not be matched.`
		);
	}
}
