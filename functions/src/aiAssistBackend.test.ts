import test from "node:test";
import assert from "node:assert/strict";
import { buildRunAiAssistOptions, resolveAiAssistBackend, resolveAiAssistVertexConfig } from "./aiAssistBackend";

const stagingServiceAccount = "pixtaffy-aiassist-runtime@pixtaffy-staging.iam.gserviceaccount.com";

test("AI assist defaults to apikey for production, missing, empty and unknown projects", () => {
  for (const project of ["brandoit", undefined, "", "unknown", "toString", "__proto__"]) {
    assert.equal(resolveAiAssistBackend({ GCLOUD_PROJECT: project }), "apikey");
  }
  assert.equal(resolveAiAssistBackend({ GCLOUD_PROJECT: "", GOOGLE_CLOUD_PROJECT: "" }), "apikey");
});

test("discovery selects vertex with only the staging GCLOUD_PROJECT set", () => {
  const env = { GCLOUD_PROJECT: "pixtaffy-staging" };
  const backend = resolveAiAssistBackend(env);
  assert.equal(backend, "vertex");
  assert.deepEqual(buildRunAiAssistOptions({}, env, () => {
    assert.fail("Discovery must not declare a Gemini secret for staging");
  }), { serviceAccount: stagingServiceAccount });
  assert.deepEqual(resolveAiAssistVertexConfig(env), {
    project: "pixtaffy-staging",
    location: "global",
    model: "gemini-3.8-flash",
  });
});

test("backend project fallback treats empty GCLOUD_PROJECT as missing", () => {
  for (const project of [undefined, ""]) {
    assert.equal(resolveAiAssistBackend({ GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: "pixtaffy-staging" }), "vertex");
  }
  assert.equal(resolveAiAssistBackend({ GCLOUD_PROJECT: "brandoit", GOOGLE_CLOUD_PROJECT: "pixtaffy-staging" }), "apikey");
});

test("runtime backend env cannot override the committed project map", () => {
  assert.equal(resolveAiAssistBackend({ AI_ASSIST_BACKEND: "vertex" }), "apikey");
  assert.equal(resolveAiAssistBackend({ GCLOUD_PROJECT: "brandoit", AI_ASSIST_BACKEND: "vertex" }), "apikey");
  assert.equal(resolveAiAssistBackend({ GCLOUD_PROJECT: "pixtaffy-staging", AI_ASSIST_BACKEND: "apikey" }), "vertex");
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
  for (const project of [undefined, ""]) {
    assert.equal(resolveAiAssistVertexConfig({ GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: "fallback-project" }).project, "fallback-project");
  }
  assert.equal(resolveAiAssistVertexConfig({ GCLOUD_PROJECT: "", GOOGLE_CLOUD_PROJECT: "" }).project, undefined);
});

test("apikey options preserve base options and bind the Gemini secret param", () => {
  const base = { region: "us-central1", enforceAppCheck: true };
  const secret = { name: "PIXTAFFY_GEMINI_API_KEY" };
  let calls = 0;
  const options = buildRunAiAssistOptions(base, { GCLOUD_PROJECT: "brandoit" }, () => {
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
  const options = buildRunAiAssistOptions(base, { GCLOUD_PROJECT: "pixtaffy-staging" }, () => {
    assert.fail("Vertex must never request a secret");
  });
  assert.deepEqual(options, { ...base, serviceAccount: stagingServiceAccount });
  assert.equal(Object.prototype.hasOwnProperty.call(options, "secrets"), false);
});

test("unmapped projects omit the serviceAccount key and keep the Gemini secret", () => {
  for (const project of ["brandoit", "unknown", undefined, "", "toString", "__proto__"]) {
    const options = buildRunAiAssistOptions({}, { GCLOUD_PROJECT: project }, () => "PIXTAFFY_GEMINI_API_KEY");
    assert.equal(Object.prototype.hasOwnProperty.call(options, "serviceAccount"), false);
    assert.deepEqual(options, { secrets: ["PIXTAFFY_GEMINI_API_KEY"] });
  }
});

test("runtime identity prefers GCLOUD_PROJECT and treats empty projects as missing", () => {
  for (const project of [undefined, ""]) {
    const options = buildRunAiAssistOptions({}, {
      GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: "pixtaffy-staging",
    }, () => assert.fail("Staging must not request a secret"));
    assert.deepEqual(options, { serviceAccount: stagingServiceAccount });
  }
  for (const project of ["brandoit", "unknown", "toString", "__proto__", ""]) {
    const options = buildRunAiAssistOptions({}, {
      GCLOUD_PROJECT: project, GOOGLE_CLOUD_PROJECT: project ? "pixtaffy-staging" : "",
    }, () => "secret");
    assert.equal(Object.prototype.hasOwnProperty.call(options, "serviceAccount"), false);
  }
});

test("runtime settings cannot override the committed runtime identity", () => {
  for (const project of ["pixtaffy-staging", "brandoit", undefined]) {
    for (const backend of ["apikey", "vertex"]) {
      const env = {
        GCLOUD_PROJECT: project,
        AI_ASSIST_BACKEND: backend,
        AI_ASSIST_SERVICE_ACCOUNT: "override@example.com",
        SERVICE_ACCOUNT: "override@example.com",
        AI_ASSIST_VERTEX_MODEL: "custom-model",
        AI_ASSIST_VERTEX_LOCATION: "us-central1",
      };
      assert.deepEqual(
        buildRunAiAssistOptions({}, env, () => "secret"),
        project === "pixtaffy-staging" ? { serviceAccount: stagingServiceAccount } : { secrets: ["secret"] },
      );
    }
  }
});
