#!/usr/bin/env bun
// Prints the release commit message (a subject and, when the list is long, a body) from the products that moved (MOVED_PRODUCTS, the collect
// job's JSON array of {product, moved}) minus the products whose sync failed (FAILED_SYNC_PRODUCTS),
// which the finalize job has put back on their base pins. No product left means only changelog entries
// were recorded. Imports no npm package.
import type { MovedProduct } from './follow-outcomes.ts';

/** Must equal subject_max_length in take-release-data, which refuses a longer subject. */
export const SUBJECT_MAX_LENGTH = 100;

/**
 * The commit message: "Follow <releases>" when it fits the subject bound, otherwise "Follow <n> releases"
 * with the full list as "- <release>" lines in the body.
 */
export function commitSummary(moved: readonly MovedProduct[], reverted: readonly string[]): string {
  const kept = moved.filter((entry) => !reverted.includes(entry.product));
  if (kept.length === 0) {
    return 'Record ecosystem changelog';
  }
  const full = `Follow ${kept.map((entry) => entry.moved).join(', ')}`;
  if (full.length <= SUBJECT_MAX_LENGTH) {
    return full;
  }
  return `Follow ${kept.length} releases\n\n${kept.map((entry) => `- ${entry.moved}`).join('\n')}`;
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
    return { product: entry.product, moved: entry.moved.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim() };
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
