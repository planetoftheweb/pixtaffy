import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { authService } from './authService';
import { ensureAppCheckToken, functions, storage } from './firebase';

export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'other';

export interface SubmitFeedbackInput {
  category: FeedbackCategory;
  message: string;
  contactEmail?: string;
  screenshot?: File | null;
  idempotencyKey: string;
}

export interface SubmitFeedbackResult {
  feedbackId: string;
  issueUrl: string;
  issueNumber: number;
}

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export const makeFeedbackRequestId = (): string => {
  if (globalThis.crypto?.randomUUID) return `feedback:${globalThis.crypto.randomUUID()}`;
  return `feedback:${Date.now()}:${Math.random().toString(36).slice(2, 14)}`;
};

function validateScreenshot(file: File): void {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG, WebP, or GIF screenshot.');
  }
  if (file.size > MAX_SCREENSHOT_BYTES) throw new Error('Keep screenshots under 5 MB.');
}

async function uploadScreenshot(file: File, uid: string): Promise<string> {
  validateScreenshot(file);
  const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'png';
  const objectName = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}.${extension}`;
  const uploadRef = ref(storage, `feedbackUploads/${uid}/${objectName}`);
  await uploadBytes(uploadRef, file, { contentType: file.type });
  return getDownloadURL(uploadRef);
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  const uid = await authService.ensureAnonymousSession();
  await ensureAppCheckToken();
  const screenshotUrl = input.screenshot ? await uploadScreenshot(input.screenshot, uid) : undefined;
  const call = httpsCallable<
    {
      category: FeedbackCategory;
      message: string;
      contactEmail?: string;
      screenshotUrl?: string;
      pageUrl: string;
      userAgent: string;
      viewport: string;
      appVersion: string;
      idempotencyKey: string;
    },
    SubmitFeedbackResult
  >(functions, 'submitFeedback');
  const result = await call({
    category: input.category,
    message: input.message.trim(),
    contactEmail: input.contactEmail?.trim() || undefined,
    screenshotUrl,
    pageUrl: window.location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    appVersion: '0.27.0',
    idempotencyKey: input.idempotencyKey,
  });
  return result.data;
}

export function feedbackErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : '';
  const message = raw.replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[a-z-]+\)\.?$/i, '').trim();
  return message || 'We could not send that just now. Check your connection, then try again.';
}
