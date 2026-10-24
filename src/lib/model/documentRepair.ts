import { v4 as uuidv4 } from 'uuid';
import type { DocSnapshot } from './document.svelte';
import { HEX_INTERHELIX_NM, SQ_INTERHELIX_NM } from './geometry3d/dnaGeometry';

type PartJson = DocSnapshot['parts'][number];
type OligoJson = PartJson['oligos'][number];
type SegmentJson = OligoJson['segments'][number];
type EndJson = SegmentJson['fivePrime'];

export interface DocumentRepairResult {
	snapshot: DocSnapshot;
	/** One human-readable line per kind of fix; empty when the document was already consistent. */
	repairs: string[];
}

/**
 * Restores the oligo ↔ strandSet invariants a buggy undo could break: every VH strandSet id
 * names a segment some oligo owns, every owned segment is listed on its VH in the strand its
 * direction implies, crossover links are reciprocal within one oligo, and each oligo is one
 * connected piece. Run only where data enters the editor (load, import, pull), never inside
 * `FoldnanoDocument.fromJSON`: undo snapshots and history verification must see real damage.
 */
export function repairDocumentJson(snapshot: DocSnapshot): DocumentRepairResult {
	const repairs: string[] = [];
	const parts = snapshot.parts.map((part) => repairPart(part, repairs));
	if (repairs.length === 0) return { snapshot, repairs };
	return { snapshot: { ...snapshot, parts }, repairs };
}

const strandIndexOf = (segment: SegmentJson): 0 | 1 =>
	segment.fivePrime.index < segment.threePrime.index ? 0 : 1;

function repairPart(input: PartJson, repairs: string[]): PartJson {
	const part = structuredClone(input);
	const label = (what: string) => `${what}${part.name ? ` in part "${part.name}"` : ''}`;
	const vhIndices = new Set(part.virtualHelices.map((vh) => vh.index));

	// 1. Ownership: drop segments on a missing VH, and second claims on a segment id.
	const owner = new Map<string, OligoJson>();
	const segmentById = new Map<string, SegmentJson>();
	let onMissingVh = 0;
	let duplicates = 0;
	for (const oligo of part.oligos) {
		oligo.segments = oligo.segments.filter((segment) => {
			if (!vhIndices.has(segment.inVirtualHelixIndex)) {
				onMissingVh++;
				return false;
			}
			if (owner.has(segment.id)) {
				duplicates++;
				return false;
			}
			owner.set(segment.id, oligo);
			segmentById.set(segment.id, segment);
			return true;
		});
	}
	if (onMissingVh) repairs.push(label(`Removed ${onMissingVh} segment(s) on deleted helices`));
	if (duplicates) repairs.push(label(`Removed ${duplicates} segment(s) claimed by two oligos`));

	// 2. Links: keep a crossover only if both ends point at each other within one oligo.
	let brokenLinks = 0;
	const isReciprocal = (segment: SegmentJson, end: EndJson): boolean => {
		const partner = end.connectedSegmentId ? segmentById.get(end.connectedSegmentId) : undefined;
		if (!partner || owner.get(partner.id) !== owner.get(segment.id)) return false;
		const partnerEnd = end.isThreePrime ? partner.fivePrime : partner.threePrime;
		return partnerEnd.connectedSegmentId === segment.id;
	};
	for (const segment of segmentById.values()) {
		for (const end of [segment.fivePrime, segment.threePrime]) {
			if (end.connectedSegmentId === null || isReciprocal(segment, end)) continue;
			end.connectedSegmentId = null;
			end.isConstrained = false;
			brokenLinks++;
		}
	}
	if (brokenLinks) repairs.push(label(`Cleared ${brokenLinks} dangling crossover link(s)`));

	// 3. Split oligos that are no longer one connected piece; drop empty ones.
	const oligos: OligoJson[] = [];
	let splits = 0;
	let emptied = 0;
	for (const oligo of part.oligos) {
		const pieces = connectedPieces(oligo.segments, segmentById);
		if (pieces.length === 0) {
			emptied++;
			continue;
		}
		oligos.push({ ...oligo, segments: pieces[0] });
		for (const piece of pieces.slice(1)) {
			splits++;
			// A split-off piece is a plain oligo: it is no longer the mirror the group tracks.
			const { repeatGroupId: _group, mirrorOf: _mirror, ...rest } = oligo;
			const split: OligoJson = { ...rest, id: uuidv4(), segments: piece };
			for (const segment of piece) owner.set(segment.id, split);
			oligos.push(split);
		}
	}
	part.oligos = oligos;
	if (emptied) repairs.push(label(`Removed ${emptied} oligo(s) left with no segments`));
	if (splits) repairs.push(label(`Split off ${splits} disconnected oligo piece(s)`));

	// 4. StrandSets: exactly the owned segments on this VH, each in its direction's strand.
	let unowned = 0;
	let unlisted = 0;
	const listed = new Set<string>();
	for (const vh of part.virtualHelices) {
		for (const [strandIndex, strandSet] of vh.strandSets.entries()) {
			const kept = strandSet.segmentIds.filter((id) => {
				const segment = segmentById.get(id);
				const belongs =
					segment !== undefined &&
					segment.inVirtualHelixIndex === vh.index &&
					strandIndexOf(segment) === strandIndex &&
					!listed.has(id);
				if (!belongs) unowned++;
				else listed.add(id);
				return belongs;
			});
			if (kept.length !== strandSet.segmentIds.length) strandSet.segmentIds = kept;
		}
	}
	const vhByIndex = new Map(part.virtualHelices.map((vh) => [vh.index, vh]));
	for (const segment of segmentById.values()) {
		if (listed.has(segment.id)) continue;
		vhByIndex
			.get(segment.inVirtualHelixIndex)!
			.strandSets[strandIndexOf(segment)].segmentIds.push(segment.id);
		unlisted++;
	}
	if (unowned) repairs.push(label(`Removed ${unowned} helix entries with no matching segment`));
	if (unlisted) repairs.push(label(`Re-linked ${unlisted} segment(s) missing from their helix`));

	// 5. Lattice cells: no negative row/col (the grid and parity math assume >= 0).
	shiftNegativeLatticeCells(part, repairs, label);

	return part;
}

