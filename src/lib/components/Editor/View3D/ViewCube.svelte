<script lang="ts">
	import type * as THREE from 'three';
	import {
		CUBE_FACES,
		axisTriad,
		cellDir,
		cubeCssTransform,
		dirAxes,
		dirKey,
		dirLabel,
		faceCssTransform,
		projectOnCube,
		triadAxisInFront,
		type Axis,
		type CubeDir,
	} from './cameraViews';

	interface Props {
		/** The 3D camera's orientation; the cube turns with it. */
		quaternion: THREE.Quaternion;
		/** The camera looks (or is turning to look) straight at a face: show the roll buttons. */
		faceOn: boolean;
		onPick: (dir: CubeDir) => void;
		onRoll: (clockwise: boolean) => void;
	}

	let { quaternion, faceOn, onPick, onRoll }: Props = $props();

	const SIZE_PX = 52;
	const LABEL_RADIUS_PX = 6;
	// Roll arrows share the top-right quarter of a circle centred on the cube's top-right corner,
	// tails meeting on the diagonal. The radius clears the axis letters, which in a face-on view
	// can sit right beside that corner (up to ~15 px from it).
	const ROLL_RADIUS_PX = 21;
	const ROLL_BAND_PX = 5;
	const ROLL_HEAD_HALF_PX = 5.5;
	const ROLL_HEAD_LEN_PX = 6.5;
	const triad = axisTriad(SIZE_PX / 2, 2, 4, 5);
	// However the cube turns, its corners and the axis letters stay inside the viewport corner.
	const INSET_PX =
		Math.ceil(
			Math.max(
				(SIZE_PX * Math.sqrt(3)) / 2,
				...triad.map((a) => a.tip.length() + LABEL_RADIUS_PX),
				// The arrows don't turn, so only their reach along each screen axis counts.
				SIZE_PX / 2 + ROLL_RADIUS_PX + ROLL_HEAD_HALF_PX
			) -
				SIZE_PX / 2
		) + 2;
	// Half-size of the SVG layers, centred on the cube: room for the farthest letter.
	const TRIAD_RADIUS_PX = SIZE_PX / 2 + INSET_PX;
	const AXIS_STROKE: Record<Axis, string> = {
		X: 'stroke-red-500',
		Y: 'stroke-green-500',
		Z: 'stroke-blue-500',
	};
	const AXIS_FILL: Record<Axis, string> = {
		X: 'fill-red-500',
		Y: 'fill-green-600 dark:fill-green-500',
		Z: 'fill-blue-500',
	};

	const transform = $derived(cubeCssTransform(quaternion));
	// Flat 2D lines keep a constant width at every angle (3D strips thinned and flickered); each
	// goes behind or in front of the cube by whether its edge faces the viewer.
	const triadLines = $derived(
		triad.map((a) => ({
			axis: a.axis,
			from: projectOnCube(quaternion, a.start),
			to: projectOnCube(quaternion, a.end),
			tip: projectOnCube(quaternion, a.tip),
			inFront: triadAxisInFront(quaternion, a),
		}))
	);
	const STEPS = [-1, 0, 1] as const;

	/**
	 * A curved arrow outline round the cube's top-right corner, from `fromDeg` to `toDeg` (screen
	 * angles, y down): a band of the circle ending in a head. `hit` is its centre line, for a wide
	 * invisible click target.
	 */
	function rollArrow(fromDeg: number, toDeg: number) {
		const c = { x: SIZE_PX / 2, y: -SIZE_PX / 2 };
		const r = ROLL_RADIUS_PX;
		const turn = toDeg > fromDeg ? 1 : -1; // +1: clockwise on screen
		const rad = (d: number) => (d * Math.PI) / 180;
		const f = (v: number) => v.toFixed(2);
		const pt = (radius: number, angleRad: number) =>
			`${f(c.x + radius * Math.cos(angleRad))} ${f(c.y + radius * Math.sin(angleRad))}`;
		const a0 = rad(fromDeg);
		const a1 = rad(toDeg);
		const tip = a1 + (turn * ROLL_HEAD_LEN_PX) / r;
		const outer = r + ROLL_BAND_PX / 2;
		const inner = r - ROLL_BAND_PX / 2;
		const sweep = turn > 0 ? 1 : 0;
		return {
			shape: [
				`M ${pt(outer, a0)}`,
				`A ${outer} ${outer} 0 0 ${sweep} ${pt(outer, a1)}`,
				`L ${pt(r + ROLL_HEAD_HALF_PX, a1)}`,
				`L ${pt(r, tip)}`,
				`L ${pt(r - ROLL_HEAD_HALF_PX, a1)}`,
				`L ${pt(inner, a1)}`,
				`A ${inner} ${inner} 0 0 ${1 - sweep} ${pt(inner, a0)}`,
				'Z',
			].join(' '),
			hit: `M ${pt(r, a0)} A ${r} ${r} 0 0 ${sweep} ${pt(r, tip)}`,
		};
	}

	const ROLL_ARROWS = [
		{ clockwise: false, label: 'Rotate view 90° counterclockwise', ...rollArrow(-49, -100) },
		{ clockwise: true, label: 'Rotate view 90° clockwise', ...rollArrow(-41, 10) },
	];

	const faces = CUBE_FACES.map((face) => ({
		face,
		css: faceCssTransform(face, SIZE_PX / 2),
		cells: STEPS.flatMap((row) =>
			STEPS.map((col) => {
				const dir = cellDir(face, col, row);
				return { dir, key: dirKey(dir), label: `${dirLabel(dir)} (from ${dirAxes(dir)})` };
			})
		),
	}));

	let hoveredKey = $state<string | null>(null);
