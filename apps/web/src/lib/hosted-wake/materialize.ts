import type { Prisma } from "@prisma/client";
import type {
  HostedWakeMaterializationHints,
  HostedWakeMaterializeResponse,
} from "@murphai/hosted-execution/contracts";

import { buildHostedDeviceSyncWake } from "../device-sync/wake";
import { materializeHostedAssistantCronWakeTx, appendHostedExecutionWakePayloadTx } from "./queue";

type HostedWakeMaterializeTx = Pick<Prisma.TransactionClient, "deviceConnection">;

export async function materializeHostedDueWakesTx(input: {
  now?: Date;
  tx: HostedWakeMaterializeTx;
  userId: string;
  wakeMaterializationHints?: HostedWakeMaterializationHints | null;
}): Promise<HostedWakeMaterializeResponse> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const nextHints = normalizeHostedWakeMaterializationHints(input.wakeMaterializationHints ?? null);
  let targetSeqHint: bigint | null = null;

  if (isRunnableWakeHint(nextHints?.assistantWakeAt ?? null, now)) {
    const appended = await materializeHostedAssistantCronWakeTx({
      occurredAt: nowIso,
      reason: "alarm",
      tx: input.tx,
      userId: input.userId,
    });
    targetSeqHint = maxHostedWakeSeq(targetSeqHint, appended.wake.seq);
  }

  const dueConnections = await input.tx.deviceConnection.findMany({
    where: {
      nextReconcileAt: {
        lte: now,
      },
      status: "active",
      userId: input.userId,
    },
    orderBy: [
      { nextReconcileAt: "asc" },
      { updatedAt: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      nextReconcileAt: true,
      provider: true,
    },
  });

  for (const connection of dueConnections) {
    const appended = await appendHostedExecutionWakePayloadTx({
      tx: input.tx,
      wake: buildHostedDeviceSyncWake({
        connectionId: connection.id,
        hint: {
          nextReconcileAt: connection.nextReconcileAt?.toISOString() ?? null,
          occurredAt: nowIso,
          reason: "scheduled-reconcile",
        },
        occurredAt: nowIso,
        provider: connection.provider,
        source: "scheduled-reconcile",
        traceId: connection.nextReconcileAt?.toISOString() ?? nowIso,
        userId: input.userId,
      }),
    });
    targetSeqHint = maxHostedWakeSeq(targetSeqHint, appended.wake.seq);
  }

  const nextDeviceSyncWakeAt = await input.tx.deviceConnection.findFirst({
    where: {
      nextReconcileAt: {
        gt: now,
      },
      status: "active",
      userId: input.userId,
    },
    orderBy: [
      { nextReconcileAt: "asc" },
      { updatedAt: "asc" },
      { id: "asc" },
    ],
    select: {
      nextReconcileAt: true,
    },
  });

  return {
    targetSeqHint: targetSeqHint?.toString() ?? null,
    wakeMaterializationHints: normalizeHostedWakeMaterializationHints({
      assistantWakeAt: isRunnableWakeHint(nextHints?.assistantWakeAt ?? null, now)
        ? null
        : nextHints?.assistantWakeAt ?? null,
      deviceSyncWakeAt: nextDeviceSyncWakeAt?.nextReconcileAt?.toISOString() ?? null,
    }),
  };
}

function normalizeHostedWakeMaterializationHints(
  value: HostedWakeMaterializationHints | null,
): HostedWakeMaterializationHints | null {
  if (!value) {
    return null;
  }

  const hints: HostedWakeMaterializationHints = {
    ...(value.assistantWakeAt === undefined
      ? {}
      : { assistantWakeAt: normalizeHostedWakeHintTimestamp(value.assistantWakeAt) }),
    ...(value.deviceSyncWakeAt === undefined
      ? {}
      : { deviceSyncWakeAt: normalizeHostedWakeHintTimestamp(value.deviceSyncWakeAt) }),
  };

  return Object.keys(hints).length > 0 ? hints : null;
}

function normalizeHostedWakeHintTimestamp(value: string | null | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

function isRunnableWakeHint(value: string | null, now: Date): boolean {
  if (!value) {
    return false;
  }

  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) && parsedMs <= now.getTime();
}

function maxHostedWakeSeq(current: bigint | null, candidate: string): bigint {
  const parsed = BigInt(candidate);
  return current === null || parsed > current ? parsed : current;
}
