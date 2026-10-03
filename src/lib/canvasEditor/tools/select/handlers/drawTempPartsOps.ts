import type { TemporalPartInfo } from '$lib/components/Editor/context/types';
import type { ViewContext } from '../../../core/views';

export function clearAllTempParts(ctx: ViewContext) {
	ctx.strandCtx.tempParts.splice(0, ctx.strandCtx.tempParts.length);
}

export function replaceTempParts(ctx: ViewContext, tempParts: TemporalPartInfo[]) {
	ctx.strandCtx.tempParts.splice(0, ctx.strandCtx.tempParts.length, ...tempParts);
}

export function addTempParts(ctx: ViewContext, tempPartsToAdd: TemporalPartInfo[]) {
	ctx.strandCtx.tempParts.push(...tempPartsToAdd);
}

export function removeTempPartsByType(ctx: ViewContext, type: TemporalPartInfo['type']) {
	for (let i = ctx.strandCtx.tempParts.length - 1; i >= 0; i--) {
		if (ctx.strandCtx.tempParts[i].type === type) {
			ctx.strandCtx.tempParts.splice(i, 1);
		}
	}
}
