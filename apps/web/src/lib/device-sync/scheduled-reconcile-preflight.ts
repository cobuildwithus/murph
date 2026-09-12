import type { Prisma } from "@prisma/client";
import { isDeviceSyncSourceResourceAvailabilityMetadataKey } from "@murphai/device-syncd/fitbit-migration";
import { HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT, JUNCTION_RECONCILE_PROOF_METADATA_KEY } from "@murphai/device-syncd/hosted-runtime";
import type { ScheduledReconcileProbeResult, StoredDeviceSyncAccount } from "@murphai/device-syncd/types";

import { acquireHostedMailboxCausalAppendLockTx } from "../hosted-mailbox/store";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { readHostedHealthDataConsentState } from "../legal/consent";
import { getPrisma } from "../prisma";
import {
  PrismaDeviceSyncControlPlaneStore,
  type HostedDeviceSyncDueReconcileConnectionRecord,
  type HostedPrismaTransactionClient,
} from "./prisma-store";
import { hostedConnectionSourceRecordArgs, mapHostedConnectionSourceRecord } from "./prisma-store/sources";
import { createHostedDeviceSyncRegistry } from "./providers";

const PROBE_TIMEOUT_MS = 20_000;

export type ScheduledReconcilePreflightResult = ScheduledReconcileProbeResult & {
  wakeAvoided: boolean;
  webhookAgeBucket?: "never" | "under1h" | "1to6h" | "6to24h" | "over24h";
};

