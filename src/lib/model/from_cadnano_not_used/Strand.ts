export default class Strand {
	/**
   * @remarks
   * from original cadnano documentation:
   * 
   * A Strand is a continuous stretch of bases that are all in the same
   * StrandSet (recall: a VirtualHelix is made up of two StrandSets).

   * Every Strand has two endpoints. The naming convention for keeping track
   * of these endpoints is based on the relative numeric value of those
   * endpoints (low and high). Thus, Strand has a '_baseIdxLow', which is its
   * index with the lower numeric value (typically positioned on the left),
   * and a '_baseIdxHigh' which is the higher-value index (typically positioned
   * on the right)

   * Strands can be linked to other strands by "connections". References to
   * connected strands are named "_strand5p" and "_strand3p", which correspond
   * to the 5' and 3' phosphate linkages in the physical DNA strand,
   * respectively. Since Strands can point 5'-to-3' in either the low-to-high
   * or high-to-low directions, connection accessor methods (connectionLow and
   * connectionHigh) are bound during the init for convenience.
   */

	static numberOfStrands = 0;
	id: number;

	constructor() {
		Strand.numberOfStrands += 1;
		this.id = Strand.numberOfStrands;
	}
}
