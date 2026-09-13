import { BROWSER_VAULT_REPLICA_CURRENT_GENERATION } from "@murphai/contracts/browser-vault";
import { BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS } from "@murphai/hosted-execution/browser-vault";
import type { BrowserVaultEntity } from "@murphai/query/browser-replica-client";
import * as runtimeState from "@murphai/runtime-state";
import {
  buildHostedStorageAad,
  encryptHostedStoragePayload,
  wrapHostedBrowserSessionKey,
  type HostedUserRecipientPublicKeyJwk,
} from "@murphai/runtime-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authority: vi.fn(), control: vi.fn(), memberId: vi.fn(), pending: vi.fn(), session: vi.fn(), workspace: vi.fn(),
}));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: mocks.control }));
vi.mock("@/src/lib/hosted-onboarding/linq-production-canary", () => ({ readHostedLinqProductionCanaryMemberId: mocks.memberId }));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({ readHostedMailboxLatestPendingConversationItem: mocks.pending }));
vi.mock("@/src/lib/hosted-workspace/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-workspace/store")>(),
  readHostedWorkspace: mocks.workspace,
}));

import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonError } from "@/src/lib/hosted-onboarding/http";
import { LINQ_PRODUCTION_CANARY_GOAL_TITLE } from "@/src/lib/hosted-onboarding/linq-production-canary-contract";
import { readHostedLinqProductionCanaryOutcome } from "@/src/lib/hosted-onboarding/linq-production-canary-outcome";
import type { HostedWorkspaceRecord } from "@/src/lib/hosted-workspace/store";

const prisma = {} as Parameters<typeof readHostedLinqProductionCanaryOutcome>[0]["prisma"];
const memberId = "member_synthetic_canary";
const goalId = "goal_01K4A000000000000000000001";
const otherGoalId = "goal_01K4A000000000000000000002";
const generatedAt = "2026-09-10T12:00:00.000Z";
const notReady = { ready: false, totalGoalCount: 0, matchingGoalCount: 0, matchingGoalIdCount: 0 };
const diagnosticMessage = "Hosted Linq production canary outcome read failed.";
const readOrder = ["memberId", "authority", "pending", "workspace", "control", "keys", "session",
  "pending", "workspace", "memberId", "authority"];

