/**
 * Card text as glyph outlines for scripts/generate-surface-og.ts.
 *
 * The librsvg inside sharp resolves SVG `<text>` through fontconfig and
 * ignores `@font-face`, so card text depends on host fonts. This module
 * opens the real @fontsource woff files with fontkitten instead, lays each
 * line out from glyph advances and emits `<path>` elements. The SVG the
 * generator renders then contains no `<text>` and no font lookup at all.
 */

import { create } from 'fontkitten';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..', '..');

/** Site font files; the same woff files the site serves. */
export const FONT_FILES = {
	domineBold: 'node_modules/@fontsource/domine/files/domine-latin-700-normal.woff',
	karla: 'node_modules/@fontsource/karla/files/karla-latin-400-normal.woff',
	karlaItalic: 'node_modules/@fontsource/karla/files/karla-latin-400-italic.woff',
	mono: 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff',
} as const;

export type SiteFamily = 'Domine' | 'Karla' | 'Mono';
export type SiteStyle = 'normal' | 'italic';

export interface TextSpec {
	text: string;
	family: SiteFamily;
	size: number;
	style?: SiteStyle;
	letterSpacing?: number;
}

interface SiteFont {
	unitsPerEm: number;
	advance: (text: string) => number;
	paths: (text: string) => Array<{ d: string; advance: number }>;
	hasGlyph: (char: string) => boolean;
}

function openFont(file: string): SiteFont {
	const absolute = path.isAbsolute(file) ? file : path.join(ROOT, file);
	if (!existsSync(absolute)) {
		throw new Error(`site font missing: ${absolute}`);
	}
	// fontkitten's Glyph type is not exported with path details, so the
	// font object stays untyped past this boundary.
	// biome-ignore lint/suspicious/noExplicitAny: untyped fontkitten font object
	const font: any = create(readFileSync(absolute));
	return {
		unitsPerEm: font.unitsPerEm as number,
		advance: (text: string): number => {
			let total = 0;
			for (const glyph of font.glyphsForString(text)) {
				total += glyph.advanceWidth as number;
			}
			return total;
		},
		paths: (text: string): Array<{ d: string; advance: number }> =>
			font.glyphsForString(text).map((glyph: any) => ({
				d: glyph.path.toSVG() as string,
				advance: glyph.advanceWidth as number,
			})),
		hasGlyph: (char: string): boolean =>
			font.hasGlyphForCodePoint(char.codePointAt(0) ?? 0) as boolean,
	};
}

export interface SiteFonts {
	Domine: SiteFont;
	Karla: SiteFont;
	KarlaItalic: SiteFont;
	Mono: SiteFont;
}

/** Open all four site fonts; throws when any file is missing. */
export function loadSiteFonts(): SiteFonts {
	return {
		Domine: openFont(FONT_FILES.domineBold),
		Karla: openFont(FONT_FILES.karla),
		KarlaItalic: openFont(FONT_FILES.karlaItalic),
		Mono: openFont(FONT_FILES.mono),
	};
}

function fontFor(fonts: SiteFonts, spec: Pick<TextSpec, 'family' | 'style'>): SiteFont {
	if (spec.family === 'Domine') return fonts.Domine;
	if (spec.family === 'Karla') return spec.style === 'italic' ? fonts.KarlaItalic : fonts.Karla;
	return fonts.Mono;
}

/** Advance width of one line in px, including letter-spacing. */
export function measureLine(fonts: SiteFonts, spec: TextSpec): number {
	const font = fontFor(fonts, spec);
	return (
		(font.advance(spec.text) / font.unitsPerEm) * spec.size +
		(spec.letterSpacing ?? 0) * Math.max(0, [...spec.text].length - 1)
	);
}

/** Greedy wrap; every line is measured, so the layout can never silently overflow. */
export function wrapLine(fonts: SiteFonts, text: string, spec: Omit<TextSpec, 'text'>, maxWidth: number): string[] {
	const words = text.split(' ');
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (!current || measureLine(fonts, { ...spec, text: candidate }) <= maxWidth) {
			current = candidate;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines;
}

/** Assert every glyph the cards use exists in its font file. Fails the run if not. */
export function assertCardCoverage(
	fonts: SiteFonts,
	specs: Array<{ text: string; family: SiteFamily; style?: SiteStyle }>,
): void {
	for (const spec of specs) {
		const font = fontFor(fonts, spec);
		for (const char of spec.text) {
			if (!font.hasGlyph(char)) {
				throw new Error(`site font ${spec.family} has no glyph for ${JSON.stringify(char)}`);
			}
		}
	}
}

function escapePath(d: string): string {
	return d.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * One line of text as SVG paths: each glyph outline placed at its advance
 * offset on the baseline, y-flipped from font units to SVG coordinates.
 * No `<text>`, no font-family, no host dependency.
 */
export function drawText(fonts: SiteFonts, spec: TextSpec, x: number, baselineY: number, fill: string): string {
	const font = fontFor(fonts, spec);
	const scale = spec.size / font.unitsPerEm;
	const spacing = spec.letterSpacing ?? 0;
	let cursor = x;
	let out = '';
	for (const glyph of font.paths(spec.text)) {
		out += `<path d="${escapePath(glyph.d)}" transform="translate(${cursor} ${baselineY}) scale(${scale} ${-scale})" fill="${fill}"/>`;
		cursor += glyph.advance * scale + spacing;
	}
	return out;
}
