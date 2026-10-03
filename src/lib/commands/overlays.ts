import type { Part } from '$lib/model/Part';
import type { OverlayPlacement } from '$lib/model/Part/Part.svelte';
import type { HistoryStack } from './history.svelte';

function clonePlacement(p: OverlayPlacement): OverlayPlacement {
	return {
		id: p.id,
		sourceKey: p.sourceKey,
		transform: {
			position: { ...p.transform.position },
			quaternion: [...p.transform.quaternion] as [number, number, number, number],
		},
	};
}

/**
 * Upsert one external-structure overlay placement as a targeted, undoable patch
 * (no full-document snapshot). Covers add / move / reset.
 */
export function setOverlayPlacementCmd(
	historyStack: HistoryStack,
	part: Part,
	id: string,
	sourceKey: string,
	transform: OverlayPlacement['transform'],
	label = 'Move overlay'
): void {
	historyStack.tx(label, (rec) => {
		const existing = part.getOverlayPlacement(id);
		const before = existing ? clonePlacement(existing) : undefined;
		part.setOverlayPlacement(id, sourceKey, transform);
		const after = part.getOverlayPlacement(id);
		rec.overlayPlacement(part, id, before, after ? clonePlacement(after) : undefined);
	});
}

/** Remove one overlay placement as a targeted, undoable patch. */
export function clearOverlayPlacementCmd(
	historyStack: HistoryStack,
	part: Part,
	id: string,
	label = 'Remove overlay'
): void {
	const existing = part.getOverlayPlacement(id);
	if (!existing) return;
	const before = clonePlacement(existing);
	historyStack.tx(label, (rec) => {
		part.clearOverlayPlacement(id);
		rec.overlayPlacement(part, id, before, undefined);
	});
}
