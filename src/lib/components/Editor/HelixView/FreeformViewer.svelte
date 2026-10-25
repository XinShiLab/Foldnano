<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Stage, Layer, Group, Rect, Arrow, Text, Line, Circle } from 'svelte-konva';
	import type { Stage as StageType, KonvaPointerEvent } from 'svelte-konva';
	import type { Part } from '$lib/model/Part/Part.svelte';
	import { FreeformRegion, type DesignRegion } from '$lib/model/Part/DesignRegion';
	import { handleWheel } from '../mouseHandler';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import {
		addFreeformVirtualHelixCmd,
		addInPlaneFreeformVirtualHelixCmd,
		fillFreeformVirtualHelixCmd,
		moveFreeformVirtualHelixCmd,
		moveFreeformVirtualHelicesCmd,
	} from '$lib/commands/virtualHelix';
	import { createCrossoverCmd, moveOligoEndCmd } from '$lib/commands/strands';
	import {
		BACKBONE_RISE_NM,
		framesEqual,
		type VirtualHelixFrame,
	} from '$lib/model/geometry3d/dnaGeometry';
	import type VirtualHelix from '$lib/model/VirtualHelix';
	import type OligoSegment from '$lib/model/Oligo/OligoSegment.svelte';
	import type { SegmentEnd } from '$lib/model/Oligo';
	import HelixCircle from './HelixCircle.svelte';
	import { canvasTheme } from '$lib/canvasEditor/theme.svelte';

	interface Props {
		part: Part;
		region: DesignRegion;
		focusedSegments?: Set<OligoSegment> | null;
		stageRef?: StageType;
	}

	type FreeformHitTarget =
		| { kind: 'FIVE_PRIME_END'; segment: OligoSegment }
		| { kind: 'THREE_PRIME_END'; segment: OligoSegment };
	type PointerCaptureTarget = HTMLElement & {
		setPointerCapture(pointerId: number): void;
		releasePointerCapture(pointerId: number): void;
	};

	let { part, region, focusedSegments = null, stageRef = $bindable() }: Props = $props();

	const editorViewContext = getEditorViewContext();
	const editorMode = $derived(editorViewContext.editorMode);
	const history = $derived(editorViewContext.historyStack);

	// Measured from the wrapper div — Stage fills whatever space is available.
	let containerW = $state(0);
	let containerH = $state(0);
	const CANVAS_W = $derived(containerW || 400);
	const CANVAS_H = $derived(containerH || 400);

	// 10 px/nm → RADIUS = HELIX_VISUAL_RADIUS(1.0 nm) × SCALE = 10 px, matching 3D cylinder size.
	const SCALE = 10; // px per nm
	const OFFSET_X = $derived(CANVAS_W / 2);
	const OFFSET_Y = $derived(CANVAS_H / 2);
	let themeColors = $derived(canvasTheme.colors);

	// Axis indicator at nm (0,0) — colors match the 3D coordinate axis
	const AXIS_LEN_PX = 40; // length of each arm in pixels
	// In-plane axes — labelled U and V to match the plane's local frame, not world XY
	const AXIS_U_COLOR = '#ff3333'; // red  — U axis (in-plane)
	const AXIS_V_COLOR = '#33cc44'; // green — V axis (in-plane)
	const AXIS_LABEL_OFFSET = 8; // px past the arrowhead for the letter
	const RADIUS = 10; // = HELIX_VISUAL_RADIUS (1.0 nm) × SCALE
	const STROKE_W = 2;
	const HELIX_WIDTH_PX = 2 * RADIUS;
	const DRAG_THRESHOLD_PX = 4;
	const PERPENDICULAR_AXIS_DOT = 0.9;
	const VH_CORNER_RADIUS = 2;
	const VH_OUTLINE_OPACITY = 0.42;
	const STRAND_STROKE_W = 2;
	const STRAND_OFFSET_PX = 4;
	const TERMINUS_SIZE_PX = 6;
	const FIVE_PRIME_MARKER_INSET_PX = TERMINUS_SIZE_PX / 4;
	const THREE_PRIME_TRIANGLE_SIZE_PX = TERMINUS_SIZE_PX * 1.2;
	const THREE_PRIME_MARKER_OUTSET_PX = TERMINUS_SIZE_PX * 0.4;
	const END_HIT_RADIUS_PX = 7;
	const END_HIT_TARGET_FILL = 'rgba(37, 99, 235, 0.001)';
	const DIMMED_FATLINE_OPACITY = 0.25;
	const selectionColor = $derived(themeColors.freeformDragColor);
	const marqueeFill = $derived(themeColors.freeformDragColor);
	const hasFocusedSegments = $derived((focusedSegments?.size ?? 0) > 0);

	let hoveredVhIdx = $state<number | null>(null);
	const selectedVhIndices = $derived(editorViewContext.selectedFreeformVhIndices);
	let activeConnection = $state<{
		fromSegment: OligoSegment;
		start: { x: number; y: number };
		current: { x: number; y: number };
	} | null>(null);
	let activeEndDrag = $state<{
		end: SegmentEnd;
		startIdx: number;
		currentIdx: number;
	} | null>(null);

	// Only VHs belonging to this region
	const regionVhs = $derived(part.virtualHelices.filter((vh) => vh.regionId === region.id));

	function nmToCanvas(xNm: number, yNm: number): { x: number; y: number } {
		return { x: xNm * SCALE + OFFSET_X, y: yNm * SCALE + OFFSET_Y };
	}

	function canvasToNm(xPx: number, yPx: number): { x: number; y: number } {
		return { x: (xPx - OFFSET_X) / SCALE, y: (yPx - OFFSET_Y) / SCALE };
	}

	// Convert a viewport pointer position to layer (canvas) coordinates,
	// accounting for the current stage pan and zoom.
	function toLayerCoords(
		stage: { x(): number; y(): number; scaleX(): number; scaleY(): number },
		raw: { x: number; y: number }
	) {
		return {
			x: (raw.x - stage!.x()) / stage!.scaleX(),
			y: (raw.y - stage!.y()) / stage!.scaleY(),
		};
	}

	function cloneFrame(frame: VirtualHelixFrame): VirtualHelixFrame {
		return {
			origin: { ...frame.origin },
			axis: { ...frame.axis },
			radial0: { ...frame.radial0 },
		};
	}

	function isPerpendicular(frame: VirtualHelixFrame | undefined): boolean {
		return !frame || Math.abs(frame.axis.z) >= PERPENDICULAR_AXIS_DOT;
	}

	function hasSelectionModifier(e: KonvaPointerEvent): boolean {
		return e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
	}

	function frameAngleDeg(frame: VirtualHelixFrame): number {
		return (Math.atan2(frame.axis.y, frame.axis.x) * 180) / Math.PI;
	}

	function fullLengthPx(vh: VirtualHelix): number {
		return vh.length * BACKBONE_RISE_NM * SCALE;
	}

	function bpToLocalX(bpIdx: number): number {
		return bpIdx * BACKBONE_RISE_NM * SCALE;
	}

	function clampBpIndex(vh: VirtualHelix, bpIdx: number): number {
		return Math.min(Math.max(bpIdx, 0), Math.max(vh.length - 1, 0));
	}

	function layerPointToBpIndex(vh: VirtualHelix, point: { x: number; y: number }): number | null {
		const frame = vh.localFrame;
		if (!frame || isPerpendicular(frame)) return null;
		const origin = nmToCanvas(frame.origin.x, frame.origin.y);
		const angle = Math.atan2(frame.axis.y, frame.axis.x);
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		const dx = point.x - origin.x;
		const dy = point.y - origin.y;
		const localX = c * dx + s * dy;
		return clampBpIndex(vh, Math.round(localX / (BACKBONE_RISE_NM * SCALE)));
	}

	function vhCanvasBounds(vh: VirtualHelix): {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	} {
		const frame = vh.localFrame ?? {
			origin: { x: 0, y: 0, z: 0 },
			axis: { x: 0, y: 0, z: 1 },
			radial0: { x: 1, y: 0, z: 0 },
		};
		const origin = nmToCanvas(frame.origin.x, frame.origin.y);
		if (isPerpendicular(frame)) {
			return {
				minX: origin.x - RADIUS,
				minY: origin.y - RADIUS,
				maxX: origin.x + RADIUS,
				maxY: origin.y + RADIUS,
			};
		}

		const lengthPx = fullLengthPx(vh);
		const halfWidth = HELIX_WIDTH_PX / 2;
		const angle = Math.atan2(frame.axis.y, frame.axis.x);
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		const points = [
			{ x: 0, y: -halfWidth },
			{ x: lengthPx, y: -halfWidth },
			{ x: lengthPx, y: halfWidth },
			{ x: 0, y: halfWidth },
		].map((point) => ({
			x: origin.x + c * point.x - s * point.y,
			y: origin.y + s * point.x + c * point.y,
		}));

		return {
			minX: Math.min(...points.map((point) => point.x)),
			minY: Math.min(...points.map((point) => point.y)),
			maxX: Math.max(...points.map((point) => point.x)),
			maxY: Math.max(...points.map((point) => point.y)),
		};
	}

	function normalizedRect(a: { x: number; y: number }, b: { x: number; y: number }) {
		return {
			x: Math.min(a.x, b.x),
			y: Math.min(a.y, b.y),
			width: Math.abs(b.x - a.x),
			height: Math.abs(b.y - a.y),
		};
	}

	function boundsIntersect(
		a: { minX: number; minY: number; maxX: number; maxY: number },
		b: { minX: number; minY: number; maxX: number; maxY: number }
	): boolean {
		return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
	}

	function strandLocalY(strandIdx: 0 | 1): number {
		return strandIdx === 0 ? -STRAND_OFFSET_PX : STRAND_OFFSET_PX;
	}

	function fivePrimeMarkerX(x: number, otherX: number): number {
		const delta = otherX - x;
		if (Math.abs(delta) < 1e-6) return x;
		return x + Math.sign(delta) * FIVE_PRIME_MARKER_INSET_PX;
	}

	function segmentsForVh(vh: VirtualHelix): OligoSegment[] {
		const segments: OligoSegment[] = [];
		for (const strandSet of vh.strandSets) {
			for (const id of strandSet.segmentIds) {
				const segment = part.getSegmentById(id);
				if (segment) segments.push(segment);
			}
		}
		return segments.sort(
			(a, b) =>
				a.inStrandIndex - b.inStrandIndex ||
				Math.min(a.fivePrime.index, a.threePrime.index) -
					Math.min(b.fivePrime.index, b.threePrime.index)
		);
	}

	function threePrimeTrianglePoints(x: number, y: number, strandIdx: 0 | 1): number[] {
		const half = THREE_PRIME_TRIANGLE_SIZE_PX / 2;
		const pointsRight = strandIdx === 0;
		const tipX = x + (pointsRight ? THREE_PRIME_MARKER_OUTSET_PX : -THREE_PRIME_MARKER_OUTSET_PX);
		if (pointsRight) {
			return [
				tipX,
				y,
				tipX - THREE_PRIME_TRIANGLE_SIZE_PX,
				y - half,
				tipX - THREE_PRIME_TRIANGLE_SIZE_PX,
				y + half,
			];
		}
		return [
			tipX,
			y,
			tipX + THREE_PRIME_TRIANGLE_SIZE_PX,
			y - half,
			tipX + THREE_PRIME_TRIANGLE_SIZE_PX,
			y + half,
		];
	}

	function segmentEndCanvasPoint(segment: OligoSegment, end: 'fivePrime' | 'threePrime') {
		const frame = segment.inVirtualHelix.localFrame;
		if (!frame || isPerpendicular(frame)) return null;
		const origin = nmToCanvas(frame.origin.x, frame.origin.y);
		const angle = Math.atan2(frame.axis.y, frame.axis.x);
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		const bpIdx = end === 'fivePrime' ? segment.fivePrime.index : segment.threePrime.index;
		const localX = bpToLocalX(bpIdx);
		const localY = strandLocalY(segment.inStrandIndex as 0 | 1);
		return {
			x: origin.x + c * localX - s * localY,
			y: origin.y + s * localX + c * localY,
		};
	}

	function crossoverBulgePoint(from: { x: number; y: number }, to: { x: number; y: number }) {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const len = Math.hypot(dx, dy);
		const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
		if (len < 1e-6) return mid;
		const bulge = Math.min(Math.max(len * 0.08, 6), 18);
		const sign = from.y <= to.y ? -1 : 1;
		return {
			x: mid.x + sign * (-dy / len) * bulge,
			y: mid.y + sign * (dx / len) * bulge,
		};
	}

	const freeformCrossovers = $derived.by(() => {
		const crossovers: {
			id: string;
			fromSegment: OligoSegment;
			toSegment: OligoSegment;
			from: { x: number; y: number };
			to: { x: number; y: number };
			bulge: { x: number; y: number };
			color: string;
			constrained: boolean;
		}[] = [];
		for (const oligo of part.oligos) {
			for (const segment of oligo.segments) {
				if (segment.inVirtualHelix.regionId !== region.id) continue;
				const connectedEnd = segment.threePrime.connectedEnd;
				if (!connectedEnd) continue;
				if (connectedEnd.segment.inVirtualHelix.regionId !== region.id) continue;
				const from = segmentEndCanvasPoint(segment, 'threePrime');
				const to = segmentEndCanvasPoint(connectedEnd.segment, 'fivePrime');
				if (!from || !to) continue;
				crossovers.push({
					id: `${segment.id}->${connectedEnd.segment.id}`,
					fromSegment: segment,
					toSegment: connectedEnd.segment,
					from,
					to,
					bulge: crossoverBulgePoint(from, to),
					color: oligo.color,
					constrained: segment.threePrime.isConstrained && connectedEnd.isConstrained,
				});
			}
		}
		return crossovers;
	});

	function canStartConnection(segment: OligoSegment): boolean {
		return segment.threePrime.isFree && segment.oligo?.threePrime === segment.threePrime;
	}

	function canEndConnection(segment: OligoSegment): boolean {
		return segment.fivePrime.isFree && segment.oligo?.fivePrime === segment.fivePrime;
	}

	function startEndResize(hit: FreeformHitTarget) {
		const end = hit.kind === 'THREE_PRIME_END' ? hit.segment.threePrime : hit.segment.fivePrime;
		if (!end.isFree || isPerpendicular(part.getVirtualHelixFrame(hit.segment.inVirtualHelix)))
			return;
		activeConnection = null;
		activeEndDrag = {
			end,
			startIdx: end.index,
			currentIdx: end.index,
		};
	}

	function onFreeformHitPointerDown(e: KonvaPointerEvent, hit: FreeformHitTarget) {
		if (editorMode !== 'DRAW' && editorMode !== 'SELECT') return;
		e.cancelBubble = true;

		if (editorMode === 'SELECT') {
			startEndResize(hit);
			if (activeEndDrag) capturePointer(e);
			return;
		}

		if (hit.kind === 'THREE_PRIME_END') {
			if (!canStartConnection(hit.segment)) return;
			const start = segmentEndCanvasPoint(hit.segment, 'threePrime');
			if (!start) return;
			activeConnection = { fromSegment: hit.segment, start, current: start };
			return;
		}

		if (!activeConnection || !canEndConnection(hit.segment)) {
			activeConnection = null;
			return;
		}

		const fromOligo = activeConnection.fromSegment.oligo;
		const toOligo = hit.segment.oligo;
		if (!fromOligo || !toOligo) {
			activeConnection = null;
			return;
		}

		try {
			createCrossoverCmd(
				{
					part,
					fromOligo,
					toOligo,
					toSegment: hit.segment,
					atIndexTarget: hit.segment.fivePrime.index,
				},
				history
			);
		} catch (error) {
			console.error('Error creating freeform crossover:', error);
		} finally {
			activeConnection = null;
		}
	}

	function onBackgroundDblClick(e: KonvaPointerEvent) {
		if (editorMode !== 'DRAW') return;
		if (e.target !== e.currentTarget) return;
		const stage = e.target.getStage();
		if (!stage) return;
		const raw = stage.getPointerPosition();
		if (!raw) return;
		const { x: lx, y: ly } = toLayerCoords(stage, raw);
		const { x, y } = canvasToNm(lx, ly);
		addFreeformVirtualHelixCmd({ part, x, y, regionId: region.id }, history);
	}

	let activeLine = $state<{
		startLayer: { x: number; y: number };
		currentLayer: { x: number; y: number };
		startNm: { x: number; y: number };
		currentNm: { x: number; y: number };
	} | null>(null);

	let activeMarquee = $state<{
		startLayer: { x: number; y: number };
		currentLayer: { x: number; y: number };
		additive: boolean;
	} | null>(null);

	function onBackgroundPointerDown(e: KonvaPointerEvent) {
		if (e.target !== e.currentTarget) return;
		const stage = e.target.getStage();
		if (!stage) return;
		const raw = stage.getPointerPosition();
		if (!raw) return;
		const layer = toLayerCoords(stage, raw);

		if (editorMode === 'DRAW') {
			const nm = canvasToNm(layer.x, layer.y);
			activeLine = {
				startLayer: layer,
				currentLayer: layer,
				startNm: nm,
				currentNm: nm,
			};
			capturePointer(e);
			return;
		}

		if (editorMode === 'SELECT') {
			activeMarquee = {
				startLayer: layer,
				currentLayer: layer,
				additive: hasSelectionModifier(e),
			};
			capturePointer(e);
		}
	}

	// Manual drag — avoids the click/drag conflict that arises from Konva's draggable=true
	let activeDrag = $state<{
		vhIdx: number;
		startLayer: { x: number; y: number };
		frames: {
			vhIdx: number;
			originNm: { x: number; y: number };
			dragStartFrame: VirtualHelixFrame;
		}[];
	} | null>(null);

	let activeRotate = $state<{
		vhIdx: number;
		dragStartFrame: VirtualHelixFrame;
	} | null>(null);
	let activePointerCapture = $state<{ pointerId: number; target: PointerCaptureTarget } | null>(
		null
	);

	function asPointerCaptureTarget(target: EventTarget | null): PointerCaptureTarget | null {
		return target instanceof HTMLElement &&
			typeof target.setPointerCapture === 'function' &&
			typeof target.releasePointerCapture === 'function'
			? (target as PointerCaptureTarget)
			: null;
	}

	function releaseCapturedPointer(): void {
		if (!activePointerCapture) return;
		try {
			activePointerCapture.target.releasePointerCapture(activePointerCapture.pointerId);
		} catch {
			// Capture may already be gone if the browser ended the gesture first.
		}
		activePointerCapture = null;
	}

	function capturePointer(e: KonvaPointerEvent): void {
		const target = asPointerCaptureTarget(e.evt.target);
		if (!target) return;
		releaseCapturedPointer();
		target.setPointerCapture(e.evt.pointerId);
		activePointerCapture = { pointerId: e.evt.pointerId, target };
	}

	function cancelActiveInteractions(): void {
		if (activeRotate) {
			const vh = part.getVhByIndex(activeRotate.vhIdx);
			if (vh) vh.localFrame = cloneFrame(activeRotate.dragStartFrame);
		}
		if (activeDrag) {
			for (const frame of activeDrag.frames) {
				const vh = part.getVhByIndex(frame.vhIdx);
				if (vh) vh.localFrame = cloneFrame(frame.dragStartFrame);
			}
		}
		activeLine = null;
		activeMarquee = null;
		activeConnection = null;
		activeEndDrag = null;
		activeDrag = null;
		activeRotate = null;
		releaseCapturedPointer();
	}

	onDestroy(() => {
		cancelActiveInteractions();
	});

	function onVhPointerDown(e: KonvaPointerEvent, vhIdx: number) {
		if (editorMode === 'PAN') return;
		e.cancelBubble = true;
		const stage = e.target.getStage();
		if (!stage) return;
		const raw = stage.getPointerPosition();
		if (!raw) return;
		const vh = part.getVhByIndex(vhIdx);
		if (!vh?.localFrame) return;

		if (editorMode === 'SELECT') {
			if (hasSelectionModifier(e)) {
				editorViewContext.toggleSelectedFreeformVh(vhIdx);
				return;
			} else if (!selectedVhIndices.has(vhIdx)) {
				editorViewContext.setSelectedFreeformVhs([vhIdx]);
			}
		}

		const dragVhIndices = editorMode === 'SELECT' ? Array.from(selectedVhIndices) : [vhIdx];
		const frames = dragVhIndices
			.map((selectedVhIdx) => part.getVhByIndex(selectedVhIdx))
			.filter((candidate): candidate is VirtualHelix => Boolean(candidate?.localFrame))
			.map((candidate) => ({
				vhIdx: candidate.index,
				originNm: { x: candidate.localFrame!.origin.x, y: candidate.localFrame!.origin.y },
				dragStartFrame: cloneFrame(candidate.localFrame!),
			}));
		if (frames.length === 0) return;

		activeDrag = {
			vhIdx,
			startLayer: toLayerCoords(stage, raw),
			frames,
		};
		capturePointer(e);
	}

	function onRotatePointerDown(e: KonvaPointerEvent, vhIdx: number) {
		if (editorMode === 'PAN') return;
		e.cancelBubble = true;
		const vh = part.getVhByIndex(vhIdx);
		if (!vh?.localFrame) return;
		activeRotate = {
			vhIdx,
			dragStartFrame: cloneFrame(vh.localFrame),
		};
		capturePointer(e);
	}

	function onStagePointerMove(e: KonvaPointerEvent) {
		const stage = e.target.getStage();
		if (!stage) return;
		const raw = stage.getPointerPosition();
		if (!raw) return;
		const { x: lx, y: ly } = toLayerCoords(stage, raw);
		if (activeLine) {
			activeLine.currentLayer = { x: lx, y: ly };
			activeLine.currentNm = canvasToNm(lx, ly);
			return;
		}
		if (activeMarquee) {
			activeMarquee.currentLayer = { x: lx, y: ly };
			return;
		}
		if (activeRotate) {
			const vh = part.getVhByIndex(activeRotate.vhIdx);
			if (!vh?.localFrame) return;
			const { x, y } = canvasToNm(lx, ly);
			const dx = x - vh.localFrame.origin.x;
			const dy = y - vh.localFrame.origin.y;
			const len = Math.hypot(dx, dy);
			if (len < 1e-9) return;
			vh.localFrame = {
				...vh.localFrame,
				axis: { x: dx / len, y: dy / len, z: 0 },
				radial0: { x: 0, y: 0, z: 1 },
			};
			return;
		}
		if (activeConnection) {
			activeConnection.current = { x: lx, y: ly };
			return;
		}
		if (activeEndDrag) {
			const candidateIdx = layerPointToBpIndex(activeEndDrag.end.segment.inVirtualHelix, {
				x: lx,
				y: ly,
			});
			if (candidateIdx !== null && activeEndDrag.end.canMoveTo(candidateIdx, true)) {
				activeEndDrag.currentIdx = candidateIdx;
			}
			return;
		}
		if (!activeDrag) return;
		const dx = (lx - activeDrag.startLayer.x) / SCALE;
		const dy = (ly - activeDrag.startLayer.y) / SCALE;
		for (const frame of activeDrag.frames) {
			const vh = part.getVhByIndex(frame.vhIdx);
			if (!vh) continue;
			const vhRegion = part.getRegionForVh(vh);
			if (vhRegion instanceof FreeformRegion) {
				vhRegion.moveVh(part, vh, frame.originNm.x + dx, frame.originNm.y + dy);
			}
		}
	}

	// Reactive drag indicator — reads vh.localFrame which is mutated live during drag
	const dragIndicator = $derived.by(() => {
		if (!activeDrag) return null;
		const vh = part.getVhByIndex(activeDrag.vhIdx);
		if (!vh?.localFrame) return null;
		return {
			cx: vh.localFrame.origin.x * SCALE + OFFSET_X,
			cy: vh.localFrame.origin.y * SCALE + OFFSET_Y,
			xNm: vh.localFrame.origin.x,
			yNm: vh.localFrame.origin.y,
		};
	});

	function onStagePointerUp() {
		if (activeLine) {
			const distancePx = Math.hypot(
				activeLine.currentLayer.x - activeLine.startLayer.x,
				activeLine.currentLayer.y - activeLine.startLayer.y
			);
			if (distancePx >= DRAG_THRESHOLD_PX) {
				addInPlaneFreeformVirtualHelixCmd(
					{ part, start: activeLine.startNm, end: activeLine.currentNm, regionId: region.id },
					history
				);
			} else {
				activeConnection = null;
			}
			activeLine = null;
			releaseCapturedPointer();
			return;
		}
		if (activeMarquee) {
			const distancePx = Math.hypot(
				activeMarquee.currentLayer.x - activeMarquee.startLayer.x,
				activeMarquee.currentLayer.y - activeMarquee.startLayer.y
			);
			if (distancePx < DRAG_THRESHOLD_PX) {
				editorViewContext.clearSelectedFreeformVhs();
			} else {
				const rect = normalizedRect(activeMarquee.startLayer, activeMarquee.currentLayer);
				const marqueeBounds = {
					minX: rect.x,
					minY: rect.y,
					maxX: rect.x + rect.width,
					maxY: rect.y + rect.height,
				};
				const matched = regionVhs
					.filter((vh) => boundsIntersect(vhCanvasBounds(vh), marqueeBounds))
					.map((vh) => vh.index);
				if (activeMarquee.additive) {
					editorViewContext.addSelectedFreeformVhs(matched);
				} else {
					editorViewContext.setSelectedFreeformVhs(matched);
				}
			}
			activeMarquee = null;
			releaseCapturedPointer();
			return;
		}
		if (activeRotate) {
			const vh = part.getVhByIndex(activeRotate.vhIdx);
			if (vh?.localFrame) {
				const from = activeRotate.dragStartFrame;
				const to = cloneFrame(vh.localFrame);
				if (!framesEqual(from, to)) moveFreeformVirtualHelixCmd({ vh, from, to }, history);
			}
			activeRotate = null;
			releaseCapturedPointer();
			return;
		}
		if (activeEndDrag) {
			const { end, startIdx, currentIdx } = activeEndDrag;
			if (currentIdx !== startIdx && end.canMoveTo(currentIdx, true)) {
				moveOligoEndCmd({ part, end, toIdx: currentIdx }, history);
			}
			activeEndDrag = null;
			releaseCapturedPointer();
			return;
		}
		if (!activeDrag) return;
		const moves = activeDrag.frames
			.map((frame) => {
				const vh = part.getVhByIndex(frame.vhIdx);
				if (!vh?.localFrame) return null;
				return { vh, from: frame.dragStartFrame, to: cloneFrame(vh.localFrame) };
			})
			.filter(
				(move): move is { vh: VirtualHelix; from: VirtualHelixFrame; to: VirtualHelixFrame } =>
					Boolean(move)
			);
		const movedPx = moves.reduce((maxMovedPx, move) => {
			const moved = Math.hypot(
				(move.to.origin.x - move.from.origin.x) * SCALE,
				(move.to.origin.y - move.from.origin.y) * SCALE
			);
			return Math.max(maxMovedPx, moved);
		}, 0);

		if (movedPx >= DRAG_THRESHOLD_PX) {
			if (moves.length === 1) {
				const [move] = moves;
				moveFreeformVirtualHelixCmd(move, history);
			} else {
				moveFreeformVirtualHelicesCmd({ moves }, history);
			}
		} else {
			for (const move of moves) {
				move.vh.localFrame = move.from;
			}
			const vh = part.getVhByIndex(activeDrag.vhIdx);
			if (vh?.localFrame && editorMode === 'DRAW' && isPerpendicular(vh.localFrame)) {
				fillFreeformVirtualHelixCmd({ part, vh }, history);
			}
		}
		activeDrag = null;
		releaseCapturedPointer();
	}

	function onStagePointerCancel() {
		cancelActiveInteractions();
	}
