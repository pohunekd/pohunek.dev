import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { surfaces } from '../src/data/surfaces.ts';

const ROOT = path.resolve(import.meta.dir, '..');

const slugs = surfaces.map((surface) => surface.slug).sort();

describe('surface og images', () => {
	test('one 1200x630 PNG per surface slug', async () => {
		const files = readdirSync(path.join(ROOT, 'public/og'))
			.filter((file) => file.startsWith('surface-'))
			.sort();
		expect(files).toEqual(slugs.map((slug) => `surface-${slug}.png`));
		for (const file of files) {
			const full = path.join(ROOT, 'public/og', file);
			expect(statSync(full).size).toBeGreaterThan(10_000);
			const meta = await sharp(full).metadata();
			expect(meta.format).toBe('png');
			expect([meta.width, meta.height]).toEqual([1200, 630]);
		}
	});

	test('every surface ogImage file exists in public/', () => {
		for (const surface of surfaces) {
			expect(surface.ogImage).toStartWith('/og/surface-');
			expect(existsSync(path.join(ROOT, 'public', surface.ogImage))).toBe(true);
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
