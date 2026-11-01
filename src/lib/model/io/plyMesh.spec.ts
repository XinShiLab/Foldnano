import { describe, expect, it } from 'vitest';
import { checkReferenceGeometryShape } from '$lib/model/checks/shape/foldnanoJsonShape';
import {
	hasFiniteVertices,
	nmToApproxBp,
	referenceMeshEdges,
	scaleReferenceMesh,
	summarizeReferenceMesh,
} from '$lib/model/geometry3d/referenceMesh';
import { BACKBONE_RISE_NM } from '$lib/model/geometry3d/dnaGeometry';
import { MAX_PLY_FACES, MAX_PLY_VERTICES, parsePlyMesh } from './plyMesh';

function ply(header: string[], body: string[]): string {
	return ['ply', 'format ascii 1.0', ...header, 'end_header', ...body].join('\n');
}

const VERTEX_HEADER = [
	'element vertex 3',
	'property float x',
	'property float y',
	'property float z',
];
const FACE_HEADER = ['element face 1', 'property list uchar int vertex_indices'];
const VERTICES = ['0 0 0', '3 0 0', '0 4 0'];

describe('parsePlyMesh', () => {
	it('reads vertices and faces', () => {
		const mesh = parsePlyMesh(ply([...VERTEX_HEADER, ...FACE_HEADER], [...VERTICES, '3 0 1 2']));

		expect(mesh.vertices).toEqual([
			[0, 0, 0],
			[3, 0, 0],
			[0, 4, 0],
		]);
		expect(mesh.faces).toEqual([[0, 1, 2]]);
		expect(mesh.edges).toEqual([]);
	});

	it('reads edges, and the vertex_index spelling, and meshes that have only edges', () => {
		const edgeHeader = ['element edge 2', 'property int vertex1', 'property int vertex2'];

		expect(
			parsePlyMesh(ply([...VERTEX_HEADER, ...edgeHeader], [...VERTICES, '0 1', '1 2'])).edges
		).toEqual([
			[0, 1],
			[1, 2],
		]);
		expect(
			parsePlyMesh(
				ply(
					[...VERTEX_HEADER, 'element face 1', 'property list uchar int vertex_index'],
					[...VERTICES, '3 0 1 2']
				)
			).faces
		).toEqual([[0, 1, 2]]);
	});

	it('ignores comments, extra properties, other elements and Windows line ends', () => {
		const text = ply(
			[
				'comment made by hand',
				'obj_info nothing useful',
				'element vertex 3',
				'property float nx',
				'property float x',
				'property float y',
				'property float z',
				'property list uchar int tags',
				'element material 1',
				'property float shininess',
				'element face 1',
				'property uchar red',
				'property list uchar int vertex_indices',
			],
			['9 0 0 0 2 7 7', '9 3 0 0 0', '9 0 4 0 1 5', '0.5', '255 3 0 1 2']
		).replaceAll('\n', '\r\n');

		const mesh = parsePlyMesh(text);

		expect(mesh.vertices[1]).toEqual([3, 0, 0]);
		expect(mesh.faces).toEqual([[0, 1, 2]]);
	});

	it('produces what the saved-file check accepts', () => {
		const mesh = parsePlyMesh(ply([...VERTEX_HEADER, ...FACE_HEADER], [...VERTICES, '3 0 1 2']));

		expect(() =>
			checkReferenceGeometryShape({
				id: 'r',
				kind: 'WIREFRAME',
				referenceGeometry: { unit: 'nm', mesh },
			})
		).not.toThrow();
	});

	it.each([
		['not a PLY file', 'solid cube\nendsolid', /not a PLY file/],
		[
			'binary PLY',
			'ply\nformat binary_little_endian 1.0\nend_header\n',
			/Binary PLY is not supported.*ASCII/,
		],
		['a missing end_header', 'ply\nformat ascii 1.0\nelement vertex 1\n', /end_header/],
		['no vertices', ply([], []), /no vertices/],
		['points only', ply(VERTEX_HEADER, VERTICES), /only points/],
		['a truncated body', ply([...VERTEX_HEADER, ...FACE_HEADER], VERTICES), /ends early/],
		[
			'a short row',
			ply([...VERTEX_HEADER, ...FACE_HEADER], ['0 0', '3 0 0', '0 4 0', '3 0 1 2']),
			/too short/,
		],
		[
			'a non-finite coordinate',
			ply([...VERTEX_HEADER, ...FACE_HEADER], ['0 0 nan', '3 0 0', '0 4 0', '3 0 1 2']),
			/not a finite number/,
		],
		[
			'a face index out of range',
			ply([...VERTEX_HEADER, ...FACE_HEADER], [...VERTICES, '3 0 1 3']),
			/face 0/,
		],
		['a two-sided face', ply([...VERTEX_HEADER, ...FACE_HEADER], [...VERTICES, '2 0 1']), /face 0/],
		[
			'an edge index out of range',
			ply(
				[...VERTEX_HEADER, 'element edge 1', 'property int vertex1', 'property int vertex2'],
				[...VERTICES, '0 9']
			),
			/edge 0/,
		],
		[
			'too many vertices',
			ply([`element vertex ${MAX_PLY_VERTICES + 1}`, 'property float x'], []),
			/the limit is/,
		],
		[
			'too many faces',
			ply(
				[
					...VERTEX_HEADER,
					`element face ${MAX_PLY_FACES + 1}`,
					'property list int int vertex_indices',
				],
				[]
			),
			/the limit is/,
		],
	])('refuses %s', (_label, text, message) => {
		expect(() => parsePlyMesh(text)).toThrow(message);
	});
});

