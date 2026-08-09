import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  feedbackIssueBody,
  feedbackIssueLabels,
  feedbackIssueTitle,
  isFeedbackCategory,
  normalizePageUrl,
  type FeedbackCategory,
  type FeedbackIssueInput,
} from "./feedbackCore";

const REGION = "us-central1";
const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");
const GITHUB_REPO = "planetoftheweb/pixtaffy";
const ALLOWED_ORIGINS: Array<string | RegExp> = [
  "https://pixtaffy.com",
  "https://www.pixtaffy.com",
  "https://pixtaffy.web.app",
  "https://pixtaffy.firebaseapp.com",
  /^https:\/\/pixtaffy--[a-z0-9-]+\.web\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

const LABEL_META: Record<string, { color: string; description: string }> = {
  "user-feedback": { color: "0E8A16", description: "Submitted from PixTaffy" },
  "feedback:bug": { color: "D73A4A", description: "Something is broken or confusing" },
  "feedback:idea": { color: "A2EEEF", description: "Feature or improvement idea" },
  "feedback:question": { color: "D876E3", description: "Product question" },
  "feedback:other": { color: "CFD3D7", description: "Other user feedback" },
  "admin-feedback": { color: "B60205", description: "Submitted by a PixTaffy administrator" },
  "agent-todo": { color: "5319E7", description: "Ready for agent pickup" },
};

const db = () => admin.firestore();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function requestIp(request: CallableRequest): string {
  const forwarded = request.rawRequest.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || request.rawRequest.ip || "unknown");
  return value.split(",")[0].trim();
}

function isRegistered(request: CallableRequest): boolean {
  const provider = (request.auth?.token as { firebase?: { sign_in_provider?: string } } | undefined)?.firebase?.sign_in_provider;
  return Boolean(request.auth?.uid && provider !== "anonymous");
}

function cleanText(value: unknown, max: number): string | null {
  const text = typeof value === "string" ? value.trim().slice(0, max) : "";
  return text || null;
}

function cleanLine(value: unknown, max: number): string | null {
  const text = cleanText(value, max);
  return text ? text.replace(/\s+/g, " ") : null;
}

function validateEmail(value: unknown): string | null {
  const email = cleanText(value, 320);
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid contact email or leave it blank.");
  }
  return email;
}

function validateScreenshotUrl(value: unknown, uid: string): string | null {
  const raw = cleanText(value, 2_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const allowedHost = url.hostname === "firebasestorage.googleapis.com" || url.hostname === "storage.googleapis.com";
    const decoded = decodeURIComponent(url.pathname);
    if (!allowedHost || !decoded.includes(`feedbackUploads/${uid}/`)) throw new Error("bad screenshot");
    return raw;
  } catch {
    throw new HttpsError("invalid-argument", "That screenshot is not a PixTaffy feedback upload.");
  }
}

async function enforceWindow(key: string, hourLimit: number, dayLimit: number): Promise<void> {
  const now = Date.now();
  const hourMs = 60 * 60 * 1_000;
  const dayMs = 24 * hourMs;
  const ref = db().doc(`feedbackRateLimits/${sha(key)}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const hourStart = Number(data.hourStart ?? now);
    const dayStart = Number(data.dayStart ?? now);
    const hourCount = now - hourStart < hourMs ? Number(data.hourCount ?? 0) : 0;
    const dayCount = now - dayStart < dayMs ? Number(data.dayCount ?? 0) : 0;
    if (hourCount >= hourLimit || dayCount >= dayLimit) {
      throw new HttpsError("resource-exhausted", "You have sent several notes already. Give us a little time, then try again.");
    }
    tx.set(ref, {
      hourStart: now - hourStart < hourMs ? hourStart : now,
      hourCount: hourCount + 1,
      dayStart: now - dayStart < dayMs ? dayStart : now,
      dayCount: dayCount + 1,
      updatedAt: now,
    });
  });
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pixtaffy-feedback",
  };
}

async function ensureLabel(token: string, name: string): Promise<void> {
  const meta = LABEL_META[name];
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/labels`, {
    method: "POST",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name, color: meta?.color || "EDEDED", description: meta?.description || name }),
  });
  if (response.ok || response.status === 422) return;
  logger.warn("Unable to ensure feedback label", { name, status: response.status });
}

