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
