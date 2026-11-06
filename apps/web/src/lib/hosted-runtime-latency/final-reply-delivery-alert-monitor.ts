import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { sendPendingHostedLinqAlertsBestEffort } from "../hosted-onboarding/linq-alert-email";
import {
  createHostedLinqDeliverySourceRefLookupKey,
} from "../hosted-onboarding/linq-observability-identifiers";
import { HOSTED_RUN_LOG_VERBOSE_RETENTION_MS } from "../hosted-retention/cleanup";
import { isHostedRuntimeLogDatabaseConfigured } from "../hosted-runtime-log/database";
import {
  listHostedRuntimeTurnTimingLogs,
  type HostedRuntimeTurnTimingLogStage,
} from "../hosted-runtime-log/store";
import { getPrisma } from "../prisma";
import {
  HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
  HOSTED_ASSISTANT_TURN_TIMING_TYPE,
} from "./store";

// Initial engineering budgets for work after the final reply exists; not an
// SLO. Group replies add the intentional four-second draft hold.
export const HOSTED_DIRECT_FINAL_REPLY_DELIVERY_ALERT_THRESHOLD_MS = 5_000;
export const HOSTED_GROUP_FINAL_REPLY_DELIVERY_ALERT_THRESHOLD_MS = 9_000;
export const HOSTED_FINAL_REPLY_DELIVERY_ALERT_KIND = "runtime_final_reply_delivery_slow";
const HOSTED_FINAL_REPLY_DELIVERY_ALERT_ID_PREFIX = "runtime-final-reply-delivery/";
// Lets the queued runtime-log rows arrive before absence counts as unknown.
export const HOSTED_FINAL_REPLY_DELIVERY_TIMING_GRACE_MS = 5 * 60_000;
// Acceptance scan: many five-minute runs past grace, bounded by the page cap.
const ACCEPTED_LOOKBACK_MS = 2 * 60 * 60_000;
// Timing rows are written by the runtime clock; ingress uses database time.
const CLOCK_SKEW_ALLOWANCE_MS = 60_000;
export const HOSTED_FINAL_REPLY_DELIVERY_READ_LIMIT = 500;
const TIMING_LOG_READ_LIMIT = 2_000;
const ALERT_SEND_LIMIT = 50;
const TIMING_STAGES: readonly HostedRuntimeTurnTimingLogStage[] = [
  "linq-dispatch-entered",
  "reply-dispatched",
];
const FINAL_RESPONSE_COMPLETION_STATES = new Set([
  "invalid",
  "observed",
  "superseded",
  "unavailable",
]);

export interface HostedFinalReplyDeliveryRow {
  acceptedAt: Date;
  /** This delivery already owns its immutable alert row. */
  alertRecorded: boolean;
  attemptedAt: Date;
  /** Earliest linked ingress acceptance, or null for an unlinked delivery. */
  earliestTraceAcceptedAt: Date | null;
  id: string;
  replyRuntimeAttemptIds: readonly string[];
  runtimeAttemptIds: readonly string[];
  sourceRef: string;
  threadIsDirect: boolean | null;
}

export interface HostedFinalReplyTimingLogRow {
  attemptId: string | null;
  redactedJson: unknown;
}

/** `elapsedMs` exists only when status is `observed`. */
export type HostedFinalReplyDeliveryMeasurement =
  | { elapsedMs: number; status: "observed" }
  | {
      status:
        | "invalid"
        | "invalid_chronology"
        | "producer_absent"
        | "superseded"
        | "unavailable";
    };

export type HostedFinalReplyDeliveryTriggerOrigin =
  | "final_response_completed"
  | "provider_result";

