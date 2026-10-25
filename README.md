<p align="center">
  <img src=".github/assets/readme-hero.png" alt="pohunek.dev: website and documentation for pohunek. Engraving of a farmhand pulling a hand printing press while a farm girl lifts a fresh sheet." />
</p>

# pohunek.dev

Website and documentation for [pohunek](https://github.com/zajca/pohunek), the
headless multihost backbone for coding agents. Served at https://pohunek.dev
from GitHub Pages.

## Layout

| Path | Content |
|---|---|
| `src/pages/` | Landing, why, surfaces, plugins, roadmap, install |
| `src/content/docs/docs/` | Generated documentation (gitignored, see below) |
| `src/data/` | Page data: landing copy, surfaces, roadmap, page banners |
| `src/config/agents.mjs` | `llms.txt`, `robots.txt` and `/.well-known/security.txt` settings |
| `src/styles/` | Design tokens and styles, see [DESIGN.md](DESIGN.md) |
| `scripts/sync-docs.ts` | Pulls pohunek's docs at the pinned release |
| `pohunek.config.json` | The pinned pohunek repository and release tag |
| `scripts/sync-screenshots.ts` | Pulls the Android screenshot set at the pinned release |
| `android.config.json` | The pinned Android repository and release tag |
| `.github/assets/` | README hero of this repository |

The documentation is never edited here. `scripts/sync-docs.ts` takes a
whitelisted set of files from `zajca/pohunek` at the tag in
`pohunek.config.json`, rewrites their links and writes them into the Starlight
content collection. Fix docs upstream, then bump the tag.

Agents get the same docs as plain text: `starlight-llms-txt` renders
`/llms.txt`, `/llms-full.txt`, `/llms-small.txt` and the sets under
`/_llms-txt/`, and `/install-prompt.txt` serves the README install prompt.
`/.well-known/security.txt` gets a fresh `Expires` on every build, so the site
needs a deploy at least every 180 days.

## Android screenshots

The Android gallery on `/surfaces/android/` is never edited here either. The
Android repository commits the canonical set as `docs/screenshots/*.png` with a
`manifest.json` (schema 1: captions, alt text, sizes and SHA-256 digests), and
every release tag contains it. `scripts/sync-screenshots.ts` reads the manifest
at the tag in `android.config.json`, checks each image against its digest and
size, writes the images to `src/assets/screenshots/android/` and the module
`src/data/generated/android-screenshots.ts` (both gitignored). It fails, naming
the ref, when the manifest is missing, has another schema, lists a missing
file, or an image differs from the manifest; it never renders an empty gallery.

To follow a new Android release, edit `ref` in `android.config.json` to the
release tag, run `bun run build`, and open a pull request. The pin on `main`
is always a release tag, never a branch or a commit.

To try a checkout or a branch before it is tagged:

```bash
bun scripts/sync-screenshots.ts --source ../pohunek-companion-android --ref main
```

## Develop

```bash
bun install
bun run dev        # syncs docs and screenshots, then starts the dev server
bun test           # tests for the docs sync transforms and the screenshot manifest
bun run build      # syncs docs and screenshots, then builds dist/
```

## Deploy

`.github/workflows/deploy.yml` builds every push and pull request. The deploy
job runs on `main` only when the repository variable `PAGES_ENABLED` is
`true`, which is set once GitHub Pages (source: GitHub Actions) and the custom
domain are configured.