async function findExistingIssue(
  token: string,
  feedbackId: string,
): Promise<{ issueUrl: string; issueNumber: number } | null> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/issues?state=all&per_page=100&sort=created&direction=desc`,
    { headers: githubHeaders(token) },
  );
  if (!response.ok) {
    logger.warn("Unable to check recent feedback issues", { status: response.status });
    return null;
  }
  const issues = (await response.json()) as Array<{
    body?: string | null;
    html_url?: string;
    number?: number;
  }>;
  const marker = `Feedback id: \`${feedbackId}\``;
  const match = issues.find((issue) => issue.body?.includes(marker));
  return match?.html_url && match.number
    ? { issueUrl: match.html_url, issueNumber: match.number }
    : null;
}

async function createIssue(token: string, input: FeedbackIssueInput): Promise<{ issueUrl: string; issueNumber: number }> {
  const existing = await findExistingIssue(token, input.feedbackId);
  if (existing) return existing;
  const labels = feedbackIssueLabels(input);
  await Promise.all(labels.map((label) => ensureLabel(token, label)));
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: "POST",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      title: feedbackIssueTitle(input),
      body: feedbackIssueBody(input),
      labels,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    logger.error("GitHub feedback issue creation failed", { status: response.status, detail });
    throw new HttpsError("unavailable", "Your note could not reach GitHub just now. It is saved, so you can try again later.");
  }
  const issue = (await response.json()) as { html_url?: string; number?: number };
  if (!issue.html_url || !issue.number) throw new HttpsError("internal", "GitHub returned an incomplete issue.");
  return { issueUrl: issue.html_url, issueNumber: issue.number };
}

function storedFeedbackIssueInput(
  data: Record<string, unknown>,
  feedbackId: string,
): FeedbackIssueInput {
  const category = String(data.category || "");
  if (!isFeedbackCategory(category)) {
    throw new HttpsError("failed-precondition", "That saved feedback record is incomplete.");
  }
  return {
    category,
    message: String(data.message || ""),
    screenshotUrl: typeof data.screenshotUrl === "string" ? data.screenshotUrl : null,
    feedbackId,
    accountHash: String(data.accountHash || "account_unknown"),
    signedIn: data.signedIn === true,
    isAdmin: data.fromAdmin === true,
    pageUrl: typeof data.pageUrl === "string" ? data.pageUrl : null,
    userAgent: typeof data.userAgent === "string" ? data.userAgent : null,
    viewport: typeof data.viewport === "string" ? data.viewport : null,
    appVersion: typeof data.appVersion === "string" ? data.appVersion : null,
  };
}

async function markIssueCreated(
  feedbackRef: FirebaseFirestore.DocumentReference,
  requestRef: FirebaseFirestore.DocumentReference,
  issue: { issueUrl: string; issueNumber: number },
): Promise<void> {
  await Promise.all([
    feedbackRef.update({ ...issue, githubStatus: "created", issueState: "open", updatedAt: admin.firestore.FieldValue.serverTimestamp() }),
    requestRef.update({ ...issue, status: "created", updatedAt: admin.firestore.FieldValue.serverTimestamp() }),
  ]);
}

