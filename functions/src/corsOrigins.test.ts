import { test } from "node:test";
import assert from "node:assert/strict";
import { stagingOrigins } from "./corsOrigins";

test("staging origins require the staging runtime project", () => {
  for (const env of [
    {},
    { GCLOUD_PROJECT: "brandoit" },
    { FIREBASE_CONFIG: "invalid" },
    { FIREBASE_CONFIG: "null" },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: "brandoit" }) },
    { GCLOUD_PROJECT: "brandoit", FIREBASE_CONFIG: JSON.stringify({ projectId: "pixtaffy-staging" }) },
  ]) {
    assert.deepEqual(stagingOrigins(env), []);
  }
});

test("staging permits its hosting sites and only matching preview origins", () => {
  for (const env of [
    { GCLOUD_PROJECT: "pixtaffy-staging" },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: "pixtaffy-staging" }) },
  ]) {
    const origins = stagingOrigins(env);
    const permits = (origin: string) => origins.some(rule =>
      typeof rule === "string" ? rule === origin : rule.test(origin));
    for (const origin of [
      "https://pixtaffy-staging.web.app",
      "https://pixtaffy-staging.firebaseapp.com",
      "https://pixtaffy-staging--key-flow-123.web.app",
    ]) assert.equal(permits(origin), true);
    for (const origin of [
      "http://pixtaffy-staging.web.app",
      "https://pixtaffy-staging--.web.app",
      "https://pixtaffy-staging--preview.web.app.evil.example",
      "https://other-project--preview.web.app",
    ]) assert.equal(permits(origin), false);
  }
});
