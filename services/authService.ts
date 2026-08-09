import { 
  createUserWithEmailAndPassword, 
  EmailAuthProvider,
  linkWithCredential,
  signInWithEmailAndPassword, 
  signInAnonymously,
  signOut, 
  updateProfile,
  deleteUser,
  User as FirebaseUser,
  onAuthStateChanged,
  sendEmailVerification,
} from "firebase/auth";
import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { User, UserPreferences, BrandColor, VisualStyle, GraphicType, AspectRatioOption, ToolbarPreset, Folder } from "../types";
import { BRAND_COLORS, VISUAL_STYLES, GRAPHIC_TYPES, ASPECT_RATIOS } from "../constants";

const defaultPreferences: UserPreferences = {
  brandColors: BRAND_COLORS,
  visualStyles: VISUAL_STYLES,
  graphicTypes: GRAPHIC_TYPES,
  aspectRatios: ASPECT_RATIOS,
  apiKeys: {},
  // Default model for brand-new accounts: Nano Banana 2 (Gemini 3.1 Flash).
  // App.loadResources / guestSelectedModel use the same id as their
  // code-level fallback so the UI matches across guest + first-login.
  selectedModel: 'gemini-3.1-flash-image-preview',
  settings: {
    contributeByDefault: false,
    confirmDeleteHistory: true,
    confirmDeleteCurrent: true,
    defaultGraphicTypeId: 'infographic',
    defaultVisualStyleId: 'hand-drawn',
    defaultAspectRatio: '16:9',
    openaiImageQuality: 'auto',
  }
};

