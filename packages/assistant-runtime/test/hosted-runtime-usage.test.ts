import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deletePendingAssistantUsageRecord: vi.fn(),
  listPendingAssistantUsageRecords: vi.fn(),
  recordHostedExecutionAiUsage: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@murph/runtime-state", async () => {
  const actual = await vi.importActual<typeof import("@murph/runtime-state")>("@murph/runtime-state");

  return {
    ...actual,
    deletePendingAssistantUsageRecord: mocks.deletePendingAssistantUsageRecord,
    listPendingAssistantUsageRecords: mocks.listPendingAssistantUsageRecords,
  };
});

vi.mock("@murph/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murph/hosted-execution")>("@murph/hosted-execution");

  return {
    ...actual,
    recordHostedExecutionAiUsage: mocks.recordHostedExecutionAiUsage,
  };
});

import { exportHostedPendingAssistantUsage } from "../src/hosted-runtime/usage.ts";

describe("exportHostedPendingAssistantUsage", () => {
  const originalWarn = console.warn;

  beforeEach(() => {
    vi.clearAllMocks();
    console.warn = mocks.warn;
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  it("exports pending usage and tags a member-supplied key when the api key env came from userEnv", async () => {
    mocks.listPendingAssistantUsageRecords.mockResolvedValue([
      {
        apiKeyEnv: "OPENAI_API_KEY",
        attemptCount: 1,
        baseUrl: "https://api.example.test/v1",
        cacheWriteTokens: null,
        cachedInputTokens: 8,
        credentialSource: null,
        inputTokens: 120,
        memberId: "member_123",
        occurredAt: "2026-03-29T12:00:00.000Z",
        outputTokens: 45,
        provider: "openai-compatible",
        providerMetadataJson: null,
        providerName: "example",
        providerRequestId: "req_123",
        providerSessionId: null,
        rawUsageJson: null,
        reasoningTokens: 8,
        requestedModel: "gpt-5.4-mini",
        routeId: "primary",
        schema: "murph.assistant-usage.v1",
        servedModel: "gpt-5.4-mini",
        sessionId: "asst_123",
        totalTokens: 165,
        turnId: "turn_123",
        usageId: "turn_123.attempt-1",
      },
    ]);
    mocks.recordHostedExecutionAiUsage.mockResolvedValue({
      recorded: 1,
      usageIds: ["turn_123.attempt-1"],
    });

    const result = await exportHostedPendingAssistantUsage({
      baseUrl: "https://join.example.test",
      internalToken: "internal-token",
      timeoutMs: 10_000,
      userEnv: {
        OPENAI_API_KEY: "sk-user",
      },
      vaultRoot: "/tmp/vault",
    });

    expect(result).toEqual({
      exported: 1,
      failed: 0,
      pending: 0,
    });
    expect(mocks.recordHostedExecutionAiUsage).toHaveBeenCalledWith({
      baseUrl: "https://join.example.test",
      internalToken: "internal-token",
      timeoutMs: 10_000,
      usage: [
        expect.objectContaining({
          usageId: "turn_123.attempt-1",
          credentialSource: "member",
        }),
      ],
    });
    expect(mocks.deletePendingAssistantUsageRecord).toHaveBeenCalledWith({
      usageId: "turn_123.attempt-1",
      vault: "/tmp/vault",
    });
  });

  it("leaves pending usage on export failure", async () => {
    mocks.listPendingAssistantUsageRecords.mockResolvedValue([
      {
        apiKeyEnv: null,
        attemptCount: 1,
        baseUrl: null,
        cacheWriteTokens: null,
        cachedInputTokens: null,
        credentialSource: null,
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: "2026-03-29T12:00:00.000Z",
        outputTokens: 5,
        provider: "codex-cli",
        providerMetadataJson: null,
        providerName: null,
        providerRequestId: null,
        providerSessionId: "sess_123",
        rawUsageJson: null,
        reasoningTokens: null,
        requestedModel: "gpt-5.4",
        routeId: "primary",
        schema: "murph.assistant-usage.v1",
        servedModel: "gpt-5.4",
        sessionId: "asst_123",
        totalTokens: 15,
        turnId: "turn_123",
        usageId: "turn_123.attempt-1",
      },
    ]);
    mocks.recordHostedExecutionAiUsage.mockRejectedValue(new Error("boom"));

    const result = await exportHostedPendingAssistantUsage({
      baseUrl: "https://join.example.test",
      internalToken: "internal-token",
      timeoutMs: 10_000,
      userEnv: {},
      vaultRoot: "/tmp/vault",
    });

    expect(result).toEqual({
      exported: 0,
      failed: 1,
      pending: 1,
    });
    expect(mocks.deletePendingAssistantUsageRecord).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });
});