export interface HostedFinalReplyDeliveryAlertCandidate {
  acceptedAt: Date;
  components: {
    attemptToAcceptedMs: number;
    providerResultToAttemptMs: number;
    /** Existing diagnostic duration; the producer clamps clock reversal. */
    providerResultToIntentMs: number | null;
  };
  deliveryAttemptRelation: "different" | "same" | "unknown";
  deliveryId: string;
  dispatchAttribution: Record<string, number | string>;
  /** Null means pacing was not attributable; the full duration is evaluated. */
  intentionalPacingMs: number | null;
  finalResponseCompletedToAccepted: HostedFinalReplyDeliveryMeasurement;
  providerResultToAccepted: HostedFinalReplyDeliveryMeasurement;
  scope: "direct" | "group";
  thresholdMs: number;
  triggerOrigins: HostedFinalReplyDeliveryTriggerOrigin[];
}

export interface HostedFinalReplyDeliveryCounts {
  alreadyAlertedCount: number;
  ambiguousCount: number;
  /** Accepted runtime Linq deliveries in the scan, linked or not. */
  deliveryCount: number;
  evaluatedCount: number;
  finalResponseCompleted: Record<HostedFinalReplyDeliveryMeasurement["status"] | "slow", number>;
  missingTimingCount: number;
  pendingCount: number;
  providerResult: Record<HostedFinalReplyDeliveryMeasurement["status"] | "slow", number>;
  /** Missing timing whose ingress predates verbose runtime-log retention. */
  timingBeyondRetentionCount: number;
  /** No ingress trace links the delivery, so it is outside this alert. */
  unlinkedCount: number;
}

type ReplyTiming = {
  attemptId: string | null;
  finalResponseCompletedToProviderResultMs: number | null;
  finalResponseCompletion: string | null;
  providerResultAtEpochMs: number | null;
  sinceProviderResultMs: number | null;
};

type DispatchTiming = {
  attemptId: string | null;
  durations: Record<string, number>;
};

/**
 * Pure classification of accepted final-reply deliveries. Two measurements stay
 * independently named: A from Murph's provider-result instant and B from the
 * Murph-local receipt of Codex's final response completion. B never falls back
 * to A, and missing, ambiguous, or impossible chronology never alerts.
 */
export function evaluateHostedFinalReplyDeliveryLatency(input: {
  deliveries: readonly HostedFinalReplyDeliveryRow[];
  now: Date;
  timingHorizon: Date;
  timingRows: readonly HostedFinalReplyTimingLogRow[];
}): {
  candidates: HostedFinalReplyDeliveryAlertCandidate[];
  counts: HostedFinalReplyDeliveryCounts;
} {
  const counts = createEmptyCounts(input.deliveries.length);
  const timing = indexTimingRows(input.timingRows);
  const deliveriesPerSourceRef = countDeliveriesBySourceRef(input.deliveries);
  const graceStartMs = input.now.getTime() - HOSTED_FINAL_REPLY_DELIVERY_TIMING_GRACE_MS;
  const candidates: HostedFinalReplyDeliveryAlertCandidate[] = [];
  for (const delivery of input.deliveries) {
    const classification = classifyDelivery({
      deliveriesWithSourceRef: deliveriesPerSourceRef.get(delivery.sourceRef) ?? 0,
      delivery,
      graceStartMs,
      replies: timing.replies.get(delivery.sourceRef) ?? [],
      timingHorizon: input.timingHorizon,
    });
    if (classification.status !== "evaluate") {
      counts[classification.status] += 1;
      continue;
    }
    counts.evaluatedCount += 1;
    const measured = measureDelivery(delivery, classification.reply);
    counts.providerResult[measured.providerResultToAccepted.status] += 1;
    counts.finalResponseCompleted[measured.finalResponseCompletedToAccepted.status] += 1;
    const dispatchRows = timing.dispatches.get(delivery.sourceRef) ?? [];
    const deliveryAttemptRelation = resolveDeliveryAttemptRelation(delivery, classification.reply);
    const intentionalPacingMs = readIntentionalPacingMs({
      deliveryAttemptRelation,
      measured,
      reply: classification.reply,
      rows: dispatchRows,
    });
    const triggerOrigins = resolveTriggerOrigins(measured, intentionalPacingMs ?? 0);
    for (const origin of triggerOrigins) {
      counts[origin === "provider_result" ? "providerResult" : "finalResponseCompleted"].slow += 1;
    }
    // Every trigger requires the result anchor and valid chronology.
    if (triggerOrigins.length === 0 || measured.components === null) {
      continue;
    }
    if (delivery.alertRecorded) {
      counts.alreadyAlertedCount += 1;
      continue;
    }
    candidates.push({
      ...measured,
      acceptedAt: delivery.acceptedAt,
      components: measured.components,
      deliveryAttemptRelation,
      deliveryId: delivery.id,
      dispatchAttribution: readDispatchAttribution(dispatchRows),
      intentionalPacingMs,
      triggerOrigins,
    });
  }
  return { candidates, counts };
}

