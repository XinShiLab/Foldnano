// Host side of the foldnano_mini parity golden. Builds lattice parts with the real model, records
// what the host computes (crossover sites, isConstrained) and which create / move / connect ops it
// accepts, and checks that against the committed golden that
// python/tests/test_foldnano_mini_parity.py replays through the Python checks.
// Regenerate with UPDATE_FOLDNANO_MINI_PARITY=1.

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

import FoldnanoDocument from '$lib/model/document.svelte';
import type Oligo from '$lib/model/Oligo';
import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
import { Part } from '$lib/model/Part';
import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';
import { makeCrossoverCmd } from '$lib/commands/strands';
import { createTestHistory } from '$lib/commands/test/undoRoundTrip';
import { dispatchOp } from './opDispatch';

const GOLDEN_PATH = path.resolve(
	__dirname,
	'python/tests/fixtures/foldnano_mini_parity.golden.json'
);
const UPDATING = process.env.UPDATE_FOLDNANO_MINI_PARITY === '1';

type PartJson = ReturnType<Part['toJSON']>;

interface SceneGolden {
	name: string;
	part: PartJson;
	sites: Record<string, [number, number, boolean][][]>;
	moves: [string, boolean, number, boolean][];
	creates: [number, number, number, boolean][];
	connects: [string, string, boolean][];
	/** Composite edits: [call, args, threw, changed, structure after (null when it threw)]. */
	outcomes: [string, (string | number)[], boolean, boolean, Structure | null][];
}

/** Id-free topology: per oligo [circular, [[vh, five, three], ...] 5'→3'], sorted. */
type Structure = [boolean, number[][]][];

function structure(part: Part): Structure {
	const out = [...part.oligos].map((oligo): [boolean, number[][]] => {
		const segs = [...oligo.segments];
		let start: OligoSegment | undefined = segs.find((s) => s.fivePrime.isFree);
		const circular = !start;
		const key = (s: OligoSegment) => [
			s.inVirtualHelix.index,
			s.fivePrime.index,
			s.threePrime.index,
		];
		if (!start) start = [...segs].sort((a, b) => compareTuple(key(a), key(b)))[0];
		const path: number[][] = [];
		let cur: OligoSegment | null = start;
		while (cur && path.length < segs.length) {
			path.push(key(cur));
			cur = cur.threePrime.connectedSegment;
		}
		return [circular, path];
	});
	return out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function compareTuple(a: number[], b: number[]): number {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return 0;
}

/** Runs `edit` on a fresh copy of the scene and records how the host answered. */
function outcome(
	json: PartJson,
	call: string,
	args: (string | number)[],
	edit: (part: Part, doc: FoldnanoDocument) => void
): SceneGolden['outcomes'][number] {
	const doc = new FoldnanoDocument();
	const part = Part.fromJSON(json);
	doc.parts.push(part);
	const before = JSON.stringify(structure(part));
	try {
		edit(part, doc);
	} catch {
		return [call, args, true, false, null];
	}
	const after = structure(part);
	return [call, args, false, JSON.stringify(after) !== before, after];
}

function at(part: Part, vhIdx: number, strandIdx: 0 | 1, bp: number) {
	const vh = part.getVhByIndex(vhIdx)!;
	return part.getOligoByVh(vh.id, strandIdx, bp);
}

function oligoById(part: Part, id: string): Oligo {
	const oligo = part.getOligoById(id);
	if (!oligo) throw new Error(`no oligo ${id}`);
	return oligo;
}

function buildScene(kind: 'HONEYCOMB' | 'SQUARE'): Part {
	const part = Part.forType(kind, `${kind.toLowerCase()}-parity`, 'part-id');
	const region = part.getDefaultRegion() as LatticedDesignRegion;
	const coords: [number, number][] = [
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 1],
		[2, 0],
	];
	const vhs = coords.map(([col, row], i) => region.addVhAtCoords(part, col, row, `vh-${i}`));
	const last = vhs[0].length - 1;

	const create = (vhIdx: number, five: number, three: number, id: string) =>
		part.createOligo(vhs[vhIdx], five, three, '#888888', {
			oligoId: `o-${id}`,
			segmentId: `s-${id}`,
		});

	// A crossover on a lattice site (constrained) ...
	const site = part.potentialXoverSites(0)[0].find((s) => s.toVhIdx === 1 && s.bpIdx >= 5)!;
	create(0, 0, site.bpIdx, 'site-a');
	create(1, site.bpIdx, 0, 'site-b');
	// ... one off any site (unconstrained) ...
	create(2, last - 4, last - 14, 'free-a');
	create(3, 6, 16, 'free-b');
	// ... and plain segments to move into or create against.
	create(1, site.bpIdx + 4, last - 2, 'plain-a');
	create(4, 0, last, 'plain-b');
	create(3, last, last - 10, 'plain-c');
	for (const [from, to] of [
		['site-a', 'site-b'],
		['free-a', 'free-b'],
	]) {
		part.connectSegmentEnds(part.getSegmentById(`s-${from}`)!, part.getSegmentById(`s-${to}`)!);
	}
	return part;
}

