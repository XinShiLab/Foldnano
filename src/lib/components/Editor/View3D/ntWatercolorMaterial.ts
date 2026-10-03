/**
 * ntWatercolorMaterial.ts
 *
 * Soft, watercolor-style translucent material for the NT-model backbone tubes.
 * A fresnel rim makes the "ink" gather at silhouette edges — the wash reads as a
 * delicate 2D illustration while still being a real, rotatable 3D surface. No
 * specular, no post-processing: it slots straight into the existing on-demand
 * render loop in View3D.
 */

import * as THREE from 'three';

interface WatercolorOptions {
	color: THREE.Color;
	opacity: number;
	/** Higher = the rim is tighter to the silhouette. */
	rimPower?: number;
}

const VERTEX_SHADER = /* glsl */ `
	varying vec3 vWorldNormal;
	varying vec3 vViewDir;

	void main() {
		vec4 worldPos = modelMatrix * vec4(position, 1.0);
		vWorldNormal = normalize(mat3(modelMatrix) * normal);
		vViewDir = normalize(cameraPosition - worldPos.xyz);
		gl_Position = projectionMatrix * viewMatrix * worldPos;
	}
`;

const FRAGMENT_SHADER = /* glsl */ `
	uniform vec3 uColor;
	uniform vec3 uRimColor;
	uniform float uOpacity;
	uniform float uRimPower;

	varying vec3 vWorldNormal;
	varying vec3 vViewDir;

	void main() {
		vec3 n = normalize(vWorldNormal);
		// Two-sided: flip the normal toward the camera so back faces don't darken.
		if (dot(n, vViewDir) < 0.0) n = -n;
		float fresnel = pow(1.0 - max(dot(n, vViewDir), 0.0), uRimPower);
		// Wash toward white in the interior, settle into uColor at the silhouette.
		vec3 col = mix(uRimColor, uColor, fresnel);
		// Ink also gathers (more opaque) at the edge.
		float alpha = clamp(uOpacity + fresnel * (1.0 - uOpacity) * 0.6, 0.0, 1.0);
		gl_FragColor = vec4(col, alpha);
	}
`;

/** Soften a saturated oligo color into a pastel wash tone (lerp toward white). */
export function softenColor(color: THREE.Color, amount = 0.3): THREE.Color {
	return color.clone().lerp(new THREE.Color(0xffffff), amount);
}

export function createWatercolorMaterial({
	color,
	opacity,
	rimPower = 2.0,
}: WatercolorOptions): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			uColor: { value: color.clone() },
			uRimColor: { value: color.clone().lerp(new THREE.Color(0xffffff), 0.35) },
			uOpacity: { value: opacity },
			uRimPower: { value: rimPower },
		},
		vertexShader: VERTEX_SHADER,
		fragmentShader: FRAGMENT_SHADER,
		transparent: true,
		side: THREE.DoubleSide,
		// Keep depth writes for stable sorting on the self-overlapping helix; the
		// fresnel rim supplies the airy softness instead of order-dependent blending.
		depthWrite: true,
	});
}
