import { DesignCheckError } from '$lib/model/checks/designIssue';
import { PluginValidationError } from './plugin-result-errors';

function rejectResult(message: string, pluginId: string): never {
	throw new PluginValidationError(message, pluginId, 'result-format-validation', 'shape');
}

/** Parses a plugin's raw result artifact and runs a model shape check on it as plugin validation. */
export function checkResultArtifact<T>(
	primaryArtifact: string | null,
	pluginId: string,
	check: (parsed: unknown) => T
): T {
	if (primaryArtifact === null) rejectResult('Plugin returned no result.', pluginId);
	let parsed: unknown;
	try {
		parsed = JSON.parse(primaryArtifact);
	} catch {
		rejectResult('Result is not valid JSON.', pluginId);
	}
	try {
		return check(parsed);
	} catch (err) {
		if (!(err instanceof DesignCheckError)) throw err;
		throw new PluginValidationError(
			err.issue.message,
			pluginId,
			'result-format-validation',
			err.issue.rule
		);
	}
}
