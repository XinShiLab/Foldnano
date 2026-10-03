import type Konva from 'konva';
import type { Camera } from '../services/cameraKonva';
import type { HitTester } from '../services/hitEventToModel';
// import type { Selection } from '../services/selection';
// import type { Tx } from '../services/tx';
// import type { Category, LeafTarget } from './modes';
import type { HistoryStack } from '$lib/commands/history.svelte';
// import type { ColorContext, TemporalPartInfo } from '$lib/components/Editor/context/types';
import type { Part } from '$lib/model/Part';
import type { DrawingDimensions } from '../../components/Editor/StrandView/drawingDimensions';
// import type { CSCursor, Footnote } from '../../components/Editor/context';
// import type Editor from '../../components/Editor/Editor.svelte';
import type { EditorViewContext } from '../../components/Editor/context/EditorViewContext.svelte';

export type ViewKind = 'ROUTING' | 'LATTICE';
export type ViewportId = string;

// export type ContextMenuState = {
//   visible: boolean;
//   x: number;
//   y: number;
//   targetId: string | null;
//   targetKind: string | null;
//   items: ContextMenuItem[];
// };

export interface ViewContext {
	id: ViewportId;
	kind: ViewKind;
	part: Part;
	drawingDimensions: DrawingDimensions;
	camera: Camera;
	hit: HitTester;
	overlay: Konva.Layer;
	strandCtx: EditorViewContext['strandViewContext'];
	// tempParts: TemporalPartInfo[];
	// csCursor: CSCursor;
	// activeAround: {rowIdx: number, bpIdx: number};
	// footnote: Footnote;
	// colorContext: ColorContext;
	// selection: Selection;
	// tx: Tx;
	history: HistoryStack;
	editorCtx: EditorViewContext;
	// getSelectFilter?: () => ReadonlySet<LeafTarget | Category>; // <- optional, only SELECT uses it
	// selectFilter: SelectionToggle[]
	// contextMenu: ContextMenuState;
}
