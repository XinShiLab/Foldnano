/**
 * Plugin dev mode: generates a starter plugin (fplugin.json, plugin.py, optional API stubs) for
 * a linked folder. Pure; writing the files is `PluginDevMode.createPlugin`.
 */

import { MANIFEST_SCHEMA_VERSION, validateManifest } from './manifestValidation';
import type { ApplyStrategy, PluginFormat, PluginManifest } from './types';

export type ScaffoldFormat = Exclude<PluginFormat, 'live'>;

/** Strategies `validateManifest` accepts for each format, in the order the dialog offers them. */
export const STRATEGIES_FOR_FORMAT: Record<ScaffoldFormat, readonly ApplyStrategy[]> = {
	foldnano_mini: ['replayMutationLog', 'replayMutationLogInRegion', 'previewOnly'],
	foldnano_json: ['replacePartKeepAnnotationsWhereMatched', 'replacePart', 'previewOnly'],
	cadnano_json: ['replaceRegionKeepAnnotationsWhereMatched', 'replaceRegion', 'previewOnly'],
};

export interface NewPluginFields {
	id: string;
	name: string;
	version: string;
	description: string;
	format: ScaffoldFormat;
	applyStrategy: ApplyStrategy;
	requirements: readonly string[];
	network: readonly string[];
}

export const DEFAULT_NEW_PLUGIN_VERSION = '0.1.0';

/** "My Staple Tool" → "my-staple-tool"; always a valid plugin id. */
export function suggestPluginId(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64)
		.replace(/-+$/, '');
	return /^[a-z]/.test(slug) ? slug : `plugin-${slug}`.replace(/-+$/, '');
}

/** Splits a comma/whitespace-separated list typed into the dialog. */
export function parseList(text: string): string[] {
	return text
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

/** The manifest the dialog would write; throws `validateManifest`'s message when it's invalid. */
export function buildNewManifest(
	fields: NewPluginFields,
	options: { schemaUrl?: string } = {}
): PluginManifest {
	const description = fields.description.trim();
	const raw = {
		...(options.schemaUrl ? { $schema: options.schemaUrl } : {}),
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		id: fields.id.trim(),
		name: fields.name.trim(),
		version: fields.version.trim(),
		format: fields.format,
		applyStrategy: fields.applyStrategy,
		...(description ? { description } : {}),
		...(fields.requirements.length > 0 ? { requirements: [...fields.requirements] } : {}),
		...(fields.network.length > 0 ? { network: [...fields.network] } : {}),
	};
	return validateManifest(raw, { allowNoEntrypoint: true });
}

export function manifestFileText(manifest: PluginManifest): string {
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}

function docstring(manifest: PluginManifest): string {
	const summary = manifest.description ? `: ${manifest.description}` : '.';
	// Manifest text may hold quotes, backslashes (Windows paths) or line breaks.
	const text = `${manifest.name}${summary}`
		.replace(/\s*[\r\n]+\s*/g, ' ')
		.replace(/[\\"]/g, '\\$&');
	return `"""${text}"""`;
}

/** A runnable plugin.py for the manifest's format and strategy, with the edit point marked. */
export function starterPluginPy(manifest: PluginManifest): string {
	const preview = manifest.applyStrategy === 'previewOnly';
	const header = `${docstring(manifest)}\n\n`;
	if (manifest.format === 'foldnano_mini') {
		return `${header}from foldnano.plugin import PluginContext
from foldnano_mini import load_part


def run(ctx: PluginContext) -> None:
    part = load_part(ctx.get_part_as_foldnano_json(), active_region_id=ctx.active_region_id)
    print(f"{len(part.virtual_helices)} helices, {len(part.real_oligos)} oligos")

${
	preview
		? `    # previewOnly: report what you find; the design is never changed.
    ctx.set_result({"oligos": len(part.real_oligos)})
`
		: `    # Edit \`part\` here, e.g. part.real_oligos[0].color = "#cc0000" (part.oligos also holds
    # repeat groups' read-only mirrors). Every change is recorded and applied to the design as
    # one undo step after you confirm it.

    ctx.set_result_mutation_log(part.mutation_log)
`
}`;
	}
	if (manifest.format === 'foldnano_json') {
		return `${header}import json

from foldnano.plugin import PluginContext


def run(ctx: PluginContext) -> None:
    part = json.loads(ctx.get_part_as_foldnano_json())
    print(f"{len(part.get('oligos', []))} oligos")

${
	preview
		? `    # previewOnly: report what you find; the design is never changed.
    ctx.set_result({"oligos": len(part.get("oligos", []))})
`
		: `    # Edit \`part\` (the Part JSON) here; the result replaces the part after you confirm it.

    ctx.set_result_foldnano_json(json.dumps(part))
`
}`;
	}
	return `${header}import json

from foldnano.plugin import PluginContext


def run(ctx: PluginContext) -> None:
    design = json.loads(ctx.get_part_as_cadnano_json())
    print(f"{len(design['vstrands'])} helices in the active region")

${
	preview
		? `    # previewOnly: report what you find; the design is never changed.
    ctx.set_result({"helices": len(design["vstrands"])})
`
		: `    # Edit \`design\` (cadnano JSON of the active region) here; the result replaces the
    # region after you confirm it.

    ctx.set_result_cadnano_json(json.dumps(design))
`
}`;
}

/** Folder the stubs go in: a dot-folder, so linked runs and exported zips leave it out. */
export const STUBS_DIR = '.foldnano-stubs';

/**
 * Pyright / Pylance / basedpyright config pointing the editor at the stubs. The packages only
 * exist inside Foldnano's runtime, so "stub found but no source" is expected, not a problem.
 * `standard` keeps basedpyright (Zed's default) from its stricter "recommended" mode. Ignored by
 * linked runs too.
 */
export function pyrightConfigText(): string {
	const config = {
		stubPath: STUBS_DIR,
		typeCheckingMode: 'standard',
		reportMissingModuleSource: 'none',
	};
	return `${JSON.stringify(config, null, '\t')}\n`;
}

const STUB_SOURCES = import.meta.glob('./python/stubs/**/*.pyi', {
	query: '?raw',
	import: 'default',
}) as Record<string, () => Promise<string>>;

/** The foldnano / foldnano_mini API stubs, keyed by path under `STUBS_DIR`. */
export async function loadApiStubs(): Promise<Record<string, string>> {
	const entries = await Promise.all(
		Object.entries(STUB_SOURCES).map(
			async ([path, load]) => [path.replace('./python/stubs/', ''), await load()] as const
		)
	);
	return Object.fromEntries(entries);
}

/** Files to write for a new plugin, keyed by folder-relative path. */
export async function starterPluginFiles(
	manifest: PluginManifest,
	options: { pluginPy: boolean; stubs: boolean }
): Promise<Record<string, string>> {
	const files: Record<string, string> = { 'fplugin.json': manifestFileText(manifest) };
	if (options.pluginPy) files['plugin.py'] = starterPluginPy(manifest);
	if (options.stubs) {
		for (const [path, text] of Object.entries(await loadApiStubs())) {
			files[`${STUBS_DIR}/${path}`] = text;
		}
		files['pyrightconfig.json'] = pyrightConfigText();
	}
	return files;
}
