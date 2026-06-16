import "server-only";

import { randomUUID } from "node:crypto";

import {
  HOSTED_INGRESS_LATENCY_SOURCES,
  type HostedIngressLatencySource,
  type HostedRuntimeLatencyPhaseBreakdown,
  type HostedRuntimeLatencyTraceMilestone,
} from "@murphai/hosted-execution/runtime-control";
import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

type HostedIngressLatencyPrismaClient = Pick<
  PrismaClient,
  "$queryRaw" | "hostedIngressLatencyTrace"
>;

type HostedIngressLatencyTraceRow = Awaited<
  ReturnType<PrismaClient["hostedIngressLatencyTrace"]["findFirst"]>
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

export interface HostedIngressLatencyWriteResult {
  matchedCount: number;
  recorded: boolean;
  unmatchedCount: number;
}

export interface HostedIngressLatencyDashboardInput {
  inFlightGraceMs?: number | null;
  limit?: number | null;
  now?: Date | null;
  prisma?: HostedIngressLatencyPrismaClient;
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

  await prisma.hostedIngressLatencyTrace.update({
    data: {
      assistantInputId,
      assistantInputStagedAt:
        trace.assistantInputStagedAt && trace.assistantInputStagedAt <= at
          ? trace.assistantInputStagedAt
          : at,
      ...readEarlierDateUpdate("runnerJobAcceptedAt", trace.runnerJobAcceptedAt, runnerJobAcceptedAt),
      ...readEarlierDateUpdate(
        "runtimePhaseStartedAt",
        trace.runtimePhaseStartedAt,
        runtimePhaseStartedAt,
      ),
      ...readEarlierDateUpdate(
        "workspaceRestoreDoneAt",
        trace.workspaceRestoreDoneAt,
        workspaceRestoreDoneAt,
      ),
      ...readPhaseBreakdownMergeUpdate(trace.phaseBreakdownJson, input.phaseBreakdown, [
        "dispatch",
        "restore",
        "boot",
        "wake",
      ]),
      ...(trace.runtimeAttemptId || !runtimeAttemptId ? {} : { runtimeAttemptId }),
    },
    where: {
      id: trace.id,
    },
  });

