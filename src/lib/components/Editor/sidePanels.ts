import {
	Blocks,
	FileCodeCorner,
	FilePen,
	GitPullRequestArrow,
	SlidersHorizontal,
	Workflow,
} from '@lucide/svelte';
import type { Component } from 'svelte';
import type { PluginRegistry } from '$lib/plugin/PluginRegistry.svelte';
import type { PluginSidePanelIcon, PythonPlugin } from '$lib/plugin/types';
import GitHubExplorer from './GitHubExplorer/GitHubExplorer.svelte';
import PluginPanel from './Plugin/PluginPanel.svelte';
import PluginSidePanelHost from './SidePanel/PluginSidePanelHost.svelte';

export type BuiltInSidePanelId = 'GITHUB' | 'PLUGIN';
export type PluginSidePanelId = `plugin:${string}`;
export type SidePanelId = BuiltInSidePanelId | PluginSidePanelId;

interface BaseSidePanelDescriptor {
	title: string;
	ariaLabel: string;
	icon: Component;
}

export interface BuiltInSidePanelDescriptor extends BaseSidePanelDescriptor {
	kind: 'builtIn';
	id: BuiltInSidePanelId;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
	componentProps?: Record<string, unknown>;
}

export interface PluginSidePanelDescriptor extends BaseSidePanelDescriptor {
	kind: 'plugin';
	id: PluginSidePanelId;
	pluginId: string;
	description?: string;
	/** An owned plugin's editor: opened on demand from the Plugins list and closable. */
	isOwnedEditor: boolean;
	/** The owned plugin has unsaved edits. */
	hasDraft: boolean;
	/** The plugin's bundled icon; drawn instead of `icon` when set. */
	iconSvg: string | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any>;
	componentProps: { pluginId: string };
}

export type SidePanelDescriptor = BuiltInSidePanelDescriptor | PluginSidePanelDescriptor;

export const builtInSidePanels: BuiltInSidePanelDescriptor[] = [
	{
		kind: 'builtIn',
		id: 'GITHUB',
		title: 'Source Control',
		ariaLabel: 'Toggle Source Control panel',
		icon: GitPullRequestArrow,
		component: GitHubExplorer,
	},
	{
		kind: 'builtIn',
		id: 'PLUGIN',
		title: 'Plugins',
		ariaLabel: 'Toggle Plugin panel',
		icon: Blocks,
		component: PluginPanel,
	},
];

const builtInSidePanelMap = new Map<BuiltInSidePanelId, BuiltInSidePanelDescriptor>(
	builtInSidePanels.map((panel): [BuiltInSidePanelId, BuiltInSidePanelDescriptor] => [
		panel.id,
		panel,
	])
);

export function getBuiltInSidePanelDescriptor(id: BuiltInSidePanelId): BuiltInSidePanelDescriptor {
	const descriptor = builtInSidePanelMap.get(id);
	if (!descriptor) {
		throw new Error(`Unknown built-in side panel: ${id}`);
	}
	return descriptor;
}

export function toPluginSidePanelId(pluginId: string): PluginSidePanelId {
	return `plugin:${pluginId}`;
}

/** `openEditorIds`: owned plugins whose editor panel is open (`EditorViewContext.pluginEditorIds`). */
export function getSidePanelDescriptors(
	registry: PluginRegistry,
	openEditorIds: ReadonlySet<string> = new Set()
): SidePanelDescriptor[] {
	return [
		...builtInSidePanels,
		...registry.all.flatMap((plugin) => toPluginSidePanelDescriptors(plugin, openEditorIds)),
	];
}

export function getSidePanelDescriptor(
	id: SidePanelId,
	registry: PluginRegistry,
	openEditorIds: ReadonlySet<string> = new Set()
): SidePanelDescriptor {
	if (id === 'GITHUB' || id === 'PLUGIN') {
		return getBuiltInSidePanelDescriptor(id);
	}

	const pluginId = id.slice('plugin:'.length);
	const plugin = registry.get(pluginId);
	const [descriptor] = plugin ? toPluginSidePanelDescriptors(plugin, openEditorIds) : [];
	return descriptor ?? getBuiltInSidePanelDescriptor('GITHUB');
}

function toPluginSidePanelDescriptors(
	plugin: PythonPlugin,
	openEditorIds: ReadonlySet<string>
): PluginSidePanelDescriptor[] {
	if (!plugin.enabled) return [];
	if (plugin.manifest.sidePanel) return [buildPluginSidePanelDescriptor(plugin)];
	if (plugin.authoring && openEditorIds.has(plugin.manifest.id)) {
		return [buildOwnedEditorDescriptor(plugin)];
	}
	return [];
}

function buildOwnedEditorDescriptor(plugin: PythonPlugin): PluginSidePanelDescriptor {
	return {
		kind: 'plugin',
		id: toPluginSidePanelId(plugin.manifest.id),
		pluginId: plugin.manifest.id,
		description: plugin.manifest.description,
		title: `Edit: ${plugin.manifest.name}`,
		ariaLabel: `Toggle the editor for ${plugin.manifest.name}`,
		icon: FilePen,
		component: PluginSidePanelHost,
		componentProps: { pluginId: plugin.manifest.id },
		isOwnedEditor: true,
		hasDraft: plugin.draftCode !== null,
		iconSvg: plugin.iconSvg,
	};
}

function buildPluginSidePanelDescriptor(plugin: PythonPlugin): PluginSidePanelDescriptor {
	const panel = plugin.manifest.sidePanel!;
	return {
		kind: 'plugin',
		id: toPluginSidePanelId(plugin.manifest.id),
		pluginId: plugin.manifest.id,
		description: plugin.manifest.description,
		title: panel.title ?? plugin.manifest.name,
		ariaLabel: `Toggle ${panel.title ?? plugin.manifest.name} panel`,
		icon: sidePanelIconComponent(panel.icon ?? defaultSidePanelIcon(panel.type)),
		component: PluginSidePanelHost,
		componentProps: { pluginId: plugin.manifest.id },
		isOwnedEditor: false,
		hasDraft: false,
		iconSvg: plugin.iconSvg,
	};
}

function defaultSidePanelIcon(
	type: NonNullable<PythonPlugin['manifest']['sidePanel']>['type']
): PluginSidePanelIcon {
	return type === 'codeEditor' ? 'code' : 'form';
}

function sidePanelIconComponent(icon: PluginSidePanelIcon): Component {
	switch (icon) {
		case 'analysis':
			return Workflow;
		case 'code':
			return FileCodeCorner;
		default:
			return SlidersHorizontal;
	}
}
