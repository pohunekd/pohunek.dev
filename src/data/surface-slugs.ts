/**
 * Surface slug list with no imports of generated or asset files, so tests
 * can read it before the sync scripts write src/data/generated/*.
 * src/data/surfaces.ts and tests/surface-og.test.ts both derive from it.
 */

/** Every surface page slug, in site order. */
export const surfaceSlugs = ['companion', 'android', 'omarchy', 'tui', 'sway', 'web'] as const;

export type SurfaceSlug = (typeof surfaceSlugs)[number];

/** Link preview path for a slug; the single place the convention lives. */
export function surfaceOgImage(slug: SurfaceSlug): string {
	return `/og/surface-${slug}.png`;
}
