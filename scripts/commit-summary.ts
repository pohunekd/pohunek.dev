#!/usr/bin/env bun
// Prints the release commit's subject line from the products that moved (MOVED_PRODUCTS, the collect
// job's JSON array of {product, moved}) minus the products whose sync failed (FAILED_SYNC_PRODUCTS),
// which the publish job has put back on their base pins. No product left means only changelog entries
// were recorded. Imports no npm package.
import type { MovedProduct } from './follow-outcomes.ts';

export function commitSummary(moved: readonly MovedProduct[], reverted: readonly string[]): string {
  const kept = moved.filter((entry) => !reverted.includes(entry.product));
  return kept.length === 0 ? 'Record ecosystem changelog' : `Follow ${kept.map((entry) => entry.moved).join(', ')}`;
}

export function parseMoved(raw: string): MovedProduct[] {
  const parsed: unknown = JSON.parse(raw.trim() === '' ? '[]' : raw);
  if (!Array.isArray(parsed)) {
    throw new Error('MOVED_PRODUCTS must be a JSON array');
  }
  return parsed.map((entry: Partial<MovedProduct> | null) => {
    if (typeof entry?.product !== 'string' || typeof entry.moved !== 'string') {
      throw new Error('MOVED_PRODUCTS entries need product and moved');
    }
    return { product: entry.product, moved: entry.moved.replace(/\s+/g, ' ') };
  });
}

if (import.meta.main) {
  try {
    const moved = parseMoved(process.env.MOVED_PRODUCTS ?? '');
    // revert-products has already validated this list against the base config; only the shape matters here.
    const raw = process.env.FAILED_SYNC_PRODUCTS ?? '';
    const reverted: unknown = JSON.parse(raw.trim() === '' ? '[]' : raw);
    if (!Array.isArray(reverted) || !reverted.every((entry) => typeof entry === 'string')) {
      throw new Error('FAILED_SYNC_PRODUCTS must be a JSON array of product ids');
    }
    console.log(commitSummary(moved, reverted as string[]));
  } catch (error) {
    console.error(`commit-summary: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
