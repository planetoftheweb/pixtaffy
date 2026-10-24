// Create the emulator secret before Functions starts, and clean up even if startup fails.
import { existsSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const secretPath = 'functions/.secret.local';
let created = false;
if (!existsSync(secretPath)) {
  if (spawnSync('git', ['check-ignore', '-q', secretPath]).status !== 0) throw new Error('Refusing to create an unignored secret file');
  writeFileSync(secretPath, 'USER_API_KEYS_ENCRYPTION_KEY=fake-walkthrough-only-encryption-key-not-a-secret\n', { flag: 'wx', mode: 0o600 });
  created = true;
}
// Isolate CLI state from real account credentials and writable user config.
const cliConfig = mkdtempSync(join(tmpdir(), 'pixtaffy-emulator-cli-'));
let child;
const cleanup = () => { if (created && existsSync(secretPath)) unlinkSync(secretPath); rmSync(cliConfig, { recursive: true, force: true }); };
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child?.kill(signal); cleanup(); process.exit(1); });
const run = (cmd, args) => new Promise(resolve => {
  child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, FEATURE_FLAG_CACHE_MS: '100', XDG_CONFIG_HOME: cliConfig } });
  child.on('error', () => resolve(1));
  child.on('exit', code => resolve(code ?? 1));
});
const built = await run('npm', ['--prefix', 'functions', 'run', 'build']);
process.exitCode = built || await run('firebase', ['emulators:exec', '--project', 'demo-pixtaffy', '--only', 'auth,firestore,functions,storage', 'node e2e/run-local.mjs key-flow']);
cleanup();
