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
  const genai = require("@google/genai");
  const store = fakeFirestore(t);
  t.mock.method(require("./rateLimit"), "enforceRateLimit", async () => {});
  t.mock.method(billing, "ensureStarterGrant", async () => {});
  t.mock.method(billing, "reserveAssistCredits", async () => ({ reservationId: delivery.reservationId, balanceMilliCredits: 900 }));
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
  assert.equal(store.spend().geminiReservedUsd, 0);
  assert.ok(Number(store.spend().geminiUsd) > 0);
});
}

function mockAssist(t: import("node:test").TestContext, response: Record<string, unknown>) {
  const billing = require("./billing");
  const deliveries = require("./paidDelivery");
  const store = fakeFirestore(t);
  t.mock.method(require("./rateLimit"), "enforceRateLimit", async () => {});
  t.mock.method(billing, "ensureStarterGrant", async () => {});
  const reserve = t.mock.method(billing, "reserveAssistCredits", async () => ({ reservationId: delivery.reservationId, balanceMilliCredits: 900 }));
  const release = t.mock.method(billing, "releaseReservation", async () => {});
  const commit = t.mock.method(billing, "commitReservation", async () => {});
  t.mock.method(deliveries, "readPaidAssistDelivery", async () => null);
  let providerCalls = 0;
  t.mock.method(require("@google/genai"), "GoogleGenAI", class {
    models = { generateContent: async () => { providerCalls++; return response; } };
  });
  return { billing, deliveries, reserve, release, commit, store, spend: store.spend, providerCalls: () => providerCalls };
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
      && error.message.includes("Try again in a moment.") && !error.message.includes("private"));
    assert.equal(saves, conflict ? 2 : 3);
    assert.equal(mocks.release.mock.callCount(), 0);
    assert.ok(mocks.store.docs.get(`billingReservations/${delivery.reservationId}`).deliveryFailedAt);
    assert.equal(mocks.commit.mock.callCount(), 0);
    assertSpend(mocks.spend());
    const result = await runAiAssist.run(assistRequest());
    assert.equal(result.result, providerResponse.text);
    assert.equal(mocks.commit.mock.calls[0].arguments[0].reservationId, delivery.reservationId);
    assert.equal(mocks.reserve.mock.callCount(), 2);
    assert.equal(mocks.providerCalls(), 1);
    assertSpend(mocks.spend());
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

// Serialize atomic transactions and discard failed writes, as Firestore does after conflicts.
function fakeFirestore(t: import("node:test").TestContext) {
  const docs = new Map<string, any>();
  const path = (ref: any) => typeof ref === "string" ? ref : ref.path;
  let queue = Promise.resolve();
  let failAfterCommit = false;
  const firestore = {
    doc: (name: string) => ({ path: name, update: async (data: any) => { docs.set(name, { ...docs.get(name), ...data }); } }),
    runTransaction: (callback: any) => {
      const pending = queue.then(async () => {
        const writes: Array<() => void> = [];
        const result = await callback({
          get: async (ref: any) => {
            assert.equal(writes.length, 0, "all reads precede writes");
            const data = structuredClone(docs.get(path(ref)));
            return { exists: data !== undefined, data: () => data };
          },
          set: (ref: any, data: any, options?: any) => writes.push(() => docs.set(path(ref), options?.merge ? { ...docs.get(path(ref)), ...data } : data)),
          update: (ref: any, data: any) => writes.push(() => docs.set(path(ref), { ...docs.get(path(ref)), ...data })),
          delete: (ref: any) => writes.push(() => docs.delete(path(ref))),
        });
        writes.forEach(write => write());
        if (failAfterCommit) { failAfterCommit = false; throw new Error("lost commit acknowledgement"); }
        return result;
      });
      queue = pending.then(() => {}, () => {});
      return pending;
    },
  };
  t.mock.method(require("firebase-admin/firestore"), "getFirestore", () => firestore);
  return {
    docs,
    spend: () => docs.get(`systemSpend/${new Date().toISOString().slice(0, 10)}`) ?? {},
    loseAcknowledgement: () => { failAfterCommit = true; },
  };
}

