import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { GeneratedImage } from '../types';
import { auth, db, ensureAppCheckToken, functions, isLocalDevelopmentPreview } from './firebase';

export interface BillingState {
  balanceMilliCredits: number;
  balanceCredits: number | null;
  plan: 'free' | 'pro';
  subscriptionStatus: string | null;
  subscriptionRenewsAt: number | null;
  stripeCustomerId: string | null;
  paidCustomer: boolean;
  starterGranted: boolean;
  historyLimit: number;
  isAdmin: boolean;
}

export interface PaidModelCatalogEntry {
  modelId: string;
  label: string;
  milliCredits: number;
}

export interface GuestCreditState {
  grantedMilliCredits: number;
  spentMilliCredits: number;
  balanceMilliCredits: number;
}

export interface CreditActivityEntry {
  id: string;
  deltaMilliCredits: number;
  reason: string;
  createdAt: number;
  expiresAt: number | null;
  metadata?: Record<string, unknown>;
}

let cachedState: { value: BillingState; at: number } | null = null;
const GUEST_INSTALL_ID_KEY = 'pixtaffy_guest_install_id_v1';
const GUEST_REQUEST_ID_KEY = 'pixtaffy_guest_request_id_v2';
const GUEST_GENERATION_TIMEOUT_MS = 120_000;

const readableGuestGenerationError = (error: unknown): Error => {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  if (code === 'functions/deadline-exceeded') {
    return new Error('PixTaffy did not receive your image within two minutes. Try again with the same prompt.');
  }
  if (code === 'functions/unauthenticated' || code === 'functions/permission-denied') {
    return new Error(isLocalDevelopmentPreview
      ? "Firebase rejected this local preview's secure development pass. Restart the PixTaffy preview and try again."
      : "PixTaffy couldn't complete the security check for your guest image. Try again, or open PixTaffy in another browser.");
  }
  return error instanceof Error ? error : new Error('Your guest image could not be generated. Try again.');
};

const persistentGuestId = (key: string, prefix: string): string => {
  const existing = localStorage.getItem(key);
  if (existing && existing.length >= 16 && existing.length <= 160) return existing;
  const created = makeRequestId(prefix);
  localStorage.setItem(key, created);
  return created;
};

export const SITE_FUNDED_MODEL_MILLICREDITS: Record<string, number> = {
  'openrouter:bytedance-seed/seedream-4.5': 1_000,
  'openrouter:x-ai/grok-imagine-image-quality': 1_000,
  'openrouter:black-forest-labs/flux.2-pro': 2_000,
  'openrouter:recraft/recraft-v4.1-pro': 3_000,
  'openrouter:google/gemini-3-pro-image': 2_000,
  'openrouter:openai/gpt-image-2': 2_000,
  gemini: 2_000,
  'gemini-3.1-flash-image-preview': 2_000,
  'gemini-3.1-flash-lite-image': 2_000,
  'openai-2': 2_000,
};

