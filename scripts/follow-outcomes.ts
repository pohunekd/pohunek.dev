#!/usr/bin/env bun
// Writes the collect job's step outputs from one follow-releases.ts stdout line at a time:
// failed ("true" when the follow exited 2), failed_products and failed_reasons (JSON arrays of the
// products that failed with their reasons), moved_products (a JSON array of {product, moved} entries, moved being
// "<name> <tag>"). Every output is one line, as GITHUB_OUTPUT requires for the key=value form.
// Usage: follow-outcomes.ts <failed>; follow-releases.ts JSON lines arrive on stdin.
export interface MovedProduct {
  readonly product: string;
  readonly moved: string;
}

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
  movedProducts: MovedProduct[];
} {
  const failedProducts: string[] = [];
  const failedReasons: string[] = [];
  const movedProducts: MovedProduct[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    const outcome = JSON.parse(line) as FollowOutcomeLine;
    if (outcome.failed) {
      failedProducts.push(outcome.product);
      failedReasons.push(outcome.reason ?? 'unknown error');
    } else if (outcome.moved !== undefined) {
      movedProducts.push({ product: outcome.product, moved: outcome.moved });
    }
  }
  return { failedProducts, failedReasons, movedProducts };
}

/** The step output lines for one follow run. */
export function outputLines(failed: boolean, lines: readonly string[]): string[] {
  const { failedProducts, failedReasons, movedProducts } = parseOutcomeLines(lines);
  return [
    `failed=${failed ? 'true' : 'false'}`,
    `failed_products=${JSON.stringify(failedProducts)}`,
    `failed_reasons=${JSON.stringify(failedReasons)}`,
    `moved_products=${JSON.stringify(movedProducts)}`,
  ];
}

if (import.meta.main) {
  const [failed] = process.argv.slice(2);
  if (failed !== 'true' && failed !== 'false') {
    console.error('usage: follow-outcomes.ts <true|false> < follow-outcomes.jsonl');
    process.exit(1);
  }
  const input = (await new Response(Bun.stdin.stream()).text()).split('\n');
  // The caller redirects stdout to GITHUB_OUTPUT, so nothing else may print here.
  for (const line of outputLines(failed === 'true', input)) {
    console.log(line);
  }
}
