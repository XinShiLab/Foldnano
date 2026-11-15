import type { ToolBehavior, PointerEvt } from '../index';
import type { EditorMode } from '$lib/canvasEditor/core/modes';
import type { ViewContext } from '$lib/canvasEditor/core/views';

// Plugin-made oligos all start with `py-oligo-`; the uuid after it is what tells them apart.
const PLUGIN_OLIGO_PREFIX = 'py-oligo-';

export function shortOligoId(id: string): string {
	const start = id.startsWith(PLUGIN_OLIGO_PREFIX) ? PLUGIN_OLIGO_PREFIX.length : 0;
	return id.slice(start, start + 6);
}

/** Status-bar text for a base under the pointer, shared by the strand view and the 3D view. */
export function formatHoverFootnote(info: {
	vhIndex: number;
	bp: number;
	oligoId?: string | null;
	slotSeq?: string | null;
}): string {
	let text = `VH ${info.vhIndex} · BP ${info.bp}`;
	if (info.oligoId) text += ` · Oligo ${shortOligoId(info.oligoId)}`;
	const seq = info.slotSeq;
	if (seq && seq.length > 2 && !/^N+$/.test(seq)) text += ` · Insert ${seq}`;
	return text;
}

export function createHoverInfoBehavior(modes: Set<EditorMode>): ToolBehavior {
	return {
		name: 'HoverInfoBehavior',
		appliesTo(mode) {
			return modes.has(mode);
		},
		onPointer(evt: PointerEvt, ctx: ViewContext) {
			if (evt.type !== 'move') return;
			const world = ctx.camera.toWorld(evt.clientX, evt.clientY);
			const hitRsp = ctx.hit.hitRsp(world);
			if (hitRsp) {
				const vh = ctx.drawingDimensions.getVisibleVhByDisplayRow(hitRsp.rowIdx);
				if (!vh) {
					ctx.strandCtx.footnote = '';
					return;
				}
				const targets = ctx.part.getEntitiesAtVh(vh.id, hitRsp.strandIdx, hitRsp.bpIdx);
				const vhIdx = targets.vh?.index ?? null;
				if (vhIdx !== null) {
					ctx.strandCtx.footnote = formatHoverFootnote({
						vhIndex: vhIdx,
						bp: hitRsp.bpIdx,
						oligoId: targets.oligo?.id,
						slotSeq: targets.segment?.slotForBp(hitRsp.bpIdx)?.seq,
					});
				}
				return;
			}
			// clear when no hit
			ctx.strandCtx.footnote = '';
		},
	};
}