</script>

<div
	bind:clientWidth={containerW}
	bind:clientHeight={containerH}
	style="width:100%;height:100%;overflow:hidden;"
>
	<Stage
		draggable={editorMode === 'PAN'}
		width={CANVAS_W}
		height={CANVAS_H}
		bind:this={stageRef}
		onwheel={(e) => handleWheel(e, stageRef)}
		onpointermove={onStagePointerMove}
		onpointerup={onStagePointerUp}
		onpointercancel={onStagePointerCancel}
	>
		<Layer>
			<!-- Clickable background to add new VHs in DRAW mode -->
			<Rect
				x={0}
				y={0}
				width={CANVAS_W}
				height={CANVAS_H}
				fill="transparent"
				onpointerdown={onBackgroundPointerDown}
				onpointerdblclick={onBackgroundDblClick}
			/>

			<!-- In-plane axes at local (0,0) — labelled U/V to match the plane's local frame -->
			<Group x={OFFSET_X} y={OFFSET_Y} listening={false}>
				<!-- U axis (red) -->
				<Arrow
					points={[0, 0, AXIS_LEN_PX, 0]}
					stroke={AXIS_U_COLOR}
					strokeWidth={2}
					fill={AXIS_U_COLOR}
					pointerLength={7}
					pointerWidth={5}
				/>
				<Text
					x={AXIS_LEN_PX + AXIS_LABEL_OFFSET}
					y={-7}
					text="U"
					fontSize={13}
					fontStyle="bold"
					fill={AXIS_U_COLOR}
				/>
				<!-- V axis (green, canvas-Y points down = positive plane-V, same as HelixView rows) -->
				<Arrow
					points={[0, 0, 0, AXIS_LEN_PX]}
					stroke={AXIS_V_COLOR}
					strokeWidth={2}
					fill={AXIS_V_COLOR}
					pointerLength={7}
					pointerWidth={5}
				/>
				<Text
					x={-14}
					y={AXIS_LEN_PX + AXIS_LABEL_OFFSET}
					text="V"
					fontSize={13}
					fontStyle="bold"
					fill={AXIS_V_COLOR}
				/>
			</Group>

			{#if dragIndicator}
				{@const { cx, cy, xNm, yNm } = dragIndicator}
				{@const xMid = (OFFSET_X + cx) / 2}
				{@const yMid = (OFFSET_Y + cy) / 2}
				{@const LW = 80}
				{@const LH = 16}
				{@const DC = themeColors.freeformDragColor}
				<!-- Horizontal dashed line: Y-axis → helix x, at helix's y level (shows X position) -->
				<Line
					points={[OFFSET_X, cy, cx, cy]}
					stroke={DC}
					strokeWidth={1.5}
					dash={[6, 4]}
					listening={false}
				/>
				<!-- Vertical dashed line: X-axis → helix y, at helix's x level (shows Y position) -->
				<Line
					points={[cx, OFFSET_Y, cx, cy]}
					stroke={DC}
					strokeWidth={1.5}
					dash={[6, 4]}
					listening={false}
				/>
				<!-- X badge -->
				<Rect
					x={xMid - LW / 2}
					y={cy - LH - 5}
					width={LW}
					height={LH}
					fill={themeColors.hxFill}
					opacity={0.88}
					cornerRadius={3}
					listening={false}
				/>
				<Text
					x={xMid - LW / 2}
					y={cy - LH - 5}
					width={LW}
					height={LH}
					text={`x: ${xNm.toFixed(2)} nm`}
					fontSize={11}
					fontStyle="bold"
					fill={DC}
					align="center"
					verticalAlign="middle"
					listening={false}
				/>
				<!-- Y badge -->
				<Rect
					x={cx + 5}
					y={yMid - LH / 2}
					width={LW}
					height={LH}
					fill={themeColors.hxFill}
					opacity={0.88}
					cornerRadius={3}
					listening={false}
				/>
				<Text
					x={cx + 5}
					y={yMid - LH / 2}
					width={LW}
					height={LH}
					text={`y: ${yNm.toFixed(2)} nm`}
					fontSize={11}
					fontStyle="bold"
					fill={DC}
					align="center"
					verticalAlign="middle"
					listening={false}
				/>
			{/if}

			{#if activeMarquee}
				{@const marquee = normalizedRect(activeMarquee.startLayer, activeMarquee.currentLayer)}
				<Rect
					x={marquee.x}
					y={marquee.y}
					width={marquee.width}
					height={marquee.height}
					fill={marqueeFill}
					opacity={0.16}
					listening={false}
				/>
				<Rect
					x={marquee.x}
					y={marquee.y}
					width={marquee.width}
					height={marquee.height}
					stroke={selectionColor}
					strokeWidth={1.5}
					dash={[6, 4]}
					listening={false}
				/>
			{/if}

			{#each regionVhs as vh (vh.index)}
				{@const xNm = vh.localFrame ? vh.localFrame.origin.x : 0}
				{@const yNm = vh.localFrame ? vh.localFrame.origin.y : 0}
				{@const { x, y } = nmToCanvas(xNm, yNm)}
				{@const perpendicular = isPerpendicular(vh.localFrame)}
				{@const selected = selectedVhIndices.has(vh.index)}

				<Group {x} {y} onpointerdown={(e) => onVhPointerDown(e, vh.index)}>
					{#if perpendicular}
						{#if selected}
							<Circle
								x={0}
								y={0}
								radius={RADIUS + 5}
								stroke={selectionColor}
								strokeWidth={2.5}
								opacity={0.85}
								listening={false}
							/>
						{/if}
						<HelixCircle
							x={0}
							y={0}
							radius={RADIUS}
							strokeWidth={STROKE_W}
							vhIdx={vh.index}
							{part}
							text={`${vh.index}`}
							active={true}
							scafStartAngle={(vh.index % 2 === 0 ? 0 : 180) +
								part.getRegionForVh(vh).twistOffsetInDeg}
							scafBpAngle={part.getRegionForVh(vh).twistPerBaseInDeg}
						/>
					{:else if vh.localFrame}
						{@const lengthPx = fullLengthPx(vh)}
						<Group
							rotation={frameAngleDeg(vh.localFrame)}
							onpointerenter={() => (hoveredVhIdx = vh.index)}
							onpointerleave={() => {
								if (hoveredVhIdx === vh.index) hoveredVhIdx = null;
							}}
						>
							{#if selected}
								<Rect
									x={-4}
									y={-HELIX_WIDTH_PX / 2 - 4}
									width={lengthPx + 8}
									height={HELIX_WIDTH_PX + 8}
									cornerRadius={VH_CORNER_RADIUS + 2}
									fill="transparent"
									stroke={selectionColor}
									strokeWidth={2.5}
									opacity={0.85}
									listening={false}
								/>
							{/if}
							<Rect
								x={0}
								y={-HELIX_WIDTH_PX / 2}
								width={lengthPx}
								height={HELIX_WIDTH_PX}
								cornerRadius={VH_CORNER_RADIUS}
								fill="transparent"
								stroke={themeColors.gridLine}
								strokeWidth={STROKE_W}
								opacity={VH_OUTLINE_OPACITY}
							/>
							{#each segmentsForVh(vh) as segment (segment.id)}
								{@const strandIdx = segment.inStrandIndex as 0 | 1}
								{@const strandY = strandLocalY(strandIdx)}
								{@const fiveX = bpToLocalX(segment.fivePrime.index)}
								{@const threeX = bpToLocalX(segment.threePrime.index)}
								{@const fiveMarkerX = fivePrimeMarkerX(fiveX, threeX)}
								{@const color = segment.oligo?.color ?? '#f59e0b'}
								{@const dragEnd = activeEndDrag?.end.segment === segment ? activeEndDrag : null}
								{@const resizingThisSegment = dragEnd !== null}
								{@const focused = !hasFocusedSegments || focusedSegments?.has(segment)}
								{@const fatlineOpacity = resizingThisSegment
									? 0.32
									: focused
										? 1
										: DIMMED_FATLINE_OPACITY}
								{@const previewFiveX =
									dragEnd && !dragEnd.end.isThreePrime ? bpToLocalX(dragEnd.currentIdx) : fiveX}
								{@const previewThreeX =
									dragEnd && dragEnd.end.isThreePrime ? bpToLocalX(dragEnd.currentIdx) : threeX}
								{@const previewFiveMarkerX = fivePrimeMarkerX(previewFiveX, previewThreeX)}
								<Line
									points={[fiveX, strandY, threeX, strandY]}
									stroke={color}
									lineCap="round"
									lineJoin="round"
									strokeWidth={STRAND_STROKE_W}
									opacity={fatlineOpacity}
									listening={false}
								/>
								<Rect
									x={fiveMarkerX}
									y={strandY}
									offsetX={TERMINUS_SIZE_PX / 2}
									offsetY={TERMINUS_SIZE_PX / 2}
									width={TERMINUS_SIZE_PX}
									height={TERMINUS_SIZE_PX}
									fill={color}
									opacity={fatlineOpacity}
									listening={false}
								/>
								<Circle
									x={fiveMarkerX}
									y={strandY}
									radius={END_HIT_RADIUS_PX}
									fill={END_HIT_TARGET_FILL}
									onpointerdown={(e) =>
										onFreeformHitPointerDown(e, { kind: 'FIVE_PRIME_END', segment })}
								/>
								<Line
									points={threePrimeTrianglePoints(threeX, strandY, strandIdx)}
									fill={color}
									opacity={fatlineOpacity}
									closed
									listening={false}
								/>
								<Circle
									x={threeX}
									y={strandY}
									radius={END_HIT_RADIUS_PX}
									fill={END_HIT_TARGET_FILL}
									onpointerdown={(e) =>
										onFreeformHitPointerDown(e, { kind: 'THREE_PRIME_END', segment })}
								/>
								{#if resizingThisSegment}
									<Line
										points={[previewFiveX, strandY, previewThreeX, strandY]}
										stroke={color}
										lineCap="round"
										lineJoin="round"
										strokeWidth={STRAND_STROKE_W + 1}
										dash={[5, 3]}
										listening={false}
									/>
									{#if dragEnd?.end.isThreePrime}
										<Line
											points={threePrimeTrianglePoints(previewThreeX, strandY, strandIdx)}
											fill={color}
											closed
											listening={false}
										/>
									{:else}
										<Rect
											x={previewFiveMarkerX}
											y={strandY}
											offsetX={TERMINUS_SIZE_PX / 2}
											offsetY={TERMINUS_SIZE_PX / 2}
											width={TERMINUS_SIZE_PX}
											height={TERMINUS_SIZE_PX}
											fill={color}
											listening={false}
										/>
									{/if}
								{/if}
							{/each}
							<Text
								x={4}
								y={-7}
								text={`${vh.index}`}
								fontSize={13}
								fontStyle="bold"
								fill={themeColors.vhText}
								listening={false}
							/>
							{#if hoveredVhIdx === vh.index || activeRotate?.vhIdx === vh.index}
								<Group x={lengthPx} y={0} onpointerdown={(e) => onRotatePointerDown(e, vh.index)}>
									<Rect
										offsetX={3}
										offsetY={5}
										width={6}
										height={10}
										cornerRadius={2}
										fill={themeColors.freeformAccent}
										stroke={themeColors.freeformAccent}
										strokeWidth={2}
									/>
									<Circle
										x={-1.5}
										y={-3}
										radius={0.8}
										fill="white"
										opacity={0.7}
										listening={false}
									/>
									<Circle
										x={1.5}
										y={-3}
										radius={0.8}
										fill="white"
										opacity={0.7}
										listening={false}
									/>
									<Circle
										x={-1.5}
										y={0}
										radius={0.8}
										fill="white"
										opacity={0.7}
										listening={false}
									/>
									<Circle x={1.5} y={0} radius={0.8} fill="white" opacity={0.7} listening={false} />
									<Circle
										x={-1.5}
										y={3}
										radius={0.8}
										fill="white"
										opacity={0.7}
										listening={false}
									/>
									<Circle x={1.5} y={3} radius={0.8} fill="white" opacity={0.7} listening={false} />
								</Group>
							{/if}
						</Group>
					{/if}
				</Group>
			{/each}

			{#each freeformCrossovers as xover (xover.id)}
				{@const focused =
					!hasFocusedSegments ||
					(focusedSegments?.has(xover.fromSegment) && focusedSegments?.has(xover.toSegment))}
				<Line
					points={[
						xover.from.x,
						xover.from.y,
						xover.bulge.x,
						xover.bulge.y,
						xover.to.x,
						xover.to.y,
					]}
					stroke={xover.color}
					strokeWidth={2}
					opacity={focused ? (xover.constrained ? 1 : 0.55) : DIMMED_FATLINE_OPACITY}
					lineCap="round"
					lineJoin="round"
					tension={0.4}
					listening={false}
				/>
				{#if xover.constrained}
					<Circle
						x={xover.bulge.x}
						y={xover.bulge.y}
						radius={3.2}
						fill={themeColors.hxFill}
						stroke={xover.color}
						strokeWidth={1.5}
						opacity={focused ? 1 : DIMMED_FATLINE_OPACITY}
						listening={false}
					/>
					<Circle
						x={xover.bulge.x}
						y={xover.bulge.y}
						radius={0.8}
						fill={xover.color}
						opacity={focused ? 1 : DIMMED_FATLINE_OPACITY}
						listening={false}
					/>
				{/if}
			{/each}

			<!-- Active draw previews — rendered on top of helices and crossovers so they stay visible -->
			{#if activeLine}
				<Line
					points={[
						activeLine.startLayer.x,
						activeLine.startLayer.y,
						activeLine.currentLayer.x,
						activeLine.currentLayer.y,
					]}
					stroke={themeColors.freeformAccent}
					strokeWidth={2}
					dash={[6, 4]}
					listening={false}
				/>
			{/if}

			{#if activeConnection}
				<Line
					points={[
						activeConnection.start.x,
						activeConnection.start.y,
						activeConnection.current.x,
						activeConnection.current.y,
					]}
					stroke={themeColors.freeformAccent}
					strokeWidth={2}
					dash={[5, 4]}
					lineCap="round"
					listening={false}
				/>
				<Circle
					x={activeConnection.start.x}
					y={activeConnection.start.y}
					radius={4}
					fill={themeColors.hxFill}
					stroke={themeColors.freeformAccent}
					strokeWidth={2}
					listening={false}
				/>
			{/if}
		</Layer>
	</Stage>
</div>
