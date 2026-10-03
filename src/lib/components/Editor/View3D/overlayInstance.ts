import type { ExternalStructureOverlay } from './externalStructureOverlay';
import type { OverlayTransform } from './overlayTransform';

/**
 * One placed copy of an external-structure overlay. The parsed `data` is shared
 * between duplicates of the same file; everything else is per-instance. Only PDB
 * instances persist (`sourceKey` non-empty); mrDNA instances are session-only.
 */
export interface OverlayInstance {
	/** Unique per instance. */
	id: string;
	/** pdbId ?? filename; `''` for mrDNA (never persisted). */
	sourceKey: string;
	data: ExternalStructureOverlay;
	transform: OverlayTransform;
	ghost: boolean;
	visible: boolean;
}
