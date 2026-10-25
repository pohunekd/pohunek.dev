#!/usr/bin/env bun
// Moves the pohunek release pin in pohunek.config.json forward to the given stable tag.
// Usage: bump-pin.ts <vX.Y.Z>. Prints the resulting ref on stdout; the file is untouched when the pin already matches.
import { rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseProductPin } from './lib/docs-config.ts';
import { planPinBump, renderPinFile } from './lib/release-pin.ts';

const REPO_ROOT = resolve(dirname(import.meta.path), '..');
const PIN_FILE = join(REPO_ROOT, 'pohunek.config.json');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    throw new Error('usage: bump-pin.ts <vX.Y.Z>');
  }
  const tag = args[0];

  const raw = (await Bun.file(PIN_FILE).json()) as Record<string, unknown>;
  const pin = parseProductPin(raw);
  const plan = planPinBump(pin.ref, tag);

  if (plan.kind === 'unchanged') {
    console.error(`bump-pin: already at ${pin.ref}`);
  } else {
    const temporary = `${PIN_FILE}.tmp-${process.pid}`;
    await writeFile(temporary, renderPinFile(raw, plan.to), 'utf8');
    await rename(temporary, PIN_FILE);
    console.error(`bump-pin: ${plan.from} -> ${plan.to}`);
  }
  console.log(plan.kind === 'unchanged' ? pin.ref : plan.to);
}

try {
  await main();
} catch (error) {
  console.error(`bump-pin: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
