import "server-only";

import { getHostedRuntimeLogPool } from "./database";
import { hostedRuntimeLogSubjectKey, type HostedRuntimeLogSqlDatabase } from "./store";
import { writeHostedRuntimeLogs } from "./write";

export type HostedRuntimeUsageGateObservation = {
  at: string;
  usageLimited: boolean;
};

export async function reportHostedRuntimeUsageGateObservation(
  input: HostedRuntimeUsageGateObservation & { userId: string },
): Promise<void> {
  try {
    await writeHostedRuntimeLogs({
      userId: input.userId,
      entries: [{
        at: input.at,
        component: "runtime",
        eventCode: "assistant.automation_detail",
        level: "info",
        phase: "invoke",
        redactedJson: { type: "runtime.ai_usage_gate", usageLimited: input.usageLimited },
      }],
    });
  } catch {
    console.warn("Runtime usage-gate diagnostic could not be recorded.");
  }
}

// One subject-scoped query, at most the runtime callback's 50 candidates.
// A reset cannot erase these observations as it can the current allowance row.
export async function findHostedUsageLimitedPersonalPatternsOccurrences(input: {
  database?: Pick<HostedRuntimeLogSqlDatabase, "query">;
  occurrences: readonly { occurrenceAt: string; observedAt: string }[];
  userId: string;
}): Promise<Set<string>> {
  if (input.occurrences.length === 0) return new Set();
  if (input.occurrences.length > 50) throw new RangeError("Too many alert occurrences.");
  const result = await (input.database ?? getHostedRuntimeLogPool()).query<{
    occurrenceAt: string;
  }>(`
    WITH candidates AS (
      SELECT * FROM unnest($2::text[], $3::timestamptz[])
        AS candidate(occurrence_at, observed_at)
    )
    SELECT DISTINCT occurrence_at AS "occurrenceAt"
    FROM candidates
    WHERE (
      SELECT redacted_json->>'usageLimited' = 'true'
      FROM hosted_runtime_log
      WHERE subject_key = $1 AND event_code = 'assistant.automation_detail'
        AND redacted_json->>'type' = 'runtime.ai_usage_gate'
        AND at <= occurrence_at::timestamptz
      ORDER BY at DESC, (redacted_json->>'usageLimited' = 'true') ASC, id DESC
      LIMIT 1
    ) OR EXISTS (
      SELECT 1 FROM hosted_runtime_log
      WHERE subject_key = $1 AND event_code = 'assistant.automation_detail'
        AND redacted_json->>'type' = 'runtime.ai_usage_gate'
        AND at > occurrence_at::timestamptz AND at <= observed_at
        AND redacted_json->>'usageLimited' = 'true'
    ) OR EXISTS (
      SELECT 1 FROM hosted_runtime_log
      WHERE subject_key = $1 AND event_code = 'assistant.automation_detail'
        AND at >= occurrence_at::timestamptz AND at <= observed_at
        AND redacted_json->>'type' = 'cron.job.completed'
        AND redacted_json->>'failureAutomationSlug' = 'personal-patterns-update'
        AND redacted_json->>'failureOccurrenceAt' = occurrence_at
        AND redacted_json->>'failureRunOutcome' = 'failed'
        AND (error_code = 'ASSISTANT_CODEX_USAGE_LIMIT'
          OR redacted_json->>'failureErrorCode' = 'ASSISTANT_CODEX_USAGE_LIMIT')
    )
  `, [
    hostedRuntimeLogSubjectKey(input.userId),
    input.occurrences.map(({ occurrenceAt }) => occurrenceAt),
    input.occurrences.map(({ observedAt }) => observedAt),
  ]);
  return new Set(result.rows.map(({ occurrenceAt }) => occurrenceAt));
}