/** Part JSON with the ids `Part.forType` randomises pinned, so the golden is stable. */
function stableJson(part: Part): PartJson {
	let text = JSON.stringify(part.toJSON());
	part.regions.forEach((region, i) => {
		text = text.split(region.id).join(`region-${i}`);
	});
	part.planes.forEach((plane, i) => {
		text = text.split(plane.id).join(`plane-${i}`);
	});
	return JSON.parse(text);
}

function accepts(json: PartJson, op: Parameters<typeof dispatchOp>[0]): boolean {
	const fresh = Part.fromJSON(json);
	try {
		dispatchOp(op, fresh);
		return true;
	} catch {
		return false;
	}
}

function goldenFor(kind: 'HONEYCOMB' | 'SQUARE'): SceneGolden {
	const part = buildScene(kind);
	const json = stableJson(part);
	const vhs = part.virtualHelices;
	const segmentIds = [...part.segmentsLookup.keys()].sort();

	const sites: SceneGolden['sites'] = {};
	for (const vh of vhs) {
		sites[vh.index] = part
			.potentialXoverSites(vh.index)
			.map((strand) => strand.map((s) => [s.bpIdx, s.toVhIdx, s.right]));
	}

	const moves: SceneGolden['moves'] = [];
	for (const segmentId of segmentIds) {
		for (const isThree of [false, true]) {
			for (let bp = -1; bp <= vhs[0].length; bp++) {
				const op = {
					op: 'move_terminus',
					segmentId,
					end: isThree ? '3' : '5',
					toIndex: bp,
				} as const;
				moves.push([segmentId, isThree, bp, accepts(json, op)]);
			}
		}
	}

	const last = vhs[0].length - 1;
	const ranges: [number, number][] = [
		[0, 4],
		[4, 0],
		[10, 20],
		[20, 10],
		[last - 6, last],
		[last, last - 6],
		[0, last],
		[last, 0],
		[-1, 3],
		[last - 1, last + 1],
	];
	const creates: SceneGolden['creates'] = [];
	for (const vh of vhs) {
		for (const [five, three] of ranges) {
			const op = {
				op: 'create_segment',
				vhId: vh.id,
				fiveIndex: five,
				threeIndex: three,
				color: '#888888',
				isScaffold: false,
				name: null,
				newOligoId: 'o-new',
				newSegmentId: 's-new',
			} as const;
			creates.push([vh.index, five, three, accepts(json, op)]);
		}
	}

	const connects: SceneGolden['connects'] = [];
	for (const from of segmentIds) {
		for (const to of segmentIds) {
			const op = { op: 'connect', fromSegmentId: from, toSegmentId: to } as const;
			connects.push([from, to, accepts(json, op)]);
		}
	}

	const outcomes: SceneGolden['outcomes'] = [];
	// Interesting bps: every segment's ends and their neighbours, plus its middle.
	const probes = new Set<string>();
	for (const id of segmentIds) {
		const seg = part.getSegmentById(id)!;
		const vhIdx = seg.inVirtualHelix.index;
		const { fivePrime: f, threePrime: t } = seg;
		for (const bp of [f.index, t.index, Math.round((f.index + t.index) / 2)]) {
			for (const d of [-2, -1, 0, 1, 2]) {
				for (const strand of [0, 1] as const) probes.add(`${vhIdx},${strand},${bp + d}`);
			}
		}
	}
	const positions = [...probes]
		.map((p) => p.split(',').map(Number) as [number, 0 | 1, number])
		.sort(compareTuple);

	for (const [vhIdx, strand, bp] of positions) {
		outcomes.push(
			outcome(json, 'break_at', [vhIdx, strand, bp], (p) => {
				const hit = at(p, vhIdx, strand, bp);
				if (!hit) throw new Error('no strand');
				p.breakOligoAt(hit.oligo, hit.segment, bp);
			})
		);
	}
	const oligoIds = [...part.oligos].map((o) => o.id).sort();
	// Empty positions all refuse the same way; a few of them are enough.
	const occupied = positions.filter(([v, st, bp]) => at(part, v, st, bp));
	const crossoverTargets = [
		...occupied,
		...positions.filter((p) => !occupied.includes(p)).slice(0, 4),
	];
	for (const fromId of ['o-site-a', 'o-free-a', 'o-plain-b', 'o-plain-c']) {
		for (const [vhIdx, strand, bp] of crossoverTargets) {
			outcomes.push(
				outcome(json, 'create_crossover', [fromId, vhIdx, strand, bp], (p) => {
					const hit = at(p, vhIdx, strand, bp);
					if (!hit) throw new Error('no strand');
					p.createCrossover(oligoById(p, fromId), hit.oligo, hit.segment, bp);
				})
			);
		}
	}
	for (const vh of vhs) {
		part.potentialXoverSites(vh.index).forEach((strandSites, strand) => {
			for (const site of strandSites) {
				const args = [vh.index, strand, site.bpIdx, site.toVhIdx];
				outcomes.push(
					outcome(json, 'make_crossover', args, (p, doc) => {
						makeCrossoverCmd(
							{
								part: p,
								fromVhIdx: vh.index,
								strandIdx: strand as 0 | 1,
								bpIdx: site.bpIdx,
								toVhIdx: site.toVhIdx,
								right: site.right,
							},
							createTestHistory(doc)
						);
					})
				);
			}
		});
	}
	for (const from of oligoIds) {
		for (const to of oligoIds) {
			outcomes.push(
				outcome(json, 'connect_oligos', [from, to], (p) =>
					p.connectTwoOligos(oligoById(p, from), oligoById(p, to))
				)
			);
		}
	}
	for (const vh of vhs) {
		for (const strand of [0, 1] as const) {
			outcomes.push(
				outcome(json, 'fill_empty_strand_set', [vh.index, strand], (p) => {
					p.fillEmptyStrandSet(p.getVhByIndex(vh.index)!, strand);
				})
			);
		}
	}
	for (const id of segmentIds) {
		outcomes.push(
			outcome(json, 'remove_segment', [id], (p) => {
				const seg = p.getSegmentById(id)!;
				p.removeSegmentFromOligo(seg.oligo!, seg);
			})
		);
	}

	return { name: kind, part: json, sites, moves, creates, connects, outcomes };
}

describe('foldnano_mini parity golden', () => {
	it('matches what the host model computes and accepts', { timeout: 30_000 }, () => {
		// canMoveTo reports refusals on console.error; the verdicts are what matter here.
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const golden = { scenes: [goldenFor('HONEYCOMB'), goldenFor('SQUARE')] };
		vi.restoreAllMocks();

		if (UPDATING || !fs.existsSync(GOLDEN_PATH)) {
			fs.writeFileSync(GOLDEN_PATH, JSON.stringify(golden) + '\n');
		}
		const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
		expect(golden).toEqual(committed);
	});
});
