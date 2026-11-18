import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

// surface-slugs.ts has no imports of generated or asset files, so this
// test runs before the sync scripts write src/data/generated/*.
import { surfaceOgImage, surfaceSlugs } from '../src/data/surface-slugs.ts';

const ROOT = path.resolve(import.meta.dir, '..');

const slugs = [...surfaceSlugs];

describe('surface og images', () => {
	test('one 1200x630 PNG per surface slug', async () => {
		const files = readdirSync(path.join(ROOT, 'public/og'))
			.filter((file) => file.startsWith('surface-'))
			.sort();
		expect(files).toEqual(slugs.map((slug) => `surface-${slug}.png`).sort());
		for (const file of files) {
			const full = path.join(ROOT, 'public/og', file);
			expect(statSync(full).size).toBeGreaterThan(10_000);
			const meta = await sharp(full).metadata();
			expect(meta.format).toBe('png');
			expect([meta.width, meta.height]).toEqual([1200, 630]);
		}
	});

	test('every surface ogImage is its own card and exists in public/', async () => {
		// surfaces.ts cannot be imported here: it pulls in generated
		// files that only exist after the sync scripts run. Read it as
		// text instead and check each entry's ogImage against its slug.
		const source = await Bun.file(path.join(ROOT, 'src/data/surfaces.ts')).text();
		const entries = [...source.matchAll(/slug: '(?<slug>[^']+)',[\s\S]*?ogImage: surfaceOgImage\('(?<og>[^']+)'\)/g)];
		expect(entries.map((entry) => entry.groups?.slug).sort()).toEqual([...slugs].sort());
		for (const entry of entries) {
			expect(entry.groups?.og).toBe(entry.groups?.slug);
		}
		for (const slug of slugs) {
			const ogImage = surfaceOgImage(slug);
			expect(ogImage).toBe(`/og/surface-${slug}.png`);
			expect(existsSync(path.join(ROOT, 'public', ogImage))).toBe(true);
		}
	});

	test('no orphan surface-*.png without a surface', () => {
		const slugSet = new Set(slugs);
		for (const file of readdirSync(path.join(ROOT, 'public/og'))) {
			if (!file.startsWith('surface-')) continue;
			expect(slugSet.has(file.replace(/^surface-/, '').replace(/\.png$/, ''))).toBe(true);
		}
	});
});
