import type Konva from 'konva';
import type { Camera } from '../services/cameraKonva';
import type { HitTester } from '../services/hitEventToModel';
import type { HistoryStack } from '$lib/commands/history.svelte';
import type { Part } from '$lib/model/Part';
import type { DrawingDimensions } from '../../components/Editor/StrandView/drawingDimensions';
import type { EditorViewContext } from '../../components/Editor/context/EditorViewContext.svelte';

export type ViewKind = 'ROUTING' | 'LATTICE';
export type ViewportId = string;

export interface ViewContext {
	id: ViewportId;
	kind: ViewKind;
	part: Part;
	drawingDimensions: DrawingDimensions;
	camera: Camera;
	hit: HitTester;
	overlay: Konva.Layer;
	strandCtx: EditorViewContext['strandViewContext'];
	history: HistoryStack;
	editorCtx: EditorViewContext;
	// getSelectFilter?: () => ReadonlySet<LeafTarget | Category>; // <- optional, only SELECT uses it
	// selectFilter: SelectionToggle[]
	// contextMenu: ContextMenuState;
}
