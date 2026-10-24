import type { VStrandJSON } from '$lib/model/io/cadnanoJSON';
import { checkCadnanoJsonShape } from '$lib/model/checks/shape/cadnanoJsonShape';
import { checkResultArtifact } from './result-format-validation';

export interface CadnanoResultData {
	name: string;
	vstrands: VStrandJSON[];
	/** Non-fatal repairs made during validation (e.g. a one-sided pointer discarded as a free end). */
	warnings: string[];
}

/** Shape/internal-consistency check for a plugin's raw `cadnano_json` result, before reconstruction. */
export function validateResultShape(
	primaryArtifact: string | null,
	pluginId: string
): CadnanoResultData {
	const { name, vstrands, issues } = checkResultArtifact(
		primaryArtifact,
		pluginId,
		checkCadnanoJsonShape
	);
	return {
		name,
		vstrands,
		warnings: issues.filter((i) => i.severity === 'warning').map((i) => i.message),
	};
}
