/**
 * One-off migration. Build functions first: npm --prefix functions run build
 * Ray must provision Secret Manager USER_API_KEYS_ENCRYPTION_KEY before deployment:
 * firebase functions:secrets:set USER_API_KEYS_ENCRYPTION_KEY
 * Supply the SAME secret through USER_API_KEYS_ENCRYPTION_KEY for this process.
 * Preview: node scripts/migrate-user-api-keys.mjs --project PROJECT_ID --dry-run
 * Migrate: node scripts/migrate-user-api-keys.mjs --project PROJECT_ID
 * Local: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 with --project demo-pixtaffy.
 * Uses Application Default Credentials outside the emulator. Never logs key values.
 * No production migration is performed by tests or builds.
 *
 * PR body handoff (publishing a PR requires separate authorization):
 * Before deploy, Ray must create the secret:
 * firebase functions:secrets:set USER_API_KEYS_ENCRYPTION_KEY
 * Dry-run: node scripts/migrate-user-api-keys.mjs --project PROJECT_ID --dry-run
 * Apply: node scripts/migrate-user-api-keys.mjs --project PROJECT_ID
 * Supply the same secret to the script process as USER_API_KEYS_ENCRYPTION_KEY.
 * Local emulator check uses FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 and
 * --project demo-pixtaffy. Do not run the script against production during review.
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { ensureUserApiKeysMigrated } = require('../functions/lib/userApiKeys.js');
const args = process.argv.slice(2);
const project = args[args.indexOf('--project') + 1];
if (!args.includes('--project') || !project || project.startsWith('--')) throw new Error('--project is required');
if (!process.env.USER_API_KEYS_ENCRYPTION_KEY) throw new Error('USER_API_KEYS_ENCRYPTION_KEY is required');
initializeApp({ projectId: project });
const db = getFirestore();
if ((await db.doc('config/featureFlags').get()).data()?.serverSideUserKeys?.stage !== 2 && !args.includes('--force-before-stage-2')) throw new Error('Migration requires stage 2. --force-before-stage-2 is not recommended.');
let cursor, scanned = 0, migrated = 0;
while (true) {
  let query = db.collection('users').orderBy('__name__').limit(200);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;
  for (const doc of page.docs) {
    const data = doc.data();
    scanned++;
    if ('apiKeys' in data || 'geminiApiKey' in data || 'apiKeys' in (data.preferences || {}) || 'geminiApiKey' in (data.preferences || {})) {
      if (!args.includes('--dry-run')) await ensureUserApiKeysMigrated(doc.id);
      migrated++;
    }
  }
  cursor = page.docs.at(-1);
}
console.log(JSON.stringify({ dryRun: args.includes('--dry-run'), scanned, migrated }));
