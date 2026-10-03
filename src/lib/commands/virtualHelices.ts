import type { ViewContext } from '../canvasEditor/core/views';

/**
 * Reorders a VirtualHelix within its region by changing its region row.
 *
 * @param ctx - The ViewContext containing the part and history stack
 * @param draggedVhIdx - The index of the VirtualHelix to reorder
 * @param targetRegionRow - The target region-local row position
 */
export function reorderVirtualHelixCmd(
	ctx: ViewContext,
	draggedVhIdx: number,
	targetRegionRow: number
): void {
	ctx.history.tx('Reorder virtual helix', (rec) => {
		const part = ctx.part;
		const draggedVh = part.getVhByIndex(draggedVhIdx);
		if (!draggedVh) {
			console.warn(`VirtualHelix with index ${draggedVhIdx} not found`);
			return;
		}

		const scope = rec.capturePartScope(part, {
			vhIndices: part.virtualHelices.map((vh) => vh.index),
		});

		part.reorderVirtualHelixInRegion(draggedVhIdx, targetRegionRow);
		scope.commit();
	});
}
