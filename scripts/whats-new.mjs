#!/usr/bin/env node
/**
 * What's New tooling: twin subcommands that keep PixTaffy's user-facing
 * release surface in sync with the package version.
 *
 *   node scripts/whats-new.mjs add     # interactive scaffold → data/whatsNew.ts
 *   node scripts/whats-new.mjs check   # validates current entry + unique release artwork
 *
 * The `check` subcommand runs as `prebuild`, so both local
 * `npm run build` and Render's production build refuse to ship a
 * release without an accompanying user-facing announcement and unique art.
 *
 * Escape hatch for genuine one-offs (hotfix on an old branch, etc.):
 *   SKIP_WHATS_NEW_CHECK=1 npm run build
 *
 * The companion authoring rules live in
 * `.cursor/skills/whats-new/SKILL.md` — read that first if you're
 * editing this script.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output, exit, env, argv } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const PKG_PATH = resolve(ROOT, 'package.json');
const DATA_PATH = resolve(ROOT, 'data/whatsNew.ts');
const ARRAY_OPEN = 'export const WHATS_NEW: WhatsNewEntry[] = [\n';

// --- shared helpers ----------------------------------------------------------

async function readPkgVersion() {
  const pkg = JSON.parse(await readFile(PKG_PATH, 'utf-8'));
  return pkg.version;
}

async function readDataSource() {
  return readFile(DATA_PATH, 'utf-8');
}

function extractVersions(source) {
  // Matches  version: 'x.y.z'  (and the double-quote variant) anywhere in
  // the file. We assume entries are the only place a TS property called
  // `version` is declared — true today, and a refactor would surface this
  // quickly via failing checks.
  const re = /version:\s*['"]([^'"]+)['"]/g;
  const out = [];
  let m;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

function extractEntryImages(source) {
  // Pair each version with the first image before the next version. This keeps
  // the parser tolerant of fields such as `featured` being added in between.
  const versionRe = /version:\s*['"]([^'"]+)['"]/g;
  const matches = [...source.matchAll(versionRe)];
  const out = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const image = source.slice(start, end).match(/image:\s*['"]([^'"]+)['"]/);
    if (image) out.push({ version: match[1], image: image[1] });
  }
  return out;
}

async function imageFingerprint(image) {
  if (!image.startsWith('/')) return null;
  try {
    const bytes = await readFile(resolve(ROOT, 'public', image.slice(1)));
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    return null;
  }
}

// --- `check` subcommand ------------------------------------------------------

async function cmdCheck() {
  if (env.SKIP_WHATS_NEW_CHECK) {
    console.log('[whats-new] check skipped via SKIP_WHATS_NEW_CHECK=1');
    return;
  }
  const pkgVer = await readPkgVersion();
  const source = await readDataSource();
  const versions = extractVersions(source);
  const entries = extractEntryImages(source);
  const matched = versions.includes(pkgVer);

  if (matched) {
    const fingerprinted = await Promise.all(
      entries.map(async (entry) => ({ ...entry, fingerprint: await imageFingerprint(entry.image) })),
    );
    const currentEntries = fingerprinted.filter((entry) => entry.version === pkgVer);
    const problems = [];

    if (currentEntries.length === 0) {
      problems.push(`v${pkgVer} has no image field`);
    } else if (currentEntries.length > 1) {
      problems.push(`v${pkgVer} has ${currentEntries.length} image entries; expected exactly one`);
    }

    for (const entry of currentEntries) {
      if (!entry.fingerprint) {
        problems.push(`v${entry.version} image is missing: ${entry.image}`);
        continue;
      }
      const reusedBy = fingerprinted.filter(
        (other) =>
          other.version !== entry.version &&
          (other.image === entry.image ||
            (other.fingerprint && other.fingerprint === entry.fingerprint)),
      );
      if (reusedBy.length > 0) {
        problems.push(
          `v${entry.version} reuses release artwork from ${reusedBy
            .map((other) => `v${other.version}`)
            .join(', ')}: ${entry.image}`,
        );
      }
    }

    if (problems.length > 0) {
      console.error('');
      console.error('[whats-new] Every release needs its own thumbnail artwork.');
      for (const problem of problems) console.error(`[whats-new] ${problem}`);
      console.error('[whats-new] Generate a distinct 16:9 image and update the entry before building.');
      console.error('');
      exit(1);
    }

    console.log(
      `[whats-new] OK — entry and unique artwork exist for v${pkgVer}`,
    );
    return;
  }

  console.error('');
  console.error(`[whats-new] No exact entry found for v${pkgVer} in data/whatsNew.ts.`);
  console.error(`[whats-new] package.json is at v${pkgVer} — every release requires a user-facing entry.`);
  console.error('[whats-new] Run:  npm run whats-new');
  console.error('[whats-new] (Last-resort bypass: SKIP_WHATS_NEW_CHECK=1 npm run build)');
  console.error('');
  exit(1);
}

// --- `add` subcommand --------------------------------------------------------

async function ask(rl, prompt, def = '') {
  const label = def ? `${prompt} [${def}]: ` : `${prompt}: `;
  const ans = (await rl.question(label)).trim();
  return ans || def;
}

async function askRequired(rl, prompt, def = '') {
  // Loops until the user supplies a non-empty value (or accepts the default,
  // if one was offered). Beats aborting the whole interactive flow over a
  // single missed field.
  for (;;) {
    const v = await ask(rl, prompt, def);
    if (v) return v;
    console.log('  (required — please enter a value)');
  }
}

async function askBool(rl, prompt, def = false) {
  const dval = def ? 'Y/n' : 'y/N';
  const ans = (await rl.question(`${prompt} [${dval}]: `)).trim().toLowerCase();
  if (!ans) return def;
  return ans.startsWith('y');
}

function tsEscape(s) {
  // Escapes single quotes + backslashes for embedding inside a TS single-quoted
  // string literal. Curly punctuation (em-dash, smart quotes) is fine as-is —
  // the rest of data/whatsNew.ts already mixes them in freely.
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function buildEntrySource({
  id,
  title,
  summary,
  blurb,
  publishedAt,
  version,
  image,
  featured,
  sections,
}) {
  const lines = [];
  lines.push('  {');
  lines.push(`    id: '${tsEscape(id)}',`);
  lines.push(`    title: '${tsEscape(title)}',`);
  lines.push(`    summary: '${tsEscape(summary)}',`);
  lines.push('    blurb:');
  lines.push(`      '${tsEscape(blurb)}',`);
  lines.push(`    publishedAt: Date.parse('${publishedAt}'),`);
  lines.push(`    version: '${tsEscape(version)}',`);
  lines.push(`    image: '${tsEscape(image)}',`);
  if (featured) lines.push('    featured: true,');
  if (sections.length > 0) {
    lines.push('    sections: [');
    for (const sec of sections) {
      lines.push('      {');
      lines.push(`        heading: '${tsEscape(sec.heading)}',`);
      if (sec.body) lines.push(`        body: '${tsEscape(sec.body)}',`);
      if (sec.steps.length > 0) {
        lines.push('        steps: [');
        for (const step of sec.steps) {
          const parts = [`text: '${tsEscape(step.text)}'`];
          if (step.icon) parts.push(`icon: '${tsEscape(step.icon)}'`);
          if (step.kbd) parts.push(`kbd: '${tsEscape(step.kbd)}'`);
          lines.push(`          { ${parts.join(', ')} },`);
        }
        lines.push('        ],');
      }
      lines.push('      },');
    }
    lines.push('    ],');
  }
  lines.push('  },');
  return lines.join('\n') + '\n';
}

async function cmdAdd() {
  const rl = readline.createInterface({ input, output });
  try {
    const pkgVer = await readPkgVersion();
    const source = await readDataSource();
    const existingVersions = new Set(extractVersions(source));
    const existingImages = new Set(extractEntryImages(source).map((entry) => entry.image));

    console.log('');
    console.log("Let's add a What's New entry.");
    console.log("Press Enter to accept the default in [brackets]. See .cursor/skills/whats-new/SKILL.md for the field rules.");
    console.log('');

    const version = await askRequired(rl, 'Version (semver)', pkgVer);
    if (existingVersions.has(version)) {
      console.error('');
      console.error(`[whats-new] An entry already exists for v${version}. Aborting.`);
      console.error('[whats-new] (Edit data/whatsNew.ts by hand if you need to revise it.)');
      exit(1);
    }

    const title = await askRequired(rl, 'Title (sentence case, no trailing period)');
    const summary = await askRequired(rl, 'Summary (one sentence shown in the bell)');
    const blurb = await askRequired(rl, 'Blurb (one paragraph for spotlight + grid cards)');

    const slugDefault = slugify(title) || 'new-feature';
    const slug = await ask(rl, 'Slug for id (kebab-case)', slugDefault);
    const id = `v${version}-${slug}`;

    const imageDefault = `/whats-new/whatsnew-v${version}.png`;
    let image = await ask(rl, 'Unique image path (under public/)', imageDefault);
    while (existingImages.has(image)) {
      console.log('  (already used by another release — every entry needs its own artwork)');
      image = await askRequired(rl, 'Unique image path (under public/)');
    }
    const featured = await askBool(rl, 'Featured? (one-time spotlight modal)', false);

    const sections = [];
    const wantSections = await askBool(rl, 'Add instructional sections?', true);
    if (wantSections) {
      let secIdx = 1;
      for (;;) {
        console.log(`\n  Section ${secIdx}`);
        const heading = await ask(rl, '  Heading (empty to stop)');
        if (!heading) break;
        const body = await ask(rl, '  Body paragraph (optional)');
        const steps = [];
        let stepIdx = 1;
        for (;;) {
          console.log(`    Step ${stepIdx}`);
          const text = await ask(rl, '    Text (empty to stop)');
          if (!text) break;
          const icon = await ask(rl, '    Icon name (lucide-react, optional)');
          const kbd = await ask(rl, '    Keyboard chip (e.g. Cmd+K, optional)');
          const step = { text };
          if (icon) step.icon = icon;
          if (kbd) step.kbd = kbd;
          steps.push(step);
          stepIdx += 1;
        }
        sections.push({ heading, body, steps });
        secIdx += 1;
        const more = await askBool(rl, '  Add another section?', false);
        if (!more) break;
      }
    }

    const publishedAt = new Date().toISOString();

    const entryCode = buildEntrySource({
      id,
      title,
      summary,
      blurb,
      publishedAt,
      version,
      image,
      featured,
      sections,
    });

    if (!source.includes(ARRAY_OPEN)) {
      console.error('');
      console.error(`[whats-new] Could not locate "${ARRAY_OPEN.trim()}" in data/whatsNew.ts.`);
      console.error('[whats-new] The file may have been refactored — aborting to avoid corrupting it.');
      exit(1);
    }
    const next = source.replace(ARRAY_OPEN, ARRAY_OPEN + entryCode);
    await writeFile(DATA_PATH, next, 'utf-8');

    console.log('');
    console.log(`[whats-new] Added v${version} entry to data/whatsNew.ts`);
    console.log('[whats-new] Next steps:');
    console.log(`  1. Drop the hero image at  public${image}  (16:9, ~1024x576)`);
    console.log('  2. Run  npm run build  to verify the prebuild gate is green');
    console.log('  3. Update CHANGELOG.md with the same release in engineering voice');
    if (featured) {
      console.log('  4. Featured: the spotlight modal will auto-open on next app load until dismissed per user');
    }
    console.log('');
  } finally {
    rl.close();
  }
}

// --- dispatch ----------------------------------------------------------------

const sub = argv[2];
try {
  if (sub === 'add') {
    await cmdAdd();
  } else if (sub === 'check') {
    await cmdCheck();
  } else {
    console.error('Usage:');
    console.error('  node scripts/whats-new.mjs add     # interactive scaffold');
    console.error('  node scripts/whats-new.mjs check   # validate current entry + unique artwork');
    exit(2);
  }
} catch (err) {
  console.error('[whats-new] Unexpected error:');
  console.error(err);
  exit(1);
}
