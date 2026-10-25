import type Konva from 'konva';

import { registerCanvasHelp, type CanvasHelpAnchor } from '$lib/components/help/help';
import type { Rect } from '$lib/components/help/helpLayout';
import type { Part } from '$lib/model/Part';
import type { DrawingDimensions } from './drawingDimensions';
import { regionHeaderGeometry } from './Grid/regionHeaderGeometry';
import type { VisibleStrandRow } from './strandRowLayout';

// getRect runs every frame while help is open: scan a bounded window from the viewport top so
// the cost is the same for a 10-helix and a 10,000-helix design.
const MAX_SCANNED_ROWS = 64;
// Outline the header's name, not the full region width.
const HEADER_LABEL_WIDTH = 180;

interface WorldBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Registers `?` help notes on the first region header, its plane icon and the first helix tag in
 * view: one note each, however large the design. Returns the unregister function.
 */
export function registerStrandCanvasHelp(
	host: HTMLElement,
	stage: Konva.Stage,
	d: DrawingDimensions,
	part: Part
): () => void {
	const { radius } = d.dimensions;

	function firstRowInView<K extends VisibleStrandRow['kind']>(
		kind: K
	): Extract<VisibleStrandRow, { kind: K }> | null {
		const scale = stage.scaleX() || 1;
		const top = -stage.y() / scale;
		const bottom = (stage.height() - stage.y()) / scale;
		const start = Math.max(0, d.getRowIdxByY(top));
		for (let i = start; i < start + MAX_SCANNED_ROWS; i++) {
			const row = d.getRowAtDisplayRow(i);
			const rowY = d.getRowYByRowIdx(i);
			if (!row || rowY + radius > bottom) return null;
			if (row.kind === kind && rowY - radius >= top) {
				return row as Extract<VisibleStrandRow, { kind: K }>;
			}
		}
		return null;
	}

	function toViewport(box: WorldBox): Rect {
		const scale = stage.scaleX() || 1;
		const container = stage.container().getBoundingClientRect();
		return {
			left: container.left + stage.x() + box.x * scale,
			top: container.top + stage.y() + box.y * scale,
			width: box.width * scale,
			height: box.height * scale,
		};
	}

	function headerGeometry() {
		const row = firstRowInView('REGION_HEADER');
		if (!row) return null;
		const region = part.regions.find((r) => r.id === row.regionId);
		const maxBpIdx = Math.min(part.maxBase, region?.maxBase ?? part.maxBase);
		return regionHeaderGeometry(d, row.displayRow, maxBpIdx);
	}

	const header: CanvasHelpAnchor = {
		host,
		getRect() {
			const g = headerGeometry();
			if (!g) return null;
			const width = Math.min(g.width, HEADER_LABEL_WIDTH);
			return toViewport({ x: g.left, y: g.top, width, height: g.height });
		},
	};

	const planeIcon: CanvasHelpAnchor = {
		host,
		getRect() {
			const g = headerGeometry();
			if (!g) return null;
			return toViewport({ x: g.iconLeft, y: g.iconTop, width: g.iconSize, height: g.iconSize });
		},
	};

	const vhTag: CanvasHelpAnchor = {
		host,
		getRect() {
			const row = firstRowInView('VH');
			if (!row) return null;
			const y = d.getRowYByRowIdx(row.displayRow);
			return toViewport({ x: radius, y: y - radius, width: 2 * radius, height: 2 * radius });
		},
	};

	return registerCanvasHelp([
		[
			header,
			{
				title: 'Region header',
				text: 'Click to make the region active; double-click to collapse or expand it.',
				doc: 'views',
				placement: 'below',
				newVsCadnano: true,
			},
		],
		[
			planeIcon,
			{
				title: 'Base plane',
				text: "Opens the 3D view framed on this region's plane. Move or rotate it there with the plane gizmo.",
				doc: 'views',
				placement: 'below',
				newVsCadnano: true,
			},
		],
		[
			vhTag,
			{
				title: 'Helix tag',
				text: 'Drag up or down to reorder helices within the region.',
				doc: 'views',
				placement: 'right',
			},
		],
	]);
}
