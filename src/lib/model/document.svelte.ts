import { v4 as uuidv4 } from 'uuid';
import { APP_COMMIT, APP_VERSION } from '$lib/appInfo';
import { Part } from './Part';
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
}

export type PartType = 'HONEYCOMB' | 'SQUARE' | 'FREEFORM';

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
	parts = $state<Part[]>([]);

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
		return doc;
	}

	restore(snapshot: DocSnapshot) {
		const restored = FoldnanoDocument.fromJSON(snapshot);
		this.parts = restored.parts;
	}

	addNewPart(type: PartType): Part {
		const KNOWN_TYPES: PartType[] = ['HONEYCOMB', 'SQUARE', 'FREEFORM'];
		if (!KNOWN_TYPES.includes(type)) throw new Error(`Part type "${type}" not implemented`);
		const part = Part.forType(type, `Part ${this.parts.length + 1}`);
		this.parts.push(part);
		return part;
	}
}
