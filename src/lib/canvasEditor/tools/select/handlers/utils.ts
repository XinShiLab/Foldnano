import type { WorldPt, WorldRect } from '../../types';

export function rectFrom(a: WorldPt, b: WorldPt): WorldRect {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function parseEndSelectId(
	id: string
): { segmentId: string; isThreePrime: boolean; isFree: boolean } | null {
	const match = id.match(/^(.+?)#(3|5)#(FREE|CONN)$/);
	if (!match) return null;
	return {
		segmentId: match[1],
		isThreePrime: match[2] === '3',
		isFree: match[3] === 'FREE',
	};
}
