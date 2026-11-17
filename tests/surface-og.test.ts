import { describe, expect, test } from 'bun:test';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dir, '..');

const EXPECTED = ['android', 'companion', 'omarchy', 'sway', 'tui', 'web'];

describe('surface og images', () => {
	test('one 1200x630 PNG per surface slug', async () => {
		const files = readdirSync(path.join(ROOT, 'public/og'))
			.filter((file) => file.startsWith('surface-'))
			.sort();
		expect(files).toEqual(EXPECTED.map((slug) => `surface-${slug}.png`).sort());
		for (const file of files) {
			const full = path.join(ROOT, 'public/og', file);
			expect(statSync(full).size).toBeGreaterThan(10_000);
			const meta = await sharp(full).metadata();
			expect(meta.format).toBe('png');
			expect([meta.width, meta.height]).toEqual([1200, 630]);
		}
	});

	test('generator and surface data agree on the card set', async () => {
		const generator = await Bun.file(path.join(ROOT, 'scripts/generate-surface-og.ts')).text();
		const surfaces = await Bun.file(path.join(ROOT, 'src/data/surfaces.ts')).text();
		for (const slug of EXPECTED) {
			expect(generator).toContain(`slug: '${slug}'`);
			expect(surfaces).toContain(`ogImage: '/og/surface-${slug}.png'`);
		}
	});
});
