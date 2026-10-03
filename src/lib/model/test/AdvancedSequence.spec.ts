import { addLatticeVh } from '$lib/model/test/testHelpers';
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	generateRandomDNA,
	generateComplementaryDNA,
	type GenerateDNAOptions,
} from '$lib/model/sequences/sequences';
import FoldnanoDocument from '$lib/model/document.svelte';
import type { Part } from '$lib/model/Part';
import type VirtualHelix from '$lib/model/VirtualHelix';

describe('DNA Sequence Generation', () => {
	describe('generateComplementaryDNA', () => {
		it('should generate complement for simple sequence', () => {
			const primary = 'ACGT';
			const complement = generateComplementaryDNA(primary);

			expect(complement).toBe('ACGT'); // Reverse complement of ACGT
		});

		it('should generate reverse complement correctly', () => {
			const primary = 'AAAA';
			const complement = generateComplementaryDNA(primary);

			expect(complement).toBe('TTTT'); // All A → T in reverse
		});

		it('should handle all bases', () => {
			const primary = 'ATCG';
			const complement = generateComplementaryDNA(primary);

			// Reverse complement: C→G, G→C, T→A, A→T
			expect(complement).toBe('CGAT');
		});

		it('should handle longer sequences', () => {
			const primary = 'ACGTACGTACGT';
			const complement = generateComplementaryDNA(primary);

			expect(complement.length).toBe(primary.length);
			expect(complement).toBe('ACGTACGTACGT');
		});

		it('should handle lowercase bases', () => {
			const primary = 'acgt';
			const complement = generateComplementaryDNA(primary);

			expect(complement).toBe('ACGT');
		});

		it('should handle mixed case', () => {
			const primary = 'AcGt';
			const complement = generateComplementaryDNA(primary);

			expect(complement).toBe('ACGT');
		});

		it('should throw error for invalid base', () => {
			const primary = 'ACGX';

			expect(() => {
				generateComplementaryDNA(primary);
			}).toThrow("Invalid base 'X' in primary sequence");
		});

		it('should throw error for numbers', () => {
			const primary = 'ACG1';

			expect(() => {
				generateComplementaryDNA(primary);
			}).toThrow("Invalid base '1' in primary sequence");
		});

		it('should handle empty sequence', () => {
			const primary = '';
			const complement = generateComplementaryDNA(primary);

			expect(complement).toBe('');
		});

		it('should produce antiparallel complement', () => {
			// For a palindrome, reverse complement should be same
			const primary = 'GAATTC'; // EcoRI recognition site
			const complement = generateComplementaryDNA(primary);

			// GAATTC reverse complement is GAATTC (palindrome)
			expect(complement).toBe('GAATTC');
		});
	});

	describe('generateRandomDNA - basic validation', () => {
		it('should generate sequence of correct length', () => {
			const result = generateRandomDNA(100, 0.5);

			expect(result.length).toBe(100);
			expect(result.primary5to3.length).toBe(100);
			expect(result.complementary5to3.length).toBe(100);
		});

		it('should generate complementary pair', () => {
			const result = generateRandomDNA(50, 0.5);

			const manualComplement = generateComplementaryDNA(result.primary5to3);
			expect(result.complementary5to3).toBe(manualComplement);
		});

		it('should handle GC content of 0', () => {
			const result = generateRandomDNA(100, 0);

			const gcCount = (result.primary5to3.match(/[GC]/g) || []).length;
			expect(gcCount).toBe(0);
			expect(result.primary5to3).toMatch(/^[AT]+$/);
		});

		it('should handle GC content of 1', () => {
			const result = generateRandomDNA(100, 1);

			const gcCount = (result.primary5to3.match(/[GC]/g) || []).length;
			expect(gcCount).toBe(100);
			expect(result.primary5to3).toMatch(/^[GC]+$/);
		});

		it('should handle GC content of 0.5', () => {
			const result = generateRandomDNA(100, 0.5);

			const gcCount = (result.primary5to3.match(/[GC]/g) || []).length;
			expect(gcCount).toBeCloseTo(50, 1); // Allow ±1 due to rounding
		});

		it('should report actual GC content', () => {
			const result = generateRandomDNA(100, 0.6);

			expect(result.gcContentRequested).toBe(0.6);
			expect(result.gcContentActual).toBeCloseTo(0.6, 1);
		});

		it('should throw error for negative length', () => {
			expect(() => {
				generateRandomDNA(-10, 0.5);
			}).toThrow('length must be a positive integer');
		});

		it('should throw error for zero length', () => {
			expect(() => {
				generateRandomDNA(0, 0.5);
			}).toThrow('length must be a positive integer');
		});

		it('should throw error for non-integer length', () => {
			expect(() => {
				generateRandomDNA(10.5, 0.5);
			}).toThrow('length must be a positive integer');
		});

		it('should throw error for GC content < 0', () => {
			expect(() => {
				generateRandomDNA(100, -0.1);
			}).toThrow('gcContent must be between 0 and 1');
		});

		it('should throw error for GC content > 1', () => {
			expect(() => {
				generateRandomDNA(100, 1.1);
			}).toThrow('gcContent must be between 0 and 1');
		});

		it('should throw error for infinite GC content', () => {
			expect(() => {
				generateRandomDNA(100, Infinity);
			}).toThrow('gcContent must be between 0 and 1');
		});
	});

	describe('generateRandomDNA - seeded RNG', () => {
		it('should produce same sequence with same seed', () => {
			const seed = 12345;
			const result1 = generateRandomDNA(100, 0.5, { seed });
			const result2 = generateRandomDNA(100, 0.5, { seed });

			expect(result1.primary5to3).toBe(result2.primary5to3);
			expect(result1.complementary5to3).toBe(result2.complementary5to3);
		});

		it('should produce different sequences with different seeds', () => {
			const result1 = generateRandomDNA(100, 0.5, { seed: 111 });
			const result2 = generateRandomDNA(100, 0.5, { seed: 222 });

			expect(result1.primary5to3).not.toBe(result2.primary5to3);
		});

		it('should produce different sequences without seed', () => {
			const result1 = generateRandomDNA(100, 0.5);
			const result2 = generateRandomDNA(100, 0.5);

			// High probability they're different
			expect(result1.primary5to3).not.toBe(result2.primary5to3);
		});

		it('should handle seed of 0', () => {
			const result1 = generateRandomDNA(100, 0.5, { seed: 0 });
			const result2 = generateRandomDNA(100, 0.5, { seed: 0 });

			expect(result1.primary5to3).toBe(result2.primary5to3);
		});

		it('should handle large seed values', () => {
			const seed = 999999999;
			const result1 = generateRandomDNA(50, 0.5, { seed });
			const result2 = generateRandomDNA(50, 0.5, { seed });

			expect(result1.primary5to3).toBe(result2.primary5to3);
		});

		it('should produce reproducible GC content with seed', () => {
			const seed = 54321;
			const result1 = generateRandomDNA(100, 0.6, { seed });
			const result2 = generateRandomDNA(100, 0.6, { seed });

			expect(result1.gcContentActual).toBe(result2.gcContentActual);
		});
	});

	describe('generateRandomDNA - homopolymer avoidance', () => {
		it('should limit consecutive identical bases', () => {
			const maxRun = 3;
			const result = generateRandomDNA(200, 0.5, { seed: 123, avoidHomopolymer: maxRun });

			// Check for runs longer than maxRun
			const sequence = result.primary5to3;
			let currentBase = sequence[0];
			let runLength = 1;

			for (let i = 1; i < sequence.length; i++) {
				if (sequence[i] === currentBase) {
					runLength++;
					expect(runLength).toBeLessThanOrEqual(maxRun);
				} else {
					currentBase = sequence[i];
					runLength = 1;
				}
			}
		});

		it('should handle avoidHomopolymer = 2', () => {
			const result = generateRandomDNA(100, 0.5, { seed: 456, avoidHomopolymer: 2 });

			// No consecutive pairs should be allowed
			const sequence = result.primary5to3;
			const tFn = (sequence: string) => {
				for (let i = 0; i < sequence.length - 2; i++) {
					if (sequence[i] === sequence[i + 1] && sequence[i + 1] === sequence[i + 2]) {
						throw new Error(`Found run of 3 at position ${i}: ${sequence.substring(i, i + 3)}`);
					}
				}
			};
			expect(() => tFn(sequence)).not.toThrow();
		});

		// avoidHomopolymer should be >=2, so this test is commented out

		// it('should handle avoidHomopolymer = 1 (no runs allowed)', () => {
		// 	// This is a special case - no consecutive identical bases
		// 	const result = generateRandomDNA(50, 0.5, { seed: 789, avoidHomopolymer: 1 });

		// 	const sequence = result.primary5to3;
		// 	const tFn = (sequence: string) => {
		// 		for (let i = 0; i < sequence.length - 1; i++) {
		// 			if (sequence[i] === sequence[i + 1]) {
		// 				throw new Error(`Found run of 2 at position ${i}: ${sequence.substring(i, i + 3)}`);
		// 			}
		// 		}
		// 	};
		//   expect(() => tFn(sequence)).not.toThrow();
		// });

		it('should not affect sequence when avoidHomopolymer not set', () => {
			const result = generateRandomDNA(100, 0.5, { seed: 999 });

			// Should still generate valid sequence
			expect(result.primary5to3).toMatch(/^[ACGT]+$/);
			expect(result.primary5to3.length).toBe(100);
		});

		it('should preserve GC content with homopolymer avoidance', () => {
			const gcContent = 0.6;
			const result = generateRandomDNA(200, gcContent, { seed: 111, avoidHomopolymer: 3 });

			// GC content should still be approximately correct
			expect(result.gcContentActual).toBeCloseTo(gcContent, 1);
		});

		it('should work with extreme GC content and homopolymer limit', () => {
			// GC content of 1.0 means only G and C
			const result = generateRandomDNA(100, 1.0, { seed: 222, avoidHomopolymer: 2 });

			expect(result.primary5to3).toMatch(/^[GC]+$/);
			const gcCount = (result.primary5to3.match(/[GC]/g) || []).length;
			expect(gcCount).toBe(100);
		});

		it('should work with zero GC content and homopolymer limit', () => {
			// GC content of 0.0 means only A and T
			const result = generateRandomDNA(100, 0.0, { seed: 333, avoidHomopolymer: 2 });

			expect(result.primary5to3).toMatch(/^[AT]+$/);
			const atCount = (result.primary5to3.match(/[AT]/g) || []).length;
			expect(atCount).toBe(100);
		});

		it('should handle small sequences with homopolymer limit', () => {
			const result = generateRandomDNA(10, 0.5, { seed: 444, avoidHomopolymer: 2 });

			expect(result.primary5to3.length).toBe(10);
			expect(result.primary5to3).toMatch(/^[ACGT]+$/);
		});
	});

	describe('generateRandomDNA - edge cases', () => {
		it('should handle length of 1', () => {
			const result = generateRandomDNA(1, 0.5);

			expect(result.primary5to3.length).toBe(1);
			expect(result.primary5to3).toMatch(/^[ACGT]$/);
		});

		it('should handle length of 2', () => {
			const result = generateRandomDNA(2, 0.5);

			expect(result.primary5to3.length).toBe(2);
			expect(result.primary5to3).toMatch(/^[ACGT]{2}$/);
		});

		it('should handle very long sequences', () => {
			const result = generateRandomDNA(10000, 0.5, { seed: 555 });

			expect(result.primary5to3.length).toBe(10000);
			expect(result.complementary5to3.length).toBe(10000);
		});

		it('should handle GC content close to boundaries', () => {
			const result1 = generateRandomDNA(100, 0.01);
			const result2 = generateRandomDNA(100, 0.99);

			expect(result1.gcContentActual).toBeCloseTo(0.01, 1);
			expect(result2.gcContentActual).toBeCloseTo(0.99, 1);
		});

		it('should produce all valid DNA bases', () => {
			const result = generateRandomDNA(1000, 0.5);

			expect(result.primary5to3).toMatch(/^[ACGT]+$/);
			expect(result.complementary5to3).toMatch(/^[ACGT]+$/);

			// Should contain all 4 bases with high probability
			expect(result.primary5to3).toMatch(/A/);
			expect(result.primary5to3).toMatch(/C/);
			expect(result.primary5to3).toMatch(/G/);
			expect(result.primary5to3).toMatch(/T/);
		});

		it('should balance G/C and A/T within base type', () => {
			const result = generateRandomDNA(1000, 0.5, { seed: 666 });

			const gCount = (result.primary5to3.match(/G/g) || []).length;
			const cCount = (result.primary5to3.match(/C/g) || []).length;
			const aCount = (result.primary5to3.match(/A/g) || []).length;
			const tCount = (result.primary5to3.match(/T/g) || []).length;

			// G and C should be roughly equal
			expect(Math.abs(gCount - cCount)).toBeLessThan(10);
			// A and T should be roughly equal
			expect(Math.abs(aCount - tCount)).toBeLessThan(10);
		});
	});

	describe('generateRandomDNA - combined options', () => {
		it('should work with both seed and homopolymer avoidance', () => {
			const options: GenerateDNAOptions = { seed: 777, avoidHomopolymer: 3 };
			const result1 = generateRandomDNA(200, 0.5, options);
			const result2 = generateRandomDNA(200, 0.5, options);

			// Same seed should produce same result
			expect(result1.primary5to3).toBe(result2.primary5to3);

			// Should also limit homopolymers
			let maxRun = 0;
			let currentRun = 1;
			let currentBase = result1.primary5to3[0];

			for (let i = 1; i < result1.primary5to3.length; i++) {
				if (result1.primary5to3[i] === currentBase) {
					currentRun++;
					maxRun = Math.max(maxRun, currentRun);
				} else {
					currentBase = result1.primary5to3[i];
					currentRun = 1;
				}
			}

			expect(maxRun).toBeLessThanOrEqual(3);
		});

		it('should produce consistent results across multiple calls', () => {
			const seed = 888;
			const gcContent = 0.6;
			const options: GenerateDNAOptions = { seed, avoidHomopolymer: 2 };

			const results = [];
			for (let i = 0; i < 5; i++) {
				results.push(generateRandomDNA(100, gcContent, options));
			}

			// All should be identical
			for (let i = 1; i < results.length; i++) {
				expect(results[i].primary5to3).toBe(results[0].primary5to3);
			}
		});
	});
});

