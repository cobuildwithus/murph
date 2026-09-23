import { describe, expect, it } from "vitest";
import {
  buildHostedLiveUsageRecord,
  parseAssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import { priceHostedAiUsageForAllowance } from "@/src/lib/hosted-execution/usage-allowance";

const input = {
  memberId: "member_synthetic",
  sessionId: "live_synthetic",
  occurredAt: "2026-09-21T00:00:00.000Z",
  startDurationMs: 0,
  endDurationMs: 60_000,
};

describe("native Live usage through the existing allowance owner", () => {
  it("prices one minute at five cents and preserves the trusted duration contract", () => {
    const record = buildHostedLiveUsageRecord(input);
    expect(parseAssistantUsageRecord(record)).toEqual(record);
    expect(priceHostedAiUsageForAllowance(record).costUsdMicros).toBe(50_000n);
    expect(record.totalTokens).toBeNull();
  });

  it("charges the same total across arbitrary cumulative event partitions", () => {
    const boundaries = [0, 1, 2, 17, 999, 1000, 4501, 19_000];
    const costs = boundaries.slice(1).map((endDurationMs, index) =>
      priceHostedAiUsageForAllowance(buildHostedLiveUsageRecord({
        ...input, startDurationMs: boundaries[index]!, endDurationMs,
      })).costUsdMicros);
    expect(costs.reduce((sum, cost) => sum + cost, 0n)).toBe(15_834n);
    expect(priceHostedAiUsageForAllowance(buildHostedLiveUsageRecord({
      ...input, endDurationMs: 19_000,
    })).costUsdMicros).toBe(15_834n);
  });

  it("gives exact replays the same immutable id and separates calls and intervals", () => {
    const record = buildHostedLiveUsageRecord(input);
    expect(buildHostedLiveUsageRecord({ ...input }).usageId).toBe(record.usageId);
    for (const change of [
      { sessionId: "another_call" }, { memberId: "another_member" },
      { startDurationMs: 1000 }, { endDurationMs: 61_000 },
    ]) {
      expect(buildHostedLiveUsageRecord({ ...input, ...change }).usageId)
        .not.toBe(record.usageId);
    }
  });

  it.each([NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid or empty duration intervals (%s)", (endDurationMs) => {
      expect(() => buildHostedLiveUsageRecord({ ...input, endDurationMs })).toThrow();
    },
  );

  it("does not price malformed duration evidence or token usage as voice", () => {
    const record = buildHostedLiveUsageRecord(input);
    for (const change of [
      { inputTokens: 1 }, { provider: "browser" }, { requestedModel: "gpt-other" },
      { tokenPricingBasis: "openai-flex" as const },
      { rawUsageJson: { startDurationMs: 1000, endDurationMs: 999 } },
    ]) {
      expect(() => priceHostedAiUsageForAllowance({ ...record, ...change })).toThrow();
    }
    expect(priceHostedAiUsageForAllowance({ ...record, credentialSource: "member" })
      .costUsdMicros).toBe(0n);
  });
});
