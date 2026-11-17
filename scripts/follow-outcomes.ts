#!/usr/bin/env bun
// Writes the collect job's step outputs from one follow-releases.ts stdout line at a time:
// failed ("true" when the follow exited 2), failed_products and failed_reasons (JSON arrays of the
// products that failed with their reasons), moved_products (a JSON array of the moved "<name> <tag>" entries).
// Usage: follow-outcomes.ts <failed>; follow-releases.ts JSON lines arrive on stdin.
export interface FollowOutcomeLine {
  readonly product: string;
  readonly moved?: string;
  readonly failed: boolean;
  readonly reason?: string;
}

/** Splits follow-releases.ts JSON lines into failed products (with reasons) and moved entries. */
export function parseOutcomeLines(lines: readonly string[]): {
  failedProducts: string[];
  failedReasons: string[];
  movedProducts: string[];
} {
  const failedProducts: string[] = [];
  const failedReasons: string[] = [];
  const movedProducts: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    const outcome = JSON.parse(line) as FollowOutcomeLine;
    if (outcome.failed) {
      failedProducts.push(outcome.product);
      failedReasons.push(outcome.reason ?? 'unknown error');
    } else if (outcome.moved !== undefined) {
      movedProducts.push(outcome.moved);
    }
  }
  return { failedProducts, failedReasons, movedProducts };
}

if (import.meta.main) {
  const [failed] = process.argv.slice(2);
  if (failed !== 'true' && failed !== 'false') {
    console.error('usage: follow-outcomes.ts <true|false> < follow-outcomes.jsonl');
    process.exit(1);
  }
  const { failedProducts, failedReasons, movedProducts } = parseOutcomeLines(
    (await new Response(Bun.stdin.stream()).text()).split('\n'),
  );
  // The caller redirects stdout to GITHUB_OUTPUT, so nothing else may print here.
  console.log(`failed=${failed}`);
  console.log(`failed_products=${JSON.stringify(failedProducts)}`);
  console.log(`failed_reasons=${JSON.stringify(failedReasons)}`);
  console.log(`moved_products=${JSON.stringify(movedProducts)}`);
}
