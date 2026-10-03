// Heavy landing-page 3D viewer — MUST only be reached via dynamic import() so
// Three.js and the model layer never land in the landing route's initial chunk.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildScene } from '$lib/components/Editor/View3D/helixGeometry';
import { partFromJSON } from '$lib/model/document.svelte';
import { migrateDocumentJson } from '$lib/model/documentFormat';
import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import type { Part } from '$lib/model/Part';

export interface Hero3dHandle {
	/** Pause/resume the render loop, auto-rotate, and drag interaction (e.g. while
	 *  content scrolls over the hero). Resuming restarts the auto-rotate. */
	setActive(active: boolean): void;
	dispose(): void;
}

interface MaybeMaterial extends THREE.Material {
	isLineMaterial?: boolean;
	resolution?: THREE.Vector2;
	color?: THREE.Color;
}

// Landing theme palette for strands, heaviest batch first (usually the scaffold).
// Any design dropped into the hero is recolored to these, so the render always
// matches the page no matter what colors the design file carries. Looks fine
// against both the light and dark --landing-bg, so there's no dark variant.
const STRAND_PALETTE = [0x2b6cb5, 0x9db9dd, 0x4d8ac9, 0x5e9b73, 0x93a4b6, 0xc3d3e6];

/** Strip per-design oligo colors: remap every strand/crossover line batch to the
 *  landing palette, assigning colors by geometry weight (segment count). Batches
 *  sharing an original color keep sharing a palette color. */
function recolorToLandingPalette(group: THREE.Group): void {
	const byOriginalColor = new Map<string, { mats: MaybeMaterial[]; weight: number }>();
	group.traverse((o) => {
		const f = o as unknown as { isLine2?: boolean; isLineSegments2?: boolean };
		if (!f.isLine2 && !f.isLineSegments2) return;
		const mesh = o as THREE.Mesh;
		const mat = mesh.material as MaybeMaterial;
		if (!mat?.color) return;
		const key = mat.color.getHexString();
		const weight =
			(mesh.geometry as THREE.InstancedBufferGeometry).attributes?.instanceStart?.count ?? 1;
		const entry = byOriginalColor.get(key);
		if (entry) {
			entry.mats.push(mat);
			entry.weight += weight;
		} else {
			byOriginalColor.set(key, { mats: [mat], weight });
		}
	});
	[...byOriginalColor.values()]
		.sort((a, b) => b.weight - a.weight)
		.forEach((entry, i) => {
			const color = STRAND_PALETTE[i % STRAND_PALETTE.length];
			for (const mat of entry.mats) mat.color!.setHex(color);
		});
}

async function loadPart(designUrl: string): Promise<Part> {
	const res = await fetch(designUrl);
	if (!res.ok) throw new Error(`Failed to fetch design: ${res.status}`);
	const raw = await res.json();
	if (Array.isArray(raw.vstrands)) return new CadnanoJSON(raw.name, raw.vstrands).toPart();
	if (Array.isArray(raw.parts) && raw.parts.length > 0) {
		return partFromJSON(migrateDocumentJson(raw).parts[0]);
	}
	throw new Error('Unrecognized design format (expected cadnano vstrands or foldnano parts)');
}

function eachMaterial(root: THREE.Object3D, fn: (m: MaybeMaterial) => void): void {
	root.traverse((o) => {
		const mat = (o as Partial<THREE.Mesh>).material;
		if (!mat) return;
		for (const m of Array.isArray(mat) ? mat : [mat]) fn(m as MaybeMaterial);
	});
}

