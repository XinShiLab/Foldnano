import { describe, it, expect } from 'vitest';
import { AmbiguousLatticeError, type CadnanoLattice } from '$lib/model/io/cadnanoLattice';
import {
	LatticeChoiceCancelledError,
	latticeChoice,
	parseLatticeParam,
	withLatticeChoice,
} from './latticeChoice.svelte';

function ambiguousUnlessChosen(lattice?: CadnanoLattice): string {
	if (!lattice) throw new AmbiguousLatticeError(672);
	return lattice;
}

describe('parseLatticeParam', () => {
	it('reads honeycomb and square in any case, and flags anything else', () => {
		expect(parseLatticeParam(null)).toBeUndefined();
		expect(parseLatticeParam('Honeycomb')).toBe('HONEYCOMB');
		expect(parseLatticeParam(' square ')).toBe('SQUARE');
		expect(parseLatticeParam('hex')).toBeNull();
	});
});

describe('withLatticeChoice', () => {
	it('builds directly when the lattice is known', async () => {
		await expect(withLatticeChoice('a.json', ambiguousUnlessChosen, 'SQUARE')).resolves.toBe(
			'SQUARE'
		);
		expect(latticeChoice.pending).toBeNull();
	});

	it('asks when the file is ambiguous and builds again with the answer', async () => {
		const result = withLatticeChoice('a.json', ambiguousUnlessChosen);
		await Promise.resolve();
		expect(latticeChoice.pending).toMatchObject({ fileName: 'a.json', numBases: 672 });

		latticeChoice.answer('HONEYCOMB');

		await expect(result).resolves.toBe('HONEYCOMB');
		expect(latticeChoice.pending).toBeNull();
	});

	it('rejects when the user cancels', async () => {
		const result = withLatticeChoice('a.json', ambiguousUnlessChosen);
		await Promise.resolve();

		latticeChoice.answer(null);

		await expect(result).rejects.toBeInstanceOf(LatticeChoiceCancelledError);
	});

	it('passes other errors through without asking', async () => {
		await expect(
			withLatticeChoice('a.json', () => {
				throw new Error('broken');
			})
		).rejects.toThrow('broken');
		expect(latticeChoice.pending).toBeNull();
	});
});
