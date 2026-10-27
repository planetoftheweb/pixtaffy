// Ray runs this with ADC. Never run from CI. No user documents are read.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const project = value('--project');
if (!project || project.startsWith('--')) throw new Error('--project is required');
const flag = value('--flag');
if (!['serverSideUserKeys', 'enforceAppCheckUserKeys', 'rateLimitUserKeys'].includes(flag)) throw new Error('A supported --flag is required');
if (!['0', '1', '2'].includes(value('--stage'))) throw new Error('--stage must be 0, 1, or 2');
const allowlistUids = args.flatMap((arg, i) => arg === '--allow-uid' ? [args[i + 1]] : []);
if (allowlistUids.some(uid => !uid || uid.startsWith('--'))) throw new Error('--allow-uid requires a UID');
const emails = args.flatMap((arg, i) => arg === '--allow-email' ? [args[i + 1]] : []);
if (emails.some(email => !email || email.startsWith('--'))) throw new Error('--allow-email requires an email');
initializeApp({ projectId: project, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
for (const email of emails) {
  try { allowlistUids.push((await getAuth().getUserByEmail(email)).uid); }
  catch { throw new Error('Could not resolve an allowlist email to a uid'); }
}
const ref = getFirestore().doc('config/featureFlags');
const after = { stage: Number(value('--stage')), allowAdmins: args.includes('--allow-admins'), forceLegacy: args.includes('--force-legacy'), allowlistUids: [...new Set(allowlistUids)] };
console.log(JSON.stringify({ after }));
if (!args.includes('--dry-run')) await ref.set({ [flag]: after }, { merge: true });
