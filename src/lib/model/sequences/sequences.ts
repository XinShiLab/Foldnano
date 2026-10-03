export interface GenerateDNAOptions {
	seed?: number; // Optional seed for reproducible randomness
	avoidHomopolymer?: number; // Max allowed consecutive identical bases (>=2). If unspecified, no constraint.
}

export interface GeneratedDNA {
	length: number;
	gcContentRequested: number;
	gcContentActual: number;
	primary5to3: string;
	complementary5to3: string; // Reverse complement of primary
}

/**
 * Generate a random DNA sequence (5'->3') and its complementary (also 5'->3').
 * Complementary sequence is the reverse complement because of antiparallel strands.
 */
export function generateRandomDNA(
	length: number,
	gcContent: number,
	options: GenerateDNAOptions = {}
): GeneratedDNA {
	if (!Number.isInteger(length) || length <= 0) {
		throw new Error('length must be a positive integer');
	}
	if (gcContent < 0 || gcContent > 1 || !isFinite(gcContent)) {
		throw new Error('gcContent must be between 0 and 1');
	}
	const { seed, avoidHomopolymer } = options;

	// Simple seeded RNG (LCG) fallback to Math.random
	let rand = Math.random;
	if (typeof seed === 'number') {
		let state = seed >>> 0 || 1;
		rand = () => {
			state = (state * 1664525 + 1013904223) >>> 0;
			return state / 0xffffffff;
		};
	}

	const gcTarget = Math.round(length * gcContent);
	const atTarget = length - gcTarget;

	const bases: string[] = [];
	// Split GC roughly equally between G and C, same for A/T.
	const gCount = Math.floor(gcTarget / 2);
	const cCount = gcTarget - gCount;
	const aCount = Math.floor(atTarget / 2);
	const tCount = atTarget - aCount;

	for (let i = 0; i < gCount; i++) bases.push('G');
	for (let i = 0; i < cCount; i++) bases.push('C');
	for (let i = 0; i < aCount; i++) bases.push('A');
	for (let i = 0; i < tCount; i++) bases.push('T');

	// Fisher-Yates shuffle
	for (let i = bases.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[bases[i], bases[j]] = [bases[j], bases[i]];
	}

	// Reduce homopolymers if requested
	if (avoidHomopolymer && avoidHomopolymer >= 2) {
		const maxRun = avoidHomopolymer;
		let runBase = bases[0];
		let runLen = 1;
		for (let i = 1; i < bases.length; i++) {
			if (bases[i] === runBase) {
				runLen++;
				if (runLen > maxRun) {
					// Find a different base ahead to swap
					for (let j = i + 1; j < bases.length; j++) {
						if (bases[j] !== runBase) {
							[bases[i], bases[j]] = [bases[j], bases[i]];
							runLen = 1;
							runBase = bases[i];
							break;
						}
					}
					// If no swap possible, leave as is.
				}
			} else {
				runBase = bases[i];
				runLen = 1;
			}
		}
	}

	const primary = bases.join('');
	const complementary = generateComplementaryDNA(primary);

	const gcActual = (primary.match(/[GC]/g)?.length || 0) / length;

	return {
		length,
		gcContentRequested: gcContent,
		gcContentActual: gcActual,
		primary5to3: primary,
		complementary5to3: complementary,
	};
}

export function generateComplementaryDNA(primary5to3: string) {
	const complementMap: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };
	let complementary = '';
	// Reverse complement: iterate backwards
	for (let i = primary5to3.length - 1; i >= 0; i--) {
		const base = primary5to3[i].toUpperCase();
		const compBase = complementMap[base];
		if (!compBase) {
			throw new Error(`Invalid base '${base}' in primary sequence`);
		}
		complementary += compBase;
	}
	return complementary;
}