type DeliveryClassification =
  | { reply: ReplyTiming; status: "evaluate" }
  | {
      status:
        | "ambiguousCount"
        | "missingTimingCount"
        | "pendingCount"
        | "timingBeyondRetentionCount"
        | "unlinkedCount";
    };

function classifyDelivery(input: {
  deliveriesWithSourceRef: number;
  delivery: HostedFinalReplyDeliveryRow;
  graceStartMs: number;
  replies: readonly ReplyTiming[];
  timingHorizon: Date;
}): DeliveryClassification {
  const earliestIngress = input.delivery.earliestTraceAcceptedAt;
  if (earliestIngress === null) {
    return { status: "unlinkedCount" };
  }
  if (input.delivery.acceptedAt.getTime() > input.graceStartMs) {
    return { status: "pendingCount" };
  }
  if (input.deliveriesWithSourceRef !== 1 || input.replies.length > 1) {
    return { status: "ambiguousCount" };
  }
  const reply = input.replies[0];
  if (reply) {
    return { reply, status: "evaluate" };
  }
  return earliestIngress < input.timingHorizon
    ? { status: "timingBeyondRetentionCount" }
    : { status: "missingTimingCount" };
}

type DeliveryMeasurement = {
  /** Null when the anchor is absent or chronology is invalid. */
  components: HostedFinalReplyDeliveryAlertCandidate["components"] | null;
  finalResponseCompletedToAccepted: HostedFinalReplyDeliveryMeasurement;
  providerResultToAccepted: HostedFinalReplyDeliveryMeasurement;
  scope: "direct" | "group";
  thresholdMs: number;
};

function measureDelivery(
  delivery: HostedFinalReplyDeliveryRow,
  reply: ReplyTiming,
): DeliveryMeasurement {
  const scope = delivery.threadIsDirect === false ? "group" : "direct";
  const thresholdMs = scope === "group"
    ? HOSTED_GROUP_FINAL_REPLY_DELIVERY_ALERT_THRESHOLD_MS
    : HOSTED_DIRECT_FINAL_REPLY_DELIVERY_ALERT_THRESHOLD_MS;
  const resultAtMs = reply.providerResultAtEpochMs;
  if (resultAtMs === null) {
    return {
      components: null,
      finalResponseCompletedToAccepted: { status: "producer_absent" },
      providerResultToAccepted: { status: "producer_absent" },
      scope,
      thresholdMs,
    };
  }
  const acceptedAtMs = delivery.acceptedAt.getTime();
  const attemptedAtMs = delivery.attemptedAt.getTime();
  // result <= attempt <= acceptance must hold; one impossible step
  // invalidates every measurement anchored on it instead of clamping.
  const components = {
    attemptToAcceptedMs: acceptedAtMs - attemptedAtMs,
    providerResultToAttemptMs: attemptedAtMs - resultAtMs,
    providerResultToIntentMs: reply.sinceProviderResultMs,
  };
  const chronologyValid = components.providerResultToAttemptMs >= 0
    && components.attemptToAcceptedMs >= 0;
  return {
    components: chronologyValid ? components : null,
    finalResponseCompletedToAccepted: measureFinalResponseCompletion({
      chronologyValid,
      providerResultToAcceptedMs: acceptedAtMs - resultAtMs,
      reply,
    }),
    providerResultToAccepted: chronologyValid
      ? { elapsedMs: acceptedAtMs - resultAtMs, status: "observed" }
      : { status: "invalid_chronology" },
    scope,
    thresholdMs,
  };
}

