import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deletePendingAssistantUsageRecord: vi.fn(),
  listPendingAssistantUsageRecords: vi.fn(),
  recordUsage: vi.fn(),
  resolveHostedExecutionAiUsageClient: vi.fn(),
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
    resolveHostedExecutionAiUsageClient: mocks.resolveHostedExecutionAiUsageClient,
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

  it("exports stored credential ownership without reclassifying at export time", async () => {
    mocks.resolveHostedExecutionAiUsageClient.mockReturnValue({
      recordUsage: mocks.recordUsage,
    });
    mocks.listPendingAssistantUsageRecords.mockResolvedValue([
      {
        apiKeyEnv: "OPENAI_API_KEY",
        attemptCount: 1,
        baseUrl: "https://api.example.test/v1",
        cacheWriteTokens: null,
        cachedInputTokens: 8,
        credentialSource: "member",
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
    mocks.recordUsage.mockResolvedValue({
      recorded: 1,
      usageIds: ["turn_123.attempt-1"],
    });

    const result = await exportHostedPendingAssistantUsage({
      baseUrl: "https://join.example.test",
      internalToken: "internal-token",
      timeoutMs: 10_000,
      userId: "member_123",
      userEnvKeys: [],
      vaultRoot: "/tmp/vault",
    });

    expect(result).toEqual({
      exported: 1,
      failed: 0,
      pending: 0,
    });
    expect(mocks.resolveHostedExecutionAiUsageClient).toHaveBeenCalledWith({
      baseUrl: "https://join.example.test",
      boundUserId: "member_123",
      fetchImpl: undefined,
      internalToken: "internal-token",
      timeoutMs: 10_000,
    });
    expect(mocks.recordUsage).toHaveBeenCalledWith([
        expect.objectContaining({
          usageId: "turn_123.attempt-1",
          credentialSource: "member",
        }),
      ]);
    expect(mocks.deletePendingAssistantUsageRecord).toHaveBeenCalledWith({
      usageId: "turn_123.attempt-1",
      vault: "/tmp/vault",
    });
  });

  it("leaves pending usage on export failure", async () => {
    mocks.resolveHostedExecutionAiUsageClient.mockReturnValue({
      recordUsage: mocks.recordUsage,
    });
    mocks.listPendingAssistantUsageRecords.mockResolvedValue([
      {
        apiKeyEnv: null,
        attemptCount: 1,
        baseUrl: null,
        cacheWriteTokens: null,
        cachedInputTokens: null,
        credentialSource: "platform",
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
    mocks.recordUsage.mockRejectedValue(new Error("boom"));

    const result = await exportHostedPendingAssistantUsage({
      baseUrl: "https://join.example.test",
      internalToken: "internal-token",
      timeoutMs: 10_000,
      userId: "member_123",
      userEnvKeys: [],
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

  it("exports pending usage in batches and deletes only acknowledged ids", async () => {
    mocks.resolveHostedExecutionAiUsageClient.mockReturnValue({
      recordUsage: mocks.recordUsage,
    });
    mocks.listPendingAssistantUsageRecords.mockResolvedValue([
      {
        apiKeyEnv: null,
        attemptCount: 1,
        baseUrl: null,
        cacheWriteTokens: null,
        cachedInputTokens: null,
        credentialSource: "platform",
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
      {
        apiKeyEnv: null,
        attemptCount: 2,
        baseUrl: null,
        cacheWriteTokens: null,
        cachedInputTokens: null,
        credentialSource: "platform",
        inputTokens: 20,
        memberId: "member_123",
        occurredAt: "2026-03-29T12:00:01.000Z",
        outputTokens: 8,
        provider: "codex-cli",
        providerMetadataJson: null,
        providerName: null,
        providerRequestId: null,
        providerSessionId: "sess_124",
        rawUsageJson: null,
        reasoningTokens: null,
        requestedModel: "gpt-5.4",
        routeId: "primary",
        schema: "murph.assistant-usage.v1",
        servedModel: "gpt-5.4",
        sessionId: "asst_123",
        totalTokens: 28,
        turnId: "turn_123",
        usageId: "turn_123.attempt-2",
      },
    ]);
    mocks.recordUsage.mockResolvedValue({
      recorded: 1,
      usageIds: ["turn_123.attempt-1"],
    });

    const result = await exportHostedPendingAssistantUsage({
      baseUrl: "https://join.example.test",
      internalToken: "internal-token",
      timeoutMs: 10_000,
      userId: "member_123",
      userEnvKeys: [],
      vaultRoot: "/tmp/vault",
    });

    expect(result).toEqual({
      exported: 1,
      failed: 1,
      pending: 1,
    });
    expect(mocks.recordUsage).toHaveBeenCalledWith([
        expect.objectContaining({
          usageId: "turn_123.attempt-1",
        }),
        expect.objectContaining({
          usageId: "turn_123.attempt-2",
        }),
      ]);
    expect(mocks.deletePendingAssistantUsageRecord).toHaveBeenCalledTimes(1);
    expect(mocks.deletePendingAssistantUsageRecord).toHaveBeenCalledWith({
      usageId: "turn_123.attempt-1",
      vault: "/tmp/vault",
    });
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it("uses a legacy export-time fallback only for pre-existing rows with null credentialSource", async () => {
    mocks.resolveHostedExecutionAiUsageClient.mockReturnValue({
      recordUsage: mocks.recordUsage,
    });
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
    mocks.recordUsage.mockResolvedValue({
      recorded: 1,
      usageIds: ["turn_123.attempt-1"],
    });

    await exportHostedPendingAssistantUsage({
      baseUrl: "https://join.example.test",
      internalToken: "internal-token",
      timeoutMs: 10_000,
      userId: "member_123",
      userEnvKeys: [],
      vaultRoot: "/tmp/vault",
    });

    expect(mocks.recordUsage).toHaveBeenCalledWith([
      expect.objectContaining({
        credentialSource: "platform",
        usageId: "turn_123.attempt-1",
      }),
    ]);
  });
});
