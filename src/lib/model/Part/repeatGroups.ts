import { v4 as uuidv4 } from 'uuid';
import type Oligo from '../Oligo';
import type OligoSegment from '../Oligo/OligoSegment.svelte';
import { InvalidOperationError } from '../../errors';
import { MIRROR_EDIT_ERROR, type Part, type RepeatGroup } from './Part.svelte';

// ── Fingerprints ─────────────────────────────────────────────────────────

/** Segments 5'→3' along the oligo. Circular oligos start at the lowest (VH, bp) segment,
 * which is shift-invariant, so an oligo and its shifted mirror order identically. */
function orderedSegments(oligo: Oligo): OligoSegment[] {
	const all = [...oligo.segments].sort(
		(a, b) => a.inVirtualHelix.index - b.inVirtualHelix.index || a.lowIndex - b.lowIndex
	);
	const start = oligo.fivePrimeEndSegment ?? all[0];
	if (!start) return [];
	const ordered: OligoSegment[] = [];
	const seen = new Set<OligoSegment>();
	let current: OligoSegment | null = start;
	while (current && oligo.segments.has(current) && !seen.has(current)) {
		ordered.push(current);
		seen.add(current);
		current = current.threePrime.connectedSegment;
	}
	for (const seg of all) if (!seen.has(seg)) ordered.push(seg);
	return ordered;
}

/** Everything that defines an oligo's content, with bp positions shifted back by `bpShift`
 * so a mirror at offset `bpShift` fingerprints identically to its source. Without
 * `withSequence`, assigned bases are ignored (skip/insert lengths still count). */
export function oligoFingerprint(oligo: Oligo, bpShift = 0, withSequence = true): string {
	const head = `${oligo.isScaffold ? 'S' : 's'}|${oligo.color}|${oligo.name}`;
	const segs = orderedSegments(oligo).map((seg) => {
		const slots = seg.slots.map((s) => (withSequence ? s.seq : s.seq.length)).join(',');
		const five = seg.fivePrime;
		const three = seg.threePrime;
		return (
			`${seg.inVirtualHelix.index}/${seg.inStrandIndex}:` +
			`${five.index - bpShift}>${three.index - bpShift}` +
			`[${slots}]${five.modification ?? ''}/${three.modification ?? ''}` +
			`${three.connectedSegment ? '~' : ''}`
		);
	});
	return [head, ...segs].join(';');
}

const structureOf = (oligo: Oligo, bpShift = 0) => oligoFingerprint(oligo, bpShift, false);

// ── Sync ─────────────────────────────────────────────────────────────────

/**
 * Brings every mirror in line with its source ("original + offset"). Runs at the end of each
 * history transaction. Only mirrors whose source changed (or that are missing) are rebuilt.
 * Throws — rolling back the edit — if a mirror was edited directly, or if a rebuilt mirror
 * can't be placed. Returns whether anything changed.
 */
export function syncRepeatGroups(part: Part): boolean {
	const groups = new Map(part.repeatGroups.map((g) => [g.id, g]));
	const sources = new Map<string, Oligo>();
	const mirrors: Oligo[] = [];
	let changed = false;
	for (const oligo of part.oligos) {
		if (oligo.mirrorOf) mirrors.push(oligo);
		else if (oligo.repeatGroupId) {
			if (groups.has(oligo.repeatGroupId)) sources.set(oligo.id, oligo);
			else {
				oligo.repeatGroupId = null;
				changed = true;
			}
		}
	}
	if (groups.size === 0 && mirrors.length === 0) return changed;

	const sourceStructure = new Map<string, string>();
	const structureOfSource = (src: Oligo) => {
		let s = sourceStructure.get(src.id);
		if (s === undefined) sourceStructure.set(src.id, (s = structureOf(src)));
		return s;
	};

	part._repeatSyncing = true;
	try {
		const upToDate = new Set<string>();
		for (const mirror of mirrors) {
			const tag = mirror.mirrorOf!;
			const group = groups.get(tag.groupId);
			const instance = group?.instances.find((i) => i.id === tag.instanceId);
			const source = sources.get(tag.sourceOligoId);
			const key = `${tag.sourceOligoId}:${tag.instanceId}`;
			if (!instance || !source || source.repeatGroupId !== tag.groupId || upToDate.has(key)) {
				part.removeOligo(mirror);
				changed = true;
				continue;
			}
			const mirrorEdited = structureOf(mirror, instance.bpOffset) !== tag.structure;
			const sourceChanged = structureOfSource(source) !== tag.structure;
			if (mirrorEdited && !sourceChanged) throw new InvalidOperationError(MIRROR_EDIT_ERROR);
			if (
				!mirrorEdited &&
				!sourceChanged &&
				oligoFingerprint(mirror, instance.bpOffset) === oligoFingerprint(source)
			) {
				upToDate.add(key);
				continue;
			}
			part.removeOligo(mirror);
			changed = true;
		}

		// Instances are rebuilt in order so each validates against copies placed before it.
		for (const group of part.repeatGroups) {
			const groupSources = [...sources.values()].filter((s) => s.repeatGroupId === group.id);
			group.instances.forEach((instance, idx) => {
				const stale = groupSources.filter((s) => !upToDate.has(`${s.id}:${instance.id}`));
				if (stale.length === 0) return;
				const check = part.canDuplicateOligosBy(stale, instance.bpOffset);
				if (!check.ok) {
					throw new InvalidOperationError(`Copy ${idx + 1} of ${group.name}: ${check.reason}`);
				}
				const copies = part.duplicateOligos(stale, instance.bpOffset);
				copies.forEach((copy, i) => {
					copy.mirrorOf = {
						groupId: group.id,
						instanceId: instance.id,
						sourceOligoId: stale[i].id,
						structure: structureOfSource(stale[i]),
					};
				});
				changed = true;
			});
		}
	} finally {
		part._repeatSyncing = false;
	}
	return changed;
}

