import * as THREE from 'three';

// Fat lines are separate quads that overlap where pieces meet. Translucent, those overlaps blend
// twice and show as dots along the line. A stencil mark per object lets each pixel blend once.
// Needs a renderer created with `stencil: true` (three defaults to false); it clears every frame.

/** Reserved for the hover glow, so its world-width and pixel-width layers merge into one. */
export const GLOW_STENCIL_REF = 255;
/** Reserved for the sticky-end sleeves, so every colour and the hovered match merge into one. */
export const STICKY_STENCIL_REF = 254;
const MAX_SHARED_REF = 253;

let nextRef = 0;

/**
 * Next stencil mark for a translucent object. Marks cycle through 1–253; two objects sharing one
 * only merge where they overlap, which a handful of dimmed colour buckets never reaches.
 */
export function nextStencilRef(): number {
	nextRef = (nextRef % MAX_SHARED_REF) + 1;
	return nextRef;
}

/** Draw `material` at most once per pixel among objects using the same `ref`. */
export function drawOncePerPixel<T extends THREE.Material>(material: T, ref: number): T {
	material.stencilWrite = true;
	material.stencilRef = ref;
	material.stencilFunc = THREE.NotEqualStencilFunc;
	material.stencilZPass = THREE.ReplaceStencilOp;
	material.stencilFail = THREE.KeepStencilOp;
	material.stencilZFail = THREE.KeepStencilOp;
	return material;
}
