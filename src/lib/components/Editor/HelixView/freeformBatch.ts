// Batched plane-view drawing for regions without plane-view editing (wireframes): the viewer
// flattens the region into a FreeformScene of canvas-space data, one Konva Shape draws it, and
// clicks are resolved geometrically against the same data instead of per-node hit targets.

import { helixCircleLabelFontSize } from './utils';

export interface SceneBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface SceneStrand {
	/** Helix-local x of the 5' and 3' ends (px along the axis from bp 0). */
	fiveX: number;
	threeX: number;
	/** 0 draws above the axis with its 3' arrow pointing +x; 1 below, pointing -x. */
	strandIdx: 0 | 1;
	color: string;
	opacity: number;
}

interface SceneHelixBase {
	vhIndex: number;
	/** Canvas position of the helix origin (bp 0 for in-plane helices). */
	x: number;
	y: number;
	opacity: number;
	bounds: SceneBounds;
}

export interface SceneInPlaneHelix extends SceneHelixBase {
	kind: 'inPlane';
	angleRad: number;
	lengthPx: number;
	strands: SceneStrand[];
}

export interface ScenePerpendicularHelix extends SceneHelixBase {
	kind: 'perpendicular';
	/** Scaffold phase at bp 0 and per bp (deg); the cursor bp is applied at draw time. */
	scafStartDeg: number;
	scafBpDeg: number;
}

export type SceneHelix = SceneInPlaneHelix | ScenePerpendicularHelix;

export interface SceneCrossover {
	from: { x: number; y: number };
	to: { x: number; y: number };
	/** Point the curve passes through, off the straight line. */
	bulge: { x: number; y: number };
	color: string;
	opacity: number;
	constrained: boolean;
	bounds: SceneBounds;
}

export interface SceneTheme {
	outline: string;
	label: string;
	helixFill: string;
	helixStroke: string;
	helixLabel: string;
	scafIndicator: string;
	crossoverDotFill: string;
}

export interface FreeformScene {
	/** Far first, so nearer helices draw on top. */
	helices: SceneHelix[];
	crossovers: SceneCrossover[];
	theme: SceneTheme;
}

export interface SceneView {
	window: SceneBounds;
	detail: boolean;
	cursorIdx: number;
	/** Stage scale, read at draw time. */
	scale: number;
}

/** Zoomed in past this, strokes, end markers and labels keep their on-screen size. */
export const FIXED_SIZE_FROM_SCALE = 1;

/**
 * Multiplier for stroke widths, marker sizes and fonts. Geometry still grows with zoom, so on
 * dense designs zooming in opens gaps between strands instead of only thickening them.
 */
export function screenSizeFactor(scale: number): number {
	return scale > FIXED_SIZE_FROM_SCALE ? FIXED_SIZE_FROM_SCALE / scale : 1;
}

export const SCENE_GEOMETRY = {
	radius: 10,
	strokeWidth: 2,
	helixWidth: 20,
	cornerRadius: 2,
	outlineOpacity: 0.42,
	strandWidth: 2,
	strandOffset: 4,
	terminusSize: 6,
	threePrimeOutset: 6 * 0.4,
	threePrimeSize: 6 * 1.2,
} as const;

const G = SCENE_GEOMETRY;
const FIVE_PRIME_INSET = G.terminusSize / 4;

export function boundsIntersect(a: SceneBounds, b: SceneBounds): boolean {
	return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function strandLocalY(strandIdx: 0 | 1): number {
	return strandIdx === 0 ? -G.strandOffset : G.strandOffset;
}

function fivePrimeMarkerX(x: number, otherX: number, k: number): number {
	const delta = otherX - x;
	if (Math.abs(delta) < 1e-6) return x;
	return x + Math.sign(delta) * FIVE_PRIME_INSET * k;
}

function roundedRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.arcTo(x + w, y, x + w, y + r, r);
	ctx.lineTo(x + w, y + h - r);
	ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
	ctx.lineTo(x + r, y + h);
	ctx.arcTo(x, y + h, x, y + h - r, r);
	ctx.lineTo(x, y + r);
	ctx.arcTo(x, y, x + r, y, r);
	ctx.closePath();
}

function drawInPlane(
	ctx: CanvasRenderingContext2D,
	helix: SceneInPlaneHelix,
	view: SceneView,
	theme: SceneTheme,
	k: number
): void {
	ctx.save();
	ctx.translate(helix.x, helix.y);
	ctx.rotate(helix.angleRad);

	ctx.globalAlpha = helix.opacity * G.outlineOpacity;
	ctx.strokeStyle = theme.outline;
	ctx.lineWidth = G.strokeWidth * k;
	roundedRectPath(ctx, 0, -G.helixWidth / 2, helix.lengthPx, G.helixWidth, G.cornerRadius);
	ctx.stroke();

	const terminus = G.terminusSize * k;
	const triangle = G.threePrimeSize * k;
	ctx.lineWidth = G.strandWidth * k;
	ctx.lineCap = 'round';
	for (const strand of helix.strands) {
		const y = strandLocalY(strand.strandIdx);
		ctx.globalAlpha = helix.opacity * strand.opacity;
		ctx.strokeStyle = strand.color;
		ctx.beginPath();
		ctx.moveTo(strand.fiveX, y);
		ctx.lineTo(strand.threeX, y);
		ctx.stroke();
		if (!view.detail) continue;

		ctx.fillStyle = strand.color;
		const markerX = fivePrimeMarkerX(strand.fiveX, strand.threeX, k);
		ctx.fillRect(markerX - terminus / 2, y - terminus / 2, terminus, terminus);
		const half = triangle / 2;
		const dir = strand.strandIdx === 0 ? 1 : -1;
		const tipX = strand.threeX + dir * G.threePrimeOutset * k;
		ctx.beginPath();
		ctx.moveTo(tipX, y);
		ctx.lineTo(tipX - dir * triangle, y - half);
		ctx.lineTo(tipX - dir * triangle, y + half);
		ctx.closePath();
		ctx.fill();
	}

	if (view.detail) {
		ctx.globalAlpha = helix.opacity;
		ctx.fillStyle = theme.label;
		ctx.font = `bold ${13 * k}px Arial`;
		ctx.textBaseline = 'top';
		ctx.textAlign = 'left';
		ctx.fillText(`${helix.vhIndex}`, 4 * k, -7 * k);
	}
	ctx.restore();
}

