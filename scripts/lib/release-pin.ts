/** A stable release tag `vX.Y.Z`; pre-release and build suffixes are rejected because the site follows stable releases only. */
const RELEASE_TAG_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export type ReleaseVersion = readonly [major: number, minor: number, patch: number];

export type PinBump = { readonly kind: 'unchanged' } | { readonly kind: 'bump'; readonly from: string; readonly to: string };

export function parseReleaseTag(tag: string): ReleaseVersion {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (match === null) {
    throw new Error(`release tag must look like vX.Y.Z, got "${tag}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareReleaseTags(left: string, right: string): number {
  const a = parseReleaseTag(left);
  const b = parseReleaseTag(right);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/** Decides whether the pin moves to the candidate tag. A downgrade throws: it means the release history changed and needs a person. */
export function planPinBump(currentRef: string, candidateTag: string): PinBump {
  const order = compareReleaseTags(candidateTag, currentRef);
  if (order === 0) {
    return { kind: 'unchanged' };
  }
  if (order < 0) {
    throw new Error(`refusing to move the pin back from ${currentRef} to ${candidateTag}`);
  }
  return { kind: 'bump', from: currentRef, to: candidateTag };
}

/** Returns the pin file content with only `ref` replaced, keeping key order, `$comment` and the 2-space layout. */
export function renderPinFile(raw: Record<string, unknown>, ref: string): string {
  return `${JSON.stringify({ ...raw, ref }, null, 2)}\n`;
}
