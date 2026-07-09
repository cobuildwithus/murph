import "server-only";

import { randomUUID } from "node:crypto";

import {
  mergeHostedRuntimeLatencyPhaseBreakdownJson,
  readHostedIngressLatencySource,
  type HostedIngressLatencySource,
  type HostedRuntimeLatencyPhaseBreakdown,
  type HostedRuntimeLatencyPhaseBreakdownPhase,
  type HostedRuntimeLatencyTraceMilestone,
} from "@murphai/hosted-execution/runtime-control";
import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

type HostedIngressLatencyPrismaReadClient = {
  hostedIngressLatencyTrace: Pick<PrismaClient["hostedIngressLatencyTrace"], "findMany">;
  hostedRuntimeLog: Pick<PrismaClient["hostedRuntimeLog"], "findMany">;
};

type HostedIngressLatencyPrismaClient = Pick<
  PrismaClient,
  "$executeRaw" | "$queryRaw" | "$transaction" | "hostedIngressLatencyTrace"
>;

type HostedIngressLatencyPrismaTransactionClient = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "hostedIngressLatencyTrace"
>;

type HostedIngressLatencyTraceRow = Awaited<
  ReturnType<PrismaClient["hostedIngressLatencyTrace"]["findUnique"]>
>;

type HostedIngressLatencyRuntimeMilestoneField =
  | "runnerJobAcceptedAt"
  | "runtimePhaseStartedAt"
  | "workspaceRestoreDoneAt"
  | "mailboxImportDoneAt";

const HOSTED_INGRESS_LATENCY_DEFAULT_WINDOW_HOURS = 24;
const HOSTED_INGRESS_LATENCY_MAX_WINDOW_HOURS = 24 * 7;
const HOSTED_INGRESS_LATENCY_DEFAULT_SLOW_LIMIT = 20;
const HOSTED_INGRESS_LATENCY_MAX_SLOW_LIMIT = 100;
const HOSTED_INGRESS_LATENCY_IN_FLIGHT_GRACE_MS = 2 * 60_000;
const HOSTED_INGRESS_LATENCY_READ_ROW_LIMIT = 20_000;
const HOSTED_INGRESS_LATENCY_TIMING_LOG_READ_LIMIT = 100_000;

export interface HostedIngressLatencyWriteResult {
  matchedCount: number;
  recorded: boolean;
  unmatchedCount: number;
}

export interface HostedIngressLatencyDashboardInput {
  inFlightGraceMs?: number | null;
  limit?: number | null;
  now?: Date | null;
  prisma?: HostedIngressLatencyPrismaReadClient;
  source?: HostedIngressLatencySource | string | null;
  windowHours?: number | null;
}

export interface HostedIngressLatencyDashboardSlowRow {
  acceptedAt: string;
  acceptedToProviderStartMs: number;
  acceptedToStagedMs: number | null;
  acceptedToTemporalSignalMs: number | null;
  rowLabel: string;
  stagedToProviderStartMs: number | null;
}

export interface HostedIngressLatencyDistribution {
  count: number;
  p50: number | null;
  p95: number | null;
}

export interface HostedIngressLatencyDashboard {
  completedCount: number;
  invalidNegativeLatencyCount: number;
  missingProviderStartCount: number;
  missingStagedCount: number;
  percentileMs: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  readLimit: number;
  recentInFlightCount: number;
  recentSlowRows: HostedIngressLatencyDashboardSlowRow[];
  source: HostedIngressLatencySource;
  stageLatencyMs: {
    acceptedToStagedP50: number | null;
    acceptedToTemporalSignalP50: number | null;
    stagedToProviderStartP50: number | null;
  };
  linqEgressGuardMs: {
    p50: number | null;
    p95: number | null;
  };
  replyLatencyMs: {
    acceptedToLinqAccepted: HostedIngressLatencyDistribution;
    acceptedToLinqDelivered: HostedIngressLatencyDistribution;
    coldAcceptedToLinqAccepted: HostedIngressLatencyDistribution;
    linqAcceptedToDelivered: HostedIngressLatencyDistribution;
    linqAttemptedToAccepted: HostedIngressLatencyDistribution;
    providerRequest: HostedIngressLatencyDistribution;
    providerResultToReplyIntent: HostedIngressLatencyDistribution;
    providerStartToLinqAttempted: HostedIngressLatencyDistribution;
    replyIntentToLinqAttempted: HostedIngressLatencyDistribution;
    warmAcceptedToLinqAccepted: HostedIngressLatencyDistribution;
  };
  replyTraceQuality: {
    acceptedMissingReceiptCount: number;
    ambiguousTimingCount: number;
    attemptMismatchCount: number;
    invalidNegativeLatencyCount: number;
    linkedDeliveryCount: number;
    missingAcceptedDeliveryCount: number;
    providerRowsWithoutAcceptedDeliveryLinkCount: number;
    timingLogTruncated: boolean;
    unknownColdStateCount: number;
  };
  stagedButMissingProviderCount: number;
  totalAcceptedCount: number;
  truncated: boolean;
  window: {
    end: string;
    hours: number;
    start: string;
  };
}