function measureFinalResponseCompletion(input: {
  chronologyValid: boolean;
  providerResultToAcceptedMs: number;
  reply: ReplyTiming;
}): HostedFinalReplyDeliveryMeasurement {
  const completion = input.reply.finalResponseCompletion;
  if (completion === null) {
    return { status: "producer_absent" };
  }
  if (completion !== "observed") {
    return { status: completion as "invalid" | "superseded" | "unavailable" };
  }
  const completedToResultMs = input.reply.finalResponseCompletedToProviderResultMs;
  if (completedToResultMs === null) {
    return { status: "invalid" };
  }
  return input.chronologyValid
    ? { elapsedMs: input.providerResultToAcceptedMs + completedToResultMs, status: "observed" }
    : { status: "invalid_chronology" };
}

function resolveTriggerOrigins(
  measured: DeliveryMeasurement,
  intentionalPacingMs: number,
): HostedFinalReplyDeliveryTriggerOrigin[] {
  return ([
    ["provider_result", measured.providerResultToAccepted],
    ["final_response_completed", measured.finalResponseCompletedToAccepted],
  ] as const)
    .filter(([, measurement]) =>
      measurement.status === "observed"
      && measurement.elapsedMs - intentionalPacingMs > measured.thresholdMs)
    .map(([origin]) => origin);
}

function resolveDeliveryAttemptRelation(
  delivery: HostedFinalReplyDeliveryRow,
  reply: ReplyTiming,
): HostedFinalReplyDeliveryAlertCandidate["deliveryAttemptRelation"] {
  const replyAttemptIds = [...new Set(delivery.replyRuntimeAttemptIds)];
  if (replyAttemptIds.length !== 1 || reply.attemptId === null) {
    return "unknown";
  }
  return replyAttemptIds[0] === reply.attemptId ? "same" : "different";
}

function readDispatchAttribution(
  rows: readonly DispatchTiming[],
): HostedFinalReplyDeliveryAlertCandidate["dispatchAttribution"] {
  // A primary plus a fallback boundary yields two rows; neither alone describes
  // the accepted delivery, so more than one is ambiguous.
  if (rows.length === 1) {
    return { status: "observed", ...rows[0]?.durations };
  }
  return { status: rows.length === 0 ? "missing" : "ambiguous" };
}

function readIntentionalPacingMs(input: {
  deliveryAttemptRelation: HostedFinalReplyDeliveryAlertCandidate["deliveryAttemptRelation"];
  measured: DeliveryMeasurement;
  reply: ReplyTiming;
  rows: readonly DispatchTiming[];
}): number | null {
  const row = input.rows.length === 1 ? input.rows[0] : null;
  if (
    !row || input.deliveryAttemptRelation !== "same"
    || row.attemptId !== input.reply.attemptId || !input.measured.components
  ) {
    return null;
  }
  const pacingMs = row.durations.replyBubblePacingMs;
  const phaseMs = row.durations.sinceForegroundPhaseStartedMs;
  // Do not infer a discount from absent, ambiguous, or cross-attempt evidence.
  // The configured waits must fit inside this result's pre-dispatch interval.
  return pacingMs !== undefined && phaseMs !== undefined
    && pacingMs <= phaseMs
    && phaseMs <= input.measured.components.providerResultToAttemptMs
    ? pacingMs
    : null;
}

function countDeliveriesBySourceRef(
  deliveries: readonly HostedFinalReplyDeliveryRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const delivery of deliveries) {
    counts.set(delivery.sourceRef, (counts.get(delivery.sourceRef) ?? 0) + 1);
  }
  return counts;
}

