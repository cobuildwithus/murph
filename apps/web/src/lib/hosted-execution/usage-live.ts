import {
  HOSTED_LIVE_USAGE_SOURCE,
  HOSTED_LIVE_USAGE_VERSION,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";

export const HOSTED_LIVE_PRICING_SOURCE =
  "https://developers.openai.com/api/docs/models/gpt-live-1";
export const HOSTED_LIVE_PRICING_VERSION = "openai-live-duration-2026-09-21";

/** Difference of cumulative prices avoids charging rounding again per event. */
export function priceHostedLiveUsage(record: AssistantUsageRecord): bigint | null {
  if (record.usageExtractionSourcePath !== HOSTED_LIVE_USAGE_SOURCE) return null;
  if (record.provider !== "codex-cli" || record.providerName !== "openai"
    || record.featureKey !== "live-voice"
    || record.usageExtractionVersion !== HOSTED_LIVE_USAGE_VERSION
    || record.requestedModel !== "gpt-live-1"
    || (record.servedModel !== null && record.servedModel !== "gpt-live-1")
    || (record.tokenPricingBasis ?? "standard") !== "standard"
    || [record.inputTokens, record.outputTokens, record.cachedInputTokens,
      record.cacheWriteTokens, record.reasoningTokens, record.totalTokens]
      .some((value) => value !== null)) {
    throw new TypeError("Invalid native Live duration usage record.");
  }
  const start = record.rawUsageJson?.startDurationMs;
  const end = record.rawUsageJson?.endDurationMs;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0
    || typeof end !== "number" || !Number.isSafeInteger(end) || end <= start) {
    throw new TypeError("Live usage requires an increasing duration interval.");
  }
  // $0.05/minute, or 5/6 USD micro per millisecond, with no whole-minute rounding.
  const cumulativeCost = (milliseconds: number) => (BigInt(milliseconds) * 5n + 5n) / 6n;
  return cumulativeCost(end) - cumulativeCost(start);
}
