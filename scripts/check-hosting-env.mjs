import { readFile, readdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

const fields = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
  measurementId: 'VITE_FIREBASE_MEASUREMENT_ID',
};
const appCheckName = 'VITE_FIREBASE_APPCHECK_SITE_KEY';
const measurementName = fields.measurementId;
export const requiredNames = Object.freeze([
  ...Object.values(fields).filter((name) => name !== measurementName), appCheckName,
]);
const absent = (value) => typeof value !== 'string' || !value.trim();

export function isPlaceholder(value, exampleValues = []) {
  if (absent(value)) return false;
  const normalized = value.trim().toLowerCase();
  return /^(undefined|null|ci\.invalid)$|placeholder|changeme|your_|your-|xxxx|example/i.test(normalized) ||
    exampleValues.some((example) => !absent(example) && example.trim().toLowerCase() === normalized);
}

export function resolveTarget(args = [], env = {}) {
  const index = args.indexOf('--target');
  if (index >= 0) return args[index + 1]?.startsWith('--') ? undefined : args[index + 1]?.trim() || undefined;
  return [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT, env.PROJECT_ID].find((value) => !absent(value))?.trim();
}

// Pure validation shared by the environment and built-bundle checks.
export function validateHostingConfig(config, { mode = 'build', target, env = {}, exampleValues = [] } = {}) {
  const failures = [];
  const warnings = [];
  const notices = [];
  const fail = (name, reason) => failures.push(`FAIL ${name}: ${reason}`);
  const ciBuild = mode === 'build' && (env.CI === 'true' || env.PIXTAFFY_ALLOW_PLACEHOLDER_BUILD === '1');
  const allowed = new Set((env.PIXTAFFY_GUARD_ALLOW_MISSING || '').split(',').map((name) => name.trim()));
  if (ciBuild) notices.push('NOTICE: CI placeholder build exception enabled; this bundle is not deployable.');
  for (const name of [...requiredNames, measurementName]) {
    if (requiredNames.includes(name) && allowed.has(name)) {
      warnings.push(`WARNING ${name}: allow-missing escape hatch enabled; only an absent value is allowed.`);
    }
    if (absent(config[name])) {
      if (name === measurementName) warnings.push(`WARNING ${name}: optional value is missing.`);
      else if (!allowed.has(name) && !ciBuild) fail(name, 'missing value');
    } else if (isPlaceholder(config[name], exampleValues) && !ciBuild) {
      fail(name, 'placeholder value');
    }
  }
  if (mode === 'dist' && !target) fail('target', 'cannot determine the deploy target');
  if (!ciBuild) {
    const projectId = config[fields.projectId];
    const bucket = config[fields.storageBucket];
    const domain = config[fields.authDomain];
    const appId = config[fields.appId];
    const sender = config[fields.messagingSenderId];
    const usable = (value) => !absent(value) && !isPlaceholder(value, exampleValues);
    if (usable(projectId)) {
      if (target && projectId !== target) fail('projectId', 'bundle is for a different project than the deploy target');
      if (usable(bucket) && !bucket.startsWith(`${projectId}.`)) fail(fields.storageBucket, 'does not match projectId');
      if (usable(domain) && /(?:firebaseapp\.com|web\.app)$/i.test(domain) && !domain.startsWith(`${projectId}.`)) {
        fail(fields.authDomain, 'does not match projectId');
      }
    }
    if (usable(appId) && usable(sender) && appId.split(':')[1] !== sender) fail(fields.appId, 'does not match messagingSenderId');
  }
  return { failures, warnings, notices };
}

const literal = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
function decodeLiteral(value) {
  return value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

export function extractBundleConfig(source) {
  const config = {};
  for (const [field, name] of Object.entries(fields)) {
    const match = source.match(new RegExp(String.raw`(?:^|[,{\s])(?:"${field}"|'${field}'|${field})\s*:\s*${literal}`));
    if (match) config[name] = decodeLiteral(match[1]);
  }
  const provider = source.match(new RegExp(String.raw`\bReCaptchaEnterpriseProvider\s*\(\s*${literal}`));
  const siteKey = source.match(/["'](6L[\w-]{38})["']/);
  if (provider) config[appCheckName] = decodeLiteral(provider[1]);
  else if (siteKey) config[appCheckName] = siteKey[1];
  return config;
}

async function exampleValuesAt(root) {
  let source;
  try {
    source = await readFile(resolve(root, '.env.example'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return source.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(?:export\s+)?[\w]+\s*=\s*(.*?)\s*$/);
    if (!match) return [];
    const quoted = match[1].match(/^("[^"\\]*(?:\\.[^"\\]*)*"|'[^']*')/);
    return [quoted ? decodeLiteral(quoted[1]) : match[1].replace(/\s*#.*$/, '').trim()];
  });
}

async function readDistConfig(root) {
  const dist = resolve(root, 'dist');
  const html = await readFile(resolve(dist, 'index.html'), 'utf8');
  const tags = html.match(/<script\b[^>]*>/gi) || [];
  const tag = tags.find((value) => /\btype\s*=\s*["']module["']/i.test(value) && /\bsrc\s*=/i.test(value));
  const src = tag?.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!src || /^(?:[a-z]+:|\/\/)/i.test(src)) throw new Error();
  const entry = resolve(dist, src.replace(/^\//, '').split(/[?#]/)[0]);
  if (!entry.startsWith(`${dist}${sep}`)) throw new Error();
  let config = extractBundleConfig(await readFile(entry, 'utf8'));
  if (!Object.values(fields).some((name) => Object.hasOwn(config, name))) {
    for (const file of (await readdir(resolve(dist, 'assets'))).sort()) {
      if (!file.endsWith('.js')) continue;
      const candidate = extractBundleConfig(await readFile(resolve(dist, 'assets', file), 'utf8'));
      if (Object.hasOwn(candidate, fields.apiKey)) {
        config = { ...config, ...candidate };
        break;
      }
    }
  }
  return config;
}

export async function checkHostingEnv({ root = process.cwd(), mode = 'build', env = process.env, target } = {}) {
  if (!['build', 'dist'].includes(mode)) throw new Error();
  const exampleValues = await exampleValuesAt(root);
  const config = mode === 'build' ? { ...loadEnv('production', root, ''), ...env } : await readDistConfig(root);
  return validateHostingConfig(config, { mode, env, exampleValues, target: target ?? resolveTarget([], env) });
}

export async function runCli(args = process.argv.slice(2), env = process.env, root = process.cwd()) {
  try {
    const modes = args.filter((arg) => arg === '--build' || arg === '--dist');
    if (modes.length !== 1) throw new Error();
    const mode = modes[0].slice(2);
    const target = resolveTarget(args, env);
    if (args.includes('--target') && !target) throw new Error();
    const { failures, warnings, notices } = await checkHostingEnv({ root, mode, env, target });
    for (const line of [...notices, ...warnings, ...failures]) console.error(line);
    if (!failures.length) {
      console.log(`hosting env guard: ok (${mode}, target ${target || 'unavailable'})`);
      return 0;
    }
  } catch {
    // Errors can contain file contents or environment values. Never print them.
    console.error('FAIL hosting: cannot read configuration, built entry, or guard arguments');
  }
  console.error("Hint: build with the target project's .env.production.local and unset stray VITE_ variables.");
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli();
}