export const submitFeedback = onCall(
  {
    region: REGION,
    cors: ALLOWED_ORIGINS,
    enforceAppCheck: true,
    secrets: [GITHUB_TOKEN],
    timeoutSeconds: 30,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Open PixTaffy again, then send your note.");
    const category = String(request.data?.category || "").trim().toLowerCase();
    const message = String(request.data?.message || "").trim();
    const idempotencyKey = String(request.data?.idempotencyKey || "").trim();
    if (!isFeedbackCategory(category)) throw new HttpsError("invalid-argument", "Choose a feedback category.");
    if (message.length < 3 || message.length > 8_000) {
      throw new HttpsError("invalid-argument", "Write a note between 3 and 8,000 characters.");
    }
    if (!/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)) {
      throw new HttpsError("invalid-argument", "A valid feedback request id is required.");
    }

    const requestRef = db().doc(`feedbackRequests/${sha(`${uid}:${idempotencyKey}`)}`);
    const existing = await requestRef.get();
    if (existing.exists) {
      const data = existing.data() ?? {};
      if (data.status === "created") {
        return {
          feedbackId: data.feedbackId,
          issueUrl: data.issueUrl,
          issueNumber: data.issueNumber,
        };
      }
      const feedbackId = String(data.feedbackId || "");
      const feedbackRef = feedbackId ? db().doc(`feedback/${feedbackId}`) : null;
      const feedbackSnap = feedbackRef ? await feedbackRef.get() : null;
      if (!feedbackRef || !feedbackSnap?.exists || feedbackSnap.data()?.userId !== uid) {
        throw new HttpsError("failed-precondition", "That saved feedback request is incomplete.");
      }
      const createdAt = data.createdAt instanceof admin.firestore.Timestamp
        ? data.createdAt.toMillis()
        : Date.now();
      if (data.status === "pending" && Date.now() - createdAt < 60_000) {
        throw new HttpsError("aborted", "That note is still being sent. Wait a moment before retrying.");
      }
      const token = GITHUB_TOKEN.value().trim();
      if (!token) throw new HttpsError("failed-precondition", "GitHub feedback is not configured yet.");
      const issue = await createIssue(token, storedFeedbackIssueInput(feedbackSnap.data() ?? {}, feedbackId));
      await markIssueCreated(feedbackRef, requestRef, issue);
      return { feedbackId, ...issue };
    }

    await Promise.all([
      enforceWindow(`account:${uid}`, 5, 20),
      enforceWindow(`ip:${requestIp(request)}`, 10, 40),
    ]);

    const feedbackRef = db().collection("feedback").doc();
    const registered = isRegistered(request);
    const contactEmail = validateEmail(request.data?.contactEmail) || (registered ? cleanText(request.auth?.token?.email, 320) : null);
    const screenshotUrl = validateScreenshotUrl(request.data?.screenshotUrl, uid);
    const profile = request.auth?.token?.admin === true
      ? null
      : await db().doc(`users/${uid}`).get().catch(() => null);
    const isAdmin = request.auth?.token?.admin === true || profile?.data()?.username === "planetoftheweb";
    const accountHash = `acct_${sha(uid).slice(0, 12)}`;
    const feedback = {
      category: category as FeedbackCategory,
      message,
      contactEmail,
      screenshotUrl,
      userId: uid,
      accountHash,
      signedIn: registered,
      fromAdmin: isAdmin,
      pageUrl: normalizePageUrl(request.data?.pageUrl),
      userAgent: cleanLine(request.data?.userAgent, 500),
      viewport: cleanLine(request.data?.viewport, 40),
      appVersion: cleanLine(request.data?.appVersion, 40),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      githubStatus: "pending",
      issueUrl: null,
      issueNumber: null,
    };

    await db().runTransaction(async (tx) => {
      const duplicate = await tx.get(requestRef);
      if (duplicate.exists) throw new HttpsError("already-exists", "That note is already being sent.");
      tx.create(requestRef, {
        status: "pending",
        feedbackId: feedbackRef.id,
        userId: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.create(feedbackRef, feedback);
    });

    try {
      const token = GITHUB_TOKEN.value().trim();
      if (!token) throw new HttpsError("failed-precondition", "GitHub feedback is not configured yet.");
      const issue = await createIssue(token, {
        category: category as FeedbackCategory,
        message,
        screenshotUrl,
        feedbackId: feedbackRef.id,
        accountHash,
        signedIn: registered,
        isAdmin,
        pageUrl: feedback.pageUrl,
        userAgent: feedback.userAgent,
        viewport: feedback.viewport,
        appVersion: feedback.appVersion,
      });
      await markIssueCreated(feedbackRef, requestRef, issue);
      return { feedbackId: feedbackRef.id, ...issue };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown GitHub error";
      await Promise.all([
        feedbackRef.update({ githubStatus: "error", githubError: messageText.slice(0, 500), updatedAt: admin.firestore.FieldValue.serverTimestamp() }),
        requestRef.update({ status: "error", updatedAt: admin.firestore.FieldValue.serverTimestamp() }),
      ]).catch((writeError) => logger.error("Unable to record feedback failure", { writeError }));
      throw error instanceof HttpsError ? error : new HttpsError("unavailable", "Your note was saved, but GitHub is unavailable. Try again later.");
    }
  },
);
