/**
 * Renders one link preview image per surface page into public/og/.
 *
 * Layout follows the spirit of public/og/autoreview.png: the same site
 * colours (src/styles/site.css tokens), the same site fonts (Domine for the
 * title and the banner caption, Karla for the lead, JetBrains Mono for the
 * kicker and the URL) and the same sizes (kicker 22, title 84, lead 34,
 * caption 24, URL 26; nothing under 22 px at 1200x630).
 *
 * The reference card puts the engraving on the right of every text line,
 * but surface names are too wide for that at 84 px, so the title spans the
 * full width and the engraving sits in a framed plate beside the lead.
 *
 * Texts mirror the page data, so a surface rename or resummary needs a
 * re-render, not an edit here:
 * - title = surface.name in src/data/surfaces.ts
 * - kicker = surface.platform in src/data/surfaces.ts, uppercased
 * - lead = surface.summary in src/data/surfaces.ts, wrapped to fit
 * - caption = banner.caption in src/data/banners.ts, wrapped to fit
 * - art = src/assets/brand/banner-<slug>.png, cover-cropped into the plate
 *
 * Run: bun scripts/generate-surface-og.ts
 * Tools: only bun and the sharp devDependency (its bundled librsvg renders
 * the text SVG with the woff fonts from node_modules/@fontsource).
 */

import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dir, '..');
const FONT = (family: string, weight: number) =>
	`file://${ROOT}/node_modules/@fontsource/${family}/files/${family}-latin-${weight}-normal.woff`;

const FACES = `
@font-face { font-family: 'Domine'; font-weight: 700; src: url('${FONT('domine', 700)}'); }
@font-face { font-family: 'Domine'; font-weight: 400; src: url('${FONT('domine', 400)}'); }
@font-face { font-family: 'Karla'; font-weight: 400; src: url('${FONT('karla', 400)}'); }
@font-face { font-family: 'Mono'; font-weight: 400; src: url('${FONT('jetbrains-mono', 400)}'); }
`;

const PAPER = '#fcf9f2';
const PAPER_RAISED = '#f6f3ec';
const RULE_STRONG = '#7f756e';
const INK_STRONG = '#140b05';
const INK = '#1c1c18';
const INK_MUTED = '#4d453f';
const LEATHER = '#775935';

interface Card {
	slug: string;
	title: string;
	kicker: string;
	lead: string;
	caption: string;
}

const CARDS: readonly Card[] = [
	{
		slug: 'companion',
		title: 'Desktop companion',
		kicker: 'LINUX · WAYLAND · MACOS',
		lead: 'A narrow native sidebar that lifts the sessions needing you to the top, with a tray badge and one-click attach.',
		caption: 'The companion notices which one stopped.',
	},
	{
		slug: 'android',
		title: 'Android companion',
		kicker: 'ANDROID',
		lead: 'A remote session list with live state and an embedded terminal over the NetBird overlay.',
		caption: 'Take a nap. The phone keeps watch.',
	},
	{
		slug: 'omarchy',
		title: 'Omarchy bar widget',
		kicker: 'OMARCHY · HYPRLAND',
		lead: 'Every agent session on every machine in your Omarchy bar: the ones that need you on top, one click to a real terminal.',
		caption: 'The raised flag goes first. One touch opens the terminal.',
	},
	{
		slug: 'tui',
		title: 'Terminal TUI',
		kicker: 'LINUX · MACOS TERMINAL',
		lead: 'pohunek-work tui: Work, Sessions, Hosts and Activity views in one full-screen terminal interface.',
		caption: 'One terminal is enough. The cat agrees.',
	},
	{
		slug: 'sway',
		title: 'Sway + rofi launcher',
		kicker: 'LINUX · WAYLAND (SWAY)',
		lead: 'Quick-switch attached agent terminals with a keybind and start work on Linear issues or GitHub PRs from rofi.',
		caption: 'One key, and the herd turns.',
	},
	{
		slug: 'web',
		title: 'Web control center',
		kicker: 'LINUX · MACOS',
		lead: 'An experimental self-hosted dashboard with a session rail across all hosts. It works, but it still needs a lot of polish.',
		caption: 'Still under construction. Bring a hammer.',
	},
];

// Geometry of the 1200x630 card.
const TEXT_X = 58;
const KICKER_Y = 92;
const TITLE_Y = 182;
const LEAD_FIRST_Y = 252;
const LEAD_STEP = 44;
const CAPTION_GAP = 56;
const CAPTION_STEP = 30;
const URL_Y = 585;
const PLATE = { x: 700, y: 250, w: 442, h: 310, pad: 12 };
/** Ink of a wrapped text line may reach this far right; the plate starts at 700. */
const TEXT_MAX_INK = 648;
const LEAD_MAX_INK = TEXT_MAX_INK - TEXT_X;

