#!/usr/bin/env bun
// Merges the collect job's follow outcomes with the verify job's sync failures into the per-product
// table the report job appends to GITHUB_STEP_SUMMARY, then exits 1 when any product failed.
// Inputs arrive as JSON arrays in the environment so no reasoning happens in YAML:
// COLLECT_FAILED_PRODUCTS, COLLECT_FAILED_REASONS, COLLECT_MOVED_PRODUCTS,
// VERIFY_FAILED_PRODUCTS, VERIFY_FAILED_REASONS (from failed-sync.json via the verify job).
export interface ReportInputs {
  readonly collectFailed: readonly string[];
  readonly collectReasons: readonly string[];
  readonly collectMoved: readonly string[];
  readonly verifyFailed: readonly string[];
  readonly verifyReasons: readonly string[];
}

export function sanitizeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/** Collect failures and sync failures keyed by product, reasons prefixed with their job. */
export function mergeFailures(inputs: ReportInputs): Map<string, string> {
  if (inputs.collectFailed.length !== inputs.collectReasons.length) {
    throw new Error('COLLECT_FAILED_PRODUCTS and COLLECT_FAILED_REASONS have different lengths');
  }
  if (inputs.verifyFailed.length !== inputs.verifyReasons.length) {
    throw new Error('VERIFY_FAILED_PRODUCTS and VERIFY_FAILED_REASONS have different lengths');
  }
  const failed = new Map<string, string>();
  for (const [index, product] of inputs.collectFailed.entries()) {
    failed.set(product, `collect: ${inputs.collectReasons[index]}`);
  }
  for (const [index, product] of inputs.verifyFailed.entries()) {
    const reason = `verify: ${inputs.verifyReasons[index]}`;
    failed.set(product, failed.has(product) ? `${failed.get(product)}; ${reason}` : reason);
  }
  return failed;
}

/** One Markdown table over every product that moved or failed. */
export function renderReport(inputs: ReportInputs): string {
  const failed = mergeFailures(inputs);
  const moved = new Set(inputs.collectMoved.map((entry) => entry.split(' ')[0]));
  const products = [...new Set([...failed.keys(), ...moved])].sort();
  const rows = [
    '### follow-releases',
    '',
    '| product | result | detail |',
    '| --- | --- | --- |',
  ];
  for (const product of products) {
    const reason = failed.get(product);
    if (reason !== undefined) {
      rows.push(`| ${product} | FAILED | ${sanitizeCell(reason)} |`);
    } else {
      const entry = inputs.collectMoved.find((move) => move.startsWith(`${product} `));
      rows.push(`| ${product} | moved | ${sanitizeCell(entry ?? `${product} moved`)} |`);
    }
  }
  if (products.length === 0) {
    rows.push('| - | unchanged | no product moved |');
  }
  return `${rows.join('\n')}\n`;
}

function readArray(name: string): string[] {
  const raw = process.env[name] ?? '[]';
  try {
    const parsed: unknown = JSON.parse(raw.length === 0 ? '[]' : raw);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
      throw new Error(`${name} must be a JSON array of strings`);
    }
    return parsed as string[];
  } catch {
    console.error(`follow-report: ${name} must be a JSON array of strings, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  try {
    process.stdout.write(
      renderReport({
        collectFailed: readArray('COLLECT_FAILED_PRODUCTS'),
        collectReasons: readArray('COLLECT_FAILED_REASONS'),
        collectMoved: readArray('COLLECT_MOVED_PRODUCTS'),
        verifyFailed: readArray('VERIFY_FAILED_PRODUCTS'),
        verifyReasons: readArray('VERIFY_FAILED_REASONS'),
      }),
    );
  } catch (error) {
    console.error(`follow-report: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
