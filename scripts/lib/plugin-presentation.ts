/**
 * How the /plugins/ page names and describes each package.
 *
 * The signed index carries facts only (package id, kind, version, platform, core range), so the
 * human name and the one-line description live here, keyed by package id. A package the index admits
 * without an entry here still appears: scripts/lib/plugins.ts derives a name from the plugin
 * repository and a neutral description, so a new admission needs no page edit.
 */
import type { PluginPresentationMap } from './plugins.ts';

export const pluginPresentation: PluginPresentationMap = {
  'pohunek.runtime.agy': {
    name: 'Antigravity',
    description: "Google's Antigravity CLI.",
  },
  'pohunek.runtime.vibe': {
    name: 'Mistral Vibe',
    description: "Mistral's Vibe terminal coding agent.",
  },
  'pohunek.runtime.muse': {
    name: 'Muse Code',
    description: "Meta's Muse Code terminal coding agent.",
  },
  'pohunek.context.assistant': {
    name: 'Assistant knowledge',
    description: 'The knowledge bundle behind the pohunek assistant command.',
  },
};
