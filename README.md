# dq_starterkit

A Drupal starterkit theme used by [drupal-quick](https://github.com/Drupal-Quick/drupal-quick). It provides a Tailwind CSS v4 + Vite build pipeline, a set of bundled design skins, and a homepage layout suited to a minimal blog or portfolio site.

It is not meant to be used directly. The `drush dq:scaffold` command generates a real theme from it via `drupal generate-theme`, then layers in a skin and any recipe theme-assets on top.

## What's inside

- **Tailwind CSS v4** with a CSS-first `@theme static` block. Tokens (`--color-paper`, `--color-ink`, `--color-muted`, `--color-rule`, `--spacing-row`) drive the reading surface; `dq:scaffold` rewrites the block between markers to apply the chosen skin and any `theme_design` overrides from `config.dq.yml`.
- **Vite** build. `npm run dev` starts HMR (a `.vite-dev` marker file signals the theme to swap to the dev server); `npm run build` writes `dist/`.
- **Design skins** in `skins/` — `minimal.css` and `corporate.css`. Skins override the token block and extend it. Available skins are advertised via `extra.dq.skins` in `composer.json` so `dq-init --interactive` can present them as choices.
- **Homepage layout** — `page.html.twig` (two-column: left vertical nav + right content), `page--front.html.twig` (article list with right-aligned dates), `menu.html.twig` (the primary nav, doubles as a slide-out drawer on mobile).
- **Mobile navigation** — pure CSS slide-out drawer, `main.js` only toggles `data-open` / `aria-expanded`. No framework.
- **View-transition crossfade** (Chromium-only, 75 ms) paired with Speculation Rules prerendering in `html.html.twig`. Non-Chromium browsers navigate normally.
- **Preprocess dispatcher** (`dq_starterkit_preprocess` in `dq_starterkit.theme`) — dispatches suggestion-based hooks that Drupal's base-hook fallback doesn't reach. Recipe `*.theme.inc` files hook into this dispatcher to register their own preprocessors without touching the theme's `.theme` file.

## Design tokens

| Token | Default | Purpose |
|---|---|---|
| `--color-primary` | `#1f2937` | Primary UI colour |
| `--color-secondary` | `#4b5563` | Secondary UI colour |
| `--color-accent` | `#374151` | Accent |
| `--color-paper` | `oklch(0.99 0.002 80)` | Page background |
| `--color-ink` | `oklch(0.22 0.004 80)` | Body text |
| `--color-muted` | `oklch(0.55 0.004 80)` | Secondary text, dates |
| `--color-rule` | `oklch(0.9 0.003 80)` | Hairline borders |
| `--spacing-row` | `0.5rem` | Vertical rhythm between article rows |
| `--font-sans` | system-ui stack | Body typeface |

Override any token in your `config.dq.yml` `theme_design` block — `dq:scaffold` merges them into the `@theme static` block of the generated theme.

## Skins

Each skin is a CSS file in `skins/` that replaces the default token block:

```
skins/
  minimal.css     — light, high-contrast reading surface
  corporate.css   — slightly warmer, branded tone
```

To add a skin: create `skins/your-skin.css` and add `"your-skin"` to `extra.dq.skins` in `composer.json`.

## Adding it to a project

`dq-init` / `dq:scaffold` handle this automatically. For manual use:

```bash
# 1. Install the theme
composer require drupal-quick/dq_starterkit

# 2. Generate a real theme from the starterkit
php core/scripts/drupal generate-theme my_theme \
    --starterkit dq_starterkit \
    --path web/themes/custom

# 3. Build assets
cd web/themes/custom/my_theme && npm install && npm run build
```

## Preprocess dispatcher

Drupal only invokes the most-specific *registered* suggestion hook. When a theme
hook fires as `node__article`, the base `node` hook fires instead (because
`node__article` was never registered). Similarly, Views registers
per-view hooks (`views_view__writing__page_1`), so the base `views_view` hook
never fires for them.

`dq_starterkit_preprocess()` in `dq_starterkit.theme` works around this by also
dispatching the base hook name whenever `$hook` contains `__`. Recipe
`.theme.inc` files can therefore register preprocessors under the most-specific
hook name and have them fire reliably:

```php
// In a recipe's blog.theme.inc — fires for node--article.html.twig:
function STARTERKIT_preprocess_node__article(array &$variables): void { … }
```

## Drupal version compatibility

`core_version_requirement: ^10.3 || ^11`
