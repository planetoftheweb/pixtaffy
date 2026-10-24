import { clearUserApiKeys as clearServerKeys, listUserKeyProfiles, countUserKeyProfiles, type SafeUserProfile } from './userApiKeyService';
import {
  doc,
  updateDoc,
  deleteField,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";
import { User } from "../types";

export interface AdminUserRow {
  id: string;
  name?: string;
  username?: string;
  email?: string;
  photoURL?: string;
  createdAt?: string | number;
  lastSignInAt?: any; // Firestore Timestamp | number | string
  selectedModel?: string;
  hasGeminiKey: boolean;
  hasOpenAIKey: boolean;
  isAdmin: boolean; // Best-effort (from legacy username OR future doc cache only)
  isDisabled: boolean;
}

export interface ListUsersPage {
  rows: AdminUserRow[];
  cursor: string | null;
  pageSize: number;
}

function rowFromDoc(data: SafeUserProfile): AdminUserRow {
  const apiKeys = data?.preferences?.apiKeyStatus ?? {};
  return {
    id: data.id,
    name: data?.name,
    username: data?.username,
    email: data?.email,
    photoURL: data?.photoURL,
    createdAt: data?.createdAt,
    lastSignInAt: data?.lastSignInAt,
    selectedModel: data?.preferences?.selectedModel,
    hasGeminiKey: Boolean(apiKeys?.gemini?.hasKey),
    hasOpenAIKey: Boolean(apiKeys?.openai?.hasKey),
    // Claims-based isAdmin cannot be read from another user's document. The
    // admin page treats the row-level flag as "best-effort from persisted
    // data" and relies on the Cloud Function to enforce truth. Kept for the
    // legacy bootstrap case where the first admin is `planetoftheweb`.
    isAdmin: data?.username === "planetoftheweb",
    isDisabled: data?.isDisabled === true,
  };
}

export const adminService = {
  /** Reads the live admin claim off the current user's ID token. Forces a refresh. */
  async isCurrentUserAdmin(): Promise<boolean> {
    const current = auth.currentUser;
    if (!current) return false;
    const token = await current.getIdTokenResult(true);
    return token.claims?.admin === true;
  },

  /** Total user count (server-side aggregation). */
  async countUsers(): Promise<number> {
    return countUserKeyProfiles();
  },

  /**
   * Paginated list of sanitized profiles, 100 per page, ordered by document ID.
   * Pass `cursor` from the previous page to load the next one.
   */
  async listUsers(cursor?: string | null): Promise<ListUsersPage> {
    const page = await listUserKeyProfiles(cursor ? { cursor } : {});
    return { rows: page.rows.map(rowFromDoc), cursor: page.cursor, pageSize: 100 };
  },

  /** Wipe both legacy `geminiApiKey` and the new `apiKeys` map. */
  async clearUserApiKeys(uid: string): Promise<void> {
    await clearServerKeys(uid);
  },

  /** Remove the user's custom system prompt. */
  async clearUserSystemPrompt(uid: string): Promise<void> {
    const ref = doc(db, "users", uid);
    await updateDoc(ref, {
      "preferences.systemPrompt": deleteField(),
    });
  },

  /** Enable/disable a user. Disabled users get a hard-block screen on next load. */
  async setUserDisabled(uid: string, disabled: boolean): Promise<void> {
    const ref = doc(db, "users", uid);
    await updateDoc(ref, { isDisabled: disabled });
  },

  /** Promote a user to admin via the `setAdminRole` Cloud Function. */
  async promoteToAdmin(uid: string): Promise<void> {
    const fn = httpsCallable(functions, "setAdminRole");
    await fn({ uid, admin: true });
    // Refresh current user's token so they immediately see their own status update
    // if they promoted themselves.
    await auth.currentUser?.getIdToken(true);
  },

  /** Demote a user from admin. */
  async demoteFromAdmin(uid: string): Promise<void> {
    const fn = httpsCallable(functions, "setAdminRole");
    await fn({ uid, admin: false });
    await auth.currentUser?.getIdToken(true);
  },

  /**
   * Conservative full deletion: user doc + history + `users/{uid}/*` storage +
   * Auth user. Teams and catalog items are left alone by design.
   */
  async deleteUserCompletely(uid: string): Promise<void> {
    const fn = httpsCallable(functions, "deleteUserAccount");
    await fn({ uid });
  },
};

export type AdminService = typeof adminService;

// Re-export a lightweight type for consumers that don't need the Firestore snapshot.
export type { User };
