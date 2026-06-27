#!/usr/bin/env node
/**
 * Apply a design preset to the theme.
 *
 *   npm run preset                 # apply the default preset, then build
 *   npm run preset corporate       # apply a named preset, then build
 *   npm run preset corporate -- --no-build
 *   npm run preset minimal -- --overrides=presets/overrides.css
 *
 * A preset is a complete set of Tailwind design tokens (an @theme block) living
 * in presets/<name>.css, or presets/<name>/preset.css for the directory form
 * that can also ship fonts/ and an extra.css (e.g. @font-face). This script
 * writes the chosen preset's tokens into the dq:preset block of src/main.css,
 * layers any persisted overrides (presets/overrides.css — written by
 * dq:scaffold from config.dq.yml's theme_design), copies preset assets, then
 * rebuilds. Tailwind v4 compiles @theme at build time, so changing a preset
 * always requires this rebuild — there is no pure runtime swap.
 *
 * Pure Node (no dependencies); operates on relative paths, so it works
 * unchanged in the generated theme after drupal-quick has removed itself.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const presetsDir = join(root, 'presets');
const mainCssPath = join(root, 'src', 'main.css');

// ---- arguments -----------------------------------------------------------
let name = null;
let noBuild = false;
let overridesPath = null;
for (const arg of process.argv.slice(2)) {
  if (arg === '--no-build') noBuild = true;
  else if (arg.startsWith('--overrides=')) overridesPath = arg.slice('--overrides='.length);
  else if (!arg.startsWith('--')) name = arg;
}

// ---- helpers -------------------------------------------------------------
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };

/** Returns the token file for a preset name, or null if it doesn't exist. */
function presetFile(presetName) {
  const dirForm = join(presetsDir, presetName, 'preset.css');
  if (existsSync(dirForm)) return dirForm;
  const fileForm = join(presetsDir, `${presetName}.css`);
  if (existsSync(fileForm)) return fileForm;
  return null;
}

/** Lists preset names discoverable in presets/. */
function availablePresets() {
  if (!existsSync(presetsDir)) return [];
  const names = new Set();
  for (const entry of readdirSync(presetsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(presetsDir, entry.name, 'preset.css'))) names.add(entry.name);
    else if (entry.isFile() && entry.name.endsWith('.css') && entry.name !== 'overrides.css') names.add(entry.name.slice(0, -4));
  }
  return [...names];
}

/** package.json "dq" config (defaultPreset, presets). */
function dqConfig() {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dq ?? {}; }
  catch { return {}; }
}

/** Extracts `--name: value;` declarations from CSS into an ordered object. */
function parseTokens(css) {
  const tokens = {};
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css)) !== null) tokens[m[1]] = m[2].trim();
  return tokens;
}

/** Replaces a marked block in `css`, or appends via `appendAfter` if absent. */
function setBlock(css, startMarker, endMarker, body, appendAfter) {
  const re = new RegExp(`/\\* ${startMarker}[\\s\\S]*?/\\* ${endMarker} \\*/`);
  if (re.test(css)) return css.replace(re, body);
  return css.replace(appendAfter, `${appendAfter}\n\n${body}`);
}

// ---- resolve the preset (with a resilient fallback chain) ----------------
const dq = dqConfig();
if (!name) name = dq.defaultPreset || 'minimal';

if (!presetFile(name)) {
  const available = availablePresets();
  if (available.length === 0) fail(`No presets found in ${presetsDir}.`);
  const fallback = available.includes('minimal') ? 'minimal' : available.sort()[0];
  console.warn(`⚠ Preset "${name}" not found; falling back to "${fallback}".`);
  name = fallback;
}

const file = presetFile(name);
const isDir = file.endsWith(`${name}/preset.css`) || file.endsWith(`${name}\\preset.css`);

// ---- compose tokens: preset <- persisted overrides -----------------------
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

// ---- directory-preset assets: fonts/ + extra.css -------------------------
let extraBlock = null;
if (isDir) {
  const presetRoot = join(presetsDir, name);
  const fontsSrc = join(presetRoot, 'fonts');
  if (existsSync(fontsSrc)) {
    const fontsDest = join(root, 'src', 'fonts');
    mkdirSync(fontsDest, { recursive: true });
    for (const f of readdirSync(fontsSrc)) copyFileSync(join(fontsSrc, f), join(fontsDest, f));
  }
  const extraCss = join(presetRoot, 'extra.css');
  if (existsSync(extraCss)) {
    extraBlock = '/* dq:preset-extra:start */\n' + readFileSync(extraCss, 'utf8').trim() + '\n/* dq:preset-extra:end */';
  }
}
// Write (or clear) the extra block so switching presets never leaves stale CSS.
const hasExtraInCss = /\/\* dq:preset-extra:start[\s\S]*?\/\* dq:preset-extra:end \*\//.test(css);
if (extraBlock) {
  css = setBlock(css, 'dq:preset-extra:start', 'dq:preset-extra:end', extraBlock, '/* dq:preset:end */');
} else if (hasExtraInCss) {
  css = css.replace(/\n*\/\* dq:preset-extra:start[\s\S]*?\/\* dq:preset-extra:end \*\//, '');
}

writeFileSync(mainCssPath, css);
console.log(`✔ Applied preset "${name}"${hasOverrides ? ' (+ overrides)' : ''}${isDir ? ' (with assets)' : ''}.`);

// ---- rebuild (Tailwind @theme is compile-time) ---------------------------
if (noBuild) {
  console.log('  Skipped build (--no-build). Run `npm run build` to compile.');
} else {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}