const reservationInput = { uid: "user", milliCredits: 100, idempotencyKey: "request-123", action: "expand_prompt" };
function fund(store: ReturnType<typeof fakeFirestore>, amount = 1000) {
  store.docs.set("users/user/private/billing", {
    balanceMilliCredits: amount,
    buckets: [{ id: "credits", source: "purchase", grantedMilliCredits: amount, remainingMilliCredits: amount, createdAt: 1, expiresAt: null }],
  });
}
function reservationDoc(store: ReturnType<typeof fakeFirestore>, id: string | null) {
  return store.docs.get(`billingReservations/${id}`);
}
const billingModule = () => require("./billing") as typeof import("./billing");

test("assist reserves once, rejects in-flight work, releases and re-reserves fresh allocations", async (t) => {
  const store = fakeFirestore(t); fund(store);
  const billing = billingModule();
  const first = await billing.reserveAssistCredits(reservationInput);
  assert.equal(first.balanceMilliCredits, 900);
  assert.equal(reservationDoc(store, first.reservationId).attempt, 1);
  await assert.rejects(billing.reserveAssistCredits(reservationInput), { code: "already-exists" });
  await billing.releaseReservation({ uid: "user", reservationId: first.reservationId, reason: "provider failure" });
  assert.equal(store.docs.get("users/user/private/billing").balanceMilliCredits, 1000);
  const next = await billing.reserveAssistCredits(reservationInput);
  assert.equal(next.reservationId, first.reservationId);
  assert.equal(next.balanceMilliCredits, 900);
  assert.equal(reservationDoc(store, next.reservationId).attempt, 2);
  await billing.commitReservation({ uid: "user", reservationId: next.reservationId });
  assert.equal((await billing.reserveAssistCredits(reservationInput)).alreadyCommitted, true);
  assert.equal(store.docs.get("users/user/private/billing").balanceMilliCredits, 900);
});

for (const marker of ["deliveryFailedAt", "expired", "legacyExpired"]) {
  test(`assist ${marker} reclaim has one concurrent winner without a second debit`, async (t) => {
    const store = fakeFirestore(t); fund(store);
    const billing = billingModule();
    const first = await billing.reserveAssistCredits(reservationInput);
    const doc = reservationDoc(store, first.reservationId);
    if (marker === "deliveryFailedAt") doc.deliveryFailedAt = Date.now();
    else {
      doc.reservedAt = Date.now() - 330_001;
      if (marker === "legacyExpired") delete doc.attemptAt;
      else doc.attemptAt = doc.reservedAt;
    }
    const results = await Promise.allSettled([billing.reserveAssistCredits(reservationInput), billing.reserveAssistCredits(reservationInput)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const loser = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    assert.equal(loser.reason.code, "already-exists");
    assert.equal(reservationDoc(store, first.reservationId).deliveryFailedAt, null);
    assert.equal(reservationDoc(store, first.reservationId).attempt, 2);
    assert.equal(store.docs.get("users/user/private/billing").balanceMilliCredits, 900);
  });
}

test("assist refuses mismatched owners and amounts and insufficient re-reservation", async (t) => {
  const store = fakeFirestore(t); fund(store);
  const billing = billingModule();
  const first = await billing.reserveAssistCredits(reservationInput);
  const doc = reservationDoc(store, first.reservationId);
  for (const state of ["reserved", "released", "committed"]) {
    doc.state = state; doc.uid = "other";
    await assert.rejects(billing.reserveAssistCredits(reservationInput), { code: "already-exists" });
    doc.uid = "user"; doc.milliCredits = 101;
    await assert.rejects(billing.reserveAssistCredits(reservationInput), { code: "already-exists" });
    doc.milliCredits = 100;
  }
  doc.state = "released"; fund(store, 50);
  await assert.rejects(billing.reserveAssistCredits(reservationInput), { code: "resource-exhausted" });
  assert.equal(doc.state, "released");
});

test("ordinary reserveCredits still rejects all existing reservation states", async (t) => {
  const store = fakeFirestore(t); fund(store);
  const billing = billingModule();
  const first = await billing.reserveCredits(reservationInput);
  const doc = reservationDoc(store, first.reservationId);
  assert.equal(doc.attemptAt, undefined);
  for (const state of ["released", "reserved", "committed"]) {
    doc.state = state; doc.deliveryFailedAt = 1; doc.reservedAt = 1;
    await assert.rejects(billing.reserveCredits(reservationInput), { code: "already-exists" });
  }
});

for (const state of ["released", "reserved", "committed"]) {
  test(`cached assist replay with ${state} reservation charges exactly once`, async (t) => {
    const mocks = mockAssist(t, providerResponse);
    mocks.reserve.mock.restore(); mocks.commit.mock.restore(); mocks.release.mock.restore();
    const billing = billingModule(); fund(mocks.store);
    const first = await billing.reserveAssistCredits(reservationInput);
    if (state === "released") await billing.releaseReservation({ uid: "user", reservationId: first.reservationId, reason: "stale" });
    if (state === "committed") await billing.commitReservation({ uid: "user", reservationId: first.reservationId });
    t.mock.method(mocks.deliveries, "readPaidAssistDelivery", async () => ({ ...delivery, reservationId: first.reservationId }));
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await runAiAssist.run(assistRequest())).result, delivery.result);
    assert.equal(mocks.store.docs.get("users/user/private/billing").balanceMilliCredits, 900);
    assert.equal(reservationDoc(mocks.store, first.reservationId).state, "committed");
    assert.equal([...mocks.store.docs.keys()].filter(key => key.includes("/billingLedger/debit-")).length, 1);
    assert.equal(mocks.providerCalls(), 0);
  });
}

