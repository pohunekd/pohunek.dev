#!/usr/bin/env bun
// Renders the /plugins/ data from the signed official plugin index at build time.
// A failed fetch or an unreadable document falls back to src/data/plugins.snapshot.json and the page
// shows the snapshot's "as of" date; when neither is usable this script exits non-zero and the build
// stops. It never renders an empty page silently. No network in tests: pass --index <file>.
import { dirname, relative, resolve } from 'node:path';
import { pluginPresentation } from './lib/plugin-presentation.ts';
import { syncPlugins } from './lib/plugins-sync.ts';

export interface CliArgs {
  readonly index?: string;
  readonly url?: string;
  readonly updateSnapshot: boolean;
}

const REPO_ROOT = resolve(dirname(import.meta.path), '..');
const USAGE =
  'usage: sync-plugins.ts [--index <file>] [--url <url>] [--update-snapshot]  (writes src/data/generated/plugins.ts)';

export function parseArgs(argv: readonly string[]): CliArgs {
  let updateSnapshot = false;
  const rest: string[] = [];
  for (const arg of argv) {
    if (arg === '--update-snapshot') {
      updateSnapshot = true;
    } else {
      rest.push(arg);
    }
  }
  const values: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag !== '--index' && flag !== '--url') {
      throw new Error(`unknown argument "${flag}"; ${USAGE}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    values[flag.slice(2)] = value;
  }
  return { index: values.index, url: values.url, updateSnapshot };
}

async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`sync-plugins: ${(error as Error).message}`);
    return 2;
  }
  try {
    const result = await syncPlugins({
      root: REPO_ROOT,
      indexFile: args.index,
      url: args.url,
      updateSnapshot: args.updateSnapshot,
      presentation: pluginPresentation,
    });
    const { view } = result;
    if (view.runtime.length + view.context.length === 0) {
      console.error('sync-plugins: the index rendered no rows; refusing to build an empty plugin list');
      return 1;
    }
    const detail = `${view.runtime.length} runtime and ${view.context.length} context packages`;
    if (result.fallbackReason !== undefined) {
      console.warn(
        `sync-plugins: the live index is unavailable (${result.fallbackReason}); rendering the committed snapshot from ${view.fetchedAt} (index signed ${view.asOf})`,
      );
    }
    const snapshot = result.snapshotWritten
      ? `; snapshot written to ${relative(REPO_ROOT, resolve(REPO_ROOT, 'src/data/plugins.snapshot.json'))}`
      : '';
    console.log(`sync-plugins: ${detail} from ${view.source} signed ${view.asOf}${snapshot}`);
    return 0;
  } catch (error) {
    console.error(`sync-plugins: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
