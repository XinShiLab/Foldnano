import type { ReferenceMesh } from '$lib/model/Part/DesignRegion';

// Well past any scaffold: 3,000 edges of 42 bp is 126 kb. Helices per edge slow the strand view.
export const MAX_PLY_VERTICES = 1_000;
export const MAX_PLY_FACES = 2_000;
export const MAX_PLY_EDGES = 3_000;
export const MAX_PLY_FILE_BYTES = 50 * 1024 * 1024;

interface PlyProperty {
	name: string;
	isList: boolean;
}

interface PlyElement {
	name: string;
	count: number;
	properties: PlyProperty[];
}

function parseHeader(lines: string[]): { elements: PlyElement[]; bodyStart: number } {
	if (lines[0]?.trim() !== 'ply') throw new Error('This is not a PLY file.');
	const elements: PlyElement[] = [];
	let hasFormat = false;

	for (let i = 1; i < lines.length; i++) {
		const [keyword, ...args] = lines[i].trim().split(/\s+/);
		if (keyword === 'end_header') {
			if (!hasFormat) throw new Error('The PLY header has no format line.');
			return { elements, bodyStart: i + 1 };
		}
		if (keyword === 'format') {
			if (args[0] !== 'ascii') {
				throw new Error('Binary PLY is not supported. Re-export the mesh as ASCII PLY.');
			}
			hasFormat = true;
		} else if (keyword === 'element') {
			const count = Number(args[1]);
			if (args.length !== 2 || !Number.isInteger(count) || count < 0) {
				throw new Error(`Invalid PLY element line: "${lines[i].trim()}".`);
			}
			elements.push({ name: args[0], count, properties: [] });
		} else if (keyword === 'property') {
			const element = elements.at(-1);
			if (!element) throw new Error('The PLY header has a property before any element.');
			const isList = args[0] === 'list';
			element.properties.push({ name: isList ? args[3] : args[1], isList });
		}
	}
	throw new Error('The PLY header has no end_header line.');
}

function checkLimit(element: PlyElement | undefined, limit: number, label: string): void {
	if (element && element.count > limit) {
		throw new Error(
			`This mesh has ${element.count.toLocaleString()} ${label}; the limit is ${limit.toLocaleString()}.`
		);
	}
}

/** One value per property; a list property yields an array. */
function readRow(line: string, element: PlyElement, lineNumber: number): (number | number[])[] {
	const tokens = line.trim().split(/\s+/).map(Number);
	const incomplete = () =>
		new Error(`PLY line ${lineNumber} is too short for its ${element.name} element.`);
	let at = 0;
	return element.properties.map((property) => {
		if (!property.isList) {
			if (at >= tokens.length) throw incomplete();
			return tokens[at++];
		}
		const size = tokens[at++];
		if (!Number.isInteger(size) || size < 0 || at + size > tokens.length) throw incomplete();
		const values = tokens.slice(at, at + size);
		at += size;
		return values;
	});
}

function readVertices(
	rows: (number | number[])[][],
	element: PlyElement
): ReferenceMesh['vertices'] {
	const columns = ['x', 'y', 'z'].map((axis) =>
		element.properties.findIndex((p) => p.name === axis && !p.isList)
	);
	if (columns.includes(-1)) throw new Error('PLY vertices need x, y and z properties.');
	return rows.map((row, i) => {
		const [x, y, z] = columns.map((column) => row[column] as number);
		if (![x, y, z].every(Number.isFinite)) {
			throw new Error(`PLY vertex ${i} has a coordinate that is not a finite number.`);
		}
		return [x, y, z];
	});
}

export function parsePlyMesh(text: string): ReferenceMesh {
	const lines = text.split(/\r\n|\r|\n/);
	const { elements, bodyStart } = parseHeader(lines);

	const vertexElement = elements.find((e) => e.name === 'vertex');
	const faceElement = elements.find((e) => e.name === 'face');
	const edgeElement = elements.find((e) => e.name === 'edge');
	checkLimit(vertexElement, MAX_PLY_VERTICES, 'vertices');
	checkLimit(faceElement, MAX_PLY_FACES, 'faces');
	checkLimit(edgeElement, MAX_PLY_EDGES, 'edges');
	if (!vertexElement) throw new Error('This PLY file has no vertices.');

	// Elements sit in header order, and any of them may be one we skip.
	const rowsByElement = new Map<PlyElement, (number | number[])[][]>();
	let lineIndex = bodyStart;
	for (const element of elements) {
		const wanted = element === vertexElement || element === faceElement || element === edgeElement;
		const rows: (number | number[])[][] = [];
		for (let row = 0; row < element.count; row++) {
			while (lineIndex < lines.length && lines[lineIndex].trim() === '') lineIndex++;
			if (lineIndex >= lines.length) {
				throw new Error(
					`This PLY file ends early: it declares ${element.count} ${element.name} rows but has ${row}.`
				);
			}
			if (wanted) rows.push(readRow(lines[lineIndex], element, lineIndex + 1));
			lineIndex++;
		}
		rowsByElement.set(element, rows);
	}

	const vertices = readVertices(rowsByElement.get(vertexElement) ?? [], vertexElement);
	const isVertexIndex = (i: number) => Number.isInteger(i) && i >= 0 && i < vertices.length;

	const faces: number[][] = [];
	if (faceElement && faceElement.count > 0) {
		const column = faceElement.properties.findIndex(
			(p) => p.isList && (p.name === 'vertex_indices' || p.name === 'vertex_index')
		);
		if (column < 0) throw new Error('PLY faces need a vertex_indices list property.');
		rowsByElement.get(faceElement)?.forEach((row, i) => {
			const face = row[column] as number[];
			if (face.length < 3 || !face.every(isVertexIndex)) {
				throw new Error(`PLY face ${i} needs three or more valid vertex indices.`);
			}
			faces.push(face);
		});
	}

	const edges: [number, number][] = [];
	if (edgeElement && edgeElement.count > 0) {
		const columns = ['vertex1', 'vertex2'].map((name) =>
			edgeElement.properties.findIndex((p) => p.name === name && !p.isList)
		);
		if (columns.includes(-1)) throw new Error('PLY edges need vertex1 and vertex2 properties.');
		rowsByElement.get(edgeElement)?.forEach((row, i) => {
			const a = row[columns[0]] as number;
			const b = row[columns[1]] as number;
			if (!isVertexIndex(a) || !isVertexIndex(b)) {
				throw new Error(`PLY edge ${i} needs two valid vertex indices.`);
			}
			edges.push([a, b]);
		});
	}

	if (vertices.length === 0) throw new Error('This PLY file has no vertices.');
	if (faces.length === 0 && edges.length === 0) {
		throw new Error('This PLY file has only points. A reference mesh needs faces or edges.');
	}
	return { vertices, faces, edges };
}

export async function readPlyMeshFile(file: File): Promise<ReferenceMesh> {
	if (file.size > MAX_PLY_FILE_BYTES) {
		throw new Error(`${file.name} is larger than the 50 MB limit for a PLY file.`);
	}
	return parsePlyMesh(await file.text());
}