export async function initHero3d(
	canvas: HTMLCanvasElement,
	designUrl: string,
	opts: { autoRotate: boolean; shiftRight?: boolean; onReady?: () => void }
): Promise<Hero3dHandle> {
	const part = await loadPart(designUrl);
	const { group, cylinders } = buildScene(part);

	// Drop the VH index number labels (sprites) and the ghost VH cylinders — both
	// are editor scaffolding, just noise on a marketing hero.
	const sprites: THREE.Object3D[] = [];
	group.traverse((o) => {
		if ((o as THREE.Sprite).isSprite) sprites.push(o);
	});
	for (const s of sprites) s.removeFromParent();
	cylinders?.removeFromParent();
	recolorToLandingPalette(group);

	const scene = new THREE.Scene();
	scene.add(group);
	// Ghost cylinders / instanced meshes are lit; fat-line strands ignore lights.
	scene.add(new THREE.AmbientLight(0xffffff, 0.95));
	const key = new THREE.DirectionalLight(0xffffff, 0.55);
	key.position.set(1, 1.4, 1);
	scene.add(key);

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setClearColor(0x000000, 0);

	const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1_000_000);

	// Frame + spin around the strand mass (fat lines), not the whole group: ghost
	// cylinders and crossovers can extend past the visible structure, which would
	// shift the auto-rotate pivot off-centre and make the design swing in the frame.
	const strandBox = new THREE.Box3();
	let hasStrand = false;
	group.traverse((o) => {
		const f = o as unknown as { isLine2?: boolean; isLineSegments2?: boolean };
		if (f.isLine2 || f.isLineSegments2) {
			strandBox.expandByObject(o);
			hasStrand = true;
		}
	});
	const box = hasStrand && !strandBox.isEmpty() ? strandBox : new THREE.Box3().setFromObject(group);
	const focus = box.getCenter(new THREE.Vector3());
	// Recentre so the pivot is at the origin — removes any world-space offset.
	group.position.sub(focus);
	focus.set(0, 0, 0);
	const size = box.getSize(new THREE.Vector3());

	// Frame adaptively: view roughly down the structure's shortest axis (so its
	// largest face fills the frame), tilted toward a diagonal for depth. Works for
	// both compact blocks and long/flat designs when the featured design is swapped.
	const axes = [
		{ v: size.x, dir: new THREE.Vector3(1, 0, 0) },
		{ v: size.y, dir: new THREE.Vector3(0, 1, 0) },
		{ v: size.z, dir: new THREE.Vector3(0, 0, 1) },
	].sort((a, b) => a.v - b.v);
	const viewDir = axes[0].dir
		.clone()
		.addScaledVector(axes[1].dir, 0.5)
		.addScaledVector(axes[2].dir, 0.34)
		.normalize();
	const vFov = (camera.fov * Math.PI) / 180;
	const fitExtent = Math.max(axes[1].v, axes[2].v) / 2;
	// Shrinks the hero model to ~80% of an exact frame-fit, leaving breathing room
	// around the structure (was tuned tighter at 0.72; 0.9 = 0.72 / 0.8).
	const OVERFILL = 0.9;

	/** Distance that fits the structure for a given viewport aspect ratio. A
	 *  narrower (portrait-leaning) frame has a smaller horizontal FOV for the same
	 *  vertical FOV, so it needs extra distance to avoid cropping the structure
	 *  sideways — without this, the fit computed at one aspect ratio goes stale
	 *  (overfilling the frame) once the aspect ratio changes later. */
	function fitDistance(aspect: number): number {
		const aspectCompensation = Math.min(1, aspect);
		return (fitExtent / Math.tan(vFov / 2) / aspectCompensation) * OVERFILL + axes[0].v / 2;
	}

	camera.up.set(0, 1, 0);

	const controls = new OrbitControls(camera, canvas);
	controls.target.copy(focus);
	controls.enablePan = false;
	controls.enableZoom = false; // never hijack page scroll
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.autoRotate = opts.autoRotate;
	controls.autoRotateSpeed = 0.9;
	controls.addEventListener('start', () => (controls.autoRotate = false));

	/** Refit the camera distance for the current viewport aspect, preserving the
	 *  current orbit angle (rescales the existing offset from the target instead
	 *  of resetting it), so this can safely rerun on every resize — not just once
	 *  at mount, which is what let the fit go stale when aspect changed later. */
	function refit(aspect: number): void {
		const offset = camera.position.clone().sub(controls.target);
		const direction = offset.lengthSq() > 1e-6 ? offset.normalize() : viewDir;
		const dist = fitDistance(aspect);
		camera.position.copy(controls.target).addScaledVector(direction, dist);
		camera.near = Math.max(0.01, dist / 500);
		camera.far = dist * 12;
	}

	function resize(): void {
		const rect = canvas.getBoundingClientRect();
		const w = Math.max(1, Math.round(rect.width));
		const h = Math.max(1, Math.round(rect.height));
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		renderer.setPixelRatio(dpr);
		renderer.setSize(w, h, false);
		// shiftRight: render the left window of a wider virtual view so the (centred)
		// structure appears right of screen centre — keeps the orbit pivot on the
		// structure while a text panel overlaps the left. Wide viewports only.
		if (opts.shiftRight && w / h > 1.2) {
			const fullW = w * 1.3;
			camera.aspect = fullW / h;
			camera.setViewOffset(fullW, h, 0, 0, w, h);
		} else {
			camera.clearViewOffset();
			camera.aspect = w / h;
		}
		// Fit distance uses the real canvas aspect, not the widened shiftRight one —
		// that extra width is virtual off-screen padding, not visible frame.
		refit(w / h);
		camera.updateProjectionMatrix();
		eachMaterial(group, (m) => {
			if (m.isLineMaterial && m.resolution) m.resolution.set(w * dpr, h * dpr);
		});
	}
	resize();
	const ro = new ResizeObserver(resize);
	ro.observe(canvas);

	// ResizeObserver only fires on CSS layout changes; some environments change
	// devicePixelRatio with no layout reflow at all (e.g. dragging the window to a
	// display with different OS scaling, or some browsers' page-zoom implementations).
	// Watch for that separately so render resolution and fit stay correct there too.
	let dprQuery: MediaQueryList | null = null;
	function onDprChange(): void {
		resize();
		watchDevicePixelRatio(); // matchMedia queries are one-shot; re-arm for the new dpr
	}
	function watchDevicePixelRatio(): void {
		dprQuery?.removeEventListener('change', onDprChange);
		dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		dprQuery.addEventListener('change', onDprChange);
	}
	watchDevicePixelRatio();

	let raf = 0;
	let frames = 0;
	let readyFired = false;
	let active = true;
	function loop(): void {
		raf = requestAnimationFrame(loop);
		controls.update();
		renderer.render(scene, camera);
		if (!readyFired && ++frames >= 2) {
			readyFired = true;
			opts.onReady?.();
		}
	}
	loop();

	return {
		setActive(next: boolean): void {
			if (next === active) return;
			active = next;
			controls.enabled = next;
			controls.autoRotate = next && opts.autoRotate;
			if (next) {
				loop();
			} else {
				cancelAnimationFrame(raf);
				renderer.render(scene, camera); // leave a settled frame on screen
			}
		},
		dispose(): void {
			cancelAnimationFrame(raf);
			ro.disconnect();
			dprQuery?.removeEventListener('change', onDprChange);
			controls.dispose();
			eachMaterial(group, (m) => m.dispose());
			group.traverse((o) => (o as Partial<THREE.Mesh>).geometry?.dispose?.());
			renderer.dispose();
		},
	};
}
