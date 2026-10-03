import type { Part } from '$lib/model/Part';
import { createStrandRowLayout } from './strandRowLayout';
import { createDrawingDimensions } from './drawingDimensions';
import { bulgePoint, getAttachmentPoints, direction } from './crossover/utils';
import { getPlaneColor, planeColorAsCss } from '$lib/model/Part/planeColors';
import { getModificationColor, truncateModificationName } from '$lib/model/modifications';
import { downloadFile } from '../View3D/threeUtils';
import { MIRROR_OPACITY } from './drawingContext';

// Mirror oligos (repeat copies) are faded as a whole group, like the canvas does.
const mirrorGroupOpen = `<g class="mirror-oligo" opacity="${MIRROR_OPACITY}">`;

export interface SvgExportOptions {
	includeSequence?: boolean;
	includeGrid?: boolean;
}

// Hardcoded sRGB fallbacks (theme uses oklch which SVG renderers may not support)
const VH_FILL = '#f5f3e8';
const VH_STROKE = '#a86040';
const VH_TEXT = '#374151';
const GRID_LINE = '#e5e7eb';
const BG_FILL = '#ffffff';

const RADIUS = 16;
const SIDE_LENGTH = 12;
const STROKE_WIDTH = 1;
const SEG_STROKE_WIDTH = 2; // = STROKE_WIDTH * 2, matches StrandRoutes.svelte

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function pts(coords: number[]): string {
	return coords.map((v) => v.toFixed(2)).join(',');
}

