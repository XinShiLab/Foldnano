export type EditorMode =
	| 'SELECT'
	| 'PAN'
	| 'BREAK'
	| 'DRAW'
	| 'SKIP'
	| 'INSERT'
	| 'PAINT'
	| 'MODIFICATION'
	| 'SEQUENCE'
	| 'SPLIT_REGION'
	| 'DUPLICATE';

export type CanSelectToggle = 'SCAF' | 'STAP' | 'END' | 'XOVER' | 'SEGMENT' | 'OLIGO' | 'VH_TAG';

export type Category = 'SCAF' | 'STAP' | 'VH' | 'UNKNOWN' | 'CONTROL';
/** Things can bit hit by mouse. you can't hit Oligo because it is made of
 * a collection of ends, segments, and crossovers */
export type LeafTarget =
	| 'END'
	| 'XOVER'
	| 'SEGMENT'
	| 'VH_GRID'
	| 'VH_TAG'
	| 'OLIGO'
	| 'EMPTY'
	| 'CS_CURSOR'
	| 'XOVER_SITE'
	| 'REGION_HEADER';

export type HitResult =
	| {
			category: Category;
			kind: LeafTarget;
			id: string;
	  }
	| { kind: 'EMPTY'; category?: undefined; id?: undefined };
