import { Occurrence, type OccurrenceJSON, type OccurrenceTransform } from './Occurrence.svelte';
import { StickyRecords, type StickyRecordsJSON } from '../stickyEnds/StickyRecords.svelte';

export interface AssemblyJSON extends StickyRecordsJSON {
	occurrences: OccurrenceJSON[];
}

/**
 * Where the document's Parts are placed. Each Part definition (`FoldnanoDocument.parts`) is placed
 * by zero or more occurrences; edits to a Part show in all of them. See docs/dna-model.md § Assembly.
 */
export class Assembly {
	occurrences: Occurrence[] = $state([]);
	/** Sticky-end pairs and ignored matches whose ends are in two different Parts. */
	readonly stickyRecords = new StickyRecords(true);

	getById(id: string): Occurrence | undefined {
		return this.occurrences.find((occurrence) => occurrence.id === id);
	}

	occurrencesOf(partId: string): Occurrence[] {
		return this.occurrences.filter((occurrence) => occurrence.partId === partId);
	}

	/** `Brick 1`, `Brick 2`, … — the next free number among this Part's occurrence names. */
	nextOccurrenceName(partName: string): string {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookup, not state
		const taken = new Set(this.occurrences.map((occurrence) => occurrence.name));
		let n = 1;
		while (taken.has(`${partName} ${n}`)) n++;
		return `${partName} ${n}`;
	}

	add(
		partId: string,
		name: string,
		options: {
			id?: string;
			transform?: OccurrenceTransform;
			visible?: boolean;
			index?: number;
		} = {}
	): Occurrence {
		const occurrence = new Occurrence(partId, name, options);
		const index = options.index ?? this.occurrences.length;
		this.occurrences.splice(Math.min(index, this.occurrences.length), 0, occurrence);
		return occurrence;
	}

	/** Position and copy of one occurrence, for history patches. */
	stateOf(id: string): { json: OccurrenceJSON; index: number } | null {
		const index = this.occurrences.findIndex((occurrence) => occurrence.id === id);
		return index < 0 ? null : { json: this.occurrences[index].toJSON(), index };
	}

	/** Sets the occurrence with `json.id` to `json`, moved to list position `index`. */
	put(json: OccurrenceJSON, index: number): Occurrence {
		this.remove(json.id);
		const occurrence = Occurrence.fromJSON(json);
		this.occurrences.splice(Math.min(index, this.occurrences.length), 0, occurrence);
		return occurrence;
	}

	/** Removes one occurrence; returns its JSON and list position, for undo. */
	remove(id: string): { json: OccurrenceJSON; index: number } | null {
		const index = this.occurrences.findIndex((occurrence) => occurrence.id === id);
		if (index < 0) return null;
		const [removed] = this.occurrences.splice(index, 1);
		return { json: removed.toJSON(), index };
	}

	removeAllOf(partId: string): void {
		this.occurrences = this.occurrences.filter((occurrence) => occurrence.partId !== partId);
	}

	toJSON(): AssemblyJSON {
		return {
			occurrences: this.occurrences.map((occurrence) => occurrence.toJSON()),
			...this.stickyRecords.toJSON(),
		};
	}

	static fromJSON(json: AssemblyJSON): Assembly {
		const assembly = new Assembly();
		assembly.occurrences = json.occurrences.map((occurrence) => Occurrence.fromJSON(occurrence));
		assembly.stickyRecords.load(json);
		return assembly;
	}
}
