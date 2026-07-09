#!/usr/bin/env node
/**
 * Apply a design preset to the theme.
 *
 *   npm run preset                 # apply the active/default preset, then build
 *   npm run preset corporate       # apply a named preset, then build
 *   npm run preset corporate -- --no-build
 *   npm run preset minimal -- --overrides=presets/overrides.css
 *   node scripts/preset.mjs --sync # re-apply the ACTIVE preset (no build)
 *
 * A preset is a complete set of Tailwind design tokens (an @theme block) living
 * in presets/<name>.css, or presets/<name>/preset.css for the directory form
 * that can also declare self-hosted webfonts in presets/<name>/fonts.json. This
 * script writes the chosen preset's tokens into the dq:preset block of
 * src/main.css, layers any persisted overrides (presets/overrides.css — written
 * by dq:scaffold from config.dq.yml's theme_design), materialises the preset's
 * fonts, then rebuilds. Tailwind v4 compiles @theme at build time, so changing a
 * preset always requires this rebuild — there is no pure runtime swap.
 *
 * Fonts are pulled ON DEMAND, not committed: fonts.json pins each webfont's URL
 * (a Google Fonts / gstatic woff2) and sha256, and this script downloads it into
 * src/fonts/ (gitignored) only when the preset that needs it is applied, then
 * generates the @font-face from the manifest. Nothing binary ships in the repo,
 * and unused presets cost only a little CSS + JSON. A first build therefore needs
 * network access (the assumption is you build right after cloning). Fonts already
 * present are reused; fonts no longer needed by the active preset are pruned.
 *
 * The active preset is persisted to package.json ("dq".activePreset) so a fresh
 * clone (where src/fonts/ and dist/ are gitignored) reproduces the committed
 * design: the `prebuild` hook runs this script with --sync before every build.
 *
 * Pure Node (global fetch + node:crypto, no dependencies); operates on relative
 * paths, so it works unchanged in the generated theme after drupal-quick has
 * removed itself.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const root = process.cwd();
const presetsDir = join(root, 'presets');
const mainCssPath = join(root, 'src', 'main.css');
const htmlTwigPath = join(root, 'templates', 'layout', 'html.html.twig');
const fontsDir = join(root, 'src', 'fonts');
const pkgPath = join(root, 'package.json');

// ---- arguments -----------------------------------------------------------
let name = null;
let noBuild = false;
let sync = false;
let overridesPath = null;
for (const arg of process.argv.slice(2)) {
  if (arg === '--no-build') noBuild = true;
  else if (arg === '--sync') sync = true;
  else if (arg.startsWith('--overrides=')) overridesPath = arg.slice('--overrides='.length);
  else if (!arg.startsWith('--')) name = arg;
}
// --sync re-applies the active preset to prepare a build; it never builds itself
// (the build it precedes does), and it must not change which preset is active.
if (sync) noBuild = true;

// ---- helpers -------------------------------------------------------------
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Reads package.json (raw object, preserving key order). */
function readPkg() {
  try { return JSON.parse(readFileSync(pkgPath, 'utf8')); }
  catch { return {}; }
}

/** package.json "dq" config (defaultPreset, presets, activePreset). */
function dqConfig() {
  return readPkg().dq ?? {};
}

/** Records the active preset in package.json (only when it changes). */
function setActivePreset(presetName) {
  const pkg = readPkg();
  pkg.dq ??= {};
  if (pkg.dq.activePreset === presetName) return;
  pkg.dq.activePreset = presetName;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

/** Returns the token file for a preset name, or null if it doesn't exist. */
function presetFile(presetName) {
  const dirForm = join(presetsDir, presetName, 'preset.css');
  if (existsSync(dirForm)) return dirForm;
  const fileForm = join(presetsDir, `${presetName}.css`);
  if (existsSync(fileForm)) return fileForm;
  return null;
}

/** Lists preset names declared in package.json "dq", else discoverable on disk. */
function availablePresets() {
  const declared = dqConfig().presets;
  if (Array.isArray(declared) && declared.length) return declared;
  if (!existsSync(presetsDir)) return [];
  const names = new Set();
  for (const entry of readdirSync(presetsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(presetsDir, entry.name, 'preset.css'))) names.add(entry.name);
    else if (entry.isFile() && entry.name.endsWith('.css') && entry.name !== 'overrides.css') names.add(entry.name.slice(0, -4));
  }
  return [...names];
}

