import type { PluginManifest } from './types';
import { scriptLabManifest } from './scriptLabManifest';

const modules = import.meta.glob('./core_plugins/*.fplugin.json', { eager: true });

export const corePlugins: PluginManifest[] = Object.values(modules).map(
	(m) => (m as { default: PluginManifest }).default
);

export const hubPlugins: PluginManifest[] = corePlugins;
export const builtinPlugins: PluginManifest[] = [scriptLabManifest];
