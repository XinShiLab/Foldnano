import type { Part } from '$lib/model/Part/Part.svelte';
import { failShape as reject } from '../designIssue';

type PartJSON = ReturnType<Part['toJSON']>;

type SegmentJSON = PartJSON['oligos'][number]['segments'][number];
type SegmentEndJSON = SegmentJSON['fivePrime'];

const isInt = Number.isInteger;
const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNonEmptyString = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function isVec3(x: unknown): x is { x: number; y: number; z: number } {
	if (typeof x !== 'object' || x === null) return false;
	const v = x as Record<string, unknown>;
	return isFiniteNum(v.x) && isFiniteNum(v.y) && isFiniteNum(v.z);
}

/**
 * Shape/internal-consistency check for one parsed Part in foldnano JSON, before reconstruction.
 * Throws `DesignCheckError` on the first error.
 */
export function checkFoldnanoPartJsonShape(parsed: unknown): PartJSON {
	if (typeof parsed !== 'object' || parsed === null) reject('Design must be a JSON object.');
	const top = parsed as Record<string, unknown>;

	// `name` is free text, not an identifier — an empty name is unusual but legitimate.
	if (typeof top.name !== 'string') reject('Design is missing a string "name".');
	if (!isNonEmptyString(top.id)) reject('Design is missing a non-empty "id".');
	for (const key of ['planes', 'regions', 'oligos', 'virtualHelices'] as const) {
		if (!Array.isArray(top[key])) reject(`Design is missing a "${key}" array.`);
	}
	const planes = top.planes as Record<string, unknown>[];
	const regions = top.regions as Record<string, unknown>[];
	const oligos = top.oligos as Record<string, unknown>[];
	const virtualHelices = top.virtualHelices as Record<string, unknown>[];

	// --- Planes ---------------------------------------------------------
	const planeIds = new Set<string>();
	for (const p of planes) {
		if (!isObj(p)) reject('A plane must be an object.');
		if (!isNonEmptyString(p.id)) reject('A plane is missing a non-empty "id".');
		// `name` is free text, not an identifier — an empty name is unusual but legitimate.
		if (typeof p.name !== 'string') reject(`Plane "${p.id}" is missing a string "name".`);
		if (planeIds.has(p.id as string)) reject(`Duplicate plane id "${p.id}".`);
		planeIds.add(p.id as string);
		for (const field of ['origin', 'u', 'v', 'normal'] as const) {
			if (!isVec3(p[field])) reject(`Plane "${p.id}" has a malformed "${field}".`);
		}
	}

	// --- Regions ---------------------------------------------------------
	const regionIds = new Set<string>();
	const regionById = new Map<string, Record<string, unknown>>();
	for (const r of regions) {
		if (!isObj(r)) reject('A region must be an object.');
		if (
			!isNonEmptyString(r.id) ||
			!isNonEmptyString(r.planeId) ||
			!Array.isArray(r.vhOrder) ||
			!(r.vhOrder as unknown[]).every((v) => isNonEmptyString(v))
		) {
			reject(
				'A region must have non-empty "id" and "planeId" strings and a "vhOrder" array containing only non-empty strings.'
			);
		}
		// `name` is free text, not an identifier — an empty name is unusual but legitimate.
		if (typeof r.name !== 'string') reject(`Region "${r.id}" is missing a string "name".`);
		if (r.kind !== 'SQUARE' && r.kind !== 'HONEYCOMB' && r.kind !== 'FREEFORM') {
			reject(`Region "${r.id}" has an invalid "kind".`);
		}
		for (const field of ['step', 'turnsPerStep', 'subStepSize'] as const) {
			if (!isInt(r[field]) || (r[field] as number) <= 0) {
				reject(`Region "${r.id}"'s "${field}" must be a positive integer.`);
			}
		}
		if (!isFiniteNum(r.twistOffset)) reject(`Region "${r.id}" has a non-finite "twistOffset".`);
		// Integer, not just finite — DesignRegion.ts assigns maxBase directly to VirtualHelix.length.
		if (!isInt(r.minBase) || !isInt(r.maxBase) || (r.minBase as number) > (r.maxBase as number)) {
			reject(`Region "${r.id}" has an invalid "minBase"/"maxBase".`);
		}
		if (regionIds.has(r.id as string)) reject(`Duplicate region id "${r.id}".`);
		regionIds.add(r.id as string);
		if (!planeIds.has(r.planeId as string)) {
			reject(
				`Region "${r.id}" references planeId "${r.planeId}", which does not exist.`,
				'reference'
			);
		}
		regionById.set(r.id as string, r);
	}

	// --- Virtual helices ---------------------------------------------------------
	const vhIds = new Set<string>();
	const vhIndices = new Set<number>();
	const vhByIndex = new Map<number, Record<string, unknown>>();
	for (const vh of virtualHelices) {
		if (!isObj(vh)) reject('A virtual helix must be an object.');
		if (
			!isNonEmptyString(vh.id) ||
			!isInt(vh.index) ||
			!isNonEmptyString(vh.regionId) ||
			!isInt(vh.length)
		) {
			reject('A virtual helix is missing a non-empty id/regionId, or a valid index/length.');
		}
		// Shape-checked only — Part.syncListRows() unconditionally recomputes the real value.
		if (!isFiniteNum(vh.listRow))
			reject(`Virtual helix "${vh.id}" is missing a numeric "listRow".`);
		if (!Array.isArray(vh.strandSets) || (vh.strandSets as unknown[]).length !== 2) {
			reject(`Virtual helix "${vh.id}" must have exactly two strand sets.`);
		}
		if (vh.latticeCoords !== undefined) {
			const lc = vh.latticeCoords as Record<string, unknown>;
			if (typeof lc !== 'object' || lc === null || !isFiniteNum(lc.row) || !isFiniteNum(lc.col)) {
				reject(`Virtual helix "${vh.id}" has a malformed "latticeCoords".`);
			}
		}
		if (vh.localFrame !== undefined) {
			const lf = vh.localFrame as Record<string, unknown>;
			if (
				typeof lf !== 'object' ||
				lf === null ||
				!isVec3(lf.origin) ||
				!isVec3(lf.axis) ||
				!isVec3(lf.radial0)
			) {
				reject(`Virtual helix "${vh.id}" has a malformed "localFrame".`);
			}
		}
		if (vhIds.has(vh.id as string)) reject(`Duplicate virtual helix id "${vh.id}".`);
		vhIds.add(vh.id as string);
		if (vhIndices.has(vh.index as number)) reject(`Duplicate virtual helix index ${vh.index}.`);
		vhIndices.add(vh.index as number);
		vhByIndex.set(vh.index as number, vh);
		if (!regionIds.has(vh.regionId as string)) {
			reject(
				`Virtual helix "${vh.id}" references regionId "${vh.regionId}", which does not exist.`,
				'reference'
			);
		}
		// Part.fromJSON's normalize silently resolves this on load by growing one side to match
		// the other (a too-short VH is grown to the region's maxBase; a too-long VH instead grows
		// the region's own maxBase) — reject the plugin's own contradiction now, since both fields
		// come from the plugin's own result, instead of letting reconstruction pick a winner unseen.
		const region = regionById.get(vh.regionId as string)!;
		if ((vh.length as number) !== (region.maxBase as number)) {
			reject(
				`Virtual helix "${vh.id}" has length ${vh.length}, but its region "${vh.regionId}" has maxBase ${region.maxBase}.`
			);
		}
	}

	// latticeCoords required + unique per latticed region.
	for (const vh of virtualHelices) {
		const region = regionById.get(vh.regionId as string)!;
		if (region.kind === 'FREEFORM') continue;
		if (vh.latticeCoords === undefined) {
			reject(`Virtual helix "${vh.id}" belongs to a latticed region but has no "latticeCoords".`);
		}
	}
	const seenCoordsByRegion = new Map<string, Set<string>>();
	for (const vh of virtualHelices) {
		if (vh.latticeCoords === undefined) continue;
		const lc = vh.latticeCoords as { row: number; col: number };
		const key = `${lc.row}:${lc.col}`;
		const regionId = vh.regionId as string;
		let seen = seenCoordsByRegion.get(regionId);
		if (!seen) {
			seen = new Set();
			seenCoordsByRegion.set(regionId, seen);
		}
		if (seen.has(key)) {
			reject(
				`Region "${regionId}" has two virtual helices sharing latticeCoords {row: ${lc.row}, col: ${lc.col}}.`
			);
		}
		seen.add(key);
	}

	// vhOrder membership, both directions.
	for (const r of regions) {
		const vhOrder = r.vhOrder as string[];
		const claimedByRegion = virtualHelices
			.filter((vh) => vh.regionId === r.id)
			.map((vh) => vh.id as string);
		const orderSet = new Set(vhOrder);
		if (orderSet.size !== vhOrder.length)
			reject(`Region "${r.id}"'s "vhOrder" has duplicate entries.`);
		for (const vhId of claimedByRegion) {
			if (!orderSet.has(vhId)) {
				reject(
					`Virtual helix "${vhId}" claims regionId "${r.id}" but is absent from its "vhOrder".`,
					'reference'
				);
			}
		}
		for (const vhId of vhOrder) {
			if (!vhIds.has(vhId))
				reject(
					`Region "${r.id}"'s "vhOrder" references unknown virtual helix "${vhId}".`,
					'reference'
				);
			if (!claimedByRegion.includes(vhId)) {
				reject(
					`Region "${r.id}"'s "vhOrder" includes "${vhId}", whose own regionId points elsewhere.`,
					'reference'
				);
			}
		}
	}

	// --- Strand sets ---------------------------------------------------------
	for (const vh of virtualHelices) {
		const strandSets = vh.strandSets as Record<string, unknown>[];
		const indices = new Set<number>();
		for (const ss of strandSets) {
			if (!isObj(ss)) reject(`Virtual helix "${vh.id}" has a strand set that is not an object.`);
			if ((ss.strandIndex !== 0 && ss.strandIndex !== 1) || !Array.isArray(ss.segmentIds)) {
				reject(`Virtual helix "${vh.id}" has a malformed strand set.`);
			}
			if (!(ss.segmentIds as unknown[]).every((s) => isNonEmptyString(s))) {
				reject(`Virtual helix "${vh.id}" has a strand set with a non-string segment id.`);
			}
			if (indices.has(ss.strandIndex as number)) {
				reject(`Virtual helix "${vh.id}" has two strand sets with the same strandIndex.`);
			}
			indices.add(ss.strandIndex as number);
		}
	}

	// --- Oligos / segments ---------------------------------------------------------
	const oligoIds = new Set<string>();
	const segmentIds = new Set<string>();
	const segmentById = new Map<string, { seg: SegmentJSON; oligoId: string }>();
	for (const o of oligos) {
		if (!isObj(o)) reject('An oligo must be an object.');
		if (!isNonEmptyString(o.id) || !Array.isArray(o.segments)) {
			reject('An oligo is missing a non-empty "id" or "segments" array.');
		}
		// Reject here so the chain-or-cycle check below never sees an empty segs array.
		if ((o.segments as unknown[]).length === 0) reject(`Oligo "${o.id}" has no segments.`);
		if (typeof o.color !== 'string') reject(`Oligo "${o.id}" has a non-string "color".`);
		if (typeof o.isScaffold !== 'boolean' || typeof o.isSequenceLocked !== 'boolean') {
			reject(`Oligo "${o.id}" has a non-boolean "isScaffold"/"isSequenceLocked".`);
		}
		if (o.name !== undefined && typeof o.name !== 'string') {
			reject(`Oligo "${o.id}" has a non-string "name".`);
		}
		if (oligoIds.has(o.id as string)) reject(`Duplicate oligo id "${o.id}".`);
		oligoIds.add(o.id as string);

		for (const segUnknown of o.segments as Record<string, unknown>[]) {
			const seg = segUnknown;
			if (!isObj(seg)) reject(`Oligo "${o.id}" has a segment that is not an object.`);
			if (!isNonEmptyString(seg.id) || !isInt(seg.inVirtualHelixIndex)) {
				reject('A segment must have a non-empty "id" and an integer "inVirtualHelixIndex".');
			}
			if (seg.sequence !== undefined && typeof seg.sequence !== 'string') {
				reject(`Segment "${seg.id}" has a non-string "sequence".`);
			}
			if (
				!Array.isArray(seg.slots) ||
				!(seg.slots as unknown[]).every(
					(s) =>
						typeof s === 'object' &&
						s !== null &&
						isInt((s as Record<string, unknown>).bpIndex) &&
						typeof (s as Record<string, unknown>).seq === 'string'
				)
			) {
				reject(`Segment "${seg.id}" has a malformed "slots" array.`);
			}
			for (const endKey of ['fivePrime', 'threePrime'] as const) {
				const end = seg[endKey] as Record<string, unknown>;
				if (
					typeof end !== 'object' ||
					end === null ||
					!isNonEmptyString(end.segmentId) ||
					typeof end.isThreePrime !== 'boolean' ||
					!isInt(end.index)
				) {
					reject(`Segment "${seg.id}"'s "${endKey}" is missing segmentId/isThreePrime/index.`);
				}
				if (
					end.modification !== undefined &&
					end.modification !== null &&
					typeof end.modification !== 'string'
				) {
					reject(`Segment "${seg.id}"'s "${endKey}" has a non-string "modification".`);
				}
				if (end.isConstrained !== undefined && typeof end.isConstrained !== 'boolean') {
					reject(`Segment "${seg.id}"'s "${endKey}" has a non-boolean "isConstrained".`);
				}
			}
			if (segmentIds.has(seg.id as string)) reject(`Duplicate segment id "${seg.id}".`);
			segmentIds.add(seg.id as string);
			segmentById.set(seg.id as string, {
				seg: seg as unknown as SegmentJSON,
				oligoId: o.id as string,
			});

			if (!vhIndices.has(seg.inVirtualHelixIndex as number)) {
				reject(
					`Segment "${seg.id}" has "inVirtualHelixIndex" ${seg.inVirtualHelixIndex}, but no virtual helix has that index.`,
					'reference'
				);
			}
		}
	}

	// Checked both directions: unknown ids, own-VH match, and exactly-once placement.
	const segmentPlacementCount = new Map<string, number>();
	for (const vh of virtualHelices) {
		const strandSets = vh.strandSets as Record<string, unknown>[];
		for (const ss of strandSets) {
			for (const segId of ss.segmentIds as string[]) {
				const entry = segmentById.get(segId);
				if (!entry) {
					reject(
						`Virtual helix "${vh.id}"'s strand set references unknown segment "${segId}".`,
						'reference'
					);
				}
				if (entry!.seg.inVirtualHelixIndex !== (vh.index as number)) {
					reject(
						`Segment "${segId}" is listed in a strand set on virtual helix "${vh.id}", but its "inVirtualHelixIndex" is ${entry!.seg.inVirtualHelixIndex} instead of ${vh.index}.`,
						'reference'
					);
				}
				segmentPlacementCount.set(segId, (segmentPlacementCount.get(segId) ?? 0) + 1);
			}
		}
	}
	for (const segId of segmentIds) {
		const count = segmentPlacementCount.get(segId) ?? 0;
		if (count === 0) reject(`Segment "${segId}" does not appear in any strand set.`, 'reference');
		if (count > 1) reject(`Segment "${segId}" appears in more than one strand set.`, 'reference');
	}

	// --- Per-segment semantic checks ---------------------------------------------------------
	for (const o of oligos) {
		for (const segUnknown of o.segments as unknown as SegmentJSON[]) {
			const seg = segUnknown;
			const containingVh = vhByIndex.get(seg.inVirtualHelixIndex)!;

			// Endpoint role booleans.
			if (seg.fivePrime.isThreePrime !== false)
				reject(`Segment "${seg.id}"'s fivePrime.isThreePrime must be false.`);
			if (seg.threePrime.isThreePrime !== true)
				reject(`Segment "${seg.id}"'s threePrime.isThreePrime must be true.`);

			// Endpoint segmentId self-consistency.
			for (const end of [seg.fivePrime, seg.threePrime]) {
				if (end.segmentId !== seg.id)
					reject(`Both ends of segment "${seg.id}" must use "${seg.id}" as their "segmentId".`);
			}

			// Self-connection rejected.
			for (const end of [seg.fivePrime, seg.threePrime]) {
				if (end.connectedSegmentId === seg.id)
					reject(`Segment "${seg.id}" connects to itself.`, 'self-connection');
			}

			// Strand-set direction and membership.
			const strandIndex = seg.fivePrime.index < seg.threePrime.index ? 0 : 1;
			const strandSets = containingVh.strandSets as Record<string, unknown>[];
			const strandSet = strandSets.find((ss) => ss.strandIndex === strandIndex);
			if (!strandSet || !(strandSet.segmentIds as string[]).includes(seg.id)) {
				reject(
					`Segment "${seg.id}" is listed in a strand set whose direction does not match the order of its "fivePrime" and "threePrime" indices.`,
					'reference'
				);
			}

			// Slot coverage: present, non-empty, exactly covering [min,max], no gaps/dupes/out-of-range.
			const lo = Math.min(seg.fivePrime.index, seg.threePrime.index);
			const hi = Math.max(seg.fivePrime.index, seg.threePrime.index);
			if (seg.slots.length === 0) reject(`Segment "${seg.id}" has no slots.`, 'slot-coverage');
			const bpSeen = new Set<number>();
			for (const slot of seg.slots) {
				if (slot.bpIndex < lo || slot.bpIndex > hi) {
					reject(
						`Segment "${seg.id}" has a slot outside its own [${lo}, ${hi}] range.`,
						'slot-coverage'
					);
				}
				if (bpSeen.has(slot.bpIndex))
					reject(`Segment "${seg.id}" has a duplicate slot at ${slot.bpIndex}.`, 'slot-coverage');
				bpSeen.add(slot.bpIndex);
			}
			if (bpSeen.size !== hi - lo + 1) {
				reject(`Segment "${seg.id}"'s slots do not fully cover [${lo}, ${hi}].`, 'slot-coverage');
			}

			// 5'->3' join order: ascending bpIndex on the forward strand, descending on reverse.
			if (seg.sequence !== undefined) {
				const ascending = seg.fivePrime.index < seg.threePrime.index;
				const joined = seg.slots
					.slice()
					.sort((a, b) => (ascending ? a.bpIndex - b.bpIndex : b.bpIndex - a.bpIndex))
					.map((s) => s.seq)
					.join('');
				if (seg.sequence !== joined) {
					reject(
						`Segment "${seg.id}" has a "sequence" that does not match the "seq" values in its "slots" from 5' to 3'.`,
						'sequence-slot-mismatch'
					);
				}
			}
		}
	}

	// Overlapping segments within one VH/strand set.
	for (const vh of virtualHelices) {
		const strandSets = vh.strandSets as Record<string, unknown>[];
		for (const ss of strandSets) {
			// Non-null: the strand-set reference check above already rejected any unknown id.
			const segs = (ss.segmentIds as string[]).map((id) => segmentById.get(id)!.seg);
			const intervals = segs.map((s) => {
				const lo = Math.min(s.fivePrime.index, s.threePrime.index);
				const hi = Math.max(s.fivePrime.index, s.threePrime.index);
				return { lo, hi };
			});
			for (let i = 0; i < intervals.length; i++) {
				for (let j = i + 1; j < intervals.length; j++) {
					if (intervals[i].lo <= intervals[j].hi && intervals[j].lo <= intervals[i].hi) {
						reject(`Virtual helix "${vh.id}" has two overlapping segments on the same strand.`);
					}
				}
			}
		}
	}

	// Connection reciprocity, intra-oligo requirement, and each oligo is one chain or one cycle.
	for (const o of oligos) {
		const segs = o.segments as unknown as SegmentJSON[];
		const degree = new Map<string, number>(segs.map((s) => [s.id, 0]));
		const neighbors = new Map<string, string[]>(segs.map((s) => [s.id, []]));

		for (const seg of segs) {
			for (const end of [seg.fivePrime, seg.threePrime] as SegmentEndJSON[]) {
				if (end.connectedSegmentId === null) continue;
				const target = segmentById.get(end.connectedSegmentId);
				if (!target)
					reject(
						`Segment "${seg.id}" connects to unknown segment "${end.connectedSegmentId}".`,
						'reference'
					);
				if (target!.oligoId !== o.id) {
					reject(`Segment "${seg.id}" connects to a segment in a different oligo.`, 'reference');
				}

				// Reciprocity: 3'->5' convention.
				const connectedSeg = segs.find((s) => s.id === end.connectedSegmentId)!;
				const reciprocalEnd = end.isThreePrime ? connectedSeg.fivePrime : connectedSeg.threePrime;
				if (reciprocalEnd.connectedSegmentId !== seg.id) {
					reject(
						`Segment "${seg.id}" connects to "${end.connectedSegmentId}", which does not connect back.`,
						'reciprocity'
					);
				}

				degree.set(seg.id, (degree.get(seg.id) ?? 0) + 1);
				neighbors.get(seg.id)!.push(end.connectedSegmentId);
			}
		}

		if (segs.length === 1) continue; // single isolated segment — always valid.
		const degreeOneCount = segs.filter((s) => degree.get(s.id) === 1).length;
		const degreeTwoCount = segs.filter((s) => degree.get(s.id) === 2).length;
		const isPath = degreeOneCount === 2 && degreeTwoCount === segs.length - 2;
		const isCycle = degreeOneCount === 0 && degreeTwoCount === segs.length;
		if (!isPath && !isCycle) {
			reject(
				`Oligo "${o.id}" cannot form one open chain or one closed loop from its segment connections.`,
				'reference'
			);
		}
		// Connectivity: a walk from one segment must reach every segment in the oligo.
		const start = segs[0].id;
		const visited = new Set([start]);
		const stack = [start];
		while (stack.length > 0) {
			const cur = stack.pop()!;
			for (const next of neighbors.get(cur) ?? []) {
				if (!visited.has(next)) {
					visited.add(next);
					stack.push(next);
				}
			}
		}
		if (visited.size !== segs.length) {
			reject(
				`Oligo "${o.id}" contains separate groups of segments that are not connected.`,
				'reference'
			);
		}
	}

	// --- customModifications / overlayPlacements ---------------------------------------------------------
	if (top.customModifications !== undefined) {
		if (!Array.isArray(top.customModifications)) reject('"customModifications" must be an array.');
		for (const m of top.customModifications as Record<string, unknown>[]) {
			if (!isObj(m)) reject('A custom modification must be an object.');
			if (typeof m.name !== 'string' || typeof m.color !== 'string') {
				reject('A custom modification is missing a string "name"/"color".');
			}
		}
	}
	if (top.overlayPlacements !== undefined) {
		if (!Array.isArray(top.overlayPlacements)) reject('"overlayPlacements" must be an array.');
		const overlayIds = new Set<string>();
		for (const p of top.overlayPlacements as Record<string, unknown>[]) {
			if (!isObj(p)) reject('An overlay placement must be an object.');
			if (!isNonEmptyString(p.id) || !isNonEmptyString(p.sourceKey)) {
				reject('An overlay placement is missing a non-empty "id"/"sourceKey".');
			}
			const transform = p.transform as Record<string, unknown>;
			if (
				typeof transform !== 'object' ||
				transform === null ||
				!isVec3(transform.position) ||
				!Array.isArray(transform.quaternion) ||
				transform.quaternion.length !== 4 ||
				!(transform.quaternion as unknown[]).every((n) => isFiniteNum(n))
			) {
				reject(`Overlay placement "${p.id}" has a malformed "transform".`);
			}
			if (overlayIds.has(p.id as string)) reject(`Duplicate overlay placement id "${p.id}".`);
			overlayIds.add(p.id as string);
		}
	}

	return top as PartJSON;
}
