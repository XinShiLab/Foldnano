import {
	removeOligoCmd,
	removeSegmentFromOligoCmd,
	toggleOligoAsScaffoldCmd,
} from '$lib/commands/strands';
import { InvalidOperationError } from '$lib/errors';
import type { EditorMode } from '$lib/canvasEditor/core/modes';
import type { ViewContext } from '$lib/canvasEditor/core/views';
import type { PointerEvt, ToolBehavior } from '../index';

/**
 * Context menu behavior that works across all tools.
 * Handles right-click events and shows appropriate menu based on what was clicked.
 */
export function createContextMenuBehavior(modes?: Set<EditorMode>): ToolBehavior {
	return {
		name: 'ContextMenuBehavior',

		appliesTo(mode) {
			// If modes specified, only apply to those modes
			// Otherwise apply to all modes
			return modes ? modes.has(mode) : true;
		},

		onPointer(evt: PointerEvt, ctx: ViewContext) {
			if (evt.type !== 'contextmenu') return;

			// Get what was clicked using hit testing
			const world = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const hits = ctx.hit.hitAt(world, evt.directTargetId);

			if (hits.length === 0) {
				// Right-click on empty space
				showEmptyContextMenu(evt, ctx);
				return;
			}

			// Prioritize SEGMENT and OLIGO hits
			const segmentHit = hits.find((h) => h.kind === 'SEGMENT');
			const oligoHit = hits.find((h) => h.kind === 'OLIGO');

			if (segmentHit && segmentHit.id) {
				showSegmentContextMenu(evt, ctx, segmentHit.id);
			} else if (oligoHit && oligoHit.id) {
				showOligoContextMenu(evt, ctx, oligoHit.id);
			} else {
				// For other types, show empty menu
				showEmptyContextMenu(evt, ctx);
			}
		},
	};
}

function showSegmentContextMenu(evt: PointerEvt, ctx: ViewContext, segmentId: string) {
	const segment = ctx.part.getSegmentById(segmentId);
	if (!segment) return;

	const oligo = segment.oligo;

	const contextMenuItemForOligo = oligo
		? [
				{
					label: oligo.isScaffold ? 'Set as Staple' : 'Set as Scaffold',
					action: () => {
						toggleOligoAsScaffoldCmd({ oligo }, ctx.history);
						ctx.strandCtx.contextMenu.visible = false;
					},
				},
				{
					label: 'Delete Oligo',
					action: () => {
						removeOligoCmd({ part: ctx.part, oligo }, ctx.history);
						ctx.strandCtx.selected.clear();
						ctx.strandCtx.contextMenu.visible = false;
					},
				},
			]
		: [];

	// Set up context menu
	ctx.strandCtx.contextMenu.visible = true;
	ctx.strandCtx.contextMenu.x = evt.clientX;
	ctx.strandCtx.contextMenu.y = evt.clientY;
	ctx.strandCtx.contextMenu.targetId = segmentId;
	ctx.strandCtx.contextMenu.targetKind = 'SEGMENT';
	ctx.strandCtx.contextMenu.items = [
		...contextMenuItemForOligo,
		{
			label: 'Delete Segment',
			action: () => {
				if (!segment.oligo) {
					throw new InvalidOperationError('Segment has no oligo associated');
				}
				removeSegmentFromOligoCmd({ part: ctx.part, oligo: segment.oligo, segment }, ctx.history);
				ctx.strandCtx.selected.clear();
				ctx.strandCtx.contextMenu.visible = false;
			},
		},
		{
			label: 'Copy Segment Sequence',
			action: () => {
				const sequence = segment.sequence || 'No sequence';
				navigator.clipboard.writeText(sequence);
				ctx.strandCtx.contextMenu.visible = false;
			},
			disabled: !segment.sequence,
		},
		{ separator: true },
		{
			label: 'Properties',
			action: () => {
				ctx.strandCtx.contextMenu.visible = false;
			},
		},
	];
}

function showOligoContextMenu(evt: PointerEvt, ctx: ViewContext, oligoId: string) {
	const oligo = ctx.part.getOligoById(oligoId);
	if (!oligo) return;

	// Set up context menu
	ctx.strandCtx.contextMenu.visible = true;
	ctx.strandCtx.contextMenu.x = evt.clientX;
	ctx.strandCtx.contextMenu.y = evt.clientY;
	ctx.strandCtx.contextMenu.targetId = oligoId;
	ctx.strandCtx.contextMenu.targetKind = 'OLIGO';
	ctx.strandCtx.contextMenu.items = [
		{
			label: oligo.isScaffold ? 'Set as Staple' : 'Set as Scaffold',
			action: () => {
				toggleOligoAsScaffoldCmd({ oligo }, ctx.history);
				ctx.strandCtx.contextMenu.visible = false;
			},
		},
		{
			label: 'Delete Oligo',
			action: () => {
				removeOligoCmd({ part: ctx.part, oligo }, ctx.history);
				ctx.strandCtx.selected.clear();
				ctx.strandCtx.contextMenu.visible = false;
			},
		},
		{
			label: 'Copy Oligo Sequence',
			action: () => {
				const sequence = oligo.sequence || 'No sequence';
				navigator.clipboard.writeText(sequence);
				ctx.strandCtx.contextMenu.visible = false;
			},
			disabled: !oligo.sequence,
		},
		{ separator: true },
		{
			label: 'Properties',
			action: () => {
				ctx.strandCtx.contextMenu.visible = false;
			},
		},
	];
}

function showEmptyContextMenu(evt: PointerEvt, ctx: ViewContext) {
	// Set up context menu for empty space
	ctx.strandCtx.contextMenu.visible = true;
	ctx.strandCtx.contextMenu.x = evt.clientX;
	ctx.strandCtx.contextMenu.y = evt.clientY;
	ctx.strandCtx.contextMenu.targetId = '';
	ctx.strandCtx.contextMenu.targetKind = 'EMPTY';
	ctx.strandCtx.contextMenu.items = [
		{
			label: 'Paste',
			action: () => {
				ctx.strandCtx.contextMenu.visible = false;
			},
			disabled: true, // Enable when paste functionality is implemented
		},
		{ separator: true },
		{
			label: 'Export as SVG',
			action: () => {
				ctx.strandCtx.contextMenu.visible = false;
			},
		},
		{ separator: true },
		{
			label: 'Properties',
			action: () => {
				ctx.strandCtx.contextMenu.visible = false;
			},
		},
	];
}