// Helper to remove non-serializable fields (like React components/icons) from preferences.
// Also defensively strips any `isAdmin` that slipped in from the in-memory User:
// the admin flag is a Firebase Auth custom claim, it must NEVER be persisted.
const sanitizePreferences = (prefs: UserPreferences): any => {
  // Belt-and-suspenders: `isAdmin` is not in the UserPreferences type, but a
  // caller might accidentally cast a User shape through here. Drop it loudly.
  if (prefs && (prefs as any).isAdmin !== undefined) {
    delete (prefs as any).isAdmin;
  }
  const clean: any = {};
  // Only save settings and API keys. Arrays are managed via resourceService.
  // Legacy support: omit when empty so clearing the field actually persists.
  if (prefs.geminiApiKey && String(prefs.geminiApiKey).trim()) {
    clean.geminiApiKey = String(prefs.geminiApiKey).trim();
  }
  if (prefs.apiKeys) {
    // Strip empty-string entries so deleting a key in the UI actually clears it in Firestore.
    const trimmedKeys: { [modelId: string]: string } = {};
    for (const [modelId, value] of Object.entries(prefs.apiKeys)) {
      if (typeof value === 'string' && value.trim() !== '') {
        trimmedKeys[modelId] = value.trim();
      }
    }
    clean.apiKeys = trimmedKeys;
  }
  if (prefs.selectedModel) clean.selectedModel = prefs.selectedModel;
  if (prefs.systemPrompt) clean.systemPrompt = prefs.systemPrompt;
  // Enabled OpenRouter model slugs. An empty array is meaningful ("none
  // enabled") and distinct from undefined ("use curated defaults"), so
  // persist it whenever the field is an array at all.
  if (Array.isArray(prefs.openRouterModels)) {
    clean.openRouterModels = prefs.openRouterModels.filter(
      (slug): slug is string => typeof slug === 'string' && slug.length > 0
    );
  }

  if (prefs.settings) {
    const s = prefs.settings;
    const settingsClean: any = {};
    if (s.contributeByDefault !== undefined) settingsClean.contributeByDefault = s.contributeByDefault;
    if (s.defaultGraphicTypeId) settingsClean.defaultGraphicTypeId = s.defaultGraphicTypeId;
    if (s.defaultVisualStyleId) settingsClean.defaultVisualStyleId = s.defaultVisualStyleId;
    if (s.defaultColorSchemeId) settingsClean.defaultColorSchemeId = s.defaultColorSchemeId;
    if (s.defaultAspectRatio) settingsClean.defaultAspectRatio = s.defaultAspectRatio;
    if (s.confirmDeleteHistory !== undefined) settingsClean.confirmDeleteHistory = s.confirmDeleteHistory;
    if (s.confirmDeleteCurrent !== undefined) settingsClean.confirmDeleteCurrent = s.confirmDeleteCurrent;
    if (s.openaiImageQuality) settingsClean.openaiImageQuality = s.openaiImageQuality;
    if (Object.keys(settingsClean).length > 0) clean.settings = settingsClean;
  }

  if (Array.isArray(prefs.presets) && prefs.presets.length > 0) {
    // Drop undefined fields per preset because Firestore rejects them.
    clean.presets = prefs.presets.map(preset => {
      const p: any = {
        id: preset.id,
        name: preset.name,
        createdAt: preset.createdAt
      };
      if (preset.graphicTypeId) p.graphicTypeId = preset.graphicTypeId;
      if (preset.visualStyleId) p.visualStyleId = preset.visualStyleId;
      if (preset.colorSchemeId) p.colorSchemeId = preset.colorSchemeId;
      if (preset.aspectRatio) p.aspectRatio = preset.aspectRatio;
      if (preset.svgMode) p.svgMode = preset.svgMode;
      if (preset.selectedModel) p.selectedModel = preset.selectedModel;
      if (preset.openaiImageQuality) p.openaiImageQuality = preset.openaiImageQuality;
      if (preset.customInstructions?.trim()) p.customInstructions = preset.customInstructions.trim().slice(0, 2000);
      return p;
    });
  }

  if (Array.isArray(prefs.folders) && prefs.folders.length > 0) {
    const idSet = new Set(
      prefs.folders
        .filter((folder) => folder && typeof folder.id === 'string')
        .map((folder) => folder.id as string)
    );
    clean.folders = prefs.folders
      .filter((folder) => folder && typeof folder.id === 'string' && typeof folder.name === 'string')
      .map((folder) => {
        const entry: Folder = {
          id: folder.id,
          name: folder.name,
          createdAt: typeof folder.createdAt === 'number' ? folder.createdAt : Date.now(),
        };
        if (
          typeof folder.parentId === 'string' &&
          folder.parentId.length > 0 &&
          folder.parentId !== folder.id &&
          idSet.has(folder.parentId)
        ) {
          entry.parentId = folder.parentId;
        }
        if (typeof folder.customInstructions === 'string') {
          const trimmed = folder.customInstructions.trim();
          if (trimmed.length > 0) entry.customInstructions = trimmed.slice(0, 4000);
        }
        if (typeof folder.sortOrder === 'number' && Number.isFinite(folder.sortOrder)) {
          entry.sortOrder = folder.sortOrder;
        }
        if (folder.useFolderPresets === true) {
          entry.useFolderPresets = true;
        }
        if (Array.isArray(folder.presets) && folder.presets.length > 0) {
          entry.presets = folder.presets.map((preset) => {
            const p: Record<string, unknown> = {
              id: preset.id,
              name: preset.name,
              createdAt: preset.createdAt,
            };
            if (preset.graphicTypeId) p.graphicTypeId = preset.graphicTypeId;
            if (preset.visualStyleId) p.visualStyleId = preset.visualStyleId;
            if (preset.colorSchemeId) p.colorSchemeId = preset.colorSchemeId;
            if (preset.aspectRatio) p.aspectRatio = preset.aspectRatio;
            if (preset.svgMode) p.svgMode = preset.svgMode;
            if (preset.selectedModel) p.selectedModel = preset.selectedModel;
            if (preset.openaiImageQuality) p.openaiImageQuality = preset.openaiImageQuality;
            if (preset.customInstructions?.trim()) p.customInstructions = preset.customInstructions.trim().slice(0, 2000);
            return p;
          });
        }
        return entry;
      });
  }

  if (typeof prefs.activeFolderId === 'string' && prefs.activeFolderId.length > 0) {
    clean.activeFolderId = prefs.activeFolderId;
  }

  if (typeof prefs.galleryViewFolderId === 'string' && prefs.galleryViewFolderId.length > 0) {
    clean.galleryViewFolderId = prefs.galleryViewFolderId;
  }

  if (typeof prefs.lastSeenWhatsNewId === 'string' && prefs.lastSeenWhatsNewId.length > 0) {
    clean.lastSeenWhatsNewId = prefs.lastSeenWhatsNewId;
  }

  if (Array.isArray(prefs.dismissedSpotlightIds) && prefs.dismissedSpotlightIds.length > 0) {
    const ids = prefs.dismissedSpotlightIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    );
    if (ids.length > 0) clean.dismissedSpotlightIds = Array.from(new Set(ids));
  }

  return clean;
};

