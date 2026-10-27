import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { HttpsError } from "firebase-functions/v2/https";
import { writePaidAssistDeliveryWithRetry, type CachedPaidAssistDelivery } from "./paidDelivery";
import { geminiAssistCost } from "./geminiRates";
import { isAssistBlocked, mapAiAssistError, runAiAssist } from "./paidAi";

const delivery: CachedPaidAssistDelivery = {
  version: 1, uid: "user", idempotencyKey: "request-123", action: "expand_prompt",
  createdAt: 1, reservationId: "reservation", result: "stored result",
  milliCreditsCharged: 100, balanceMilliCredits: 900, actualCostUsd: 0.001, usage: null,
};
const noWait = async () => {};
type AssistFile = NonNullable<Parameters<typeof writePaidAssistDeliveryWithRetry>[1]>;
function fakeFile(save: AssistFile["save"], stored: unknown = delivery): AssistFile {
  return { save, download: async () => [Buffer.from(JSON.stringify(stored))] } as AssistFile;
}

test("assist cache creates with unchanged metadata and create-only precondition", async () => {
  let saves = 0;
  const file = fakeFile(async (data: unknown, options: any) => {
    saves++;
    assert.equal(data, JSON.stringify(delivery));
    assert.deepEqual(options, {
      resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, contentType: "application/json",
      metadata: { cacheControl: "private,no-store,max-age=0", metadata: { pixtaffyAssistDelivery: "true", createdAt: "1" } },
    });
  });
  assert.deepEqual(await writePaidAssistDeliveryWithRetry(delivery, file, noWait), delivery);
  assert.equal(saves, 1);
});

test("assist cache recovers an ambiguous save followed by 412", async () => {
  let saves = 0;
  const file = fakeFile(async (_data: unknown, options: any) => {
    assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
    if (++saves === 1) throw new Error("connection reset after create");
    throw { code: 412 };
  });
  assert.deepEqual(await writePaidAssistDeliveryWithRetry(delivery, file, noWait), delivery);
  assert.equal(saves, 2);
});

test("assist cache returns the winning reservation and result on a same-request conflict", async () => {
  const stored = { ...delivery, reservationId: "first-reservation", result: "first result" };
  for (const error of [{ code: 412 }, { status: 409 }, new Error("object already exists")]) {
    assert.deepEqual(await writePaidAssistDeliveryWithRetry(delivery, fakeFile(async () => { throw error; }, stored), noWait), stored);
  }
});

test("assist cache fails closed for mismatched or invalid stored delivery", async () => {
  for (const stored of [null, { ...delivery, version: 2 }, { ...delivery, uid: "other" },
    { ...delivery, idempotencyKey: "other" }, { ...delivery, action: "other" }, { ...delivery, reservationId: 5 }]) {
    await assert.rejects(writePaidAssistDeliveryWithRetry(delivery, fakeFile(async () => { throw { code: 412 }; }, stored), noWait),
      (error: unknown) => error instanceof HttpsError && error.code === "failed-precondition");
  }
});

test("assist cache retries non-conflict errors three times and throws", async () => {
  let saves = 0;
  const failure = new Error("permission denied");
  await assert.rejects(writePaidAssistDeliveryWithRetry(delivery, fakeFile(async () => { saves++; throw failure; }), noWait), failure);
  assert.equal(saves, 3);
});

test("assist cache fails closed when a conflicting object cannot be read or parsed", async () => {
  for (const unreadable of [false, true]) {
    let saves = 0;
    const file = {
      save: async () => { saves++; throw { code: 412 }; },
      download: async () => {
        if (unreadable) throw new Error("private storage failure");
        return [Buffer.from("private malformed JSON")];
      },
    } as unknown as AssistFile;
    await assert.rejects(writePaidAssistDeliveryWithRetry(delivery, file, noWait),
      (error: unknown) => error instanceof HttpsError
        && error.code === "failed-precondition" && !error.message.includes("private"));
    assert.equal(saves, 1);
  }
});

