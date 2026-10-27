# Keep the App Check debug token out of production builds

No runtime feature flag is used. Production behavior does not change. Local development keeps the existing debug provider behavior.

The debug token read in `services/firebase.ts` is gated on `import.meta.env.DEV`, so production builds fold it to an empty string and never include the development value.

For local development previews, store `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` in `.env.development.local` instead of `.env`. Do not commit environment files or credential values. Rotate any development debug token in the Firebase Console when it is no longer needed.

`npm run build` runs `postbuild`, which invokes `scripts/check-dist-secrets.mjs`. The check loads the Vite environment for the build mode, looks for values of variables named TOKEN, SECRET, or DEBUG in `dist/`, and fails the build on a match. It reports only variable names and relative file paths, never values. Missing `dist/` or scanner errors also fail the build.

The check defaults to production mode. For another mode run `node scripts/check-dist-secrets.mjs --mode <mode>` after the matching Vite build.