describe('DNA Sequence Operations with Oligos', () => {
	let testDoc: FoldnanoDocument;
	let testPart: Part;
	let vh1: VirtualHelix;
	let vh2: VirtualHelix;

	beforeEach(() => {
		testDoc = new FoldnanoDocument();
		testDoc.addNewPart('HONEYCOMB');
		testPart = testDoc.parts[0];
		vh1 = addLatticeVh(testPart, 0, 0);
		vh2 = addLatticeVh(testPart, 1, 0);
	});

	describe('Sequence filling with validation', () => {
		it('should fill sequence with valid DNA bases', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			oligo.fillSequence('ACGTACGTACG'); // 11 bases

			const segment = oligo.segments.values().next().value!;
			expect(segment.sequence).toContain('ACGTACGTACG');
		});

		it('should fill sequence with all A', () => {
			const oligo = testPart.createOligo(vh1, 0, 9, '#ff0000');
			oligo.fillSequence('AAAAAAAAAA'); // 10 bases

			const segment = oligo.segments.values().next().value!;
			expect(segment.sequence).toContain('AAAAAAAAAA');
		});

		it('should fill sequence with all T', () => {
			const oligo = testPart.createOligo(vh1, 0, 9, '#ff0000');
			oligo.fillSequence('TTTTTTTTTT'); // 10 bases

			const segment = oligo.segments.values().next().value!;
			expect(segment.sequence).toContain('TTTTTTTTTT');
		});

		it('should fill sequence with all G', () => {
			const oligo = testPart.createOligo(vh1, 0, 9, '#ff0000');
			oligo.fillSequence('GGGGGGGGGG'); // 10 bases

			const segment = oligo.segments.values().next().value!;
			expect(segment.sequence).toContain('GGGGGGGGGG');
		});

		it('should fill sequence with all C', () => {
			const oligo = testPart.createOligo(vh1, 0, 9, '#ff0000');
			oligo.fillSequence('CCCCCCCCCC'); // 10 bases

			const segment = oligo.segments.values().next().value!;
			expect(segment.sequence).toContain('CCCCCCCCCC');
		});

		it('should fill random sequence', () => {
			const oligo = testPart.createOligo(vh1, 0, 41, '#ff0000');
			const randomSeq = generateRandomDNA(100, 0.5, { seed: 123 });

			oligo.fillSequence(randomSeq.primary5to3);

			const segment = oligo.segments.values().next().value!;
			expect(segment.sequence).toBe(randomSeq.primary5to3.slice(0, 42));
		});

		it('should propagate to complementary strand', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 10, 0, '#00ff00');

			oligo1.fillSequence('ACGTACGTACG'); // 11 bases

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			segment2.fillNsFromComplementary?.();

			expect(segment2.sequence).toContain('CGTACGTACGT'); // Reverse complement
		});
	});

	describe('Sequence validation with GC content', () => {
		it('should handle high GC content sequence', () => {
			const oligo = testPart.createOligo(vh1, 0, 41, '#ff0000');
			const highGC = generateRandomDNA(100, 0.8, { seed: 456 });

			oligo.fillSequence(highGC.primary5to3);

			const segment = oligo.segments.values().next().value!;
			const sequence = segment.sequence;
			const gcCount = (sequence.match(/[GC]/gi) || []).length;
			const gcContent = gcCount / sequence.replace(/N/g, '').length;

			expect(gcContent).toBeGreaterThan(0.7);
		});

		it('should handle low GC content sequence', () => {
			const oligo = testPart.createOligo(vh1, 0, 41, '#ff0000');
			const lowGC = generateRandomDNA(100, 0.2, { seed: 789 });

			oligo.fillSequence(lowGC.primary5to3);

			const segment = oligo.segments.values().next().value!;
			const sequence = segment.sequence;
			const gcCount = (sequence.match(/[GC]/gi) || []).length;
			const gcContent = gcCount / sequence.replace(/N/g, '').length;

			expect(gcContent).toBeLessThan(0.3);
		});

		it('should handle balanced GC content', () => {
			const oligo = testPart.createOligo(vh1, 0, 41, '#ff0000');
			const balanced = generateRandomDNA(42, 0.5, { seed: 101 });

			oligo.fillSequence(balanced.primary5to3);

			const segment = oligo.segments.values().next().value!;
			const sequence = segment.sequence;
			const gcCount = (sequence.match(/[GC]/gi) || []).length;
			const gcContent = gcCount / sequence.replace(/N/g, '').length;

			expect(gcContent).toBeCloseTo(0.5, 1);
		});
	});

	describe('Sequence edge cases', () => {
		it('should handle empty sequence', () => {
			const oligo = testPart.createOligo(vh1, 0, 10, '#ff0000');
			oligo.fillSequence('');

			const segment = oligo.segments.values().next().value!;
			// Should remain as Ns
			expect(segment.sequence).toMatch(/N+/);
		});

		it('should handle very long sequence', () => {
			testPart.increaseVhsLengthBy(4200); // Increase to accommodate 4000+ bases (multiple of 21)

			const oligo = testPart.createOligo(vh1, 0, 3999, '#ff0000');
			const longSeq = generateRandomDNA(4000, 0.5, { seed: 202 });

			oligo.fillSequence(longSeq.primary5to3);

			const segment = oligo.segments.values().next().value!;
			expect(segment.sequence).toContain(longSeq.primary5to3);
		});

		it('should handle sequence shorter than segment', () => {
			const oligo = testPart.createOligo(vh1, 0, 20, '#ff0000');
			oligo.fillSequence('ACGT'); // Only 4 bases

			const segment = oligo.segments.values().next().value!;
			// Should fill first 4, rest remain N
			expect(segment.sequence).toMatch(/^ACGTN+$/);
		});

		it('should handle sequence longer than segment', () => {
			const oligo = testPart.createOligo(vh1, 0, 5, '#ff0000');
			oligo.fillSequence('ACGTACGTACGT'); // 12 bases for 6-base segment

			const segment = oligo.segments.values().next().value!;
			// Should truncate to segment length
			expect(segment.sequence.replace(/N/g, '').length).toBeLessThanOrEqual(6);
		});
	});

	describe('Multiple segment sequences', () => {
		it('should handle sequence across multiple segments', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 7, '#ff0000');
			const oligo2 = testPart.createOligo(vh1, 10, 17, '#00ff00');

			oligo1.connectOligos(oligo2);
			const oligo = oligo1;

			// Fill sequence across all segments
			oligo.fillSequence('ACGTACGTACGTACGT'); // Long enough for all segments

			// Each segment should have part of the sequence
			for (const seg of oligo.segments) {
				expect(seg.sequence).not.toMatch(/^N+$/); // Not all Ns
			}
		});

		it('should propagate sequence across crossover', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 10, '#ff0000');
			const oligo2 = testPart.createOligo(vh2, 0, 10, '#00ff00');

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			// Connect to create crossover
			segment1.threePrime.connectTo(segment2.fivePrime);

			// Fill sequence should propagate
			const mergedOligo = testPart.getOligoBySegment(segment1)!;
			mergedOligo.fillSequence('ACGTACGTACGTACGTACGTACGT'); // 24 bases

			expect(segment1.sequence).not.toMatch(/^N+$/);
			expect(segment2.sequence).not.toMatch(/^N+$/);
		});
	});

	describe('Reproducible sequence generation', () => {
		it('should generate same sequence with same seed', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 41, '#ff0000');
			const seq1 = generateRandomDNA(42, 0.5, { seed: 999 });
			oligo1.fillSequence(seq1.primary5to3);

			// Create second oligo with same seed
			const vh3 = addLatticeVh(testPart, 2, 2);
			const oligo2 = testPart.createOligo(vh3, 0, 41, '#0000ff');
			const seq2 = generateRandomDNA(42, 0.5, { seed: 999 });
			oligo2.fillSequence(seq2.primary5to3);

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			expect(segment1.sequence).toBe(segment2.sequence);
		});

		it('should generate different sequences without seed', () => {
			const oligo1 = testPart.createOligo(vh1, 0, 41, '#ff0000');
			const seq1 = generateRandomDNA(42, 0.5);
			oligo1.fillSequence(seq1.primary5to3);

			const vh3 = addLatticeVh(testPart, 2, 2);
			const oligo2 = testPart.createOligo(vh3, 0, 41, '#0000ff');
			const seq2 = generateRandomDNA(42, 0.5);
			oligo2.fillSequence(seq2.primary5to3);

			const segment1 = oligo1.segments.values().next().value!;
			const segment2 = oligo2.segments.values().next().value!;

			// Should be different with high probability
			expect(segment1.sequence).not.toBe(segment2.sequence);
		});
	});
});