test("cached replay settles the newly acquired reservation when the cache has no reservation", async (t) => {
  const mocks = mockAssist(t, providerResponse);
  mocks.reserve.mock.restore(); mocks.commit.mock.restore(); fund(mocks.store);
  t.mock.method(mocks.deliveries, "readPaidAssistDelivery", async () => ({ ...delivery, reservationId: null }));
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await runAiAssist.run(assistRequest())).result, delivery.result);
  }
  const reservations = [...mocks.store.docs.entries()].filter(([key]) => key.startsWith("billingReservations/"));
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0][1].state, "committed");
  assert.equal(mocks.store.docs.get("users/user/private/billing").balanceMilliCredits, 900);
  assert.equal([...mocks.store.docs.keys()].filter(key => key.includes("/billingLedger/debit-")).length, 1);
  assert.equal(mocks.providerCalls(), 0);
});

test("released replay without enough balance returns a clean retryable error", async (t) => {
  const mocks = mockAssist(t, providerResponse);
  mocks.reserve.mock.restore(); mocks.release.mock.restore(); fund(mocks.store);
  const first = await billingModule().reserveAssistCredits(reservationInput);
  await billingModule().releaseReservation({ uid: "user", reservationId: first.reservationId, reason: "stale" });
  fund(mocks.store, 0);
  t.mock.method(mocks.deliveries, "readPaidAssistDelivery", async () => ({ ...delivery, reservationId: first.reservationId }));
  await assert.rejects(runAiAssist.run(assistRequest()), (error: any) => error.code === "unavailable" && error.message.includes("Try again in a moment."));
  assert.equal(mocks.providerCalls(), 0);
});

for (const failure of ["provider", "cache"]) {
  test(`${failure} failure permits a same-key retry with one debit`, async (t) => {
    const mocks = mockAssist(t, providerResponse);
    mocks.reserve.mock.restore(); mocks.commit.mock.restore(); mocks.release.mock.restore();
    fund(mocks.store);
    let calls = 0, writes = 0;
    t.mock.method(require("@google/genai"), "GoogleGenAI", class {
      models = { generateContent: async () => { if (++calls === 1 && failure === "provider") throw { status: 503 }; return providerResponse; } };
    });
    t.mock.method(mocks.deliveries, "writePaidAssistDeliveryWithRetry", async (value: CachedPaidAssistDelivery) => {
      if (++writes === 1 && failure === "cache") throw new Error("storage failure");
      return value;
    });
    await assert.rejects(runAiAssist.run(assistRequest()), { code: "unavailable" });
    const res = [...mocks.store.docs.entries()].find(([key]) => key.startsWith("billingReservations/"))![1];
    assert.equal(res.state, failure === "provider" ? "released" : "reserved");
    if (failure === "cache") assert.ok(res.deliveryFailedAt);
    assert.equal((await runAiAssist.run(assistRequest())).result, providerResponse.text);
    assert.equal(calls, 2);
    assert.equal(mocks.store.docs.get("users/user/private/billing").balanceMilliCredits, 900);
  });
}

