/**
 * Renders one link preview image per surface page into public/og/.
 *
 * Layout follows the spirit of public/og/autoreview.png: the site colours
 * from src/styles/tokens.css, the site fonts from node_modules/@fontsource
 * and the sizes kicker 22, title 84, lead 34, caption 24, URL 26 (nothing
 * under 22 px at 1200x630).
 *
 * The reference card puts the engraving on the right of every text line,
 * but surface names are too wide for that at 84 px, so the title spans the
 * full width and the engraving sits in a framed plate beside the lead.
 *
 * Texts come from the page data, so a surface rename or resummary needs a
 * re-render, not an edit here: title is surface.name, kicker is
 * surface.platform uppercased and lead is surface.summary (all from
 * src/data/surfaces.ts); caption is banner.caption and art is the banner
 * image (both derived from src/data/banners.ts, which points at
 * src/assets/brand/banner-<slug>.png).
 *
 * Card texts are drawn as glyph outlines, not SVG `<text>`: the librsvg
 * inside sharp resolves text through fontconfig and ignores @font-face, so
 * `<text>` falls back to host fonts. scripts/lib/og-draw.ts opens the real
 * @fontsource woff files with fontkitten instead and emits each line as
 * `<path>` elements, so the render input contains no `<text>` and the six
 * PNGs use the real site fonts whatever the host has installed.
 *
 * Run: bun scripts/generate-surface-og.ts
 * Tools: only bun and the sharp + fontkitten dependencies. No new package,
 * no network fetch. Fails with a non-zero exit instead of shipping an
 * overflowing, overlapping or out-of-canvas card.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { banners } from '../src/data/banners.ts';
import { surfaces } from '../src/data/surfaces.ts';
import { assertCardCoverage, drawText, loadSiteFonts, measureLine, wrapLine } from './lib/og-draw.ts';
import type { SiteFonts, TextSpec } from './lib/og-draw.ts';

const ROOT = path.resolve(import.meta.dir, '..');

const KICKER_SPEC = { family: 'Mono', size: 22, letterSpacing: 2.5 } as const;

/**
 * Card colours come from the light `:root` block of src/styles/tokens.css,
 * parsed here so a palette change updates the cards on re-render. Fails
 * hard when a token the card uses is missing.
 */
function readToken(css: string, name: string): string {
	const light = css.split(":root[data-theme='dark']")[0];
	const match = light.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
	if (!match) throw new Error(`token --${name} missing in src/styles/tokens.css`);
	return match[1].toLowerCase();
}

const TOKEN_CSS = readFileSync(path.resolve(import.meta.dir, '..', 'src/styles/tokens.css'), 'utf8');
const PAPER = readToken(TOKEN_CSS, 'paper');
const PAPER_RAISED = readToken(TOKEN_CSS, 'paper-raised');
const RULE_STRONG = readToken(TOKEN_CSS, 'rule-strong');
const RULE = readToken(TOKEN_CSS, 'rule');
const INK_STRONG = readToken(TOKEN_CSS, 'ink-strong');
const INK = readToken(TOKEN_CSS, 'ink');
const INK_MUTED = readToken(TOKEN_CSS, 'ink-muted');
const LEATHER = readToken(TOKEN_CSS, 'leather');

// Geometry of the 1200x630 card.
const WIDTH = 1200;
const HEIGHT = 630;
const TEXT_X = 58;
const KICKER_Y = 92;
const TITLE_Y = 182;
const LEAD_FIRST_Y = 252;
const LEAD_STEP = 44;
const CAPTION_GAP = 56;
const CAPTION_FIXED_Y = LEAD_FIRST_Y + 3 * LEAD_STEP;
const CAPTION_STEP = 30;
const URL_Y = 585;
/** y of the separator rule drawn above the URL. */
const RULE_Y = URL_Y - 42;
/** Clear space between the lowest caption ink and the separator rule, so a descender can never strike through it. */
const RULE_CLEARANCE = 8;
const PLATE = { x: 700, y: 242, w: 442, h: 310, pad: 12 };
/** Right edge of the text column; the plate starts 52 px further right. */
const TEXT_MAX_X = 648;

function urlText(slug: string): { stem: string; suffix: string } {
	return { stem: 'pohunek.dev/surfaces/', suffix: slug };
}

/**
 * Ink limit for full-width lines (title, kicker, URL): the left margin is
 * TEXT_X and the right margin matches it, so ink never touches the canvas
 * edge (some previews round corners or crop to 1.91:1).
 */
