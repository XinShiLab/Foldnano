import { AmbiguousLatticeError, type CadnanoLattice } from '$lib/model/io/cadnanoLattice';

interface PendingLatticeChoice {
	readonly fileName: string;
	readonly numBases: number;
	readonly resolve: (lattice: CadnanoLattice | null) => void;
}

/** One lattice question at a time, answered by the `LatticeChoiceDialog` mounted in the editor. */
class LatticeChoice {
	pending = $state<PendingLatticeChoice | null>(null);

	ask(fileName: string, numBases: number): Promise<CadnanoLattice | null> {
		this.pending?.resolve(null);
		return new Promise((resolve) => {
			this.pending = { fileName, numBases, resolve };
		});
	}

	answer(lattice: CadnanoLattice | null): void {
		const pending = this.pending;
		this.pending = null;
		pending?.resolve(lattice);
	}
}

export const latticeChoice = new LatticeChoice();

export class LatticeChoiceCancelledError extends Error {
	constructor(fileName: string) {
		super(`Import of "${fileName}" cancelled: no lattice chosen.`);
		this.name = 'LatticeChoiceCancelledError';
	}
}

/** Runs `build`; if the file fits both lattices, asks the user and runs it again with their choice. */
export async function withLatticeChoice<T>(
	fileName: string,
	build: (lattice?: CadnanoLattice) => T | Promise<T>,
	lattice?: CadnanoLattice
): Promise<T> {
	try {
		return await build(lattice);
	} catch (err) {
		if (!(err instanceof AmbiguousLatticeError)) throw err;
		const chosen = await latticeChoice.ask(fileName, err.numBases);
		if (!chosen) throw new LatticeChoiceCancelledError(fileName);
		return await build(chosen);
	}
}

/** Parses a `?lattice=` value; `undefined` when absent, `null` when unrecognised. */
export function parseLatticeParam(value: string | null): CadnanoLattice | null | undefined {
	if (value === null) return undefined;
	const upper = value.trim().toUpperCase();
	return upper === 'HONEYCOMB' || upper === 'SQUARE' ? upper : null;
}
