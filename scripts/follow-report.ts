#!/usr/bin/env bun
// Merges the collect job's follow outcomes with the verify job's sync failures into the per-product
// table the report job appends to GITHUB_STEP_SUMMARY, then exits 1 when any product failed.
// Inputs arrive as JSON arrays in the environment so no reasoning happens in YAML:
// COLLECT_FAILED_PRODUCTS, COLLECT_FAILED_REASONS, COLLECT_MOVED_PRODUCTS,
// VERIFY_FAILED_PRODUCTS, VERIFY_FAILED_REASONS (the products whose sync failed, from the verify job).
export interface MovedEntry {
  readonly product: string;
  readonly moved: string;
}

export interface ReportInputs {
  readonly collectFailed: readonly string[];
  readonly collectReasons: readonly string[];
  readonly collectMoved: readonly MovedEntry[];
  readonly verifyFailed: readonly string[];
  readonly verifyReasons: readonly string[];
}

export function sanitizeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/** Collect failures and sync failures keyed by product id, reasons prefixed with their job. */
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

/** One Markdown table with one row per product id: FAILED when it failed anywhere, moved otherwise. */
export function renderReport(inputs: ReportInputs): string {
  const failed = mergeFailures(inputs);
  const moved = new Map(inputs.collectMoved.map((entry) => [entry.product, entry.moved]));
  const products = [...new Set([...failed.keys(), ...moved.keys()])].sort();
  const rows = ['### follow-releases', '', '| product | result | detail |', '| --- | --- | --- |'];
  for (const product of products) {
    const reason = failed.get(product);
    if (reason !== undefined) {
      rows.push(`| ${sanitizeCell(product)} | FAILED | ${sanitizeCell(reason)} |`);
    } else {
      rows.push(`| ${sanitizeCell(product)} | moved | ${sanitizeCell(moved.get(product) as string)} |`);
    }
  }
  if (products.length === 0) {
    rows.push('| - | unchanged | no product moved |');
  }
  return `${rows.join('\n')}\n`;
}

function readArray(name: string): unknown[] {
  const raw = process.env[name] ?? '[]';
  try {
    const parsed: unknown = JSON.parse(raw.length === 0 ? '[]' : raw);
    if (!Array.isArray(parsed)) {
      throw new Error('not an array');
    }
    return parsed;
  } catch {
    console.error(`follow-report: ${name} must be a JSON array, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
}

function readStrings(name: string): string[] {
  const values = readArray(name);
  if (!values.every((entry) => typeof entry === 'string')) {
    console.error(`follow-report: ${name} must be a JSON array of strings`);
    process.exit(1);
  }
  return values as string[];
}

function readMoved(name: string): MovedEntry[] {
  const values = readArray(name);
  const entries: MovedEntry[] = [];
  for (const value of values) {
    const entry = value as Partial<MovedEntry> | null;
    if (typeof entry?.product !== 'string' || typeof entry.moved !== 'string') {
      console.error(`follow-report: ${name} must be a JSON array of {product, moved}`);
      process.exit(1);
    }
    entries.push({ product: entry.product, moved: entry.moved });
  }
  return entries;
}

if (import.meta.main) {
  try {
    process.stdout.write(
      renderReport({
        collectFailed: readStrings('COLLECT_FAILED_PRODUCTS'),
        collectReasons: readStrings('COLLECT_FAILED_REASONS'),
        collectMoved: readMoved('COLLECT_MOVED_PRODUCTS'),
        verifyFailed: readStrings('VERIFY_FAILED_PRODUCTS'),
        verifyReasons: readStrings('VERIFY_FAILED_REASONS'),
      }),
    );
  } catch (error) {
    console.error(`follow-report: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
