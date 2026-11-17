#!/usr/bin/env bun
// Merges failed-sync.json (one JSON object per line: {script, product, reason}) into the verify
// job's step outputs. The collect job's failed_products/failed_reasons/moved_products arrive in the
// environment; this script appends the sync failures to them and sets failed=true when any product
// failed. The caller redirects stdout to GITHUB_OUTPUT, so nothing else may print here.
import { join, resolve } from 'node:path';
import { readFailedSync, type FailedSync } from './lib/failed-sync.ts';

export function mergeSyncFailures(
  failedProducts: readonly string[],
  failedReasons: readonly string[],
  movedProducts: readonly string[],
  sync: readonly FailedSync[],
): { failedProducts: string[]; failedReasons: string[]; movedProducts: string[]; failed: boolean } {
  const merged = [...failedProducts];
  const reasons = [...failedReasons];
  for (const failure of sync) {
    merged.push(failure.product);
    reasons.push(failure.reason);
  }
  return {
    failedProducts: merged,
    failedReasons: reasons,
    movedProducts: [...movedProducts],
    failed: merged.length > 0,
  };
}

function readArray(name: string): string[] {
  const raw = process.env[name] ?? '[]';
  const parsed: unknown = JSON.parse(raw.length === 0 ? '[]' : raw);
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error(`${name} must be a JSON array of strings`);
  }
  return parsed as string[];
}

if (import.meta.main) {
  const merged = mergeSyncFailures(
    readArray('COLLECT_FAILED_PRODUCTS'),
    readArray('COLLECT_FAILED_REASONS'),
    readArray('COLLECT_MOVED_PRODUCTS'),
    await readFailedSync(join(resolve(new URL('..', import.meta.url).pathname), 'failed-sync.json')),
  );
  console.log(`failed_products=${JSON.stringify(merged.failedProducts)}`);
  console.log(`failed_reasons=${JSON.stringify(merged.failedReasons)}`);
  console.log(`moved_products=${JSON.stringify(merged.movedProducts)}`);
  console.log(`failed=${merged.failed ? 'true' : 'false'}`);
}
