// Reconstructs/applies a validated result on a detached scratch Part (never doc.parts, never snapshotTx) using the same perform* ops real Apply uses.

import { Part } from '$lib/model/Part';
import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import type { VStrandJSON } from '$lib/model/io/cadnanoJSON';
import type { PluginManifest } from './types';
import { PluginValidationError, type InvariantCategory } from './plugin-result-errors';
import { checkPartIntegrity } from '$lib/model/checks/integrity';
import {
	performReplacePart,
	performReplacePartKeepAnnotations,
	performReplaceRegion,
	performReplaceRegionKeepAnnotations,
	type PartJSON,
} from './result-replacement-operations';

export type DesignVerificationInput =
	| { format: 'cadnano_json'; data: { name: string; vstrands: VStrandJSON[] } }
	| { format: 'foldnano_json'; data: PartJSON };

type Reject = (message: string, category: InvariantCategory) => never;
type Reconstruct = <T>(fn: () => T) => T;

// Throws PluginValidationError(phase: 'design-verification') if unsafe; returns nothing on success (real Apply reparses primaryArtifact itself).
export function verifyDesign(
	manifest: PluginManifest,
	pluginId: string,
	preRunSnapshot: PartJSON | null,
	activeRegionId: string | null,
	result: DesignVerificationInput
): void {
	const reject: Reject = (message, category) => {
		throw new PluginValidationError(message, pluginId, 'design-verification', category);
	};
	const reconstruct: Reconstruct = (fn) => {
		try {
			return fn();
		} catch (err) {
			if (err instanceof PluginValidationError) throw err;
			throw new PluginValidationError(
				`The design could not be rebuilt for checking: ${err instanceof Error ? err.message : String(err)}`,
				pluginId,
				'design-verification',
				'reconstruction'
			);
		}
	};

	switch (manifest.applyStrategy) {
		case 'replacePart':
		case 'replacePartKeepAnnotationsWhereMatched':
			verifyReplacePart(
				manifest.applyStrategy,
				pluginId,
				preRunSnapshot,
				result,
				reject,
				reconstruct
			);
			return;
		case 'replaceRegion':
		case 'replaceRegionKeepAnnotationsWhereMatched':
			verifyReplaceRegion(
				manifest.applyStrategy,
				pluginId,
				preRunSnapshot,
				activeRegionId,
				result,
				reject,
				reconstruct
			);
			return;
		default:
			// Explicit, not an implicit else — a caller mistake should fail loudly, not fall into the wrong branch.
			reject(`The apply strategy "${manifest.applyStrategy}" is not supported.`, 'reconstruction');
	}
}

function verifyReplacePart(
	strategy: 'replacePart' | 'replacePartKeepAnnotationsWhereMatched',
	pluginId: string,
	preRunSnapshot: PartJSON | null,
	result: DesignVerificationInput,
	reject: Reject,
	reconstruct: Reconstruct
): void {
	if (result.format !== 'foldnano_json') {
		reject(
			`The "${strategy}" apply strategy requires a "foldnano_json" result, but received "${result.format}".`,
			'reconstruction'
		);
	}
	let scratchPart: Part;
	if (strategy === 'replacePartKeepAnnotationsWhereMatched') {
		if (preRunSnapshot === null) {
			reject(
				'The design from before the run is unavailable, so annotations cannot be preserved.',
				'missing-snapshot'
			);
		}
		scratchPart = reconstruct(
			() => performReplacePartKeepAnnotations(result.data, preRunSnapshot).part
		);
	} else {
		scratchPart = reconstruct(() => performReplacePart(result.data));
	}
	checkReconstructedPart(scratchPart, reject);
	checkIntegrity(scratchPart, pluginId, reject);
}

function verifyReplaceRegion(
	strategy: 'replaceRegion' | 'replaceRegionKeepAnnotationsWhereMatched',
	pluginId: string,
	preRunSnapshot: PartJSON | null,
	activeRegionId: string | null,
	result: DesignVerificationInput,
	reject: Reject,
	reconstruct: Reconstruct
): void {
	if (result.format !== 'cadnano_json') {
		reject(
			`The "${strategy}" apply strategy requires a "cadnano_json" result, but received "${result.format}".`,
			'reconstruction'
		);
	}
	if (preRunSnapshot === null) {
		reject(
			'The design from before the run is unavailable, so the result cannot be checked.',
			'missing-snapshot'
		);
	}
	if (activeRegionId === null) {
		reject('No active region was recorded for this run.', 'missing-region');
	}

	const scratchPart = reconstruct(() => Part.fromJSON(preRunSnapshot));
	const scratchRegion = scratchPart.getRegionById(activeRegionId);
	if (!scratchRegion || !(scratchRegion instanceof LatticedDesignRegion)) {
		reject(
			`The active region "${activeRegionId}" is missing from the design before the run or is not a lattice region.`,
			'missing-region'
		);
	}

	checkVhIndexSetUnchanged(preRunSnapshot, activeRegionId, result.data, reject);

	if (strategy === 'replaceRegionKeepAnnotationsWhereMatched') {
		reconstruct(() =>
			performReplaceRegionKeepAnnotations(scratchPart, scratchRegion, result.data, preRunSnapshot)
		);
	} else {
		reconstruct(() => performReplaceRegion(scratchPart, scratchRegion, result.data));
	}
	// A VH shorter than the region's maxBase survives Apply, but the next save/reload's
	// Part.fromJSON normalize grows the VH up to match, silently discarding the plugin's declared
	// length (measured, not assumed — see the plan). Whether that should be rejected here is an
	// open, deferred policy decision, not yet made — no check for it exists on purpose.
	checkReconstructedPart(scratchPart, reject);
	checkIntegrity(scratchPart, pluginId, reject, new Set([activeRegionId]));
}

