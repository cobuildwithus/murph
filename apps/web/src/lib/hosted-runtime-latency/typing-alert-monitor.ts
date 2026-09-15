import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { sendPendingHostedLinqAlertsBestEffort } from "../hosted-onboarding/linq-alert-email";
import { getPrisma } from "../prisma";

export const HOSTED_WARM_TYPING_ALERT_THRESHOLD_MS = 3_000;
export const HOSTED_COLD_TYPING_ALERT_THRESHOLD_MS = 10_000;
const ALERT_READ_LIMIT = 1_000;
const ALERT_SEND_LIMIT = 50;
// Allow delayed telemetry to arrive before calling an absent indicator slow.
// Completed observations always use their actual timestamp and the strict SLO.
const MISSING_TYPING_OBSERVATION_GRACE_MS = 30_000;

interface TypingAlertRow {
  id: string;
  source: string;
  webhookReceivedAt: Date;
  silenceStartedAtEpochMs: bigint;
  typingAcceptedAtEpochMs: bigint | null;
  workspaceState: "warm" | "cold" | "unconfirmed";
  elapsedMs: bigint;
  thresholdMs: number;
}

type TypingAlertInput = {
  assistantInputIds?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  now?: Date;
  prisma?: Pick<PrismaClient, "$queryRaw" | "hostedLinqAlert">;
  userId?: string;
};

/** Queue one immutable operational alert per inbound message, never an incident. */
export async function runHostedRuntimeTypingAlertMonitor(input: TypingAlertInput = {}) {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const rows = await prisma.$queryRaw<TypingAlertRow[]>(
    buildHostedRuntimeTypingAlertQuery({ ...input, now }),
  );
  const candidates = rows.slice(0, ALERT_READ_LIMIT);
  if (candidates.length === 0) {
    return { queuedCount: 0, scanTruncated: false };
  }

  const queued = await prisma.hostedLinqAlert.createMany({
    data: candidates.map((row) => ({
      id: row.id,
      claimedAt: now,
      kind: row.workspaceState === "warm"
        ? "runtime_warm_typing_slow" : "runtime_cold_typing_slow",
      status: "pending",
      subject: row.workspaceState === "warm"
        ? "Murph warm workspace typing exceeded 3 seconds"
        : "Murph cold workspace typing exceeded 10 seconds",
      // This frozen body survives retries without leaking member/message identity.
      detailsJson: {
        schemaVersion: 1,
        source: row.source,
        webhookReceivedAt: row.webhookReceivedAt.toISOString(),
        silenceStartedAt: new Date(Number(row.silenceStartedAtEpochMs)).toISOString(),
        typingAcceptedAt: row.typingAcceptedAtEpochMs === null
          ? null : new Date(Number(row.typingAcceptedAtEpochMs)).toISOString(),
        workspaceState: row.workspaceState,
        elapsedMs: Number(row.elapsedMs),
        thresholdMs: row.thresholdMs,
      },
    })),
    skipDuplicates: true,
  });
  // The existing operational alert recovery owns remaining pages and failed sends.
  await sendPendingHostedLinqAlertsBestEffort({
    alertIds: candidates.slice(0, ALERT_SEND_LIMIT).map((row) => row.id),
    env: input.env,
    fetchImpl: input.fetchImpl,
    prisma,
  });
  return { queuedCount: queued.count, scanTruncated: rows.length > ALERT_READ_LIMIT };
}

export async function reportHostedRuntimeTypingAlerts(input: TypingAlertInput): Promise<void> {
  try {
    await runHostedRuntimeTypingAlertMonitor(input);
  } catch {
    console.warn("Hosted message typing alert evaluation failed.");
  }
}

