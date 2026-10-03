import { createContext } from 'svelte';
import type { DrawingDimensions } from './drawingDimensions';

export const [getDimensionContext, setDimensionContext] = createContext<DrawingDimensions>();

/** Opacity of mirror oligos (derived repeat copies) in the strand view. */
export const MIRROR_OPACITY = 0.4;
