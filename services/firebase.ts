// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken, type AppCheck } from "firebase/app-check";
import { getId as getInstallationId, getInstallations } from "firebase/installations";
import {
  getAnalytics,
  isSupported as isAnalyticsSupported,
  type Analytics,
} from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Debug: Check if config is loaded (will show in browser console)
export const missingKeys = Object.entries(firebaseConfig)
  .filter(([key, value]) => !value && key !== 'measurementId')
  .map(([key]) => key);

if (missingKeys.length > 0) {
  console.error("Missing Firebase Config Keys:", missingKeys);
} else {
  console.log("Firebase Config Loaded successfully");
  console.log("Storage Bucket:", firebaseConfig.storageBucket); // Log the bucket name
  if (!firebaseConfig.storageBucket) {
    console.warn("WARNING: VITE_FIREBASE_STORAGE_BUCKET is missing. File uploads will fail.");
  }
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ---- Emulator wiring -------------------------------------------------------
// When running `npm run dev` with VITE_USE_FIREBASE_EMULATORS=true, point the
// SDK at the locally-running Firebase Emulator Suite (ports from firebase.json).
// This lets the admin panel's Cloud Functions be exercised end-to-end without
// deploying. Production builds ignore this block entirely.
const useEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' ||
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === '1';

const localPreviewHostnames = new Set(['localhost', '127.0.0.1', '::1']);
export const isLocalDevelopmentPreview =
  typeof window !== 'undefined' &&
  import.meta.env.DEV &&
  localPreviewHostnames.has(window.location.hostname);

const localAppCheckDebugToken = String(
  import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || '',
).trim();

// Firebase's production reCAPTCHA attestation intentionally rejects localhost.
// Local previews that call protected production Functions must use a registered
// App Check debug token instead. This branch is stripped from production builds,
// and the token lives only in the ignored local environment file.
if (isLocalDevelopmentPreview && !useEmulators && localAppCheckDebugToken) {
  (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    localAppCheckDebugToken;
  console.info('[Startup] Firebase App Check local debug provider: enabled');
}

const FIREBASE_BACKGROUND_TIMEOUT_MS = 9_000;

const withFirebaseTimeout = async <T,>(label: string, promise: Promise<T>): Promise<T> => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error(`${label} did not settle within ${FIREBASE_BACKGROUND_TIMEOUT_MS / 1000} seconds.`)),
          FIREBASE_BACKGROUND_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
};

const observeFirebasePromise = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
  const startedAt = performance.now();
  console.info(`[Startup] ${label}: started`);
  try {
    const result = await withFirebaseTimeout(label, promise);
    console.info(`[Startup] ${label}: settled in ${Math.round(performance.now() - startedAt)}ms`);
    return result;
  } catch (error) {
    console.warn(`[Startup] ${label}: failed after ${Math.round(performance.now() - startedAt)}ms`, error);
    return null;
  }
};

const scheduleFirebaseBackgroundWork = (work: () => void) => {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(work, { timeout: 1_500 });
    return;
  }
  window.setTimeout(work, 0);
};

// App Check protects paid callable endpoints from scripts that bypass the web
// app. Enforcement is enabled server-side only after this site key is present
// in production so local development never gets locked out accidentally.
const appCheckSiteKey =
  import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY ||
  '6LcPunwtAAAAAH_6Lae-Kt5DyXIsZIY2xxK2Po4u';
let appCheck: AppCheck | null = null;
let appCheckInitialization: Promise<AppCheck | null> = Promise.resolve(null);

if (typeof window !== 'undefined' && !useEmulators && appCheckSiteKey) {
  // App Check is deliberately kept off the render/auth critical path. A cold
  // browser must first create its Firebase Installations record, and privacy
  // tools can delay either that operation or reCAPTCHA indefinitely. Starting
  // both jobs during browser idle time lets React paint the public experience
  // first.
  appCheckInitialization = new Promise<AppCheck | null>((resolve) => {
    scheduleFirebaseBackgroundWork(() => {
      try {
        appCheck = initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
        console.info('[Startup] Firebase App Check initialization: settled');
        resolve(appCheck);
      } catch (error) {
        console.warn('[Startup] Firebase App Check initialization: failed; protected endpoints remain server-enforced.', error);
        resolve(null);
      }
    });
  });

  scheduleFirebaseBackgroundWork(() => {
    void observeFirebasePromise(
      'Firebase Installations record',
      getInstallationId(getInstallations(app)),
    );
    void appCheckInitialization.then((instance) => {
      if (!instance) return null;
      return observeFirebasePromise('Firebase App Check token', getToken(instance, false));
    });
  });
}

// Functions can initialize immediately. The SDK discovers App Check through
// Firebase's component registry once the background initializer runs.
export const functions = getFunctions(app);
export const ensureAppCheckToken = async (): Promise<void> => {
  // Client actions may wait briefly for a token, but page rendering never does.
  // If App Check is unavailable, continue and let the callable's server-side
  // `enforceAppCheck: true` policy make the authorization decision.
  const instance = await observeFirebasePromise('Firebase App Check availability', appCheckInitialization);
  if (!instance) return;
  await observeFirebasePromise('Firebase App Check action token', getToken(instance, false));
};

// ---- Google Analytics (GA4) ------------------------------------------------
// Firebase Analytics is only wired up when:
//   1. We're running in a browser (isSupported returns false in Node/tests).
//   2. We have a measurementId in the config.
//   3. We're NOT pointing at local emulators (keeps dev traffic out of prod GA).
// `getAnalytics(app)` is what actually loads gtag.js under the hood and starts
// sending page_view hits to the stream configured by measurementId. Without
// this call the measurementId in firebaseConfig is inert.
export let analytics: Analytics | null = null;
if (
  typeof window !== 'undefined' &&
  firebaseConfig.measurementId &&
  !useEmulators
) {
  isAnalyticsSupported()
    .then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
        console.log(`Firebase Analytics initialized (${firebaseConfig.measurementId})`);
      } else {
        console.info('Firebase Analytics not supported in this environment; skipping.');
      }
    })
    .catch((err) => {
      console.warn('Firebase Analytics init failed:', err);
    });
}

if (useEmulators && typeof window !== 'undefined') {
  const host = '127.0.0.1';
  try {
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectStorageEmulator(storage, host, 9199);
    connectFunctionsEmulator(functions, host, 5001);
    console.log(
      '%cFirebase: using local emulators (Auth:9099, Firestore:8080, Storage:9199, Functions:5001)',
      'color:#10b981;font-weight:bold;'
    );
  } catch (err) {
    // HMR can reconnect on already-wired singletons — surface once but don't crash.
    console.warn('Failed to connect one or more Firebase emulators:', err);
  }
}

export default app;