/** One lattice period in plane units: shifting by it moves helices onto equivalent cells. */
function latticeStepNm(kind: string): { perCol: number; perTwoRows: number } {
	if (kind === 'SQUARE') return { perCol: SQ_INTERHELIX_NM, perTwoRows: 2 * SQ_INTERHELIX_NM };
	const r = HEX_INTERHELIX_NM / 2;
	return { perCol: Math.sqrt(3) * r, perTwoRows: 6 * r };
}

const evenCeil = (n: number) => 2 * Math.ceil(n / 2);

/**
 * Moves a region's helices up/right by an even number of rows/cols (keeping cell parity) and its
 * plane back by the same distance, so no helix moves in 3D. A plane another region also uses is
 * copied first, so that region stays put.
 */
function shiftNegativeLatticeCells(
	part: PartJson,
	repairs: string[],
	label: (what: string) => string
): void {
	for (const region of part.regions) {
		if (region.kind !== 'SQUARE' && region.kind !== 'HONEYCOMB') continue;
		const cells = part.virtualHelices
			.filter((vh) => vh.regionId === region.id && vh.latticeCoords)
			.map((vh) => vh.latticeCoords!);
		if (cells.length === 0) continue;
		const dRow = evenCeil(Math.max(0, -Math.min(...cells.map((c) => c.row))));
		const dCol = evenCeil(Math.max(0, -Math.min(...cells.map((c) => c.col))));
		if (dRow === 0 && dCol === 0) continue;

		for (const cell of cells) {
			cell.row += dRow;
			cell.col += dCol;
		}
		const sharedPlane = part.regions.some((r) => r !== region && r.planeId === region.planeId);
		const source = part.planes.find((p) => p.id === region.planeId);
		if (source) {
			const plane = sharedPlane ? { ...structuredClone(source), id: uuidv4() } : source;
			if (sharedPlane) {
				part.planes.push(plane);
				region.planeId = plane.id;
			}
			const { perCol, perTwoRows } = latticeStepNm(region.kind);
			const dx = dCol * perCol;
			const dy = (dRow / 2) * perTwoRows;
			for (const axis of ['x', 'y', 'z'] as const) {
				plane.origin[axis] -= dx * plane.u[axis] + dy * plane.v[axis];
			}
		}
		repairs.push(
			label(
				`Moved region "${region.name}" ${dRow} row(s) and ${dCol} column(s) so no helix sits at a negative lattice position; its 3D position is unchanged`
			)
		);
	}
}

function connectedPieces(
	segments: SegmentJson[],
	segmentById: Map<string, SegmentJson>
): SegmentJson[][] {
	const remaining = new Set(segments);
	const pieces: SegmentJson[][] = [];
	for (const start of segments) {
		if (!remaining.has(start)) continue;
		remaining.delete(start);
		const piece: SegmentJson[] = [];
		const stack = [start];
		while (stack.length) {
			const segment = stack.pop()!;
			piece.push(segment);
			for (const end of [segment.fivePrime, segment.threePrime]) {
				const next = end.connectedSegmentId ? segmentById.get(end.connectedSegmentId) : undefined;
				if (!next || !remaining.has(next)) continue;
				remaining.delete(next);
				stack.push(next);
			}
		}
		// Keep the piece's segments in the oligo's original order.
		const inPiece = new Set(piece);
		pieces.push(segments.filter((segment) => inPiece.has(segment)));
	}
	return pieces;
}
