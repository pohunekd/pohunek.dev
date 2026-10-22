# DESIGN.md: Engraver & Phosphor

The visual system of pohunek.dev. It was generated with Google Stitch from the
pohunek brand (the farmhand engraving and logo mark) and is kept in a form
Stitch can load again (`upload_design_md`). `src/styles/tokens.css` is the
implementation; when a value here and the CSS disagree, the CSS wins and this
file is updated.

## Tokens

| Role | Token | Light | Dark |
|---|---|---|---|
| Page | `--paper` | `#fcf9f2` | `#15130f` |
| Raised sheet (cards) | `--paper-raised` | `#f6f3ec` | `#1d1a15` |
| Sunk sheet | `--paper-sunk` | `#f0eee7` | `#221e18` |
| Body text | `--ink` | `#1c1c18` | `#ece4d3` |
| Headings | `--ink-strong` | `#140b05` | `#f7f0e1` |
| Secondary text | `--ink-muted` | `#4d453f` | `#c2b6a2` |
| Hairline | `--rule` | `#d0c4bc` | `#3a332a` |
| Leather accent | `--leather` | `#775935` | `#d6ae7c` |
| Terminal background | `--terminal-bg` | `#1b1a17` | `#0d0c0a` |
| Phosphor (prompt, live) | `--phosphor` | `#7dda91` | `#7dda91` |
| Amber (captions, flags) | `--amber` | `#e7c094` | `#e7c094` |

Type: Domine (display, slab-like serif), Karla (body), JetBrains Mono (labels,
code, terminal). All three are self-hosted through Fontsource; the site makes
no third-party requests.

Shape: 2px radius on paper elements, 4px on terminals. No shadows, no
gradients, no blur. Depth comes from paper tones and hairlines.

Dark mode is the same system at night: parchment becomes dark soil, ink
becomes chalk, terminals stay terminals.

## Content rules

- Layout comes from this system; copy comes from the pohunek README and docs.
  Never ship invented specifications, metrics or protocols.
- Screenshots are real captures from synthetic sessions, or there is no
  screenshot.

## Brand & Style

The design system reconciles the mechanical precision of 19th-century letterpress engraving with the stark, functional utility of early CRT computing terminals. Built for pohunek.dev, this environment rejects contemporary software idioms—there are no vibrant indigo gradients, no frosted glass layers, and no rounded, candy-like buttons. Instead, the UI reads as an authoritative, tactile artifact: a field journal kept by a computational antiquarian.

The visual style is characterized by:
- **Ink on Parchment:** Broad surfaces constructed from unbleached cotton and aged rag papers, layered with razor-thin rules that echo copperplate etchings.
- **Terminal Incursions:** Interactive components, code listings, and technical diagnostic blocks puncture the archival paper as framed, high-contrast CRT voids.
- **Typographic Rigor:** Antique, heavy serifs for monumental display titles; pragmatic humanist grotesques for sustained reading; strictly metered monospace for terminal data and interface metadata.
- **Utilitarian Restraint:** Every rule, marginalia mark, or accent serves to clarify document architecture and operational status.

## Layout & Spacing

The layout philosophy mirrors broadsheet publications and archival registries, structured through a strict 12-column grid system bounded by physical margins:

- **Desktop (1200px+):** Max-width container of 1320px with 12 fluid columns, `1.5rem` gutters, and `3rem` side canvas margins. Marginalia, reference notes, and timestamp metadata sit in dedicated 2-to-3 column side tracks.
- **Tablet (768px – 1199px):** 8 columns with `1.5rem` gutters and `2rem` outer margins. Secondary side tracks collapse inline immediately above or below their parent sections.
- **Mobile (Below 768px):** Single-column layout with `1rem` column gutters and `1.25rem` canvas margins. Structural borders switch from horizontal multi-column grids to stacked, etched horizontal dividers.

Spacing adheres strictly to vertical rhythm multiples based on 4px and 8px units:
- Structural separators use `space-2xl` between broad thematic blocks.
- Components use `space-md` for standard interior padding and `space-xs`/`space-sm` for compact terminal line spacing.

## Elevation & Depth

This system avoids floating ambient shadows, blur effects, and artificial drop shadows. Visual depth is achieved through physical material juxtaposition and precise mechanical boundaries:

