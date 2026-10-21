import { Prisma } from "@prisma/client";
import { normalizeAssistantTurnProfileJson } from "@murphai/hosted-execution/assistant-usage";
import {
  parseHostedUsageDiagnosticsRequest,
  parseHostedUsageDiagnosticsResponse,
  type HostedUsageDiagnosticsRequest,
  type HostedUsageDiagnosticsResponse,
} from "@murphai/hosted-execution/usage-diagnostics";
import { getPrisma } from "../prisma";
import { readHostedAiUsageGate, readHostedUsageDiagnosticModelRates } from "./usage-allowance";

type DiagnosticClient = Pick<ReturnType<typeof getPrisma>, "$queryRaw">;
type AggregateRow = {
  category: "total" | "model" | "source" | "turn";
  model: string | null; source: string | null; pricingBasis: string | null;
  turnId: string | null; occurredAt: Date | null; groups: bigint;
  records: bigint; turns: bigint; costUsdMicros: bigint;
  inputTokens: bigint; cachedInputTokens: bigint; cacheWriteTokens: bigint;
  outputTokens: bigint; reasoningTokens: bigint; unpricedRecords: bigint;
  profile: unknown; allowanceExcludedRecords: bigint;
};

export async function readHostedUsageDiagnostics(input: {
  memberId: string; request: HostedUsageDiagnosticsRequest; now?: Date;
  prisma?: ReturnType<typeof getPrisma>;
}): Promise<HostedUsageDiagnosticsResponse> {
  const request = parseHostedUsageDiagnosticsRequest(input.request);
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const gate = await readHostedAiUsageGate({ memberId: input.memberId, now, prisma });
  if (gate.allowanceSource === "thread_container") {
    return { status: "unavailable", reason: "group_not_supported" };
  }
  if (!gate.allowed && gate.reason !== "ai_usage_limit_exceeded") {
    return { status: "unavailable", reason: "hosted_access_inactive" };
  }
  return queryHostedUsageDiagnostics({ memberId: input.memberId, request, now, prisma });
}

