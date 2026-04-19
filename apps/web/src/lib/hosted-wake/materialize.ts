import type {
  HostedExecutionAssistantCronTickEvent,
  HostedExecutionWake,
  HostedWakeMaterializationHints,
  HostedWakeMaterializeResponse,
} from "@murphai/hosted-execution/contracts";

import { buildHostedDeviceSyncWake } from "../device-sync/wake";
import { appendHostedExecutionWakePayloadTx } from "./queue";

type HostedWakeMaterializeTx = {
  deviceConnection: {
    findFirst(args: {
      orderBy: Array<
        { id: "asc" | "desc" }
        | { nextReconcileAt: "asc" | "desc" }
        | { updatedAt: "asc" | "desc" }
      >;
      select: {
        nextReconcileAt: true;
      };
      where: {
        nextReconcileAt: {
          gt: Date;
        };
        status: "active";
        userId: string;
      };
    }): Promise<{
      nextReconcileAt: Date | null;
    } | null>;
    findMany(args: {
      orderBy: Array<
        { id: "asc" | "desc" }
        | { nextReconcileAt: "asc" | "desc" }
        | { updatedAt: "asc" | "desc" }
      >;
      select: {
        id: true;
        nextReconcileAt: true;
        provider: true;
      };
      where: {
        nextReconcileAt: {
          lte: Date;
        };
        status: "active";
        userId: string;
      };
    }): Promise<Array<{
      id: string;
      nextReconcileAt: Date | null;
      provider: string;
    }>>;
  };
  hostedExecutionCursor: {
    upsert(args: {
      create: {
        userId: string;
      };
      update: Record<string, never>;
      where: {
        userId: string;
      };
    }): Promise<{
      assistantNextWakeAt: Date | null;
      committedSeq: bigint;
      createdAt: Date;
      nextSeq: bigint;
      snapshotRef: unknown;
      updatedAt: Date;
      userId: string;
      version: bigint;
    }>;
  };
};

type HostedWakeAppendResult = Awaited<ReturnType<typeof appendHostedExecutionWakePayloadTx>>;

export async function materializeHostedDueWakesTx(input: {
  appendAssistantCronWake: (input: {
    occurredAt: string;
    reason: HostedExecutionAssistantCronTickEvent["reason"];
    userId: string;
  }) => Promise<HostedWakeAppendResult>;
  appendWakePayload: (input: {
    wake: HostedExecutionWake;
  }) => Promise<HostedWakeAppendResult>;
  now?: Date;
  tx: HostedWakeMaterializeTx;
  userId: string;
}): Promise<HostedWakeMaterializeResponse> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const cursor = await input.tx.hostedExecutionCursor.upsert({
    where: {
      userId: input.userId,
    },
    create: {
      userId: input.userId,
    },
    update: {},
  });
  const assistantNextWakeAt = cursor.assistantNextWakeAt?.toISOString() ?? null;
  let targetSeqHint: bigint | null = null;

  if (isRunnableWakeHint(assistantNextWakeAt, now)) {
    const appended = await input.appendAssistantCronWake({
      occurredAt: nowIso,
      reason: "alarm",
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
    const appended = await input.appendWakePayload({
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
      assistantWakeAt: isRunnableWakeHint(assistantNextWakeAt, now)
        ? null
        : assistantNextWakeAt,
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