// Helper to merge saved preferences with default icons (re-hydration)
const hydratePreferences = (savedPrefs: any): UserPreferences => {
  if (!savedPrefs) return defaultPreferences;

  const rawApiKeys =
    savedPrefs.apiKeys && typeof savedPrefs.apiKeys === 'object' ? savedPrefs.apiKeys : {};
  const cleanedApiKeys: { [k: string]: string } = {};
  for (const [k, v] of Object.entries(rawApiKeys)) {
    if (typeof v === 'string' && v.trim() !== '') {
      cleanedApiKeys[k] = v.trim();
    }
  }
  const legacyGeminiTrimmed =
    typeof savedPrefs.geminiApiKey === 'string' && savedPrefs.geminiApiKey.trim()
      ? savedPrefs.geminiApiKey.trim()
      : '';
  if (!cleanedApiKeys.gemini && legacyGeminiTrimmed) {
    cleanedApiKeys.gemini = legacyGeminiTrimmed;
  }

  return {
    // We don't load arrays from preferences anymore, but we need to return something 
    // to satisfy the type. The App will fetch real data from resourceService.
    brandColors: [], 
    visualStyles: [],
    graphicTypes: [],
    aspectRatios: [],
    geminiApiKey: legacyGeminiTrimmed || undefined,
    apiKeys: cleanedApiKeys,
    openRouterModels: Array.isArray(savedPrefs.openRouterModels)
      ? savedPrefs.openRouterModels.filter((s: unknown): s is string => typeof s === 'string')
      : undefined,
    selectedModel: savedPrefs.selectedModel || 'gemini-3.1-flash-image-preview',
    systemPrompt: savedPrefs.systemPrompt,
    settings: {
      contributeByDefault: savedPrefs.settings?.contributeByDefault ?? defaultPreferences.settings?.contributeByDefault ?? false,
      defaultGraphicTypeId: savedPrefs.settings?.defaultGraphicTypeId,
      defaultVisualStyleId: savedPrefs.settings?.defaultVisualStyleId,
      defaultColorSchemeId: savedPrefs.settings?.defaultColorSchemeId,
      defaultAspectRatio: savedPrefs.settings?.defaultAspectRatio,
      confirmDeleteHistory: savedPrefs.settings?.confirmDeleteHistory ?? true,
      confirmDeleteCurrent: savedPrefs.settings?.confirmDeleteCurrent ?? true,
      openaiImageQuality: savedPrefs.settings?.openaiImageQuality
    },
    presets: Array.isArray(savedPrefs.presets)
      ? (savedPrefs.presets as any[]).filter(p => p && typeof p.id === 'string' && typeof p.name === 'string') as ToolbarPreset[]
      : [],
    folders: Array.isArray(savedPrefs.folders)
      ? (() => {
          const raw = (savedPrefs.folders as any[]).filter(
            (f) => f && typeof f.id === 'string' && typeof f.name === 'string'
          );
          const idSet = new Set(raw.map((f) => f.id as string));
          return raw.map((f) => {
            const entry: Folder = {
              id: f.id,
              name: f.name,
              createdAt: typeof f.createdAt === 'number' ? f.createdAt : Date.now(),
            };
            if (
              typeof f.parentId === 'string' &&
              f.parentId.length > 0 &&
              f.parentId !== f.id &&
              idSet.has(f.parentId)
            ) {
              entry.parentId = f.parentId;
            }
            if (typeof f.customInstructions === 'string') {
              const trimmed = f.customInstructions.trim();
              if (trimmed.length > 0) entry.customInstructions = trimmed.slice(0, 4000);
            }
            if (typeof f.sortOrder === 'number' && Number.isFinite(f.sortOrder)) {
              entry.sortOrder = f.sortOrder;
            }
            return entry;
          }) as Folder[];
        })()
      : [],
    activeFolderId:
      typeof savedPrefs.activeFolderId === 'string' && savedPrefs.activeFolderId.length > 0
        ? savedPrefs.activeFolderId
        : undefined,
    galleryViewFolderId:
      typeof savedPrefs.galleryViewFolderId === 'string' && savedPrefs.galleryViewFolderId.length > 0
        ? savedPrefs.galleryViewFolderId
        : undefined,
    lastSeenWhatsNewId:
      typeof savedPrefs.lastSeenWhatsNewId === 'string' && savedPrefs.lastSeenWhatsNewId.length > 0
        ? savedPrefs.lastSeenWhatsNewId
        : undefined,
    dismissedSpotlightIds: Array.isArray(savedPrefs.dismissedSpotlightIds)
      ? (savedPrefs.dismissedSpotlightIds as any[]).filter(
          (id): id is string => typeof id === 'string' && id.length > 0
        )
      : [],
  };
};

