# Quick — Drupal starter kit

A Drupal starterkit theme used by [Quick](https://github.com/Drupal-Quick/drupal-quick). It provides a Tailwind CSS v4 + Vite build pipeline, a set of swappable design presets, and a homepage layout suited to a minimal blog or portfolio site.

It is not meant to be used directly. The `drush dq:scaffold` command generates a real theme from it via `drupal generate-theme`, then applies the chosen preset and any recipe theme-assets on top.

## What's inside

- **Tailwind CSS v4** with a CSS-first `@theme static` block. Tokens (`--color-paper`, `--color-ink`, `--color-muted`, `--color-rule`, `--spacing-row`) drive the reading surface. The active preset's tokens live in a managed `dq:preset` block in `src/main.css`, written by `npm run preset` (see **Presets** below).
- **Vite** build. `npm run dev` starts HMR (a `.vite-dev` marker file signals the theme to swap to the dev server); `npm run build` writes `dist/`. A `prebuild` hook re-applies the active preset first, so a bare build is always self-contained.
- **Design presets** in `presets/` — `minimal`, `corporate`, and `geometric`. Each preset is a complete token set; the available presets and the default are declared in `package.json` under `dq.presets` / `dq.defaultPreset`, which `dq-init --interactive` reads to present them as choices.
- **Homepage layout** — `page.html.twig` (two-column: left vertical nav + right content), `page--front.html.twig` (article list with right-aligned dates), `menu.html.twig` (the primary nav, doubles as a slide-out drawer on mobile).
- **Mobile navigation** — pure CSS slide-out drawer, `main.js` only toggles `data-open` / `aria-expanded`. No framework.
- **View-transition crossfade** (Chromium-only, 75 ms) paired with Speculation Rules prerendering in `html.html.twig`. Non-Chromium browsers navigate normally.
- **Presentation hooks** — the theme carries its own procedural preprocess/alter hooks (`preprocess_html`, `preprocess_page`, `preprocess_node`, `page_attachments_alter`, `css_alter`) in `dq_starterkit.theme`, plus WebPage JSON-LD for basic pages. Recipe behaviour is *not* added here: recipes ship it as native `#[Hook]` OOP submodules that `dq:scaffold` assembles under an umbrella module, so multiple recipes can contribute preprocess without colliding in the theme namespace.

## Design tokens

| Token | Default | Purpose |
|---|---|---|
| `--color-primary` | `#111827` | Primary UI colour |
| `--color-secondary` | `#4b5563` | Secondary UI colour |
| `--color-accent` | `#374151` | Accent |
| `--color-paper` | `oklch(0.99 0.002 80)` | Page background |
| `--color-ink` | `oklch(0.22 0.004 80)` | Body text |
| `--color-muted` | `oklch(0.55 0.004 80)` | Secondary text, dates |
| `--color-rule` | `oklch(0.9 0.003 80)` | Hairline borders |
| `--spacing-row` | `0.5rem` | Vertical rhythm between article rows |
| `--font-sans` | `'Inter', ui-sans-serif, system-ui, sans-serif` | Body typeface |

The defaults above are the `minimal` preset. Override any token in your `config.dq.yml` `theme_design` block — `dq:scaffold` persists those to `presets/overrides.css`, which `npm run preset` layers on top of the chosen preset.

## Presets

Each preset is a complete set of `@theme` tokens. Apply or switch with:

```bash
npm run preset            # apply the active (or default) preset, then build
npm run preset corporate  # switch to a named preset, then build
```

Two forms:

```
presets/minimal.css        # simple: just the @theme tokens
presets/geometric/
├── preset.css             # the @theme tokens
└── fonts.json             # optional: self-hosted webfonts (pinned URL + sha256)
```

Fonts are pulled **on demand**, never committed: `fonts.json` pins each webfont's
download URL + `sha256`, and `npm run preset` fetches it into `src/fonts/`
(gitignored, verified), generates the `@font-face`, and bundles it into `dist/` —
so the built site self-hosts with no external font request (good for the static
export). A first build therefore needs network access.

To add a preset: create `presets/<name>.css` (or the directory form with
`fonts.json`) and add `"<name>"` to `dq.presets` in `package.json`. See the
full design in [Quick's `docs/presets.md`](https://github.com/Drupal-Quick/drupal-quick/blob/main/docs/presets.md).

## Adding it to a project

`dq-init` / `dq:scaffold` handle this automatically. For manual use:

```bash
# 1. Install the theme
composer require drupal-quick/dq_starterkit

# 2. Generate a real theme from the starterkit (11.4+: use the consolidated
#    core CLI; on 11.3 use `php web/core/scripts/drupal generate-theme` instead)
php vendor/bin/dr generate-theme my_theme \
    --starterkit dq_starterkit \
    --path web/themes/custom

# 3. Install deps and apply a preset (builds assets)
cd web/themes/custom/my_theme && npm install && npm run preset
```

## Drupal version compatibility

`core_version_requirement: ^11.3` (Quick is tested on Drupal 11.3 and 11.4)
