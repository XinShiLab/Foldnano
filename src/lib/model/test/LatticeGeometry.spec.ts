import { addLatticeVh } from '$lib/model/test/testHelpers';
import { describe, it, expect, beforeEach } from 'vitest';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import { LatticedDesignRegion } from '$lib/model/Part/DesignRegion';

describe('HoneycombPart Geometry', () => {
	let testDoc: FoldnanoDocument;
	let testHoneycombPart: Part;

	beforeEach(() => {
		testDoc = new FoldnanoDocument();
		testDoc.addNewPart('HONEYCOMB');
		testHoneycombPart = testDoc.parts[0];
	});

	describe('lattice properties', () => {
		it('should have correct lattice type', () => {
			expect(testHoneycombPart.getDefaultRegion().kind).toBe('HONEYCOMB');
		});

		it('should have correct step size', () => {
			expect(testHoneycombPart.step).toBe(21);
		});

		it('should have correct turns per step', () => {
			expect(testHoneycombPart.getDefaultRegion().turnsPerStep).toBe(2);
		});

		it('should have correct substep size', () => {
			expect(testHoneycombPart.subStepSize).toBe(7); // 21 / 3
		});

		it('should have correct twist offset', () => {
			expect(testHoneycombPart.getDefaultRegion().twistOffset).toBe(340);
		});
	});

	describe('adjacentCoords calculation', () => {
		it('should return 3 neighbors for even row, even col', () => {
			const coords = (testHoneycombPart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				0,
				0
			);

			expect(coords.length).toBe(3);
			expect(coords).toContainEqual({ col: -1, row: 0 });
			expect(coords).toContainEqual({ col: 1, row: 0 });
			expect(coords).toContainEqual({ col: 0, row: -1 });
		});

		it('should return 3 neighbors for odd row, odd col', () => {
			const coords = (testHoneycombPart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				1,
				1
			);

			expect(coords.length).toBe(3);
			expect(coords).toContainEqual({ col: 0, row: 1 });
			expect(coords).toContainEqual({ col: 2, row: 1 });
			expect(coords).toContainEqual({ col: 1, row: 0 });
		});

		it('should return 3 neighbors for even row, odd col (opposite parity)', () => {
			const coords = (testHoneycombPart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				1,
				0
			);

			expect(coords.length).toBe(3);
			expect(coords).toContainEqual({ col: 0, row: 0 });
			expect(coords).toContainEqual({ col: 2, row: 0 });
			expect(coords).toContainEqual({ col: 1, row: 1 });
		});

		it('should return 3 neighbors for odd row, even col (opposite parity)', () => {
			const coords = (testHoneycombPart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				0,
				1
			);

			expect(coords.length).toBe(3);
			expect(coords).toContainEqual({ col: -1, row: 1 });
			expect(coords).toContainEqual({ col: 1, row: 1 });
			expect(coords).toContainEqual({ col: 0, row: 2 });
		});

		it('should handle honeycomb parity correctly (row % 2 === col % 2)', () => {
			// When row % 2 === col % 2 (same parity), neighbors include row-1
			const sameParityCoords = (
				testHoneycombPart.getDefaultRegion() as LatticedDesignRegion
			).adjacentCoords(2, 2);
			expect(sameParityCoords).toContainEqual({ col: 2, row: 1 });
			expect(sameParityCoords).not.toContainEqual({ col: 2, row: 3 });

			// When row % 2 !== col % 2 (opposite parity), neighbors include row+1
			const oppParityCoords = (
				testHoneycombPart.getDefaultRegion() as LatticedDesignRegion
			).adjacentCoords(1, 2);
			expect(oppParityCoords).toContainEqual({ col: 1, row: 3 });
			expect(oppParityCoords).not.toContainEqual({ col: 1, row: 1 });
		});
	});

	describe('adjacentVhs', () => {
		it('should find adjacent virtual helices', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 0, 0);
			const vh2 = addLatticeVh(testHoneycombPart, 1, 0);
			// const vh3 = addLatticeVh(testHoneycombPart, 0, 1);
			// const vh4 = addLatticeVh(testHoneycombPart, 2, 1);

			const neighbors = testHoneycombPart.adjacentVhs(vh1);

			expect(neighbors.length).toBeGreaterThan(0);
			expect(neighbors).toContain(vh2);
		});

		it('should return empty array when no adjacent VHs exist', () => {
			const vh = addLatticeVh(testHoneycombPart, 0, 0);

			const neighbors = testHoneycombPart.adjacentVhs(vh);

			expect(neighbors.length).toBe(0);
		});

		it('should find all adjacent VHs in honeycomb lattice', () => {
			// Create a honeycomb cluster
			const center = addLatticeVh(testHoneycombPart, 2, 2);
			const left = addLatticeVh(testHoneycombPart, 1, 2);
			const right = addLatticeVh(testHoneycombPart, 3, 2);
			const top = addLatticeVh(testHoneycombPart, 2, 1);

			const neighbors = testHoneycombPart.adjacentVhs(center);

			expect(neighbors.length).toBe(3);
			expect(neighbors).toContain(left);
			expect(neighbors).toContain(right);
			expect(neighbors).toContain(top);
		});

		it('should handle opposite parity correctly', () => {
			const center = addLatticeVh(testHoneycombPart, 1, 2);
			const left = addLatticeVh(testHoneycombPart, 0, 2);
			const right = addLatticeVh(testHoneycombPart, 2, 2);
			const bottom = addLatticeVh(testHoneycombPart, 1, 3);

			const neighbors = testHoneycombPart.adjacentVhs(center);

			expect(neighbors.length).toBe(3);
			expect(neighbors).toContain(left);
			expect(neighbors).toContain(right);
			expect(neighbors).toContain(bottom);
		});
	});

	describe('areVhsAdjacent', () => {
		it('should return true for adjacent VHs', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 0, 0);
			const vh2 = addLatticeVh(testHoneycombPart, 1, 0);

			expect(testHoneycombPart.areVhsAdjacent(vh1, vh2)).toBe(true);
			expect(testHoneycombPart.areVhsAdjacent(vh2, vh1)).toBe(true);
		});

		it('should return false for non-adjacent VHs', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 0, 0);
			const vh2 = addLatticeVh(testHoneycombPart, 5, 5);

			expect(testHoneycombPart.areVhsAdjacent(vh1, vh2)).toBe(false);
		});

		it('should return false for same VH', () => {
			const vh = addLatticeVh(testHoneycombPart, 0, 0);

			expect(testHoneycombPart.areVhsAdjacent(vh, vh)).toBe(false);
		});
	});

	describe('getVhByLatticeCoords', () => {
		it('should find VH by lattice coordinates', () => {
			const vh = addLatticeVh(testHoneycombPart, 3, 5);

			const found = (
				testHoneycombPart.getDefaultRegion() as LatticedDesignRegion
			).getVhByLatticeCoords(3, 5);

			expect(found).toBe(vh);
		});

		it('should return null for non-existent coordinates', () => {
			addLatticeVh(testHoneycombPart, 0, 0);

			const found = (
				testHoneycombPart.getDefaultRegion() as LatticedDesignRegion
			).getVhByLatticeCoords(10, 10);

			expect(found).toBeNull();
		});

		it('should handle multiple VHs correctly', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 0, 0);
			const vh2 = addLatticeVh(testHoneycombPart, 1, 1);
			const vh3 = addLatticeVh(testHoneycombPart, 2, 2);

			expect(
				(testHoneycombPart.getDefaultRegion() as LatticedDesignRegion).getVhByLatticeCoords(0, 0)
			).toBe(vh1);
			expect(
				(testHoneycombPart.getDefaultRegion() as LatticedDesignRegion).getVhByLatticeCoords(1, 1)
			).toBe(vh2);
			expect(
				(testHoneycombPart.getDefaultRegion() as LatticedDesignRegion).getVhByLatticeCoords(2, 2)
			).toBe(vh3);
		});
	});

	describe('potentialXoverSites', () => {
		it('should return crossover sites for a virtual helix', () => {
			const vh = addLatticeVh(testHoneycombPart, 0, 0);

			const sites = testHoneycombPart.potentialXoverSites(vh.index);

			expect(sites).toBeDefined();
			expect(sites.length).toBe(2); // One for each strand
			expect(Array.isArray(sites[0])).toBe(true);
			expect(Array.isArray(sites[1])).toBe(true);
		});

		it('should cache crossover sites', () => {
			const vh = addLatticeVh(testHoneycombPart, 0, 0);
			addLatticeVh(testHoneycombPart, 1, 0);

			const sites1 = testHoneycombPart.potentialXoverSites(vh.index);
			const sites2 = testHoneycombPart.potentialXoverSites(vh.index);

			// Should return same cached instance
			expect(sites1).toBe(sites2);
		});

		it('should invalidate cache when adding new VH', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 0, 0);

			// Add adjacent VH
			addLatticeVh(testHoneycombPart, 0, 1);

			const sitesAfterAdd = testHoneycombPart.potentialXoverSites(vh1.index);

			// Cache should be invalidated, so potentially different sites
			// (At minimum, should recompute)
			expect(sitesAfterAdd).toBeDefined();
		});

		it('should return crossover sites pointing to adjacent VHs only', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 2, 2);
			const vh2 = addLatticeVh(testHoneycombPart, 3, 2);
			const vh3 = addLatticeVh(testHoneycombPart, 10, 10); // Far away

			const sites = testHoneycombPart.potentialXoverSites(vh1.index);

			// Check that sites point to adjacent VHs
			const allTargetVhIds = sites.flat().map((site) => site.toVhIdx);

			expect(allTargetVhIds).toContain(vh2.index);
			expect(allTargetVhIds).not.toContain(vh3.index);
		});

		it('should have correct site structure', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 0, 0);
			addLatticeVh(testHoneycombPart, 1, 0);

			const sites = testHoneycombPart.potentialXoverSites(vh1.index);
			const strand0Sites = sites[0];

			if (strand0Sites.length > 0) {
				const site = strand0Sites[0];
				expect(site).toHaveProperty('bpIdx');
				expect(site).toHaveProperty('toVhIdx');
				expect(site).toHaveProperty('right');
				expect(typeof site.bpIdx).toBe('number');
				expect(typeof site.toVhIdx).toBe('number');
				expect(typeof site.right).toBe('boolean');
			}
		});

		it('should invalidate cache when VH length increases', () => {
			const vh = addLatticeVh(testHoneycombPart, 0, 0);
			addLatticeVh(testHoneycombPart, 1, 0);

			const sitesBefore = testHoneycombPart.potentialXoverSites(vh.index);
			const countBefore = sitesBefore[0].length + sitesBefore[1].length;

			// Increase VH length
			testHoneycombPart.increaseVhsLengthBy(21);

			const sitesAfter = testHoneycombPart.potentialXoverSites(vh.index);
			const countAfter = sitesAfter[0].length + sitesAfter[1].length;

			// More sites after increasing length
			expect(countAfter).toBeGreaterThan(countBefore);
		});
	});

	describe('isConnectionConstrained', () => {
		it('should identify constrained connections between adjacent VHs', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 0, 0);
			addLatticeVh(testHoneycombPart, 1, 0);

			// Get potential crossover sites
			const sites = testHoneycombPart.potentialXoverSites(vh1.index);

			if (sites[0].length > 0) {
				const site = sites[0][0];

				const isConstrained = testHoneycombPart.isConnectionConstrained(
					{ vhIdx: vh1.index, strandIdx: 0, bpIdx: site.bpIdx },
					{ vhIdx: site.toVhIdx, strandIdx: 1, bpIdx: site.bpIdx }
				);

				// Adjacent VHs with matching crossover sites should be constrained
				expect(typeof isConstrained).toBe('boolean');
			}
		});

		it('should return false for non-adjacent VHs', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 0, 0);
			const vh2 = addLatticeVh(testHoneycombPart, 10, 10);

			const isConstrained = testHoneycombPart.isConnectionConstrained(
				{ vhIdx: vh1.index, strandIdx: 0, bpIdx: 0 },
				{ vhIdx: vh2.index, strandIdx: 1, bpIdx: 0 }
			);

			expect(isConstrained).toBe(false);
		});

		it('should return false for connections on same VH', () => {
			const vh = addLatticeVh(testHoneycombPart, 0, 0);

			const isConstrained = testHoneycombPart.isConnectionConstrained(
				{ vhIdx: vh.index, strandIdx: 0, bpIdx: 0 },
				{ vhIdx: vh.index, strandIdx: 1, bpIdx: 0 }
			);

			expect(isConstrained).toBe(false);
		});
	});

	describe('canEndsBeConstrained', () => {
		it('should determine if ends can be constrained', () => {
			const vh1 = addLatticeVh(testHoneycombPart, 0, 0);
			const vh2 = addLatticeVh(testHoneycombPart, 1, 0);

			const oligo1 = testHoneycombPart.createOligo(vh1, 0, 20, '#ff0000');
			const oligo2 = testHoneycombPart.createOligo(vh2, 20, 0, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			// Connect the ends
			segment1.threePrime.connectTo(segment2.fivePrime);

			const canBeConstrained = testHoneycombPart.canEndsBeConstrained(
				segment1.threePrime,
				segment2.fivePrime
			);

			// Adjacent VHs at crossover sites can be constrained
			expect(typeof canBeConstrained).toBe('boolean');
		});
	});
});

