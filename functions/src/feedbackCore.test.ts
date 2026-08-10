import test from "node:test";
import assert from "node:assert/strict";
import {
  feedbackIssueBody,
  feedbackIssueLabels,
  feedbackIssueTitle,
  isFeedbackCategory,
  normalizePageUrl,
} from "./feedbackCore";

test("feedback categories and issue labels are constrained", () => {
  assert.equal(isFeedbackCategory("bug"), true);
  assert.equal(isFeedbackCategory("security"), false);
  assert.deepEqual(feedbackIssueLabels({ category: "idea", isAdmin: false }), [
    "user-feedback",
    "feedback:idea",
  ]);
  assert.deepEqual(feedbackIssueLabels({ category: "bug", isAdmin: true }), [
    "user-feedback",
    "feedback:bug",
    "admin-feedback",
    "agent-todo",
  ]);
});

test("issue copy stays bounded and keeps private contact details out", () => {
  const message = "A".repeat(100);
  assert.equal(
    feedbackIssueTitle({ category: "bug", message, isAdmin: false }),
    `[Feedback] [bug] ${"A".repeat(72)}…`,
  );
  const body = feedbackIssueBody({
    category: "bug",
    message: "The model menu clips on my phone.",
    screenshotUrl: null,
    feedbackId: "feedback-1",
    accountHash: "acct_123",
    signedIn: true,
    isAdmin: false,
    pageUrl: "https://pixtaffy.com/",
    userAgent: "Example Browser",
    viewport: "390x844",
    appVersion: "0.27.0",
  });
  assert.match(body, /Contact details.*private Firebase record/);
  assert.doesNotMatch(body, /@/);

  const adminBody = feedbackIssueBody({
    category: "idea",
    message: "Add a faster way to compare model results.",
    screenshotUrl: null,
    feedbackId: "feedback-2",
    accountHash: "acct_admin",
    signedIn: true,
    isAdmin: true,
    pageUrl: "https://pixtaffy.com/",
    userAgent: "Example Browser",
    viewport: "1440x900",
    appVersion: "0.29.0",
  });
  assert.match(adminBody, /open a GitHub PR/);
});

test("page context only accepts PixTaffy and local development origins", () => {
  assert.equal(normalizePageUrl("https://pixtaffy.com/?secret=1#prompt"), "https://pixtaffy.com/");
  assert.equal(normalizePageUrl("http://localhost:3000/settings?tab=keys"), "http://localhost:3000/settings");
  assert.equal(normalizePageUrl("https://example.com/"), null);
});
