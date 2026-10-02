import { z } from "zod";
import {
  ASSISTANT_TURN_PROFILE_COMMAND_FAMILIES,
  isAssistantTurnProfileToolIdentityLabel,
} from "./assistant-usage.ts";

export const hostedUsageDiagnosticsRequestSchema = z.object({
  days: z.number().int().min(1).max(31).optional(),
  limit: z.number().int().min(1).max(20).optional(),
}).strict();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const money = z.number().nonnegative().finite();
const label = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:/-]+$/);
const totals = z.object({
  records: count, turns: count, costUsd: money,
  inputTokens: count, cachedInputTokens: count, cacheWriteTokens: count,
  outputTokens: count, reasoningTokens: count, unpricedRecords: count,
}).strict();
const toolCounts = { calls: count, outputBytesTotal: count, outputBytesMax: count };
const tool = z.discriminatedUnion("kind", [
  z.object({ ...toolCounts, kind: z.literal("command"),
    label: z.enum(ASSISTANT_TURN_PROFILE_COMMAND_FAMILIES) }).strict(),
  z.object({ ...toolCounts, kind: z.literal("dynamic_tool"),
    label: z.string().refine((value) => isAssistantTurnProfileToolIdentityLabel("dynamic_tool", value)) }).strict(),
  z.object({ ...toolCounts, kind: z.literal("mcp_tool"),
    label: z.string().refine((value) => isAssistantTurnProfileToolIdentityLabel("mcp_tool", value)) }).strict(),
]);
export const hostedUsageDiagnosticsResponseSchema = z.discriminatedUnion("status", [
  z.object({status: z.literal("unavailable"), reason: z.enum(["group_not_supported", "hosted_access_inactive"])}).strict(),
  z.object({
    status: z.literal("available"),
    generatedAt: z.string().datetime(), windowStart: z.string().datetime(), windowEnd: z.string().datetime(),
    costBasis: z.literal("recorded_allowance_usd"), totals,
    byModel: z.array(totals.extend({model: label, pricingBasis: label}).strict()).max(20),
    bySource: z.array(totals.extend({source: label}).strict()).max(20),
    topTurns: z.array(totals.extend({
      turnId: label, occurredAt: z.string().datetime(), model: label, source: label,
      toolOutputCoverage: z.enum(["available", "partial", "unavailable"]),
      tools: z.array(tool).max(10),
    }).strict()).max(20),
    modelRates: z.array(z.object({
      model: label, pricingBasis: label, inputUsdPerMillion: money,
      cachedInputUsdPerMillion: money, cacheWriteUsdPerMillion: money,
      outputUsdPerMillion: money, pricingVersion: label,
    }).strict()).max(20),
    coverage: z.object({
      modelGroupsTruncated: z.boolean(), sourceGroupsTruncated: z.boolean(),
      allowanceExcludedRecords: count,
      toolOutputUnit: z.literal("bytes_not_tokens"),
      toolOutputScope: z.literal("latest_profile_per_top_turn"),
    }).strict(),
  }).strict(),
]);
export type HostedUsageDiagnosticsRequest = z.infer<typeof hostedUsageDiagnosticsRequestSchema>;
export type HostedUsageDiagnosticsResponse = z.infer<typeof hostedUsageDiagnosticsResponseSchema>;
export function parseHostedUsageDiagnosticsRequest(value: unknown): HostedUsageDiagnosticsRequest {
  return hostedUsageDiagnosticsRequestSchema.parse(value);
}
export function parseHostedUsageDiagnosticsResponse(value: unknown): HostedUsageDiagnosticsResponse {
  return hostedUsageDiagnosticsResponseSchema.parse(value);
}