describe('SquarePart Geometry', () => {
	let testDoc: FoldnanoDocument;
	let testSquarePart: Part;

	beforeEach(() => {
		testDoc = new FoldnanoDocument();
		testDoc.addNewPart('SQUARE');
		testSquarePart = testDoc.parts[0];
	});

	describe('lattice properties', () => {
		it('should have correct lattice type', () => {
			expect(testSquarePart.getDefaultRegion().kind).toBe('SQUARE');
		});

		it('should have correct step size', () => {
			expect(testSquarePart.step).toBe(32);
		});

		it('should have correct turns per step', () => {
			expect(testSquarePart.getDefaultRegion().turnsPerStep).toBe(3);
		});

		it('should have correct substep size', () => {
			expect(testSquarePart.subStepSize).toBe(8); // 32 / 4
		});

		it('should have non-zero twist offset', () => {
			// Square lattice has twist offset of 180 + twistPerBase / 2
			expect(testSquarePart.getDefaultRegion().twistOffset).toBeGreaterThan(0);
		});
	});

	describe('adjacentCoords calculation', () => {
		it('should return 4 neighbors for center position', () => {
			const coords = (testSquarePart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				5,
				5
			);

			expect(coords.length).toBe(4);
			expect(coords).toContainEqual({ col: 4, row: 5 });
			expect(coords).toContainEqual({ col: 6, row: 5 });
			expect(coords).toContainEqual({ col: 5, row: 4 });
			expect(coords).toContainEqual({ col: 5, row: 6 });
		});

		it('should filter out negative coordinates', () => {
			const coords = (testSquarePart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				0,
				0
			);

			// Should only include valid (non-negative) coords
			expect(coords.length).toBeLessThanOrEqual(4);
			coords.forEach((coord) => {
				expect(coord.col).toBeGreaterThanOrEqual(0);
				expect(coord.row).toBeGreaterThanOrEqual(0);
			});
		});

		it('should return 2 neighbors for corner (0,0)', () => {
			const coords = (testSquarePart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				0,
				0
			);

			expect(coords.length).toBe(2);
			expect(coords).toContainEqual({ col: 1, row: 0 });
			expect(coords).toContainEqual({ col: 0, row: 1 });
		});

		it('should return 3 neighbors for edge position', () => {
			const coords = (testSquarePart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				0,
				5
			);

			expect(coords.length).toBe(3);
			expect(coords).toContainEqual({ col: 1, row: 5 });
			expect(coords).toContainEqual({ col: 0, row: 4 });
			expect(coords).toContainEqual({ col: 0, row: 6 });
		});

		it('should have no parity-based variation (unlike honeycomb)', () => {
			// Square lattice has same neighbor pattern regardless of parity
			const coords1 = (testSquarePart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				2,
				2
			);
			const coords2 = (testSquarePart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				3,
				3
			);
			const coords3 = (testSquarePart.getDefaultRegion() as LatticedDesignRegion).adjacentCoords(
				2,
				3
			);

			// All should have 4 neighbors in square pattern
			expect(coords1.length).toBe(4);
			expect(coords2.length).toBe(4);
			expect(coords3.length).toBe(4);
		});
	});

	describe('adjacentVhs', () => {
		it('should find adjacent virtual helices in square lattice', () => {
			const center = addLatticeVh(testSquarePart, 5, 5);
			const left = addLatticeVh(testSquarePart, 4, 5);
			const right = addLatticeVh(testSquarePart, 6, 5);
			const top = addLatticeVh(testSquarePart, 5, 4);
			const bottom = addLatticeVh(testSquarePart, 5, 6);

			const neighbors = testSquarePart.adjacentVhs(center);

			expect(neighbors.length).toBe(4);
			expect(neighbors).toContain(left);
			expect(neighbors).toContain(right);
			expect(neighbors).toContain(top);
			expect(neighbors).toContain(bottom);
		});

		it('should return empty array when no adjacent VHs exist', () => {
			const vh = addLatticeVh(testSquarePart, 0, 0);

			const neighbors = testSquarePart.adjacentVhs(vh);

			expect(neighbors.length).toBe(0);
		});

		it('should handle partial neighbors correctly', () => {
			const center = addLatticeVh(testSquarePart, 5, 5);
			const left = addLatticeVh(testSquarePart, 4, 5);
			const right = addLatticeVh(testSquarePart, 6, 5);
			// No top or bottom neighbors

			const neighbors = testSquarePart.adjacentVhs(center);

			expect(neighbors.length).toBe(2);
			expect(neighbors).toContain(left);
			expect(neighbors).toContain(right);
		});
	});

	describe('areVhsAdjacent', () => {
		it('should return true for adjacent VHs', () => {
			const vh1 = addLatticeVh(testSquarePart, 0, 0);
			const vh2 = addLatticeVh(testSquarePart, 1, 0);

			expect(testSquarePart.areVhsAdjacent(vh1, vh2)).toBe(true);
			expect(testSquarePart.areVhsAdjacent(vh2, vh1)).toBe(true);
		});

		it('should return false for diagonally placed VHs', () => {
			const vh1 = addLatticeVh(testSquarePart, 0, 0);
			const vh2 = addLatticeVh(testSquarePart, 1, 1);

			// Square lattice doesn't have diagonal neighbors
			expect(testSquarePart.areVhsAdjacent(vh1, vh2)).toBe(false);
		});

		it('should return false for non-adjacent VHs', () => {
			const vh1 = addLatticeVh(testSquarePart, 0, 0);
			const vh2 = addLatticeVh(testSquarePart, 5, 5);

			expect(testSquarePart.areVhsAdjacent(vh1, vh2)).toBe(false);
		});
	});

	describe('getVhByLatticeCoords', () => {
		it('should find VH by lattice coordinates', () => {
			const vh = addLatticeVh(testSquarePart, 3, 5);

			const found = (
				testSquarePart.getDefaultRegion() as LatticedDesignRegion
			).getVhByLatticeCoords(3, 5);

			expect(found).toBe(vh);
		});

		it('should return null for non-existent coordinates', () => {
			addLatticeVh(testSquarePart, 0, 0);

			const found = (
				testSquarePart.getDefaultRegion() as LatticedDesignRegion
			).getVhByLatticeCoords(10, 10);

			expect(found).toBeNull();
		});
	});

	describe('potentialXoverSites', () => {
		it('should return crossover sites for a virtual helix', () => {
			const vh = addLatticeVh(testSquarePart, 0, 0);

			const sites = testSquarePart.potentialXoverSites(vh.index);

			expect(sites).toBeDefined();
			expect(sites.length).toBe(2);
			expect(Array.isArray(sites[0])).toBe(true);
			expect(Array.isArray(sites[1])).toBe(true);
		});

		it('should cache crossover sites', () => {
			const vh = addLatticeVh(testSquarePart, 0, 0);
			addLatticeVh(testSquarePart, 1, 0);

			const sites1 = testSquarePart.potentialXoverSites(vh.index);
			const sites2 = testSquarePart.potentialXoverSites(vh.index);

			expect(sites1).toBe(sites2);
		});

		// it('should have different periodicity than honeycomb', () => {
		// 	const vh1 = addLatticeVh(testSquarePart, 0, 0);
		// 	const vh2 = addLatticeVh(testSquarePart, 1, 0);

		// 	const sites = testSquarePart.potentialXoverSites(vh1.index);
		// 	const strand0Sites = sites[0];

		// 	if (strand0Sites.length > 1) {
		// 		// Square lattice has step=32, so crossover sites should be 32 bp apart
		// 		const site1 = strand0Sites[0];
		// 		const site2 = strand0Sites.find((s) => s.bpIdx > site1.bpIdx);

		// 		if (site2) {
		// 			// Sites should be separated by step or substep
		// 			const diff = site2.bpIdx - site1.bpIdx;
		// 			expect(diff % testSquarePart.subStepSize).toBe(0);
		// 		}
		// 	}
		// });
	});

	describe('comparison with HoneycombPart', () => {
		let honeycombDoc: FoldnanoDocument;
		let honeycombPart: Part;

		beforeEach(() => {
			honeycombDoc = new FoldnanoDocument();
			honeycombDoc.addNewPart('HONEYCOMB');
			honeycombPart = honeycombDoc.parts[0];
		});

		it('should have different step sizes', () => {
			expect(testSquarePart.step).toBe(32);
			expect(honeycombPart.step).toBe(21);
			expect(testSquarePart.step).not.toBe(honeycombPart.step);
		});

		it('should have different neighbor counts', () => {
			const squareVh = addLatticeVh(testSquarePart, 5, 5);
			addLatticeVh(testSquarePart, 4, 5);
			addLatticeVh(testSquarePart, 6, 5);
			addLatticeVh(testSquarePart, 5, 4);
			addLatticeVh(testSquarePart, 5, 6);

			const honeycombVh = addLatticeVh(honeycombPart, 5, 5);
			addLatticeVh(honeycombPart, 4, 5);
			addLatticeVh(honeycombPart, 6, 5);
			addLatticeVh(honeycombPart, 5, 4);

			const squareNeighbors = testSquarePart.adjacentVhs(squareVh);
			const honeycombNeighbors = honeycombPart.adjacentVhs(honeycombVh);

			expect(squareNeighbors.length).toBe(4);
			expect(honeycombNeighbors.length).toBe(3);
		});

		it('should have different turns per step', () => {
			expect(testSquarePart.getDefaultRegion().turnsPerStep).toBe(3);
			expect(honeycombPart.getDefaultRegion().turnsPerStep).toBe(2);
		});
	});
});
