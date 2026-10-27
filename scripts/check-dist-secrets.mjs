import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

export async function checkDistSecrets({ root = process.cwd(), mode = 'production', env = process.env } = {}) {
  const loaded = { ...loadEnv(mode, root, ''), ...env };
  const secrets = Object.entries(loaded).filter(([name, value]) =>
    /TOKEN|SECRET|DEBUG/.test(name) && typeof value === 'string' &&
    value.trim().length >= 12 && !/^(true|false|1|0)$/i.test(value.trim()));
  const findings = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.isFile()) {
        // Scan bytes so bundles, source maps, and other emitted assets are covered.
        const bytes = await readFile(path);
        for (const [name, value] of secrets) {
          if (bytes.includes(Buffer.from(value))) findings.push({ name, file: relative(root, path) });
        }
      }
    }
  }
  await scan(resolve(root, 'dist'));
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const modeIndex = process.argv.indexOf('--mode');
    const mode = modeIndex < 0 ? (process.env.npm_config_mode || 'production') : process.argv[modeIndex + 1];
    if (!mode) throw new Error();
    const findings = await checkDistSecrets({ mode });
    for (const { name, file } of findings) console.error(`${name}: ${file}`);
    process.exitCode = findings.length ? 1 : 0;
  } catch {
    // Do not print exception messages, which could contain environment values.
    console.error('dist/');
    process.exitCode = 1;
  }
}
