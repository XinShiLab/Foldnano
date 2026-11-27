import { v4 as uuidv4 } from 'uuid';
import { APP_COMMIT, APP_VERSION } from '$lib/appInfo';
import { Part } from './Part';
import { Assembly, type AssemblyJSON } from './Assembly';
import {
	CURRENT_FORMAT_VERSION,
	FOLDNANO_FORMAT,
	migrateDocumentJson,
	type DocumentFormatHeader,
} from './documentFormat';

export interface DocSnapshot extends DocumentFormatHeader {
	id: string;
	name: string;
	parts: ReturnType<Part['toJSON']>[];
	assembly: AssemblyJSON;
}

export type PartType = 'HONEYCOMB' | 'SQUARE' | 'FREEFORM' | 'WIREFRAME';

/**
 * Factory that creates a generic Part with the correct geometry for the given type.
 * Replaces the old PART_CTORS subclass registry.
 */
export function createPart(
	type: PartType,
	name: string,
	id?: string,
	maxBase?: number,
	options?: { step?: number }
): Part {
	return Part.forType(type, name, id, maxBase, options);
}

export function partFromJSON(json: Parameters<typeof Part.fromJSON>[0]): Part {
	return Part.fromJSON(json);
}

export default class FoldnanoDocument {
	/**
	 * @remarks
	 * The Document class is the root of the model. It
	 * 1. serve as the parent all Part objects within the model.
	 * 2. manage serialization and deserialization of the model to other IO models.
	 */
	readonly id: string;

	name: string = $state('Untitled Document');
	/** Part definitions. Where (and how often) each is placed lives in `assembly`. */
	parts = $state<Part[]>([]);
	assembly: Assembly = $state(new Assembly());

	constructor(id?: string, name?: string) {
		this.id = id || uuidv4();
		if (name) {
			this.name = name;
		}
	}

	toJSON(): DocSnapshot {
		return {
			format: FOLDNANO_FORMAT,
			formatVersion: CURRENT_FORMAT_VERSION,
			savedWith: { app: APP_VERSION, commit: APP_COMMIT },
			id: this.id,
			name: this.name,
			parts: this.parts.map((part) => part.toJSON()),
			assembly: this.assembly.toJSON(),
		};
	}

	/** Deep, detached copy of `toJSON()`. Use this rather than `$state.snapshot(doc)`: Svelte's
	 * server compile (which Vitest uses) turns `const x = $state.snapshot(y)` into `const x = y`,
	 * so history "before" copies silently aliased the live document in tests. */
	snapshot(): DocSnapshot {
		return JSON.parse(JSON.stringify(this.toJSON()));
	}

	/** Accepts any saved version; throws DocumentFormatError for files this app can't open. */
	static fromJSON(raw: unknown): FoldnanoDocument {
		const json = migrateDocumentJson(raw);
		const doc = new FoldnanoDocument(json.id, json.name);
		for (const partJson of json.parts) {
			doc.parts.push(Part.fromJSON(partJson));
		}
		doc.assembly = Assembly.fromJSON(json.assembly);
		return doc;
	}

	restore(snapshot: DocSnapshot) {
		const restored = FoldnanoDocument.fromJSON(snapshot);
		this.parts = restored.parts;
		this.assembly = restored.assembly;
	}

	/** Replaces the Part with id `partId` by one rebuilt from `json`, in the same slot. The other
	 * Part objects are kept, so their views don't reset (unlike `restore`). */
	replacePartFromJSON(partId: string, json: ReturnType<Part['toJSON']>): Part {
		const index = this.parts.findIndex((part) => part.id === partId);
		if (index < 0) throw new Error(`Cannot replace Part ${partId}: not in the document`);
		const part = Part.fromJSON(json);
		this.parts[index] = part;
		return part;
	}

	/**
	 * An assembly file: every Part is linked from another design, so the file only places them. A
	 * reading of the Parts, not a stored flag (the format is that of any design); Parts that only
	 * join others, should they come, would count as well.
	 */
	get isAssembly(): boolean {
		return this.parts.length > 0 && this.parts.every((part) => part.source);
	}

	addNewPart(type: PartType): Part {
		const KNOWN_TYPES: PartType[] = ['HONEYCOMB', 'SQUARE', 'FREEFORM', 'WIREFRAME'];
		if (!KNOWN_TYPES.includes(type)) throw new Error(`Part type "${type}" not implemented`);
		return this.addPart(Part.forType(type, `Part ${this.parts.length + 1}`));
	}

	/** Adds a Part definition and places it once, at the origin. */
	addPart(part: Part): Part {
		if (this.parts.some((p) => p.id === part.id)) {
			throw new Error(`Part ${part.id} is already in the document`);
		}
		this.parts.push(part);
		this.assembly.add(part.id, this.assembly.nextOccurrenceName(part.name));
		return part;
	}

	/** Removes a Part definition, every occurrence of it, and the sticky-end pairs reaching it. */
	removePart(partId: string): void {
		const index = this.parts.findIndex((part) => part.id === partId);
		if (index < 0) return;
		this.parts.splice(index, 1);
		this.assembly.removeAllOf(partId);
		this.assembly.stickyRecords.removeAllOf(partId);
	}
}
