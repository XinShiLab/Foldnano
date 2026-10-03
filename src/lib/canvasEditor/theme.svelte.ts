import { browser } from '$app/environment';

const lightColors = {
	gridLine: 'oklch(92.9% 0.013 255.508)',
	vhFill: 'oklch(95.4% 0.038 75.164)',
	vhStroke: 'oklch(66.6% 0.179 58.318)',
	vhText: 'oklch(37.3% 0.034 259.733)',
	csCursorFill: 'oklch(95.4% 0.038 75.164)',
	csCursorStroke: 'oklch(66.6% 0.179 58.318)',
	csCursorText: 'oklch(50.5% 0.213 27.518)',
	hxStroke: 'oklch(86.9% 0.022 252.894)',
	hxFill: 'oklch(96.8% 0.007 247.896)',
	hxVhFill: '#ffe7b2',
	hxOccupiedVhFill: '#fdc695',
	hxVhStroke: '#ea8451',
	hxHoverFill: '#99ccff',
	hxHoverStroke: '#0066cc',
	hxScafIndicator: '#c897b4',
	hxText: 'black',
	freeformDragColor: '#2563eb',
	freeformAccent: '#f59e0b',
};

const darkColors = {
	gridLine: 'oklch(25% 0.013 255.508)',
	vhFill: 'oklch(20% 0.038 75.164)',
	vhStroke: 'oklch(50% 0.179 58.318)',
	vhText: 'oklch(85% 0.034 259.733)',
	csCursorFill: 'oklch(20% 0.038 75.164)',
	csCursorStroke: 'oklch(50% 0.179 58.318)',
	csCursorText: 'oklch(70% 0.213 27.518)',
	hxStroke: 'oklch(30% 0.022 252.894)',
	hxFill: 'oklch(15% 0.007 247.896)',
	hxVhFill: '#3a2e10',
	hxOccupiedVhFill: '#4a2a10',
	hxVhStroke: '#c06030',
	hxHoverFill: '#1a4a7a',
	hxHoverStroke: '#4499ee',
	hxScafIndicator: '#a06090',
	hxText: 'white',
	freeformDragColor: '#60a5fa',
	freeformAccent: '#fbbf24',
};

class CanvasTheme {
	isDark = $state(false);

	constructor() {
		if (browser) {
			this.isDark = document.documentElement.classList.contains('dark');
			new MutationObserver(() => {
				this.isDark = document.documentElement.classList.contains('dark');
			}).observe(document.documentElement, { attributeFilter: ['class'] });
		}
	}

	get colors() {
		return this.isDark ? darkColors : lightColors;
	}
}

export const canvasTheme = new CanvasTheme();