describe('reference mesh geometry', () => {
	const mesh = {
		vertices: [
			[0, 0, 0],
			[3, 0, 0],
			[0, 4, 0],
			[0, 0, 12],
		] as [number, number, number][],
		faces: [
			[0, 1, 2],
			[2, 1, 0],
		],
		edges: [
			[0, 3],
			[3, 0],
		] as [number, number][],
	};

	it('lists each edge once, from faces and from the edge list', () => {
		expect(referenceMeshEdges(mesh)).toEqual([
			[0, 3],
			[0, 1],
			[1, 2],
			[2, 0],
		]);
	});

	it('summarizes counts, size and edge lengths', () => {
		expect(summarizeReferenceMesh(mesh)).toEqual({
			vertexCount: 4,
			faceCount: 2,
			edgeCount: 4,
			size: [3, 4, 12],
			shortestEdge: 3,
			longestEdge: 12,
		});
	});

	it('summarizes a mesh too large to spread into Math.max', () => {
		const large = {
			vertices: Array.from({ length: 200_000 }, (_, i): [number, number, number] => [i, 0, -i]),
			faces: [],
			edges: [],
		};

		expect(summarizeReferenceMesh(large).size).toEqual([199_999, 0, 199_999]);
	});

	it('tells finite vertices from ones that overflowed in scaling', () => {
		const small = { vertices: [[10, 0, 0]] as [number, number, number][], faces: [], edges: [] };

		expect(hasFiniteVertices(scaleReferenceMesh(small, 2))).toBe(true);
		expect(hasFiniteVertices(scaleReferenceMesh(small, 1e308))).toBe(false);
	});

	it('scales positions and leaves the source mesh alone', () => {
		const scaled = scaleReferenceMesh(mesh, 2);

		expect(scaled.vertices[3]).toEqual([0, 0, 24]);
		expect(scaled.faces).toEqual(mesh.faces);
		expect(mesh.vertices[3]).toEqual([0, 0, 12]);
	});

	it('converts nm to the bp count the app would draw', () => {
		expect(nmToApproxBp(BACKBONE_RISE_NM * 42)).toBe(42);
	});
});