  return { matchedCount: 1, recorded: true, unmatchedCount: 0 };
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
      phaseBreakdownJson: true,
      providerStartAt: true,
      runtimeAttemptId: true,
    },
    where: {
      assistantInputId: {
        in: assistantInputIds,
      },
      source,
      userId: input.authenticatedUserId,
    },
  });
  const matchedRows = rows;
  const matchedIds = new Set(matchedRows.map((row) => row.assistantInputId).filter(Boolean));

  await Promise.all(matchedRows.map((row) => {
    const shouldUpdateProviderStart = !row.providerStartAt || row.providerStartAt > at;
    const shouldUpdateRuntimeAttempt = !row.runtimeAttemptId && runtimeAttemptId;
    const phaseBreakdownUpdate = readPhaseBreakdownMergeUpdate(
      row.phaseBreakdownJson,
      input.phaseBreakdown,
      ["provider"],
    );

    if (
      !shouldUpdateProviderStart
      && !shouldUpdateRuntimeAttempt
      && Object.keys(phaseBreakdownUpdate).length === 0
    ) {
      return Promise.resolve(null);
    }

    return prisma.hostedIngressLatencyTrace.update({
      data: {
        ...(shouldUpdateProviderStart
          ? {
              providerRequestOrdinal,
              providerStartAt: at,
            }
          : {}),
        ...(shouldUpdateRuntimeAttempt ? { runtimeAttemptId } : {}),
        ...phaseBreakdownUpdate,
      },
      where: {
        id: row.id,
      },
    });
  }));

  return {
    matchedCount: matchedRows.length,
    recorded: matchedRows.length > 0,
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
      providerStartAt: true,
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
  const completedDurations: number[] = [];
  const acceptedToSignalDurations: number[] = [];
  const acceptedToStagedDurations: number[] = [];
  const stagedToProviderDurations: number[] = [];
  const recentSlowRows: HostedIngressLatencyDashboardSlowRow[] = [];
  let invalidNegativeLatencyCount = 0;
  let missingStagedCount = 0;
  let missingProviderStartCount = 0;
  let recentInFlightCount = 0;
  let stagedButMissingProviderCount = 0;

  for (const row of visibleRows) {
    const acceptedAtMs = row.acceptedAt.getTime();
    const providerStartMs = row.providerStartAt?.getTime() ?? null;
    const stagedAtMs = row.assistantInputStagedAt?.getTime() ?? null;
    const signalAtMs = row.temporalSignalAcceptedAt?.getTime() ?? null;
    const mature = row.acceptedAt <= inFlightCutoff;
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

function normalizeHostedIngressLatencySource(
  value: HostedIngressLatencySource | string,
): HostedIngressLatencySource {
  if ((HOSTED_INGRESS_LATENCY_SOURCES as readonly string[]).includes(value)) {
    return value as HostedIngressLatencySource;
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
  return await prisma.hostedIngressLatencyTrace.upsert({
    create: {
      acceptedAt: input.mailboxItem.acceptedAt,
      id: randomUUID(),
      mailboxItemId: input.mailboxItem.id,
      mailboxLane: input.mailboxItem.lane,
      mailboxLaneSeq: input.mailboxItem.laneSeq,
      source: input.source,
      userId: input.mailboxItem.userId,
    },
    update: {},
    where: {
      mailboxItemId: input.mailboxItem.id,
    },
  });
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
  if (!input.trace) {
    return;
  }
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

type HostedRuntimeLatencyPhaseBreakdownSubKey = "dispatch" | "restore" | "boot" | "wake" | "provider";

const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS: Record<
  HostedRuntimeLatencyPhaseBreakdownSubKey,
  ReadonlySet<string>
> = {
  dispatch: new Set([
    "invokeReceivedAtEpochMs",
    "containerEnsureReadyStartedAtEpochMs",
  ]),
  restore: new Set([
    "sizeGuardMs",
    "dataKeyUnwrapMs",
    "scratchPrepareMs",
    "presignGetMs",
    "objectFetchMs",
    "decryptMs",
    "extractMs",
    "encryptedBytes",
    "plainBytes",
  ]),
  boot: new Set(["nodeStartupMs", "restoreWasCold"]),
  wake: new Set([
    "runtimeWakeNotifiedAtEpochMs",
    "foregroundWaitResolvedAtEpochMs",
    "foregroundImportStartedAtEpochMs",
  ]),
  provider: new Set([
    "turnLockWaitMs",
    "sessionResolveMs",
    "promptBuildMs",
    "admissionMs",
    "preProviderSetupMs",
  ]),
};

const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_SUB_KEYS = new Set(
  Object.keys(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS),
);
const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_BOOLEAN_LEAF_KEYS = new Set([
  "boot.restoreWasCold",
]);

// Shallow-merges incoming phase-breakdown sub-objects into the existing trace
// JSON within the SAME update() (no extra request). Idempotent: an already-populated
// sub-object is preserved (never clobbered), and schemaVersion is preserved. The
// Existing JSON is diagnostic-only and may predate the current schema, so stale
// stored leaves are dropped before merge. Incoming and outgoing leaves remain
// strict so malformed in-process values cannot persist a secret-shaped payload.
function readPhaseBreakdownMergeUpdate(
  existingValue: unknown,
  incoming: HostedRuntimeLatencyPhaseBreakdown | null | undefined,
  subKeys: readonly HostedRuntimeLatencyPhaseBreakdownSubKey[],
): { phaseBreakdownJson?: Prisma.InputJsonValue } {
  if (!incoming) {
    return {};
  }

  if (!isPhaseBreakdownRecord(incoming)) {
    throw new TypeError("Hosted ingress latency phaseBreakdown must be an object.");
  }
  assertPhaseBreakdownLeavesSafe(incoming);

  const sanitizedExisting = sanitizeStoredPhaseBreakdown(existingValue);
  const existing = sanitizedExisting.value;
  const merged: Record<string, unknown> = { ...existing };
  let changed = sanitizedExisting.changed;

  const schemaVersion =
    typeof existing.schemaVersion === "number"
      ? existing.schemaVersion
      : incoming.schemaVersion;
  if (merged.schemaVersion !== schemaVersion) {
    merged.schemaVersion = schemaVersion;
    changed = true;
  }

  for (const subKey of subKeys) {
    const incomingSub = incoming[subKey];
    if (!incomingSub || Object.keys(incomingSub).length === 0) {
      continue;
    }
    // Idempotent: do not clobber an already-populated sub-object.
    if (isPhaseBreakdownRecord(merged[subKey]) && Object.keys(merged[subKey] as Record<string, unknown>).length > 0) {
      continue;
    }
    merged[subKey] = { ...incomingSub };
    changed = true;
  }

  if (!changed) {
    return {};
  }

  assertPhaseBreakdownLeavesSafe(merged);
  return { phaseBreakdownJson: merged as Prisma.InputJsonValue };
}

function isPhaseBreakdownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeStoredPhaseBreakdown(value: unknown): {
  changed: boolean;
  value: Record<string, unknown>;
} {
  if (!isPhaseBreakdownRecord(value)) {
    return {
      changed: value !== null && value !== undefined,
      value: {},
    };
  }

  let changed = false;
  const sanitized: Record<string, unknown> = {};
  if (value.schemaVersion !== undefined) {
    if (isSafeLatencyPhaseBreakdownNumber(value.schemaVersion)) {
      sanitized.schemaVersion = value.schemaVersion;
    } else {
      changed = true;
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === "schemaVersion") {
      continue;
    }
    if (
      !HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_SUB_KEYS.has(key)
      || !isPhaseBreakdownRecord(entry)
    ) {
      changed = true;
      continue;
    }

    const subKey = key as HostedRuntimeLatencyPhaseBreakdownSubKey;
    const allowedLeafKeys = HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS[subKey];
    const sanitizedSub: Record<string, unknown> = {};
    for (const [leafKey, leaf] of Object.entries(entry)) {
      if (allowedLeafKeys.has(leafKey) && isSafePhaseBreakdownLeaf(subKey, leafKey, leaf)) {
        sanitizedSub[leafKey] = leaf;
      } else {
        changed = true;
      }
    }
    if (Object.keys(sanitizedSub).length > 0) {
      sanitized[subKey] = sanitizedSub;
    } else if (Object.keys(entry).length > 0) {
      changed = true;
    }
  }

  return {
    changed,
    value: sanitized,
  };
}

function assertPhaseBreakdownLeavesSafe(value: Record<string, unknown>): void {
  for (const [key, entry] of Object.entries(value)) {
    if (key === "schemaVersion") {
      if (!isSafeLatencyPhaseBreakdownNumber(entry)) {
        throw new TypeError("Hosted ingress latency phaseBreakdown schemaVersion must be a non-negative safe integer.");
      }
      continue;
    }
    if (!isPhaseBreakdownRecord(entry)) {
      throw new TypeError(`Hosted ingress latency phaseBreakdown ${key} must be an object.`);
    }
    if (!HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_SUB_KEYS.has(key)) {
      throw new TypeError(`Hosted ingress latency phaseBreakdown ${key} is not allowed.`);
    }
    const allowedLeafKeys =
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS[
        key as HostedRuntimeLatencyPhaseBreakdownSubKey
      ];
    for (const [leafKey, leaf] of Object.entries(entry)) {
      if (!allowedLeafKeys.has(leafKey)) {
        throw new TypeError(
          `Hosted ingress latency phaseBreakdown ${key}.${leafKey} is not allowed.`,
        );
      }
      if (
        !isSafePhaseBreakdownLeaf(
          key as HostedRuntimeLatencyPhaseBreakdownSubKey,
          leafKey,
          leaf,
        )
      ) {
        throw new TypeError(
          `Hosted ingress latency phaseBreakdown ${key}.${leafKey} must match the latency schema type.`,
        );
      }
    }
  }
}

function isSafePhaseBreakdownLeaf(
  subKey: HostedRuntimeLatencyPhaseBreakdownSubKey,
  leafKey: string,
  value: unknown,
): boolean {
  if (HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_BOOLEAN_LEAF_KEYS.has(`${subKey}.${leafKey}`)) {
    return typeof value === "boolean";
  }

  return isSafeLatencyPhaseBreakdownNumber(value);
}

function isSafeLatencyPhaseBreakdownNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
