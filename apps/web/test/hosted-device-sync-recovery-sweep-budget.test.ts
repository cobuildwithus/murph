import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { HostedDomainRootKeyEnvelopeV1 } from "@murphai/runtime-state";
import { HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID } from "@murphai/hosted-execution/routes";

const leaves = vi.hoisted(() => ({ prisma: vi.fn(), probe: vi.fn(), wake: vi.fn(), signal: vi.fn(), deviceSignal: vi.fn(), unwrap: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: leaves.prisma }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: async () => HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
}));
vi.mock("@/src/lib/device-sync/providers", () => ({
  createHostedDeviceSyncRegistry: () => ({ get: () => ({ jobExecutor: { probeScheduledReconcile: leaves.probe } }) }),
}));
vi.mock("@/src/lib/device-sync/wake-service", async (original) => ({
  ...await original<object>(), appendHostedDeviceSyncScheduledReconcileWake: leaves.wake,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", async (original) => ({
  ...await original<object>(), signalHostedMailboxAppendRuntime: leaves.signal, signalHostedDeviceSyncMailboxRuntime: leaves.deviceSignal,
}));
vi.mock("@/src/lib/hosted-crypto/domain-root-store", async (original) => ({
  ...await original<object>(), unwrapHostedDomainRootForWeb: leaves.unwrap,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", async (original) => ({
  ...await original<object>(),
  readActiveHostedMemberAccess: async () => true, readHostedRuntimeAiAccessDecision: async () => ({ allowed: true }),
}));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ hasHostedRuntimeActiveAccess: async () => true }));
vi.mock("@/src/lib/legal/consent", async (original) => ({
  ...await original<object>(), readHostedHealthDataConsentState: async () => "granted",
}));

import { prepareHostedCryptoDomainRootCandidates } from "@/src/lib/hosted-crypto/domain-root-store";
import { getPrisma } from "@/src/lib/prisma";
import * as cryptoEnv from "@/src/lib/hosted-crypto/env";

import { POST } from "../app/api/internal/device-sync/recovery-sweep/route";
import { PrismaDeviceSyncControlPlaneStore } from "@/src/lib/device-sync/prisma-store";

const CALLER_HTTP_TIMEOUT_MS = 30_000;
const CALLER_ACTIVITY_TIMEOUT_MS = 60_000;
const BUDGET_MS = 22_000;
const PROBE_STOP_MS = BUDGET_MS - 6_000;
const now = new Date("2026-11-01T12:00:00Z");

