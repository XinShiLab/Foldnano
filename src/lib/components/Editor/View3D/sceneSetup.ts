import * as THREE from 'three';
// import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

export interface SceneRig {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	// controls: OrbitControls;
	controls: TrackballControls;
	markDirty: () => void;
	consumeDirty: () => boolean;
	dispose: () => void;
}

export function setupScene(canvas: HTMLCanvasElement): SceneRig {
	// Renderer
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setClearColor(0xfafafa);

	// Scene
	const scene = new THREE.Scene();

	// Camera — start above the XY plane looking down the -Z axis; OrbitControls lets user rotate
	const camera = new THREE.PerspectiveCamera(
		50,
		canvas.clientWidth / canvas.clientHeight,
		0.1,
		10000
	);
	camera.position.set(0, 0, 80);
	camera.lookAt(0, 0, 0);

	// Lights
	scene.add(new THREE.AmbientLight(0xffffff, 0.7));
	const sun = new THREE.DirectionalLight(0xffffff, 1.0);
	sun.position.set(20, 40, 60);
	scene.add(sun);

	// Controls
	// const controls = new OrbitControls(camera, canvas);
	const controls = new TrackballControls(camera, canvas);

	// controls.enableDamping = true;
	// controls.dampingFactor = 0.08;
	controls.target.set(0, 0, 0);

	let dirty = true;
	controls.addEventListener('change', () => {
		dirty = true;
	});

	// Keep renderer size in sync with the canvas container
	const ro = new ResizeObserver(() => {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (w === 0 || h === 0) return;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		dirty = true;
	});
	ro.observe(canvas);

	function dispose() {
		ro.disconnect();
		controls.dispose();
		renderer.dispose();
	}

	return {
		renderer,
		scene,
		camera,
		controls,
		markDirty: () => {
			dirty = true;
		},
		consumeDirty: () => {
			if (dirty) {
				dirty = false;
				return true;
			}
			return false;
		},
		dispose,
	};
}