/** Reads a directory-preset's fonts.json manifest (array of font descriptors). */
function fontsManifest(presetName) {
  const manifest = join(presetsDir, presetName, 'fonts.json');
  if (!existsSync(manifest)) return [];
  try {
    const data = JSON.parse(readFileSync(manifest, 'utf8'));
    return Array.isArray(data?.fonts) ? data.fonts : [];
  }
  catch { fail(`Invalid fonts.json in preset "${presetName}".`); }
}

/** Extracts `--name: value;` declarations from CSS into an ordered object. */
function parseTokens(css) {
  const tokens = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css)) !== null) tokens[m[1]] = m[2].trim();
  return tokens;
}

/** Replaces a marked block in `content`, or appends via `appendAfter` if
 * absent. `delims` is [open, close] for the marker comment syntax — CSS
 * block comments by default; pass ['{#', '#}'] for a Twig template. */
function setBlock(content, startMarker, endMarker, body, appendAfter, delims = ['/*', '*/']) {
  const [open, close] = delims;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(open)} ${startMarker}[\\s\\S]*?${esc(open)} ${endMarker} ${esc(close)}`);
  if (re.test(content)) return content.replace(re, body);
  return content.replace(appendAfter, `${appendAfter}\n\n${body}`);
}

/** Downloads a pinned webfont into src/fonts/ (verified), reusing any cached copy. */
async function ensureFont(font) {
  if (!font.file || !font.url) fail('Each fonts.json entry needs a "file" and "url".');
  const dest = join(fontsDir, font.file);
  if (existsSync(dest)) {
    // Reuse the cached file; re-verify if a hash is pinned.
    if (!font.sha256 || sha256(readFileSync(dest)) === font.sha256) return;
    console.warn(`⚠ Cached ${font.file} failed its hash; re-downloading.`);
  }
  console.log(`  ↓ fetching ${font.file} (${font.family})`);
  const res = await fetch(font.url);
  if (!res.ok) fail(`Failed to download ${font.url} (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (font.sha256 && sha256(buf) !== font.sha256) {
    fail(`Checksum mismatch for ${font.file}: expected ${font.sha256}, got ${sha256(buf)}.`);
  }
  mkdirSync(fontsDir, { recursive: true });
  writeFileSync(dest, buf);
}

/** Builds an @font-face rule from a manifest entry. */
function fontFace(font) {
  return [
    '@font-face {',
    `  font-family: '${font.family}';`,
    `  font-style: ${font.style ?? 'normal'};`,
    `  font-weight: ${font.weight ?? 400};`,
    `  font-display: ${font.display ?? 'swap'};`,
    `  src: url('./fonts/${font.file}') format('woff2');`,
    '}',
  ].join('\n');
}

/** Builds a <link rel="preload"> tag for a font manifest entry. Points at
 * dist/ (Vite's build output), which is what the browser actually fetches —
 * unlike the @font-face src in src/main.css, this line isn't rewritten by
 * the build, so it must already reference the served path. */
function preloadLink(font) {
  return `<link rel="preload" href="{{ base_path ~ directory }}/dist/${font.file}" as="font" type="font/woff2" crossorigin>`;
}

/** Removes any files in src/fonts/ not required by the active preset. */
function pruneFonts(keep) {
  if (!existsSync(fontsDir)) return;
  const wanted = new Set(keep.map((f) => f.file));
  for (const entry of readdirSync(fontsDir)) {
    if (!wanted.has(entry)) rmSync(join(fontsDir, entry));
  }
}

