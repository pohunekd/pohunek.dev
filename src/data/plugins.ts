/**
 * The /plugins/ page data: the generated view of the signed official plugin index plus the plugin
 * repositories the site lists ahead of admission.
 *
 * The installable list is never edited here. `scripts/sync-plugins.ts` renders
 * `src/data/generated/plugins.ts` from the index at build time, so a newly admitted plugin appears
 * without a page edit. `pendingPlugins` is the site's own short list of official plugin repositories
 * whose package is not admitted to the index yet; each row moves out of it when its admission lands.
 */
import type { PluginRow } from '../../scripts/lib/plugins.ts';
import { pluginIndexView } from './generated/plugins';

export const pluginIndex = pluginIndexView;

/** An official plugin repository whose package is not installable by id yet. */
export interface PendingPlugin {
  readonly name: string;
  readonly runtime: string;
  readonly tier: PluginRow['tier'];
  readonly description: string;
  readonly repository: string;
  readonly repositoryLabel: string;
}

export const pendingPlugins: readonly PendingPlugin[] = [
  {
    name: 'Cline',
    runtime: 'cline',
    tier: 'official',
    description: 'Cline CLI. The plugin repository is public; its package is not admitted to the index yet.',
    repository: 'https://github.com/pohunekd/plugin-cline',
    repositoryLabel: 'pohunekd/plugin-cline',
  },
];

/** The UTC day of an ISO timestamp, for the "as of" note under the tables. */
export function indexDay(iso: string): string {
  return iso.slice(0, 10);
}
