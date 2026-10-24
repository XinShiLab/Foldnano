import { checkFoldnanoPartJsonShape } from '$lib/model/checks/shape/foldnanoJsonShape';
import { checkResultArtifact } from './result-format-validation';
import type { PartJSON } from './result-replacement-operations';

/** Shape/internal-consistency check for a plugin's raw `foldnano_json` result, before reconstruction. */
export function validateResultShape(primaryArtifact: string | null, pluginId: string): PartJSON {
	return checkResultArtifact(primaryArtifact, pluginId, checkFoldnanoPartJsonShape);
}
