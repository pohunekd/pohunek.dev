/**
 * The /plugins/ page data: the generated view of the signed official plugin index plus the plugin
 * repositories the site lists ahead of admission.
 *
 * The installable list is never edited here. `scripts/sync-plugins.ts` renders
 * `src/data/generated/plugins.ts` from the index at build time, so a newly admitted plugin appears
 * without a page edit. `officialPending` is the site's own short list of official plugin repositories
 * whose package is not admitted to the index yet; `pendingPlugins` drops every row the index already
 * admits, so an admission never shows the plugin twice and an empty list hides the section.
 */
import { pendingNotAdmitted, type PendingPlugin } from '../../scripts/lib/plugins.ts';
import { pluginIndexView } from './generated/plugins';

export const pluginIndex = pluginIndexView;

export type { PendingPlugin };

const officialPending: readonly PendingPlugin[] = [
  {
    packageId: 'pohunek.runtime.cline',
    name: 'Cline',
    runtime: 'cline',
    tier: 'official',
    description: 'Cline CLI. The plugin repository is public; its package is not admitted to the index yet.',
    repository: 'https://github.com/pohunekd/plugin-cline',
    repositoryLabel: 'pohunekd/plugin-cline',
  },
];

/** The pending rows the index does not admit yet; the page hides the section when this is empty. */
export const pendingPlugins = pendingNotAdmitted(officialPending, pluginIndex);

/** The UTC day of an ISO timestamp, for the "as of" note under the tables. */
export function indexDay(iso: string): string {
  return iso.slice(0, 10);
}
