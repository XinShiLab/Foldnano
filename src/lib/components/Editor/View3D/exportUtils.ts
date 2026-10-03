import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { MrdnaExportResult } from '$lib/model/io/mrdnaExport';
import type { OxDnaExportResult } from '$lib/model/io/oxdnaExport';
import { downloadFile } from './threeUtils';

/** Download a screenshot of the current rendered frame as a PNG. */
export function downloadScreenshot(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	filename: string
): void {
	// Render into a temporary offscreen canvas with preserveDrawingBuffer so
	// toDataURL() can read back the pixels. The main renderer stays without
	// preserveDrawingBuffer, which allows the browser to discard the framebuffer
	// after compositing (important on mobile/tiled GPUs).
	const src = renderer.domElement;
	const offscreen = document.createElement('canvas');
	offscreen.width = src.width;
	offscreen.height = src.height;
	const tmp = new THREE.WebGLRenderer({
		canvas: offscreen,
		antialias: true,
		preserveDrawingBuffer: true,
	});
	tmp.setPixelRatio(renderer.getPixelRatio());
	tmp.setSize(src.clientWidth, src.clientHeight, false);
	const clearColor = new THREE.Color();
	renderer.getClearColor(clearColor);
	tmp.setClearColor(clearColor, renderer.getClearAlpha());
	tmp.render(scene, camera);
	downloadFile(offscreen.toDataURL('image/png'), filename);
	tmp.dispose();
}

/**
 * Serialize a Three.js group to GLB and trigger a browser download.
 * The group's geometry + materials are disposed after serialisation.
 */
export function exportGlb(group: THREE.Group, filename: string): void {
	const exporter = new GLTFExporter();
	exporter.parse(
		group,
		(result) => {
			group.traverse((obj) => {
				if (obj instanceof THREE.Mesh) {
					obj.geometry.dispose();
					(obj.material as THREE.Material).dispose();
				}
			});
			const url = URL.createObjectURL(
				new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
			);
			downloadFile(url, filename);
			URL.revokeObjectURL(url);
		},
		(error) => console.error('GLTFExporter error:', error),
		{ binary: true }
	);
}

/** Download the two oxDNA output files (.dat and .top) for a given export result. */
export function downloadOxDnaFiles(filename: string, result: OxDnaExportResult): void {
	for (const [ext, text] of [
		['dat', result.dat],
		['top', result.top],
	] as const) {
		const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
		downloadFile(url, `${filename}.${ext}`);
		URL.revokeObjectURL(url);
	}
}

/** Download the mrDNA plain-text nucleotide file. */
export function downloadMrdnaFile(filename: string, result: MrdnaExportResult): void {
	const url = URL.createObjectURL(new Blob([result.txt], { type: 'text/plain;charset=utf-8' }));
	downloadFile(url, `${filename}.mrdna.txt`);
	URL.revokeObjectURL(url);
}