function indexTimingRows(rows: readonly HostedFinalReplyTimingLogRow[]) {
  const replies = new Map<string, ReplyTiming[]>();
  const dispatches = new Map<string, DispatchTiming[]>();
  for (const row of rows) {
    readTimingRow(row, replies, dispatches);
  }
  return { dispatches, replies };
}

export async function runHostedRuntimeFinalReplyDeliveryAlertMonitor(input: {
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  listTimingLogs?: typeof listHostedRuntimeTurnTimingLogs;
  now?: Date;
  prisma?: Pick<PrismaClient, "$queryRaw" | "hostedLinqAlert">;
} = {}) {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const rows = await prisma.$queryRaw<HostedFinalReplyDeliveryRow[]>(
    buildHostedFinalReplyDeliveryQuery({
      now,
      windowStart: new Date(now.getTime() - ACCEPTED_LOOKBACK_MS),
    }),
  );
  if (rows.length > HOSTED_FINAL_REPLY_DELIVERY_READ_LIMIT) {
    // A duplicate source reference beyond the page could hide ambiguity.
    return { deliveryScan: "truncated" as const, queuedCount: 0, timingScan: "skipped" as const };
  }
  // Retried deliveries keep their original turn's timing row, which the
  // runtime writes after ingress; read back to the earliest linked ingress,
  // bounded by verbose runtime-log retention.
  const timingHorizon = new Date(now.getTime() - HOSTED_RUN_LOG_VERBOSE_RETENTION_MS);
  const earliestIngressMs = Math.min(
    now.getTime(),
    ...rows.flatMap((row) => row.earliestTraceAcceptedAt
      ? [row.earliestTraceAcceptedAt.getTime()]
      : []),
  );
  const timing = await readTimingRows({
    attemptIds: rows.flatMap((row) => [...row.replyRuntimeAttemptIds, ...row.runtimeAttemptIds]),
    from: new Date(Math.max(timingHorizon.getTime(), earliestIngressMs - CLOCK_SKEW_ALLOWANCE_MS)),
    listTimingLogs: input.listTimingLogs ?? null,
    to: now,
  });
  if (timing.status !== "complete") {
    // An unavailable or truncated timing scan cannot prove absence or uniqueness.
    return { deliveryScan: "complete" as const, queuedCount: 0, timingScan: timing.status };
  }

  const { candidates, counts } = evaluateHostedFinalReplyDeliveryLatency({
    deliveries: rows,
    now,
    timingHorizon,
    timingRows: timing.rows,
  });
  if (candidates.length === 0) {
    return { counts, deliveryScan: "complete" as const, queuedCount: 0, timingScan: timing.status };
  }
  // One immutable alert per delivery: the primary key plus skipDuplicates owns
  // dedupe under races, and the sender's durable claim never resends a sent
  // alert. Already-recorded alerts were excluded above without another read.
  const queued = await prisma.hostedLinqAlert.createMany({
    data: candidates.map((candidate) => ({
      id: buildHostedFinalReplyDeliveryAlertId(candidate.deliveryId),
      claimedAt: now,
      kind: HOSTED_FINAL_REPLY_DELIVERY_ALERT_KIND,
      status: "pending",
      subject: `Murph ${candidate.scope} final reply delivery exceeded `
        + `${candidate.thresholdMs / 1_000} seconds`,
      detailsJson: buildHostedFinalReplyDeliveryAlertDetails(candidate),
    })),
    skipDuplicates: true,
  });
  // The existing operational alert recovery owns remaining pages and failed sends.
  await sendPendingHostedLinqAlertsBestEffort({
    alertIds: candidates.slice(0, ALERT_SEND_LIMIT)
      .map((candidate) => buildHostedFinalReplyDeliveryAlertId(candidate.deliveryId)),
    env: input.env,
    fetchImpl: input.fetchImpl,
    prisma,
  });
  return { counts, deliveryScan: "complete" as const, queuedCount: queued.count, timingScan: timing.status };
}

