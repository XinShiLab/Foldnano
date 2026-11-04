import type FoldnanoDocument from '../document.svelte';
import type { RegionKind } from '../Part/DesignRegion';

const KIND_ORDER: readonly RegionKind[] = ['HONEYCOMB', 'SQUARE', 'FREEFORM', 'WIREFRAME'];

const count = (n: number, one: string, many: string): string =>
	`${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** One line about what a design holds, e.g. "2 regions (honeycomb, wireframe) · 48 helices · …". */
export function summarizeDesign(doc: FoldnanoDocument): string {
	const regions = doc.parts.flatMap((part) => part.regions);
	if (regions.length === 0) return 'Empty design';
	const helixCount = doc.parts.reduce((sum, part) => sum + part.virtualHelices.length, 0);
	const oligos = doc.parts.flatMap((part) => [...part.oligos]);

	const kinds = KIND_ORDER.filter((kind) => regions.some((r) => r.kind === kind)).map((kind) =>
		kind.toLowerCase()
	);
	const pieces = [
		regions.length === 1
			? `1 ${kinds[0]} region`
			: `${regions.length} regions (${kinds.join(', ')})`,
		count(helixCount, 'helix', 'helices'),
	];
	const scaffolds = oligos.filter((o) => o.isScaffold).map((o) => o.length.toLocaleString('en-US'));
	if (scaffolds.length === 1) pieces.push(`scaffold ${scaffolds[0]} nt`);
	else if (scaffolds.length > 1)
		pieces.push(`${scaffolds.length} scaffolds (${scaffolds.join(', ')} nt)`);
	pieces.push(count(oligos.length - scaffolds.length, 'staple', 'staples'));
	return pieces.join(' · ');
}