- **Level 0 (Base Canvas):** Raw parchment (`#FCF9F2`). The lowest stratum of the interface.
- **Level 1 (Laid Sheet / Card Layer):** Slightly denser paper (`#F1EBDD`), bound by a 1px solid hairline (`#DCD3C1`). Elements do not cast shadows; their perimeter is defined entirely by the contrast of paper grain and hairline ink.
- **Level 2 (Punched Terminal Voids):** Depressed surfaces cut into the page. Rendered in soot-black (`#131210`) with sharp internal inset containment lines (1px solid `#2B2118` or `1px solid #3E3024`). Terminal layers visually recede into the surface rather than levitating above it.
- **Level 3 (Overlay / Plate Inspections):** Modal sheets and floating inspector panels mimic tipped-in bookplates. They feature a sharp offset double border: a 1px solid `#2B2118` boundary flanked by a 1px gap and a second `#C8BEA8` outer boundary. A hard, solid 2px offset drop in `#2B2118` with zero blur radius may be used exclusively for active modal callouts.

## Components

### Buttons & Interactive Controls
- **Primary Action (Engraved Seal):** Solid `#2B2118` fill with `#FCF9F2` text, set in `JetBrains Mono` uppercase with `0.05em` letter-spacing. 1px solid `#2B2118` border. Hover state inverts to `#FAF7F0` background with `#2B2118` text and an interior 1px dashed guideline.
- **Secondary Action (Etched Rule):** Background in `#F1EBDD` with `#2B2118` text and a 1px solid `#8A6A45` border. On hover, background shifts to `#FCF9F2` with text turning `#8A6A45`.
- **Terminal Execution Trigger:** Black background (`#131210`), 1px solid `#457A51`, phosphor green (`#7BD88F`) text preceded by a persistent `$` or `>` glyph. On hover, the border becomes `#7BD88F` with a solid phosphor green text fill.

### Input Fields & Terminal Consoles
- **Paper Field (Parchment Context):** Background in `#FCF9F2` set within a 1px solid `#C8BEA8` frame. Typography is `Karla` regular in `#2B2118`. Focus state applies a double-line effect via a 1px solid `#8A6A45` border and a 1px solid `#8A6A45` outline offset by 1px.
- **Console Input (Terminal Context):** Background in `#131210`, zero outer border, flush text line with a solid blinking block cursor (`▋` in `#7BD88F`). Font is strictly `JetBrains Mono` in `#7BD88F`. Placeholder text is `#457A51`.

### Cards & Document Folios
- Constructed with `#F1EBDD` backgrounds and framed by 1px solid `#DCD3C1` hairlines.
- Header bars feature an antique decorative rule: a top border, followed by a title set in `Domine` bold, bordered below by a 1px solid hairline.
- Corner markers: Key cards display small typographic corner brackets (`+` or `⌜ ⌝`) in `#8A6A45` to emulate technical plotting points.

### Lists & Tables
- **Lists:** Bulleted lists eschew circular discs in favor of historical printer marks: section signs (`§`), right-pointing index hands, or simple typographic em-dashes (`—`) in `#8A6A45`.
- **Data Tables:** Rendered like accounting ledgers. Alternating row fills are prohibited; rows are separated exclusively by 1px horizontal hairlines in `#DCD3C1`. Table headers are rendered in `JetBrains Mono` uppercase (`label-sm`) with a heavier 1px `#2B2118` bottom border.

### Checkboxes & Radios
- **Checkboxes:** 14px by 14px square boxes, 0px radius, 1px solid `#3E3024`. Checked state displays a solid deep-ink typographic `✕` in `#2B2118`.
- **Radio Buttons:** 14px by 14px diamond or square rotated 45 degrees (or square marked with an internal filled 6px square), 1px solid `#3E3024`. Checked state fills the inner square with `#8A6A45`.

### Chips & Metadata Badges
- **Parchment Badges:** Height 22px, sharp corners, `#FCF9F2` background, 1px solid `#C8BEA8` border. Label in `JetBrains Mono` (`label-sm`), color `#3E3024`.
- **Terminal Status Badges:** Height 20px, `#1B1A17` background, 1px solid `#457A51`, glowing text in `#7BD88F`. Preceded by an ASCII status indicator (`[*]`, `[OK]`, `[!]`).

### CRT Window Frame (Specialty Component)
- Used for hosting interactive demos, live code, and terminal shells.
- Comprises an outer dark-charcoal bezel (`#1B1A17`), a top status bar displaying file paths or process IDs (`PID 0491 // READ-ONLY`) in `#457A51`, and an interior display screen in soot-black (`#131210`) with phosphor-green syntax and output.