// ---- main ----------------------------------------------------------------
async function main() {
  const dq = dqConfig();

  // Resolve the preset: explicit name > (--sync) active > default, with a
  // resilient fallback if the resolved name has no token file.
  if (!name) name = sync ? (dq.activePreset || dq.defaultPreset || 'minimal') : (dq.defaultPreset || 'minimal');

  if (!presetFile(name)) {
    const available = availablePresets();
    if (available.length === 0) fail(`No presets found in ${presetsDir}.`);
    const fallback = available.includes('minimal') ? 'minimal' : [...available].sort()[0];
    console.warn(`⚠ Preset "${name}" not found; falling back to "${fallback}".`);
    name = fallback;
  }

  const file = presetFile(name);
  const isDir = file.endsWith(join(name, 'preset.css'));

  // ---- compose tokens: preset <- persisted overrides ---------------------
  const tokens = parseTokens(readFileSync(file, 'utf8'));
  const ovPath = overridesPath ? join(root, overridesPath) : join(presetsDir, 'overrides.css');
  const hasOverrides = existsSync(ovPath);
  if (hasOverrides) Object.assign(tokens, parseTokens(readFileSync(ovPath, 'utf8')));

  const lines = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  const presetBlock =
    '/* dq:preset:start — managed by `npm run preset`; edit presets/, not here */\n' +
    `@theme static {\n${lines}\n}\n` +
    '/* dq:preset:end */';

  if (!existsSync(mainCssPath)) fail(`Entry stylesheet not found: ${mainCssPath}`);
  let css = readFileSync(mainCssPath, 'utf8');
  css = setBlock(css, 'dq:preset:start', 'dq:preset:end', presetBlock, '@import "tailwindcss";');

  // ---- fonts: fetch on demand + generate @font-face ----------------------
  const fonts = isDir ? fontsManifest(name) : [];
  for (const font of fonts) await ensureFont(font);
  pruneFonts(fonts);

  const hasExtraInCss = /\/\* dq:preset-extra:start[\s\S]*?\/\* dq:preset-extra:end \*\//.test(css);
  if (fonts.length) {
    const extraBlock =
      `/* dq:preset-extra:start — @font-face generated from presets/${name}/fonts.json */\n` +
      fonts.map(fontFace).join('\n\n') +
      '\n/* dq:preset-extra:end */';
    css = setBlock(css, 'dq:preset-extra:start', 'dq:preset-extra:end', extraBlock, '/* dq:preset:end */');
  }
  else if (hasExtraInCss) {
    // Switching to a fontless preset — drop any stale @font-face block.
    css = css.replace(/\n*\/\* dq:preset-extra:start[\s\S]*?\/\* dq:preset-extra:end \*\//, '');
  }

  writeFileSync(mainCssPath, css);

  // ---- preload hints: cut the flash-of-unstyled-text window ---------------
  // font-display: swap (above) paints a fallback font immediately then swaps
  // once the webfont arrives — that swap is the point of `swap`, not a bug,
  // but browsers don't start fetching a font just because its @font-face
  // rule was parsed; they wait until they need it for visible text. A
  // preload starts the fetch immediately instead, shrinking that window.
  if (existsSync(htmlTwigPath)) {
    let twig = readFileSync(htmlTwigPath, 'utf8');
    const preloadBody = fonts.length
      ? `{# dq:preset-preload:start — managed by \`npm run preset\`; edit presets/, not here #}\n${fonts.map((f) => `    ${preloadLink(f)}`).join('\n')}\n    {# dq:preset-preload:end #}`
      : '{# dq:preset-preload:start — managed by `npm run preset`; edit presets/, not here #}\n    {# dq:preset-preload:end #}';
    twig = setBlock(twig, 'dq:preset-preload:start', 'dq:preset-preload:end', preloadBody, "<title>{{ head_title|safe_join(' | ') }}</title>", ['{#', '#}']);
    writeFileSync(htmlTwigPath, twig);
  }

  if (!sync) setActivePreset(name);
  console.log(`✔ Applied preset "${name}"${hasOverrides ? ' (+ overrides)' : ''}${fonts.length ? ` (+ ${fonts.length} font${fonts.length > 1 ? 's' : ''})` : ''}.`);

  // ---- rebuild (Tailwind @theme is compile-time) -------------------------
  if (noBuild) {
    if (!sync) console.log('  Skipped build (--no-build). Run `npm run build` to compile.');
  } else {
    // `npm run build` (not `vite build`) so the prebuild hook keeps main.css and
    // fonts in sync; --sync is guarded off above, so this can't recurse.
    execSync('npm run build', { cwd: root, stdio: 'inherit' });
  }
}

main().catch((err) => fail(err?.message ?? String(err)));