async function fixture({ wakeMs = 10, handoffMs = 10 } = {}) {
  const events: { kind: string; id: string; at: number }[] = [];
  const active = { probe: 0, unwrap: 0, wake: 0, handoff: 0 };
  const elapsed = () => Date.now() - now.getTime();
  async function work(kind: keyof typeof active, id: string, ms: number, signal?: AbortSignal) {
    events.push({ kind: `${kind}:start`, id, at: elapsed() });
    active[kind]++;
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          events.push({ kind: `${kind}:cancel`, id, at: elapsed() });
          // Settling is asynchronous: racing abort without joining is observable.
          setTimeout(() => reject(signal?.reason), 5);
        };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
      events.push({ kind: `${kind}:complete`, id, at: elapsed() });
    } finally {
      events.push({ kind: `${kind}:settled`, id, at: elapsed() });
      active[kind]--;
    }
  }
  const rows = Array.from({ length: 16 }, (_, i) => ({
    userId: `synthetic-budget-${i}`, connectionId: `synthetic-connection-${i}`, provider: "junction",
    connectedAt: "2026-10-01T00:00:00.000Z", nextReconcileAt: now.toISOString(),
    ...(i === 15 ? { orphanedDirtyRecoveryKey: "synthetic-orphan" } : {}),
  }));
  const clinical = [{ id: "clinical-slow", memberId: "clinical-member-slow" }, { id: "clinical-next", memberId: "clinical-member-next" }];
  const writes = vi.fn(async (input) => { events.push({ kind: "write", id: input.where.id, at: elapsed() }); return { count: 1 }; });
  let envelope: HostedDomainRootKeyEnvelopeV1 | undefined;
  const tx = {
    $queryRaw: vi.fn(async (query: TemplateStringsArray | { strings: readonly string[] }) => {
      const sql = ("strings" in query ? query.strings : query).join(" ");
      if (sql.includes("hosted_user_crypto_envelope")) return envelope ? [{
        id: "synthetic-root-row", domain: "ingress", userId: "synthetic-deferred", status: "active",
        rootKeyId: envelope.rootKeyId, signedEnvelopeJson: envelope, updatedAt: now,
      }] : [];
      if (sql.includes("INSERT INTO hosted_mailbox_lane_counter")) return [{ seq: 1n }];
      if (sql.includes("INSERT INTO hosted_mailbox_item")) {
        events.push({ kind: "write", id: "deferred", at: elapsed() });
        return [{ id: "deferred-mailbox", userId: "synthetic-deferred", kind: "device-sync.wake", lane: "system", laneSeq: 1n,
          causalSeq: 1n, dedupeKey: "synthetic-deferred", occurredAt: now, createdAt: now, updatedAt: now,
          consumedAt: null, expiresAt: null, payloadSchema: "murph.hosted-mailbox-item-payload.v1", payloadBytes: 1,
        }];
      }
      return [{ suspendedAt: null }];
    }),
    $executeRaw: vi.fn(async (query: TemplateStringsArray | { strings: readonly string[] }) => {
      if (("strings" in query ? query.strings : query).join(" ").includes('UPDATE "device_sync_dirty_connection"')) {
        events.push({ kind: "write", id: "deferred", at: elapsed() });
      }
      return 1;
    }),
    hostedMailboxItem: { findUnique: vi.fn(async () => null) },
    hostedMember: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    deviceConnectionSource: { findMany: vi.fn(async () => []) },
    deviceSyncDirtyConnection: { findUnique: vi.fn(async () => null) },
    deviceSyncDirtyPayload: { findFirst: vi.fn(async () => null) },
    hostedMailboxLaneCounter: { findMany: vi.fn(async () => [{ lane: "system", nextSeq: 2n, consumedSeq: 1n }]) },
    hostedWorkspace: { findUnique: vi.fn(async () => ({ version: 1n, redactedStatusJson: {
      hostedMailboxSystemHandledThroughSeq: "1", hostedMailboxSystemFirstPendingSeq: null,
      hostedMailboxSystemDeviceSyncContinuationSeqs: [],
    } })) },
    clinicalRecordConnection: { findMany: vi.fn(async () => clinical), updateMany: writes },
  };
  leaves.prisma.mockReturnValue({ ...tx,
    $queryRaw: vi.fn(async (query: TemplateStringsArray | { strings: readonly string[] }) => {
      if (("strings" in query ? query.strings : query).join(" ").includes("pending_handoff_users")) {
        return [{ mailboxItemId: "old-missed-handoff", userId: "synthetic-handoff" }];
      }
      return tx.$queryRaw(query);
    }),
    $transaction: async (run: (value: typeof tx) => Promise<unknown>) => run(tx),
  });
  vi.spyOn(PrismaDeviceSyncControlPlaneStore.prototype, "listDueReconcileConnectionsForSweep").mockResolvedValue(rows);
  vi.spyOn(PrismaDeviceSyncControlPlaneStore.prototype, "listDueDeferredDirtyConnectionWakes")
    .mockImplementation(async () => {
      expect(active.handoff).toBe(0);
      return [{ connectionId: "deferred", userId: "synthetic-deferred" }];
    });
  vi.spyOn(PrismaDeviceSyncControlPlaneStore.prototype, "readDueDeferredDirtyConnectionWake").mockResolvedValue({
    connectedAt: new Date(rows[0].connectedAt), connectionStatus: "active", dirtyRevision: 2n, processedRevision: 1n,
    latestDirtyAt: now, latestEventType: null, latestResourceCategory: null, provider: "junction",
  });
  vi.spyOn(PrismaDeviceSyncControlPlaneStore.prototype, "getConnectionRecordForUser").mockImplementation(async (userId, connectionId) => ({
    id: connectionId, userId, provider: "junction", status: "active", credentialKind: "provider_config",
    setupPhase: null, connectedAt: new Date(rows[0].connectedAt), nextReconcileAt: now, updatedAt: now,
    tokenVersion: null, metadataJson: { junctionReconcileProofV1: "synthetic-proof" }, lastWebhookAt: null,
  }) as never);
  vi.spyOn(PrismaDeviceSyncControlPlaneStore.prototype, "materializeStoredConnectionAccount").mockImplementation(async (record) => ({
    id: record.id, provider: "junction", credential: { kind: "provider_config", providerConfigKey: "junction", credentialMetadata: {} },
    tokenVersion: null, updatedAt: now.toISOString(),
  }) as never);
  leaves.probe.mockImplementation(async (account, _now, { signal }) => {
    await work("probe", account.id, 16_000, signal);
    return { outcome: "changed", reason: "changed", wakeAvoided: false, requestCount: 1, recordCount: 1, responseBytes: 1, elapsedMs: 16_000 };
  });
  leaves.wake.mockImplementation(async ({ connectionId, abortSignal }) => {
    await work("wake", connectionId, wakeMs, abortSignal);
    return { wakeAccepted: true, wakeAppended: true, wakeDuplicate: false, wakeInserted: true };
  });
  leaves.signal.mockImplementation(async ({ mailboxItemId, abortSignal }) => {
    await work("handoff", mailboxItemId, handoffMs, abortSignal);
    return { signalAccepted: true, workflowId: "synthetic" };
  });
  leaves.deviceSignal.mockImplementation(async ({ abortSignal }) => {
    await work("wake", "deferred", 10, abortSignal);
    return { signalAccepted: true, workflowId: "synthetic" };
  });
  const candidates = await prepareHostedCryptoDomainRootCandidates({ domains: ["ingress"], prisma: getPrisma(), userId: "synthetic-deferred" });
  envelope = candidates.get("ingress")!;
  const config = cryptoEnv.getHostedWebCryptoConfig();
  vi.spyOn(cryptoEnv, "getHostedWebCryptoConfig").mockReturnValue(config);
  const decrypt = config.gcpKms.decrypt.bind(config.gcpKms);
  vi.spyOn(config.gcpKms, "decrypt").mockImplementation(async (input) => {
    expect(input.signal).toBeInstanceOf(AbortSignal);
    events.push({ kind: "deferred-unwrap", id: "deferred", at: elapsed() });
    return decrypt(input);
  });
  leaves.unwrap.mockImplementation(async ({ userId, signal }) => {
    await work("unwrap", userId, 40_000, signal);
    throw new Error("Synthetic unwrap unavailable");
  });
  return { events, active, rows, writes, elapsed };
}

