import { Prisma, type PrismaClient } from "@prisma/client";

export const TOOL_FAILURE_WINDOW_MS = 60 * 60_000;
export const TOOL_BACKEND_FAILURE_THRESHOLD = 4;
export const TOOL_FAILURE_SAMPLE_LIMIT = 1_000;
// Registered request kinds only. Never echo arbitrary operation/error strings.
export const TOOL_FAILURE_OPERATIONS = [
  "analyze-video", "ask-grok", "assistant-configuration", "assistant-style",
  "attach-group-challenge-response-card", "attach-response-card", "attach-response-media",
  "automation", "computer-act", "computer-finish-run", "computer-open", "computer-os-control",
  "computer-pause-for-user", "connected-apps-execute", "connected-apps-manage", "connected-apps-search",
  "conversation-attachments", "create-calendar-link", "create-clinical-records-connect-link",
  "create-phone-call", "device", "family-plan", "finish-without-reply", "game", "generate-image",
  "generate-song", "generate-voice-memo", "get-phone-call-status", "get-sender-contact", "group",
  "group-room-model", "imessage-contact", "labs", "member-memory", "pending-vault-files-cancel",
  "pending-vault-files-list", "personalization", "plan-usage", "poll", "react-to-message",
  "resolve-physical-note", "select-reply-target", "send-physical-note", "send-progress-update",
  "send-vault-file", "stop-phone-call", "submit-product-feedback", "subscription", "usage-diagnostics",
];
export const TOOL_BACKEND_FAILURE_REASONS = [
  "handler_exception", "unavailable", "authority_rejected", "invalid_result",
  "result_serialization_failed", "empty_result", "oversized_result", "action_result_mismatch",
];
const ERROR_CATEGORIES = [
  "unknown", "invalid_input", "not_found", "conflict", "unavailable", "authority_rejected",
  "invalid_result", "rate_limited", "timeout",
];
export type ToolFailurePrisma = Pick<PrismaClient, "$queryRaw" | "hostedLinqAlert">;
export type ToolFailureGroup = {
  source: "dynamic_tool" | "phone_start";
  operation: string;
  reason: string;
  category: string;
  releaseSha: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
};
export type ToolFailureHealth = { anomalous: boolean; count: number; sampleCapped: boolean; groups: ToolFailureGroup[] };
export type ToolFailureCondition = "phone" | "backend";

export async function readToolFailureHealth(input: { now: Date; prisma: ToolFailurePrisma }):
  Promise<Record<ToolFailureCondition, ToolFailureHealth>> {
  const start = new Date(+input.now - TOOL_FAILURE_WINDOW_MS);
  // Three independently capped, indexed samples: a flood in one source cannot
  // evict a low-volume phone failure. Only aggregate safe labels leave SQL.
  const rows = await input.prisma.$queryRaw<ToolFailureGroup[]>(Prisma.sql`
    WITH phone_issues AS MATERIALIZED (
      SELECT operation, details_json, release_sha, occurred_at AS at, 'dynamic_tool' AS source
      FROM hosted_assistant_runtime_issue
      WHERE issue_kind = 'tool_error' AND occurred_at > ${start} AND occurred_at <= ${input.now}
        AND component = 'assistant.codex-dynamic-tool' AND error_code = 'ASSISTANT_DYNAMIC_TOOL_FAILED'
        AND operation = 'create-phone-call'
      ORDER BY occurred_at DESC LIMIT ${TOOL_FAILURE_SAMPLE_LIMIT}
    ), backend_issues AS MATERIALIZED (
      SELECT operation, details_json, release_sha, occurred_at AS at, 'dynamic_tool' AS source
      FROM hosted_assistant_runtime_issue
      WHERE issue_kind = 'tool_error' AND occurred_at > ${start} AND occurred_at <= ${input.now}
        AND component = 'assistant.codex-dynamic-tool' AND error_code = 'ASSISTANT_DYNAMIC_TOOL_FAILED'
        AND operation IS DISTINCT FROM 'create-phone-call'
        AND coalesce(details_json->>'failureStage', '') <> 'validation'
        AND details_json->>'failureReason' IN (${Prisma.join(TOOL_BACKEND_FAILURE_REASONS)})
      ORDER BY occurred_at DESC LIMIT ${TOOL_FAILURE_SAMPLE_LIMIT}
    ), phone_starts AS MATERIALIZED (
      SELECT 'create-phone-call' AS operation, '{}'::jsonb AS details_json,
        NULL::text AS release_sha, c.updated_at AS at, 'phone_start' AS source
      FROM hosted_phone_call c
      WHERE c.status = 'failed' AND c.updated_at > ${start} AND c.updated_at <= ${input.now}
        AND c.provider_call_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM hosted_thread_container t WHERE t.member_id = c.member_id)
      ORDER BY c.updated_at DESC LIMIT ${TOOL_FAILURE_SAMPLE_LIMIT}
    ), safe AS (
      SELECT source,
        CASE WHEN operation IN (${Prisma.join(TOOL_FAILURE_OPERATIONS)}) THEN operation ELSE 'other_tool' END AS operation,
        CASE WHEN source = 'phone_start' THEN 'start_failed'
          WHEN details_json->>'failureReason' IN (${Prisma.join([...TOOL_BACKEND_FAILURE_REASONS, "invalid_input", "reported_failure", "unknown", "nonzero_exit", "not_found", "conflict", "limit_reached", "unsupported_request"])})
          THEN details_json->>'failureReason' ELSE 'unknown' END AS reason,
        CASE WHEN details_json->>'errorCategory' IN (${Prisma.join(ERROR_CATEGORIES)})
          THEN details_json->>'errorCategory' ELSE 'unknown' END AS category,
        CASE WHEN release_sha ~ '^[0-9a-f]{40}$' THEN release_sha ELSE NULL END AS release_sha, at
      FROM (SELECT * FROM phone_issues UNION ALL SELECT * FROM backend_issues UNION ALL SELECT * FROM phone_starts) samples
    )
    SELECT source, operation, reason, category, release_sha AS "releaseSha", count(*)::int AS count,
      to_char(min(at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "firstAt",
      to_char(max(at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastAt"
    FROM safe GROUP BY source, operation, reason, category, release_sha
    ORDER BY operation, source, reason, category, release_sha
  `);
  return {
    phone: summarizeToolFailures(rows.filter(row => row.operation === "create-phone-call"), 1),
    backend: summarizeToolFailures(rows.filter(row => row.operation !== "create-phone-call"), TOOL_BACKEND_FAILURE_THRESHOLD),
  };
}

function summarizeToolFailures(groups: ToolFailureGroup[], threshold: number): ToolFailureHealth {
  const operations = new Map<string, number>();
  const sources = new Map<string, number>();
  for (const group of groups) {
    operations.set(group.operation, (operations.get(group.operation) ?? 0) + group.count);
    sources.set(group.source, (sources.get(group.source) ?? 0) + group.count);
  }
  const sampleCapped = [...sources.values()].some(count => count >= TOOL_FAILURE_SAMPLE_LIMIT);
  return {
    anomalous: sampleCapped || [...operations.values()].some(count => count >= threshold),
    count: groups.reduce((sum, row) => sum + row.count, 0), sampleCapped, groups,
  };
}
