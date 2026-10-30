import type { HandlerInstance } from '../../types';
import type { ViewContext } from '../../../core/views';
import { reorderVirtualHelixCmd } from '$lib/commands/virtualHelices';
import { removeTempPartsByType } from './drawTempPartsOps';

export function createVhTagHandler(): HandlerInstance {
	let dragging = false;
	let startRegionRow: number | null = null;
	let draggedVhIdx: number | null = null;
	let draggedRegionId: string | null = null;
	let startY: number | null = null;
	let currentPreviewRow: number | null = null;

	// Helper function to reset state
	const resetState = (ctx?: ViewContext) => {
		// Clean up preview line if it exists
		if (ctx) {
			removeTempPartsByType(ctx, 'VhDragPreview');
		}
		dragging = false;
		startRegionRow = null;
		draggedVhIdx = null;
		draggedRegionId = null;
		startY = null;
		currentPreviewRow = null;
	};

	return {
		kind: 'VH_TAG',

		down(evt, ctx, hit) {
			// Extract VH index from hit.id (format: "vh-circle-{vh.index}")
			if (!hit.id) return false;
			const vhIdx = parseInt(hit.id);
			const vh = ctx.part.getVhByIndex(vhIdx);

			if (!vh) return false;
			if (!vh.regionId) return false;
			// Freeform helices get selected so the Select panel's roll/position fields follow them.
			if (vh.localFrame) {
				if (evt.shiftKey || evt.metaKey || evt.ctrlKey) {
					ctx.editorCtx.toggleSelectedFreeformVh(vhIdx);
				} else {
					ctx.editorCtx.setSelectedFreeformVhs([vhIdx]);
				}
			}
			const regionRows = ctx.drawingDimensions
				.getVisibleVhRows()
				.filter((row) => row.regionId === vh.regionId);
			const startRow = regionRows.find((row) => row.vh.id === vh.id);
			if (!startRow) return false;

			dragging = true;
			draggedVhIdx = vhIdx;
			draggedRegionId = vh.regionId;
			startRegionRow = startRow.regionRow;
			startY = evt.clientY;
			currentPreviewRow = startRow.displayRow;

			// Add initial preview line
			ctx.strandCtx.tempParts.push({
				type: 'VhDragPreview',
				props: {
					targetRowIdx: startRow.displayRow,
					maxBpIdx: ctx.part.maxBase,
				},
			});

			return true; // Capture the drag
		},

		move(evt, ctx, _hit) {
			if (
				!dragging ||
				draggedVhIdx === null ||
				draggedRegionId === null ||
				startY === null ||
				startRegionRow === null
			) {
				return false;
			}

			const vh = ctx.part.getVhByIndex(draggedVhIdx);
			if (!vh) return false;
			const regionRows = ctx.drawingDimensions
				.getVisibleVhRows()
				.filter((row) => row.regionId === draggedRegionId);
			if (regionRows.length === 0) return false;

			// Calculate new row position based on Y delta.
			// evt.clientY is in CSS pixels (stage.getPointerPosition), but rowHeight is in
			// model units. Divide by viewportScale to convert CSS pixels → model units.
			const scale = ctx.strandCtx.viewportScale || 1;
			const deltaY = (evt.clientY - startY) / scale;
			const { radius } = ctx.drawingDimensions.dimensions;
			const rowHeight = 3 * radius; // from drawingDimensions.ts:6
			const rowDelta = Math.round(deltaY / rowHeight);

			const maxRegionRow = regionRows.length - 1;
			const newRegionRow = Math.max(0, Math.min(maxRegionRow, startRegionRow + rowDelta));
			const targetDisplayRow = regionRows[newRegionRow]?.displayRow;
			if (targetDisplayRow === undefined) return false;

			// Update preview feedback
			if (targetDisplayRow !== currentPreviewRow) {
				currentPreviewRow = targetDisplayRow;
				ctx.strandCtx.footnote = `Moving VH ${draggedVhIdx} to row ${newRegionRow}`;

				// Update the preview line position
				const previewIndex = ctx.strandCtx.tempParts.findIndex((p) => p.type === 'VhDragPreview');
				if (previewIndex !== -1) {
					ctx.strandCtx.tempParts[previewIndex] = {
						type: 'VhDragPreview',
						props: {
							targetRowIdx: targetDisplayRow,
							maxBpIdx: ctx.part.maxBase,
						},
					};
				}
			}

			return true;
		},

		up(evt, ctx, _hit) {
			if (
				!dragging ||
				draggedVhIdx === null ||
				draggedRegionId === null ||
				startY === null ||
				startRegionRow === null
			) {
				return false;
			}

			const vh = ctx.part.getVhByIndex(draggedVhIdx);
			if (!vh) return false;
			const activeVh =
				ctx.strandCtx.activeAround.rowIdx !== -1
					? ctx.drawingDimensions.getVisibleVhByDisplayRow(ctx.strandCtx.activeAround.rowIdx)
					: null;
			const regionRows = ctx.drawingDimensions
				.getVisibleVhRows()
				.filter((row) => row.regionId === draggedRegionId);
			if (regionRows.length === 0) {
				resetState(ctx);
				return false;
			}

			const scale = ctx.strandCtx.viewportScale || 1;
			const deltaY = (evt.clientY - startY) / scale;
			const { radius } = ctx.drawingDimensions.dimensions;
			const rowHeight = 3 * radius;
			const rowDelta = Math.round(deltaY / rowHeight);

			const maxRegionRow = regionRows.length - 1;
			const newRegionRow = Math.max(0, Math.min(maxRegionRow, startRegionRow + rowDelta));

			if (newRegionRow !== startRegionRow) {
				reorderVirtualHelixCmd(ctx, draggedVhIdx, newRegionRow);
				if (activeVh?.id === vh.id) {
					const newDisplayRow = ctx.drawingDimensions.getDisplayRowForVh(vh.id);
					if (newDisplayRow !== null) {
						ctx.strandCtx.activeAround = {
							rowIdx: newDisplayRow,
							bpIdx: ctx.strandCtx.activeAround.bpIdx,
						};
					}
				}
				ctx.strandCtx.footnote = `Moved VH ${draggedVhIdx} to row ${newRegionRow}`;
			} else {
				ctx.strandCtx.footnote = '';
			}

			// Remove the preview line and reset state
			resetState(ctx);
			return true;
		},

		cancel(_evt, ctx, _hit) {
			ctx.strandCtx.footnote = '';
			// Remove the preview line and reset state
			resetState(ctx);
			return false;
		},

		reset(ctx) {
			// Delegate to the resetState helper
			resetState(ctx);
		},
	};
}
