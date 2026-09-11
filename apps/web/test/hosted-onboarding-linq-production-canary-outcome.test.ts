import { BROWSER_VAULT_REPLICA_CURRENT_GENERATION } from "@murphai/contracts/browser-vault";
import { BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS } from "@murphai/hosted-execution/browser-vault";
import type { BrowserVaultEntity } from "@murphai/query/browser-replica-client";
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

import { LINQ_PRODUCTION_CANARY_GOAL_TITLE } from "@/src/lib/hosted-onboarding/linq-production-canary-contract";
import { readHostedLinqProductionCanaryOutcome } from "@/src/lib/hosted-onboarding/linq-production-canary-outcome";
import type { HostedWorkspaceRecord } from "@/src/lib/hosted-workspace/store";

const prisma = {} as Parameters<typeof readHostedLinqProductionCanaryOutcome>[0]["prisma"];
const memberId = "member_synthetic_canary";
const goalId = "goal_01K4A000000000000000000001";
const otherGoalId = "goal_01K4A000000000000000000002";
const generatedAt = "2026-09-10T12:00:00.000Z";
const notReady = { ready: false, totalGoalCount: 0, matchingGoalCount: 0, matchingGoalIdCount: 0 };

describe("production canary canonical outcome observer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it("does not read any other identity when the fixed canary is absent", async () => {
    mocks.memberId.mockResolvedValue(null);
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("requires active access and health-data consent before reading a replica", async () => {
    mocks.authority.mockRejectedValue(new Error("synthetic access denial"));
    await expect(readHostedLinqProductionCanaryOutcome({ prisma })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PRODUCTION_CANARY_OUTCOME_UNAVAILABLE", httpStatus: 503,
    });
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("refuses a stale replica even when it already contains the expected goal", async () => {
    const workspace = await installEncryptedReplica([goal()]);
    mocks.workspace.mockResolvedValue({ ...workspace, snapshotRef: snapshotRef("b".repeat(64)) });
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("refuses a replica after the freshness window even with the matching source", async () => {
    await installEncryptedReplica([goal()]);
    vi.mocked(Date.now).mockReturnValue(Date.parse(generatedAt) + BROWSER_VAULT_REPLICA_DEFAULT_MAX_AGE_MS + 1);
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("waits when a reply has been delivered but its conversation turn is not checkpointed", async () => {
    await installEncryptedReplica([goal()]);
    mocks.pending.mockResolvedValue({ id: "synthetic-pending-conversation" });
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("rejects a newly pending conversation that races replica decryption", async () => {
    await installEncryptedReplica([goal()]);
    mocks.pending.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "synthetic-pending-conversation" });
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
  });

  it("rejects a checkpoint or replica publication that races decryption", async () => {
    const workspace = await installEncryptedReplica([goal()]);
    mocks.workspace.mockResolvedValueOnce(workspace).mockResolvedValueOnce({ ...workspace, version: "2" });
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
  });

  it("rejects a reset that replaces the canary identity during the read", async () => {
    await installEncryptedReplica([goal()]);
    mocks.memberId.mockResolvedValueOnce(memberId).mockResolvedValueOnce("member_synthetic_replacement");
    expect(await readHostedLinqProductionCanaryOutcome({ prisma })).toEqual(notReady);
  });

  it("rejects encrypted data bound to another member", async () => {
    await installEncryptedReplica([goal()], { sessionMemberId: "member_synthetic_unrelated" });
    await expect(readHostedLinqProductionCanaryOutcome({ prisma })).rejects.toMatchObject({
      code: "HOSTED_LINQ_PRODUCTION_CANARY_OUTCOME_UNAVAILABLE",
    });
  });

  it("fails explicitly without the protected control client", async () => {
    await installEncryptedReplica([goal()]);
    mocks.control.mockReturnValue(null);
    await expect(readHostedLinqProductionCanaryOutcome({ prisma })).rejects.toMatchObject({ httpStatus: 503 });
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("scrubs provider errors instead of returning private source pointers", async () => {
    await installEncryptedReplica([goal()]);
    mocks.session.mockRejectedValue(new Error("synthetic-private-ref"));
    const error: unknown = await readHostedLinqProductionCanaryOutcome({ prisma }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: "The production canary outcome is unavailable.", cause: undefined });
    expect(JSON.stringify(error)).not.toContain("synthetic-private-ref");
  });
});

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
  options: { sessionMemberId?: string } = {},
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