// ── Group operations (mirrors themselves are created/removed by the sync) ──

function nextGroupName(part: Part): string {
	const used = new Set(part.repeatGroups.map((g) => g.name));
	let n = 1;
	while (used.has(`Repeat ${n}`)) n++;
	return `Repeat ${n}`;
}

/** Ids and name a caller supplies instead of generated ones (plugin ops adopt the plugin's). */
export interface RepeatGroupIds {
	groupId?: string;
	instanceId?: string;
	name?: string;
}

/** Makes `oligos` the originals of a new group with one instance at `bpOffset`. */
export function createRepeatGroup(
	part: Part,
	oligos: Oligo[],
	bpOffset: number,
	ids: RepeatGroupIds = {}
): RepeatGroup {
	if (oligos.length === 0) throw new InvalidOperationError('Select oligos to mirror.');
	if (oligos.some((o) => o.isMirror)) {
		throw new InvalidOperationError('Mirrors can only be made from original oligos.');
	}
	if (oligos.some((o) => o.repeatGroupId)) {
		throw new InvalidOperationError('Some selected oligos already belong to a repeat group.');
	}
	if (ids.groupId && part.getRepeatGroup(ids.groupId)) {
		throw new InvalidOperationError(`Repeat group id ${ids.groupId} already exists.`);
	}
	const group: RepeatGroup = {
		id: ids.groupId ?? uuidv4(),
		name: ids.name ?? nextGroupName(part),
		instances: [{ id: ids.instanceId ?? uuidv4(), bpOffset }],
	};
	part.repeatGroups.push(group);
	for (const oligo of oligos) oligo.repeatGroupId = group.id;
	return group;
}

function requireGroup(part: Part, groupId: string): RepeatGroup {
	const group = part.getRepeatGroup(groupId);
	if (!group) throw new InvalidOperationError('Repeat group not found.');
	return group;
}

export function addRepeatInstance(
	part: Part,
	groupId: string,
	bpOffset: number,
	instanceId: string = uuidv4()
): void {
	const group = requireGroup(part, groupId);
	if (bpOffset === 0 || group.instances.some((i) => i.bpOffset === bpOffset)) {
		throw new InvalidOperationError(`${group.name} already has a copy at that offset.`);
	}
	group.instances.push({ id: instanceId, bpOffset });
}

/** Removing the last instance deletes the group (its originals become plain oligos). */
export function removeRepeatInstance(part: Part, groupId: string, instanceId: string): void {
	const group = requireGroup(part, groupId);
	group.instances = group.instances.filter((i) => i.id !== instanceId);
	if (group.instances.length === 0) deleteRepeatGroup(part, groupId);
}

/** Keeps the mirrors as independent oligos and dissolves the group. */
export function detachRepeatGroup(part: Part, groupId: string): void {
	requireGroup(part, groupId);
	for (const oligo of part.oligos) {
		if (oligo.mirrorOf?.groupId === groupId) oligo.mirrorOf = null;
		if (oligo.repeatGroupId === groupId) oligo.repeatGroupId = null;
	}
	part.repeatGroups = part.repeatGroups.filter((g) => g.id !== groupId);
}

/** Removes the group; the sync then deletes its mirrors and releases its originals. */
export function deleteRepeatGroup(part: Part, groupId: string): void {
	requireGroup(part, groupId);
	part.repeatGroups = part.repeatGroups.filter((g) => g.id !== groupId);
}