// Helper to transform Firebase User + Firestore Data into our User type.
// `isAdmin` is derived from the Auth custom claim — NEVER from Firestore data.
// `isDisabled` is persisted in Firestore and used to hard-block the account.
const transformUser = (firebaseUser: FirebaseUser, userData: any, isAdmin: boolean = false): User => {
  return {
    id: firebaseUser.uid,
    name: userData?.name || firebaseUser.displayName || 'User',
    username: userData?.username, // Map username from Firestore
    email: firebaseUser.email || '',
    emailVerified: firebaseUser.emailVerified,
    photoURL: userData?.photoURL || firebaseUser.photoURL || undefined, // Map photoURL
    photoDataUrl: typeof userData?.photoDataUrl === 'string' ? userData.photoDataUrl : undefined,
    preferences: userData?.preferences ? hydratePreferences(userData.preferences) : defaultPreferences,
    isAdmin,
    isDisabled: userData?.isDisabled === true,
  };
};

// Read the `admin` custom claim off the current session's token. Safe to call
// with a recently-signed-in user; falls back to `false` on any error.
const readAdminClaim = async (firebaseUser: FirebaseUser): Promise<boolean> => {
  try {
    const token = await firebaseUser.getIdTokenResult();
    return token.claims?.admin === true;
  } catch (err) {
    console.warn("Failed to read admin claim:", err);
    return false;
  }
};

type UserProfileSeed = {
  name?: string;
  username?: string;
  email?: string;
  preferences?: ReturnType<typeof sanitizePreferences>;
};

/** Create `users/{uid}` when Auth exists but Firestore profile write never landed. */
const ensureUserDocument = async (
  uid: string,
  seed: UserProfileSeed = {}
): Promise<Record<string, unknown>> => {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    return snap.data() as Record<string, unknown>;
  }

  const fbUser = auth.currentUser?.uid === uid ? auth.currentUser : null;
  const profile = {
    name: seed.name ?? fbUser?.displayName ?? "User",
    username: seed.username ?? "",
    email: seed.email ?? fbUser?.email ?? "",
    preferences: seed.preferences ?? sanitizePreferences(defaultPreferences),
    createdAt: new Date().toISOString(),
  };

  await setDoc(userRef, profile);
  void ensureUsernameReservation(
    uid,
    profile.username || undefined,
    profile.email || undefined
  );
  return profile;
};

// Best-effort write of `lastSignInAt`. Never blocks the sign-in flow — the
// admin table can tolerate a missing value.
const recordSignIn = async (uid: string): Promise<void> => {
  try {
    await ensureUserDocument(uid);
    await updateDoc(doc(db, "users", uid), { lastSignInAt: serverTimestamp() });
  } catch (err) {
    console.warn("Failed to record lastSignInAt:", err);
  }
};

/** Lowercase doc id in `usernames` — uniqueness is case-insensitive. */
const normalizeUsernameKey = (username: string): string => username.trim().toLowerCase();

const usernameDocRef = (username: string) => doc(db, "usernames", normalizeUsernameKey(username));

// Public `get` on `usernames/{key}` (see firestore.rules). Replaces querying
// `users` by username, which is admin-list-only and fails during signup/login.
const checkUsernameUnique = async (username: string, excludeUserId?: string): Promise<void> => {
  if (!username) return;

  const snap = await getDoc(usernameDocRef(username));
  if (!snap.exists()) return;

  const ownerUid = snap.data()?.uid as string | undefined;
  if (excludeUserId && ownerUid === excludeUserId) return;
  throw new Error("Username is already taken.");
};

const reserveUsername = async (uid: string, username: string, email: string): Promise<void> => {
  await setDoc(usernameDocRef(username), { uid, email });
};

