import { describe, expect, it, vi } from "vitest";
import { projectToolOutputs, queryHostedUsageDiagnostics, readHostedUsageDiagnostics } from "@/src/lib/hosted-execution/usage-diagnostics";
import { readHostedUsageDiagnosticModelRates } from "@/src/lib/hosted-execution/usage-allowance";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), prisma: { $queryRaw: vi.fn() } }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/src/lib/hosted-execution/usage-allowance", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-execution/usage-allowance")>(),
  readHostedAiUsageGate: mocks.gate,
}));
const now = new Date("2031-06-15T12:00:00.000Z");
const totals = { records: 3n, turns: 1n, costUsdMicros: 125000n, inputTokens: 10000n, cachedInputTokens: 8000n, cacheWriteTokens: 0n, outputTokens: 100n, reasoningTokens: 10n, unpricedRecords: 0n, allowanceExcludedRecords: 0n };
const row = { ...totals, category: "total", model: "gpt-6.1-sol", source: "message", pricingBasis: "standard", turnId: null, occurredAt: now, groups: 1n, profile: null };
function profile() { return { schema: "murph.assistant-turn-profile.v2", modelContextWindow: 100000, requestCount: 1, requests: [{ input: 10000, cachedInput: 8000, output: 100 }], requestsTruncated: false, toolsTruncated: false, tools: [{ kind: "command", label: "vault-cli automation", calls: 1, durationKnownCalls: 1, durationMs: 20, failedCalls: 0, outputBytesTotal: 12000, outputBytesMax: 12000 }] }; }
describe("usage diagnostics aggregates", () => {
  it("projects recorded costs and typed byte coverage without exposing profile payloads", async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([row, { ...row, category: "model" }, { ...row, category: "source" }, { ...row, category: "turn", turnId: "turn_test", profile: profile() }]) };
    const result = await queryHostedUsageDiagnostics({ memberId: "member_bound", now, request: {}, prisma });
    expect(result).toMatchObject({ status: "available", windowStart: "2031-06-08T12:00:00.000Z", totals: { records: 3, costUsd: 0.125 }, topTurns: [{ turnId: "turn_test", toolOutputCoverage: "available", tools: [{ label: "vault-cli automation", outputBytesTotal: 12000 }] }], coverage: { toolOutputUnit: "bytes_not_tokens" } });
    expect(JSON.stringify(result)).not.toContain('"requests"');
    expect(prisma.$queryRaw.mock.calls[0]?.[0].values).toEqual(["member_bound", new Date("2031-06-08T12:00:00.000Z"), now, 10]);
  });
  it.each([
    [{ allowed: true, allowanceSource: "thread_container" }, "group_not_supported"],
    [{ allowed: false, allowanceSource: "member", reason: "inactive" }, "hosted_access_inactive"],
  ])("denies unsupported authority without querying usage", async (gate, reason) => {
    mocks.gate.mockResolvedValue(gate); mocks.prisma.$queryRaw.mockClear();
    expect(await readHostedUsageDiagnostics({ memberId: "member_bound", request: {}, now })).toEqual({ status: "unavailable", reason });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it("permits exhausted members to inspect recorded costs", async () => {
    mocks.gate.mockResolvedValue({ allowed: false, allowanceSource: "member", reason: "ai_usage_limit_exceeded" });
    mocks.prisma.$queryRaw.mockResolvedValue([row]);
    expect(await readHostedUsageDiagnostics({ memberId: "member_bound", request: {}, now })).toMatchObject({ status: "available" });
  });
  it("reports missing, legacy, and malformed profiles honestly", () => {
    for (const value of [null, { schema: "murph.assistant-turn-profile.v1" }, { ...profile(), tools: [{ prompt: "private" }] }]) {
      expect(projectToolOutputs(value)).toEqual({ toolOutputCoverage: "unavailable", tools: [] });
    }
    expect(projectToolOutputs({ ...profile(), toolsTruncated: true })).toMatchObject({ toolOutputCoverage: "partial" });
  });
  it("derives Sol and Luna rates from the allowance price owner", () => {
    expect(readHostedUsageDiagnosticModelRates()).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "gpt-6.1-sol", pricingBasis: "standard", inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 10 }),
      expect.objectContaining({ model: "gpt-6-luna", pricingBasis: "openai-flex", inputUsdPerMillion: 0.05, cachedInputUsdPerMillion: 0.005, outputUsdPerMillion: 0.25 }),
      expect.objectContaining({ model: "gpt-6-luna", pricingBasis: "openai-priority", inputUsdPerMillion: 0.2 }),
    ]));
  });
});