/** Small colored "• Name" label for a modified terminus, left-anchored at (x, y). */
function modificationLabelSvg(x: number, y: number, name: string, color: string): string {
	return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="7" fill="${color}">• ${esc(truncateModificationName(name))}</text>`;
}

// Port of Konva's getControlPoints — returns [incoming-cp, outgoing-cp] at P1
function konvaCp(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	t: number
): [number, number, number, number] {
	const d01 = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
	const d12 = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
	const fa = (t * d01) / (d01 + d12);
	const fb = (t * d12) / (d01 + d12);
	return [
		x1 - fa * (x2 - x0),
		y1 - fa * (y2 - y0), // incoming
		x1 + fb * (x2 - x0),
		y1 + fb * (y2 - y0), // outgoing
	];
}

// Closed cubic-bezier triangle matching Konva Line closed=true tension=t
function konvaTrianglePath(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
	t: number
): string {
	const [aIn0, aIn1, aOut0, aOut1] = konvaCp(cx, cy, ax, ay, bx, by, t);
	const [bIn0, bIn1, bOut0, bOut1] = konvaCp(ax, ay, bx, by, cx, cy, t);
	const [cIn0, cIn1, cOut0, cOut1] = konvaCp(bx, by, cx, cy, ax, ay, t);
	const f = (n: number) => n.toFixed(2);
	return (
		`M${f(ax)},${f(ay)} ` +
		`C${f(aOut0)},${f(aOut1)} ${f(bIn0)},${f(bIn1)} ${f(bx)},${f(by)} ` +
		`C${f(bOut0)},${f(bOut1)} ${f(cIn0)},${f(cIn1)} ${f(cx)},${f(cy)} ` +
		`C${f(cOut0)},${f(cOut1)} ${f(aIn0)},${f(aIn1)} ${f(ax)},${f(ay)} Z`
	);
}

export function exportStrandViewSvg(part: Part, options: SvgExportOptions = {}): string {
	const { includeSequence = true, includeGrid = true } = options;

	const radius = RADIUS;
	const sideLength = SIDE_LENGTH;
	const strokeWidth = STROKE_WIDTH;
	const l = sideLength / 2;

	const layout = createStrandRowLayout(part, [], radius, sideLength, strokeWidth);
	const dims = createDrawingDimensions(radius, sideLength, strokeWidth, () => layout);
	const { getRowYByRowIdx, getXByBpIdx, getBpCoordsByRowAndBpIdx } = dims;

	const allRows = layout.getVisibleStrandRows();
	const vhRows = layout.getVisibleVhRows();

	const globalMaxBp = Math.max(...part.regions.map((r) => r.maxBase), 0);
	const totalDisplayRows = allRows.length;

	const svgWidth = getXByBpIdx(globalMaxBp) + sideLength + radius;
	const svgHeight =
		totalDisplayRows > 0
			? getRowYByRowIdx(totalDisplayRows - 1) + sideLength + radius + 8
			: sideLength * 4;

	const parts: string[] = [];

	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth.toFixed(2)} ${svgHeight.toFixed(2)}" width="${svgWidth.toFixed(2)}" height="${svgHeight.toFixed(2)}">`
	);
	parts.push(`<style>text { font-family: sans-serif; }</style>`);

	// Background
	parts.push(`<g id="background">`);
	parts.push(
		`<rect x="0" y="0" width="${svgWidth.toFixed(2)}" height="${svgHeight.toFixed(2)}" fill="${BG_FILL}"/>`
	);
	parts.push(`</g>`);

	// Grid
	if (includeGrid) {
		parts.push(`<g id="grid">`);
		for (const row of vhRows) {
			const vh = row.vh;
			const rowY = getRowYByRowIdx(row.displayRow);
			const xGrid = getXByBpIdx(0);
			const yGrid = rowY - sideLength;
			const gridW = sideLength * vh.length;

			// Background rect (transparent fill, just outline)
			parts.push(
				`<rect x="${xGrid.toFixed(2)}" y="${yGrid.toFixed(2)}" width="${gridW.toFixed(2)}" height="${(sideLength * 2).toFixed(2)}" fill="none" stroke="${GRID_LINE}" stroke-width="${strokeWidth}"/>`
			);

			// Horizontal midline
			parts.push(
				`<line x1="${xGrid.toFixed(2)}" y1="${rowY.toFixed(2)}" x2="${(xGrid + gridW).toFixed(2)}" y2="${rowY.toFixed(2)}" stroke="${GRID_LINE}" stroke-width="${strokeWidth}"/>`
			);

			// Thin vertical lines per bp
			const thinLineParts: string[] = [];
			for (let i = 0; i <= vh.length; i++) {
				const lx = xGrid + i * sideLength + 0.5;
				thinLineParts.push(
					`M${lx.toFixed(2)},${yGrid.toFixed(2)}L${lx.toFixed(2)},${(yGrid + 2 * sideLength).toFixed(2)}`
				);
			}
			if (thinLineParts.length > 0) {
				parts.push(
					`<path d="${thinLineParts.join('')}" stroke="${GRID_LINE}" stroke-width="${strokeWidth}" fill="none"/>`
				);
			}

			// Thick sub-step lines
			const subStepSize =
				(vh.regionId ? part.getRegionById(vh.regionId)?.subStepSize : null) ?? part.subStepSize;
			if (subStepSize > 0) {
				const thickLineParts: string[] = [];
				for (let idx = 0; idx < Math.floor(vh.length / subStepSize); idx++) {
					const lx = xGrid + idx * subStepSize * sideLength;
					thickLineParts.push(
						`M${lx.toFixed(2)},${yGrid.toFixed(2)}L${lx.toFixed(2)},${(yGrid + 2 * sideLength).toFixed(2)}`
					);
				}
				if (thickLineParts.length > 0) {
					parts.push(
						`<path d="${thickLineParts.join('')}" stroke="${GRID_LINE}" stroke-width="2" fill="none"/>`
					);
				}
			}
		}
		parts.push(`</g>`);
	}

	// Collect sequence text separately so it can be rendered on the top layer
	const seqParts: string[] = [];

	// Strands
	parts.push(`<g id="strands">`);
	for (const oligo of part.oligos) {
		const color = esc(oligo.color ?? '#888888');
		if (oligo.isMirror) parts.push(mirrorGroupOpen);
		for (const segment of oligo.segments) {
			const displayRow = layout.getDisplayRowForVh(segment.inVirtualHelix.id);
			if (displayRow === null) continue;

			const strandIdx = segment.inStrandIndex;
			const offset: [number, number] = [sideLength / 2, sideLength / 2];

			const startCoords = getBpCoordsByRowAndBpIdx(displayRow, segment.fivePrime.index);
			const endCoords = getBpCoordsByRowAndBpIdx(displayRow, segment.threePrime.index);

			const x1 = startCoords[strandIdx][0] + offset[0];
			const y1 = startCoords[strandIdx][1] + offset[1];
			const x2 = endCoords[strandIdx][0] + offset[0];
			const y2 = endCoords[strandIdx][1] + offset[1];

			// Segment line
			parts.push(
				`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="${SEG_STROKE_WIDTH}" stroke-linecap="round"/>`
			);

			// 5' terminus (square) when free
			if (segment.fivePrime.isFree) {
				const size = strokeWidth * 6;
				const half = size / 2;
				parts.push(
					`<rect x="${(x1 - half).toFixed(2)}" y="${(y1 - half).toFixed(2)}" width="${size}" height="${size}" fill="${color}"/>`
				);
			}

			// 3' terminus (triangle arrow) when free
			if (segment.threePrime.isFree) {
				const size = strokeWidth * 8;
				const dir3 = strandIdx === 0 ? 'RIGHT' : 'LEFT';
				let triPts: number[];
				if (dir3 === 'RIGHT') {
					triPts = [
						x2 + size / 2 + 1,
						y2,
						x2 - size / 2 + 1,
						y2 - size / 2,
						x2 - size / 2 + 1,
						y2 + size / 2,
					];
				} else {
					triPts = [
						x2 - size / 2 - 1,
						y2,
						x2 + size / 2 - 1,
						y2 - size / 2,
						x2 + size / 2 - 1,
						y2 + size / 2,
					];
				}
				parts.push(`<polygon points="${pts(triPts)}" fill="${color}"/>`);
			}

			// Modification labels, matching OligoSegmentInPart.svelte's canvas placement.
			if (segment.fivePrime.modification) {
				const color = getModificationColor(
					segment.fivePrime.modification,
					part.customModifications
				);
				const my = strandIdx === 0 ? y1 - 14 : y1 + 6;
				parts.push(modificationLabelSvg(x1 - 5, my, segment.fivePrime.modification, color));
			}
			if (segment.threePrime.modification) {
				const color = getModificationColor(
					segment.threePrime.modification,
					part.customModifications
				);
				const my = strandIdx === 0 ? y2 - 14 : y2 + 6;
				parts.push(modificationLabelSvg(x2 - 5, my, segment.threePrime.modification, color));
			}

			// Sequence text (always rendered in export, not zoom-gated)
			if (includeSequence) {
				for (const slot of segment.slots) {
					const slotSeq = slot.seq;
					if (!slotSeq || /^N+$/.test(slotSeq)) continue;
					const isInsert = slotSeq.length > 1;
					const charToShow =
						slotSeq.length > 2
							? String(slotSeq.length)
							: isInsert && strandIdx === 1
								? slotSeq.split('').reverse().join('')
								: slotSeq;

					const [xNuc, yNuc] = getBpCoordsByRowAndBpIdx(displayRow, slot.bpIndex)[strandIdx];
					const tx = xNuc + offset[0];
					const ty = yNuc + offset[1] + 1;
					const fillOpacity = isInsert ? '0.9' : '0.5';

					seqParts.push(
						`<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" text-anchor="middle" dominant-baseline="hanging" font-size="5" fill="black" fill-opacity="${fillOpacity}">${esc(charToShow)}</text>`
					);
				}
			}
		}
		if (oligo.isMirror) parts.push(`</g>`);
	}
	parts.push(`</g>`);

	// Crossovers
	parts.push(`<g id="crossovers">`);
	for (const oligo of part.oligos) {
		const color = esc(oligo.color ?? '#888888');
		if (oligo.isMirror) parts.push(mirrorGroupOpen);
		for (const segment of oligo.segments) {
			if (!segment.threePrime.connectedEnd) continue;

			const connectedEnd = segment.threePrime.connectedEnd;
			const segRow = layout.getDisplayRowForVh(segment.inVirtualHelix.id);
			const connRow = layout.getDisplayRowForVh(connectedEnd.segment.inVirtualHelix.id);
			if (segRow === null || connRow === null) continue;

			const strandIdx = segment.inStrandIndex;
			const connStrandIdx = connectedEnd.segment.inStrandIndex;
			const isConstrained = segment.threePrime.isConstrained && connectedEnd.isConstrained;

			// Raw coords (no offset) for CVTerminus L-brackets
			const [x1o, y1o] = getBpCoordsByRowAndBpIdx(segRow, segment.threePrime.index)[strandIdx];
			const [x2o, y2o] = getBpCoordsByRowAndBpIdx(connRow, connectedEnd.index)[connStrandIdx];

			// Attachment points (with sideLength offset) for the arc
			const [x1, y1] = getAttachmentPoints(x1o, y1o, sideLength, strandIdx);
			const [x2, y2] = getAttachmentPoints(x2o, y2o, sideLength, connStrandIdx);

			const dir = direction(
				[segRow, segment.threePrime.index, strandIdx],
				[connRow, connectedEnd.index, connStrandIdx]
			);
			const [bpx, bpy] = bulgePoint(x1, y1, x2, y2, dir);

			const dx = x2 - x1;
			const dy = y2 - y1;
			// Inside a mirror group the group opacity alone applies, matching the canvas.
			const opacity = isConstrained || oligo.isMirror ? 1 : 0.5;

			// Arc path: two quadratic beziers matching Konva tension=0.4
			const arcD = [
				`M${x1.toFixed(2)},${y1.toFixed(2)}`,
				`Q${(bpx - dx * 0.2).toFixed(2)},${(bpy - dy * 0.2).toFixed(2)} ${bpx.toFixed(2)},${bpy.toFixed(2)}`,
				`Q${(bpx + dx * 0.2).toFixed(2)},${(bpy + dy * 0.2).toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`,
			].join(' ');

			parts.push(
				`<path d="${arcD}" stroke="${color}" stroke-width="${SEG_STROKE_WIDTH}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`
			);

			// CVTerminus L-brackets for start (3' of segment) and end (5' of connectedEnd)
			// start && strand 0: [x+l, y,  x+l, y+l, x,    y+l]
			// end   && strand 0: [x+l, y,  x+l, y+l, x+2l, y+l]
			// start && strand 1: [x+2l, y+l, x+l, y+l, x+l,  y+2l]
			// end   && strand 1: [x,    y+l, x+l, y+l, x+l,  y+2l]
			const termPoints = (x: number, y: number, isStart: boolean, strand: 0 | 1): number[] => {
				if (isStart && strand === 0) return [x + l, y, x + l, y + l, x, y + l];
				if (!isStart && strand === 0) return [x + l, y, x + l, y + l, x + 2 * l, y + l];
				if (isStart && strand === 1) return [x + 2 * l, y + l, x + l, y + l, x + l, y + 2 * l];
				return [x, y + l, x + l, y + l, x + l, y + 2 * l];
			};

			const startTermPts = termPoints(x1o, y1o, true, strandIdx);
			parts.push(
				`<polyline points="${pts(startTermPts)}" stroke="${color}" stroke-width="${SEG_STROKE_WIDTH}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`
			);

			const endTermPts = termPoints(x2o, y2o, false, connStrandIdx);
			parts.push(
				`<polyline points="${pts(endTermPts)}" stroke="${color}" stroke-width="${SEG_STROKE_WIDTH}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`
			);

			// Constrained crossover marker
			if (isConstrained) {
				parts.push(
					`<circle cx="${bpx.toFixed(2)}" cy="${bpy.toFixed(2)}" r="${(strokeWidth * 1.6).toFixed(2)}" fill="white" stroke="${color}" stroke-width="${strokeWidth}"/>`
				);
				parts.push(
					`<circle cx="${bpx.toFixed(2)}" cy="${bpy.toFixed(2)}" r="${(strokeWidth * 0.3).toFixed(2)}" fill="${color}"/>`
				);
			}
		}
		if (oligo.isMirror) parts.push(`</g>`);
	}
	parts.push(`</g>`);

	// Labels: region headers and VH tags
	parts.push(`<g id="labels">`);

	for (const row of allRows) {
		if (row.kind === 'REGION_HEADER') {
			const region = part.regions.find((r) => r.id === row.regionId);
			const headerMaxBpIdx = Math.min(globalMaxBp, region ? region.maxBase : globalMaxBp);
			const rowY = getRowYByRowIdx(row.displayRow);
			const hx = 2 * radius;
			const hy = rowY - sideLength - 4;
			const hWidth = getXByBpIdx(headerMaxBpIdx) - hx + sideLength * 2;
			const hHeight = sideLength * 2 + 8;

			let planeColor: string | null = null;
			if (region) {
				const planeIndex = part.planes.findIndex((p) => p.id === region.planeId);
				if (planeIndex >= 0) {
					planeColor = planeColorAsCss(getPlaneColor(planeIndex));
				}
			}
			const planeFillColor = planeColor ?? VH_FILL;
			const planeFillOpacity = planeColor ? '0.13' : '1';
			const headerStroke = planeColor ?? VH_STROKE;

			parts.push(
				`<rect x="${(hx - radius).toFixed(2)}" y="${hy.toFixed(2)}" width="${hWidth.toFixed(2)}" height="${hHeight}" fill="${planeFillColor}" fill-opacity="${planeFillOpacity}" stroke="${headerStroke}" stroke-width="${strokeWidth}" rx="2"/>`
			);

			const label = esc(`${row.regionName} (${row.vhCount})`);
			const labelX = hx + 2 + 4 + 6; // chevronX + chevronHalfHeight + 6
			const labelY = hy + hHeight / 2;
			parts.push(
				`<text x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" dy="0.35em" text-anchor="start" font-size="12" font-weight="bold" fill="${VH_TEXT}">${label}</text>`
			);
		} else {
			// VH row tag
			const vh = row.vh;
			const rowY = getRowYByRowIdx(row.displayRow);
			const cx = 2 * radius;
			const cy = rowY;

			parts.push(
				`<circle cx="${cx}" cy="${cy.toFixed(2)}" r="${radius}" fill="${VH_FILL}" stroke="${VH_STROKE}" stroke-width="${strokeWidth}"/>`
			);
			parts.push(
				`<text x="${cx}" y="${cy.toFixed(2)}" dy="0.35em" text-anchor="middle" font-size="${radius}" font-weight="bold" fill="${VH_TEXT}">${esc(vh.index.toString().padStart(2, '0'))}</text>`
			);
		}
	}

	parts.push(`</g>`);

	// Skip (X) and insert (triangle) marks — rendered above strands and crossovers
	parts.push(`<g id="skips-inserts">`);
	for (const oligo of part.oligos) {
		for (const segment of oligo.segments) {
			const displayRow = layout.getDisplayRowForVh(segment.inVirtualHelix.id);
			if (displayRow === null) continue;
			const strandIdx = segment.inStrandIndex;
			const sw = (strokeWidth * 1.5).toFixed(2);
			const insertColor = esc(oligo.color ?? '#888888');
			for (const [bpIdx, count] of segment.skipsAndInserts) {
				const [rawX, rawY] = getBpCoordsByRowAndBpIdx(displayRow, bpIdx)[strandIdx];
				if (count === -1) {
					// Skip: red X spanning the cell (always red, matching Skip.svelte)
					parts.push(
						`<line x1="${rawX.toFixed(2)}" y1="${rawY.toFixed(2)}" x2="${(rawX + sideLength).toFixed(2)}" y2="${(rawY + sideLength).toFixed(2)}" stroke="red" stroke-width="${sw}" stroke-linecap="round"/>`
					);
					parts.push(
						`<line x1="${(rawX + sideLength).toFixed(2)}" y1="${rawY.toFixed(2)}" x2="${rawX.toFixed(2)}" y2="${(rawY + sideLength).toFixed(2)}" stroke="red" stroke-width="${sw}" stroke-linecap="round"/>`
					);
				} else {
					// Insert: curved triangle + count, using oligo color (matches Insert.svelte)
					const ix = rawX + sideLength / 2;
					const iy = rawY;
					let pathD: string;
					let textY: number;
					if (strandIdx === 0) {
						// isUp=true: tip at bottom-center, base at top (matches InsertMark.svelte)
						pathD = konvaTrianglePath(
							ix,
							iy + sideLength / 2,
							ix - sideLength / 2,
							iy - sideLength / 2,
							ix + sideLength / 2,
							iy - sideLength / 2,
							0.5
						);
						// centroid y: (iy+sl/2 + iy-sl/2 + iy-sl/2)/3 = iy - sl/6
						textY = iy - sideLength / 6;
					} else {
						// isUp=false: tip at top-center, base at bottom (matches InsertMark.svelte)
						pathD = konvaTrianglePath(
							ix,
							iy + sideLength / 2,
							ix - sideLength / 2,
							iy + sideLength * 1.5,
							ix + sideLength / 2,
							iy + sideLength * 1.5,
							0.5
						);
						textY = iy + sideLength;
					}
					parts.push(
						`<path d="${pathD}" stroke="${insertColor}" stroke-width="${sw}" fill="none" stroke-linejoin="round"/>`
					);
					parts.push(
						`<text x="${ix.toFixed(2)}" y="${textY.toFixed(2)}" dy="0.35em" text-anchor="middle" font-size="${(sideLength / 1.8).toFixed(2)}" font-weight="bold" fill="${insertColor}">${count}</text>`
					);
				}
			}
		}
	}
	parts.push(`</g>`);

	// Sequence text — top layer so it is never obscured by strands or crossovers
	if (seqParts.length > 0) {
		parts.push(`<g id="sequence">`);
		for (const s of seqParts) parts.push(s);
		parts.push(`</g>`);
	}

	parts.push(`</svg>`);

	return parts.join('\n');
}

export function downloadStrandViewSvg(
	part: Part,
	filename: string,
	options?: SvgExportOptions
): void {
	const svgString = exportStrandViewSvg(part, options);
	const blob = new Blob([svgString], { type: 'image/svg+xml' });
	const url = URL.createObjectURL(blob);
	downloadFile(url, filename);
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
