export type ModificationDef = {
	name: string;
	color: string;
};

export const BUILTIN_MODIFICATIONS: ModificationDef[] = [
	{ name: 'Thiol', color: '#6b7280' },
	{ name: 'Biotin', color: '#d97706' },
	{ name: 'Cy3', color: '#16a34a' },
	{ name: 'Cy5', color: '#dc2626' },
];

function hslToHex(h: number, s: number, l: number): string {
	l /= 100;
	const a = (s * Math.min(l, 1 - l)) / 100;
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const color = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(255 * color)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

/** Deterministic fallback color for a modification name with no assigned color
 * (legacy documents predating the color field, or a dangling `end.modification`
 * whose custom-modification entry was later deleted). */
export function hashNameToColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash * 31 + name.charCodeAt(i)) | 0;
	}
	const hue = Math.abs(hash) % 360;
	return hslToHex(hue, 65, 45);
}

export function truncateModificationName(name: string, maxLen = 7): string {
	return name.length > maxLen ? `${name.slice(0, maxLen - 1)}…` : name;
}

/**
 * Look up the display color for a modification name.
 * Checks builtins first, then optional custom list, falls back to a
 * deterministic hash of the name.
 */
export function getModificationColor(name: string, customs?: ModificationDef[]): string {
	const builtin = BUILTIN_MODIFICATIONS.find((m) => m.name === name);
	if (builtin) return builtin.color;
	if (customs) {
		const custom = customs.find((m) => m.name === name);
		if (custom?.color) return custom.color;
	}
	return hashNameToColor(name);
}
