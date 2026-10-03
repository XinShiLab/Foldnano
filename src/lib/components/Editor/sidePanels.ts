import {
	Blocks,
	FileCodeCorner,
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

export function getSidePanelDescriptors(registry: PluginRegistry): SidePanelDescriptor[] {
	return [
		...builtInSidePanels,
		...registry.all.flatMap((plugin) => toPluginSidePanelDescriptors(plugin)),
	];
}

export function getSidePanelDescriptor(
	id: SidePanelId,
	registry: PluginRegistry
): SidePanelDescriptor {
	if (id === 'GITHUB' || id === 'PLUGIN') {
		return getBuiltInSidePanelDescriptor(id);
	}

	const pluginId = id.slice('plugin:'.length);
	const plugin = registry.get(pluginId);
	if (!plugin || !plugin.manifest.sidePanel || !plugin.enabled) {
		return getBuiltInSidePanelDescriptor('GITHUB');
	}

	return buildPluginSidePanelDescriptor(plugin);
}

function toPluginSidePanelDescriptors(plugin: PythonPlugin): PluginSidePanelDescriptor[] {
	if (!plugin.manifest.sidePanel || !plugin.enabled) {
		return [];
	}
	return [buildPluginSidePanelDescriptor(plugin)];
}

function buildPluginSidePanelDescriptor(plugin: PythonPlugin): PluginSidePanelDescriptor {
	const panel = plugin.manifest.sidePanel!;
	return {
		kind: 'plugin',
		id: toPluginSidePanelId(plugin.manifest.id),
		pluginId: plugin.manifest.id,
		title: panel.title ?? plugin.manifest.name,
		ariaLabel: `Toggle ${panel.title ?? plugin.manifest.name} panel`,
		icon: sidePanelIconComponent(panel.icon ?? defaultSidePanelIcon(panel.type)),
		component: PluginSidePanelHost,
		componentProps: { pluginId: plugin.manifest.id },
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
