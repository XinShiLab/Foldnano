<script lang="ts">
	// Draws a Part that isn't being edited, see-through, once per visible instance. Its own effect
	// rebuilds only when that Part or its kept relaxed poses change; moving or hiding an instance
	// only re-places the shared copies.
	import * as THREE from 'three';
	import type { Part } from '$lib/model/Part';
	import type { Occurrence } from '$lib/model/Assembly';
	import type { BlockTransformOverride } from '$lib/model/rbs/rbsTypes';
	import { buildScene } from './helixGeometry';
	import { disposeGroup } from './threeUtils';
	import { CYLINDERS_NAME, LABELS_NAME, ghostifyGroup, instanceCopy } from './assemblyScene';

	interface Props {
		parent: THREE.Object3D;
		part: Part;
		occurrences: Occurrence[];
		/** The Part's kept relaxation result, drawn instead of the design's positions. */
		relaxed?: Map<string, BlockTransformOverride>;
		onChange: () => void;
	}

	let { parent, part, occurrences, relaxed, onChange }: Props = $props();

	let template = $state.raw<THREE.Group | null>(null);

	$effect(() => {
		const built = buildScene(part, false, undefined, null, null, relaxed);
		built.labels.name = LABELS_NAME;
		built.cylinders.name = CYLINDERS_NAME;
		ghostifyGroup(built.group);
		template = built.group;
		return () => disposeGroup(built.group);
	});

	$effect(() => {
		const source = template;
		if (!source) return;
		const copies = occurrences
			.filter((occurrence) => occurrence.visible)
			.map((occurrence) => instanceCopy(source, occurrence.transform, occurrence.id));
		for (const copy of copies) parent.add(copy);
		onChange();
		return () => {
			for (const copy of copies) parent.remove(copy);
			onChange();
		};
	});
</script>