test("committed reservation without cache never calls the provider again", async (t) => {
  const mocks = mockAssist(t, providerResponse);
  mocks.reserve.mock.restore(); mocks.commit.mock.restore(); fund(mocks.store);
  const first = await billingModule().reserveAssistCredits(reservationInput);
  await billingModule().commitReservation({ uid: "user", reservationId: first.reservationId });
  await assert.rejects(runAiAssist.run(assistRequest()), { code: "unavailable" });
  assert.equal(mocks.providerCalls(), 0);
});

test("spend holds settle once even after lost acknowledgements and across midnight", async (t) => {
  const store = fakeFirestore(t);
  const { reserveSpendCapacity, recordSpend, releaseSpendCapacity } = require("./paidAi") as typeof import("./paidAi");
  const day = "2020-01-01", first = `${day}-first`, second = `${day}-second`;
  await reserveSpendCapacity("gemini", 0.05, first);
  await reserveSpendCapacity("gemini", 0.05, first);
  await reserveSpendCapacity("gemini", 0.05, second);
  assert.equal(store.docs.get(`systemSpend/${day}`).geminiReservedUsd, 0.1);
  assert.equal(store.docs.get(`systemSpend/${day}/holds/${first}`).day, day);
  store.loseAcknowledgement();
  await assert.rejects(recordSpend("gemini", 0.01, "expand_prompt", 0.05, first));
  await releaseSpendCapacity("gemini", 0.05, first);
  assert.equal(store.docs.get(`systemSpend/${day}`).geminiReservedUsd, 0.05);
  assert.equal(store.docs.get(`systemSpend/${day}`).geminiUsd, 0.01);
  // A settled hold makes a transaction retry a no-op.
  await recordSpend("gemini", 0.01, "expand_prompt", 0.05, first);
  assert.equal(store.docs.get(`systemSpend/${day}`).geminiReservedUsd, 0.05);
  assert.equal(store.docs.get(`systemSpend/${day}`).geminiUsd, 0.01);
  const third = `${day}-third`;
  await reserveSpendCapacity("gemini", 0.05, third);
  await releaseSpendCapacity("gemini", 0.05, second);
  await releaseSpendCapacity("gemini", 0.05, second);
  assert.equal(store.docs.get(`systemSpend/${day}`).geminiReservedUsd, 0.05);
  await releaseSpendCapacity("gemini", 0.05, third);
  assert.equal(store.docs.get(`systemSpend/${day}`).geminiReservedUsd, 0);
  assert.equal([...store.docs.keys()].filter(key => key.includes("/holds/")).length, 3);
  assert.equal(store.docs.get(`systemSpend/${day}/holds/${first}`).state, "settled");
  assert.equal(store.docs.get(`systemSpend/${day}/holds/${second}`).state, "released");
  assert.equal(store.docs.get(`systemSpend/${day}/holds/${third}`).expireAt.toMillis(), Date.parse("2020-01-04T00:00:00Z"));
});

test("no-holdId spend path preserves counter behavior and makes no hold docs", async (t) => {
  const store = fakeFirestore(t);
  const { reserveSpendCapacity, recordSpend, releaseSpendCapacity } = require("./paidAi") as typeof import("./paidAi");
  await reserveSpendCapacity("openrouter", 1);
  await reserveSpendCapacity("openrouter", 1);
  await recordSpend("openrouter", 0.25, "image", 1);
  assert.equal(store.spend().openrouterReservedUsd, 1);
  assert.equal(store.spend().openrouterUsd, 0.25);
  await releaseSpendCapacity("openrouter", 1);
  assert.equal(store.spend().openrouterReservedUsd, 0);
  assert.equal(store.docs.size, 1);
});

for (const state of ["reserved", "released"]) {
  test(`assist ${state} reclaim refreshes stale sweep timestamp`, async (t) => {
    const store = fakeFirestore(t); fund(store);
    const billing = billingModule();
    const first = await billing.reserveAssistCredits(reservationInput);
    if (state === "released") await billing.releaseReservation({ uid: "user", reservationId: first.reservationId, reason: "retry" });
    const old = reservationDoc(store, first.reservationId);
    old.reservedAt = Date.now() - 31 * 60_000;
    old.deliveryFailedAt = 1;
    const now = Date.now();
    t.mock.method(Date, "now", () => now);
    await billing.reserveAssistCredits(reservationInput);
    const reclaimed = reservationDoc(store, first.reservationId);
    assert.equal(reclaimed.reservedAt, now);
    assert.equal(reclaimed.reservedAt <= now - 30 * 60_000, false);
  });
}