// SQL does the bounded-window aggregation; only bounded groups and the latest
// sanitized profile of each selected turn cross the database boundary.
export async function queryHostedUsageDiagnostics(input: {
  memberId: string; request: HostedUsageDiagnosticsRequest; now: Date; prisma: DiagnosticClient;
}): Promise<HostedUsageDiagnosticsResponse> {
  const request = parseHostedUsageDiagnosticsRequest(input.request);
  const start = new Date(input.now.getTime() - (request.days ?? 7) * 86_400_000);
  const limit = request.limit ?? 10;
  const rows = await input.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
    WITH usage AS MATERIALIZED (
      SELECT turn_id, occurred_at,
        coalesce(served_model, requested_model, 'unknown') AS model,
        coalesce(nullif(concat_ws(':', trigger_kind, feature_key), ''), 'unknown') AS source,
        token_pricing_basis AS pricing_basis,
        allowance_cost_usd_micros, allowance_accounted_at, allowance_counted,
        input_tokens, cached_input_tokens, cache_write_tokens, output_tokens,
        reasoning_tokens, turn_profile_json, id
      FROM hosted_ai_usage
      WHERE member_id = ${input.memberId}
        AND occurred_at >= ${start} AND occurred_at < ${input.now}
        AND operator_task_id IS NULL
    ), grouped AS (
      SELECT CASE WHEN grouping(turn_id) = 0 THEN 'turn'
          WHEN grouping(model) = 0 THEN 'model'
          WHEN grouping(source) = 0 THEN 'source' ELSE 'total' END AS category,
        CASE WHEN grouping(model) = 0 THEN model
          WHEN count(DISTINCT model) > 1 THEN 'mixed' ELSE max(model) END AS model,
        CASE WHEN grouping(source) = 0 THEN source
          WHEN count(DISTINCT source) > 1 THEN 'mixed' ELSE max(source) END AS source,
        pricing_basis AS "pricingBasis", turn_id AS "turnId",
        max(occurred_at) AS "occurredAt", count(*) AS records,
        count(DISTINCT turn_id) AS turns,
        coalesce(sum(allowance_cost_usd_micros) FILTER (WHERE allowance_counted), 0)::bigint AS "costUsdMicros",
        count(*) FILTER (WHERE NOT allowance_counted) AS "allowanceExcludedRecords",
        coalesce(sum(input_tokens), 0)::bigint AS "inputTokens",
        coalesce(sum(cached_input_tokens), 0)::bigint AS "cachedInputTokens",
        coalesce(sum(cache_write_tokens), 0)::bigint AS "cacheWriteTokens",
        coalesce(sum(output_tokens), 0)::bigint AS "outputTokens",
        coalesce(sum(reasoning_tokens), 0)::bigint AS "reasoningTokens",
        count(*) FILTER (WHERE allowance_accounted_at IS NULL) AS "unpricedRecords"
      FROM usage GROUP BY GROUPING SETS ((), (model, pricing_basis), (source), (turn_id))
    ), ranked AS (
      SELECT *, count(*) OVER (PARTITION BY category) AS groups,
        row_number() OVER (PARTITION BY category ORDER BY "costUsdMicros" DESC,
          "turnId" NULLS LAST, model NULLS LAST, source NULLS LAST, "pricingBasis" NULLS LAST) AS rank
      FROM grouped
    )
    SELECT ranked.*, profile.turn_profile_json AS profile
    FROM ranked LEFT JOIN LATERAL (
      SELECT turn_profile_json FROM usage
      WHERE ranked.category = 'turn' AND turn_id = ranked."turnId"
        AND turn_profile_json IS NOT NULL
      ORDER BY occurred_at DESC, id DESC LIMIT 1
    ) profile ON true
    WHERE rank <= CASE WHEN category = 'turn' THEN ${limit} ELSE 20 END
    ORDER BY category, rank
  `);
  const summarize = (row: AggregateRow) => ({
    records: Number(row.records), turns: Number(row.turns),
    costUsd: Number(row.costUsdMicros) / 1_000_000,
    inputTokens: Number(row.inputTokens), cachedInputTokens: Number(row.cachedInputTokens),
    cacheWriteTokens: Number(row.cacheWriteTokens), outputTokens: Number(row.outputTokens),
    reasoningTokens: Number(row.reasoningTokens), unpricedRecords: Number(row.unpricedRecords),
  });
  const total = rows.find((row) => row.category === "total");
  if (!total) throw new Error("Usage diagnostics aggregate is missing.");
  return parseHostedUsageDiagnosticsResponse({
    status: "available", generatedAt: input.now.toISOString(),
    windowStart: start.toISOString(), windowEnd: input.now.toISOString(),
    costBasis: "recorded_allowance_usd", totals: summarize(total),
    byModel: rows.filter((row) => row.category === "model").map((row) => ({
      ...summarize(row), model: safeLabel(row.model), pricingBasis: safeLabel(row.pricingBasis),
    })),
    bySource: rows.filter((row) => row.category === "source").map((row) => ({
      ...summarize(row), source: safeLabel(row.source),
    })),
    topTurns: rows.filter((row) => row.category === "turn").map((row) => ({
      ...summarize(row), turnId: row.turnId,
      occurredAt: row.occurredAt?.toISOString(), model: safeLabel(row.model),
      source: safeLabel(row.source), ...projectToolOutputs(row.profile),
    })),
    modelRates: readHostedUsageDiagnosticModelRates(),
    coverage: {
      allowanceExcludedRecords: Number(total.allowanceExcludedRecords),
      modelGroupsTruncated: rows.some((row) => row.category === "model" && row.groups > 20n),
      sourceGroupsTruncated: rows.some((row) => row.category === "source" && row.groups > 20n),
      toolOutputUnit: "bytes_not_tokens", toolOutputScope: "latest_profile_per_top_turn",
    },
  });
}

function safeLabel(value: string | null): string {
  return value && /^[a-zA-Z0-9_.:/-]{1,128}$/.test(value) ? value : "unknown";
}

export function projectToolOutputs(value: unknown) {
  const profile = normalizeAssistantTurnProfileJson(value);
  if (!profile || profile.schema !== "murph.assistant-turn-profile.v2" || !Array.isArray(profile.tools)) {
    return { toolOutputCoverage: "unavailable", tools: [] };
  }
  const tools = profile.tools.map((entry: Record<string, unknown>) => ({
    kind: entry.kind, label: entry.label, calls: entry.calls,
    outputBytesTotal: entry.outputBytesTotal, outputBytesMax: entry.outputBytesMax,
  })).sort((left, right) => Number(right.outputBytesTotal) - Number(left.outputBytesTotal));
  return {
    toolOutputCoverage: profile.toolsTruncated || tools.length > 10 ? "partial" : "available",
    tools: tools.slice(0, 10),
  };
}
