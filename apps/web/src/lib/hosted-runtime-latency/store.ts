import "server-only";

import { randomUUID } from "node:crypto";

import {
  HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_RULES,
  mergeHostedRuntimeLatencyPhaseBreakdownJson,
  readHostedIngressLatencySource,
  type HostedIngressLatencySource,
  type HostedRuntimeAssistantMilestone,
  type HostedRuntimeLatencyPhaseBreakdown,
  type HostedRuntimeLatencyPhaseBreakdownPhase,
  type HostedRuntimeLatencyTraceMilestone,
} from "@murphai/hosted-execution/runtime-control";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import {
  createHostedLinqDeliverySourceRefLookupKey,
} from "../hosted-onboarding/linq-observability-identifiers";
import {
  isHostedRuntimeLogDatabaseConfigured,
} from "../hosted-runtime-log/database";
import {
  listHostedRuntimeTurnTimingLogs,
} from "../hosted-runtime-log/store";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

type HostedIngressLatencyDashboardReadRow = {
  acceptedAt: Date;
  assistantInputStagedAt: Date | null;
  linqDelivery: {
    acceptedAt: Date | null;
    attemptedAt: Date;
    lastReceiptAt: Date | null;
    sourceRef: string | null;
    status: string;
  } | null;
  linqDeliveryId: string | null;
  phaseBreakdownJson: unknown;
  providerRequestOrdinal: number | null;
  providerStartAt: Date | null;
  replyRuntimeAttemptId: string | null;
  runtimeAttemptId: string | null;
  temporalSignalAcceptedAt: Date | null;
};

