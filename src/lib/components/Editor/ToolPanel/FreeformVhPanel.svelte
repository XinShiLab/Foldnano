<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input/index.js';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import { help } from '$lib/components/help/help';
	import { moveFreeformVirtualHelicesCmd, setFreeformVhRollCmd } from '$lib/commands/virtualHelix';
	import { rollDegOf, withRoll, type VirtualHelixFrame } from '$lib/model/geometry3d/dnaGeometry';
	import type VirtualHelix from '$lib/model/VirtualHelix';
	import {
		isPerpendicularFrame,
		normalizeRollDeg,
		rollReferenceAngle,
	} from '$lib/components/Editor/HelixView/rollDial';
	import { PLANE_AXIS_COLORS } from '$lib/components/Editor/HelixView/planeAxes';
	import RollDial from './RollDial.svelte';

	type FramedVh = VirtualHelix & { localFrame: VirtualHelixFrame };
	type Coord = 'x' | 'y' | 'z';

	const AXES: Record<Coord, { letter: string; color: string; title: string }> = {
		x: {
			letter: 'U',
			color: PLANE_AXIS_COLORS.u,
			title: 'Plane U axis (red arrow in the plane view)',
		},
		y: {
			letter: 'V',
			color: PLANE_AXIS_COLORS.v,
			title: 'Plane V axis (green arrow in the plane view)',
		},
		z: { letter: 'W', color: PLANE_AXIS_COLORS.w, title: 'Plane normal W (out of the plane)' },
	};

	const ctx = getEditorViewContext();
	const part = $derived(ctx.currentDoc?.parts[0]);
	const isReadOnly = $derived(!ctx.isTabOwner);

	const vhs = $derived(
		part
			? Array.from(ctx.selectedFreeformVhIndices)
					.sort((a, b) => a - b)
					.map((idx) => part.getVhByIndex(idx))
					.filter((vh): vh is FramedVh => Boolean(vh?.localFrame))
			: []
	);
	const isSingle = $derived(vhs.length === 1);
	const allPerpendicular = $derived(vhs.every((vh) => isPerpendicularFrame(vh.localFrame)));
	const allInPlane = $derived(vhs.every((vh) => !isPerpendicularFrame(vh.localFrame)));

	const commonRoll = $derived(
		common(
			vhs.map((vh) => rollDegOf(vh.localFrame)),
			0.05
		)
	);
	const commonDirection = $derived(
		allInPlane
			? common(
					vhs.map((vh) => directionDeg(vh.localFrame)),
					0.05
				)
			: null
	);
	const referenceAngle = $derived(
		allPerpendicular || allInPlane ? rollReferenceAngle(vhs[0]?.localFrame) : -Math.PI / 2
	);
	const referenceLabel = $derived(
		allPerpendicular
			? 'plane U axis'
			: allInPlane
				? 'plane normal (W)'
				: 'W for helices in the plane, U for standing ones'
	);

	function common(values: number[], tol: number): number | null {
		if (values.length === 0) return null;
		return values.every((v) => Math.abs(normalizeRollDeg(v - values[0])) <= tol) ? values[0] : null;
	}

	function directionDeg(frame: VirtualHelixFrame): number {
		return (Math.atan2(frame.axis.y, frame.axis.x) * 180) / Math.PI;
	}

	function fmt(value: number | null, digits: number): string {
		if (value === null) return '';
		return (Number(value.toFixed(digits)) + 0).toString();
	}

	function run(action: () => void) {
		try {
			action();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		}
	}

	// Reset the field to the model's value; the model may not change (no-op or bad input).
	function readNumber(
		e: Event & { currentTarget: HTMLInputElement },
		shown: string
	): number | null {
		const raw = e.currentTarget.value.trim();
		e.currentTarget.value = shown;
		if (raw === '') return null;
		const value = Number(raw);
		return Number.isFinite(value) ? value : null;
	}

	function moveFrames(map: (frame: VirtualHelixFrame) => VirtualHelixFrame) {
		run(() =>
			moveFreeformVirtualHelicesCmd(
				{ moves: vhs.map((vh) => ({ vh, from: vh.localFrame, to: map(vh.localFrame) })) },
				ctx.historyStack
			)
		);
	}

	function commitRoll(rollDeg: number) {
		run(() => setFreeformVhRollCmd({ vhs, rollDeg: normalizeRollDeg(rollDeg) }, ctx.historyStack));
	}

	function onRollChange(e: Event & { currentTarget: HTMLInputElement }) {
		const value = readNumber(e, fmt(commonRoll, 1));
		if (value !== null) commitRoll(value);
	}

	function onCoordChange(e: Event & { currentTarget: HTMLInputElement }, coord: Coord) {
		const shown = isSingle ? fmt(vhs[0].localFrame.origin[coord], 3) : '';
		const value = readNumber(e, shown);
		if (value === null) return;
		moveFrames((frame) => ({
			...frame,
			origin: { ...frame.origin, [coord]: isSingle ? value : frame.origin[coord] + value },
		}));
	}

	function onDirectionChange(e: Event & { currentTarget: HTMLInputElement }) {
		const value = readNumber(e, fmt(commonDirection, 1));
		if (value === null) return;
		const rad = (value * Math.PI) / 180;
		moveFrames((frame) =>
			withRoll({ ...frame, axis: { x: Math.cos(rad), y: Math.sin(rad), z: 0 } }, rollDegOf(frame))
		);
	}