export function buildHostedFinalReplyDeliveryAlertId(deliveryId: string): string {
  return `${HOSTED_FINAL_REPLY_DELIVERY_ALERT_ID_PREFIX}${deliveryId}`;
}

export function buildHostedFinalReplyDeliveryQuery(input: {
  now: Date;
  windowStart: Date;
}): Prisma.Sql {
  // Every accepted runtime Linq delivery in the window, so source-reference
  // uniqueness is checked across the whole page. Only deliveries linked to a
  // Linq ingress trace are evaluated; grace is applied in memory so pending
  // and unlinked deliveries stay countable.
  return Prisma.sql`
    SELECT
      delivery.id,
      MIN(trace.accepted_at) AS "earliestTraceAcceptedAt",
      EXISTS (
        SELECT 1 FROM hosted_linq_alert AS alert
        WHERE alert.id = ${HOSTED_FINAL_REPLY_DELIVERY_ALERT_ID_PREFIX} || delivery.id
      ) AS "alertRecorded",
      delivery.source_ref AS "sourceRef",
      delivery.thread_is_direct AS "threadIsDirect",
      delivery.attempted_at AS "attemptedAt",
      delivery.accepted_at AS "acceptedAt",
      COALESCE(
        ARRAY_AGG(DISTINCT trace.reply_runtime_attempt_id)
          FILTER (WHERE trace.reply_runtime_attempt_id IS NOT NULL),
        ARRAY[]::text[]
      ) AS "replyRuntimeAttemptIds",
      COALESCE(
        ARRAY_AGG(DISTINCT trace.runtime_attempt_id)
          FILTER (WHERE trace.runtime_attempt_id IS NOT NULL),
        ARRAY[]::text[]
      ) AS "runtimeAttemptIds"
    FROM hosted_linq_delivery AS delivery
    LEFT JOIN hosted_ingress_latency_trace AS trace
      ON trace.linq_delivery_id = delivery.id
     AND trace.source = 'linq'
    WHERE delivery.source = 'hosted_runtime_linq_delivery'
      AND delivery.source_ref IS NOT NULL
      AND delivery.accepted_at >= ${input.windowStart}
      AND delivery.accepted_at <= ${input.now}
    GROUP BY delivery.id
    ORDER BY delivery.accepted_at, delivery.id
    LIMIT ${HOSTED_FINAL_REPLY_DELIVERY_READ_LIMIT + 1}
  `;
}

export function buildHostedFinalReplyDeliveryAlertDetails(
  candidate: HostedFinalReplyDeliveryAlertCandidate,
) {
  return {
    schemaVersion: 1,
    acceptedAt: candidate.acceptedAt.toISOString(),
    components: candidate.components,
    deliveryAttemptRelation: candidate.deliveryAttemptRelation,
    dispatchAttribution: candidate.dispatchAttribution,
    intentionalPacingMs: candidate.intentionalPacingMs,
    finalResponseCompletedToAccepted: candidate.finalResponseCompletedToAccepted,
    providerResultToAccepted: candidate.providerResultToAccepted,
    scope: candidate.scope,
    thresholdMs: candidate.thresholdMs,
    triggerOrigins: candidate.triggerOrigins,
  };
}

async function readTimingRows(input: {
  attemptIds: readonly string[];
  from: Date;
  listTimingLogs: typeof listHostedRuntimeTurnTimingLogs | null;
  to: Date;
}): Promise<
  | { rows: HostedFinalReplyTimingLogRow[]; status: "complete" }
  | { status: "truncated" | "unavailable" }
> {
  const attemptIds = [...new Set(input.attemptIds)];
  if (attemptIds.length === 0) {
    return { rows: [], status: "complete" };
  }
  if (!input.listTimingLogs && !isHostedRuntimeLogDatabaseConfigured()) {
    return { status: "unavailable" };
  }
  try {
    const rows = await (input.listTimingLogs ?? listHostedRuntimeTurnTimingLogs)({
      attemptIds,
      from: input.from,
      limit: TIMING_LOG_READ_LIMIT + 1,
      stages: TIMING_STAGES,
      to: input.to,
    });
    return rows.length > TIMING_LOG_READ_LIMIT
      ? { status: "truncated" }
      : { rows, status: "complete" };
  } catch {
    console.warn("Hosted final reply delivery timing-log read failed.");
    return { status: "unavailable" };
  }
}