// Only bounded, complete, checkpoint-proven provider reads may avoid an ordinary
// cadence wake. Dirty/recovery/manual work retains its existing owner.
export async function preflightHostedScheduledReconcile(input: {
  connection: HostedDeviceSyncDueReconcileConnectionRecord;
  now: Date;
  store?: PrismaDeviceSyncControlPlaneStore;
}): Promise<ScheduledReconcilePreflightResult> {
  let webhookAgeBucket: ScheduledReconcilePreflightResult["webhookAgeBucket"];
  const fallback = (reason: string): ScheduledReconcilePreflightResult => ({
    outcome: "ineligible", reason, wakeAvoided: false,
    requestCount: 0, recordCount: 0, responseBytes: 0, elapsedMs: 0,
    ...(webhookAgeBucket ? { webhookAgeBucket } : {}),
  });
  if (input.connection.provider !== "junction" || input.connection.orphanedDirtyRecoveryKey !== undefined) {
    return fallback("not_ordinary_junction");
  }
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({ prisma: getPrisma() });
  const executor = createHostedDeviceSyncRegistry().get("junction")?.jobExecutor;
  if (!executor?.probeScheduledReconcile) return fallback("provider_unavailable");

  let ineligibleReason = "authority_or_work_ineligible";
  const reject = (reason: string): null => { ineligibleReason = reason; return null; };
  const readLocked = <T>(apply: (state: Awaited<ReturnType<typeof readAuthority>>, tx: HostedPrismaTransactionClient) => Promise<T>) =>
    store.withHealthDataAdmissionLock(input.connection.userId, input.connection.connectionId, async (tx) => {
      // Serialize against accepted mailbox work, including inserts into a
      // previously empty lane, using the existing append owner's lock.
      await acquireHostedMailboxCausalAppendLockTx({ tx, userId: input.connection.userId });
      await tx.$queryRaw`SELECT user_id FROM hosted_workspace WHERE user_id = ${input.connection.userId} FOR UPDATE`;
      return apply(await readAuthority(input, store, tx, reject), tx);
    }, { requireActiveMember: true });

  const baseline = await readLocked(async (state) => state);
  if (!baseline) return fallback(ineligibleReason);
  webhookAgeBucket = classifyWebhookAge(baseline.record.lastWebhookAt, input.now);
  // The securebox owner can unwrap keys externally. Never perform this inside
  // either database-only authority transaction.
  const materialized = await store.materializeStoredConnectionAccount(baseline.record);
  if (!materialized || materialized.credential.kind !== "provider_config") return fallback("account_unavailable");
  const account: StoredDeviceSyncAccount = {
    ...materialized,
    credential: materialized.credential,
    hostedObservedConnectionRevision: 0,
    hostedObservedTokenRevision: 0,
    hostedObservedTokenVersion: materialized.tokenVersion,
    hostedObservedUpdatedAt: materialized.updatedAt,
    localConnectionRevision: 0,
    localTokenRevision: 0,
    sources: baseline.sources.map((record) => {
      const source = mapHostedConnectionSourceRecord(record);
      const summary = source.resourceAvailabilitySummary ?? {};
      return {
        ...source,
        resourceAvailabilitySummary: summary,
        resourceCount: Object.entries(summary).filter(([key, value]) =>
          !isDeviceSyncSourceResourceAvailabilityMetadataKey(key) && value !== false && value !== null,
        ).length,
      };
    }),
  };
  if (!await readLocked(async (current) => current?.fingerprint === baseline.fingerprint)) {
    return fallback("authority_changed_before_fetch");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let probe: ScheduledReconcileProbeResult;
  try {
    probe = await executor.probeScheduledReconcile(account, input.now.toISOString(), { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (controller.signal.aborted && probe.outcome === "unchanged") return { ...probe, webhookAgeBucket, outcome: "ineligible", reason: "probe_timeout", wakeAvoided: false };
  if (probe.outcome !== "unchanged") return { ...probe, webhookAgeBucket, wakeAvoided: false };
  const nextReconcileAt = probe.nextReconcileAt ? new Date(probe.nextReconcileAt) : null;
  if (!nextReconcileAt || !Number.isFinite(nextReconcileAt.getTime()) || nextReconcileAt <= input.now) {
    return { ...probe, webhookAgeBucket, reason: "invalid_next_reconcile", wakeAvoided: false };
  }
  const wakeAvoided = await readLocked(async (current, tx) => {
    if (!current || current.fingerprint !== baseline.fingerprint) return false;
    const updated = await tx.deviceConnection.updateMany({
      where: {
        id: baseline.record.id, userId: baseline.record.userId,
        status: "active", connectedAt: baseline.record.connectedAt,
        updatedAt: baseline.record.updatedAt, nextReconcileAt: baseline.record.nextReconcileAt,
      },
      // Observation/success/source state and proof remain checkpoint-owned.
      data: { nextReconcileAt },
    });
    return updated.count === 1;
  });
  return { ...probe, webhookAgeBucket, reason: wakeAvoided ? probe.reason : "authority_changed_after_fetch", wakeAvoided };
}

async function readAuthority(
  input: { connection: HostedDeviceSyncDueReconcileConnectionRecord; now: Date },
  store: PrismaDeviceSyncControlPlaneStore,
  tx: HostedPrismaTransactionClient,
  reject: (reason: string) => null,
) {
  const { connection } = input;
  if (!await readActiveHostedMemberAccess({ memberId: connection.userId, now: input.now, prisma: tx })
    || await readHostedHealthDataConsentState({ memberId: connection.userId, prisma: tx }) === "revoked") return reject("access_or_consent_ineligible");
  const record = await store.getConnectionRecordForUser(connection.userId, connection.connectionId, tx);
  if (!record || record.provider !== "junction" || record.status !== "active"
    || record.credentialKind !== "provider_config"
    || ![null, "source_confirmed"].includes(record.setupPhase)
    || record.connectedAt.toISOString() !== connection.connectedAt
    || record.nextReconcileAt?.toISOString() !== connection.nextReconcileAt
    || record.nextReconcileAt > input.now) return reject("connection_ineligible");
  if (typeof jsonRecord(record.metadataJson)?.[JUNCTION_RECONCILE_PROOF_METADATA_KEY] !== "string") return reject("baseline_missing");
  const sources = await tx.deviceConnectionSource.findMany({
    ...hostedConnectionSourceRecordArgs,
    where: { connectionId: record.id }, orderBy: { id: "asc" },
    take: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT + 1,
  });
  if (sources.length === 0 || sources.length > HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_CONNECTION_SOURCE_LIMIT) return reject("source_set_ineligible");
  const dirty = await tx.deviceSyncDirtyConnection.findUnique({
    where: { connectionId: record.id }, select: { dirtyRevision: true, processedRevision: true },
  });
  if (dirty && dirty.dirtyRevision > dirty.processedRevision) return reject("pending_dirty_work");
  if (await tx.deviceSyncDirtyPayload.findFirst({ where: { connectionId: record.id }, select: { id: true } })) return reject("pending_dirty_payload");
  const idle = await readSettledMailboxCheckpoint(connection.userId, tx, reject);
  if (!idle) return null;
  return {
    record, sources,
    fingerprint: JSON.stringify({
      connectionUpdatedAt: record.updatedAt, connectedAt: record.connectedAt,
      tokenVersion: record.tokenVersion, metadata: record.metadataJson,
      providerConfigKey: record.providerConfigKey, credentialMetadata: record.credentialMetadataJson,
      externalAccountIdEncrypted: record.externalAccountIdEncrypted,
      // Compare values too: timestamps are not unique mutation generations.
      sources,
      ...idle,
    }),
  };
}

async function readSettledMailboxCheckpoint(
  userId: string, tx: HostedPrismaTransactionClient, reject: (reason: string) => null,
) {
  const counters = await tx.hostedMailboxLaneCounter.findMany({
    where: { userId, lane: { not: "causal" } },
    select: { lane: true, nextSeq: true, consumedSeq: true }, orderBy: { lane: "asc" }, take: 4,
  });
  const system = counters.find((counter) => counter.lane === "system");
  if (!system || counters.length >= 4 || counters.some((counter) => counter.consumedSeq !== counter.nextSeq - 1n)) return reject("pending_mailbox_work");
  const workspace = await tx.hostedWorkspace.findUnique({
    where: { userId }, select: { version: true, redactedStatusJson: true },
  });
  const status = jsonRecord(workspace?.redactedStatusJson);
  if (!workspace || !status
    || String(status.hostedMailboxSystemHandledThroughSeq) !== system.consumedSeq.toString()
    || status.hostedMailboxSystemFirstPendingSeq !== null
    || !Array.isArray(status.hostedMailboxSystemDeviceSyncContinuationSeqs)
    || status.hostedMailboxSystemDeviceSyncContinuationSeqs.length !== 0) return reject("checkpoint_work_unsettled");
  return {
    workspaceVersion: workspace.version.toString(),
    lanes: counters.map((counter) => [counter.lane, counter.nextSeq.toString(), counter.consumedSeq.toString()]),
  };
}

function jsonRecord(value: Prisma.JsonValue | undefined): Prisma.JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function classifyWebhookAge(lastWebhookAt: Date | null, now: Date): ScheduledReconcilePreflightResult["webhookAgeBucket"] {
  if (!lastWebhookAt) return "never";
  const ageHours = Math.max(0, now.getTime() - lastWebhookAt.getTime()) / 3_600_000;
  return ageHours < 1 ? "under1h" : ageHours < 6 ? "1to6h" : ageHours < 24 ? "6to24h" : "over24h";
}
