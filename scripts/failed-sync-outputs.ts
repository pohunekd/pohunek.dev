#!/usr/bin/env bun
// Prints the verify job's step outputs from failed-sync.json (one JSON object per line:
// {script, product, reason}), one single-line key=value pair each:
//   failed_sync_products  JSON array of product ids; the finalize job validates it strictly (through revert-products)
//   failed_sync_reasons   JSON array of reasons in the same order; only the report job shows it
//   failed_sync           "true" when any product failed
// The caller redirects stdout to GITHUB_OUTPUT, so nothing else may print here.
import { join, resolve } from 'node:path';
import { readFailedSync, type FailedSync } from './lib/failed-sync.ts';

export function syncOutputLines(failures: readonly FailedSync[]): string[] {
  const products: string[] = [];
  const reasons: string[] = [];
  for (const failure of failures) {
    const index = products.indexOf(failure.product);
    if (index === -1) {
      products.push(failure.product);
      reasons.push(`${failure.script}: ${failure.reason}`);
    } else {
      reasons[index] = `${reasons[index]}; ${failure.script}: ${failure.reason}`;
    }
  }
  return [
    `failed_sync_products=${JSON.stringify(products)}`,
    `failed_sync_reasons=${JSON.stringify(reasons)}`,
    `failed_sync=${products.length > 0 ? 'true' : 'false'}`,
  ];
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  for (const line of syncOutputLines(await readFailedSync(join(root, 'failed-sync.json')))) {
    console.log(line);
  }
}