const releaseUsername = async (username: string): Promise<void> => {
  const key = normalizeUsernameKey(username);
  if (!key) return;
  await deleteDoc(doc(db, "usernames", key));
};

/** Backfill `usernames` for accounts created before the lookup collection existed. */
const ensureUsernameReservation = async (
  uid: string,
  username: string | undefined,
  email: string | undefined
): Promise<void> => {
  if (!username?.trim() || !email?.trim()) return;
  try {
    const ref = usernameDocRef(username);
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data()?.uid === uid) return;
    if (snap.exists() && snap.data()?.uid !== uid) return;
    await setDoc(ref, { uid, email: email.trim() });
  } catch (err) {
    console.warn("Failed to ensure username reservation:", err);
  }
};

export const authService = {
  ensureAnonymousSession: async (): Promise<string> => {
    if (auth.currentUser) return auth.currentUser.uid;
    const credential = await signInAnonymously(auth);
    return credential.user.uid;
  },

  register: async (name: string, email: string, password: string, username?: string): Promise<User> => {
    try {
      if (!username) throw new Error("Username is required.");
      
      await checkUsernameUnique(username);

      const anonymousUser = auth.currentUser?.isAnonymous ? auth.currentUser : null;
      const userCredential = anonymousUser
        ? await linkWithCredential(anonymousUser, EmailAuthProvider.credential(email, password))
        : await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: name });
      await user.getIdToken(true);
      await sendEmailVerification(user, {
        url: `${window.location.origin}/?verified=1`,
      });

      // Create the user document in Firestore - SANITIZED
      const newUserProfile = {
        name,
        username,
        email,
        preferences: sanitizePreferences(defaultPreferences),
        createdAt: new Date().toISOString()
      };

      const batch = writeBatch(db);
      batch.set(doc(db, "users", user.uid), newUserProfile);
      batch.set(usernameDocRef(username), { uid: user.uid, email });
      try {
        await batch.commit();
      } catch (batchError) {
        // Auth user exists but profile write failed (VPN/ad-block, offline, etc.).
        try {
          await deleteUser(user);
        } catch (deleteError) {
          console.warn("Failed to roll back Auth user after profile write error:", deleteError);
        }
        throw batchError;
      }

      return transformUser(user, newUserProfile);
    } catch (error: any) {
      console.error("Registration Error:", error);
      if (error.code === 'auth/email-already-in-use' || error.code === 'auth/credential-already-in-use') {
        throw new Error('This email is already registered.');
      } else if (error.code === 'auth/weak-password') {
        throw new Error('Password should be at least 6 characters.');
      }
      throw new Error(error.message || "Failed to register.");
    }
  },

  login: async (emailOrUsername: string, password: string): Promise<User> => {
    try {
      let email = emailOrUsername;
      
      // If input doesn't look like an email, try to find the email by username
      if (!emailOrUsername.includes('@')) {
        const usernameSnap = await getDoc(usernameDocRef(emailOrUsername));
        if (!usernameSnap.exists()) {
          throw new Error('Username not found.');
        }
        const resolvedEmail = usernameSnap.data()?.email;
        if (typeof resolvedEmail !== 'string' || !resolvedEmail.includes('@')) {
          throw new Error('Username not found.');
        }
        email = resolvedEmail;
      }

      // Existing-account login cannot link an anonymous identity. The guest
      // image is already stored locally and App merges it after login, so end
      // the anonymous Firebase session before authenticating the account.
      if (auth.currentUser?.isAnonymous) await signOut(auth);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const docRef = doc(db, "users", user.uid);
      const docSnap = await getDoc(docRef);

      const userData = docSnap.exists()
        ? (docSnap.data() as Record<string, unknown>)
        : await ensureUserDocument(user.uid, {
            name: user.displayName || "User",
            email: user.email ?? "",
            preferences: sanitizePreferences(defaultPreferences),
          });

      await recordSignIn(user.uid);
      void ensureUsernameReservation(
        user.uid,
        userData.username as string | undefined,
        user.email ?? (userData.email as string | undefined)
      );
      const isAdmin = await readAdminClaim(user);
      return transformUser(user, userData, isAdmin);
    } catch (error: any) {
      console.error("Login Error:", error);
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        throw new Error('Invalid email or password.');
      }
      throw new Error(error.message || "Failed to login.");
    }
  },

  logout: async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('banana_brand_session');
    } catch (error) {
      console.error("Logout Error:", error);
    }
  },

  resendVerification: async (): Promise<void> => {
    const current = auth.currentUser;
    if (!current) throw new Error('Sign in before requesting a verification email.');
    if (current.emailVerified) return;
    await sendEmailVerification(current, { url: `${window.location.origin}/?verified=1` });
  },

  refreshEmailVerification: async (): Promise<boolean> => {
    const current = auth.currentUser;
    if (!current) return false;
    await current.reload();
    await current.getIdToken(true);
    return current.emailVerified;
  },

  getCurrentUser: (): Promise<User | null> => {
    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user && !user.isAnonymous) {
          try {
            const userData = await ensureUserDocument(user.uid);
            const isAdmin = await readAdminClaim(user);
            resolve(transformUser(user, userData, isAdmin));
          } catch (e) {
            console.error("Error fetching user profile:", e);
            resolve(null);
          }
        } else {
          resolve(null);
        }
        unsubscribe(); 
      });
    });
  },

  updateUserPreferences: async (userId: string, preferences: UserPreferences) => {
    try {
      const userRef = doc(db, "users", userId);
      const cleanPreferences = sanitizePreferences(preferences);

      await ensureUserDocument(userId, { preferences: cleanPreferences });
      await updateDoc(userRef, {
        preferences: cleanPreferences
      });
    } catch (error) {
      console.error("Error updating preferences:", error);
      throw new Error("Failed to save preferences.");
    }
  },

  updateUserProfile: async (userId: string, data: { name?: string; username?: string; photoURL?: string; photoDataUrl?: string }) => {
    try {
      const userRef = doc(db, "users", userId);
      const existingSnap = await getDoc(userRef);
      const existing = existingSnap.exists() ? existingSnap.data() : {};
      const previousUsername = typeof existing.username === 'string' ? existing.username : '';
      const accountEmail =
        (typeof existing.email === 'string' && existing.email.includes('@')
          ? existing.email
          : auth.currentUser?.email) ?? '';

      if (data.username) {
        await checkUsernameUnique(data.username, userId);
      }

      // Firestore rejects `undefined` values, so only write fields the caller
      // actually provided. SettingsPage always passes the full triple, but
      // `photoURL` is commonly undefined for accounts without an avatar.
      const clean: Record<string, string> = {};
      if (typeof data.name === 'string' && data.name.length > 0) clean.name = data.name;
      if (typeof data.username === 'string' && data.username.length > 0) clean.username = data.username;
      if (typeof data.photoURL === 'string' && data.photoURL.length > 0) clean.photoURL = data.photoURL;
      if (typeof data.photoDataUrl === 'string' && data.photoDataUrl.startsWith('data:image/')) {
        clean.photoDataUrl = data.photoDataUrl;
      }

      if (Object.keys(clean).length > 0) {
        await updateDoc(userRef, clean);
      }

      if (data.username && accountEmail) {
        const prevKey = previousUsername ? normalizeUsernameKey(previousUsername) : '';
        const nextKey = normalizeUsernameKey(data.username);
        if (prevKey && prevKey !== nextKey) {
          await releaseUsername(previousUsername);
        }
        if (prevKey !== nextKey) {
          await reserveUsername(userId, data.username, accountEmail);
        }
      }

      // If name or photo changed, update Auth profile too. Passing undefined to
      // updateProfile is safe (the SDK treats it as "no change") but we still
      // fall back to the current value so we don't accidentally null anything.
      if (auth.currentUser && auth.currentUser.uid === userId) {
        await updateProfile(auth.currentUser, {
            displayName: clean.name ?? auth.currentUser.displayName ?? undefined,
            photoURL: clean.photoURL ?? auth.currentUser.photoURL ?? undefined
        });
      }
    } catch (error: any) {
      console.error("Error updating user profile:", error);
      throw new Error(error.message || "Failed to update profile.");
    }
  },
  
  onAuthStateChange: (callback: (user: User | null) => void) => {
    return onAuthStateChanged(auth, async (user) => {
      if (user && !user.isAnonymous) {
        const userData = await ensureUserDocument(user.uid);
        const isAdmin = await readAdminClaim(user);
        void recordSignIn(user.uid);
        callback(transformUser(user, userData, isAdmin));
      } else {
        callback(null);
      }
    });
  }
};