beforeAll(() => {
  const authority = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { format: "jwk" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const automation = generateKeyPairSync("ec", { namedCurve: "prime256v1", publicKeyEncoding: { format: "jwk" }, privateKeyEncoding: { format: "jwk" } });
  for (const [key, value] of Object.entries({
    HOSTED_CRYPTO_ENV: "test", HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME: "projects/murph-test/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/murph-test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authority.publicKey,
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: JSON.stringify(authority.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: Buffer.alloc(32, 23).toString("base64"),
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "synthetic-budget",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK: JSON.stringify(automation.publicKey),
  })) vi.stubEnv(key, value);
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(now);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

async function runRoute(f: Awaited<ReturnType<typeof fixture>>) {
  let response: Response | undefined;
  let activeAtResponse: typeof f.active | undefined;
  let responseAt = 0;
  const run = POST(new Request("https://example.test/recovery", { method: "POST", body: "{}" }))
    .then((value) => { response = value; activeAtResponse = { ...f.active }; responseAt = f.elapsed(); });
  for (let t = 0; t < CALLER_HTTP_TIMEOUT_MS && !response; t += 25) await vi.advanceTimersByTimeAsync(25);
  expect(response, "handler must join and return before the caller aborts").toBeDefined();
  expect(responseAt).toBeLessThan(CALLER_HTTP_TIMEOUT_MS);
  expect(responseAt).toBeLessThanOrEqual(BUDGET_MS + 100);
  expect(activeAtResponse).toEqual({ probe: 0, unwrap: 0, wake: 0, handoff: 0 });
  await run;
  return response!;
}

it("joins the real sweep owners, cancels optional probes, and short-retries clinical admission", async () => {
  const f = await fixture();
  const response = await runRoute(f);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["deferredWakeSweeper", "dueReconcileSweeper", "preferenceHandoffSweeper"]);
  expect(body.dueReconcileSweeper).toEqual({ dueConnections: 16, hasMoreDueConnections: false,
    wakeAccepted: 16, wakeAttempted: 16, wakeFailed: 0, wakeLimit: 100, wakeNotAccepted: 0 });
  expect(body.preferenceHandoffSweeper).toEqual({ candidateUsers: 1, handoffAccepted: 1, handoffAttempted: 1,
    handoffFailed: 0, handoffLimit: 25, handoffSkippedInactive: 0, skippedCandidateUsers: 0 });
  expect(body.deferredWakeSweeper).toEqual({ dueConnections: 1, hasMoreDueConnections: false,
    releaseCleared: 0, releaseFailed: 0, releaseLimit: 100, released: 1 });
  const handoff = f.events.find((e) => e.kind === "handoff:complete")!;
  const probes = f.events.filter((e) => e.kind === "probe:start");
  expect(probes.length).toBeGreaterThan(0);
  expect(probes.every((e) => e.at > handoff.at && e.at < PROBE_STOP_MS)).toBe(true);
  expect(f.events.filter((e) => e.kind === "probe:complete").length).toBeLessThan(10);
  const cancelledProbes = f.events.filter((e) => e.kind === "probe:cancel");
  expect(cancelledProbes.length).toBeGreaterThan(0);
  for (const cancelled of cancelledProbes) {
    const settled = f.events.find((e) => e.kind === "probe:settled" && e.id === cancelled.id)!;
    const wakeStarted = f.events.find((e) => e.kind === "wake:start" && e.id === cancelled.id)!;
    expect(settled).toBeDefined();
    expect(wakeStarted).toBeDefined();
    expect(f.events.indexOf(wakeStarted)).toBeGreaterThan(f.events.indexOf(settled));
    expect(f.events.find((e) => e.kind === "wake:complete" && e.id === cancelled.id)?.at).toBeLessThan(BUDGET_MS);
  }
  expect(console.info).toHaveBeenCalledWith("Hosted device-sync due reconcile sweeper finished.", expect.objectContaining({
    preflight: expect.objectContaining({ reasons: { budget_exhausted: 15 } }),
  }));
  expect(leaves.unwrap).toHaveBeenCalledTimes(1);
  expect(f.writes).toHaveBeenCalledExactlyOnceWith({ where: { id: "clinical-slow", nextSyncAt: { lte: now } },
    data: { nextSyncAt: new Date(now.getTime() + 14 * 60_000) } });
  const finished = [...f.events];
  await vi.advanceTimersByTimeAsync(CALLER_ACTIVITY_TIMEOUT_MS);
  expect(f.events).toEqual(finished);
});

it("leaves unstarted rows untouched when wakes consume the remaining time", async () => {
  const f = await fixture({ wakeMs: 40_000 });
  const response = await runRoute(f);
  expect(response.status).toBe(200);
  expect((await response.json()).dueReconcileSweeper).toMatchObject({ hasMoreDueConnections: true, wakeFailed: 0 });
  const started = new Set(f.events.filter((e) => e.kind === "wake:start").map((e) => e.id));
  expect(started.size).toBeLessThan(f.rows.length);
  for (const row of f.rows.filter((r) => !started.has(r.connectionId))) {
    expect(f.events.some((e) => e.id === row.connectionId && e.kind === "write")).toBe(false);
  }
  const finished = [...f.events];
  await vi.advanceTimersByTimeAsync(CALLER_ACTIVITY_TIMEOUT_MS);
  expect(f.events).toEqual(finished);
});

it("joins a cancelled handoff at its stage cap and still runs producers", async () => {
  const f = await fixture({ handoffMs: 40_000 });
  const response = await runRoute(f);
  // Handoff failures retain the existing route failure contract.
  expect(response.status).toBe(500);
  expect(f.events.find((e) => e.kind === "handoff:cancel")?.at).toBe(10_000);
  expect(f.events.some((e) => e.kind === "wake:complete")).toBe(true);
  const finished = [...f.events];
  await vi.advanceTimersByTimeAsync(CALLER_ACTIVITY_TIMEOUT_MS);
  expect(f.events).toEqual(finished);
});
