import type { EditorMode } from '../../../canvasEditor/core/modes';
import type { ModificationDef } from '../../../model/modifications';

import type { SelectedEndBoxProps } from '../StrandView/temporalLayer/SelectedEndBox.svelte';
import type { MoveEndBoxProps } from '../StrandView/temporalLayer/MoveEndBox.svelte';
import type { MarqueeProps } from '../StrandView/temporalLayer/Marquee.svelte';
import type { ConnectionInProgressProps } from '../StrandView/temporalLayer/ConnectionInProgress.svelte';
import type { OligoSegmentProps } from '../StrandView/OligoSegment.svelte';
import type { CrossoverProps } from '../StrandView/crossover/Crossover.svelte';
import type { VhDragPreviewProps } from '../StrandView/temporalLayer/VhDragPreview.svelte';

export type EditorModeContext = {
	tool: EditorMode;
};

export type SelectionToggle = 'SCAF' | 'STAP' | 'END' | 'XOVER' | 'SEGMENT' | 'OLIGO' | 'VH_TAG';

export type TemporalPartInfo =
	| { type: 'SelectedEndBox'; props: SelectedEndBoxProps }
	| { type: 'MoveEndBox'; props: MoveEndBoxProps }
	| { type: 'Marquee'; props: MarqueeProps }
	| { type: 'Connecting'; props: ConnectionInProgressProps }
	| { type: 'OligoSegment'; props: OligoSegmentProps }
	| { type: 'Crossover'; props: CrossoverProps }
	| { type: 'VhDragPreview'; props: VhDragPreviewProps };

export type CanHighlight =
	| 'scaffold'
	| 'circular_strand'
	// | 'free_end'
	| 'modification_site'
	| 'longer_than_90'
	| 'shorter_than_15';

export type CanWarn = 'mismatch';

export type CanHide = 'crossovers' | 'connections' | 'sequence';

export type ColorContext = {
	currentColor: string;
	savedColors: string[];
};

export type SequenceContext = {
	mode: 'RANDOM' | 'SEQ' | 'REMOVE';
	gcContent: number;
	sequence: string;
	fillType: 'WHOLE' | 'ONLY_EMPTY';
	fillResults: {
		leftover: string;
		missing: number;
	}[];
};

export type ContextMenuItem = {
	label?: string;
	action?: () => void;
	disabled?: boolean;
	separator?: boolean;
};

export type ContextMenuInfo = {
	x: number;
	y: number;
	targetId: string;
	targetKind: string;
	visible: boolean;
	items: ContextMenuItem[];
};

export type SelectAllMode = 'NONE' | 'SAME_COLOR' | 'SAME_MODI' | 'SAME_LENGTH';

export type ModificationContext = {
	currentModification: ModificationDef | null;
	builtinModifications: ModificationDef[];
};

export interface SkipInsertContext {
	applyToAllVh: boolean;
}