function escapeXml(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

interface TextSpec {
	text: string;
	size: number;
	family: string;
	weight?: number;
	style?: string;
	letterSpacing?: number;
}

const widthCache = new Map<string, number>();

/** Ink width of one line, measured by rendering it through the same engine. */
async function inkWidth(spec: TextSpec): Promise<number> {
	const key = JSON.stringify(spec);
	const cached = widthCache.get(key);
	if (cached !== undefined) return cached;
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="120"><style>${FACES}</style>` +
		`<rect width="1200" height="120" fill="${PAPER}"/>` +
		`<text x="0" y="90" font-size="${spec.size}" font-family="${spec.family}"` +
		` font-weight="${spec.weight ?? 400}" font-style="${spec.style ?? 'normal'}"` +
		` letter-spacing="${spec.letterSpacing ?? 0}" fill="${INK_STRONG}">${escapeXml(spec.text)}</text></svg>`;
	const { data, info } = await sharp(Buffer.from(svg))
		.raw()
		.toBuffer({ resolveWithObject: true });
	let max = -1;
	for (let x = 0; x < info.width; x++) {
		for (let y = 0; y < info.height; y++) {
			const i = (y * info.width + x) * info.channels;
			if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 140) {
				max = x;
				break;
			}
		}
	}
	widthCache.set(key, max);
	return max;
}

/** Greedy wrap; every line is measured, so the layout can never silently overflow. */
async function wrap(text: string, spec: Omit<TextSpec, 'text'>, maxInk: number): Promise<string[]> {
	const words = text.split(' ');
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (!current || (await inkWidth({ ...spec, text: candidate })) <= maxInk) {
			current = candidate;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines;
}

const LEAD_SPEC = { size: 34, family: 'Karla' };
const CAPTION_SPEC = { size: 24, family: 'Domine', style: 'italic' };

async function renderCard(card: Card): Promise<void> {
	const leadLines = await wrap(card.lead, LEAD_SPEC, LEAD_MAX_INK);
	const captionLines = await wrap(card.caption, CAPTION_SPEC, LEAD_MAX_INK);
	const leadLastY = LEAD_FIRST_Y + (leadLines.length - 1) * LEAD_STEP;
	// Keep the caption in one zone no matter how many lead lines precede it.
	const captionFirstY = Math.max(leadLastY + CAPTION_GAP, LEAD_FIRST_Y + 3 * LEAD_STEP);

	const texts: string[] = [
		`<text x="${TEXT_X}" y="${KICKER_Y}" font-size="22" font-family="Mono" letter-spacing="2.5" fill="${LEATHER}">${escapeXml(card.kicker)}</text>`,
		`<text x="${TEXT_X}" y="${TITLE_Y}" font-size="84" font-family="Domine" font-weight="700" fill="${INK_STRONG}">${escapeXml(card.title)}</text>`,
		...leadLines.map(
			(line, i) =>
				`<text x="${TEXT_X}" y="${LEAD_FIRST_Y + i * LEAD_STEP}" font-size="34" font-family="Karla" fill="${INK_MUTED}">${escapeXml(line)}</text>`,
		),
		...captionLines.map(
			(line, i) =>
				`<text x="${TEXT_X}" y="${captionFirstY + i * CAPTION_STEP}" font-size="24" font-family="Domine" font-style="italic" fill="${INK}">${escapeXml(line)}</text>`,
		),
		`<text x="${TEXT_X}" y="${URL_Y}" font-size="26" font-family="Mono" fill="${INK_STRONG}">pohunek.dev/surfaces/<tspan fill="${LEATHER}">${escapeXml(card.slug)}</tspan></text>`,
	];

	// Fail fast instead of shipping an overflowing card.
	const checks: Array<[string, TextSpec, number]> = [
		['title', { text: card.title, size: 84, family: 'Domine', weight: 700 }, 1200 - TEXT_X],
		['kicker', { text: card.kicker, size: 22, family: 'Mono', letterSpacing: 2.5 }, 1200 - TEXT_X],
		...leadLines.map((line): [string, TextSpec, number] => ['lead', { ...LEAD_SPEC, text: line }, LEAD_MAX_INK]),
		...captionLines.map(
			(line): [string, TextSpec, number] => ['caption', { ...CAPTION_SPEC, text: line }, LEAD_MAX_INK],
		),
	];
	for (const [kind, spec, maxInk] of checks) {
		const width = await inkWidth(spec);
		if (width > maxInk) {
			throw new Error(`${card.slug}: ${kind} line overflows by ${width - maxInk}px: ${spec.text}`);
		}
	}

	const artWidth = PLATE.w - PLATE.pad * 2;
	const artHeight = PLATE.h - PLATE.pad * 2;
	const art = await sharp(path.join(ROOT, `src/assets/brand/banner-${card.slug}.png`))
		.resize(artWidth, artHeight, { fit: 'cover' })
		.toBuffer();

	const overlay =
		`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><style>${FACES}</style>` +
		`<rect x="${PLATE.x}" y="${PLATE.y}" width="${PLATE.w}" height="${PLATE.h}" fill="none" stroke="${RULE_STRONG}" stroke-width="2"/>` +
		`${texts.join('')}</svg>`;

	await sharp({
		create: { width: 1200, height: 630, channels: 3, background: PAPER },
	})
		.composite([
			{
				input: {
					create: {
						width: PLATE.w,
						height: PLATE.h,
						channels: 3,
						background: PAPER_RAISED,
					},
				},
				left: PLATE.x,
				top: PLATE.y,
			},
			{ input: art, left: PLATE.x + PLATE.pad, top: PLATE.y + PLATE.pad },
			{ input: Buffer.from(overlay), left: 0, top: 0 },
		])
		.png({ compressionLevel: 9 })
		.toFile(path.join(ROOT, `public/og/surface-${card.slug}.png`));
	console.log(`surface-${card.slug}.png: ${leadLines.length} lead lines, ${captionLines.length} caption lines`);
}

for (const card of CARDS) {
	await renderCard(card);
}
