import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { drawOncePerPixel, GLOW_STENCIL_REF } from './drawOncePerPixel';
import { CROSSOVER_LINE_WIDTH, LINE_WIDTH } from './helixGeometry';

const GLOW_COLOR = 0xffc83d;
const GLOW_OPACITY = 0.6;
// World widths sit a little outside the drawn lines (LINE_WIDTH, CROSSOVER_LINE_WIDTH);
// the pixel width keeps the glow visible once those lines are thinner than a few pixels.
const SEGMENT_GLOW_NM = 1.0;
const XOVER_GLOW_NM = 0.6;
const GLOW_PX = 7;

export interface GlowPieces {
	segments: Float32Array;
	xovers: Float32Array;
}

export interface HoverGlow {
	readonly group: THREE.Group;
	/**
	 * Replaces the glowing pieces (6 floats each); empty arrays hide it. `mask` is the solid part
	 * of the hovered strands, which the glow must never cover.
	 */
	set(glow: GlowPieces, mask: GlowPieces): void;
	clear(): void;
	dispose(): void;
}

// One shared stencil mark: overlapping pieces and both width layers blend once per pixel.
function glowMaterial(width: number, worldUnits: boolean): LineMaterial {
	return drawOncePerPixel(
		new LineMaterial({
			color: GLOW_COLOR,
			linewidth: width,
			worldUnits,
			transparent: true,
			opacity: GLOW_OPACITY,
			depthWrite: false,
			// Pushed behind the strand it outlines, so the strand stays on top and the glow shows around it.
			polygonOffset: true,
			polygonOffsetFactor: 2,
			polygonOffsetUnits: 8,
		}),
		GLOW_STENCIL_REF
	);
}

/**
 * Invisible copy of a solid hovered strand at its exact drawn width. It ties the strand's depth
 * wherever the strand is front-most and stamps the glow's stencil mark there, so the glow (which
 * polygon offset alone can't keep behind these billboarded lines) skips the strand itself.
 */
function maskMaterial(width: number): LineMaterial {
	const mat = new LineMaterial({
		linewidth: width,
		worldUnits: true,
		transparent: true, // transparent pass: after the opaque strands have written depth
		depthWrite: false,
		colorWrite: false,
	});
	mat.stencilWrite = true;
	mat.stencilRef = GLOW_STENCIL_REF;
	mat.stencilFunc = THREE.AlwaysStencilFunc;
	mat.stencilZPass = THREE.ReplaceStencilOp;
	return mat;
}

/**
 * Glow under whatever a click would select, drawn as a separate small overlay so hovering never
 * touches the batched design geometry.
 */
export function createHoverGlow(): HoverGlow {
	const group = new THREE.Group();
	group.renderOrder = -1;

	function clear(): void {
		for (const child of [...group.children]) {
			const line = child as LineSegments2;
			line.geometry.dispose();
			(line.material as LineMaterial).dispose();
			group.remove(line);
		}
	}

	function addLine(positions: Float32Array, material: LineMaterial, renderOrder: number): void {
		const geo = new LineSegmentsGeometry();
		geo.setPositions(positions);
		const line = new LineSegments2(geo, material);
		line.frustumCulled = false;
		line.renderOrder = renderOrder;
		group.add(line);
	}

	function addMask(positions: Float32Array, width: number): void {
		if (positions.length > 0) addLine(positions, maskMaterial(width), -2);
	}

	function add(positions: Float32Array, worldWidth: number): void {
		if (positions.length === 0) return;
		for (const [width, worldUnits] of [
			[worldWidth, true],
			[GLOW_PX, false],
		] as const) {
			addLine(positions, glowMaterial(width, worldUnits), -1);
		}
	}

	return {
		group,
		set(glow, mask) {
			clear();
			addMask(mask.segments, LINE_WIDTH);
			addMask(mask.xovers, CROSSOVER_LINE_WIDTH);
			add(glow.segments, SEGMENT_GLOW_NM);
			add(glow.xovers, XOVER_GLOW_NM);
		},
		clear,
		dispose: clear,
	};
}
