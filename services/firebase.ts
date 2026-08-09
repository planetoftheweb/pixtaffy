// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken, type AppCheck } from "firebase/app-check";
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

// App Check protects paid callable endpoints from scripts that bypass the web
// app. Enforcement is enabled server-side only after this site key is present
// in production so local development never gets locked out accidentally.
const appCheckSiteKey =
  import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY ||
  '6LcPunwtAAAAAH_6Lae-Kt5DyXIsZIY2xxK2Po4u';
let appCheck: AppCheck | null = null;
if (typeof window !== 'undefined' && !useEmulators && appCheckSiteKey) {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

// Functions must be initialized after App Check so callable requests receive
// the token provider. The first protected request also awaits token creation,
// avoiding a cold-page race where Auth is ready but App Check is still empty.
export const functions = getFunctions(app);
export const ensureAppCheckToken = async (): Promise<void> => {
  if (!appCheck) return;
  await getToken(appCheck, false);
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
