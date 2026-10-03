const BLOCK_COLORS = [
	'#0ea5e9',
	'#22c55e',
	'#f97316',
	'#e11d48',
	'#8b5cf6',
	'#14b8a6',
	'#facc15',
	'#ec4899',
	'#84cc16',
	'#6366f1',
];

export function getBlockColor(blockId: string): string {
	const numeric = Number(blockId.replace(/^\D+/, ''));
	if (Number.isFinite(numeric) && numeric > 0) {
		return BLOCK_COLORS[(numeric - 1) % BLOCK_COLORS.length];
	}
	let hash = 0;
	for (let i = 0; i < blockId.length; i++) hash = (hash * 31 + blockId.charCodeAt(i)) | 0;
	return BLOCK_COLORS[Math.abs(hash) % BLOCK_COLORS.length];
}
