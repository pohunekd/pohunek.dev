# pohunek.dev

Website and documentation for [pohunek](https://github.com/zajca/pohunek), the
headless multihost backbone for coding agents. Served at https://pohunek.dev
from GitHub Pages.

## Layout

| Path | Content |
|---|---|
| `src/pages/` | Landing, why, surfaces, plugins, roadmap, install |
| `src/content/docs/docs/` | Generated documentation (gitignored, see below) |
| `src/data/` | Page data: landing copy, surfaces, roadmap |
| `src/styles/` | Design tokens and styles, see [DESIGN.md](DESIGN.md) |
| `scripts/sync-docs.ts` | Pulls pohunek's docs at the pinned release |
| `pohunek.config.json` | The pinned pohunek repository and release tag |

The documentation is never edited here. `scripts/sync-docs.ts` takes a
whitelisted set of files from `zajca/pohunek` at the tag in
`pohunek.config.json`, rewrites their links and writes them into the Starlight
content collection. Fix docs upstream, then bump the tag.

## Develop

```bash
bun install
bun run dev        # syncs docs, then starts the dev server
bun test           # tests for the docs sync transforms
bun run build      # syncs docs and builds dist/
```

## Deploy

`.github/workflows/deploy.yml` builds every push and pull request. The deploy
job runs on `main` only when the repository variable `PAGES_ENABLED` is
`true`, which is set once GitHub Pages (source: GitHub Actions) and the custom
domain are configured.