</script>

<!-- @component
  FreeformVhPanel
  Roll, position and direction fields for the selected freeform helices (docs/editor-freeform-viewer.md).
-->
{#if vhs.length > 0}
	<div class="mt-2 rounded-md border border-border p-2 text-xs">
		<p class="mb-2 text-muted-foreground">
			{isSingle ? `Helix ${vhs[0].index}` : `${vhs.length} helices`}
		</p>

		<div
			class="flex items-center gap-3"
			{@attach help({
				title: 'Roll',
				text: 'Rotation of the helix about its own axis, seen from the bp-0 end (clockwise is positive). Drag the dot (snaps to 15°, hold Alt for free) or type an angle.',
				doc: 'selection',
			})}
		>
			<RollDial
				rollDeg={commonRoll}
				{referenceAngle}
				{referenceLabel}
				disabled={isReadOnly}
				onCommit={commitRoll}
			/>
			<div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
				<label for="freeform-roll" class="text-muted-foreground">Roll (°)</label>
				<Input
					id="freeform-roll"
					class="h-7 w-20"
					type="number"
					step="15"
					placeholder={commonRoll === null ? 'mixed' : ''}
					value={fmt(commonRoll, 1)}
					disabled={isReadOnly}
					onchange={onRollChange}
				/>
				<span class="col-span-2 text-[10px] text-muted-foreground">0° = {referenceLabel}</span>
			</div>
		</div>

		<div
			class="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1"
			{@attach help({
				title: isSingle ? 'Position' : 'Move by',
				text: isSingle
					? 'Start (bp 0) of the helix in nm, along the plane axes drawn in the plane view and the 3D view: U (red) and V (green) lie in the region plane, W (blue) is its normal.'
					: 'Shift every selected helix by this many nm along the plane axes: U (red) and V (green) in the plane, W (blue) along its normal.',
				doc: 'selection',
			})}
		>
			{#each ['x', 'y', 'z'] as const as coord (coord)}
				{@const axis = AXES[coord]}
				<label for="freeform-{coord}" class="text-muted-foreground" title={axis.title}>
					{isSingle ? '' : 'Δ'}<span class="font-bold" style="color: {axis.color}"
						>{axis.letter}</span
					> (nm)
				</label>
				<Input
					id="freeform-{coord}"
					class="h-7 w-24"
					type="number"
					step="0.1"
					placeholder={isSingle ? '' : '0'}
					value={isSingle ? fmt(vhs[0].localFrame.origin[coord], 3) : ''}
					disabled={isReadOnly}
					onchange={(e) => onCoordChange(e, coord)}
				/>
			{/each}
			{#if allInPlane}
				<label for="freeform-direction" class="text-muted-foreground">Direction (°)</label>
				<Input
					id="freeform-direction"
					class="h-7 w-24"
					type="number"
					step="15"
					placeholder={commonDirection === null ? 'mixed' : ''}
					value={fmt(commonDirection, 1)}
					disabled={isReadOnly}
					onchange={onDirectionChange}
				/>
			{/if}
		</div>
	</div>
{/if}
