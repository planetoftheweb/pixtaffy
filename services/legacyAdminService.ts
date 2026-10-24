import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  limit as limitFn,
  orderBy,
  query,
  startAfter,
  updateDoc,
  deleteField,
  QueryDocumentSnapshot,
  DocumentData,
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
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  pageSize: number;
}

const PAGE_SIZE = 25;

function rowFromDoc(snap: QueryDocumentSnapshot<DocumentData>): AdminUserRow {
  const data = snap.data() as any;
  const apiKeys = data?.preferences?.apiKeys ?? {};
  return {
    id: snap.id,
    name: data?.name,
    username: data?.username,
    email: data?.email,
    photoURL: data?.photoURL,
    createdAt: data?.createdAt,
    lastSignInAt: data?.lastSignInAt,
    selectedModel: data?.preferences?.selectedModel,
    hasGeminiKey: Boolean(apiKeys?.gemini?.trim?.() || data?.preferences?.geminiApiKey?.trim?.()),
    hasOpenAIKey: Boolean(apiKeys?.openai?.trim?.()),
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
    const snap = await getCountFromServer(collection(db, "users"));
    return snap.data().count ?? 0;
  },

  /**
   * Paginated list of users, 25 per page, ordered by createdAt desc.
   * Pass `cursor` from the previous page to load the next one.
   */
  async listUsers(cursor?: QueryDocumentSnapshot<DocumentData> | null): Promise<ListUsersPage> {
    const usersRef = collection(db, "users");
    const constraints: any[] = [orderBy("createdAt", "desc"), limitFn(PAGE_SIZE)];
    if (cursor) constraints.splice(1, 0, startAfter(cursor));

    const snap = await getDocs(query(usersRef, ...constraints));
    const rows = snap.docs.map(rowFromDoc);
    const nextCursor = snap.docs.length === PAGE_SIZE ? snap.docs[snap.docs.length - 1] : null;

    return { rows, cursor: nextCursor, pageSize: PAGE_SIZE };
  },

  /** Wipe both legacy `geminiApiKey` and the new `apiKeys` map. */
  async clearUserApiKeys(uid: string): Promise<void> {
    const ref = doc(db, "users", uid);
    await updateDoc(ref, {
      "preferences.apiKeys": {},
      "preferences.geminiApiKey": deleteField(),
    });
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