export async function recordHostedIngressAcceptedFromMailboxItem(input: {
  mailboxItemId: string;
  prisma?: HostedIngressLatencyPrismaClient;
  source: HostedIngressLatencySource | string;
}): Promise<HostedIngressLatencyWriteResult> {
  const prisma = input.prisma ?? getPrisma();
  const source = normalizeHostedIngressLatencySource(input.source);
  const mailboxItem = await readTraceMailboxItem(prisma, {
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItem) {
    return { matchedCount: 0, recorded: false, unmatchedCount: 1 };
  }

  await upsertHostedIngressLatencyTraceFromMailboxItem(prisma, {
    mailboxItem,
    source,
  });

  return { matchedCount: 1, recorded: true, unmatchedCount: 0 };
}

export async function recordHostedIngressTemporalSignalAccepted(input: {
  at?: Date | string | null;
  expectedUserId?: string | null;
  mailboxItemId: string;
  prisma?: HostedIngressLatencyPrismaClient;
  source: HostedIngressLatencySource | string;
}): Promise<HostedIngressLatencyWriteResult> {
  const prisma = input.prisma ?? getPrisma();
  const source = normalizeHostedIngressLatencySource(input.source);
  const at = normalizeDate(input.at, "Hosted ingress latency temporal signal at");
  const mailboxItem = await readTraceMailboxItem(prisma, {
    expectedUserId: input.expectedUserId ?? null,
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItem) {
    return { matchedCount: 0, recorded: false, unmatchedCount: 1 };
  }

  const trace = await upsertHostedIngressLatencyTraceFromMailboxItem(prisma, {
    mailboxItem,
    source,
  });
  await updateHostedIngressLatencyTraceEarliestMilestone(prisma, {
    at,
    field: "temporalSignalAcceptedAt",
    trace,
  });

  return { matchedCount: 1, recorded: true, unmatchedCount: 0 };
}

export async function recordHostedIngressDirectEnsureTiming(input: {
  expectedUserId?: string | null;
  mailboxItemId: string;
  phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown;
  prisma?: HostedIngressLatencyPrismaClient;
  source: HostedIngressLatencySource | string;
}): Promise<HostedIngressLatencyWriteResult> {
  const prisma = input.prisma ?? getPrisma();
  const source = normalizeHostedIngressLatencySource(input.source);
  const mailboxItem = await readTraceMailboxItem(prisma, {
    expectedUserId: input.expectedUserId ?? null,
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItem) {
    return { matchedCount: 0, recorded: false, unmatchedCount: 1 };
  }

  const trace = await upsertHostedIngressLatencyTraceFromMailboxItem(prisma, {
    mailboxItem,
    source,
  });
  const recorded = await updateHostedIngressLatencyTracePhaseBreakdownLocked(prisma, {
    phaseBreakdown: input.phaseBreakdown,
    phases: ["orchestration"],
    traceId: trace.id,
  });

  return { matchedCount: 1, recorded, unmatchedCount: 0 };
}

export async function recordHostedIngressAssistantInputStaged(input: {
  assistantInputId: string;
  at?: Date | string | null;
  authenticatedUserId: string;
  mailboxItemId: string;
  phaseBreakdown?: HostedRuntimeLatencyPhaseBreakdown | null;
  prisma?: HostedIngressLatencyPrismaClient;
  runnerJobAcceptedAt?: Date | string | null;
  runtimeAttemptId?: string | null;
  runtimePhaseStartedAt?: Date | string | null;
  source: HostedIngressLatencySource | string;
  workspaceRestoreDoneAt?: Date | string | null;
}): Promise<HostedIngressLatencyWriteResult> {
  const prisma = input.prisma ?? getPrisma();
  const source = normalizeHostedIngressLatencySource(input.source);
  const at = normalizeDate(input.at, "Hosted ingress latency assistant input staged at");
  const runnerJobAcceptedAt = normalizeOptionalDate(
    input.runnerJobAcceptedAt,
    "Hosted ingress latency runner job accepted at",
  );
  const runtimePhaseStartedAt = normalizeOptionalDate(
    input.runtimePhaseStartedAt,
    "Hosted ingress latency runtime phase started at",
  );
  const workspaceRestoreDoneAt = normalizeOptionalDate(
    input.workspaceRestoreDoneAt,
    "Hosted ingress latency workspace restore done at",
  );
  const assistantInputId = requireSafeLatencyIdentifier(
    input.assistantInputId,
    "Hosted ingress latency assistantInputId",
  );
  const runtimeAttemptId = normalizeNullableLatencyIdentifier(input.runtimeAttemptId);
  const mailboxItem = await readTraceMailboxItem(prisma, {
    expectedUserId: input.authenticatedUserId,
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItem) {
    return { matchedCount: 0, recorded: false, unmatchedCount: 1 };
  }

  const trace = await upsertHostedIngressLatencyTraceFromMailboxItem(prisma, {
    mailboxItem,
    source,
  });

  if (
    trace.assistantInputId
    && trace.assistantInputId !== assistantInputId
  ) {
    return { matchedCount: 1, recorded: false, unmatchedCount: 0 };
  }
  if (
    trace.runtimeAttemptId
    && runtimeAttemptId
    && trace.runtimeAttemptId !== runtimeAttemptId
  ) {
    return { matchedCount: 1, recorded: false, unmatchedCount: 0 };
  }

  const recorded = await updateHostedIngressAssistantInputStagedLocked(prisma, {
    assistantInputId,
    at,
    phaseBreakdown: input.phaseBreakdown,
    restoreMilestones: {
      runnerJobAcceptedAt,
      runtimePhaseStartedAt,
      workspaceRestoreDoneAt,
    },
    runtimeAttemptId,
    traceId: trace.id,
  });

  return { matchedCount: 1, recorded, unmatchedCount: 0 };
}

export async function recordHostedIngressProviderStarted(input: {
  assistantInputIds: readonly string[];
  at?: Date | string | null;
  authenticatedUserId: string;
  phaseBreakdown?: HostedRuntimeLatencyPhaseBreakdown | null;
  prisma?: HostedIngressLatencyPrismaClient;
  providerRequestOrdinal: number;
  runtimeAttemptId?: string | null;
  source: HostedIngressLatencySource | string;
}): Promise<HostedIngressLatencyWriteResult> {
  const prisma = input.prisma ?? getPrisma();
  const source = normalizeHostedIngressLatencySource(input.source);
  const at = normalizeDate(input.at, "Hosted ingress latency provider start at");
  const assistantInputIds = [
    ...new Set(input.assistantInputIds.map((id) =>
      requireSafeLatencyIdentifier(id, "Hosted ingress latency assistantInputId")
    )),
  ];
  const providerRequestOrdinal = normalizeProviderRequestOrdinal(input.providerRequestOrdinal);
  const runtimeAttemptId = normalizeNullableLatencyIdentifier(input.runtimeAttemptId);

  if (assistantInputIds.length === 0) {
    return { matchedCount: 0, recorded: false, unmatchedCount: 0 };
  }

  const rows = await prisma.hostedIngressLatencyTrace.findMany({
    select: {
      assistantInputId: true,
      id: true,
    },
    where: {
      assistantInputId: {
        in: assistantInputIds,
      },
      source,
      userId: input.authenticatedUserId,
    },
  });
  const rowMatches = await Promise.all(rows.map(async (row) => ({
    assistantInputId: row.assistantInputId,
    matched: await updateHostedIngressProviderStartedLocked(prisma, {
      at,
      phaseBreakdown: input.phaseBreakdown,
      providerRequestOrdinal,
      runtimeAttemptId,
      traceId: row.id,
    }),
  })));
  const matchedIds = new Set(rowMatches
    .filter((row) => row.matched)
    .map((row) => row.assistantInputId)
    .filter((id): id is string => Boolean(id)));

  return {
    matchedCount: matchedIds.size,
    recorded: matchedIds.size > 0,
    unmatchedCount: assistantInputIds.filter((id) => !matchedIds.has(id)).length,
  };
}

export async function recordHostedIngressRuntimeMilestone(input: {
  at?: Date | string | null;
  authenticatedUserId: string;
  milestone: HostedRuntimeLatencyTraceMilestone;
  prisma?: HostedIngressLatencyPrismaClient;
  runtimeAttemptId?: string | null;
  source: HostedIngressLatencySource | string;
}): Promise<HostedIngressLatencyWriteResult> {
  const prisma = input.prisma ?? getPrisma();
  const source = normalizeHostedIngressLatencySource(input.source);
  const at = normalizeDate(input.at, "Hosted ingress latency runtime milestone at");
  const runtimeAttemptId = normalizeNullableLatencyIdentifier(input.runtimeAttemptId);
  const userId = requireSafeLatencyIdentifier(
    input.authenticatedUserId,
    "Hosted ingress latency userId",
  );

  if (!runtimeAttemptId) {
    return {
      matchedCount: 0,
      recorded: false,
      unmatchedCount: 0,
    };
  }

  const matchedCount = await updateHostedIngressLatencyRuntimeMilestone(prisma, {
    at,
    milestone: input.milestone,
    runtimeAttemptId,
    source,
    userId,
  });

  return {
    matchedCount,
    recorded: matchedCount > 0,
    unmatchedCount: 0,
  };
}

export async function readHostedIngressLatencyDashboard(
  input: HostedIngressLatencyDashboardInput = {},
): Promise<HostedIngressLatencyDashboard> {
  const prisma = input.prisma ?? getPrisma();
  const source = normalizeHostedIngressLatencySource(input.source ?? "linq");
  const now = input.now ?? new Date();
  const windowHours = normalizeDashboardWindowHours(input.windowHours);
  const limit = normalizeDashboardSlowLimit(input.limit);
  const inFlightGraceMs = normalizeDashboardInFlightGraceMs(input.inFlightGraceMs);
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60_000);
  const inFlightCutoff = new Date(now.getTime() - inFlightGraceMs);
  const rows = await prisma.hostedIngressLatencyTrace.findMany({
    orderBy: {
      acceptedAt: "desc",
    },
    select: {
      acceptedAt: true,
      assistantInputStagedAt: true,
      linqDeliveryId: true,
      linqDelivery: {
        select: {
          acceptedAt: true,
          attemptedAt: true,
          deliveredAt: true,
        },
      },
      phaseBreakdownJson: true,
      providerRequestOrdinal: true,
      providerStartAt: true,
      replyRuntimeAttemptId: true,
      runtimeAttemptId: true,
      temporalSignalAcceptedAt: true,
    },
    take: HOSTED_INGRESS_LATENCY_READ_ROW_LIMIT + 1,
    where: {
      acceptedAt: {
        gte: windowStart,
        lte: now,
      },
      source,
    },
  });
  const truncated = rows.length > HOSTED_INGRESS_LATENCY_READ_ROW_LIMIT;
  const visibleRows = truncated ? rows.slice(0, HOSTED_INGRESS_LATENCY_READ_ROW_LIMIT) : rows;
  const runtimeAttemptIds = source === "linq"
    ? [...new Set(visibleRows
        .map((row) => row.runtimeAttemptId)
        .filter((id): id is string => Boolean(id)))]
    : [];
  const timingLogRows = runtimeAttemptIds.length === 0
    ? []
    : await prisma.hostedRuntimeLog.findMany({
        orderBy: { at: "asc" },
        select: {
          attemptId: true,
          redactedJson: true,
        },
        take: HOSTED_INGRESS_LATENCY_TIMING_LOG_READ_LIMIT + 1,
        where: {
          attemptId: { in: runtimeAttemptIds },
          eventCode: "assistant.automation_detail",
        },
      });
  const timingLogTruncated =
    timingLogRows.length > HOSTED_INGRESS_LATENCY_TIMING_LOG_READ_LIMIT;
  const turnTimingIndex = buildHostedTurnTimingIndex(
    timingLogTruncated
      ? timingLogRows.slice(0, HOSTED_INGRESS_LATENCY_TIMING_LOG_READ_LIMIT)
      : timingLogRows,
  );
  const completedDurations: number[] = [];
  const acceptedToSignalDurations: number[] = [];
  const acceptedToStagedDurations: number[] = [];
  const linqEgressGuardDurations: number[] = [];
  const stagedToProviderDurations: number[] = [];
  const recentSlowRows: HostedIngressLatencyDashboardSlowRow[] = [];
  let invalidNegativeLatencyCount = 0;
  let missingStagedCount = 0;
  let missingProviderStartCount = 0;
  let recentInFlightCount = 0;
  let stagedButMissingProviderCount = 0;
  let providerRowsWithoutAcceptedDeliveryLinkCount = 0;
  let attemptMismatchCount = 0;

  for (const row of visibleRows) {
    const acceptedAtMs = row.acceptedAt.getTime();
    const providerStartMs = row.providerStartAt?.getTime() ?? null;
    const stagedAtMs = row.assistantInputStagedAt?.getTime() ?? null;
    const signalAtMs = row.temporalSignalAcceptedAt?.getTime() ?? null;
    const linqEgressGuardMs = readHostedIngressLatencyPhaseBreakdownNumber(
      row.phaseBreakdownJson,
      "provider",
      "linqEgressGuardMs",
    );
    if (linqEgressGuardMs !== null) {
      linqEgressGuardDurations.push(linqEgressGuardMs);
    }
    const mature = row.acceptedAt <= inFlightCutoff;
    if (
      source === "linq"
      && mature
      && providerStartMs !== null
      && !row.linqDeliveryId
    ) {
      providerRowsWithoutAcceptedDeliveryLinkCount += 1;
    }
    if (
      row.linqDeliveryId
      && (
        !row.runtimeAttemptId
        || !row.replyRuntimeAttemptId
        || row.runtimeAttemptId !== row.replyRuntimeAttemptId
      )
    ) {
      attemptMismatchCount += 1;
    }
    const missingStaged = stagedAtMs === null;
    const hasNegativeSignal = signalAtMs !== null && signalAtMs < acceptedAtMs;
    const hasNegativeStaged = stagedAtMs !== null && stagedAtMs < acceptedAtMs;
    const hasNegativeProviderWait =
      stagedAtMs !== null && providerStartMs !== null && providerStartMs < stagedAtMs;

    if (missingStaged && (mature || providerStartMs !== null)) {
      missingStagedCount += 1;
    }

    if (signalAtMs !== null && !hasNegativeSignal) {
      acceptedToSignalDurations.push(signalAtMs - acceptedAtMs);
    }
    if (stagedAtMs !== null && !hasNegativeStaged) {
      acceptedToStagedDurations.push(stagedAtMs - acceptedAtMs);
    }
    if (
      stagedAtMs !== null
      && providerStartMs !== null
      && !hasNegativeStaged
      && !hasNegativeProviderWait
    ) {
      stagedToProviderDurations.push(providerStartMs - stagedAtMs);
    }

    if (providerStartMs === null) {
      if (hasNegativeSignal || hasNegativeStaged) {
        invalidNegativeLatencyCount += 1;
      }
      if (mature) {
        missingProviderStartCount += 1;
        if (stagedAtMs !== null) {
          stagedButMissingProviderCount += 1;
        }
      } else {
        recentInFlightCount += 1;
      }
      continue;
    }

    const totalMs = providerStartMs - acceptedAtMs;
    const hasNegativeTotal = totalMs < 0;
    if (
      hasNegativeSignal
      || hasNegativeStaged
      || hasNegativeProviderWait
      || hasNegativeTotal
    ) {
      invalidNegativeLatencyCount += 1;
    }
    if (hasNegativeTotal) {
      continue;
    }

    completedDurations.push(totalMs);
    recentSlowRows.push({
      acceptedAt: row.acceptedAt.toISOString(),
      acceptedToProviderStartMs: totalMs,
      acceptedToStagedMs: stagedAtMs === null || stagedAtMs < acceptedAtMs
        ? null
        : stagedAtMs - acceptedAtMs,
      acceptedToTemporalSignalMs: signalAtMs === null || signalAtMs < acceptedAtMs
        ? null
        : signalAtMs - acceptedAtMs,
      rowLabel: "",
      stagedToProviderStartMs: stagedAtMs === null || hasNegativeStaged || hasNegativeProviderWait
        ? null
        : providerStartMs - stagedAtMs,
    });
  }

  recentSlowRows.sort((left, right) =>
    right.acceptedToProviderStartMs - left.acceptedToProviderStartMs
  );

  const acceptedToLinqAcceptedDurations: number[] = [];
  const acceptedToLinqDeliveredDurations: number[] = [];
  const coldAcceptedToLinqAcceptedDurations: number[] = [];
  const linqAcceptedToDeliveredDurations: number[] = [];
  const linqAttemptedToAcceptedDurations: number[] = [];
  const providerRequestDurations: number[] = [];
  const providerResultToReplyIntentDurations: number[] = [];
  const providerStartToLinqAttemptedDurations: number[] = [];
  const replyIntentToLinqAttemptedDurations: number[] = [];
  const warmAcceptedToLinqAcceptedDurations: number[] = [];
  type DashboardRow = (typeof visibleRows)[number];
  type LinkedReplyDashboardRow = DashboardRow & {
    linqDelivery: NonNullable<DashboardRow["linqDelivery"]>;
    linqDeliveryId: string;
    replyRuntimeAttemptId: string;
    runtimeAttemptId: string;
  };
  const linkedRowsByDeliveryId = new Map<
    string,
    LinkedReplyDashboardRow[]
  >();
  let acceptedMissingReceiptCount = 0;
  let ambiguousTimingCount = 0;
  let invalidReplyNegativeLatencyCount = 0;
  let missingAcceptedDeliveryCount = 0;
  let unknownColdStateCount = 0;

  for (const row of visibleRows) {
    const deliveryId = row.linqDeliveryId;
    if (
      source !== "linq"
      || !deliveryId
      || !row.runtimeAttemptId
      || !row.replyRuntimeAttemptId
      || row.runtimeAttemptId !== row.replyRuntimeAttemptId
      || !row.linqDelivery
    ) {
      continue;
    }
    const linkedRow: LinkedReplyDashboardRow = {
      ...row,
      linqDelivery: row.linqDelivery,
      linqDeliveryId: deliveryId,
      replyRuntimeAttemptId: row.replyRuntimeAttemptId,
      runtimeAttemptId: row.runtimeAttemptId,
    };
    const linkedRows = linkedRowsByDeliveryId.get(deliveryId) ?? [];
    linkedRows.push(linkedRow);
    linkedRowsByDeliveryId.set(deliveryId, linkedRows);
  }

  for (const linkedRows of linkedRowsByDeliveryId.values()) {
    const row = linkedRows.reduce((oldest, candidate) =>
      candidate.acceptedAt < oldest.acceptedAt ? candidate : oldest
    );
    const providerRows = linkedRows.filter((candidate) => candidate.providerStartAt);
    const providerTimingKeys = new Set(providerRows.flatMap((candidate) => {
      if (
        typeof candidate.providerRequestOrdinal !== "number"
        || !candidate.providerStartAt
      ) {
        return [];
      }
      return [
        `${candidate.runtimeAttemptId}:${candidate.providerRequestOrdinal}:${candidate.providerStartAt.getTime()}`,
      ];
    }));
    const providerRow = providerTimingKeys.size === 1
      ? providerRows.find((candidate) =>
          typeof candidate.providerRequestOrdinal === "number"
        ) ?? null
      : null;

    const deliveryAcceptedAtMs = row.linqDelivery.acceptedAt?.getTime() ?? null;
    const deliveryAttemptedAtMs = row.linqDelivery.attemptedAt.getTime();
    const deliveryDeliveredAtMs = row.linqDelivery.deliveredAt?.getTime() ?? null;
    const ingressAcceptedAtMs = row.acceptedAt.getTime();
    const providerStartAtMs = providerRow?.providerStartAt?.getTime() ?? null;

    if (deliveryAcceptedAtMs === null) {
      missingAcceptedDeliveryCount += 1;
      continue;
    }

    const acceptedToLinqAcceptedMs = deliveryAcceptedAtMs - ingressAcceptedAtMs;
    const linqAttemptedToAcceptedMs = deliveryAcceptedAtMs - deliveryAttemptedAtMs;
    const providerStartToLinqAttemptedMs = providerStartAtMs === null
      ? null
      : deliveryAttemptedAtMs - providerStartAtMs;
    const linqAcceptedToDeliveredMs = deliveryDeliveredAtMs === null
      ? null
      : deliveryDeliveredAtMs - deliveryAcceptedAtMs;
    const acceptedToLinqDeliveredMs = deliveryDeliveredAtMs === null
      ? null
      : deliveryDeliveredAtMs - ingressAcceptedAtMs;
    const replyDurations = [
      acceptedToLinqAcceptedMs,
      linqAttemptedToAcceptedMs,
      providerStartToLinqAttemptedMs,
      linqAcceptedToDeliveredMs,
      acceptedToLinqDeliveredMs,
    ].filter((value): value is number => value !== null);

    if (replyDurations.some((value) => value < 0)) {
      invalidReplyNegativeLatencyCount += 1;
      continue;
    }

    acceptedToLinqAcceptedDurations.push(acceptedToLinqAcceptedMs);
    linqAttemptedToAcceptedDurations.push(linqAttemptedToAcceptedMs);
    if (providerStartToLinqAttemptedMs !== null) {
      providerStartToLinqAttemptedDurations.push(providerStartToLinqAttemptedMs);
    }
    if (linqAcceptedToDeliveredMs !== null && acceptedToLinqDeliveredMs !== null) {
      linqAcceptedToDeliveredDurations.push(linqAcceptedToDeliveredMs);
      acceptedToLinqDeliveredDurations.push(acceptedToLinqDeliveredMs);
    } else if (deliveryAcceptedAtMs <= inFlightCutoff.getTime()) {
      acceptedMissingReceiptCount += 1;
    }

    const knownColdStates = new Set(linkedRows
      .map((candidate) => readHostedIngressLatencyColdState(candidate.phaseBreakdownJson))
      .filter((state) => state !== "unknown"));
    let coldState: "cold" | "unknown" | "warm" = "unknown";
    if (knownColdStates.size === 1) {
      for (const knownColdState of knownColdStates) {
        coldState = knownColdState;
      }
    }
    if (coldState === "cold") {
      coldAcceptedToLinqAcceptedDurations.push(acceptedToLinqAcceptedMs);
    } else if (coldState === "warm") {
      warmAcceptedToLinqAcceptedDurations.push(acceptedToLinqAcceptedMs);
    } else {
      unknownColdStateCount += 1;
    }

    const turnTiming = readUnambiguousHostedTurnTiming(
      turnTimingIndex,
      providerRow?.runtimeAttemptId ?? row.runtimeAttemptId,
      providerRow?.providerRequestOrdinal ?? null,
    );
    if (!turnTiming || providerStartAtMs === null) {
      ambiguousTimingCount += 1;
      continue;
    }
    const replyIntentReadyAtMs = providerStartAtMs
      + turnTiming.providerRequestElapsedMs
      + turnTiming.sinceProviderResultMs;
    const replyIntentToLinqAttemptedMs = deliveryAttemptedAtMs - replyIntentReadyAtMs;
    if (replyIntentToLinqAttemptedMs < 0) {
      invalidReplyNegativeLatencyCount += 1;
      continue;
    }
    providerRequestDurations.push(turnTiming.providerRequestElapsedMs);
    providerResultToReplyIntentDurations.push(turnTiming.sinceProviderResultMs);
    replyIntentToLinqAttemptedDurations.push(replyIntentToLinqAttemptedMs);
  }

  return {
    completedCount: completedDurations.length,
    invalidNegativeLatencyCount,
    missingProviderStartCount,
    missingStagedCount,
    percentileMs: {
      p50: percentile(completedDurations, 0.5),
      p95: percentile(completedDurations, 0.95),
      p99: percentile(completedDurations, 0.99),
    },
    readLimit: HOSTED_INGRESS_LATENCY_READ_ROW_LIMIT,
    recentInFlightCount,
    recentSlowRows: recentSlowRows.slice(0, limit).map((row, index) => ({
      ...row,
      rowLabel: `slow-${index + 1}`,
    })),
    source,
    stageLatencyMs: {
      acceptedToStagedP50: percentile(acceptedToStagedDurations, 0.5),
      acceptedToTemporalSignalP50: percentile(acceptedToSignalDurations, 0.5),
      stagedToProviderStartP50: percentile(stagedToProviderDurations, 0.5),
    },
    linqEgressGuardMs: {
      p50: percentile(linqEgressGuardDurations, 0.5),
      p95: percentile(linqEgressGuardDurations, 0.95),
    },
    replyLatencyMs: {
      acceptedToLinqAccepted: summarizeLatencyDistribution(
        acceptedToLinqAcceptedDurations,
      ),
      acceptedToLinqDelivered: summarizeLatencyDistribution(
        acceptedToLinqDeliveredDurations,
      ),
      coldAcceptedToLinqAccepted: summarizeLatencyDistribution(
        coldAcceptedToLinqAcceptedDurations,
      ),
      linqAcceptedToDelivered: summarizeLatencyDistribution(
        linqAcceptedToDeliveredDurations,
      ),
      linqAttemptedToAccepted: summarizeLatencyDistribution(
        linqAttemptedToAcceptedDurations,
      ),
      providerRequest: summarizeLatencyDistribution(providerRequestDurations),
      providerResultToReplyIntent: summarizeLatencyDistribution(
        providerResultToReplyIntentDurations,
      ),
      providerStartToLinqAttempted: summarizeLatencyDistribution(
        providerStartToLinqAttemptedDurations,
      ),
      replyIntentToLinqAttempted: summarizeLatencyDistribution(
        replyIntentToLinqAttemptedDurations,
      ),
      warmAcceptedToLinqAccepted: summarizeLatencyDistribution(
        warmAcceptedToLinqAcceptedDurations,
      ),
    },
    replyTraceQuality: {
      acceptedMissingReceiptCount,
      ambiguousTimingCount,
      attemptMismatchCount,
      invalidNegativeLatencyCount: invalidReplyNegativeLatencyCount,
      linkedDeliveryCount: linkedRowsByDeliveryId.size,
      missingAcceptedDeliveryCount,
      providerRowsWithoutAcceptedDeliveryLinkCount,
      timingLogTruncated,
      unknownColdStateCount,
    },
    stagedButMissingProviderCount,
    totalAcceptedCount: visibleRows.length,
    truncated,
    window: {
      end: now.toISOString(),
      hours: windowHours,
      start: windowStart.toISOString(),
    },
  };
}

type HostedTurnTimingIndexEntry = {
  providerRequestElapsedMs: number[];
  sinceProviderResultMs: number[];
};

type HostedTurnTimingIndex = Map<string, HostedTurnTimingIndexEntry>;

function buildHostedTurnTimingIndex(
  rows: readonly { attemptId: string | null; redactedJson: unknown }[],
): HostedTurnTimingIndex {
  const index: HostedTurnTimingIndex = new Map();
  for (const row of rows) {
    if (!row.attemptId) {
      continue;
    }
    const timing = readHostedTurnTimingLog(row.redactedJson);
    if (!timing) {
      continue;
    }
    const key = buildHostedTurnTimingIndexKey(row.attemptId, timing.providerRequestOrdinal);
    const entry = index.get(key) ?? {
      providerRequestElapsedMs: [],
      sinceProviderResultMs: [],
    };
    if (timing.stage === "provider-result-returned") {
      entry.providerRequestElapsedMs.push(timing.durationMs);
    } else {
      entry.sinceProviderResultMs.push(timing.durationMs);
    }
    index.set(key, entry);
  }
  return index;
}

function readUnambiguousHostedTurnTiming(
  index: HostedTurnTimingIndex,
  runtimeAttemptId: string,
  providerRequestOrdinal: number | null,
): { providerRequestElapsedMs: number; sinceProviderResultMs: number } | null {
  if (providerRequestOrdinal === null) {
    return null;
  }
  const entry = index.get(
    buildHostedTurnTimingIndexKey(runtimeAttemptId, providerRequestOrdinal),
  );
  if (
    !entry
    || entry.providerRequestElapsedMs.length !== 1
    || entry.sinceProviderResultMs.length !== 1
  ) {
    return null;
  }
  return {
    providerRequestElapsedMs: entry.providerRequestElapsedMs[0]!,
    sinceProviderResultMs: entry.sinceProviderResultMs[0]!,
  };
}

function buildHostedTurnTimingIndexKey(
  runtimeAttemptId: string,
  providerRequestOrdinal: number,
): string {
  return `${runtimeAttemptId}:${providerRequestOrdinal}`;
}

function readHostedTurnTimingLog(value: unknown): {
  durationMs: number;
  providerRequestOrdinal: number;
  stage: "provider-result-returned" | "reply-dispatched";
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== "murph.assistant-turn-timing.v1"
    || record.type !== "assistant.turn.timing"
  ) {
    return null;
  }
  const providerRequestOrdinal = readHostedTurnTimingSafeInteger(
    record.providerRequestOrdinal,
  );
  if (providerRequestOrdinal === null) {
    return null;
  }
  if (
    record.turnTimingStage === "provider-result-returned"
    && record.providerOutcomeKind === "succeeded"
  ) {
    const durationMs = readHostedTurnTimingSafeInteger(
      record.turnTimingProviderRequestElapsedMs,
    );
    return durationMs === null
      ? null
      : { durationMs, providerRequestOrdinal, stage: "provider-result-returned" };
  }
  if (
    record.turnTimingStage === "reply-dispatched"
    && record.deliveryIntentPresent === true
    && record.deliveryOutcomeKind === "queued"
    && record.finalReplySelected === true
  ) {
    const durationMs = readHostedTurnTimingSafeInteger(
      record.turnTimingSinceProviderResultMs,
    );
    return durationMs === null
      ? null
      : { durationMs, providerRequestOrdinal, stage: "reply-dispatched" };
  }
  return null;
}

function readHostedTurnTimingSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function summarizeLatencyDistribution(
  values: readonly number[],
): HostedIngressLatencyDistribution {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

function readHostedIngressLatencyColdState(
  phaseBreakdownJson: unknown,
): "cold" | "unknown" | "warm" {
  if (
    !phaseBreakdownJson
    || typeof phaseBreakdownJson !== "object"
    || Array.isArray(phaseBreakdownJson)
  ) {
    return "unknown";
  }
  const boot = (phaseBreakdownJson as Record<string, unknown>).boot;
  if (!boot || typeof boot !== "object" || Array.isArray(boot)) {
    return "unknown";
  }
  const bootRecord = boot as Record<string, unknown>;
  if (bootRecord.restoreWasCold === false) {
    return "warm";
  }
  return bootRecord.restoreWasCold === true
    && typeof bootRecord.nodeStartupMs === "number"
    && Number.isSafeInteger(bootRecord.nodeStartupMs)
    && bootRecord.nodeStartupMs >= 0
    ? "cold"
    : "unknown";
}

function readHostedIngressLatencyPhaseBreakdownNumber(
  phaseBreakdownJson: unknown,
  phase: HostedRuntimeLatencyPhaseBreakdownPhase,
  leafKey: string,
): number | null {
  if (
    !phaseBreakdownJson
    || typeof phaseBreakdownJson !== "object"
    || Array.isArray(phaseBreakdownJson)
  ) {
    return null;
  }
  const phaseValue = (phaseBreakdownJson as Record<string, unknown>)[phase];
  if (
    !phaseValue
    || typeof phaseValue !== "object"
    || Array.isArray(phaseValue)
  ) {
    return null;
  }
  const value = (phaseValue as Record<string, unknown>)[leafKey];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeHostedIngressLatencySource(
  value: HostedIngressLatencySource | string,
): HostedIngressLatencySource {
  const source = readHostedIngressLatencySource(value);
  if (source) {
    return source;
  }

  throw new TypeError("Hosted ingress latency source is not supported.");
}

async function readTraceMailboxItem(
  prisma: HostedIngressLatencyPrismaClient,
  input: {
    expectedUserId?: string | null;
    mailboxItemId: string;
  },
) {
  const mailboxItemId = requireSafeLatencyIdentifier(
    input.mailboxItemId,
    "Hosted ingress latency mailboxItemId",
  );

  if (input.expectedUserId) {
    const expectedUserId = requireSafeLatencyIdentifier(
      input.expectedUserId,
      "Hosted ingress latency userId",
    );
    const rows = await prisma.$queryRaw<TraceMailboxItem[]>`
      SELECT
        id,
        user_id AS "userId",
        lane,
        lane_seq AS "laneSeq",
        (EXTRACT(EPOCH FROM (created_at AT TIME ZONE current_setting('TimeZone'))) * 1000)::bigint AS "acceptedAtEpochMs"
      FROM hosted_mailbox_item
      WHERE id = ${mailboxItemId}
        AND user_id = ${expectedUserId}
      LIMIT 1
    `;
    return parseTraceMailboxItem(rows[0]);
  }

  const rows = await prisma.$queryRaw<TraceMailboxItem[]>`
    SELECT
      id,
      user_id AS "userId",
      lane,
      lane_seq AS "laneSeq",
      (EXTRACT(EPOCH FROM (created_at AT TIME ZONE current_setting('TimeZone'))) * 1000)::bigint AS "acceptedAtEpochMs"
    FROM hosted_mailbox_item
    WHERE id = ${mailboxItemId}
    LIMIT 1
  `;
  return parseTraceMailboxItem(rows[0]);
}

type TraceMailboxItem = {
  acceptedAtEpochMs: bigint | number | string;
  id: string;
  lane: string;
  laneSeq: bigint;
  userId: string;
};

type NormalizedTraceMailboxItem = Omit<TraceMailboxItem, "acceptedAtEpochMs"> & {
  acceptedAt: Date;
};

function parseTraceMailboxItem(row: TraceMailboxItem | undefined): NormalizedTraceMailboxItem | null {
  if (!row) {
    return null;
  }
  const acceptedAtEpochMs = normalizeEpochMs(row.acceptedAtEpochMs);
  return {
    acceptedAt: new Date(acceptedAtEpochMs),
    id: row.id,
    lane: row.lane,
    laneSeq: row.laneSeq,
    userId: row.userId,
  };
}

async function upsertHostedIngressLatencyTraceFromMailboxItem(
  prisma: HostedIngressLatencyPrismaClient,
  input: {
    mailboxItem: NonNullable<Awaited<ReturnType<typeof readTraceMailboxItem>>>;
    source: HostedIngressLatencySource;
  },
) {
  await prisma.$executeRaw`
    INSERT INTO hosted_ingress_latency_trace (
      id,
      user_id,
      source,
      mailbox_item_id,
      mailbox_lane,
      mailbox_lane_seq,
      accepted_at,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${input.mailboxItem.userId},
      ${input.source},
      ${input.mailboxItem.id},
      ${input.mailboxItem.lane},
      ${input.mailboxItem.laneSeq},
      ${input.mailboxItem.acceptedAt},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (mailbox_item_id) DO NOTHING
  `;

  const trace = await prisma.hostedIngressLatencyTrace.findUnique({
    where: { mailboxItemId: input.mailboxItem.id },
  });
  if (!trace) {
    throw new Error("Hosted ingress latency trace insert did not produce a readable row.");
  }
  return trace;
}

async function updateHostedIngressLatencyRuntimeMilestone(
  prisma: HostedIngressLatencyPrismaClient,
  input: {
    at: Date;
    milestone: HostedRuntimeLatencyTraceMilestone;
    runtimeAttemptId: string;
    source: HostedIngressLatencySource;
    userId: string;
  },
): Promise<number> {
  const baseWhere = {
    runtimeAttemptId: input.runtimeAttemptId,
    source: input.source,
    userId: input.userId,
  };

  const field = readHostedIngressLatencyRuntimeMilestoneField(input.milestone);
  const result = await prisma.hostedIngressLatencyTrace.updateMany({
    data: {
      [field]: input.at,
    },
    where: {
      ...baseWhere,
      AND: [
        { OR: [{ [field]: null }, { [field]: { gt: input.at } }] },
      ],
    },
  });
  return result.count;
}

function readHostedIngressLatencyRuntimeMilestoneField(
  milestone: HostedRuntimeLatencyTraceMilestone,
): HostedIngressLatencyRuntimeMilestoneField {
  switch (milestone) {
    case "runner_job_accepted":
      return "runnerJobAcceptedAt";
    case "runtime_phase_started":
      return "runtimePhaseStartedAt";
    case "workspace_restore_done":
      return "workspaceRestoreDoneAt";
    case "mailbox_import_done":
      return "mailboxImportDoneAt";
  }
}

async function updateHostedIngressLatencyTraceEarliestMilestone(
  prisma: HostedIngressLatencyPrismaClient,
  input: {
    at: Date;
    field: "temporalSignalAcceptedAt";
    trace: NonNullable<HostedIngressLatencyTraceRow>;
  },
): Promise<void> {
  const existing = input.trace[input.field];
  if (existing && existing <= input.at) {
    return;
  }

  await prisma.hostedIngressLatencyTrace.update({
    data: {
      [input.field]: input.at,
    },
    where: {
      id: input.trace.id,
    },
  });
}

type HostedIngressLatencyLockedRow = {
  assistantInputId: string | null;
  assistantInputStagedAt: Date | null;
  id: string;
  phaseBreakdownJson: unknown;
  providerStartAt: Date | null;
  runnerJobAcceptedAt: Date | null;
  runtimeAttemptId: string | null;
  runtimePhaseStartedAt: Date | null;
  workspaceRestoreDoneAt: Date | null;
};

async function readHostedIngressLatencyTraceForUpdate(
  prisma: HostedIngressLatencyPrismaTransactionClient,
  traceId: string,
): Promise<HostedIngressLatencyLockedRow | null> {
  const rows = await prisma.$queryRaw<HostedIngressLatencyLockedRow[]>`
    SELECT
      id,
      assistant_input_id AS "assistantInputId",
      runtime_attempt_id AS "runtimeAttemptId",
      runner_job_accepted_at AS "runnerJobAcceptedAt",
      runtime_phase_started_at AS "runtimePhaseStartedAt",
      workspace_restore_done_at AS "workspaceRestoreDoneAt",
      assistant_input_staged_at AS "assistantInputStagedAt",
      provider_start_at AS "providerStartAt",
      phase_breakdown_json AS "phaseBreakdownJson"
    FROM hosted_ingress_latency_trace
    WHERE id = ${traceId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function updateHostedIngressLatencyTracePhaseBreakdownLocked(
  prisma: HostedIngressLatencyPrismaClient,
  input: {
    phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown;
    phases: readonly HostedRuntimeLatencyPhaseBreakdownPhase[];
    traceId: string;
  },
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const trace = await readHostedIngressLatencyTraceForUpdate(tx, input.traceId);
    if (!trace) {
      return false;
    }

    const phaseBreakdownUpdate = readPhaseBreakdownMergeUpdate(
      trace.phaseBreakdownJson,
      input.phaseBreakdown,
      input.phases,
    );
    if (Object.keys(phaseBreakdownUpdate).length === 0) {
      return false;
    }

    await tx.hostedIngressLatencyTrace.update({
      data: phaseBreakdownUpdate,
      where: {
        id: trace.id,
      },
    });

    return true;
  });
}

async function updateHostedIngressAssistantInputStagedLocked(
  prisma: HostedIngressLatencyPrismaClient,
  input: {
    assistantInputId: string;
    at: Date;
    phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown | null | undefined;
    restoreMilestones: {
      runnerJobAcceptedAt: Date | null;
      runtimePhaseStartedAt: Date | null;
      workspaceRestoreDoneAt: Date | null;
    };
    runtimeAttemptId: string | null;
    traceId: string;
  },
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const trace = await readHostedIngressLatencyTraceForUpdate(tx, input.traceId);
    if (!trace) {
      return false;
    }

    if (trace.assistantInputId && trace.assistantInputId !== input.assistantInputId) {
      return false;
    }
    if (
      trace.runtimeAttemptId
      && input.runtimeAttemptId
      && trace.runtimeAttemptId !== input.runtimeAttemptId
    ) {
      return false;
    }

    await tx.hostedIngressLatencyTrace.update({
      data: {
        assistantInputId: input.assistantInputId,
        assistantInputStagedAt:
          trace.assistantInputStagedAt && trace.assistantInputStagedAt <= input.at
            ? trace.assistantInputStagedAt
            : input.at,
        ...readEarlierDateUpdate(
          "runnerJobAcceptedAt",
          trace.runnerJobAcceptedAt,
          input.restoreMilestones.runnerJobAcceptedAt,
        ),
        ...readEarlierDateUpdate(
          "runtimePhaseStartedAt",
          trace.runtimePhaseStartedAt,
          input.restoreMilestones.runtimePhaseStartedAt,
        ),
        ...readEarlierDateUpdate(
          "workspaceRestoreDoneAt",
          trace.workspaceRestoreDoneAt,
          input.restoreMilestones.workspaceRestoreDoneAt,
        ),
        ...readPhaseBreakdownMergeUpdate(trace.phaseBreakdownJson, input.phaseBreakdown, [
          "orchestration",
          "dispatch",
          "restore",
          "boot",
          "wake",
        ]),
        ...(trace.runtimeAttemptId || !input.runtimeAttemptId
          ? {}
          : { runtimeAttemptId: input.runtimeAttemptId }),
      },
      where: {
        id: trace.id,
      },
    });

    return true;
  });
}

async function updateHostedIngressProviderStartedLocked(
  prisma: HostedIngressLatencyPrismaClient,
  input: {
    at: Date;
    phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown | null | undefined;
    providerRequestOrdinal: number;
    runtimeAttemptId: string | null;
    traceId: string;
  },
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const trace = await readHostedIngressLatencyTraceForUpdate(tx, input.traceId);
    if (!trace) {
      return false;
    }
    if (
      trace.runtimeAttemptId
      && input.runtimeAttemptId
      && trace.runtimeAttemptId !== input.runtimeAttemptId
    ) {
      return false;
    }

    const shouldUpdateProviderStart = !trace.providerStartAt || trace.providerStartAt > input.at;
    const shouldUpdateRuntimeAttempt = !trace.runtimeAttemptId && input.runtimeAttemptId;
    const phaseBreakdownUpdate = readPhaseBreakdownMergeUpdate(
      trace.phaseBreakdownJson,
      input.phaseBreakdown,
      ["provider"],
    );

    if (
      !shouldUpdateProviderStart
      && !shouldUpdateRuntimeAttempt
      && Object.keys(phaseBreakdownUpdate).length === 0
    ) {
      return true;
    }

    await tx.hostedIngressLatencyTrace.update({
      data: {
        ...(shouldUpdateProviderStart
          ? {
              providerRequestOrdinal: input.providerRequestOrdinal,
              providerStartAt: input.at,
            }
          : {}),
        ...(shouldUpdateRuntimeAttempt ? { runtimeAttemptId: input.runtimeAttemptId } : {}),
        ...phaseBreakdownUpdate,
      },
      where: {
        id: trace.id,
      },
    });
    return true;
  });
}

function normalizeDate(value: Date | string | null | undefined, label: string): Date {
  if (value === undefined || value === null) {
    return new Date();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be a valid date.`);
  }
  return date;
}

function normalizeOptionalDate(value: Date | string | null | undefined, label: string): Date | null {
  return value === undefined || value === null ? null : normalizeDate(value, label);
}

function readEarlierDateUpdate<Field extends string>(
  field: Field,
  existing: Date | null | undefined,
  next: Date | null,
): Partial<Record<Field, Date>> {
  if (!next || (existing && existing <= next)) {
    return {};
  }

  return { [field]: next } as Partial<Record<Field, Date>>;
}

type HostedRuntimeLatencyPhaseBreakdownSubKey = HostedRuntimeLatencyPhaseBreakdownPhase;

// Merges incoming phase-breakdown leaves into the existing trace JSON within the
// SAME update() (no extra request). Idempotent: already-populated leaves are
// preserved (never clobbered), and schemaVersion is preserved. Existing JSON is
// diagnostic-only and may predate the current schema, so stale stored leaves are
// dropped before merge. Incoming and outgoing leaves remain strict so malformed
// in-process values cannot persist a secret-shaped payload.
function readPhaseBreakdownMergeUpdate(
  existingValue: unknown,
  incoming: HostedRuntimeLatencyPhaseBreakdown | null | undefined,
  subKeys: readonly HostedRuntimeLatencyPhaseBreakdownSubKey[],
): { phaseBreakdownJson?: Prisma.InputJsonValue } {
  if (!incoming) {
    return {};
  }
  const merged = mergeHostedRuntimeLatencyPhaseBreakdownJson({
    existing: existingValue,
    incoming,
    phases: subKeys,
  });
  if (!merged.changed) {
    return {};
  }
  return { phaseBreakdownJson: merged.value };
}

function normalizeNullableLatencyIdentifier(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? requireSafeLatencyIdentifier(normalized, "Hosted ingress latency identifier") : null;
}

function requireSafeLatencyIdentifier(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,256}$/u.test(normalized)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}

function normalizeProviderRequestOrdinal(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000) {
    throw new TypeError("Hosted ingress latency provider request ordinal is invalid.");
  }
  return value;
}

