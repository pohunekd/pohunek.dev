import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** A pinned repository ref, read through git objects so the working tree of any checkout is never used. */
export interface DocsSource {
  readonly description: string;
  listFiles(): Promise<string[]>;
  readText(path: string): Promise<string>;
}

/** Thrown for conditions the operator must fix; the CLI prints the message without a stack trace. */
export class DocsSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocsSyncError';
  }
}

/** Uses an existing local checkout. The ref must already be present in its object database. */
export async function openLocalSource(sourcePath: string, ref: string): Promise<DocsSource> {
  const commit = await runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], sourcePath).catch(() => null);
  if (commit === null) {
    throw new DocsSyncError(
      `ref "${ref}" is not available in ${sourcePath}; fetch it first: git -C ${sourcePath} fetch origin tag ${ref}`,
    );
  }
  return gitSource(sourcePath, ref, `local checkout ${sourcePath} at ${ref}`);
}

/**
 * Shallow-clones the ref from GitHub into a fresh directory under cacheDir. The clone is
 * deleted and recreated on every run so a previous ref never leaks into the output.
 */
export async function cloneSource(options: {
  readonly repositoryUrl: string;
  readonly ref: string;
  readonly cloneDir: string;
}): Promise<DocsSource> {
  await rm(options.cloneDir, { recursive: true, force: true });
  await mkdir(options.cloneDir, { recursive: true });
  const target = join(options.cloneDir, 'repo');
  try {
    await runGit(['clone', '--depth', '1', '--branch', options.ref, '--quiet', options.repositoryUrl, target]);
  } catch (error) {
    await rm(options.cloneDir, { recursive: true, force: true });
    const reason = error instanceof Error ? error.message : String(error);
    throw new DocsSyncError(
      `could not clone ${options.repositoryUrl} at ref "${options.ref}"; check the ref exists and the network is reachable. ${reason}`,
    );
  }
  return gitSource(target, 'HEAD', `${options.repositoryUrl} at ${options.ref}`);
}

function gitSource(repoDir: string, gitRef: string, description: string): DocsSource {
  return {
    description,
    async listFiles(): Promise<string[]> {
      const output = await runGit(['ls-tree', '-r', '-z', '--name-only', gitRef], repoDir);
      return output.split('\0').filter((entry) => entry !== '').sort();
    },
    async readText(path: string): Promise<string> {
      return runGit(['show', `${gitRef}:${path}`], repoDir);
    },
  };
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new DocsSyncError(`git ${args[0]} failed (exit ${code}): ${stderr.trim()}`);
  }
  return stdout;
}
