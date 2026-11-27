import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_VAULT_REPLICA_CURRENT_GENERATION } from "@murphai/contracts/browser-vault";
import type { HostedNativeMemberAuth } from "../src/lib/better-auth/native-auth";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import { dependencyKey, readPrivateYou } from "../src/lib/health-you/read";
import { buildViews } from "../src/lib/health-you/views";
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  vault: vi.fn(),
  session: vi.fn(),
  workspace: vi.fn(),
  cache: vi.fn(),
  inputs: vi.fn(),
  publish: vi.fn(),
  decrypt: vi.fn(),
  extras: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: (fn: (tx: object) => unknown) => fn({ healthYouCache: { updateMany: async () => ({ count: 1 }) } }),
    healthYouCache: { findUnique: mocks.cache },
    gameProfile: { findUnique: async () => ({ timeZone: "UTC", firstNameEncrypted: "fixture" }) },
  }),
}));
vi.mock("../src/lib/game/http/auth", () => ({ assertGameMemberAuthCurrentForRead: mocks.session }));
vi.mock("../src/lib/browser-vault/session-handler", () => ({ scheduleBrowserVaultRefresh: mocks.refresh }));
vi.mock("../src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.vault }));
vi.mock("../src/lib/hosted-workspace/store", () => ({ readHostedBrowserVaultReplicaState: mocks.workspace }));
vi.mock("../src/lib/game/crypto", () => ({ openGameTexts: async () => ["Example"] }));
vi.mock("../src/lib/health-wins/crypto", () => ({
  openHealthTexts: mocks.decrypt,
  sealHealthTexts: mocks.publish,
}));
vi.mock("../src/lib/health-you/inputs", () => ({ readYouInputs: mocks.inputs }));
vi.mock("../src/lib/health-you/this-week", () => ({ readThisWeek: mocks.extras }));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedOpaqueIdentifier: (_key: string, v: string) => v,
}));
vi.mock("../src/lib/better-auth/rate-limit", () => ({
  hostedAuthRateLimitStorage: () => ({ consume: async () => ({ allowed: true }) }),
}));
const now = new Date("2031-04-12T15:00:00Z"),
  asOf = "2031-04-12",
  memberId = "synthetic-owner";
const ref = {
  byteLength: 120,
  dataVersion: "d".repeat(64),
  generatedAt: now.toISOString(),
  generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  keyId: "fixture-key",
  objectKey: "users/browser-vault-replicas/opaque/replica.json",
  replicaSchema: "murph.browser-vault-replica" as const,
  runtimeRootKeyId: "fixture-root",
  schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
  sourceBundleHash: "a".repeat(64),
};
const profile = { age: 46, age_as_of: asOf, sex: "male" },
  snapshot = {
    asOf,
    evidence: { profile, labs: [{ marker: "rdw", date: asOf, value: 14, unit: "%" }] },
    timeZone: "UTC",
    historyFrom: asOf,
    sourceRevision: ref.dataVersion,
    availability: {},
    markers: [],
  };
const signal = new AbortController().signal;
const auth: HostedNativeMemberAuth = {
  kind: "better-auth",
  credential: "fixture-token",
  sessionId: "fixture-session",
  member: { id: memberId, billingStatus: "active", createdAt: now, updatedAt: now, suspendedAt: null },
  proof: {
    expiresAt: now,
    credentialDigest: Buffer.alloc(32),
    row: {
      id: "fixture-session",
      memberId,
      model: "session",
      lookupKey: null,
      secondaryLookupKey: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now,
      payloadEncrypted: "fixture",
    },
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: ref, version: "1" });
  mocks.cache.mockResolvedValue(null);
  mocks.extras.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
