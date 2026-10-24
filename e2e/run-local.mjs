import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { runWalkthrough } from './run-walkthrough.mjs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Local Firestore emulator required');
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || '')) throw new Error('Local Auth emulator required');
initializeApp({ projectId: 'demo-pixtaffy' });
const ref = getFirestore().doc('config/featureFlags');
const cacheWaitMs = /^\d+$/.test(process.env.FEATURE_FLAG_CACHE_MS || '') ? Math.min(30000, Number(process.env.FEATURE_FLAG_CACHE_MS)) + 150 : 31000;
const seed = (stage, allowlistUids = []) => ref.set({ serverSideUserKeys: { stage, allowAdmins: false, allowlistUids } });
const port = await new Promise((resolve, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const env = { ...process.env, VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_API_KEY: 'demo-placeholder', VITE_FIREBASE_AUTH_DOMAIN: 'demo-pixtaffy.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'demo-pixtaffy', VITE_FIREBASE_STORAGE_BUCKET: 'demo-pixtaffy.appspot.com', VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789', VITE_FIREBASE_APP_ID: 'demo-placeholder', VITE_FIREBASE_MEASUREMENT_ID: '', VITE_FIREBASE_APPCHECK_SITE_KEY: '' };
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env, stdio: 'ignore' });
const stop = () => vite.kill('SIGTERM');
process.on('SIGTERM', stop); process.on('SIGINT', stop);
try {
  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(baseUrl)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Vite did not start');
  const stage = Number(env.WALKTHROUGH_STAGE ?? 2);
  if (![0,1,2].includes(stage)) throw new Error('Invalid WALKTHROUGH_STAGE');
  const stages = env.WALKTHROUGH_ALSO_LEGACY === '0' || stage === 0 ? [stage] : [stage, 0];
  let pass = true;
  for (const current of stages) {
    await seed(current);
    // The local launcher sets the emulator-only flag cache to 100 ms.
    await new Promise(r => setTimeout(r, cacheWaitMs));
    const result = await runWalkthrough({ name: process.argv[2] || 'key-flow', baseUrl, outDir: `e2e-results/stage-${current}`, env: {
      ...env, WALKTHROUGH_EXPECT_MODE: current === 0 ? 'legacy' : 'server',
      onOwnerSignedUp: async uid => {
        await getAuth().updateUser(uid, { emailVerified: true });
        if (current === 1) { await seed(1, [uid]); await new Promise(r => setTimeout(r, cacheWaitMs)); }
      },
    } });
    pass = result.pass && pass;
  }
  process.exitCode = pass ? 0 : 1;
} finally { stop(); }
