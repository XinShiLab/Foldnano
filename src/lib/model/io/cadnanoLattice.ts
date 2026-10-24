import { toCoord } from '../Part/latticeOffsets';

export type CadnanoLattice = 'SQUARE' | 'HONEYCOMB';

/** The file fits both lattices and its crossovers don't tell them apart; the caller must choose. */
export class AmbiguousLatticeError extends Error {
	readonly candidates: readonly CadnanoLattice[] = ['HONEYCOMB', 'SQUARE'];
	constructor(readonly numBases: number) {
		super(
			`This ${numBases}-base design fits both a honeycomb and a square lattice; choose one to import it.`
		);
		this.name = 'AmbiguousLatticeError';
	}
}

const LATTICE_STEP: Record<CadnanoLattice, number> = { SQUARE: 32, HONEYCOMB: 21 };

type Nt = readonly [number, number, number, number];

interface LatticeVStrand {
	readonly num: number;
	readonly row: number;
	readonly col: number;
	readonly scaf: readonly Nt[];
	readonly stap: readonly Nt[];
}

/** Lattices whose repeat divides the helix length; cadnano JSON has no explicit lattice field. */
export function latticesByLength(numBases: number): CadnanoLattice[] {
	return (['SQUARE', 'HONEYCOMB'] as const).filter((l) => numBases % LATTICE_STEP[l] === 0);
}

// Mirrors isScafToStrandSetIdx in cadnanoJSON.ts: model strand 0 ascends, cadnano `scaf` ascends on even helices.
const strandIndexOf = (num: number, isScaf: boolean): 0 | 1 =>
	(num % 2 === 0 ? Number(!isScaf) : Number(isScaf)) as 0 | 1;

function isSiteToward(
	lattice: CadnanoLattice,
	vs: LatticeVStrand,
	isScaf: boolean,
	bp: number,
	target: LatticeVStrand
): boolean {
	return [false, true].some((right) => {
		const site = toCoord(
			lattice,
			LATTICE_STEP[lattice],
			vs.row % 2 === vs.col % 2, // cell parity, as VirtualHelix.isEvenParity
			strandIndexOf(vs.num, isScaf),
			vs.col,
			vs.row,
			bp,
			right
		);
		return site !== null && site.to.col === target.col && site.to.row === target.row;
	});
}

/** Crossovers that sit on no valid crossover site of `lattice`, seen from either end. */
export function crossoverSiteViolations(
	vstrands: readonly LatticeVStrand[],
	lattice: CadnanoLattice
): number {
	const byNum = new Map(vstrands.map((vs) => [vs.num, vs]));
	let violations = 0;
	for (const vs of vstrands) {
		for (const isScaf of [true, false]) {
			const strand = isScaf ? vs.scaf : vs.stap;
			for (let i = 0; i < strand.length; i++) {
				const [, , toVh, toBp] = strand[i];
				if (toVh === -1 || (toVh === vs.num && Math.abs(toBp - i) === 1)) continue;
				const target = byNum.get(toVh);
				if (!target) continue;
				if (
					!isSiteToward(lattice, vs, isScaf, i, target) &&
					!isSiteToward(lattice, target, isScaf, toBp, vs)
				) {
					violations++;
				}
			}
		}
	}
	return violations;
}

/**
 * Lattices the design could be, best first. Length decides alone unless it fits both (multiples of
 * 672); then crossover sites decide, and two entries mean the file can't tell.
 */
export function latticeCandidates(vstrands: readonly LatticeVStrand[]): CadnanoLattice[] {
	const byLength = latticesByLength(vstrands[0]?.scaf.length ?? 0);
	if (byLength.length < 2) return byLength;
	const square = crossoverSiteViolations(vstrands, 'SQUARE');
	const honeycomb = crossoverSiteViolations(vstrands, 'HONEYCOMB');
	if (square === honeycomb) return byLength;
	return [square < honeycomb ? 'SQUARE' : 'HONEYCOMB'];
}
