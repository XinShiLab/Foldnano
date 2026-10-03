import { describe, expect, it } from 'vitest';
import FreeformViewer from './HelixView/FreeformViewer.svelte';
import StrandViewer from './StrandView/StrandViewer.svelte';
import View3D from './View3D/View3D.svelte';

describe('Round 2 component compile smoke', () => {
	it('imports the touched viewer components', () => {
		expect(FreeformViewer).toBeTruthy();
		expect(StrandViewer).toBeTruthy();
		expect(View3D).toBeTruthy();
	});
});
