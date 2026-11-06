import { abortAtHostedRecoveryDeadline, HOSTED_RECOVERY_BUDGET_MS, runHostedRecoveryBatch } from "../hosted-orchestration/recovery-batch";
import { getPrisma } from "../prisma";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { preflightHostedScheduledReconcile } from "./scheduled-reconcile-preflight";
import {
  appendHostedDeviceSyncScheduledReconcileWake,
  buildHostedDeviceSyncScheduledReconcileWakeEventId,
} from "./wake-service";

const DEFAULT_WAKE_LIMIT = 100;
const DUE_RECONCILE_WAKE_BUCKET_MS = 5 * 60_000;
const MAX_WAKE_LIMIT = 250;
// Probes stop first so each candidate they skip or cancel can still get its ordinary wake.
const PROBE_WAKE_RESERVE_MS = 6_000;
const BENIGN_WAKE_SKIP_REASONS = new Set<string | undefined>([
  "health_data_consent_withdrawn", "schedule_superseded",
]);

export interface HostedDeviceSyncDueReconcileSweeperResult {
  dueConnections: number;
  wakeAccepted: number;
  wakeAttempted: number;
  wakeFailed: number;
  wakeLimit: number;
  wakeNotAccepted: number;
  hasMoreDueConnections: boolean;
}

type HostedDeviceSyncDueReconcileSweeperLogger = Pick<Console, "info" | "warn">;
type HostedDeviceSyncScheduledReconcileWakeRequest =
  typeof appendHostedDeviceSyncScheduledReconcileWake;

