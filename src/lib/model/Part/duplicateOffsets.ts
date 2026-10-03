import type Oligo from '../Oligo';
import type { Part } from './Part.svelte';

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Snap step for placing copies: the helical repeat (`step`) of every region the oligos
 * touch, combined by LCM so the copy stays in phase in each of them. */
export function duplicateSnapStep(part: Part, oligos: Iterable<Oligo>): number {
	let step = 1;
	for (const oligo of oligos) {
		for (const seg of oligo.segments) {
			const regionStep = part.getRegionForVh(seg.inVirtualHelix).step;
			step = (step * regionStep) / gcd(step, regionStep);
		}
	}
	return step;
}

/** The first valid offset strictly beyond `fromDelta` in `direction`, stepping by `step`.
 * Rightward always terminates (past every strand the space is free); `maxTries` bounds the
 * leftward search, which can run out of room at bp 0. */
export function findNextValidDuplicateDelta(
	part: Part,
	oligos: Oligo[],
	fromDelta: number,
	direction: 1 | -1,
	step: number,
	maxTries = 1000
): number | null {
	for (let i = 1; i <= maxTries; i++) {
		const delta = fromDelta + direction * i * step;
		if (delta === 0) continue;
		if (part.canDuplicateOligosBy(oligos, delta).ok) return delta;
	}
	return null;
}