export function buildHostedRuntimeTypingAlertQuery(input: {
  assistantInputIds?: readonly string[];
  now: Date;
  userId?: string;
}): Prisma.Sql {
  const inputIds = input.assistantInputIds;
  const scope = input.userId
    ? Prisma.sql`AND trace.user_id = ${input.userId}
        ${inputIds ? Prisma.sql`AND trace.assistant_input_id IN (${Prisma.join(inputIds.length ? [...inputIds] : [""])})` : Prisma.empty}`
    : Prisma.empty;
  // All clocks are UTC; timestamp-without-time-zone conversion is explicit.
  // A recorded denial belongs to this input; current member access is not a filter.
  return Prisma.sql`
    WITH observations AS (
      SELECT
        'runtime-typing/' || trace.id AS id,
        trace.source,
        trace.user_id,
        trace.mailbox_item_id,
        trace.linq_delivery_id,
        trace.webhook_received_at,
        EXTRACT(EPOCH FROM trace.webhook_received_at AT TIME ZONE 'UTC') * 1000 AS received_ms,
        CASE
          WHEN trace.workspace_restore_done_at <= trace.webhook_received_at
            OR trace.phase_breakdown_json #> '{boot,restoreWasCold}' = 'false'::jsonb
            THEN 'warm'
          WHEN trace.phase_breakdown_json #> '{boot,restoreWasCold}' = 'true'::jsonb
            THEN 'cold'
          ELSE 'unconfirmed'
        END AS workspace_state,
        LEAST((EXTRACT(EPOCH FROM trace.ingress_typing_accepted_at AT TIME ZONE 'UTC') * 1000)::bigint, CASE
          WHEN typing.value ~ '^[0-9]{1,15}$'
            THEN typing.value::bigint
          ELSE NULL
        END) AS typing_ms
      FROM hosted_ingress_latency_trace AS trace
      CROSS JOIN LATERAL (SELECT CASE trace.source
        WHEN 'linq' THEN trace.phase_breakdown_json #>> '{assistant,linqTypingAcceptedAtEpochMs}'
        WHEN 'telegram' THEN trace.phase_breakdown_json #>> '{assistant,telegramTypingAcceptedAtEpochMs}'
      END AS value) AS typing
      WHERE trace.source IN ('linq', 'telegram')
        AND trace.webhook_received_at IS NOT NULL
        AND trace.accepted_at >= ${new Date(input.now.getTime() - 7 * 24 * 60 * 60_000)}
        AND trace.webhook_received_at <= ${input.now}
        ${scope}
        AND NOT EXISTS (
          SELECT 1 FROM hosted_mailbox_item AS mailbox
          WHERE mailbox.id = trace.mailbox_item_id
            AND mailbox.user_id = trace.user_id
            AND mailbox.ai_usage_denied_at IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM hosted_linq_alert AS alert
          WHERE alert.id = 'runtime-typing/' || trace.id
        )
    ), classified AS (
      SELECT *,
        CASE WHEN workspace_state = 'warm'
          THEN ${HOSTED_WARM_TYPING_ALERT_THRESHOLD_MS}::integer
          ELSE ${HOSTED_COLD_TYPING_ALERT_THRESHOLD_MS}::integer
        END AS threshold_ms,
        COALESCE(typing_ms, ${input.now.getTime()}::bigint) - received_ms AS elapsed_ms
      FROM observations
      WHERE typing_ms <= ${input.now.getTime()}::bigint
        OR (typing_ms IS NULL
          AND received_ms < ${input.now.getTime() - MISSING_TYPING_OBSERVATION_GRACE_MS}::bigint)
    ), measured AS MATERIALIZED (
      SELECT observation.*, GREATEST(received_ms,
        EXTRACT(EPOCH FROM ${buildLinqConversationActivitySql(input.now)} AT TIME ZONE 'UTC') * 1000
      ) AS silence_started_ms
      FROM classified AS observation
      WHERE elapsed_ms > threshold_ms
        AND NOT EXISTS (
          SELECT 1 FROM hosted_linq_delivery AS answer
          WHERE observation.source = 'linq'
            AND answer.id = observation.linq_delivery_id
            AND answer.accepted_at >= observation.webhook_received_at
            AND answer.accepted_at <= LEAST(${input.now}::timestamp,
              TIMESTAMP 'epoch' + observation.typing_ms * INTERVAL '1 millisecond')
        )
    )
    SELECT id, source, webhook_received_at AS "webhookReceivedAt",
      silence_started_ms::bigint AS "silenceStartedAtEpochMs",
      typing_ms AS "typingAcceptedAtEpochMs", workspace_state AS "workspaceState",
      (COALESCE(typing_ms, ${input.now.getTime()}::bigint) - silence_started_ms)::bigint AS "elapsedMs",
      threshold_ms AS "thresholdMs"
    FROM measured
    WHERE COALESCE(typing_ms, ${input.now.getTime()}::bigint) - silence_started_ms > threshold_ms
      AND (typing_ms IS NOT NULL
        OR silence_started_ms < ${input.now.getTime() - MISSING_TYPING_OBSERVATION_GRACE_MS}::bigint)
    ORDER BY webhook_received_at, id
    LIMIT ${ALERT_READ_LIMIT + 1}
  `;
}

