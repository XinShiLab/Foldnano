import type { DrawingDimensions } from '../../components/Editor/StrandView/drawingDimensions';

import type { Part } from '../../model/Part';
import type { Category, HitResult } from '../core/modes';

export interface HitTester {
	hitRsp(world: {
		x: number;
		y: number;
	}): { rowIdx: number; strandIdx: 0 | 1; bpIdx: number } | null;
	hitXAsBpPos(world: { x: number; y: number }): number;
	hitAt(world: { x: number; y: number }, additionalId?: string | null): HitResult[];
	queryRect(rect: { x: number; y: number; width: number; height: number }): HitResult[];
}

export function makeETMHitTester(drawingDimensions: DrawingDimensions, part: Part): HitTester {
	return {
		/** Methods that convert relative {x, y} to hitResult */
		hitRsp(p: { x: number; y: number }) {
			const rsp = drawingDimensions.getHitGridByXY(p.x, p.y);
			return rsp;
		},
		hitXAsBpPos(p: { x: number; y: number }): number {
			return drawingDimensions.getBpIdxByX(p.x);
		},
		hitAt(p: { x: number; y: number }, additionalId?: string | null): HitResult[] {
			const result = new Set() as Set<HitResult>;
			let directIsControl = false;
			if (additionalId) {
				// additionalId has format like kind#restOfId, we need to parse it
				const [kind, ...rest] = additionalId.split('#');
				const id = rest.join('#');
				let category: Category = kind === 'REGION_HEADER' ? 'CONTROL' : 'UNKNOWN';
				if (kind === 'XOVER') {
					const fromOligo = part.getSegmentById(rest[0])?.oligo;
					if (fromOligo) category = fromOligo.isScaffold ? 'SCAF' : 'STAP';
				}
				result.add({ kind: kind as HitResult['kind'], id, category });
				if (category === 'CONTROL') directIsControl = true;
			}
			// When the user clicked a CONTROL element (e.g. a region header / its
			// icons), don't fall through to the spatial RSP hit — the click was on a
			// UI affordance, not on a strand cell. Otherwise tools like DRAW can
			// mis-interpret the click as starting a new strand.
			if (directIsControl) return Array.from(result);
			const rsp = drawingDimensions.getHitGridByXY(p.x, p.y);
			if (!rsp) {
				return Array.from(result);
			}
			result.add({
				kind: 'VH_GRID',
				id: `${rsp.rowIdx}-${rsp.strandIdx}-${rsp.bpIdx}`,
				category: 'VH',
			});

			const vh = drawingDimensions.getVisibleVhByDisplayRow(rsp.rowIdx);
			if (!vh) {
				return Array.from(result);
			}

			const targets = part.getEntitiesAtVh(vh.id, rsp.strandIdx, rsp.bpIdx);
			// console.log('part.oligos in hitTester: ', part.oligos);
			// if (targets.vh) {
			//   // result.add({ kind: 'VH_GRID', id: targets.vh.id, category: 'VH' });
			// }
			if (targets.oligo) {
				result.add({
					kind: 'OLIGO',
					id: targets.oligo.id,
					category: targets.oligo.isScaffold ? 'SCAF' : 'STAP',
				});
			}
			if (targets.segment) {
				result.add({
					kind: 'SEGMENT',
					id: targets.segment.id,
					category: targets.oligo?.isScaffold ? 'SCAF' : 'STAP',
				});
			}
			if (targets.end) {
				const t = targets.end.isThreePrime ? '3' : '5';
				const f = targets.end.isFree ? 'FREE' : 'CONN'; // connected/free end distinction
				result.add({
					kind: 'END',
					id: `${targets.segment?.id}#${t}#${f}`,
					category: targets.oligo?.isScaffold ? 'SCAF' : 'STAP',
				});
			}
			// console.log('hitAt', p, '->', Array.from(result));
			return Array.from(result);
		},

		queryRect(_rect: { x: number; y: number; width: number; height: number }): HitResult[] {
			const rsp = drawingDimensions.queryRect(_rect);
			if (!rsp.rows.length || !rsp.strands.length || !rsp.bpIndices.length) return [];

			const entities = part.queryEntitiesInVhRange(
				rsp.vhIds,
				rsp.strands as (0 | 1)[],
				Math.min(...rsp.bpIndices),
				Math.max(...rsp.bpIndices)
			);
			const hits = new Set<HitResult>();
			const ids = new Set<string>();

			for (const { segment, oligo, fivePrimeInRange, threePrimeInRange } of entities) {
				if (oligo && !ids.has(oligo.id)) {
					ids.add(oligo.id);
					hits.add({ kind: 'OLIGO', id: oligo.id, category: oligo.isScaffold ? 'SCAF' : 'STAP' });
				}
				if (!ids.has(segment.id)) {
					ids.add(segment.id);
					hits.add({
						kind: 'SEGMENT',
						id: segment.id,
						category: oligo?.isScaffold ? 'SCAF' : 'STAP',
					});
				}
				const addEnd = (isThreePrime: boolean, isFree: boolean) => {
					const t = isThreePrime ? '3' : '5';
					const f = isFree ? 'FREE' : 'CONN';
					const endId = `${segment.id}#${t}#${f}`;
					if (!ids.has(endId)) {
						ids.add(endId);
						hits.add({ kind: 'END', id: endId, category: oligo?.isScaffold ? 'SCAF' : 'STAP' });
					}
				};
				if (fivePrimeInRange) addEnd(false, segment.fivePrime.isFree);
				if (threePrimeInRange) addEnd(true, segment.threePrime.isFree);
			}

			return Array.from(hits);
		},
	};
}
