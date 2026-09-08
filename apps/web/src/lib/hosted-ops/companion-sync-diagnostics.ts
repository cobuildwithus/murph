import "server-only";

import type { PrismaClient } from "@prisma/client";
import { COMPANION_SYNC_DIAGNOSTIC_EVENT } from "../device-sync/companion-sync-diagnostics";
import { listHostedRuntimeLogs } from "../hosted-runtime-log/store";

/** Bounded operator projection; client observations and durable receipts stay separate. */
export async function readHostedOpsCompanionSyncDiagnostics(input: {
  memberId: string;
  prisma: PrismaClient;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const connections = await input.prisma.deviceConnection.findMany({
    where: { userId: input.memberId, provider: "junction" },
    orderBy: { connectedAt: "desc" },
    take: 10,
    select: {
      id: true, status: true, connectedAt: true, lastWebhookAt: true,
      lastSyncStartedAt: true, lastSyncCompletedAt: true, lastErrorCode: true,
      sources: {
        where: { sourceProviderSlug: "apple_health_kit" },
        take: 10,
        orderBy: { lastSeenAt: "desc" },
        select: { status: true, lastSeenAt: true, lastDataAt: true, lastErrorCode: true },
      },
      dirtyState: {
        select: { dirtyRevision: true, processedRevision: true, firstDirtyAt: true, latestDirtyAt: true },
      },
    },
  });
  const signals = await input.prisma.deviceSyncSignal.findMany({
    where: {
      userId: input.memberId,
      connectionId: { in: connections.map((connection) => connection.id) },
      sourceProviderSlug: "apple_health_kit",
      kind: { in: ["webhook_hint", "canonical_import"] },
      createdAt: { gte: from },
    },
    orderBy: { id: "desc" },
    take: 300,
    select: { kind: true, createdAt: true, occurredAt: true },
  });
  let lastSourceDataAt: Date | null = null;
  let lastWebhookHintReceivedAt: Date | null = null;
  let lastCanonicalImportCompletedAt: Date | null = null;
  for (const signal of signals) {
    if (signal.kind === "canonical_import") {
      lastCanonicalImportCompletedAt = later(lastCanonicalImportCompletedAt, signal.occurredAt ?? signal.createdAt);
    } else {
      lastWebhookHintReceivedAt = later(lastWebhookHintReceivedAt, signal.createdAt);
    }
  }
  // The projection retains source arrival beyond the bounded receipt window.
  for (const connection of connections) {
    for (const source of connection.sources) {
      lastSourceDataAt = later(lastSourceDataAt, source.lastDataAt);
    }
  }
  let observations;
  try {
    observations = {
      status: "available" as const,
      entries: (await listHostedRuntimeLogs({
        userId: input.memberId, eventCode: COMPANION_SYNC_DIAGNOSTIC_EVENT, from, limit: 50,
      })).map(({ at, redactedJson }) => ({ receivedAt: at, observation: redactedJson })),
    };
  } catch {
    observations = { status: "unavailable" as const, entries: [] };
  }
  return {
    observedAt: now.toISOString(),
    windowStart: from.toISOString(),
    lastSourceDataAt,
    lastWebhookHintReceivedAt,
    lastCanonicalImportCompletedAt,
    receiptLimitReached: signals.length === 300,
    connectionLimitReached: connections.length === 10,
    connections: connections.map(({ id: _id, dirtyState, ...connection }) => ({
      ...connection,
      pendingRevisions: dirtyState ? (dirtyState.dirtyRevision - dirtyState.processedRevision).toString() : "0",
      firstDirtyAt: dirtyState?.firstDirtyAt ?? null,
      latestDirtyAt: dirtyState?.latestDirtyAt ?? null,
    })),
    observations,
    observationLimitReached: observations.entries.length === 50,
  };
}

function later(first: Date | null, second: Date | null): Date | null {
  return !second || (first && first >= second) ? first : second;
}