export async function runHostedDeviceSyncDueReconcileSweeper(input: {
  deadlineMs?: number;
  logger?: HostedDeviceSyncDueReconcileSweeperLogger;
  now?: Date;
  requestWake?: HostedDeviceSyncScheduledReconcileWakeRequest;
  preflight?: typeof preflightHostedScheduledReconcile;
  store?: Pick<PrismaDeviceSyncControlPlaneStore, "listDueReconcileConnectionsForSweep">;
  wakeLimit?: number;
} = {}): Promise<HostedDeviceSyncDueReconcileSweeperResult> {
  const deadlineMs = input.deadlineMs ?? Date.now() + HOSTED_RECOVERY_BUDGET_MS;
  const stop = abortAtHostedRecoveryDeadline(deadlineMs);
  const logger = input.logger ?? console;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const wakeBucketStartedAt = new Date(
    Math.floor(now.getTime() / DUE_RECONCILE_WAKE_BUCKET_MS) * DUE_RECONCILE_WAKE_BUCKET_MS,
  );
  const wakeBucketStartedAtIso = wakeBucketStartedAt.toISOString();
  const wakeLimit = normalizeLimit(input.wakeLimit, DEFAULT_WAKE_LIMIT, MAX_WAKE_LIMIT);
  const store = input.store ?? new PrismaDeviceSyncControlPlaneStore({
    prisma: getPrisma(),
  });
  const requestWake = input.requestWake ?? appendHostedDeviceSyncScheduledReconcileWake;
  const dueConnections = await store.listDueReconcileConnectionsForSweep({
    dueAt: now,
    limit: wakeLimit + 1,
    recoveryBucketStartedAt: wakeBucketStartedAt,
  });
  const selectedDueConnections = dueConnections.slice(0, wakeLimit);
  let hasMoreDueConnections = dueConnections.length > selectedDueConnections.length;

  logger.info("Hosted device-sync due reconcile sweeper scanned due connections.", {
    dueAt: nowIso,
    dueConnections: dueConnections.length,
    wakeBucketStartedAt: wakeBucketStartedAtIso,
    wakeLimit,
    selectedDueConnections: selectedDueConnections.length,
    hasMoreDueConnections,
    orphanedDirtyRecoveryCount: selectedDueConnections.filter(
      (connection) => connection.orphanedDirtyRecoveryKey !== undefined,
    ).length,
  });

  let wakeAccepted = 0;
  let wakeAttempted = 0;
  let wakeFailed = 0;
  let wakeNotAccepted = 0;
  const preflightTotals = {
    attempted: 0, eligible: 0, avoidedWakes: 0, logicalCollectionReads: 0,
    decodedRecordCount: 0, decodedRecordBytes: 0, elapsedMs: 0,
    reasons: {} as Record<string, number>,
    webhookAgeOutcomes: {} as Record<string, number>,
  };

  const countPreflightReason = (reason: string) => {
    preflightTotals.reasons[reason] = (preflightTotals.reasons[reason] ?? 0) + 1;
  };

  const stopProbes = abortAtHostedRecoveryDeadline(deadlineMs - PROBE_WAKE_RESERVE_MS);
  const unstarted = await runHostedRecoveryBatch(
    selectedDueConnections,
    async (dueConnection) => {
      const canProbe = dueConnection.provider === "junction"
        && dueConnection.orphanedDirtyRecoveryKey === undefined;
      if (canProbe && stopProbes.aborted) {
        countPreflightReason("budget_exhausted");
      } else if (canProbe) {
        preflightTotals.attempted += 1;
        try {
          const probe = await (input.preflight ?? preflightHostedScheduledReconcile)({ connection: dueConnection, now, signal: stopProbes });
          preflightTotals.eligible += Number(probe.outcome !== "ineligible");
          preflightTotals.logicalCollectionReads += probe.requestCount;
          preflightTotals.decodedRecordCount += probe.recordCount;
          preflightTotals.decodedRecordBytes += probe.responseBytes;
          preflightTotals.elapsedMs += probe.elapsedMs;
          const webhookAgeOutcome = `${probe.webhookAgeBucket ?? "unavailable"}:${probe.outcome}`;
          preflightTotals.webhookAgeOutcomes[webhookAgeOutcome] = (preflightTotals.webhookAgeOutcomes[webhookAgeOutcome] ?? 0) + 1;
          const reason = /^[a-z_]{1,64}$/.test(probe.reason) ? probe.reason : "other";
          countPreflightReason(reason);
          if (probe.outcome === "unchanged" && probe.wakeAvoided) {
            preflightTotals.avoidedWakes += 1;
            return;
          }
        } catch {
          // No provider payload or raw error crosses the aggregate log boundary.
          const reason = stopProbes.aborted ? "budget_exhausted" : "failed";
          countPreflightReason(reason);
        }
      }
      if (stop.aborted) return;
      wakeAttempted += 1;

      let wake;
      try {
        wake = await requestWake({
          abortSignal: stop,
          connectionId: dueConnection.connectionId,
          createdAt: nowIso,
          eventId: [
            buildHostedDeviceSyncScheduledReconcileWakeEventId({
              connectionId: dueConnection.connectionId,
              expectedConnectedAt: dueConnection.connectedAt,
              nextReconcileAt: dueConnection.nextReconcileAt,
            }),
            // Reuse the scheduled sweep only after the durable mailbox proves
            // no work owner remains. Bind recovery to the consumed lane
            // frontier so unrelated checkpoints cannot create extra wakes.
            ...(dueConnection.orphanedDirtyRecoveryKey
              ? ["dirty-recovery", dueConnection.orphanedDirtyRecoveryKey]
              : []),
          ].join(":"),
          expectedConnectedAt: dueConnection.connectedAt,
          nextReconcileAt: dueConnection.nextReconcileAt,
          provider: dueConnection.provider,
          traceId: null,
          userId: dueConnection.userId,
        });
      } catch (error) {
        if (stop.aborted) return;
        wakeFailed += 1;
        wakeNotAccepted += 1;
        logger.warn("Hosted device-sync due reconcile sweeper wake request failed.", {
          ...formatHostedExecutionSafeLogErrorDetails(error, {
            code: "HOSTED_DEVICE_SYNC_DUE_RECONCILE_WAKE_REQUEST_FAILED",
          }),
        });
        return;
      }

      if (wake.wakeAccepted) {
        wakeAccepted += 1;
        return;
      }

      wakeNotAccepted += 1;
      if (BENIGN_WAKE_SKIP_REASONS.has(wake.reason)) {
        logger.info("Hosted device-sync due reconcile wake skipped before mailbox append.", {
          reason: wake.reason,
        });
        return;
      }

      wakeFailed += 1;
      logger.warn("Hosted device-sync due reconcile sweeper wake was not accepted.", {
        errorCode: "HOSTED_DEVICE_SYNC_DUE_RECONCILE_WAKE_NOT_ACCEPTED",
        errorMessage: "Hosted device-sync due reconcile sweeper wake was not accepted.",
        reason: wake.reason ?? null,
      });
    },
    true,
    stop,
  );
  hasMoreDueConnections ||= unstarted > 0;

  if (hasMoreDueConnections) {
    logger.warn("Hosted device-sync due reconcile sweeper has more due connections after its wake limit or deadline.", {
      wakeLimit,
      hasMoreDueConnections,
    });
  }

  logger.info("Hosted device-sync due reconcile sweeper finished.", {
    dueConnections: dueConnections.length,
    wakeAccepted,
    wakeAttempted,
    wakeFailed,
    wakeLimit,
    wakeNotAccepted,
    hasMoreDueConnections,
    preflight: preflightTotals,
  });

  return {
    dueConnections: dueConnections.length,
    wakeAccepted,
    wakeAttempted,
    wakeFailed,
    wakeLimit,
    wakeNotAccepted,
    hasMoreDueConnections,
  };
}

function normalizeLimit(value: number | null | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(value), max));
}