export const makeRequestId = (prefix: string): string =>
  `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export const billingService = {
  clearCache: () => {
    cachedState = null;
  },

  getBillingState: async (force = false): Promise<BillingState> => {
    if (!auth.currentUser) throw new Error('Sign in to view credits.');
    if (!force && cachedState && Date.now() - cachedState.at < 30_000) return cachedState.value;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    await ensureAppCheckToken();
    const call = httpsCallable<Record<string, never>, BillingState>(functions, 'getBillingState');
    const result = await call({});
    cachedState = { value: result.data, at: Date.now() };
    return result.data;
  },

  getCreditActivity: async (): Promise<CreditActivityEntry[]> => {
    const call = httpsCallable<{ limit: number }, { entries: CreditActivityEntry[] }>(functions, 'getCreditActivity');
    const result = await call({ limit: 25 });
    return result.data.entries;
  },

  getPaidAiCatalog: async (): Promise<{ models: PaidModelCatalogEntry[]; helpers: Record<string, number> }> => {
    const call = httpsCallable<Record<string, never>, { models: PaidModelCatalogEntry[]; helpers: Record<string, number> }>(functions, 'getPaidAiCatalog');
    return (await call({})).data;
  },

  getGuestCreditState: async (): Promise<GuestCreditState> => {
    if (!auth.currentUser?.isAnonymous) {
      throw new Error('Start a guest session before checking guest credits.');
    }
    const payload = {
      guestInstallId: persistentGuestId(GUEST_INSTALL_ID_KEY, 'guest-install'),
    };
    await ensureAppCheckToken();
    const call = httpsCallable<typeof payload, GuestCreditState>(functions, 'getGuestCreditState');
    return (await call(payload)).data;
  },

  generateWithCredits: async (input: {
    modelId: string;
    prompt: string;
    aspectRatio: string;
    idempotencyKey: string;
    batchReservationId?: string | null;
  }): Promise<GeneratedImage & { milliCreditsCharged: number; balanceMilliCredits: number }> => {
    const call = httpsCallable<typeof input, GeneratedImage & { milliCreditsCharged: number; balanceMilliCredits: number }>(
      functions,
      'generateWithCredits',
      { timeout: 300_000 }
    );
    const result = await call(input);
    cachedState = null;
    return result.data;
  },

  generateGuestImage: async (input: {
    modelId: string;
    prompt: string;
    aspectRatio: string;
  }): Promise<GeneratedImage & { modelId: string; milliCreditsCharged: number; balanceMilliCredits: number }> => {
    if (!auth.currentUser?.isAnonymous) {
      throw new Error('Start a guest session before using guest credits.');
    }
    const payload = {
      ...input,
      guestInstallId: persistentGuestId(GUEST_INSTALL_ID_KEY, 'guest-install'),
      idempotencyKey: persistentGuestId(GUEST_REQUEST_ID_KEY, 'guest-image'),
    };
    await ensureAppCheckToken();
    const call = httpsCallable<typeof payload, GeneratedImage & { modelId: string; milliCreditsCharged: number; balanceMilliCredits: number }>(
      functions,
      'generateGuestImage',
      { timeout: GUEST_GENERATION_TIMEOUT_MS }
    );
    try {
      const result = (await call(payload)).data;
      localStorage.removeItem(GUEST_REQUEST_ID_KEY);
      return result;
    } catch (error) {
      throw readableGuestGenerationError(error);
    }
  },

  reserveImageBatch: async (input: {
    models: Array<{ modelId: string; count: number }>;
    idempotencyKey: string;
  }): Promise<{
    reservationId: string | null;
    totalMilliCredits: number;
    balanceMilliCredits: number;
    adminBypass: boolean;
  }> => {
    const call = httpsCallable<typeof input, {
      reservationId: string | null;
      totalMilliCredits: number;
      balanceMilliCredits: number;
      adminBypass: boolean;
    }>(functions, 'reserveImageBatch');
    const response = await call(input);
    cachedState = null;
    return response.data;
  },

  releaseImageBatchRemainder: async (reservationId: string): Promise<number> => {
    const call = httpsCallable<{ reservationId: string }, { balanceMilliCredits: number }>(
      functions,
      'releaseImageBatchRemainder'
    );
    const response = await call({ reservationId });
    cachedState = null;
    return response.data.balanceMilliCredits;
  },

  runAiAssist: async <T>(input: {
    action: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<T> => {
    const call = httpsCallable<
      { action: string; payload: Record<string, unknown>; idempotencyKey: string },
      { result: T; milliCreditsCharged: number; balanceMilliCredits: number }
    >(functions, 'runAiAssist', { timeout: 300_000 });
    const response = await call({
      ...input,
      idempotencyKey: input.idempotencyKey ?? makeRequestId(`assist-${input.action}`),
    });
    cachedState = null;
    return response.data.result;
  },

  startCheckout: async (productId: 'credits_25' | 'credits_100' | 'credits_300' | 'pro_monthly'): Promise<void> => {
    const call = httpsCallable<{ productId: string; origin: string }, { sessionId: string }>(functions, 'createCheckout');
    const response = await call({ productId, origin: window.location.origin });
    const sessionId = response.data.sessionId;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        unsubscribe();
        reject(new Error('Checkout took too long to start. Please try again.'));
      }, 20_000);
      const unsubscribe = onSnapshot(
        doc(db, 'customers', auth.currentUser!.uid, 'checkout_sessions', sessionId),
        (snapshot) => {
          const data = snapshot.data() as { url?: string; error?: { message?: string } } | undefined;
          if (data?.error) {
            window.clearTimeout(timer);
            unsubscribe();
            reject(new Error(data.error.message ?? 'Stripe checkout failed.'));
          } else if (data?.url) {
            window.clearTimeout(timer);
            unsubscribe();
            window.location.assign(data.url);
            resolve();
          }
        },
        (error) => {
          window.clearTimeout(timer);
          unsubscribe();
          reject(error);
        }
      );
    });
  },

  openCustomerPortal: async (): Promise<void> => {
    const call = httpsCallable<{ returnUrl: string }, { url: string }>(
      functions,
      'ext-firestore-stripe-payments-createPortalLink'
    );
    const response = await call({ returnUrl: `${window.location.origin}/?billing=1` });
    if (!response.data.url) throw new Error('Stripe customer portal is unavailable.');
    window.location.assign(response.data.url);
  },
};