/** Latest activity resets pending silence; an earlier typing session ends at its reply or expiry. */
function buildLinqConversationActivitySql(now: Date): Prisma.Sql {
  return Prisma.sql`(
    SELECT GREATEST(
      (
        SELECT MAX(delivery.accepted_at) FROM hosted_linq_delivery AS delivery
        WHERE delivery.linq_chat_lookup_key = conversation.linq_chat_lookup_key
          AND delivery.attempted_at >= observation.webhook_received_at - INTERVAL '5 minutes'
          AND delivery.attempted_at <= ${now}
          AND delivery.accepted_at >= observation.webhook_received_at
          AND delivery.accepted_at <= LEAST(${now}::timestamp,
            TIMESTAMP 'epoch' + observation.typing_ms * INTERVAL '1 millisecond')
      ),
      (
        SELECT MAX(LEAST(
          earlier_delivery.accepted_at,
          TIMESTAMP 'epoch' + (prior_typing.ms + 300000) * INTERVAL '1 millisecond',
          ${now}::timestamp,
          TIMESTAMP 'epoch' + observation.typing_ms * INTERVAL '1 millisecond'
        ))
        FROM hosted_linq_provider_event AS earlier_event
        JOIN hosted_mailbox_item AS earlier_mailbox
          ON earlier_mailbox.source_message_lookup_key = earlier_event.message_lookup_key
         AND earlier_mailbox.user_id = current_mailbox.user_id
        JOIN hosted_ingress_latency_trace AS earlier_trace
          ON earlier_trace.mailbox_item_id = earlier_mailbox.id
         AND earlier_trace.user_id = current_mailbox.user_id
         AND earlier_trace.source = 'linq'
        LEFT JOIN hosted_linq_delivery AS earlier_delivery
          ON earlier_delivery.id = earlier_trace.linq_delivery_id
        CROSS JOIN LATERAL (SELECT CASE
          WHEN earlier_trace.phase_breakdown_json #>> '{assistant,linqTypingAcceptedAtEpochMs}' ~ '^[0-9]{1,15}$'
          THEN (earlier_trace.phase_breakdown_json #>> '{assistant,linqTypingAcceptedAtEpochMs}')::bigint
        END AS ms) AS prior_typing
        WHERE earlier_event.linq_chat_lookup_key = conversation.linq_chat_lookup_key
          AND earlier_event.provider_created_at >= observation.webhook_received_at - INTERVAL '5 minutes'
          AND earlier_event.provider_created_at <= observation.webhook_received_at
          AND earlier_mailbox.id <> current_mailbox.id
          AND earlier_trace.webhook_received_at <= observation.webhook_received_at
          AND (earlier_delivery.accepted_at IS NULL OR earlier_delivery.accepted_at > observation.webhook_received_at)
          AND prior_typing.ms BETWEEN observation.received_ms - 300000 AND observation.received_ms
      )
    )
    FROM hosted_mailbox_item AS current_mailbox
    JOIN LATERAL (
      SELECT event.linq_chat_lookup_key
      FROM hosted_linq_provider_event AS event
      WHERE event.message_lookup_key = current_mailbox.source_message_lookup_key
        AND event.linq_chat_lookup_key IS NOT NULL
      ORDER BY event.provider_created_at DESC
      LIMIT 1
    ) AS conversation ON TRUE
    WHERE observation.source = 'linq'
      AND current_mailbox.id = observation.mailbox_item_id
      AND current_mailbox.user_id = observation.user_id
  )`;
}
