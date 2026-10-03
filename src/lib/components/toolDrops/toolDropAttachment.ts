// src/lib/kbd-overlay.ts by Gemini
import type { Attachment } from 'svelte/attachments';
import { mount, type Component, unmount, type ComponentProps } from 'svelte';

/**
 * Creates an attachment that mounts a ColorPicker Svelte component
 * over the attached element when isVisible is true.
 * * @param initialColor The initial color value (e.g., '#ff0000').
 * @param isVisible Global state controlling overlay visibility ($state<boolean>).
 * @returns An Attachment function.
 */
export function toolDrop<TComponent extends Component>(
	ToolComponent: TComponent,
	isVisible: boolean,
	props?: ComponentProps<TComponent>
): Attachment<HTMLElement> {
	// The Attachment factory returns a function that takes the attached element
	return (element: HTMLElement) => {
		let colorPickerHost: HTMLDivElement | null = null as HTMLDivElement | null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let colorPickerComponent: any = null;

		// The logic inside the attachment runs when the element mounts and whenever
		// a dependency (like isVisible) changes.
		if (isVisible) {
			// 1. Create a HOST element for the Svelte component
			colorPickerHost = document.createElement('div');

			// Set styles for fixed positioning
			Object.assign(colorPickerHost.style, {
				position: 'fixed',
				zIndex: '10002',
				pointerEvents: 'auto',
				// Temporarily hide until position is calculated
				visibility: 'hidden',
			});

			// 2. Calculate Position
			const rect = element.getBoundingClientRect();

			// Position near the bottom-left corner of the button
			const top = rect.bottom;
			const left = rect.left;

			Object.assign(colorPickerHost.style, {
				top: `${top}px`,
				left: `${left}px`,
				// Shift to position the ColorPicker element slightly below and to the left of the button's bottom-left corner
				transform: 'translate(0, 8px)',
				visibility: 'visible',
			});

			// 3. Mount the Svelte Component
			colorPickerComponent = mount(ToolComponent, {
				target: colorPickerHost,
				props: props, // Example prop; adjust as needed
			});

			// Append the host to the document body to use fixed positioning relative to the viewport
			document.body.appendChild(colorPickerHost);
		} else {
			// Clean up: unmount the component and remove the host element
			if (colorPickerComponent) {
				unmount(colorPickerComponent);
				colorPickerComponent = null;
			}
			colorPickerHost?.remove();
			colorPickerHost = null;
		}
		// The final cleanup function runs when the attached element is unmounted
		return () => {
			if (colorPickerComponent) unmount(colorPickerComponent);
			colorPickerHost?.remove();
		};
	};
}
