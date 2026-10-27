import test from "node:test";
import assert from "node:assert/strict";
import { buildRunAiAssistOptions, parseAiAssistBackend, resolveAiAssistVertexConfig } from "./aiAssistBackend";

test("AI assist defaults to apikey for missing, blank, apikey and unknown values", () => {
  for (const raw of [undefined, "", "   ", "APIKEY", "apikey", "bogus"]) {
    assert.equal(parseAiAssistBackend(raw), "apikey");
  }
});

test("AI assist selects vertex only for the normalized vertex value", () => {
  for (const raw of ["vertex", "VERTEX", " Vertex "]) {
    assert.equal(parseAiAssistBackend(raw), "vertex");
  }
});

test("Vertex config defaults for missing, empty and whitespace settings", () => {
  for (const value of [undefined, "", "   "]) {
    assert.deepEqual(resolveAiAssistVertexConfig({
      AI_ASSIST_VERTEX_LOCATION: value,
      AI_ASSIST_VERTEX_MODEL: value,
    }), { project: undefined, location: "global", model: "gemini-3.8-flash" });
  }
});

test("Vertex config honors overrides and prefers GCLOUD_PROJECT", () => {
  assert.deepEqual(resolveAiAssistVertexConfig({
    GCLOUD_PROJECT: "primary-project",
    GOOGLE_CLOUD_PROJECT: "fallback-project",
    AI_ASSIST_VERTEX_LOCATION: " us-central1 ",
    AI_ASSIST_VERTEX_MODEL: " custom-model ",
  }), { project: "primary-project", location: "us-central1", model: "custom-model" });
});

test("Vertex project falls back to GOOGLE_CLOUD_PROJECT", () => {
  assert.equal(resolveAiAssistVertexConfig({ GOOGLE_CLOUD_PROJECT: "fallback-project" }).project, "fallback-project");
});

test("apikey options preserve base options and bind the Gemini secret param", () => {
  const base = { region: "us-central1", enforceAppCheck: true };
  const secret = { name: "PIXTAFFY_GEMINI_API_KEY" };
  let calls = 0;
  const options = buildRunAiAssistOptions(base, "apikey", () => {
    calls += 1;
    return secret;
  });
  assert.deepEqual(options, { ...base, secrets: [secret] });
  assert.equal(options.secrets?.[0], secret);
  assert.equal(calls, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(base, "secrets"), false);
});

test("vertex options preserve base options without secrets or invoking the secret factory", () => {
  const base = { region: "us-central1", enforceAppCheck: true };
  const options = buildRunAiAssistOptions(base, "vertex", () => {
    assert.fail("Vertex must never request a secret");
  });
  assert.deepEqual(options, base);
  assert.equal(Object.prototype.hasOwnProperty.call(options, "secrets"), false);
});