function normalizeEpochMs(value: bigint | number | string): number {
  const epochMs = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(epochMs)) {
    throw new TypeError("Hosted ingress latency mailbox accepted timestamp is invalid.");
  }
  return epochMs;
}

function normalizeDashboardWindowHours(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return HOSTED_INGRESS_LATENCY_DEFAULT_WINDOW_HOURS;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Hosted ingress latency dashboard window must be a positive integer.");
  }
  return Math.min(value, HOSTED_INGRESS_LATENCY_MAX_WINDOW_HOURS);
}

function normalizeDashboardSlowLimit(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return HOSTED_INGRESS_LATENCY_DEFAULT_SLOW_LIMIT;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Hosted ingress latency dashboard limit must be a positive integer.");
  }
  return Math.min(value, HOSTED_INGRESS_LATENCY_MAX_SLOW_LIMIT);
}

function normalizeDashboardInFlightGraceMs(value: number | null | undefined): number {
  if (value === undefined || value === null) {
    return HOSTED_INGRESS_LATENCY_IN_FLIGHT_GRACE_MS;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Hosted ingress latency in-flight grace must be non-negative.");
  }
  return Math.min(value, 15 * 60_000);
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rawIndex = (sorted.length - 1) * p;
  const lowerIndex = Math.floor(rawIndex);
  const upperIndex = Math.ceil(rawIndex);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    return null;
  }
  if (lowerIndex === upperIndex) {
    return Math.round(lower);
  }
  return Math.round(lower + (upper - lower) * (rawIndex - lowerIndex));
}
