import type { EditorMode } from '../core/modes';
import type { ViewContext } from '../core/views';
import { reportError } from '$lib/errorReporting';

function handleToolError(err: unknown): void {
	reportError(err, 'tool');
}

export type PointerEvt = {
	directTargetId?: string | null;
	type: PointerEventType;
	button?: number;
	altKey: boolean;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	clientX: number;
	clientY: number;
};

export type PointerEventType = 'down' | 'move' | 'up' | 'cancel' | 'contextmenu';

export interface Tool {
	name: EditorMode;
	onEnter?(ctx: ViewContext): void;
	onExit?(ctx: ViewContext): void;
	onPointer?(evt: PointerEvt, ctx: ViewContext): void;
	onKey?(e: KeyboardEvent, ctx: ViewContext): void;
}

// New: behavior plugin interface
export interface ToolBehavior {
	name: string;
	appliesTo?(mode: EditorMode): boolean; // if omitted, applies to all modes
	onPointer?(evt: PointerEvt, ctx: ViewContext, activeTool: Tool): void;
	onKey?(e: KeyboardEvent, ctx: ViewContext, activeTool: Tool): void;
}

export class ToolController {
	private active: Tool;
	private registry: Map<EditorMode, Tool>;
	private ctx: ViewContext;
	private getMode: () => EditorMode;
	// New: behaviors
	private behaviors: ToolBehavior[];
	private suspended = false;

	constructor(
		tools: Tool[],
		ctx: ViewContext,
		getMode: () => EditorMode,
		behaviors: ToolBehavior[] = []
	) {
		this.registry = new Map(tools.map((t) => [t.name, t]));
		this.active = this.require(getMode());
		this.active.onEnter?.(ctx);
		this.ctx = ctx;
		this.getMode = getMode;
		this.behaviors = behaviors; // store behaviors
	}

	/** get required tool for the mode */
	private require(m: EditorMode) {
		const t = this.registry.get(m);
		if (!t) throw new Error(`No tool for ${m}`);
		return t;
	}

	setMode(m: EditorMode) {
		if (m === this.active.name) return;
		this.active.onExit?.(this.ctx);
		this.active = this.require(m);
		this.active.onEnter?.(this.ctx);
	}

	syncMode(m: EditorMode) {
		const next = this.registry.get(m);
		if (!next) {
			if (!this.suspended) {
				this.active.onExit?.(this.ctx);
				this.suspended = true;
			}
			return;
		}

		if (this.suspended) {
			this.active = next;
			this.suspended = false;
			this.active.onEnter?.(this.ctx);
			return;
		}

		this.setMode(m);
	}

	handlePointer(e: PointerEvt) {
		try {
			const m = this.getMode();
			this.syncMode(m);
			if (this.suspended) return;
			for (const b of this.behaviors) {
				if (!b.appliesTo || b.appliesTo(m)) {
					b.onPointer?.(e, this.ctx, this.active);
				}
			}
			this.active.onPointer?.(e, this.ctx);
		} catch (err) {
			handleToolError(err);
		}
	}

	handleKey(e: KeyboardEvent) {
		try {
			if (this.suspended) return;
			for (const b of this.behaviors) {
				if (!b.appliesTo || b.appliesTo(this.active.name)) {
					b.onKey?.(e, this.ctx, this.active);
				}
			}
			this.active.onKey?.(e, this.ctx);
		} catch (err) {
			handleToolError(err);
		}
	}
}