describe("private view authority and dependency lifecycle", () => {
  function warm() {
    mocks.cache.mockResolvedValue({
      memberId,
      revision: "fixture",
      dependency: dependencyKey(memberId, ref, "UTC", asOf),
      viewsEncrypted: "sealed",
    });
    mocks.decrypt.mockResolvedValue([JSON.stringify({ timeZone: "UTC", views: buildViews(snapshot) })]);
  }
  it("rechecks both authorities after returning cached detail and reads live rows only on the main view", async () => {
    warm();
    await expect(readPrivateYou(auth, "age", signal)).resolves.toMatchObject({ real: 46 });
    expect(mocks.inputs).not.toHaveBeenCalled();
    expect(mocks.extras).not.toHaveBeenCalled();
    await readPrivateYou(auth, "you", signal);
    expect(mocks.vault).toHaveBeenCalledTimes(4);
    expect(mocks.session).toHaveBeenCalledTimes(4);
    expect(mocks.extras).toHaveBeenCalledOnce();
  });
  it("recovers on retry after an owner read requests a missing, expired or older publication", async () => {
    warm();
    for (const pointer of [null, { ...ref, generatedAt: "2031-04-10T07:00:00.000Z" }, { ...ref, generation: ref.generation - 1 }]) {
      mocks.workspace.mockResolvedValueOnce({ browserVaultReplicaRef: pointer });
      expect(await readPrivateYou(auth, "you", signal)).toMatchObject({ state: "unavailable" });
      expect(await readPrivateYou(auth, "you", signal)).toMatchObject({ state: "ready" });
    }
    expect(mocks.refresh.mock.calls).toEqual(Array(3).fill([memberId]));
    mocks.vault.mockRejectedValueOnce(hostedOnboardingError({ httpStatus: 403, code: "CONSENT_REQUIRED", message: "Consent required." }));
    await expect(readPrivateYou(auth, "you", signal)).rejects.toMatchObject({ httpStatus: 403 });
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
  });
  it("offers an answerable question from the same cache to each supported client", async () => {
    warm();
    const bundle = buildViews({ ...snapshot, hasAnswerProjection: true, evidence: { ...snapshot.evidence,
      checkins: [{ date: "2031-04-10", answerKey: "smoking", smoking: "former" }] } });
    mocks.decrypt.mockResolvedValue([JSON.stringify({ timeZone: "UTC", views: bundle })]);
    for (const [platform, build, typed] of [["ios", "127", false], ["ios", "128", true], ["android", "128", false]] as const) {
      const headers = new Headers({ "X-Murph-Client-Platform": platform, "X-Murph-Client-Version": "1.0", "X-Murph-Client-Build": build });
      const view = await readPrivateYou(auth, "you", signal, undefined, headers);
      expect(view).toMatchObject({ questions: [typed ? { key: "quitDate", inputKind: "date" } : { options: expect.arrayContaining([expect.objectContaining({ value: expect.any(String) })]) }] });
    }
    expect(await readPrivateYou(auth, "you", signal)).toMatchObject({ questions: bundle.optionQuestions });
  });
  it("lets consent withdrawal win even on a warm read", async () => {
    warm();
    mocks.vault
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        hostedOnboardingError({ httpStatus: 403, code: "CONSENT_REQUIRED", message: "Consent required." }),
      );
    await expect(readPrivateYou(auth, "you", signal)).rejects.toMatchObject({ httpStatus: 403 });
  });
  it("never turns a failed new publication read into an imputed age", async () => {
    warm();
    mocks.workspace.mockResolvedValue({
      browserVaultReplicaRef: { ...ref, dataVersion: "e".repeat(64) },
      version: "2",
    });
    mocks.inputs.mockRejectedValue(new Error("Source unavailable"));
    const view = await readPrivateYou(auth, "you", signal);
    expect(view).toMatchObject({ state: "unavailable", factors: [] });
    expect(view).not.toHaveProperty("age");
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("replaces a readable old cache format with the current publication", async () => {
    warm();
    mocks.decrypt.mockResolvedValue([JSON.stringify({ timeZone: "UTC", retired: true })]);
    mocks.inputs.mockResolvedValue(snapshot);
    mocks.publish.mockResolvedValue(["replacement"]);
    await expect(readPrivateYou(auth, "age", signal)).resolves.toMatchObject({ real: 46 });
    expect(mocks.publish).toHaveBeenCalledOnce();
  });
  it("recomputes after publication and suppresses a second new question on the same local day", async () => {
    warm();
    const old = buildViews({ ...snapshot, hasAnswerProjection: true });
    expect(old.you.questions[0].key).toBe("smoking");
    mocks.decrypt.mockResolvedValue([JSON.stringify({ timeZone: "UTC", views: old })]);
    const next = { ...ref, dataVersion: "f".repeat(64) };
    mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: next });
    mocks.inputs.mockResolvedValue({ ...snapshot, sourceRevision: next.dataVersion, hasAnswerProjection: true,
      evidence: { ...snapshot.evidence, checkins: [{ date: "2031-04-11", reported_at: "2031-04-11",
        answerKey: "smoking", smoking: "former" }] } });
    mocks.publish.mockResolvedValue(["replacement"]);
    await expect(readPrivateYou(auth, "you", signal)).resolves.toMatchObject({ questions: [] });
    expect(mocks.publish).toHaveBeenCalledOnce();
  });
  it("rejects a cached view from another model or schema revision", async () => {
    warm();
    mocks.cache.mockResolvedValue({
      memberId,
      revision: "old",
      dependency: "retired-model",
      viewsEncrypted: "sealed",
    });
    mocks.inputs.mockRejectedValue(new Error("Source unavailable"));
    await expect(readPrivateYou(auth, "you", signal)).resolves.toMatchObject({ state: "unavailable" });
    expect(mocks.inputs).toHaveBeenCalledOnce();
  });
});
