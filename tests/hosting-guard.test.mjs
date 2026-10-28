import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  checkHostingEnv, extractBundleConfig, requiredNames, resolveTarget, validateHostingConfig,
} from '../scripts/check-hosting-env.mjs';

const script = fileURLToPath(new URL('../scripts/check-hosting-env.mjs', import.meta.url));
const target = 'synthetic-guard-project';
const appCheck = 'VITE_FIREBASE_APPCHECK_SITE_KEY';
const measurement = 'VITE_FIREBASE_MEASUREMENT_ID';
const good = {
  VITE_FIREBASE_API_KEY: randomBytes(24).toString('hex'),
  VITE_FIREBASE_AUTH_DOMAIN: `${target}.firebaseapp.com`,
  VITE_FIREBASE_PROJECT_ID: target,
  VITE_FIREBASE_STORAGE_BUCKET: `${target}.firebasestorage.app`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: '987654321098',
  VITE_FIREBASE_APP_ID: '1:987654321098:web:synthetic-sensitive-app',
  [appCheck]: `6L${'a'.repeat(38)}`,
  [measurement]: 'G-SYNTHETIC7942',
};
const fieldNames = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(?:VITE_|PIXTAFFY_|CI$|GCLOUD_PROJECT$|GOOGLE_CLOUD_PROJECT$|PROJECT_ID$|NODE_OPTIONS$|DOTENV_)/.test(name)));
const validate = (config = good, options = {}) => validateHostingConfig(config, { target, ...options });
const output = (result) => result.stdout + result.stderr;
const cli = (root, args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  cwd: root, env: { ...cleanEnv(), ...env }, encoding: 'utf8',
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hosting-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function bundle(config = good, { minifiedProvider = false } = {}) {
  const entries = fieldNames.flatMap((field, index) => {
    const name = [...requiredNames.slice(0, 6), measurement][index];
    return config[name] === undefined ? [] : [`${field}:${JSON.stringify(config[name])}`];
  });
  const provider = minifiedProvider ? 'q' : 'ReCaptchaEnterpriseProvider';
  return `const config={${entries.join(',')}};${config[appCheck] === undefined ? '' : `new ${provider}(${JSON.stringify(config[appCheck])});`}`;
}
async function writeBundle(root, config = good, options = {}) {
  await mkdir(join(root, 'dist/assets'), { recursive: true });
  await writeFile(join(root, 'dist/index.html'), '<script type="module" crossorigin src="/assets/index-test.js"></script>');
  await writeFile(join(root, 'dist/assets/index-test.js'), bundle(config, options));
}

test('valid build and bundle config pass, with custom auth domains allowed', async (t) => {
  for (const mode of ['build', 'dist']) {
    assert.deepEqual(validate(good, { mode }).failures, []);
    assert.deepEqual(validate({ ...good, VITE_FIREBASE_AUTH_DOMAIN: 'login.synthetic.test' }, { mode }).failures, []);
    assert.deepEqual(validate({ ...good, VITE_FIREBASE_AUTH_DOMAIN: `${target}.web.app` }, { mode }).failures, []);
  }
  const root = await fixture(t);
  await writeBundle(root, good, { minifiedProvider: true });
  assert.deepEqual((await checkHostingEnv({ root, mode: 'dist', env: {}, target })).failures, []);
  assert.deepEqual(extractBundleConfig(bundle()), good);
});

for (const mode of ['build', 'dist']) {
  for (const name of requiredNames) {
    test(`${mode} names missing required ${name}`, async (t) => {
      const config = { ...good, [name]: undefined };
      assert.ok(validate(config, { mode }).failures.includes(`FAIL ${name}: missing value`));
      if (mode === 'dist') {
        const root = await fixture(t);
        await writeBundle(root, config);
        const result = cli(root, ['--dist', '--target', target], good);
        assert.equal(result.status, 1);
        assert.ok(output(result).includes(`FAIL ${name}: missing value`));
      }
    });
  }
  for (const value of ['ci-placeholder', 'ci.invalid', 'a-placeholder-value', '', '   ', 'undefined', 'null', 'CHANGEME', 'your_key', 'your-key', 'xxxx', 'example-key']) {
    test(`${mode} rejects placeholder or empty form ${JSON.stringify(value)}`, () => {
      const failures = validate({ ...good, VITE_FIREBASE_API_KEY: value }, { mode }).failures;
      assert.ok(failures.some((line) => line.startsWith('FAIL VITE_FIREBASE_API_KEY:')));
    });
  }
  test(`${mode} rejects target and internal inconsistencies`, () => {
    assert.ok(validate(good, { mode, target: 'another-synthetic-project' }).failures.some((line) => line.startsWith('FAIL projectId:')));
    for (const [name, value] of [
      ['VITE_FIREBASE_STORAGE_BUCKET', 'another-synthetic-project.appspot.com'],
      ['VITE_FIREBASE_APP_ID', '1:123456:web:synthetic'],
      ['VITE_FIREBASE_AUTH_DOMAIN', 'another-synthetic-project.firebaseapp.com'],
      ['VITE_FIREBASE_AUTH_DOMAIN', 'another-synthetic-project.web.app'],
    ]) {
      assert.ok(validate({ ...good, [name]: value }, { mode }).failures.some((line) => line.startsWith(`FAIL ${name}:`)));
    }
  });
  test(`${mode} escape hatch only permits absent values and warns`, () => {
    const env = { PIXTAFFY_GUARD_ALLOW_MISSING: ` ${appCheck},VITE_FIREBASE_API_KEY ` };
    const result = validate({ ...good, [appCheck]: undefined }, { mode, env });
    assert.deepEqual(result.failures, []);
    assert.ok(result.warnings.some((line) => line.startsWith(`WARNING ${appCheck}:`)));
    assert.equal(result.warnings.length, 2);
    for (const value of ['ci-placeholder', 'undefined', 'null']) {
      assert.ok(validate({ ...good, [appCheck]: value }, { mode, env }).failures.some((line) => line.includes(appCheck)));
    }
    assert.ok(validate(good, { mode, env, target: 'another-synthetic-project' }).failures.some((line) => line.startsWith('FAIL projectId:')));
  });
}

test('optional measurement ID warns without failing', () => {
  const result = validate({ ...good, [measurement]: undefined });
  assert.deepEqual(result.failures, []);
  assert.ok(result.warnings.some((line) => line.startsWith(`WARNING ${measurement}:`)));
});

test('target precedence and build without a target', () => {
  const env = { GCLOUD_PROJECT: 'first', GOOGLE_CLOUD_PROJECT: 'second', PROJECT_ID: 'third' };
  assert.equal(resolveTarget(['--target', 'explicit'], env), 'explicit');
  assert.equal(resolveTarget([], env), 'first');
  assert.equal(resolveTarget([], { ...env, GCLOUD_PROJECT: ' ' }), 'second');
  assert.equal(resolveTarget([], { PROJECT_ID: 'third' }), 'third');
  assert.deepEqual(validate(good, { target: undefined }).failures, []);
  assert.ok(validate(good, { mode: 'dist', target: undefined }).failures.includes('FAIL target: cannot determine the deploy target'));
});

test('runtime env files match Vite production precedence; copied example values fail', async (t) => {
  const root = await fixture(t);
  const envText = (values) => Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n');
  await writeFile(join(root, '.env'), envText({ ...good, VITE_FIREBASE_API_KEY: 'ci-placeholder' }));
  await writeFile(join(root, '.env.production'), 'VITE_FIREBASE_API_KEY=synthetic-production');
  await writeFile(join(root, '.env.production.local'), 'VITE_FIREBASE_API_KEY=synthetic-local');
  await writeFile(join(root, '.env.example'), 'export VITE_FIREBASE_API_KEY="synthetic-local" # copied template\n');
  const copied = cli(root, ['--build']);
  assert.equal(copied.status, 1);
  assert.match(output(copied), /FAIL VITE_FIREBASE_API_KEY: placeholder value/);
  assert.equal(cli(root, ['--build'], { VITE_FIREBASE_API_KEY: good.VITE_FIREBASE_API_KEY }).status, 0);
  const overridden = cli(root, ['--build'], { VITE_FIREBASE_API_KEY: 'ci-placeholder' });
  assert.equal(overridden.status, 1);
  await writeBundle(root, { ...good, VITE_FIREBASE_API_KEY: 'synthetic-local' });
  assert.equal(cli(root, ['--dist', '--target', target]).status, 1);
});

for (const exception of [{ CI: 'true' }, { PIXTAFFY_ALLOW_PLACEHOLDER_BUILD: '1' }]) {
  test(`CI exception ${Object.keys(exception)[0]} is limited to build mode`, async (t) => {
    const root = await fixture(t);
    const placeholders = Object.fromEntries(requiredNames.slice(0, 6).map((name) => [name, 'ci-placeholder']));
    const result = cli(root, ['--build', '--target', target], { ...placeholders, ...exception });
    assert.equal(result.status, 0, output(result));
    assert.equal((output(result).match(/NOTICE/g) || []).length, 1);
    assert.match(output(result), /bundle is not deployable/);
    assert.deepEqual(validate({ ...good, VITE_FIREBASE_API_KEY: undefined }, { env: exception, target: 'another-synthetic-project' }).failures, []);
    await writeBundle(root, placeholders);
    const dist = cli(root, ['--dist', '--target', target], { ...good, ...exception });
    assert.equal(dist.status, 1);
    assert.match(output(dist), /placeholder value/);
    assert.doesNotMatch(output(dist), /NOTICE/);
    await writeBundle(root, good);
    assert.equal(cli(root, ['--dist', '--target', 'another-synthetic-project'], exception).status, 1);
  });
}

test('CLI validates real build inputs and deploy bundle independently, with safe failure output', async (t) => {
  const root = await fixture(t);
  const build = cli(root, ['--build', '--target', target], good);
  assert.equal(build.status, 0, output(build));
  assert.match(output(build), /hosting env guard: ok \(build, target synthetic-guard-project\)/);
  assert.equal(cli(root, ['--build', '--target', 'another-synthetic-project'], good).status, 1);
  await writeBundle(root);
  const dist = cli(root, ['--dist'], { GCLOUD_PROJECT: target, VITE_FIREBASE_PROJECT_ID: 'ci-placeholder' });
  assert.equal(dist.status, 0, output(dist));
  assert.match(output(dist), /hosting env guard: ok \(dist, target synthetic-guard-project\)/);
  assert.equal(cli(root, ['--dist']).status, 1);
  assert.equal(cli(root, ['--dist', '--target', target], { GCLOUD_PROJECT: 'another-synthetic-project' }).status, 0);
  for (const args of [['--build', '--target', 'another-synthetic-project'], ['--dist', '--target', 'another-synthetic-project']]) {
    const result = cli(root, args, good);
    assert.equal(result.status, 1);
    assert.match(output(result), /Hint:.*\.env.production.local.*unset stray VITE_/);
    for (const value of Object.values(good)) assert.ok(!output(result).includes(value), 'configuration value leaked');
  }
  const allowed = cli(root, ['--build'], { ...good, [appCheck]: '', PIXTAFFY_GUARD_ALLOW_MISSING: appCheck });
  assert.equal(allowed.status, 0);
  assert.match(output(allowed), /WARNING VITE_FIREBASE_APPCHECK_SITE_KEY:/);
  assert.equal(cli(root, ['--build', '--dist'], good).status, 1);
  assert.equal(cli(root, ['--build', '--target'], good).status, 1);
});

test('dist fails closed for missing files and scans split config chunks', async (t) => {
  const root = await fixture(t);
  assert.equal(cli(root, ['--dist', '--target', target]).status, 1);
  await mkdir(join(root, 'dist/assets'), { recursive: true });
  await writeFile(join(root, 'dist/index.html'), '<script type="module" src="/assets/missing.js"></script>');
  assert.equal(cli(root, ['--dist', '--target', target]).status, 1);
  await writeBundle(root);
  await writeFile(join(root, 'dist/assets/index-test.js'), 'import "./config.js";');
  await writeFile(join(root, 'dist/assets/config.js'), bundle());
  assert.equal(cli(root, ['--dist', '--target', target]).status, 0);
  await writeFile(join(root, 'dist/assets/config.js'), 'const noConfig=true;');
  assert.equal(cli(root, ['--dist', '--target', target]).status, 1);
});

test('source wiring checks the build first and the hosting bundle before upload', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const firebase = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.prebuild, 'node scripts/check-hosting-env.mjs --build && npm test && node scripts/whats-new.mjs check');
  assert.ok(pkg.scripts.test.includes('tests/hosting-guard.test.mjs'));
  for (const hosting of [firebase.hosting].flat()) assert.deepEqual(hosting.predeploy, ['node scripts/check-hosting-env.mjs --dist']);
});