function drawPerpendicular(
	ctx: CanvasRenderingContext2D,
	helix: ScenePerpendicularHelix,
	view: SceneView,
	theme: SceneTheme,
	k: number
): void {
	ctx.globalAlpha = helix.opacity;
	ctx.beginPath();
	ctx.arc(helix.x, helix.y, G.radius, 0, Math.PI * 2);
	ctx.fillStyle = theme.helixFill;
	ctx.fill();
	ctx.strokeStyle = theme.helixStroke;
	ctx.lineWidth = G.strokeWidth * k;
	ctx.stroke();

	const angle = ((helix.scafStartDeg + helix.scafBpDeg * view.cursorIdx) * Math.PI) / 180;
	ctx.globalAlpha = helix.opacity * 0.3;
	ctx.strokeStyle = theme.scafIndicator;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(helix.x, helix.y);
	ctx.lineTo(
		helix.x + 0.85 * G.radius * Math.cos(angle),
		helix.y + 0.85 * G.radius * Math.sin(angle)
	);
	ctx.stroke();

	if (view.detail) {
		ctx.globalAlpha = helix.opacity;
		ctx.fillStyle = theme.helixLabel;
		const label = `${helix.vhIndex}`;
		ctx.font = `bold ${helixCircleLabelFontSize(label) * k}px Arial`;
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'center';
		ctx.fillText(label, helix.x, helix.y);
	}
}

function drawCrossover(
	ctx: CanvasRenderingContext2D,
	xover: SceneCrossover,
	theme: SceneTheme,
	k: number
): void {
	const { from, to, bulge } = xover;
	// Control point that makes the quadratic pass through the bulge point at t = 0.5.
	const cx = 2 * bulge.x - (from.x + to.x) / 2;
	const cy = 2 * bulge.y - (from.y + to.y) / 2;
	ctx.globalAlpha = xover.opacity;
	ctx.strokeStyle = xover.color;
	ctx.lineWidth = 2 * k;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(from.x, from.y);
	ctx.quadraticCurveTo(cx, cy, to.x, to.y);
	ctx.stroke();
	if (!xover.constrained) return;
	ctx.beginPath();
	ctx.arc(bulge.x, bulge.y, 3.2 * k, 0, Math.PI * 2);
	ctx.fillStyle = theme.crossoverDotFill;
	ctx.fill();
	ctx.lineWidth = 1.5 * k;
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(bulge.x, bulge.y, 0.8 * k, 0, Math.PI * 2);
	ctx.fillStyle = xover.color;
	ctx.fill();
}

/** Draws the scene's helices and crossovers that intersect `view.window`. */
export function drawFreeformScene(
	ctx: CanvasRenderingContext2D,
	scene: FreeformScene,
	view: SceneView
): void {
	const k = screenSizeFactor(view.scale);
	ctx.save();
	for (const helix of scene.helices) {
		if (!boundsIntersect(helix.bounds, view.window)) continue;
		if (helix.kind === 'inPlane') drawInPlane(ctx, helix, view, scene.theme, k);
		else drawPerpendicular(ctx, helix, view, scene.theme, k);
	}
	for (const xover of scene.crossovers) {
		if (boundsIntersect(xover.bounds, view.window)) drawCrossover(ctx, xover, scene.theme, k);
	}
	ctx.restore();
}

/** The nearest helix under a layer point, or null; matches what the user sees on top. */
export function pickVhAt(
	helices: readonly SceneHelix[],
	point: { x: number; y: number }
): number | null {
	for (let i = helices.length - 1; i >= 0; i--) {
		const helix = helices[i];
		const { bounds } = helix;
		if (
			point.x < bounds.minX ||
			point.x > bounds.maxX ||
			point.y < bounds.minY ||
			point.y > bounds.maxY
		) {
			continue;
		}
		const dx = point.x - helix.x;
		const dy = point.y - helix.y;
		if (helix.kind === 'perpendicular') {
			if (Math.hypot(dx, dy) <= G.radius) return helix.vhIndex;
			continue;
		}
		const c = Math.cos(helix.angleRad);
		const s = Math.sin(helix.angleRad);
		const localX = c * dx + s * dy;
		const localY = -s * dx + c * dy;
		if (localX >= 0 && localX <= helix.lengthPx && Math.abs(localY) <= G.helixWidth / 2) {
			return helix.vhIndex;
		}
	}
	return null;
}
