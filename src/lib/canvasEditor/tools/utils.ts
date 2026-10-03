import type { RspCoord } from '$lib/model/Part/Part.svelte';

export const parseRspString = (rspStr: string): RspCoord | null => {
	// expected format: "${rowIdx}-${strandIdx}-${bpIdx}"
	if (!rspStr || rspStr.length === 0) return null;
	const parts = rspStr.split('-');
	if (parts.length !== 3) return null;

	const rowIdx = Number(parts[0]);
	const strandIdxNum = Number(parts[1]);
	const bpIdx = Number(parts[2]);

	if (!Number.isInteger(rowIdx) || !Number.isInteger(bpIdx)) return null;
	if ((strandIdxNum !== 0 && strandIdxNum !== 1) || !Number.isInteger(strandIdxNum)) return null;

	return {
		rowIdx,
		strandIdx: strandIdxNum as 0 | 1,
		bpIdx,
	};
};