const rateInput = { backend: "vertex" as const, location: "global", model: "gemini-3.8-flash", requestedAt: Date.parse("2026-12-31T23:59:59Z") };
for (const [date, factor] of [["2026-12-31T23:59:59Z", 1], ["2027-01-01T00:00:00Z", 2]] as const) {
  test(`assist rates at ${date} by backend and endpoint`, () => {
    for (const backend of ["vertex", "apikey"] as const) {
      for (const location of ["global", "us-central1"]) {
        const regional = backend === "vertex" && location !== "global";
        const cost = geminiAssistCost({ ...rateInput, backend, location, model: backend === "apikey" ? "gemini-flash-latest" : rateInput.model, requestedAt: Date.parse(date) });
        assert.equal(cost.inputRate, (regional ? 0.825 : 0.75) * factor);
        assert.equal(cost.outputRate, (regional ? 4.125 : 3.75) * factor);
        assert.equal(cost.unknownModel, false);
      }
    }
  });
}
test("assist cost includes thinking tokens and prefers known response model versions", () => {
  const cost = geminiAssistCost({ ...rateInput, model: "unknown", modelVersion: "gemini-3.8-flash-001", usage: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 200 } });
  assert.equal(cost.actualCostUsd, (1000 * 0.75 + 300 * 3.75) / 1_000_000);
  assert.equal(cost.unknownModel, false);
  assert.equal(geminiAssistCost({ ...rateInput, modelVersion: "unknown" }).unknownModel, false);
  for (const model of ["gemini-flash-latest", "gemini-3.5-flash", "gemini-3.6-flash"]) {
    assert.equal(geminiAssistCost({ ...rateInput, model }).inputRate, 0.75);
  }
});
test("unknown models use the highest table rates regardless of date", () => {
  const cost = geminiAssistCost({ ...rateInput, model: "unknown" });
  assert.equal(cost.unknownModel, true);
  assert.equal(cost.inputRate, 1.65);
  assert.equal(cost.outputRate, 8.25);
});

test("assist error mapper classifies provider errors without exposing internals", () => {
  const cases: Array<[unknown, string]> = [
    [{ status: 429, message: '{"error":{"status":"RESOURCE_EXHAUSTED","message":"private quota"}}' }, "resource-exhausted"],
    [Object.assign(new Error("private"), { code: "RESOURCE_EXHAUSTED" }), "resource-exhausted"],
    [new Error("quota exceeded private"), "resource-exhausted"],
    [{ status: 504 }, "deadline-exceeded"], [Object.assign(new Error("private"), { code: "DEADLINE_EXCEEDED" }), "deadline-exceeded"],
    [Object.assign(new Error("private"), { name: "AbortError" }), "deadline-exceeded"], [new Error("timeout private"), "deadline-exceeded"],
    [{ status: 500 }, "unavailable"], [{ status: 503 }, "unavailable"], [{ code: "UNAVAILABLE" }, "unavailable"], [{ code: "INTERNAL" }, "unavailable"],
    [new Error("fetch failed private"), "unavailable"], [Object.assign(new Error("private"), { code: "ECONNRESET" }), "unavailable"],
    [new SyntaxError("private JSON quota INTERNAL"), "internal"], [new Error("private"), "internal"], [null, "internal"],
  ];
  for (const [raw, code] of cases) {
    const mapped = mapAiAssistError(raw);
    assert.equal(mapped.code, code);
    assert.doesNotMatch(mapped.message, /private/);
  }
});
test("assist blocks map even without text, and own HttpsErrors pass through", () => {
  for (const reason of ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]) {
    for (const response of [{ promptFeedback: { blockReason: reason } }, { candidates: [{ finishReason: reason }] }]) {
      assert.equal(isAssistBlocked(response), true);
      assert.equal(mapAiAssistError(response).code, "failed-precondition");
    }
  }
  assert.equal(isAssistBlocked({ candidates: [{ finishReason: "STOP" }] }), false);
  for (const code of ["unauthenticated", "resource-exhausted", "invalid-argument", "failed-precondition"] as const) {
    const own = new HttpsError(code, "Own message");
    assert.equal(mapAiAssistError(own), own);
  }
});

// This test is executed by the existing CI test job. Never include values in failures.
const allowedEnvFiles = new Set([".env.example", "functions/.env.example", "functions/.env.pixtaffy-staging"]);
const allowedKeys = new Set(["AI_ASSIST_VERTEX_LOCATION", "AI_ASSIST_VERTEX_MODEL"]);
function validateStagingEnv(contents: string): void {
  const file = "functions/.env.pixtaffy-staging";
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) throw new Error(`${file}: invalid entry`);
    const [, key, value] = match;
    if (!allowedKeys.has(key) || /AIza[A-Za-z0-9_-]*|-----BEGIN.*PRIVATE KEY|\b(?:sk-|sk_live_|rk_|ghp_|github_pat_|xox)|[A-Za-z0-9+/=_-]{33,}|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/i.test(value)) {
      throw new Error(`${file}: ${key}`);
    }
  }
}
test("CI guards tracked env files and the staging key/value allowlist", () => {
  const root = resolve(__dirname, "../..");
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0");
  for (const file of tracked.filter((file) => basename(file).startsWith(".env"))) {
    if (!allowedEnvFiles.has(file)) throw new Error(`${file}: unexpected tracked env file`);
  }
  assert.ok(tracked.includes("functions/.env.pixtaffy-staging"));
  validateStagingEnv(readFileSync(resolve(root, "functions/.env.pixtaffy-staging"), "utf8"));
});
test("env guard rejects secret patterns and extra keys without disclosing values", () => {
  for (const value of ["AIza" + "x".repeat(12), "-----BEGIN PRIVATE KEY-----", "sk-example", "sk_live_example", "rk_example", "ghp_example", "github_pat_example", "xoxb-example", "a".repeat(40), "eyJabc.def.ghi"]) {
    assert.throws(() => validateStagingEnv(`AI_ASSIST_VERTEX_MODEL=${value}`), { message: "functions/.env.pixtaffy-staging: AI_ASSIST_VERTEX_MODEL" });
  }
  assert.throws(() => validateStagingEnv("OTHER=example"), { message: "functions/.env.pixtaffy-staging: OTHER" });
});

