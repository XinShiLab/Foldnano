import { describe, expect, it, vi } from 'vitest';
import { ToolController, type Tool } from '.';
import type { EditorMode } from '../core/modes';
import type { ViewContext } from '../core/views';

describe('ToolController', () => {
	it('starts suspended in a mode without a tool (Pan) and wakes on a mode with one', () => {
		const onEnter = vi.fn();
		const onPointer = vi.fn();
		const select: Tool = { name: 'SELECT', onEnter, onPointer };
		let mode: EditorMode = 'PAN';
		const controller = new ToolController([select], {} as ViewContext, () => mode);
		expect(onEnter).not.toHaveBeenCalled();

		const evt = {
			type: 'down',
			altKey: false,
			shiftKey: false,
			ctrlKey: false,
			metaKey: false,
			clientX: 0,
			clientY: 0,
		} as const;
		controller.handlePointer(evt);
		expect(onPointer).not.toHaveBeenCalled();

		mode = 'SELECT';
		controller.handlePointer(evt);
		expect(onEnter).toHaveBeenCalledTimes(1);
		expect(onPointer).toHaveBeenCalledTimes(1);
	});
});
