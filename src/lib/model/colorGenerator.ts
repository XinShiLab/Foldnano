import { formatHex, oklch } from 'culori';

export function generateOKLCHPalette(count: number): string[] {
	const colors: string[] = [];
	const lightness = 0.7; // perceptually uniform brightness
	const chroma = 0.25; // between 0.05 and 0.25
	const randomHueOffset = Math.floor(Math.random() * ((360 / 2) * count)); // random offset for hue
	for (let i = 0; i < count; i++) {
		// const hue = (i * 360) / count; // evenly spaced hue angles
		const hue = randomHueOffset + (i * 360) / count; // add slight randomness to hue
		const color = oklch({ mode: 'oklch', l: lightness, c: chroma, h: hue });
		colors.push(formatHex(color));
	}

	return colors;
}

export function generateRandomOKLCHColor(): string {
	const lightness = 0.7; // perceptually uniform brightness
	const chroma = Math.random() * 0.2 + 0.05; // between 0.05 and 0.25
	const hue = Math.random() * 360; // full hue range

	const color = oklch({ mode: 'oklch', l: lightness, c: chroma, h: hue });
	return formatHex(color);
}

// Example usage:
// console.log(generateOKLCHPalette(20));
