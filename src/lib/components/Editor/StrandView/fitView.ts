export interface ContentBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface FitOptions {
	/** Screen-pixel margin kept around the content. */
	paddingPx: number;
	minScale: number;
	maxScale: number;
}

export interface StageTransform {
	scale: number;
	x: number;
	y: number;
}

/** Stage scale and position that centre `content` in the viewport, fitted within the scale bounds. */
export function fitTransform(
	content: ContentBounds,
	viewport: { width: number; height: number },
	opts: FitOptions
): StageTransform {
	const w = Math.max(content.maxX - content.minX, 1);
	const h = Math.max(content.maxY - content.minY, 1);
	const fitW = Math.max(viewport.width - 2 * opts.paddingPx, 1) / w;
	const fitH = Math.max(viewport.height - 2 * opts.paddingPx, 1) / h;
	const scale = Math.min(Math.max(Math.min(fitW, fitH), opts.minScale), opts.maxScale);
	return {
		scale,
		x: viewport.width / 2 - ((content.minX + content.maxX) / 2) * scale,
		y: viewport.height / 2 - ((content.minY + content.maxY) / 2) * scale,
	};
}

/** Union of boxes, or null for none. */
export function unionBounds(boxes: Iterable<ContentBounds>): ContentBounds | null {
	let out: ContentBounds | null = null;
	for (const b of boxes) {
		out = out
			? {
					minX: Math.min(out.minX, b.minX),
					minY: Math.min(out.minY, b.minY),
					maxX: Math.max(out.maxX, b.maxX),
					maxY: Math.max(out.maxY, b.maxY),
				}
			: { ...b };
	}
	return out;
}
