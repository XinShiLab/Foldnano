<script lang="ts">
	import {
		Hand,
		MousePointer2,
		PencilLine,
		Scissors,
		MapPinPlusInside,
		Paintbrush,
		SquareX,
		TableRowsSplit,
	} from '@lucide/svelte/icons';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import type { EditorMode } from '$lib/canvasEditor/core/modes';
	import ModificationIcon from '$lib/components/icons/ModificationIcon.svelte';
	import AT from '$lib/components/icons/AT.svelte';
	import { help } from '$lib/components/help/help';
	import { MODE_TUTORIAL_INFO } from '$lib/components/docs/tutorial/tutorialData';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';
	import type { ToggleSize } from '$lib/components/ui/toggle';
	import { panKeySymbol } from '$lib/utils/platform';

	interface Props {
		modes: EditorMode[];
		buttonSize?: ToggleSize;
		value?: EditorMode;
		onModeChange?: (mode: EditorMode) => void;
		getTutorialId?: (mode: EditorMode) => string | undefined;
		activeTutorialId?: string | null;
	}

	let {
		modes,
		buttonSize = 'sm',
		value = $bindable<EditorMode | undefined>(),
		onModeChange,
		getTutorialId,
		activeTutorialId = null,
	}: Props = $props();

	const ctx = getEditorViewContext();
	const isReadOnly = $derived(!ctx.isTabOwner);

	const shortcutByMode: Record<EditorMode, string> = {
		PAN: panKeySymbol(),
		SELECT: 'v',
		DRAW: 'n',
		BREAK: 'b',
		SKIP: 's',
		INSERT: 'i',
		PAINT: 'p',
		MODIFICATION: 'm',
		SEQUENCE: 'a',
		SPLIT_REGION: 'r',
		DUPLICATE: '⌘D',
	};

	const titleByMode: Record<EditorMode, string> = {
		PAN: 'Pan',
		SELECT: 'Select',
		DRAW: 'Draw strands',
		BREAK: 'Break strand',
		SKIP: 'Skip bases',
		INSERT: 'Insert bases',
		PAINT: 'Paint oligo',
		MODIFICATION: 'Apply modification',
		SEQUENCE: 'Assign sequence',
		SPLIT_REGION: 'Split region',
		DUPLICATE: 'Place duplicate',
	};

	function setMode(nextMode: string | undefined) {
		if (!nextMode) return;
		const mode = nextMode as EditorMode;
		ctx.editorMode = mode;
		onModeChange?.(mode);
	}
</script>

<div class="shrink-0">
	<ToggleGroup.Root
		type="single"
		variant="outline"
		size={buttonSize}
		bind:value={() => value ?? ctx.editorMode, setMode}
		class="shrink-0"
	>
		{#each modes as mode (mode)}
			{@const tutorialId = getTutorialId?.(mode)}
			<ToggleGroup.Item
				value={mode}
				title={titleByMode[mode]}
				disabled={mode !== 'PAN' && isReadOnly}
				data-tutorial-id={tutorialId}
				class={activeTutorialId === tutorialId
					? 'relative z-20 outline-2 outline-offset-2 outline-primary'
					: tutorialId
						? 'relative'
						: ''}
				{@attach help({
					key: shortcutByMode[mode],
					title: titleByMode[mode],
					text: MODE_TUTORIAL_INFO[mode].purpose,
					doc: 'editing-tools',
				})}
			>
				{#if mode === 'PAN'}
					<Hand />
				{:else if mode === 'SELECT'}
					<MousePointer2 />
				{:else if mode === 'DRAW'}
					<PencilLine />
				{:else if mode === 'BREAK'}
					<Scissors />
				{:else if mode === 'SKIP'}
					<SquareX />
				{:else if mode === 'INSERT'}
					<MapPinPlusInside />
				{:else if mode === 'PAINT'}
					<Paintbrush />
				{:else if mode === 'MODIFICATION'}
					<ModificationIcon />
				{:else if mode === 'SEQUENCE'}
					<AT />
				{:else if mode === 'SPLIT_REGION'}
					<TableRowsSplit />
				{/if}
			</ToggleGroup.Item>
		{/each}
	</ToggleGroup.Root>
</div>
