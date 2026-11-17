/** One product whose sync failed under --keep-going; the verify job reverts its pin and docs. */
export interface FailedSync {
  /** The sync script that failed: sync-docs, sync-screenshots or sync-media. */
  readonly script: string;
  readonly product: string;
  readonly reason: string;
}

/** Appends one failure as a JSON line; the file is created by the first failure. */
export async function recordFailedSync(path: string, failure: FailedSync): Promise<void> {
  const file = Bun.file(path);
  const previous = (await file.exists()) ? await file.text() : '';
  await Bun.write(path, `${previous}${JSON.stringify(failure)}\n`);
}

/** Reads the failures recorded so far; a missing file means no product failed. */
export async function readFailedSync(path: string): Promise<FailedSync[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return [];
  }
  const failures: FailedSync[] = [];
  for (const line of (await file.text()).split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    failures.push(JSON.parse(line) as FailedSync);
  }
  return failures;
}

/** Upper bound for the failed-product list a job output may carry into the finalize job. */
export const MAX_FAILED_PRODUCTS_LENGTH = 4096;

/**
 * Parses the list of products whose sync failed, as the verify job passes it on: a JSON array of
 * product ids, each one a known product, none twice. Empty text means no failure. Anything else is
 * refused, because the tree built from this list is what the job with write access commits.
 */
export function parseFailedProducts(raw: string, knownIds: readonly string[]): string[] {
  if (raw.length > MAX_FAILED_PRODUCTS_LENGTH) {
    throw new Error(`the failed product list is ${raw.length} characters long, more than ${MAX_FAILED_PRODUCTS_LENGTH}`);
  }
  if (raw.trim() === '') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('the failed product list is not JSON');
  }
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
    throw new Error('the failed product list must be a JSON array of product ids');
  }
  const ids = parsed as string[];
  if (ids.length > knownIds.length) {
    throw new Error(`the failed product list names ${ids.length} products, the config has ${knownIds.length}`);
  }
  for (const id of ids) {
    if (!knownIds.includes(id)) {
      throw new Error(`the failed product list names unknown product "${id}"`);
    }
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('the failed product list names a product twice');
  }
  return ids;
}
