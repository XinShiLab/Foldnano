import { describe, expect, it } from 'vitest';
import { collectPartOligoReportRows, diffOligoReportRows } from '../io/oligoReport';
import { buildOligoSignature, formatOligoKey } from '../Oligo/oligoKey';
import type Oligo from '../Oligo/Oligo.svelte';
import type { Part } from '../Part';
import { addLatticeVh, makeHoneycombPart } from './testHelpers';

function addCircularOligo(part: Part, isScaffold: boolean): Oligo {
	const vh0 = addLatticeVh(part, 0, 0);
	const vh1 = addLatticeVh(part, 2, 0);
	const oligoA = part.createOligo(vh0, 0, 3, '#ff0000', {
		oligoId: 'circular-oligo-id',
	});
	const oligoB = part.createOligo(vh1, 3, 0, '#00ff00');
	const segA = [...oligoA.segments][0];
	const segB = [...oligoB.segments][0];

	segA.threePrime.connectTo(segB.fivePrime);
	oligoA.addSegment(segB);
	part.oligos.delete(oligoB);
	segB.threePrime.connectTo(segA.fivePrime);
	oligoA.isScaffold = isScaffold;

	expect(oligoA.isCircular).toBe(true);
	return oligoA;
}

describe('oligo report rows', () => {
	it('builds CSV-compatible linear fields with a topology-derived OligoKey', () => {
		const part = makeHoneycombPart('linear-oligo-report');
		const vh = addLatticeVh(part, 0, 0);
		const oligo = part.createOligo(vh, 0, 3, '#ff0000', {
			oligoId: '12345678-1234-1234-1234-123456789abc',
		});
		oligo.updateOwnSequence('ACGT');

		const signature = '0[0]>0[3]';
		expect(buildOligoSignature(oligo)).toBe(signature);
		expect(collectPartOligoReportRows(part)).toEqual([
			{
				oligoKey: formatOligoKey(signature),
				signature,
				fullOligoId: '12345678-1234-1234-1234-123456789abc',
				name: '',
				start: '0[0]',
				end: '0[3]',
				sequence: 'ACGT',
				length: 4,
				color: '#ff0000',
				mod5Prime: '',
				mod3Prime: '',
				positions: '0[0]>0[3]',
				isCircular: false,
			},
		]);
	});

	it('uses the lowest circular segment 5-prime endpoint as the canonical signature start', () => {
		const part = makeHoneycombPart('circular-oligo-report');
		const circular = addCircularOligo(part, true);

		expect(buildOligoSignature(circular)).toBe('0[0]>0[3]|2[3]>2[0]');
	});

	it('builds display-only circular rows without sequence output', () => {
		const part = makeHoneycombPart('circular-oligo-report');
		addCircularOligo(part, true);

		const signature = '0[0]>0[3]|2[3]>2[0]';
		const [row] = collectPartOligoReportRows(part);
		expect(row.oligoKey).toBe(formatOligoKey(signature));
		expect(row.signature).toBe(signature);
		expect(row.start).toBe('Circular');
		expect(row.end).toBe('Circular');
		expect(row.sequence).toBe('');
		expect(row.length).toBe(8);
		expect(row.color).toBe('#ff0000');
		expect(row.positions).toBe('0[0]>0[3], 2[3]>2[0]');
		expect(row.isCircular).toBe(true);
	});

	it('compares rows by signature rather than oligo ID', () => {
		const left = [
			{
				oligoKey: formatOligoKey('0[0]>0[3]'),
				signature: '0[0]>0[3]',
				fullOligoId: 'left-id',
				name: '',
				start: '0[0]',
				end: '0[3]',
				sequence: 'AAAA',
				length: 4,
				color: '#ff0000',
				mod5Prime: '',
				mod3Prime: '',
				positions: '0[0]>0[3]',
				isCircular: false,
			},
		];
		const right = [{ ...left[0], fullOligoId: 'right-id', sequence: 'AAAT' }];

		const diff = diffOligoReportRows(left, right);
		expect(diff.changed).toHaveLength(1);
		expect(diff.changed[0].changedColumns).toEqual(['sequence']);
		expect(diff.leftOnly).toHaveLength(0);
		expect(diff.rightOnly).toHaveLength(0);
	});

	it('reports a renamed oligo as a name change', () => {
		const row = {
			oligoKey: formatOligoKey('0[0]>0[3]'),
			signature: '0[0]>0[3]',
			fullOligoId: 'left-id',
			name: '',
			start: '0[0]',
			end: '0[3]',
			sequence: 'AAAA',
			length: 4,
			color: '#ff0000',
			mod5Prime: '',
			mod3Prime: '',
			positions: '0[0]>0[3]',
			isCircular: false,
		};
		const diff = diffOligoReportRows([row], [{ ...row, name: 'edge-1' }]);
		expect(diff.changed[0].changedColumns).toEqual(['name']);
	});
});