// Only the replaced scope: a region the plugin didn't touch isn't the plugin's fault.
function checkIntegrity(
	part: Part,
	pluginId: string,
	reject: Reject,
	regionIds?: ReadonlySet<string>
): void {
	const issues = checkPartIntegrity(part, regionIds);
	const error = issues.find((issue) => issue.severity === 'error');
	if (error) reject(error.message, error.rule);
	for (const issue of issues) {
		if (issue.severity === 'warning')
			console.warn(`[design-verification] ${pluginId}: ${issue.message}`);
	}
}

// Reads from the frozen preRunSnapshot, never a live re-read of the document.
function checkVhIndexSetUnchanged(
	preRunSnapshot: PartJSON,
	activeRegionId: string,
	cadnanoData: { vstrands: VStrandJSON[] },
	reject: Reject
): void {
	const preRunRegion = preRunSnapshot.regions.find((r) => r.id === activeRegionId);
	if (!preRunRegion) {
		reject(
			`The active region "${activeRegionId}" is missing from the design before the run.`,
			'missing-region'
		);
	}

	const vhIndexById = new Map(preRunSnapshot.virtualHelices.map((vh) => [vh.id, vh.index]));
	const oldIndices = preRunRegion.vhOrder.map((vhId) => {
		const index = vhIndexById.get(vhId);
		if (index === undefined) {
			reject(
				`The active region's "vhOrder" lists virtual helix "${vhId}", but that helix is missing from the design before the run.`,
				'missing-vh-mapping'
			);
		}
		return index;
	});

	const incoming = new Set(cadnanoData.vstrands.map((v) => v.num));
	const before = new Set(oldIndices);
	if (incoming.size !== before.size || [...before].some((i) => !incoming.has(i))) {
		const added = [...incoming].filter((i) => !before.has(i));
		const removed = [...before].filter((i) => !incoming.has(i));
		const changes = [
			added.length ? `added: ${added.join(', ')}` : '',
			removed.length ? `removed: ${removed.join(', ')}` : '',
		].filter(Boolean);
		reject(
			`The result's virtual helix indices do not match the region's indices before the run (${changes.join('; ')}).`,
			'vh-index-set'
		);
	}
}

// SegmentEnd.fromJSON assigns connectedSegmentId directly, without connectTo()'s resolve/reciprocity checks — confirmed by reading SegmentEnd.svelte.ts, not assumed.
function checkReconstructedPart(part: Part, reject: Reject): void {
	const planeIds = new Set(part.planes.map((p) => p.id));
	for (const region of part.regions) {
		if (!planeIds.has(region.planeId)) {
			reject(
				`Region "${region.id}" references plane "${region.planeId}", which does not exist.`,
				'reference'
			);
		}
	}

	const regionIds = new Set(part.regions.map((r) => r.id));
	for (const vh of part.virtualHelices) {
		if (vh.regionId === undefined || !regionIds.has(vh.regionId)) {
			reject(
				`Virtual helix ${vh.index} has no region assigned, or references one that does not exist.`,
				'reference'
			);
		}

		for (const strandSet of vh.strandSets) {
			for (const segId of strandSet.segmentIds) {
				const seg = part.getSegmentById(segId);
				if (!seg) {
					reject(
						`Virtual helix ${vh.index}'s strand set references segment "${segId}", which does not exist.`,
						'reference'
					);
				}
				if (seg.inVirtualHelix.id !== vh.id) {
					reject(
						`Virtual helix ${vh.index}'s strand set references segment "${segId}", which belongs to a different virtual helix.`,
						'reference'
					);
				}

				const lo = Math.min(seg.fivePrime.index, seg.threePrime.index);
				const hi = Math.max(seg.fivePrime.index, seg.threePrime.index);
				if (lo < 0 || hi >= vh.length) {
					reject(
						`Segment "${seg.id}" on virtual helix ${vh.index} covers bases ${lo} to ${hi}, but the virtual helix has ${vh.length} bases (0 to ${vh.length - 1}).`,
						'bounds'
					);
				}

				for (const end of [seg.fivePrime, seg.threePrime] as const) {
					const connectedId = end.toJSON().connectedSegmentId;
					if (connectedId === null) continue;
					const target = part.getSegmentById(connectedId);
					if (!target) {
						reject(
							`Segment "${seg.id}" connects to segment "${connectedId}", which does not exist.`,
							'reference'
						);
					}
					const reciprocalEnd = end.isThreePrime ? target.fivePrime : target.threePrime;
					if (reciprocalEnd.toJSON().connectedSegmentId !== seg.id) {
						reject(
							`Segment "${seg.id}" connects to "${connectedId}", which does not connect back.`,
							'reciprocity'
						);
					}
				}
			}
		}
	}
}