const FULL_MAX_WIDTH = WIDTH - 2 * TEXT_X;

interface Card {
	slug: string;
	kicker: string;
	title: string;
	lead: string[];
	caption: string[];
}

function cardForSlug(fonts: SiteFonts, slug: string): Card {
	const surface = surfaces.find((entry) => entry.slug === slug);
	if (!surface) throw new Error(`no surface for slug ${slug}`);
	const banner = banners[surface.slug as keyof typeof banners];
	if (!banner) throw new Error(`no banner caption for slug ${slug}`);
	const kicker = surface.platform.toLocaleUpperCase('en-US');
	const maxInk = TEXT_MAX_X - TEXT_X;
	const lead = wrapLine(fonts, surface.summary, { family: 'Karla', size: 34 }, maxInk);
	const caption = wrapLine(fonts, banner.caption, { family: 'Karla', size: 24, style: 'italic' }, maxInk);
	return { slug, kicker, title: surface.name, lead, caption };
}

/**
 * Guard both axes before rendering: every line stays inside its column, and
 * the lowest caption ink (last baseline plus the caption font's descender
 * at its size) stays RULE_CLEARANCE above the separator rule. Throws on
 * failure so the run exits non-zero instead of shipping a broken card.
 */
function assertCardFits(fonts: SiteFonts, card: Card): void {
	const maxInk = TEXT_MAX_X - TEXT_X;
	const maxRight = TEXT_X + maxInk;
	const checks: Array<{ kind: string; spec: TextSpec; limit: number }> = [
		{ kind: 'title', spec: { text: card.title, family: 'Domine', size: 84 }, limit: FULL_MAX_WIDTH },
		{
			kind: 'kicker',
			spec: { text: card.kicker, family: 'Mono', size: 22, letterSpacing: 2.5 },
			limit: FULL_MAX_WIDTH,
		},
		...card.lead.map((line) => ({
			kind: 'lead',
			spec: { text: line, family: 'Karla', size: 34 } as TextSpec,
			limit: maxInk,
		})),
		...card.caption.map((line) => ({
			kind: 'caption',
			spec: { text: line, family: 'Karla', size: 24, style: 'italic' } as TextSpec,
			limit: maxInk,
		})),
		{
			kind: 'url',
			spec: { text: `pohunek.dev/surfaces/${card.slug}`, family: 'Mono', size: 26 },
			limit: FULL_MAX_WIDTH,
		},
	];
	for (const { kind, spec, limit } of checks) {
		const width = measureLine(fonts, spec);
		if (width > limit) {
			throw new Error(`${card.slug}: ${kind} line overflows by ${Math.ceil(width - limit)}px: ${spec.text}`);
		}
	}
	const captionFirstY = Math.max(LEAD_FIRST_Y + (card.lead.length - 1) * LEAD_STEP + CAPTION_GAP, CAPTION_FIXED_Y);
	const captionRight = Math.max(
		...card.caption.map((line) => TEXT_X + measureLine(fonts, { text: line, family: 'Karla', size: 24, style: 'italic' })),
	);
	if (captionRight > maxRight) {
		throw new Error(`${card.slug}: caption reaches past the text column`);
	}
	const captionSize = 24;
	const lastBaseline = captionFirstY + (card.caption.length - 1) * CAPTION_STEP;
	const lowestInk = lastBaseline + fonts.KarlaItalic.descenderPx(captionSize);
	if (lowestInk + RULE_CLEARANCE > RULE_Y) {
		throw new Error(
			`${card.slug}: caption ink reaches y=${lowestInk.toFixed(1)}, no room for the separator rule at y=${RULE_Y}`,
		);
	}
	if (PLATE.x + PLATE.w > WIDTH || PLATE.y + PLATE.h > HEIGHT) {
		throw new Error(`${card.slug}: art plate falls outside the ${WIDTH}x${HEIGHT} canvas`);
	}
}