type HostedIngressLatencyPrismaReadClient =
  | Pick<PrismaClient, "hostedIngressLatencyTrace">
  | {
      hostedIngressLatencyTrace: {
        findMany(
          input: Prisma.HostedIngressLatencyTraceFindManyArgs,
        ): Promise<HostedIngressLatencyDashboardReadRow[]>;
      };
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
const HOSTED_INGRESS_LATENCY_TIMING_LOG_WINDOW_PADDING_MS = 5 * 60_000;
const HOSTED_ASSISTANT_TURN_TIMING_SCHEMA = "murph.assistant-turn-timing.v1";
const HOSTED_ASSISTANT_TURN_TIMING_TYPE = "assistant.turn.timing";
const HOSTED_INGRESS_LATENCY_PHASE_LEAF_RULES_JSON = JSON.stringify(
  HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_RULES,
);

export interface HostedIngressLatencyWriteResult {
  matchedCount: number;
  recorded: boolean;
  unmatchedCount: number;
  // Subset of unmatchedCount whose assistant input has no ingress trace row at
  // all. Traces exist only for inbound messaging wakes, so an assistant input
  // the runtime created on its own (scheduled or follow-up turns) is untraced
  // by construction rather than a write that lost its authority check.
  untracedCount?: number;
}

export interface HostedIngressLatencyDeliveryLinkResult {
  matchedCount: number;
  recorded: boolean;
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

export interface HostedIngressLatencyObservation {
  observationCount: number;
  p50Ms: number | null;
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
  observedMilestoneLatency: {
    acceptedToTypingRequest: HostedIngressLatencyObservation;
    codexStartToFirstOutput: HostedIngressLatencyObservation;
    codexStartToFirstText: HostedIngressLatencyObservation;
    typingRequestToAccepted: HostedIngressLatencyObservation;
  };
  source: HostedIngressLatencySource;
  stageLatencyMs: {
    acceptedToStagedP50: number | null;
    acceptedToTemporalSignalP50: number | null;
    stagedToProviderStartP50: number | null;
  };
  replyLatencyMs: {
    acceptedToLinqAccepted: HostedIngressLatencyDistribution;
    acceptedToLinqReceipt: HostedIngressLatencyDistribution;
    codexStartToLinqAttempted: HostedIngressLatencyDistribution;
    coldAcceptedToLinqAccepted: HostedIngressLatencyDistribution;
    linqAcceptedToReceipt: HostedIngressLatencyDistribution;
    linqAttemptedToAccepted: HostedIngressLatencyDistribution;
    providerRequest: HostedIngressLatencyDistribution;
    providerResultToReplyIntent: HostedIngressLatencyDistribution;
    replyIntentToLinqAttempted: HostedIngressLatencyDistribution;
    warmAcceptedToLinqAccepted: HostedIngressLatencyDistribution;
  };
  replyTraceQuality: {
    acceptedMissingReceiptCount: number;
    ambiguousTimingCount: number;
    deliveryAttemptHandoffCount: number;
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
  ].sort();
  const providerRequestOrdinal = normalizeProviderRequestOrdinal(input.providerRequestOrdinal);
  const runtimeAttemptId = normalizeNullableLatencyIdentifier(input.runtimeAttemptId);

  if (assistantInputIds.length === 0) {
    return { matchedCount: 0, recorded: false, unmatchedCount: 0 };
  }
  if (isLegacyLinqEgressGuardOnlyProviderStart(input.phaseBreakdown)) {
    return { matchedCount: 0, recorded: false, unmatchedCount: 0 };
  }

  const phasePatch = readHostedIngressLatencyProviderPhasePatch(input.phaseBreakdown);
  const requestedIds = buildHostedIngressLatencyRequestedIdsSql(assistantInputIds);
  const nextProviderStartAt = Prisma.sql`CASE
    WHEN trace.provider_start_at IS NULL
      OR trace.provider_start_at > input.provider_start_at
    THEN input.provider_start_at
    ELSE trace.provider_start_at
  END`;
  const nextProviderRequestOrdinal = Prisma.sql`CASE
    WHEN trace.provider_start_at IS NULL
      OR trace.provider_start_at > input.provider_start_at
    THEN input.provider_request_ordinal
    ELSE trace.provider_request_ordinal
  END`;
  const nextRuntimeAttemptId = Prisma.sql`COALESCE(
    trace.runtime_attempt_id,
    input.runtime_attempt_id
  )`;
  const nextPhaseBreakdown = phasePatch
    ? buildHostedIngressProviderPhaseBreakdownSql({
        hasPreProvider: phasePatch.preProviderJson !== null,
        hasProvider: phasePatch.providerJson !== null,
      })
    : Prisma.sql`trace.phase_breakdown_json`;
  const rows = await prisma.$queryRaw<HostedIngressLatencySetWriteProjectionRow[]>(Prisma.sql`
    /* hosted_ingress_provider_started_set_based */
    WITH input AS (
      SELECT
        ${input.authenticatedUserId}::text AS user_id,
        ${source}::text AS source,
        ${runtimeAttemptId}::text AS runtime_attempt_id,
        (
          TIMESTAMP 'epoch'
          + ${at.getTime()}::bigint * INTERVAL '1 millisecond'
        ) AS provider_start_at,
        ${providerRequestOrdinal}::integer AS provider_request_ordinal,
        ${phasePatch?.schemaVersion ?? null}::integer AS phase_schema_version,
        ${phasePatch?.preProviderJson ?? null}::jsonb AS pre_provider_json,
        ${phasePatch?.providerJson ?? null}::jsonb AS provider_json,
        ${HOSTED_INGRESS_LATENCY_PHASE_LEAF_RULES_JSON}::jsonb AS phase_leaf_rules
    ),
    requested(assistant_input_id) AS (
      VALUES ${requestedIds}
    ),
    scoped AS (
      SELECT DISTINCT requested.assistant_input_id
      FROM requested
      CROSS JOIN input
      JOIN hosted_ingress_latency_trace AS trace
        ON trace.assistant_input_id = requested.assistant_input_id
       AND trace.user_id = input.user_id
       AND trace.source = input.source
    ),
    eligible AS (
      SELECT DISTINCT requested.assistant_input_id
      FROM requested
      CROSS JOIN input
      JOIN hosted_ingress_latency_trace AS trace
        ON trace.assistant_input_id = requested.assistant_input_id
       AND trace.user_id = input.user_id
       AND trace.source = input.source
       AND (
         trace.runtime_attempt_id IS NULL
         OR input.runtime_attempt_id IS NULL
         OR trace.runtime_attempt_id = input.runtime_attempt_id
       )
    ),
    updated AS (
      UPDATE hosted_ingress_latency_trace AS trace
      SET (
        provider_start_at,
        provider_request_ordinal,
        runtime_attempt_id,
        phase_breakdown_json,
        updated_at
      ) = (
        SELECT
          next.provider_start_at,
          next.provider_request_ordinal,
          next.runtime_attempt_id,
          next.phase_breakdown_json,
          statement_timestamp() AT TIME ZONE 'UTC'
        FROM (
          SELECT
            ${nextProviderStartAt} AS provider_start_at,
            ${nextProviderRequestOrdinal} AS provider_request_ordinal,
            ${nextRuntimeAttemptId} AS runtime_attempt_id,
            ${nextPhaseBreakdown} AS phase_breakdown_json
        ) AS next
      )
      FROM requested, input
      WHERE trace.assistant_input_id = requested.assistant_input_id
        AND trace.user_id = input.user_id
        AND trace.source = input.source
        AND (
          trace.runtime_attempt_id IS NULL
          OR input.runtime_attempt_id IS NULL
          OR trace.runtime_attempt_id = input.runtime_attempt_id
        )
        AND (
          trace.provider_start_at IS DISTINCT FROM ${nextProviderStartAt}
          OR trace.provider_request_ordinal
            IS DISTINCT FROM ${nextProviderRequestOrdinal}
          OR trace.runtime_attempt_id IS DISTINCT FROM ${nextRuntimeAttemptId}
          OR trace.phase_breakdown_json IS DISTINCT FROM ${nextPhaseBreakdown}
        )
      RETURNING trace.assistant_input_id AS "assistantInputId"
    )
    SELECT
      requested.assistant_input_id AS "assistantInputId",
      EXISTS (
        SELECT 1
        FROM scoped
        WHERE scoped.assistant_input_id = requested.assistant_input_id
      ) AS traced,
      EXISTS (
        SELECT 1
        FROM eligible
        WHERE eligible.assistant_input_id = requested.assistant_input_id
      ) AS matched
    FROM requested
  `);

  return buildHostedIngressLatencySetWriteResult({
    assistantInputIds,
    rows,
  });
}

export async function recordHostedIngressAssistantMilestone(input: {
  assistantInputIds: readonly string[];
  at?: Date | string | null;
  authenticatedUserId: string;
  checkpointPublicationExpectedBy?: Date | string | null;
  milestone: HostedRuntimeAssistantMilestone;
  prisma?: HostedIngressLatencyPrismaClient;
  runtimeAttemptId?: string | null;
  runtimeLeaseGeneration: string;
  source: HostedIngressLatencySource | string;
}): Promise<HostedIngressLatencyWriteResult> {
  const prisma = input.prisma ?? getPrisma();
  const source = normalizeHostedIngressLatencySource(input.source);
  const at = normalizeDate(input.at, "Hosted ingress latency assistant milestone at");
  const assistantInputIds = [
    ...new Set(input.assistantInputIds.map((id) =>
      requireSafeLatencyIdentifier(id, "Hosted ingress latency assistantInputId")
    )),
  ].sort();
  const runtimeAttemptId = normalizeNullableLatencyIdentifier(input.runtimeAttemptId);
  const runtimeLeaseGeneration = normalizeHostedRuntimeLeaseGeneration(
    input.runtimeLeaseGeneration,
  );
  const checkpointPublicationExpectedBy = normalizeOptionalDate(
    input.checkpointPublicationExpectedBy,
    "Hosted ingress latency checkpoint publication expected by",
  );
  if (
    checkpointPublicationExpectedBy
    && input.milestone !== "terminal_non_reply_committed"
  ) {
    throw new TypeError(
      "Hosted ingress latency checkpoint publication expectation requires terminal_non_reply_committed.",
    );
  }

  if (assistantInputIds.length === 0 || !runtimeAttemptId) {
    return { matchedCount: 0, recorded: false, unmatchedCount: assistantInputIds.length };
  }

  const requestedIds = buildHostedIngressLatencyRequestedIdsSql(assistantInputIds);
  const terminalNonReplyProjection = input.milestone === "terminal_non_reply_committed";
  const nextPhaseBreakdown = terminalNonReplyProjection
    ? buildHostedIngressTerminalNonReplyPhaseBreakdownSql({
        hasCheckpointPublicationExpectedBy: checkpointPublicationExpectedBy !== null,
      })
    : buildHostedIngressOrdinaryAssistantMilestonePhaseBreakdownSql();
  const nextRuntimeAttemptId = terminalNonReplyProjection
    ? buildHostedIngressTerminalNonReplyRuntimeAttemptSql()
    : Prisma.sql`trace.runtime_attempt_id`;
  const ordinaryMilestoneLeaf = terminalNonReplyProjection
    ? null
    : readHostedIngressAssistantMilestoneLeaf(input.milestone);
  const rows = await prisma.$queryRaw<HostedIngressLatencySetWriteProjectionRow[]>(Prisma.sql`
    /* hosted_ingress_assistant_milestone_set_based */
    WITH input AS (
      SELECT
        ${input.authenticatedUserId}::text AS user_id,
        ${source}::text AS source,
        ${runtimeAttemptId}::text AS runtime_attempt_id,
        ${runtimeLeaseGeneration}::text AS runtime_lease_generation,
        ${at.getTime()}::bigint AS at_epoch_ms,
        ${checkpointPublicationExpectedBy?.getTime() ?? null}::bigint
          AS checkpoint_publication_expected_by_epoch_ms,
        ${ordinaryMilestoneLeaf?.leafKey ?? null}::text AS milestone_leaf,
        ${ordinaryMilestoneLeaf?.keepEarliest ?? false}::boolean AS keep_earliest,
        ${terminalNonReplyProjection}::boolean AS terminal_non_reply_projection,
        1::integer AS phase_schema_version,
        ${HOSTED_INGRESS_LATENCY_PHASE_LEAF_RULES_JSON}::jsonb AS phase_leaf_rules
    ),
    requested(assistant_input_id) AS (
      VALUES ${requestedIds}
    ),
    scoped AS (
      SELECT DISTINCT requested.assistant_input_id
      FROM requested
      CROSS JOIN input
      JOIN hosted_ingress_latency_trace AS trace
        ON trace.assistant_input_id = requested.assistant_input_id
       AND trace.user_id = input.user_id
       AND trace.source = input.source
    ),
    eligible AS (
      SELECT DISTINCT requested.assistant_input_id
      FROM requested
      CROSS JOIN input
      JOIN hosted_ingress_latency_trace AS trace
        ON trace.assistant_input_id = requested.assistant_input_id
       AND trace.user_id = input.user_id
       AND trace.source = input.source
       AND (
         input.terminal_non_reply_projection
         OR trace.runtime_attempt_id = input.runtime_attempt_id
       )
    ),
    updated AS (
      UPDATE hosted_ingress_latency_trace AS trace
      SET (
        runtime_attempt_id,
        phase_breakdown_json,
        updated_at
      ) = (
        SELECT
          next.runtime_attempt_id,
          next.phase_breakdown_json,
          statement_timestamp() AT TIME ZONE 'UTC'
        FROM (
          SELECT
            ${nextRuntimeAttemptId} AS runtime_attempt_id,
            ${nextPhaseBreakdown} AS phase_breakdown_json
        ) AS next
      )
      FROM requested, input
      WHERE trace.assistant_input_id = requested.assistant_input_id
        AND trace.user_id = input.user_id
        AND trace.source = input.source
        AND (
          input.terminal_non_reply_projection
          OR trace.runtime_attempt_id = input.runtime_attempt_id
        )
        AND (
          trace.runtime_attempt_id IS DISTINCT FROM ${nextRuntimeAttemptId}
          OR trace.phase_breakdown_json IS DISTINCT FROM ${nextPhaseBreakdown}
        )
      RETURNING trace.assistant_input_id AS "assistantInputId"
    )
    SELECT
      requested.assistant_input_id AS "assistantInputId",
      EXISTS (
        SELECT 1
        FROM scoped
        WHERE scoped.assistant_input_id = requested.assistant_input_id
      ) AS traced,
      EXISTS (
        SELECT 1
        FROM eligible
        WHERE eligible.assistant_input_id = requested.assistant_input_id
      ) AS matched
    FROM requested
  `);

  return buildHostedIngressLatencySetWriteResult({
    assistantInputIds,
    rows,
  });
}

type HostedIngressLatencySetWriteProjectionRow = {
  assistantInputId: string;
  matched: boolean;
  traced: boolean;
};

type HostedIngressLatencyProviderPhasePatch = {
  preProviderJson: string | null;
  providerJson: string | null;
  schemaVersion: number;
};

function buildHostedIngressLatencySetWriteResult(input: {
  assistantInputIds: readonly string[];
  rows: readonly HostedIngressLatencySetWriteProjectionRow[];
}): HostedIngressLatencyWriteResult {
  const matchedIds = new Set(input.rows
    .filter((row) => row.matched)
    .map((row) => row.assistantInputId));
  const tracedIds = new Set(input.rows
    .filter((row) => row.traced)
    .map((row) => row.assistantInputId));
  const unmatchedIds = input.assistantInputIds.filter((id) => !matchedIds.has(id));
  const untracedCount = unmatchedIds.filter((id) => !tracedIds.has(id)).length;

  return {
    matchedCount: matchedIds.size,
    recorded: matchedIds.size > 0,
    unmatchedCount: unmatchedIds.length,
    ...(untracedCount > 0 ? { untracedCount } : {}),
  };
}

function buildHostedIngressLatencyRequestedIdsSql(
  assistantInputIds: readonly string[],
): Prisma.Sql {
  return Prisma.join(
    assistantInputIds.map((assistantInputId) => Prisma.sql`(${assistantInputId}::text)`),
  );
}

function readHostedIngressLatencyProviderPhasePatch(
  phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown | null | undefined,
): HostedIngressLatencyProviderPhasePatch | null {
  if (!phaseBreakdown) {
    return null;
  }
  const validated = mergeHostedRuntimeLatencyPhaseBreakdownJson({
    existing: null,
    incoming: phaseBreakdown,
    phases: ["preProvider", "provider"],
  }).value;
  const schemaVersion = validated.schemaVersion;
  if (typeof schemaVersion !== "number") {
    throw new TypeError("Hosted ingress latency phaseBreakdown schemaVersion is invalid.");
  }
  return {
    preProviderJson: serializeHostedIngressLatencyPhase(validated.preProvider),
    providerJson: serializeHostedIngressLatencyPhase(validated.provider),
    schemaVersion,
  };
}

function serializeHostedIngressLatencyPhase(value: unknown): string | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? JSON.stringify(value)
    : null;
}

function buildHostedIngressProviderPhaseBreakdownSql(input: {
  hasPreProvider: boolean;
  hasProvider: boolean;
}): Prisma.Sql {
  const stored = Prisma.sql`trace.phase_breakdown_json`;
  const sanitizedObject = buildHostedIngressLatencySanitizedJsonObjectSql(stored);
  const object = Prisma.sql`sanitized.object`;
  let patch = buildHostedIngressLatencySchemaPatchSql(object);
  if (input.hasPreProvider) {
    const existing = buildHostedIngressLatencyJsonObjectSql(
      Prisma.sql`${object} -> 'preProvider'`,
    );
    patch = Prisma.sql`${patch} || jsonb_build_object(
      'preProvider',
      input.pre_provider_json || ${existing}
    )`;
  }
  if (input.hasProvider) {
    const existing = buildHostedIngressLatencyJsonObjectSql(
      Prisma.sql`${object} -> 'provider'`,
    );
    patch = Prisma.sql`${patch} || jsonb_build_object(
      'provider',
      input.provider_json || ${existing}
    )`;
  }
  return Prisma.sql`(
    SELECT ${object} || ${patch}
    FROM (SELECT ${sanitizedObject} AS object) AS sanitized
  )`;
}

function buildHostedIngressOrdinaryAssistantMilestonePhaseBreakdownSql(): Prisma.Sql {
  const stored = Prisma.sql`trace.phase_breakdown_json`;
  const sanitizedObject = buildHostedIngressLatencySanitizedJsonObjectSql(stored);
  const object = Prisma.sql`sanitized.object`;
  const assistant = buildHostedIngressLatencyJsonObjectSql(
    Prisma.sql`${object} -> 'assistant'`,
  );
  const leaf = Prisma.sql`${assistant} -> input.milestone_leaf`;
  const safeLeaf = buildHostedIngressLatencySafeJsonIntegerPredicateSql(leaf);
  const leafText = Prisma.sql`(${leaf}) #>> '{}'`;
  const leafPatch = Prisma.sql`CASE
    WHEN ${safeLeaf} AND NOT input.keep_earliest THEN '{}'::jsonb
    ELSE jsonb_build_object(
      input.milestone_leaf,
      CASE
        WHEN ${safeLeaf} AND input.keep_earliest
        THEN LEAST((${leafText})::bigint, input.at_epoch_ms)
        ELSE input.at_epoch_ms
      END
    )
  END`;
  return Prisma.sql`(
    SELECT ${object}
      || ${buildHostedIngressLatencySchemaPatchSql(object)}
      || jsonb_build_object('assistant', ${assistant} || ${leafPatch})
    FROM (SELECT ${sanitizedObject} AS object) AS sanitized
  )`;
}

function buildHostedIngressTerminalNonReplyPhaseBreakdownSql(input: {
  hasCheckpointPublicationExpectedBy: boolean;
}): Prisma.Sql {
  const stored = Prisma.sql`trace.phase_breakdown_json`;
  const sanitizedObject = buildHostedIngressLatencySanitizedJsonObjectSql(stored);
  const object = Prisma.sql`sanitized.object`;
  const assistant = buildHostedIngressLatencyJsonObjectSql(
    Prisma.sql`${object} -> 'assistant'`,
  );
  const storedGeneration = buildHostedIngressLatencyStoredLeaseGenerationSql(assistant);
  const incomingGeneration = Prisma.sql`input.runtime_lease_generation::numeric`;
  const newerLease = Prisma.sql`(
    ${storedGeneration} IS NULL
    OR ${storedGeneration} < ${incomingGeneration}
  )`;
  const mayWrite = Prisma.sql`(
    ${newerLease}
    OR (
      ${storedGeneration} = ${incomingGeneration}
      AND trace.runtime_attempt_id = input.runtime_attempt_id
    )
  )`;
  let assistantPatch = Prisma.sql`jsonb_build_object(
    'terminalNonReplyCommittedAtEpochMs',
    ${buildHostedIngressLatencyMaxEpochMsValueSql({
      assistant,
      incomingEpochMs: Prisma.sql`input.at_epoch_ms`,
      leafKey: "terminalNonReplyCommittedAtEpochMs",
    })},
    'runtimeLeaseGeneration',
    input.runtime_lease_generation
  )`;
  if (input.hasCheckpointPublicationExpectedBy) {
    assistantPatch = Prisma.sql`${assistantPatch} || jsonb_build_object(
      'checkpointPublicationExpectedByEpochMs',
      ${buildHostedIngressLatencyMaxEpochMsValueSql({
        assistant,
        incomingEpochMs: Prisma.sql`input.checkpoint_publication_expected_by_epoch_ms`,
        leafKey: "checkpointPublicationExpectedByEpochMs",
      })}
    )`;
  }
  const merged = Prisma.sql`${object}
    || ${buildHostedIngressLatencySchemaPatchSql(object)}
    || jsonb_build_object('assistant', ${assistant} || ${assistantPatch})`;
  return Prisma.sql`(
    SELECT CASE
      WHEN ${mayWrite} THEN ${merged}
      ELSE ${stored}
    END
    FROM (SELECT ${sanitizedObject} AS object) AS sanitized
  )`;
}

function buildHostedIngressTerminalNonReplyRuntimeAttemptSql(): Prisma.Sql {
  const stored = Prisma.sql`trace.phase_breakdown_json`;
  const object = buildHostedIngressLatencyJsonObjectSql(stored);
  const assistant = buildHostedIngressLatencyJsonObjectSql(
    Prisma.sql`${object} -> 'assistant'`,
  );
  const storedGeneration = buildHostedIngressLatencyStoredLeaseGenerationSql(assistant);
  return Prisma.sql`CASE
    WHEN ${storedGeneration} IS NULL
      OR ${storedGeneration} < input.runtime_lease_generation::numeric
    THEN input.runtime_attempt_id
    ELSE trace.runtime_attempt_id
  END`;
}

function buildHostedIngressLatencyMaxEpochMsValueSql(input: {
  assistant: Prisma.Sql;
  incomingEpochMs: Prisma.Sql;
  leafKey:
    | "checkpointPublicationExpectedByEpochMs"
    | "terminalNonReplyCommittedAtEpochMs";
}): Prisma.Sql {
  const leaf = input.leafKey === "terminalNonReplyCommittedAtEpochMs"
    ? Prisma.sql`${input.assistant} -> 'terminalNonReplyCommittedAtEpochMs'`
    : Prisma.sql`${input.assistant} -> 'checkpointPublicationExpectedByEpochMs'`;
  const safeLeaf = buildHostedIngressLatencySafeJsonIntegerPredicateSql(leaf);
  const leafText = Prisma.sql`(${leaf}) #>> '{}'`;
  return Prisma.sql`CASE
    WHEN ${safeLeaf}
    THEN GREATEST((${leafText})::bigint, ${input.incomingEpochMs})
    ELSE ${input.incomingEpochMs}
  END`;
}

function buildHostedIngressLatencyJsonObjectSql(value: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN jsonb_typeof(${value}) = 'object' THEN ${value}
    ELSE '{}'::jsonb
  END`;
}

function buildHostedIngressLatencySanitizedJsonObjectSql(
  value: Prisma.Sql,
): Prisma.Sql {
  const normalizedObject = buildHostedIngressLatencyJsonObjectSql(value);
  const object = Prisma.sql`stored.object`;
  const schemaVersion = Prisma.sql`${object} -> 'schemaVersion'`;
  const safeSchemaVersion = buildHostedIngressLatencySafeJsonIntegerPredicateSql(
    schemaVersion,
  );
  return Prisma.sql`(
    SELECT COALESCE(
      (
        SELECT jsonb_object_agg(
          sanitized_phase.phase_key,
          sanitized_phase.phase_value
        )
        FROM (
          SELECT
            phase.key AS phase_key,
            jsonb_object_agg(leaf.key, leaf.value) AS phase_value
          FROM jsonb_each(${object}) AS phase(key, value)
          CROSS JOIN LATERAL jsonb_each(
            CASE
              WHEN jsonb_typeof(phase.value) = 'object' THEN phase.value
              ELSE '{}'::jsonb
            END
          ) AS leaf(key, value)
          WHERE CASE
            input.phase_leaf_rules -> phase.key -> leaf.key ->> 'kind'
            WHEN 'safe_integer'
            THEN ${buildHostedIngressLatencySafeJsonIntegerPredicateSql(
              Prisma.sql`leaf.value`,
            )}
            WHEN 'boolean'
            THEN jsonb_typeof(leaf.value) = 'boolean'
            WHEN 'enum_string'
            THEN jsonb_typeof(leaf.value) = 'string'
              AND (
                input.phase_leaf_rules -> phase.key -> leaf.key -> 'values'
              ) ? (leaf.value #>> '{}')
            WHEN 'lease_generation'
            THEN jsonb_typeof(leaf.value) = 'string'
              AND (leaf.value #>> '{}') ~ '^(0|[1-9][0-9]{0,19})$'
            WHEN 'orchestration_attempt_id'
            THEN jsonb_typeof(leaf.value) = 'string'
              AND (leaf.value #>> '{}')
                ~ '^web-ingress-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            ELSE FALSE
          END
          GROUP BY phase.key
        ) AS sanitized_phase
      ),
      '{}'::jsonb
    ) || CASE
      WHEN ${safeSchemaVersion}
      THEN jsonb_build_object('schemaVersion', ${schemaVersion})
      ELSE '{}'::jsonb
    END
    FROM (SELECT ${normalizedObject} AS object) AS stored
  )`;
}

function buildHostedIngressLatencySchemaPatchSql(object: Prisma.Sql): Prisma.Sql {
  const schemaVersion = Prisma.sql`${object} -> 'schemaVersion'`;
  const safeSchemaVersion = buildHostedIngressLatencySafeJsonIntegerPredicateSql(
    schemaVersion,
  );
  return Prisma.sql`CASE
    WHEN ${safeSchemaVersion} THEN '{}'::jsonb
    ELSE jsonb_build_object('schemaVersion', input.phase_schema_version)
  END`;
}

function buildHostedIngressLatencySafeJsonIntegerPredicateSql(
  value: Prisma.Sql,
): Prisma.Sql {
  const scalar = Prisma.sql`(${value}) #>> '{}'`;
  return Prisma.sql`CASE
    WHEN jsonb_typeof(${value}) = 'number'
    THEN (
      (${scalar})::numeric >= 0
      AND trunc((${scalar})::numeric) = (${scalar})::numeric
      AND (${scalar})::numeric <= 9007199254740991
    )
    ELSE FALSE
  END`;
}

function buildHostedIngressLatencyStoredLeaseGenerationSql(
  assistant: Prisma.Sql,
): Prisma.Sql {
  const value = Prisma.sql`${assistant} -> 'runtimeLeaseGeneration'`;
  const scalar = Prisma.sql`${assistant} ->> 'runtimeLeaseGeneration'`;
  return Prisma.sql`CASE
    WHEN jsonb_typeof(${value}) = 'string'
      AND ${scalar} ~ '^(0|[1-9][0-9]{0,19})$'
    THEN (${scalar})::numeric
    ELSE NULL::numeric
  END`;
}

function readHostedIngressAssistantMilestoneLeaf(
  milestone: HostedRuntimeAssistantMilestone,
): { keepEarliest: boolean; leafKey: string } {
  switch (milestone) {
    case "linq_typing_request_started":
      return { keepEarliest: false, leafKey: "linqTypingRequestStartedAtEpochMs" };
    case "linq_typing_accepted":
      return { keepEarliest: false, leafKey: "linqTypingAcceptedAtEpochMs" };
    case "progress_update_accepted":
      return { keepEarliest: true, leafKey: "progressUpdateAcceptedAtEpochMs" };
    case "first_codex_output_observed":
      return { keepEarliest: false, leafKey: "firstCodexOutputObservedAtEpochMs" };
    case "first_codex_text_observed":
      return { keepEarliest: false, leafKey: "firstCodexTextObservedAtEpochMs" };
    case "terminal_non_reply_committed":
      throw new TypeError("Terminal non-reply milestones do not use an ordinary assistant leaf.");
  }
}

export async function recordHostedIngressRuntimeMilestone(input: {
  at?: Date | string | null;
  authenticatedUserId: string;
  milestone: HostedRuntimeLatencyTraceMilestone;
  prisma?: HostedIngressLatencyPrismaClient;
  runtimeAttemptId?: string | null;
  runtimeLeaseGeneration: string;
  source: HostedIngressLatencySource | string;
}): Promise<HostedIngressLatencyWriteResult> {
  const prisma = input.prisma ?? getPrisma();
  const source = normalizeHostedIngressLatencySource(input.source);
  const at = normalizeDate(input.at, "Hosted ingress latency runtime milestone at");
  const runtimeAttemptId = normalizeNullableLatencyIdentifier(input.runtimeAttemptId);
  const runtimeLeaseGeneration = normalizeHostedRuntimeLeaseGeneration(
    input.runtimeLeaseGeneration,
  );
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
    runtimeLeaseGeneration,
    source,
    userId,
  });

  return {
    matchedCount,
    recorded: matchedCount > 0,
    unmatchedCount: 0,
  };
}

export async function linkHostedIngressLatencyTracesToAcceptedLinqDelivery(input: {
  authenticatedUserId: string;
  answeredMailboxItemIds: readonly string[];
  linqDeliveryId: string;
  prisma?: HostedIngressLatencyPrismaClient;
  replyRuntimeAttemptId: string;
}): Promise<HostedIngressLatencyDeliveryLinkResult> {
  const authenticatedUserId = requireSafeLatencyIdentifier(
    input.authenticatedUserId,
    "Hosted ingress latency delivery-link user id",
  );
  const linqDeliveryId = requireSafeLatencyIdentifier(
    input.linqDeliveryId,
    "Hosted ingress latency Linq delivery id",
  );
  const replyRuntimeAttemptId = requireSafeLatencyIdentifier(
    input.replyRuntimeAttemptId,
    "Hosted ingress latency reply runtime attempt id",
  );
  const answeredMailboxItemIds = [
    ...new Set(input.answeredMailboxItemIds.map((mailboxItemId) =>
      requireSafeLatencyIdentifier(
        mailboxItemId,
        "Hosted ingress latency answered mailbox item id",
      )
    )),
  ];

  if (answeredMailboxItemIds.length === 0) {
    return { matchedCount: 0, recorded: false };
  }

  const prisma = input.prisma ?? getPrisma();
  const candidates = Prisma.join(
    answeredMailboxItemIds.map((mailboxItemId) =>
      Prisma.sql`(CAST(${randomUUID()} AS text), CAST(${mailboxItemId} AS text))`
    ),
  );
  const linkedRows = await prisma.$queryRaw<Array<{ mailboxItemId: string }>>(Prisma.sql`
    INSERT INTO hosted_ingress_latency_trace (
      id,
      user_id,
      source,
      mailbox_item_id,
      mailbox_lane,
      mailbox_lane_seq,
      runtime_attempt_id,
      reply_runtime_attempt_id,
      linq_delivery_id,
      accepted_at,
      created_at,
      updated_at
    )
    SELECT
      candidate.trace_id,
      mailbox.user_id,
      'linq',
      mailbox.id,
      mailbox.lane,
      mailbox.lane_seq,
      NULL,
      ${replyRuntimeAttemptId},
      ${linqDeliveryId},
      mailbox.created_at,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM (VALUES ${candidates}) AS candidate(trace_id, mailbox_item_id)
    INNER JOIN hosted_mailbox_item AS mailbox
      ON mailbox.id = candidate.mailbox_item_id
    WHERE mailbox.user_id = ${authenticatedUserId}
      AND mailbox.lane = 'conversation'
      AND mailbox.kind = 'conversation.message'
    ON CONFLICT (mailbox_item_id) DO UPDATE SET
      reply_runtime_attempt_id = EXCLUDED.reply_runtime_attempt_id,
      linq_delivery_id = EXCLUDED.linq_delivery_id,
      updated_at = CURRENT_TIMESTAMP
    WHERE hosted_ingress_latency_trace.user_id = EXCLUDED.user_id
      AND hosted_ingress_latency_trace.source = EXCLUDED.source
      AND hosted_ingress_latency_trace.reply_runtime_attempt_id IS NULL
      AND hosted_ingress_latency_trace.linq_delivery_id IS NULL
    RETURNING mailbox_item_id AS "mailboxItemId"
  `);

  return {
    matchedCount: linkedRows.length,
    recorded: linkedRows.length > 0,
  };
}

export async function readHostedIngressLatencyDashboard(
  input: HostedIngressLatencyDashboardInput = {},
): Promise<HostedIngressLatencyDashboard> {
  const source = normalizeHostedIngressLatencySource(input.source ?? "linq");
  const now = input.now ?? new Date();
  const windowHours = normalizeDashboardWindowHours(input.windowHours);
  const limit = normalizeDashboardSlowLimit(input.limit);
  const inFlightGraceMs = normalizeDashboardInFlightGraceMs(input.inFlightGraceMs);
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60_000);
  const inFlightCutoff = new Date(now.getTime() - inFlightGraceMs);
  const query = {
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
          lastReceiptAt: true,
          sourceRef: true,
          status: true,
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
  } satisfies Prisma.HostedIngressLatencyTraceFindManyArgs;
  const rows = input.prisma
    ? await input.prisma.hostedIngressLatencyTrace.findMany(query)
    : await getPrisma().hostedIngressLatencyTrace.findMany(query);
  const truncated = rows.length > HOSTED_INGRESS_LATENCY_READ_ROW_LIMIT;
  const visibleRows = truncated ? rows.slice(0, HOSTED_INGRESS_LATENCY_READ_ROW_LIMIT) : rows;
  const runtimeAttemptIds: string[] = source === "linq"
    ? [...new Set<string>(visibleRows.flatMap((row): string[] =>
        row.linqDeliveryId
          && row.linqDelivery
          && row.replyRuntimeAttemptId
          && row.providerStartAt
          && typeof row.providerRequestOrdinal === "number"
          && typeof row.runtimeAttemptId === "string"
          ? [row.runtimeAttemptId]
          : []
      ))]
    : [];
  const timingLogs = await readHostedIngressLatencyTimingLogs({
    from: new Date(
      windowStart.getTime() - HOSTED_INGRESS_LATENCY_TIMING_LOG_WINDOW_PADDING_MS,
    ),
    runtimeAttemptIds,
    to: new Date(
      now.getTime() + HOSTED_INGRESS_LATENCY_TIMING_LOG_WINDOW_PADDING_MS,
    ),
  });
  const timingLogTruncated = timingLogs.truncated;
  const turnTimingIndex = timingLogTruncated
    ? new Map<string, HostedTurnTimingIndexEntry[]>()
    : buildHostedTurnTimingIndex(timingLogs.rows);
  const completedDurations: number[] = [];
  const acceptedToSignalDurations: number[] = [];
  const acceptedToStagedDurations: number[] = [];
  const stagedToProviderDurations: number[] = [];
  const acceptedToTypingRequestDurations: number[] = [];
  const typingRequestToAcceptedDurations: number[] = [];
  const codexStartToFirstOutputDurations: number[] = [];
  const codexStartToFirstTextDurations: number[] = [];
  const recentSlowRows: HostedIngressLatencyDashboardSlowRow[] = [];
  let invalidNegativeLatencyCount = 0;
  let missingStagedCount = 0;
  let missingProviderStartCount = 0;
  let recentInFlightCount = 0;
  let stagedButMissingProviderCount = 0;
  let providerRowsWithoutAcceptedDeliveryLinkCount = 0;

  for (const row of visibleRows) {
    const acceptedAtMs = row.acceptedAt.getTime();
    const providerStartMs = row.providerStartAt?.getTime() ?? null;
    const stagedAtMs = row.assistantInputStagedAt?.getTime() ?? null;
    const signalAtMs = row.temporalSignalAcceptedAt?.getTime() ?? null;
    const typingRequestAtMs = readLatencyPhaseEpochMs(
      row.phaseBreakdownJson,
      "assistant",
      "linqTypingRequestStartedAtEpochMs",
    );
    const typingAcceptedAtMs = readLatencyPhaseEpochMs(
      row.phaseBreakdownJson,
      "assistant",
      "linqTypingAcceptedAtEpochMs",
    );
    const firstCodexOutputAtMs = readLatencyPhaseEpochMs(
      row.phaseBreakdownJson,
      "assistant",
      "firstCodexOutputObservedAtEpochMs",
    );
    const firstCodexTextAtMs = readLatencyPhaseEpochMs(
      row.phaseBreakdownJson,
      "assistant",
      "firstCodexTextObservedAtEpochMs",
    );
    const mature = row.acceptedAt <= inFlightCutoff;
    if (
      source === "linq"
      && mature
      && providerStartMs !== null
      && !row.linqDeliveryId
    ) {
      providerRowsWithoutAcceptedDeliveryLinkCount += 1;
    }
    const missingStaged = stagedAtMs === null;
    const hasNegativeSignal = signalAtMs !== null && signalAtMs < acceptedAtMs;
    const hasNegativeStaged = stagedAtMs !== null && stagedAtMs < acceptedAtMs;
    const hasNegativeProviderWait =
      stagedAtMs !== null && providerStartMs !== null && providerStartMs < stagedAtMs;
    const hasNegativeObservedMilestone =
      (typingRequestAtMs !== null && typingRequestAtMs < acceptedAtMs)
      || (
        typingRequestAtMs !== null
        && typingAcceptedAtMs !== null
        && typingAcceptedAtMs < typingRequestAtMs
      )
      || (
        providerStartMs !== null
        && firstCodexOutputAtMs !== null
        && firstCodexOutputAtMs < providerStartMs
      )
      || (
        providerStartMs !== null
        && firstCodexTextAtMs !== null
        && firstCodexTextAtMs < providerStartMs
      );

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
    if (typingRequestAtMs !== null && typingRequestAtMs >= acceptedAtMs) {
      acceptedToTypingRequestDurations.push(typingRequestAtMs - acceptedAtMs);
    }
    if (
      typingRequestAtMs !== null
      && typingAcceptedAtMs !== null
      && typingAcceptedAtMs >= typingRequestAtMs
    ) {
      typingRequestToAcceptedDurations.push(typingAcceptedAtMs - typingRequestAtMs);
    }
    if (
      providerStartMs !== null
      && firstCodexOutputAtMs !== null
      && firstCodexOutputAtMs >= providerStartMs
    ) {
      codexStartToFirstOutputDurations.push(firstCodexOutputAtMs - providerStartMs);
    }
    if (
      providerStartMs !== null
      && firstCodexTextAtMs !== null
      && firstCodexTextAtMs >= providerStartMs
    ) {
      codexStartToFirstTextDurations.push(firstCodexTextAtMs - providerStartMs);
    }

    if (providerStartMs === null) {
      if (hasNegativeSignal || hasNegativeStaged || hasNegativeObservedMilestone) {
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
      || hasNegativeObservedMilestone
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
  const acceptedToLinqReceiptDurations: number[] = [];
  const coldAcceptedToLinqAcceptedDurations: number[] = [];
  const linqAcceptedToReceiptDurations: number[] = [];
  const linqAttemptedToAcceptedDurations: number[] = [];
  const providerRequestDurations: number[] = [];
  const providerResultToReplyIntentDurations: number[] = [];
  const codexStartToLinqAttemptedDurations: number[] = [];
  const replyIntentToLinqAttemptedDurations: number[] = [];
  const warmAcceptedToLinqAcceptedDurations: number[] = [];
  type DashboardRow = (typeof visibleRows)[number];
  type LinkedReplyDashboardRow = DashboardRow & {
    linqDelivery: NonNullable<DashboardRow["linqDelivery"]>;
    linqDeliveryId: string;
    replyRuntimeAttemptId: string;
  };
  type ProviderReplyDashboardRow = LinkedReplyDashboardRow & {
    providerRequestOrdinal: number;
    providerStartAt: Date;
    runtimeAttemptId: string;
  };
  const linkedRowsByDeliveryId = new Map<
    string,
    LinkedReplyDashboardRow[]
  >();
  let acceptedMissingReceiptCount = 0;
  let ambiguousTimingCount = 0;
  let deliveryAttemptHandoffCount = 0;
  let invalidReplyNegativeLatencyCount = 0;
  let missingAcceptedDeliveryCount = 0;
  let unknownColdStateCount = 0;

  for (const row of visibleRows) {
    const deliveryId = row.linqDeliveryId;
    if (
      source !== "linq"
      || !deliveryId
      || !row.replyRuntimeAttemptId
      || !row.linqDelivery
    ) {
      continue;
    }
    const linkedRow: LinkedReplyDashboardRow = {
      ...row,
      linqDelivery: row.linqDelivery,
      linqDeliveryId: deliveryId,
      replyRuntimeAttemptId: row.replyRuntimeAttemptId,
    };
    const linkedRows = linkedRowsByDeliveryId.get(deliveryId) ?? [];
    linkedRows.push(linkedRow);
    linkedRowsByDeliveryId.set(deliveryId, linkedRows);
  }

  for (const linkedRows of linkedRowsByDeliveryId.values()) {
    if (linkedRows.some((candidate) =>
      candidate.runtimeAttemptId
      && candidate.runtimeAttemptId !== candidate.replyRuntimeAttemptId
    )) {
      deliveryAttemptHandoffCount += 1;
    }
    const row = linkedRows.reduce((oldest, candidate) =>
      candidate.acceptedAt < oldest.acceptedAt ? candidate : oldest
    );
    const providerRows = linkedRows.filter(
      (candidate): candidate is ProviderReplyDashboardRow =>
        typeof candidate.runtimeAttemptId === "string"
        && typeof candidate.providerRequestOrdinal === "number"
        && candidate.providerStartAt instanceof Date,
    );
    const providerTimingKeys = new Set(providerRows.map((candidate) =>
      `${candidate.runtimeAttemptId}:${candidate.providerRequestOrdinal}:${candidate.providerStartAt.getTime()}`
    ));
    const providerRow = providerTimingKeys.size === 1
      ? providerRows[0] ?? null
      : null;

    const deliveryAcceptedAtMs = row.linqDelivery.acceptedAt?.getTime() ?? null;
    const deliveryAttemptedAtMs = row.linqDelivery.attemptedAt.getTime();
    const deliveryReceiptAtMs = (
      row.linqDelivery.status === "delivered"
      || row.linqDelivery.status === "failed"
    )
      ? row.linqDelivery.lastReceiptAt?.getTime() ?? null
      : null;
    const ingressAcceptedAtMs = row.acceptedAt.getTime();
    const providerStartAtMs = providerRow?.providerStartAt?.getTime() ?? null;

    if (deliveryAcceptedAtMs === null) {
      missingAcceptedDeliveryCount += 1;
      continue;
    }

    const acceptedToLinqAcceptedMs = deliveryAcceptedAtMs - ingressAcceptedAtMs;
    const linqAttemptedToAcceptedMs = deliveryAcceptedAtMs - deliveryAttemptedAtMs;
    const codexStartToLinqAttemptedMs = providerStartAtMs === null
      ? null
      : deliveryAttemptedAtMs - providerStartAtMs;
    const linqAcceptedToReceiptMs = deliveryReceiptAtMs === null
      ? null
      : deliveryReceiptAtMs - deliveryAcceptedAtMs;
    const acceptedToLinqReceiptMs = deliveryReceiptAtMs === null
      ? null
      : deliveryReceiptAtMs - ingressAcceptedAtMs;
    const replyDurations = [
      acceptedToLinqAcceptedMs,
      linqAttemptedToAcceptedMs,
      codexStartToLinqAttemptedMs,
      linqAcceptedToReceiptMs,
      acceptedToLinqReceiptMs,
    ].filter((value): value is number => value !== null);

    if (replyDurations.some((value) => value < 0)) {
      invalidReplyNegativeLatencyCount += 1;
      continue;
    }

    acceptedToLinqAcceptedDurations.push(acceptedToLinqAcceptedMs);
    linqAttemptedToAcceptedDurations.push(linqAttemptedToAcceptedMs);
    if (codexStartToLinqAttemptedMs !== null) {
      codexStartToLinqAttemptedDurations.push(codexStartToLinqAttemptedMs);
    }
    if (linqAcceptedToReceiptMs !== null && acceptedToLinqReceiptMs !== null) {
      linqAcceptedToReceiptDurations.push(linqAcceptedToReceiptMs);
      acceptedToLinqReceiptDurations.push(acceptedToLinqReceiptMs);
    } else if (
      row.linqDelivery.status === "accepted"
      && deliveryAcceptedAtMs <= inFlightCutoff.getTime()
    ) {
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

    if (!providerRow || providerStartAtMs === null) {
      ambiguousTimingCount += 1;
      continue;
    }
    const turnTiming = readUnambiguousHostedTurnTiming(
      turnTimingIndex,
      providerRow.runtimeAttemptId,
      row.linqDelivery.sourceRef,
      providerRow.providerRequestOrdinal,
    );
    if (!turnTiming) {
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
    observedMilestoneLatency: {
      acceptedToTypingRequest: latencyObservation(acceptedToTypingRequestDurations),
      codexStartToFirstOutput: latencyObservation(codexStartToFirstOutputDurations),
      codexStartToFirstText: latencyObservation(codexStartToFirstTextDurations),
      typingRequestToAccepted: latencyObservation(typingRequestToAcceptedDurations),
    },
    source,
    stageLatencyMs: {
      acceptedToStagedP50: percentile(acceptedToStagedDurations, 0.5),
      acceptedToTemporalSignalP50: percentile(acceptedToSignalDurations, 0.5),
      stagedToProviderStartP50: percentile(stagedToProviderDurations, 0.5),
    },
    replyLatencyMs: {
      acceptedToLinqAccepted: summarizeLatencyDistribution(
        acceptedToLinqAcceptedDurations,
      ),
      acceptedToLinqReceipt: summarizeLatencyDistribution(
        acceptedToLinqReceiptDurations,
      ),
      codexStartToLinqAttempted: summarizeLatencyDistribution(
        codexStartToLinqAttemptedDurations,
      ),
      coldAcceptedToLinqAccepted: summarizeLatencyDistribution(
        coldAcceptedToLinqAcceptedDurations,
      ),
      linqAcceptedToReceipt: summarizeLatencyDistribution(
        linqAcceptedToReceiptDurations,
      ),
      linqAttemptedToAccepted: summarizeLatencyDistribution(
        linqAttemptedToAcceptedDurations,
      ),
      providerRequest: summarizeLatencyDistribution(providerRequestDurations),
      providerResultToReplyIntent: summarizeLatencyDistribution(
        providerResultToReplyIntentDurations,
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
      deliveryAttemptHandoffCount,
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

async function readHostedIngressLatencyTimingLogs(input: {
  from: Date;
  runtimeAttemptIds: readonly string[];
  to: Date;
}) {
  if (input.runtimeAttemptIds.length === 0) {
    return { rows: [], truncated: false };
  }

  const readLimit = HOSTED_INGRESS_LATENCY_TIMING_LOG_READ_LIMIT + 1;
  const dedicatedRead = await readDedicatedHostedRuntimeTimingLogsBestEffort({
    attemptIds: input.runtimeAttemptIds,
    from: input.from,
    limit: readLimit,
    to: input.to,
  });
  return {
    rows: dedicatedRead.rows.slice(0, HOSTED_INGRESS_LATENCY_TIMING_LOG_READ_LIMIT),
    truncated:
      dedicatedRead.unavailable
      || dedicatedRead.rows.length > HOSTED_INGRESS_LATENCY_TIMING_LOG_READ_LIMIT,
  };
}

async function readDedicatedHostedRuntimeTimingLogsBestEffort(input: {
  attemptIds: readonly string[];
  from: Date;
  limit: number;
  to: Date;
}) {
  try {
    if (!isHostedRuntimeLogDatabaseConfigured()) {
      return { rows: [], unavailable: false };
    }
    return {
      rows: await listHostedRuntimeTurnTimingLogs(input),
      unavailable: false,
    };
  } catch (error) {
    console.warn("Hosted latency isolated timing-log read failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_RUNTIME_LATENCY_TIMING_LOG_READ_FAILED",
      }),
    });
    return { rows: [], unavailable: true };
  }
}

type HostedTurnTimingIndexEntry = {
  providerRequestElapsedMs: number;
  providerRequestOrdinal: number;
  sinceProviderResultMs: number;
};

type HostedTurnTimingIndex = Map<string, HostedTurnTimingIndexEntry[]>;

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
    const key = buildHostedTurnTimingIndexKey(row.attemptId, timing.deliverySourceRef);
    const entries = index.get(key) ?? [];
    entries.push({
      providerRequestElapsedMs: timing.providerRequestElapsedMs,
      providerRequestOrdinal: timing.providerRequestOrdinal,
      sinceProviderResultMs: timing.sinceProviderResultMs,
    });
    index.set(key, entries);
  }
  return index;
}

function readUnambiguousHostedTurnTiming(
  index: HostedTurnTimingIndex,
  runtimeAttemptId: string,
  deliverySourceRef: string | null,
  providerRequestOrdinal: number | null,
): { providerRequestElapsedMs: number; sinceProviderResultMs: number } | null {
  if (!deliverySourceRef || providerRequestOrdinal === null) {
    return null;
  }
  const entries = index.get(
    buildHostedTurnTimingIndexKey(runtimeAttemptId, deliverySourceRef),
  );
  if (
    !entries
    || entries.length !== 1
    || entries[0]?.providerRequestOrdinal !== providerRequestOrdinal
  ) {
    return null;
  }
  return entries[0]!;
}

function buildHostedTurnTimingIndexKey(
  runtimeAttemptId: string,
  deliverySourceRef: string,
): string {
  return `${runtimeAttemptId}\0${deliverySourceRef}`;
}

function readHostedTurnTimingLog(value: unknown): {
  deliverySourceRef: string;
  providerRequestElapsedMs: number;
  providerRequestOrdinal: number;
  sinceProviderResultMs: number;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== HOSTED_ASSISTANT_TURN_TIMING_SCHEMA
    || record.type !== HOSTED_ASSISTANT_TURN_TIMING_TYPE
  ) {
    return null;
  }
  if (
    record.turnTimingStage !== "reply-dispatched"
    || record.deliveryIntentPresent !== true
    || record.deliveryOutcomeKind !== "queued"
    || record.finalReplySelected !== true
  ) {
    return null;
  }
  const deliveryIntentId = readHostedTurnTimingIdentifier(
    record.turnTimingDeliveryIntentId,
  );
  const deliverySourceRef = createHostedLinqDeliverySourceRefLookupKey(deliveryIntentId);
  const providerRequestElapsedMs = readHostedTurnTimingSafeInteger(
    record.turnTimingProviderRequestElapsedMs,
  );
  const providerRequestOrdinal = readHostedTurnTimingSafeInteger(
    record.providerRequestOrdinal,
  );
  const sinceProviderResultMs = readHostedTurnTimingSafeInteger(
    record.turnTimingSinceProviderResultMs,
  );
  return deliverySourceRef === null
      || providerRequestElapsedMs === null
      || providerRequestOrdinal === null
      || sinceProviderResultMs === null
    ? null
    : {
        deliverySourceRef,
        providerRequestElapsedMs,
        providerRequestOrdinal,
        sinceProviderResultMs,
      };
}

function readHostedTurnTimingSafeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function readHostedTurnTimingIdentifier(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/u.test(value)
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

function latencyObservation(durations: readonly number[]): HostedIngressLatencyObservation {
  return {
    observationCount: durations.length,
    p50Ms: percentile(durations, 0.5),
  };
}

function readLatencyPhaseEpochMs(
  value: unknown,
  phase: string,
  leaf: string,
): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const phaseValue = (value as Record<string, unknown>)[phase];
  if (typeof phaseValue !== "object" || phaseValue === null || Array.isArray(phaseValue)) {
    return null;
  }
  const leafValue = (phaseValue as Record<string, unknown>)[leaf];
  return typeof leafValue === "number" && Number.isSafeInteger(leafValue) && leafValue >= 0
    ? leafValue
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
    runtimeLeaseGeneration: string;
    source: HostedIngressLatencySource;
    userId: string;
  },
): Promise<number> {
  if (input.milestone === "checkpoint_publication_expected_by") {
    const rows = await prisma.hostedIngressLatencyTrace.findMany({
      select: { id: true },
      where: {
        assistantInputId: { not: null },
        mailboxItem: {
          consumedAt: null,
        },
        source: input.source,
        userId: input.userId,
      },
    });
    let matchedCount = 0;
    for (const row of rows) {
      if (
        await updateHostedIngressCheckpointPublicationExpectedByLocked(prisma, {
          expectedBy: input.at,
          runtimeAttemptId: input.runtimeAttemptId,
          runtimeLeaseGeneration: input.runtimeLeaseGeneration,
          traceId: row.id,
        })
      ) {
        matchedCount += 1;
      }
    }
    return matchedCount;
  }

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
  milestone: Exclude<
    HostedRuntimeLatencyTraceMilestone,
    "checkpoint_publication_expected_by"
  >,
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
          "import",
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

async function updateHostedIngressCheckpointPublicationExpectedByLocked(
  prisma: HostedIngressLatencyPrismaClient,
  input: {
    expectedBy: Date;
    runtimeAttemptId: string;
    runtimeLeaseGeneration: string;
    traceId: string;
  },
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const trace = await readHostedIngressLatencyTraceForUpdate(tx, input.traceId);
    if (!trace) {
      return false;
    }
    const hasTerminalNonReplyEvidence =
      readHostedRuntimeTerminalNonReplyCommittedAtEpochMs(
        trace.phaseBreakdownJson,
      ) !== null;
    if (
      !hasTerminalNonReplyEvidence
      && trace.runtimeAttemptId !== input.runtimeAttemptId
    ) {
      return false;
    }

    const storedRuntimeLeaseGeneration =
      readHostedRuntimeLatencyLeaseGeneration(trace.phaseBreakdownJson);
    const leaseGenerationComparison = storedRuntimeLeaseGeneration === null
      ? 1
      : compareHostedRuntimeLeaseGenerations(
          input.runtimeLeaseGeneration,
          storedRuntimeLeaseGeneration,
        );
    if (
      leaseGenerationComparison < 0
      || (
        leaseGenerationComparison === 0
        && trace.runtimeAttemptId !== input.runtimeAttemptId
      )
    ) {
      return false;
    }

    const phaseBreakdownUpdate = readTerminalNonReplyPhaseBreakdownMergeUpdate(
      trace.phaseBreakdownJson,
      {
        schemaVersion: 1,
        assistant: {
          checkpointPublicationExpectedByEpochMs: input.expectedBy.getTime(),
          runtimeLeaseGeneration: input.runtimeLeaseGeneration,
        },
      },
    );
    const shouldTransferRuntimeAttempt =
      leaseGenerationComparison > 0
      && trace.runtimeAttemptId !== input.runtimeAttemptId;
    if (
      shouldTransferRuntimeAttempt
      || Object.keys(phaseBreakdownUpdate).length > 0
    ) {
      await tx.hostedIngressLatencyTrace.update({
        data: {
          ...phaseBreakdownUpdate,
          ...(shouldTransferRuntimeAttempt
            ? { runtimeAttemptId: input.runtimeAttemptId }
            : {}),
        },
        where: { id: trace.id },
      });
    }
    return true;
  });
}

function isLegacyLinqEgressGuardOnlyProviderStart(
  phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown | null | undefined,
): boolean {
  // Rolling deploys can still deliver the old post-generation Linq guard
  // event. Reject that guard-only shape so it cannot masquerade as turn start.
  const provider = phaseBreakdown?.provider;
  if (!provider || provider.linqEgressGuardMs === undefined) {
    return false;
  }

  return Object.entries(provider).every(
    ([key, value]) => key === "linqEgressGuardMs" || value === undefined,
  );
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

// Terminal suppression may be recomputed after crash recovery, and the live
// runtime may extend its checkpoint-publication expectation when new dirty work
// restarts the idle window. Max-merge only those two leaves; all other
// diagnostic leaves retain assign-once semantics.
function readTerminalNonReplyPhaseBreakdownMergeUpdate(
  existingValue: unknown,
  incoming: HostedRuntimeLatencyPhaseBreakdown,
): { phaseBreakdownJson?: Prisma.InputJsonValue } {
  const merged = mergeHostedRuntimeLatencyPhaseBreakdownJson({
    existing: existingValue,
    incoming,
    phases: ["assistant"],
  });
  const assistant =
    typeof merged.value.assistant === "object"
    && merged.value.assistant !== null
    && !Array.isArray(merged.value.assistant)
      ? merged.value.assistant
      : {};
  let changed = merged.changed;
  const nextAssistant = { ...assistant };
  for (
    const leaf of [
      "terminalNonReplyCommittedAtEpochMs",
      "checkpointPublicationExpectedByEpochMs",
    ] as const
  ) {
    const incomingValue = incoming.assistant?.[leaf];
    const storedValue = assistant[leaf];
    if (
      incomingValue !== undefined
      && typeof storedValue === "number"
      && incomingValue > storedValue
    ) {
      nextAssistant[leaf] = incomingValue;
      changed = true;
    }
  }
  const incomingRuntimeLeaseGeneration =
    incoming.assistant?.runtimeLeaseGeneration;
  const storedRuntimeLeaseGeneration =
    readHostedRuntimeLatencyLeaseGeneration(merged.value);
  if (
    incomingRuntimeLeaseGeneration !== undefined
    && (
      storedRuntimeLeaseGeneration === null
      || compareHostedRuntimeLeaseGenerations(
        incomingRuntimeLeaseGeneration,
        storedRuntimeLeaseGeneration,
      ) > 0
    )
  ) {
    nextAssistant.runtimeLeaseGeneration =
      incomingRuntimeLeaseGeneration;
    changed = true;
  }
  if (changed) {
    return {
      phaseBreakdownJson: {
        ...merged.value,
        assistant: nextAssistant,
      },
    };
  }
  return {};
}

function readHostedRuntimeLatencyLeaseGeneration(
  value: unknown,
): string | null {
  const assistant = readHostedRuntimeLatencyAssistantRecord(value);
  const generation = assistant?.runtimeLeaseGeneration;
  return typeof generation === "string"
    && /^(?:0|[1-9]\d{0,19})$/u.test(generation)
    ? generation
    : null;
}

function readHostedRuntimeTerminalNonReplyCommittedAtEpochMs(
  value: unknown,
): number | null {
  const assistant = readHostedRuntimeLatencyAssistantRecord(value);
  const epochMs = assistant?.terminalNonReplyCommittedAtEpochMs;
  return typeof epochMs === "number"
    && Number.isSafeInteger(epochMs)
    && epochMs >= 0
    ? epochMs
    : null;
}

function readHostedRuntimeLatencyAssistantRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const assistant = Reflect.get(value, "assistant");
  return typeof assistant === "object"
    && assistant !== null
    && !Array.isArray(assistant)
    ? assistant as Record<string, unknown>
    : null;
}

function compareHostedRuntimeLeaseGenerations(
  left: string,
  right: string,
): number {
  const leftGeneration = BigInt(left);
  const rightGeneration = BigInt(right);
  return leftGeneration < rightGeneration
    ? -1
    : leftGeneration > rightGeneration
      ? 1
      : 0;
}

function normalizeHostedRuntimeLeaseGeneration(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError(
      "Hosted ingress latency runtime lease generation must be a string.",
    );
  }
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,19})$/u.test(normalized)) {
    throw new TypeError(
      "Hosted ingress latency runtime lease generation is invalid.",
    );
  }
  return normalized;
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
