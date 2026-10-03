export const PLANE_COLORS = [0x3388ff, 0x33cc44, 0xff9900, 0xcc33ff, 0xff3333];

export function getPlaneColor(index: number): number {
	return PLANE_COLORS[((index % PLANE_COLORS.length) + PLANE_COLORS.length) % PLANE_COLORS.length];
}

export function planeColorAsCss(color: number): string {
	return `#${color.toString(16).padStart(6, '0')}`;
}