/** Card texts as glyph outlines; the SVG has no `<text>` and no font lookup. */
function overlaySvg(fonts: SiteFonts, card: Card): string {
	const captionFirstY = Math.max(LEAD_FIRST_Y + (card.lead.length - 1) * LEAD_STEP + CAPTION_GAP, CAPTION_FIXED_Y);
	const lines: string[] = [
		drawText(fonts, { text: card.kicker, ...KICKER_SPEC }, TEXT_X, KICKER_Y, LEATHER),
		drawText(fonts, { text: card.title, family: 'Domine', size: 84 }, TEXT_X, TITLE_Y, INK_STRONG),
		...card.lead.map((line, i) =>
			drawText(fonts, { text: line, family: 'Karla', size: 34 }, TEXT_X, LEAD_FIRST_Y + i * LEAD_STEP, INK_MUTED),
		),
		...card.caption.map((line, i) =>
			drawText(
				fonts,
				{ text: line, family: 'Karla', size: 24, style: 'italic' },
				TEXT_X,
				captionFirstY + i * CAPTION_STEP,
				INK,
			),
		),
	];
	const url = urlText(card.slug);
	const stemSpec = { text: url.stem, family: 'Mono', size: 26 } as TextSpec;
	const stemWidth = measureLine(fonts, stemSpec);
	lines.push(drawText(fonts, stemSpec, TEXT_X, URL_Y, INK_STRONG));
	lines.push(
		drawText(
			fonts,
			{ text: url.suffix, family: 'Mono', size: 26 },
			TEXT_X + stemWidth,
			URL_Y,
			LEATHER,
		),
	);
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">` +
		`<rect x="${PLATE.x}" y="${PLATE.y}" width="${PLATE.w}" height="${PLATE.h}" fill="none" stroke="${RULE_STRONG}" stroke-width="2"/>` +
		`<line x1="${TEXT_X}" y1="${RULE_Y}" x2="${TEXT_X + (TEXT_MAX_X - TEXT_X)}" y2="${RULE_Y}" stroke="${RULE}" stroke-width="1"/>` +
		`<g>${lines.join('')}</g></svg>`
	);
}

const SCRATCH_REQUESTED = new Set(process.argv.slice(2));

const fonts = loadSiteFonts();

const slugs = surfaces.map((surface) => surface.slug);
if (SCRATCH_REQUESTED.size > 0) {
	for (const slug of SCRATCH_REQUESTED) {
		if (!slugs.includes(slug)) throw new Error(`unknown surface slug: ${slug}`);
	}
}
const renderSlugs = SCRATCH_REQUESTED.size > 0 ? [...SCRATCH_REQUESTED] : slugs;

const cards = renderSlugs.map((slug) => cardForSlug(fonts, slug));
for (const card of cards) assertCardFits(fonts, card);
assertCardCoverage(
	fonts,
	cards.flatMap((card) => [
		{ text: card.kicker, family: 'Mono' as const },
		{ text: card.title, family: 'Domine' as const },
		...card.lead.map((text) => ({ text, family: 'Karla' as const })),
		...card.caption.map((text) => ({ text, family: 'Karla' as const, style: 'italic' as const })),
		{ text: `pohunek.dev/surfaces/${card.slug}`, family: 'Mono' as const },
	]),
);

for (const card of cards) {
	const artWidth = PLATE.w - PLATE.pad * 2;
	const artHeight = PLATE.h - PLATE.pad * 2;
	const banner = banners[card.slug as keyof typeof banners];
	// banners.ts stores an Astro image import; under bun it resolves to the
	// source file path, which sharp reads directly, keeping art and caption
	// on the same data row so they can never drift apart.
	const artSource: string = banner.image as unknown as string;
	if (typeof artSource !== 'string' || !existsSync(artSource)) {
		throw new Error(`${card.slug}: banner art missing: ${String(banner.image).slice(0, 80)}`);
	}
	const art = await sharp(artSource).resize(artWidth, artHeight, { fit: 'cover' }).toBuffer();
	const overlay = overlaySvg(fonts, card);
	if (overlay.includes('<text')) throw new Error(`${card.slug}: overlay still uses SVG text`);
	await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: PAPER } })
		.composite([
			{
				input: { create: { width: PLATE.w, height: PLATE.h, channels: 3, background: PAPER_RAISED } },
				left: PLATE.x,
				top: PLATE.y,
			},
			{ input: art, left: PLATE.x + PLATE.pad, top: PLATE.y + PLATE.pad },
			{ input: Buffer.from(overlay), left: 0, top: 0 },
		])
		.png({ compressionLevel: 9 })
		.toFile(path.join(ROOT, `public/og/surface-${card.slug}.png`));
	console.log(`surface-${card.slug}.png: ${card.lead.length} lead lines, ${card.caption.length} caption lines`);
}