for (const differentReservation of [false, true]) {
test(`runAiAssist settles the stored delivery after an ambiguous write (${differentReservation ? "defensive different reservation" : "deterministic same reservation"})`, async (t) => {
  const billing = require("./billing");
  const deliveries = require("./paidDelivery");
  const firestore = require("firebase-admin/firestore");
  const genai = require("@google/genai");
  let spend: Record<string, unknown> = {};
  t.mock.method(firestore, "getFirestore", () => ({
    doc: () => ({}),
    runTransaction: async (callback: any) => callback({ get: async () => ({ data: () => spend }), set: (_ref: unknown, data: any) => { spend = { ...spend, ...data }; } }),
  }));
  t.mock.method(require("./rateLimit"), "enforceRateLimit", async () => {});
  t.mock.method(billing, "ensureStarterGrant", async () => {});
  t.mock.method(billing, "reserveCredits", async () => ({ reservationId: delivery.reservationId, balanceMilliCredits: 900 }));
  const release = t.mock.method(billing, "releaseReservation", async () => {});
  const commit = t.mock.method(billing, "commitReservation", async () => {});
  t.mock.method(deliveries, "readPaidAssistDelivery", async () => null);
  t.mock.method(genai, "GoogleGenAI", class {
    models = { generateContent: async () => ({ text: "provider result", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 100 } }) };
  });
  const writeDelivery = writePaidAssistDeliveryWithRetry;
  let saves = 0;
  let stored: unknown;
  t.mock.method(deliveries, "writePaidAssistDeliveryWithRetry", async (value: CachedPaidAssistDelivery) => writeDelivery(value, {
    save: async (data: unknown, options: any) => {
      assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
      if (++saves === 1) {
        stored = { ...JSON.parse(String(data)), ...(differentReservation ? { reservationId: "winner", result: "winning result" } : {}) };
        throw new Error("ambiguous write");
      }
      throw { code: 412 };
    },
    download: async () => [Buffer.from(JSON.stringify(stored))],
  } as unknown as AssistFile, noWait));
  const response = await runAiAssist.run({ auth: { uid: "user", token: {} }, data: { action: "expand_prompt", idempotencyKey: "request-123", payload: { prompt: "example" } } } as any);
  assert.equal(response.result, differentReservation ? "winning result" : "provider result");
  assert.equal(saves, 2);
  assert.equal(release.mock.callCount(), differentReservation ? 1 : 0);
  if (differentReservation) assert.equal(release.mock.calls[0].arguments[0].reservationId, delivery.reservationId);
  assert.equal(commit.mock.callCount(), 1);
  assert.equal(commit.mock.calls[0].arguments[0].reservationId, differentReservation ? "winner" : delivery.reservationId);
  assert.equal(spend.geminiReservedUsd, 0);
  assert.ok(Number(spend.geminiUsd) > 0);
});
}

function mockAssist(t: import("node:test").TestContext, response: Record<string, unknown>) {
  const billing = require("./billing");
  const deliveries = require("./paidDelivery");
  let spend: Record<string, any> = {};
  t.mock.method(require("firebase-admin/firestore"), "getFirestore", () => ({
    doc: () => ({}),
    runTransaction: async (callback: any) => callback({
      get: async () => ({ data: () => spend }),
      set: (_ref: unknown, data: any) => { spend = { ...spend, ...data }; },
    }),
  }));
  t.mock.method(require("./rateLimit"), "enforceRateLimit", async () => {});
  t.mock.method(billing, "ensureStarterGrant", async () => {});
  const reserve = t.mock.method(billing, "reserveCredits", async () => ({ reservationId: delivery.reservationId, balanceMilliCredits: 900 }));
  const release = t.mock.method(billing, "releaseReservation", async () => {});
  const commit = t.mock.method(billing, "commitReservation", async () => {});
  t.mock.method(deliveries, "readPaidAssistDelivery", async () => null);
  let providerCalls = 0;
  t.mock.method(require("@google/genai"), "GoogleGenAI", class {
    models = { generateContent: async () => { providerCalls++; return response; } };
  });
  return { billing, deliveries, reserve, release, commit, spend: () => spend, providerCalls: () => providerCalls };
}

