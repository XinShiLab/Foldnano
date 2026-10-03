/*
	Installed from @ieedan/shadcn-svelte-extras
*/

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

export function expandRect(r: { x: number; y: number; width: number; height: number }, by: number) {
	return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

/**
 * Check if two rectangles intersect
 */
export function rectsIntersect(
	r1: { x: number; y: number; width: number; height: number },
	r2: { x: number; y: number; width: number; height: number }
): boolean {
	return !(
		r1.x + r1.width < r2.x ||
		r2.x + r2.width < r1.x ||
		r1.y + r1.height < r2.y ||
		r2.y + r2.height < r1.y
	);
}