describe("production canary canonical outcome observer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(runtimeState, "generateHostedUserRecipientKeyPair");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(generatedAt) + 60_000);
    mocks.memberId.mockResolvedValue(memberId);
    mocks.authority.mockResolvedValue(undefined);
    mocks.pending.mockResolvedValue(null);
    mocks.control.mockReturnValue({ createBrowserVaultSession: mocks.session });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    { entities: [], total: 0, count: 0, ids: 0 },
    { entities: [goal()], total: 1, count: 1, ids: 1 },
    { entities: [goal(), goal({ id: otherGoalId })], total: 2, count: 2, ids: 2 },
    { entities: [goal(), goal()], total: 2, count: 2, ids: 1 },
    { entities: [goal({ recordClass: "ledger" })], total: 1, count: 1, ids: 0 },
    { entities: [goal({ id: "invented-goal-id" })], total: 1, count: 1, ids: 0 },
    { entities: [goal({ title: "Unrelated synthetic goal" }), goal({ family: "event" })], total: 1, count: 0, ids: 0 },
  ])("decrypts the actual replica protocol and reports canonical cardinality ($count/$ids)", async ({ entities, total, count, ids }) => {
    await installEncryptedReplica(entities);
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual({
      ready: true, totalGoalCount: total, matchingGoalCount: count, matchingGoalIdCount: ids,
    });
    expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ userId: memberId, requestedShards: ["core"] }));
    expect(mocks.authority).toHaveBeenCalledTimes(2);
    expect(mocks.memberId).toHaveBeenCalledWith({ prisma });
    expectReadOrder(readOrder);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not read any other identity when the fixed canary is absent", async () => {
    mocks.memberId.mockResolvedValue(null);
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expectReadOrder(readOrder.slice(0, 1));
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("refuses a stale replica even when it already contains the expected goal", async () => {
    const workspace = await installEncryptedReplica([goal()]);
    mocks.workspace.mockResolvedValue({ ...workspace, snapshotRef: snapshotRef("b".repeat(64)) });
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expectReadOrder(readOrder.slice(0, 4));
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("refuses a replica after the freshness window even with the matching source", async () => {
    await installEncryptedReplica([goal()]);
    vi.mocked(Date.now).mockReturnValue(Date.parse(generatedAt) + BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS + 1);
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expectReadOrder(readOrder.slice(0, 4));
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("waits when a reply has been delivered but its conversation turn is not checkpointed", async () => {
    await installEncryptedReplica([goal()]);
    mocks.pending.mockResolvedValue({ id: "synthetic-pending-conversation" });
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expectReadOrder(readOrder.slice(0, 3));
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("rejects a newly pending conversation that races replica decryption", async () => {
    await installEncryptedReplica([goal()]);
    mocks.pending.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "synthetic-pending-conversation" });
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expectReadOrder(readOrder.slice(0, 8));
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("rejects a checkpoint or replica publication that races decryption", async () => {
    const workspace = await installEncryptedReplica([goal()]);
    mocks.workspace.mockResolvedValueOnce(workspace).mockResolvedValueOnce({ ...workspace, version: "2" });
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expectReadOrder(readOrder.slice(0, 9));
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("rejects a reset that replaces the canary identity during the read", async () => {
    await installEncryptedReplica([goal()]);
    mocks.memberId.mockResolvedValueOnce(memberId).mockResolvedValueOnce("member_synthetic_replacement");
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expectReadOrder(readOrder.slice(0, 10));
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("rejects encrypted data bound to another member", async () => {
    await installEncryptedReplica([goal()], { sessionMemberId: "member_synthetic_unrelated" });
    await expect(readHostedLinqProductionCanaryOutcome({ prisma })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PRODUCTION_CANARY_OUTCOME_UNAVAILABLE",
    });
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(diagnosticMessage, { stage: "decryption" });
    expectReadOrder(readOrder.slice(0, 7));
  });

  it.each([
    { stage: "member_lookup", reads: 1, fail: (error: Error) => mocks.memberId.mockRejectedValueOnce(error) },
    { stage: "initial_authority", reads: 2, fail: (error: Error) => mocks.authority.mockRejectedValueOnce(error) },
    { stage: "initial_readiness", reads: 3, fail: (error: Error) => mocks.pending.mockRejectedValueOnce(error) },
    { stage: "initial_readiness", reads: 4, fail: (error: Error) => mocks.workspace.mockRejectedValueOnce(error) },
    { stage: "control_configuration", reads: 5, fail: () => mocks.control.mockReturnValueOnce(null) },
    { stage: "control_configuration", reads: 5, fail: (error: Error) => mocks.control.mockImplementationOnce(() => { throw error; }) },
    { stage: "key_generation", reads: 6, fail: (error: Error) => vi.mocked(runtimeState.generateHostedUserRecipientKeyPair).mockRejectedValueOnce(error) },
    { stage: "session_request", reads: 7, fail: (error: Error) => mocks.session.mockRejectedValueOnce(error) },
    { stage: "session_parsing", reads: 7, fail: () => mocks.session.mockResolvedValueOnce(null) },
    { stage: "session_parsing", reads: 7, fail: () => mocks.session.mockResolvedValueOnce({ state: "ready", privatePayload: "synthetic-private-response" }) },
    { stage: "decryption", reads: 7, fail: () => installEncryptedReplica([goal()], { corruptCiphertext: true }) },
    { stage: "final_readiness", reads: 8, fail: (error: Error) => mocks.pending.mockResolvedValueOnce(null).mockRejectedValueOnce(error) },
    { stage: "final_readiness", reads: 9, fail: (error: Error, workspace: HostedWorkspaceRecord) =>
      mocks.workspace.mockResolvedValueOnce(workspace).mockRejectedValueOnce(error) },
    { stage: "final_readiness", reads: 10, fail: (error: Error) => mocks.memberId.mockResolvedValueOnce(memberId).mockRejectedValueOnce(error) },
    { stage: "final_authority", reads: 11, fail: (error: Error) => mocks.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error) },
  ])("logs only $stage on failure after $reads operations, without retrying", async ({ stage, reads, fail }) => {
    const workspace = await installEncryptedReplica([goal()]);
    const privateError = new Error("synthetic-private-message", { cause: new Error("synthetic-private-cause") });
    privateError.stack = "synthetic-private-stack";
    await fail(privateError, workspace);
    const error: unknown = await readHostedLinqProductionCanaryOutcome({ prisma }).catch((caught: unknown) => caught);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(diagnosticMessage, { stage });
    expect(console.error).not.toHaveBeenCalled();
    expectReadOrder(readOrder.slice(0, reads));
    await expectUnavailable(error);
    expect(JSON.stringify([vi.mocked(console.warn).mock.calls, vi.mocked(console.error).mock.calls]))
      .not.toContain("synthetic-private");
  });

  it.each([
    { gate: "missing workspace", reads: 4, arrange: () => mocks.workspace.mockResolvedValueOnce(null) },
    { gate: "missing replica ref", reads: 4, arrange: (workspace: HostedWorkspaceRecord) =>
      mocks.workspace.mockResolvedValueOnce({ ...workspace, browserVaultReplicaRef: null }) },
    { gate: "missing source hash", reads: 4, arrange: (workspace: HostedWorkspaceRecord) =>
      mocks.workspace.mockResolvedValueOnce({ ...workspace, snapshotRef: null }) },
    { gate: "empty session", reads: 7, arrange: () => mocks.session.mockResolvedValueOnce({
      state: "empty", memberId, encryptedReplica: null, replicaAad: null, replicaKeyEnvelope: null, replicaRef: null,
    }) },
  ])("keeps the ordinary $gate gate silent", async ({ arrange, reads }) => {
    const workspace = await installEncryptedReplica([goal()]);
    arrange(workspace);
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expectReadOrder(readOrder.slice(0, reads));
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("never reads or enumerates the caught exception", async () => {
    await installEncryptedReplica([goal()]);
    const inspect = vi.fn(() => { throw new Error("synthetic-private-inspection"); });
    mocks.session.mockRejectedValueOnce(new Proxy(new Error("synthetic-private-message"), {
      get: inspect, ownKeys: inspect, getOwnPropertyDescriptor: inspect,
    }));
    const error: unknown = await readHostedLinqProductionCanaryOutcome({ prisma }).catch((caught: unknown) => caught);
    expect(inspect).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(diagnosticMessage, { stage: "session_request" });
    expectReadOrder(readOrder.slice(0, 7));
    await expectUnavailable(error);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("preserves the generic error and HTTP 503 when the diagnostic itself throws", async () => {
    await installEncryptedReplica([goal()]);
    mocks.session.mockRejectedValueOnce(new Error("synthetic-private-transport"));
    vi.mocked(console.warn).mockImplementation(() => { throw new Error("synthetic-private-logger"); });
    const error: unknown = await readHostedLinqProductionCanaryOutcome({ prisma }).catch((caught: unknown) => caught);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(diagnosticMessage, { stage: "session_request" });
    expectReadOrder(readOrder.slice(0, 7));
    await expectUnavailable(error);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("synthetic-private");
  });

  it("keeps stages local when an earlier authority check fails after another read reaches control", async () => {
    await installEncryptedReplica([goal()]);
    let rejectAuthority!: (reason: Error) => void;
    mocks.authority.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectAuthority = reject; }));
    mocks.session.mockRejectedValueOnce(new Error("synthetic-private-transport"));
    const first = readHostedLinqProductionCanaryOutcome({ prisma }).catch((caught: unknown) => caught);
    const second = readHostedLinqProductionCanaryOutcome({ prisma }).catch((caught: unknown) => caught);
    const secondError = await second;
    rejectAuthority(new Error("synthetic-private-authority"));
    const firstError = await first;
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      [diagnosticMessage, { stage: "session_request" }],
      [diagnosticMessage, { stage: "initial_authority" }],
    ]);
    expectReadOrder(["memberId", "memberId", "authority", "authority", "pending", "workspace", "control", "keys", "session"]);
    await expectUnavailable(firstError);
    await expectUnavailable(secondError);
  });
});

function expectReadOrder(expected: readonly string[]): void {
  const operations = { ...mocks, keys: vi.mocked(runtimeState.generateHostedUserRecipientKeyPair) };
  const actual = Object.entries(operations).flatMap(([operation, mock]) =>
    mock.mock.invocationCallOrder.map((order) => ({ operation, order })));
  expect(actual.sort((a, b) => a.order - b.order).map(({ operation }) => operation)).toEqual(expected);
  if (expected.includes("control")) expect(mocks.control).toHaveBeenCalledWith(10_000);
}

async function expectUnavailable(error: unknown): Promise<void> {
  expect(error).toBeInstanceOf(HostedOnboardingError);
  expect(error).toMatchObject({
    name: "HostedOnboardingError", code: "HOSTED_LINQ_PRODUCTION_CANARY_OUTCOME_UNAVAILABLE",
    httpStatus: 503, message: "The production canary outcome is unavailable.",
    cause: undefined, details: undefined, retryable: false,
  });
  expect(error).not.toHaveProperty("stage");
  const response = jsonError(error);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe(JSON.stringify({ error: {
    code: "HOSTED_LINQ_PRODUCTION_CANARY_OUTCOME_UNAVAILABLE",
    message: "The production canary outcome is unavailable.", retryable: false,
  } }));
}

function goal(overrides: Partial<BrowserVaultEntity> = {}): BrowserVaultEntity {
  return {
    attributes: {}, bodyPreview: null, date: null, experimentSlug: null,
    family: "goal", id: goalId, kind: "goal", links: [], lookupIds: [goalId],
    occurredAt: null, recordClass: "bank", status: "active", stream: null, tags: [],
    title: LINQ_PRODUCTION_CANARY_GOAL_TITLE, ...overrides,
  };
}

function snapshotRef(hash = "a".repeat(64)) {
  return { hash, key: "synthetic/canary.bundle.json", size: 128, updatedAt: generatedAt };
}

async function installEncryptedReplica(
  entities: BrowserVaultEntity[],
  options: { sessionMemberId?: string; corruptCiphertext?: boolean } = {},
): Promise<HostedWorkspaceRecord> {
  const source = { dataVersion: "d".repeat(64), sourceBundleHash: "a".repeat(64) };
  const plaintext = new TextEncoder().encode(JSON.stringify({
    assistantSummary: { highlights: [], latestDate: null },
    entities, experimentOutcomes: [], experimentRunCards: [], generatedAt,
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION, hasLabBiomarkers: false,
    labResultRows: [], metricGoalProgressRows: [], metricRows: [], metricSelectionRows: [],
    policy: { bodyPreviewChars: 280, excludedFamilies: [], id: "health-vault-browser", includedFamilies: ["goal"], metricLookbackDays: 365 },
    schema: "murph.browser-vault-replica", searchRows: [], source,
    sourceHealthRows: [], timelineRows: [], weeklySampleSummaries: [],
  }));
  const replicaRef = {
    byteLength: plaintext.byteLength, ...source, generatedAt,
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    keyId: "synthetic-browser-vault-key", objectKey: "synthetic/canary-replica.json",
    replicaSchema: "murph.browser-vault-replica", runtimeRootKeyId: "udrk:runtime:synthetic-canary",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
  };
  const sessionMemberId = options.sessionMemberId ?? memberId;
  const replicaAad = {
    ...source, objectKey: replicaRef.objectKey, purpose: "browser-vault-replica",
    runtimeRootKeyId: replicaRef.runtimeRootKeyId, schema: "murph.browser-vault-replica", userId: sessionMemberId,
  };
  const key = crypto.getRandomValues(new Uint8Array(32));
  const encryptedReplica = await encryptHostedStoragePayload({
    aad: buildHostedStorageAad(replicaAad), key, keyId: replicaRef.keyId, plaintext, scope: "browser-vault-replica",
  });
  if (options.corruptCiphertext) {
    const ciphertext = Buffer.from(encryptedReplica.ciphertext, "base64");
    ciphertext[0] = ciphertext[0]! ^ 1;
    encryptedReplica.ciphertext = ciphertext.toString("base64");
  }
  mocks.session.mockImplementation(async ({ browserPublicKeyJwk }: { browserPublicKeyJwk: HostedUserRecipientPublicKeyJwk }) => ({
    encryptedReplica, replicaAad, replicaRef, state: "ready",
    replicaKeyEnvelope: await wrapHostedBrowserSessionKey({
      keyBytes: key, keyId: replicaRef.keyId, publicKeyJwk: browserPublicKeyJwk,
      purpose: "browser-vault-replica", userId: sessionMemberId,
    }),
  }));
  const workspace: HostedWorkspaceRecord = {
    browserVaultReplicaRef: replicaRef, snapshotRef: snapshotRef(), userId: memberId, version: "1",
    checkpointedAt: generatedAt, createdAt: generatedAt, updatedAt: generatedAt,
    inboxMediaRetentionWakeAt: null, nextWakeAt: null, nextWakeReason: null,
    nextDefaultProcessingWakeAt: null, nextDefaultProcessingWakeReason: null,
    redactedStatusJson: null, systemMailboxProgressGeneration: null,
  };
  mocks.workspace.mockResolvedValue(workspace);
  return workspace;
}
