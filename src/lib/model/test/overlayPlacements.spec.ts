// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Part } from '$lib/model/Part';
import type { OverlayPlacement } from '$lib/model/Part/Part.svelte';

function T(x: number): OverlayPlacement['transform'] {
	return { position: { x, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] };
}

function makePart(): Part {
	return Part.forType('SQUARE', 'test');
}

describe('Part overlay placements', () => {
	it('upserts by id and lists by sourceKey', () => {
		const part = makePart();
		part.setOverlayPlacement('a1', '6J6J', T(1));
		part.setOverlayPlacement('a2', '6J6J', T(2));
		part.setOverlayPlacement('b1', '1ABC', T(3));

		expect(part.getOverlayPlacement('a1')?.transform.position.x).toBe(1);
		expect(
			part
				.getOverlayPlacementsForSource('6J6J')
				.map((p) => p.id)
				.sort()
		).toEqual(['a1', 'a2']);
		expect(part.getOverlayPlacementsForSource('1ABC')).toHaveLength(1);

		// Re-setting the same id replaces, not appends.
		part.setOverlayPlacement('a1', '6J6J', T(9));
		expect(part.getOverlayPlacement('a1')?.transform.position.x).toBe(9);
		expect(part.getOverlayPlacementsForSource('6J6J')).toHaveLength(2);
	});

	it('clears one instance by id', () => {
		const part = makePart();
		part.setOverlayPlacement('a1', '6J6J', T(1));
		part.setOverlayPlacement('a2', '6J6J', T(2));
		part.clearOverlayPlacement('a1');
		expect(part.getOverlayPlacement('a1')).toBeUndefined();
		expect(part.getOverlayPlacementsForSource('6J6J')).toHaveLength(1);
	});

	it('round-trips placements (with sourceKey) through toJSON/fromJSON', () => {
		const part = makePart();
		part.setOverlayPlacement('a1', '6J6J', T(1));
		part.setOverlayPlacement('a2', '6J6J', T(2));

		const restored = Part.fromJSON(part.toJSON());
		expect(restored.getOverlayPlacementsForSource('6J6J')).toHaveLength(2);
		expect(restored.getOverlayPlacement('a2')?.sourceKey).toBe('6J6J');
		expect(restored.getOverlayPlacement('a1')?.transform.position.x).toBe(1);
	});

	it('migrates legacy placements without sourceKey (defaults sourceKey to id)', () => {
		const part = makePart();
		const json = part.toJSON();
		// Pre-duplicate files stored one placement keyed by id, with no sourceKey.
		(json as { overlayPlacements?: unknown }).overlayPlacements = [{ id: '6J6J', transform: T(5) }];

		const restored = Part.fromJSON(json);
		expect(restored.getOverlayPlacement('6J6J')?.sourceKey).toBe('6J6J');
		expect(restored.getOverlayPlacementsForSource('6J6J')).toHaveLength(1);
	});

	it('omits overlayPlacements from toJSON when empty', () => {
		expect(makePart().toJSON().overlayPlacements).toBeUndefined();
	});
});