function readTimingRow(
  row: HostedFinalReplyTimingLogRow,
  replies: Map<string, ReplyTiming[]>,
  dispatches: Map<string, DispatchTiming[]>,
): void {
  const record = row.redactedJson;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return;
  }
  const json = record as Record<string, unknown>;
  if (
    json.schema !== HOSTED_ASSISTANT_TURN_TIMING_SCHEMA
    || json.type !== HOSTED_ASSISTANT_TURN_TIMING_TYPE
  ) {
    return;
  }
  const intentId = typeof json.turnTimingDeliveryIntentId === "string"
    && /^[A-Za-z0-9_.:-]{1,256}$/u.test(json.turnTimingDeliveryIntentId)
    ? json.turnTimingDeliveryIntentId
    : null;
  const sourceRef = createHostedLinqDeliverySourceRefLookupKey(intentId);
  if (!sourceRef) {
    return;
  }
  if (json.turnTimingStage === "linq-dispatch-entered") {
    const durations: Record<string, number> = {};
    for (const [key, label] of [
      ["deliveryReplyBubblePacingMs", "replyBubblePacingMs"],
      ["deliveryMemberChannelBarrierMs", "memberChannelBarrierMs"],
      ["deliveryProviderEntryFenceMs", "providerEntryFenceMs"],
      ["deliveryRouteAuthorityCheckMs", "routeAuthorityCheckMs"],
      ["deliverySendPreparationMs", "sendPreparationMs"],
      ["deliverySinceForegroundPhaseStartedMs", "sinceForegroundPhaseStartedMs"],
    ] as const) {
      const value = readSafeNonnegativeInteger(json[key]);
      if (value !== null) {
        durations[label] = value;
      }
    }
    appendToMap(dispatches, sourceRef, { attemptId: row.attemptId, durations });
    return;
  }
  if (
    json.turnTimingStage !== "reply-dispatched"
    || json.deliveryIntentPresent !== true
    || json.deliveryOutcomeKind !== "queued"
    || json.finalReplySelected !== true
  ) {
    return;
  }
  appendToMap(replies, sourceRef, {
    attemptId: row.attemptId,
    finalResponseCompletedToProviderResultMs: readSafeNonnegativeInteger(
      json.turnTimingFinalResponseCompletedToProviderResultMs,
    ),
    finalResponseCompletion: typeof json.turnTimingFinalResponseCompletion === "string"
      && FINAL_RESPONSE_COMPLETION_STATES.has(json.turnTimingFinalResponseCompletion)
      ? json.turnTimingFinalResponseCompletion
      : null,
    providerResultAtEpochMs: readSafeNonnegativeInteger(json.turnTimingProviderResultAtEpochMs),
    sinceProviderResultMs: readSafeNonnegativeInteger(json.turnTimingSinceProviderResultMs),
  });
}

function createEmptyCounts(deliveryCount: number): HostedFinalReplyDeliveryCounts {
  const measurementCounts = () => ({
    invalid: 0,
    invalid_chronology: 0,
    observed: 0,
    producer_absent: 0,
    slow: 0,
    superseded: 0,
    unavailable: 0,
  });
  return {
    alreadyAlertedCount: 0,
    ambiguousCount: 0,
    deliveryCount,
    evaluatedCount: 0,
    finalResponseCompleted: measurementCounts(),
    missingTimingCount: 0,
    pendingCount: 0,
    providerResult: measurementCounts(),
    timingBeyondRetentionCount: 0,
    unlinkedCount: 0,
  };
}

function readSafeNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function appendToMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}
