import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: vi.fn(), probe: vi.fn(), access: vi.fn(), consent: vi.fn(), mailboxLock: vi.fn(),
}));
vi.mock("@/src/lib/device-sync/prisma-store", () => ({ PrismaDeviceSyncControlPlaneStore: mocks.store }));
vi.mock("@/src/lib/device-sync/providers", () => ({
  createHostedDeviceSyncRegistry: () => ({ get: () => ({ jobExecutor: { probeScheduledReconcile: mocks.probe } }) }),
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({ readActiveHostedMemberAccess: mocks.access }));
vi.mock("@/src/lib/legal/consent", () => ({ readHostedHealthDataConsentState: mocks.consent }));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({ acquireHostedMailboxCausalAppendLockTx: mocks.mailboxLock }));

import { preflightHostedScheduledReconcile } from "@/src/lib/device-sync/scheduled-reconcile-preflight";

const now = new Date("2026-09-10T12:00:00.000Z");
const due = {
  connectionId: "synthetic-connection", userId: "synthetic-member", provider: "junction",
  connectedAt: "2026-08-01T00:00:00.000Z", nextReconcileAt: now.toISOString(),
};
const unchanged = {
  outcome: "unchanged", reason: "contents_unchanged", nextReconcileAt: "2026-09-10T13:00:00.000Z",
  requestCount: 3, recordCount: 5, responseBytes: 500, elapsedMs: 20,
};

function fixture() {
  let inTransaction = false;
  let record = {
    id: due.connectionId, userId: due.userId, provider: "junction", status: "active",
    credentialKind: "provider_config", setupPhase: null, connectedAt: new Date(due.connectedAt),
    nextReconcileAt: now, updatedAt: now, tokenVersion: null, metadataJson: { junctionReconcileProofV1: "synthetic-proof" },
    lastWebhookAt: new Date(now.getTime() - 2 * 3_600_000),
  };
  let source = {
    id: "synthetic-source", connectionId: due.connectionId, sourceInstanceKey: "synthetic-source-key",
    sourceProviderSlug: "garmin", displayName: null, status: "connected", lifecycleEpoch: 1,
    createdAt: now, updatedAt: now, firstSeenAt: now, lastSeenAt: now, lastDataAt: null,
    lastErrorCode: null, lastErrorMessage: null, resourceAvailabilitySummaryJson: { sleep: true },
  };
  let pending = false;
  let retained = false;
  let payload = false;
  let workspaceVersion = 1n;
  let dirty = false;
  const update = vi.fn(async () => ({ count: 1 }));
  const tx = {
    $queryRaw: vi.fn(async () => []),
    deviceConnection: { updateMany: update },
    deviceConnectionSource: { findMany: vi.fn(async () => [source]) },
    deviceSyncDirtyConnection: { findUnique: vi.fn(async () => ({ dirtyRevision: dirty ? 2n : 1n, processedRevision: 1n })) },
    deviceSyncDirtyPayload: { findFirst: vi.fn(async () => payload ? { id: "synthetic-payload" } : null) },
    hostedMailboxLaneCounter: { findMany: vi.fn(async () => [{ lane: "system", nextSeq: pending ? 3n : 2n, consumedSeq: 1n }]) },
    hostedWorkspace: { findUnique: vi.fn(async () => ({ version: workspaceVersion, redactedStatusJson: {
      hostedMailboxSystemHandledThroughSeq: "1", hostedMailboxSystemFirstPendingSeq: null,
      hostedMailboxSystemDeviceSyncContinuationSeqs: retained ? ["1"] : [],
    } })) },
  };
  const store = {
    getConnectionRecordForUser: vi.fn(async () => record),
    materializeStoredConnectionAccount: vi.fn(async () => {
      expect(inTransaction).toBe(false);
      return {
        id: due.connectionId, provider: "junction", externalAccountId: "synthetic-provider-account",
        credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
        disconnectGeneration: 0, tokenVersion: null, updatedAt: now.toISOString(),
      };
    }),
    withHealthDataAdmissionLock: vi.fn(async (_userId: string, _connectionId: string, run: (client: typeof tx) => Promise<unknown>) => {
      inTransaction = true;
      try { return await run(tx); } finally { inTransaction = false; }
    }),
  };
  mocks.store.mockImplementation(function () { return store; });
  mocks.probe.mockImplementation(async () => {
    expect(inTransaction).toBe(false);
    return unchanged;
  });
  return {
    tx, store, update,
    changeConnection: () => { record = { ...record, updatedAt: new Date(now.getTime() + 1) }; },
    reconnect: () => { record = { ...record, connectedAt: new Date(now.getTime() + 1) }; },
    changeSource: () => { source = { ...source, updatedAt: new Date(now.getTime() + 1), lifecycleEpoch: 2 }; },
    changeSourceSameTimestamp: () => { source = { ...source, status: "disconnected" }; },
    pending: () => { pending = true; }, retained: () => { retained = true; }, payload: () => { payload = true; },
    checkpoint: () => { workspaceVersion += 1n; }, dirty: () => { dirty = true; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue(true);
  mocks.consent.mockResolvedValue("granted");
});

it("advances only cadence after unchanged contents and exact authority revalidation", async () => {
  const f = fixture();
  const result = await preflightHostedScheduledReconcile({ connection: due, now });
  expect(result.wakeAvoided).toBe(true);
  expect(result.webhookAgeBucket).toBe("1to6h");
  expect(f.update).toHaveBeenCalledWith({
    where: { id: due.connectionId, userId: due.userId, status: "active", connectedAt: new Date(due.connectedAt), updatedAt: now, nextReconcileAt: now },
    data: { nextReconcileAt: new Date(unchanged.nextReconcileAt) },
  });
  expect(mocks.mailboxLock).toHaveBeenCalledTimes(3);
  const [account, probeNow, options] = mocks.probe.mock.calls[0];
  expect(account.sources[0]).toMatchObject({ lifecycleEpoch: 1, resourceCount: 1, sourceProviderSlug: "garmin" });
  expect(probeNow).toBe(now.toISOString());
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

it.each(["dirty", "payload", "pending", "retained"] as const)("does not fetch over existing %s work", async (kind) => {
  const f = fixture(); f[kind]();
  expect((await preflightHostedScheduledReconcile({ connection: due, now })).wakeAvoided).toBe(false);
  expect(mocks.probe).not.toHaveBeenCalled();
  expect(f.store.materializeStoredConnectionAccount).not.toHaveBeenCalled();
});

it.each(["changeConnection", "changeSource", "changeSourceSameTimestamp", "reconnect", "pending", "retained", "payload", "checkpoint", "dirty"] as const)("retains the wake when %s races with the provider read", async (kind) => {
  const f = fixture();
  mocks.probe.mockImplementation(async () => { f[kind](); return unchanged; });
  expect((await preflightHostedScheduledReconcile({ connection: due, now })).wakeAvoided).toBe(false);
  expect(f.update).not.toHaveBeenCalled();
});

it("checks consent again after secure account materialization and before provider egress", async () => {
  const f = fixture();
  mocks.consent.mockResolvedValueOnce("granted").mockResolvedValue("revoked");
  expect((await preflightHostedScheduledReconcile({ connection: due, now })).wakeAvoided).toBe(false);
  expect(mocks.probe).not.toHaveBeenCalled();
  expect(f.update).not.toHaveBeenCalled();
});

it("keeps changed, ineligible, and failed CAS outcomes on the existing wake path", async () => {
  const f = fixture();
  for (const outcome of ["changed", "ineligible"]) {
    mocks.probe.mockResolvedValue({ ...unchanged, outcome });
    expect((await preflightHostedScheduledReconcile({ connection: due, now })).wakeAvoided).toBe(false);
  }
  expect(f.update).not.toHaveBeenCalled();
  mocks.probe.mockResolvedValue(unchanged);
  f.update.mockResolvedValue({ count: 0 });
  expect((await preflightHostedScheduledReconcile({ connection: due, now })).wakeAvoided).toBe(false);
});

it("aborts the owned provider probe on its deadline without advancing cadence", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    mocks.probe.mockImplementation(async (_account, _now, { signal }: { signal: AbortSignal }) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    const run = preflightHostedScheduledReconcile({ connection: due, now });
    const rejected = expect(run).rejects.toThrow();
    await vi.runAllTimersAsync();
    await rejected;
    expect(f.update).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it("retains provider timeout metrics and the webhook age bucket", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    mocks.probe.mockImplementation(async (_account, _now, { signal }: { signal: AbortSignal }) =>
      new Promise((resolve) => signal.addEventListener("abort", () => resolve({
        ...unchanged, outcome: "ineligible", reason: "probe_timeout", requestCount: 2,
      }), { once: true })));
    const run = preflightHostedScheduledReconcile({ connection: due, now });
    await vi.runAllTimersAsync();
    expect(await run).toMatchObject({ wakeAvoided: false, reason: "probe_timeout", requestCount: 2, webhookAgeBucket: "1to6h" });
    expect(f.update).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