</script>

{#snippet triadLayer(inFront: boolean)}
	<svg
		class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible"
		width={2 * TRIAD_RADIUS_PX}
		height={2 * TRIAD_RADIUS_PX}
		viewBox="{-TRIAD_RADIUS_PX} {-TRIAD_RADIUS_PX} {2 * TRIAD_RADIUS_PX} {2 * TRIAD_RADIUS_PX}"
		aria-hidden="true"
	>
		{#each triadLines.filter((l) => l.inFront === inFront) as l (l.axis)}
			<line
				class={AXIS_STROKE[l.axis]}
				x1={l.from.x}
				y1={l.from.y}
				x2={l.to.x}
				y2={l.to.y}
				stroke-width="1.5"
				stroke-linecap="round"
			/>
			<text
				class={['text-xs font-bold', AXIS_FILL[l.axis]]}
				x={l.tip.x}
				y={l.tip.y}
				text-anchor="middle"
				dominant-baseline="central">{l.axis}</text
			>
		{/each}
	</svg>
{/snippet}

<!-- Faces, edges and corners are 3×3 cells on each face; an edge or corner cell is shared by
	 its faces, which light up together. -->
<div
	class="absolute select-none"
	style:top="{INSET_PX}px"
	style:right="{INSET_PX}px"
	style:width="{SIZE_PX}px"
	style:height="{SIZE_PX}px"
	role="group"
	aria-label="View cube"
	onpointerleave={() => (hoveredKey = null)}
>
	<!-- Positive axes along the edges from the front-left-bottom corner; pointer-events-none keeps
		 the edge and corner cells under them clickable. -->
	{@render triadLayer(false)}
	<div class="relative size-full" style:transform-style="preserve-3d" style:transform>
		{#each faces as { face, css, cells } (face.label)}
			<div
				class="absolute inset-0 grid rounded-[3px] border border-border bg-muted/85 text-muted-foreground"
				style:transform={css}
				style:backface-visibility="hidden"
				style:grid-template="20% 1fr 20% / 20% 1fr 20%"
			>
				{#each cells as cell (cell.key)}
					<button
						type="button"
						class={['transition-colors', hoveredKey === cell.key && 'bg-primary/35']}
						title={cell.label}
						aria-label={`${cell.label} view`}
						onpointerenter={() => (hoveredKey = cell.key)}
						onclick={() => onPick(cell.dir)}
					></button>
				{/each}
				<!-- Over the whole face, so the label may run into the edge cells. -->
				<span
					class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs leading-none font-medium"
				>
					{face.label}
				</span>
			</div>
		{/each}
	</div>
	{@render triadLayer(true)}
	{#if faceOn}
		<svg
			class="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible"
			width={2 * TRIAD_RADIUS_PX}
			height={2 * TRIAD_RADIUS_PX}
			viewBox="{-TRIAD_RADIUS_PX} {-TRIAD_RADIUS_PX} {2 * TRIAD_RADIUS_PX} {2 * TRIAD_RADIUS_PX}"
		>
			{#each ROLL_ARROWS as arrow (arrow.clockwise)}
				<g
					class="group cursor-pointer outline-none"
					role="button"
					tabindex="0"
					aria-label={arrow.label}
					onclick={() => onRoll(arrow.clockwise)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							onRoll(arrow.clockwise);
						}
					}}
				>
					<title>{arrow.label}</title>
					<!-- Wide invisible stroke along the arrow: an easier target than the band alone. -->
					<path
						d={arrow.hit}
						fill="none"
						stroke="transparent"
						stroke-width="12"
						pointer-events="stroke"
					/>
					<path
						d={arrow.shape}
						class="fill-background stroke-border transition-colors group-hover:fill-primary/40 group-focus-visible:fill-primary/40"
						stroke-width="1.2"
						stroke-linejoin="round"
						pointer-events="visiblePainted"
					/>
				</g>
			{/each}
		</svg>
	{/if}
</div>
