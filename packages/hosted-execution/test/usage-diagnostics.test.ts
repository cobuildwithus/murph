import { describe, expect, it } from "vitest";
import { parseHostedUsageDiagnosticsRequest, parseHostedUsageDiagnosticsResponse } from "../src/usage-diagnostics.js";

describe("private bounded usage diagnostics contract", () => {
  it("uses canonical tool labels without relaxing model or source identities", () => {
    const totals = { records: 1, turns: 1, costUsd: 0.1, inputTokens: 100,
      cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1,
      reasoningTokens: 0, unpricedRecords: 0 };
    const report = {
      status: "available", generatedAt: "2031-06-15T12:00:00.000Z",
      windowStart: "2031-06-08T12:00:00.000Z", windowEnd: "2031-06-15T12:00:00.000Z",
      costBasis: "recorded_allowance_usd", totals, byModel: [], bySource: [], modelRates: [],
      coverage: { allowanceExcludedRecords: 0, modelGroupsTruncated: false, sourceGroupsTruncated: false,
        toolOutputUnit: "bytes_not_tokens", toolOutputScope: "latest_profile_per_top_turn" },
    };
    const turn = { ...totals, turnId: "turn_synthetic", occurredAt: report.generatedAt,
      model: "gpt-6.1-sol", source: "automation-cron", toolOutputCoverage: "available" };
    for (const tool of [
      { kind: "command", label: "vault-cli automation" },
      { kind: "dynamic_tool", label: "t_automation" },
      { kind: "mcp_tool", label: "mcp_tool" },
    ]) {
      expect(() => parseHostedUsageDiagnosticsResponse({ ...report, topTurns: [{ ...turn,
        tools: [{ ...tool, calls: 1, outputBytesTotal: 10, outputBytesMax: 10 }] }] })).not.toThrow();
    }
    for (const tool of [
      { kind: "command", label: "arbitrary private command" },
      { kind: "dynamic_tool", label: "vault-cli automation" },
      { kind: "mcp_tool", label: "t_secret/private" },
    ]) {
      expect(() => parseHostedUsageDiagnosticsResponse({ ...report, topTurns: [{ ...turn,
        tools: [{ ...tool, calls: 1, outputBytesTotal: 10, outputBytesMax: 10 }] }] })).toThrow();
    }
    expect(() => parseHostedUsageDiagnosticsResponse({ ...report,
      topTurns: [{ ...turn, source: "arbitrary private content", tools: [] }] })).toThrow();
  });
  it("accepts only bounded query options and never caller identity", () => {
    expect(parseHostedUsageDiagnosticsRequest({})).toEqual({});
    expect(parseHostedUsageDiagnosticsRequest({ days: 31, limit: 20 })).toEqual({ days: 31, limit: 20 });
    for (const request of [{ days: 0 }, { days: 32 }, { days: 1.1 }, { limit: 0 }, { limit: 21 }, { memberId: "other" }, { sql: "SELECT 1" }]) {
      expect(() => parseHostedUsageDiagnosticsRequest(request)).toThrow();
    }
  });
  it("rejects unexpected response payloads instead of leaking content", () => {
    expect(parseHostedUsageDiagnosticsResponse({ status: "unavailable", reason: "group_not_supported" })).toEqual({ status: "unavailable", reason: "group_not_supported" });
    expect(() => parseHostedUsageDiagnosticsResponse({ status: "unavailable", reason: "group_not_supported", prompt: "private" })).toThrow();
  });
});