for (const failures of [0, 2, 3]) {
  test(`delivery failure marker retries with ${failures} failed writes`, async (t) => {
    const store = fakeFirestore(t);
    const admin = require("firebase-admin/firestore");
    const firestore = admin.getFirestore();
    let calls = 0;
    t.mock.method(firestore, "doc", (path: string) => ({ update: async (data: any) => {
      if (++calls <= failures) throw new Error("marker unavailable");
      store.docs.set(path, data);
    } }));
    const log = t.mock.method(require("firebase-functions/logger"), "error", () => {});
    const delays: number[] = [];
    await require("./paidAi").markAssistDeliveryFailed("reservation", { sleep: async (ms: number) => { delays.push(ms); } });
    assert.equal(calls, failures === 0 ? 1 : 3);
    assert.deepEqual(delays, failures === 0 ? [] : [200, 600]);
    assert.equal(log.mock.callCount(), failures === 3 ? 1 : 0);
    if (failures < 3) assert.ok(store.docs.get("billingReservations/reservation").deliveryFailedAt);
    else assert.deepEqual(log.mock.calls[0].arguments, ["Unable to mark AI assist delivery failed", { reservationId: "reservation", message: "marker unavailable" }]);
  });
}

test("released and missing holds bill once and cannot reserve again after settlement", async (t) => {
  const store = fakeFirestore(t);
  const { reserveSpendCapacity, recordSpend, releaseSpendCapacity } = require("./paidAi");
  const day = "2020-01-01";
  for (const suffix of ["released", "missing"]) {
    const id = `${day}-${suffix}`;
    if (suffix === "released") {
      await reserveSpendCapacity("gemini", 0.05, id);
      await releaseSpendCapacity("gemini", 0.05, id);
      await reserveSpendCapacity("gemini", 0.05, id);
      assert.equal(store.docs.get(`systemSpend/${day}`).geminiReservedUsd, 0);
    }
    await recordSpend("gemini", 0.01, "expand_prompt", 0.05, id);
    await recordSpend("gemini", 0.01, "expand_prompt", 0.05, id);
    await reserveSpendCapacity("gemini", 0.05, id);
    await releaseSpendCapacity("gemini", 0.05, id);
  }
  assert.equal(store.docs.get(`systemSpend/${day}`).geminiUsd, 0.02);
  assert.equal(store.docs.get(`systemSpend/${day}`).geminiReservedUsd, 0);
});

for (const lostAt of ["reserve", "settle"]) {
  test(`runAiAssist releases safely after lost ${lostAt} acknowledgement`, async (t) => {
    const mocks = mockAssist(t, lostAt === "settle" ? { ...providerResponse, text: "" } : providerResponse);
    mocks.store.docs.set(`systemSpend/${new Date().toISOString().slice(0, 10)}`, { geminiReservedUsd: 0.1 });
    if (lostAt === "reserve") mocks.store.loseAcknowledgement();
    else t.mock.method(require("@google/genai"), "GoogleGenAI", class {
      models = { generateContent: async () => { mocks.store.loseAcknowledgement(); return { ...providerResponse, text: "" }; } };
    });
    await assert.rejects(runAiAssist.run(assistRequest()));
    const [path, hold] = [...mocks.store.docs.entries()].find(([key]) => key.includes("/holds/"))!;
    assert.equal(hold.state, lostAt === "reserve" ? "released" : "settled");
    assert.ok(Math.abs(mocks.spend().geminiReservedUsd - 0.1) < 1e-10);
    if (lostAt === "reserve") assert.equal(mocks.providerCalls(), 0);
    else {
      const cost = mocks.spend().geminiUsd;
      await require("./paidAi").recordSpend("gemini", cost, "expand_prompt", 0.05, path.split("/").pop());
      assert.equal(mocks.spend().geminiUsd, cost);
      assert.ok(Math.abs(mocks.spend().geminiReservedUsd - 0.1) < 1e-10);
    }
  });
}