const assistRequest = (action = "expand_prompt") => ({
  auth: { uid: "user", token: {} },
  data: { action, idempotencyKey: "request-123", payload: { prompt: "example" } },
} as any);
const providerResponse = {
  text: "provider result", modelVersion: "gemini-3.8-flash",
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 100 },
};
function assertSpend(spend: Record<string, any>) {
  const expected = geminiAssistCost({
    backend: "apikey", model: "gemini-flash-latest", modelVersion: providerResponse.modelVersion,
    requestedAt: Date.now(), usage: providerResponse.usageMetadata,
  }).actualCostUsd;
  assert.equal(spend.geminiUsd, expected);
  assert.equal(spend.geminiReservedUsd, 0);
}

for (const conflict of [false, true]) {
  test(`runAiAssist keeps ambiguous delivery reserved when ${conflict ? "conflict read-back fails" : "all save attempts fail with 503"}`, async (t) => {
    const mocks = mockAssist(t, providerResponse);
    const writeDelivery = writePaidAssistDeliveryWithRetry;
    let stored: CachedPaidAssistDelivery | null = null;
    let saves = 0;
    t.mock.method(mocks.deliveries, "readPaidAssistDelivery", async () => stored);
    t.mock.method(mocks.deliveries, "writePaidAssistDeliveryWithRetry", async (value: CachedPaidAssistDelivery) =>
      writeDelivery(value, {
        save: async (data: unknown) => {
          saves++;
          stored ??= JSON.parse(String(data));
          throw { code: conflict && saves > 1 ? 412 : 503, message: "private storage failure" };
        },
        download: async () => { throw new Error("private download failure"); },
      } as unknown as AssistFile, noWait));
    await assert.rejects(runAiAssist.run(assistRequest()), (error: unknown) =>
      error instanceof HttpsError && error.code === "unavailable"
      && error.message.includes("same request id") && !error.message.includes("private"));
    assert.equal(saves, conflict ? 2 : 3);
    assert.equal(mocks.release.mock.callCount(), 0);
    assert.equal(mocks.commit.mock.callCount(), 0);
    assertSpend(mocks.spend());
    const result = await runAiAssist.run(assistRequest());
    assert.equal(result.result, providerResponse.text);
    assert.equal(mocks.commit.mock.calls[0].arguments[0].reservationId, delivery.reservationId);
    assert.equal(mocks.reserve.mock.callCount(), 1);
    assert.equal(mocks.providerCalls(), 1);
    assertSpend(mocks.spend());
  });
}

for (const state of ["released", "reserved", "committed"]) {
  test(`cached assist replay with a ${state} reservation uses real idempotent settlement`, async (t) => {
    const realCommit = require("./billing").commitReservation;
    const mocks = mockAssist(t, providerResponse);
    mocks.commit.mock.mockImplementation(realCommit);
    t.mock.method(mocks.deliveries, "readPaidAssistDelivery", async () => delivery);
    let reservation = { uid: "user", state, milliCredits: 100, action: delivery.action };
    const debits: unknown[] = [];
    t.mock.method(require("firebase-admin/firestore"), "getFirestore", () => ({
      doc: (path: string) => path,
      runTransaction: async (callback: any) => callback({
        get: async () => ({ exists: true, data: () => reservation }),
        update: (_ref: unknown, data: any) => { reservation = { ...reservation, ...data }; },
        set: (_ref: unknown, data: any) => { debits.push(data); },
      }),
    }));
    for (let attempt = 0; attempt < 2; attempt++) {
      if (state === "released") {
        await assert.rejects(runAiAssist.run(assistRequest()), (error: unknown) =>
          error instanceof HttpsError && error.code === "unavailable"
          && !error.message.includes("Reservation is not active"));
      } else {
        assert.equal((await runAiAssist.run(assistRequest())).result, delivery.result);
      }
    }
    assert.equal(debits.length, state === "reserved" ? 1 : 0);
    assert.equal(mocks.providerCalls(), 0);
    assert.equal(mocks.reserve.mock.callCount(), 0);
  });
}

for (const scenario of ["safety", "invalid JSON", "empty"]) {
  test(`runAiAssist records spend and releases capacity for discarded ${scenario} response`, async (t) => {
    const mocks = mockAssist(t, {
      ...providerResponse,
      ...(scenario === "safety" ? { promptFeedback: { blockReason: "SAFETY" }, text: undefined }
        : { text: scenario === "empty" ? "" : "private invalid JSON" }),
    });
    await assert.rejects(runAiAssist.run(assistRequest(scenario === "invalid JSON" ? "correction_analysis" : "expand_prompt")));
    assertSpend(mocks.spend());
    assert.equal(mocks.release.mock.callCount(), 1);
    assert.equal(mocks.commit.mock.callCount(), 0);
  });
}
