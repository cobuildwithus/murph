import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordHostedAiUsageRecords,
  recordHostedAiUsageRecordsAndSendLimitNotices,
} from "@/src/lib/hosted-execution/usage";

const allowanceMocks = vi.hoisted(() => ({
  accountHostedAiUsageForAllowanceTx: vi.fn(),
  readHostedAiUsageLimitNoticeCandidate: vi.fn(),
  sendHostedAiUsageLimitNotice: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  accountHostedAiUsageForAllowanceTx: allowanceMocks.accountHostedAiUsageForAllowanceTx,
  readHostedAiUsageLimitNoticeCandidate:
    allowanceMocks.readHostedAiUsageLimitNoticeCandidate,
}));

vi.mock("@/src/lib/hosted-execution/usage-gate-notice", () => ({
  sendHostedAiUsageLimitNotice: allowanceMocks.sendHostedAiUsageLimitNotice,
}));

const BASE_USAGE_RECORD = {
  apiKeyEnv: "OPENAI_API_KEY",
  attemptCount: 1,
  baseUrl: "https://api.openai.com/v1",
  cacheWriteTokens: 3,
  cachedInputTokens: 12,
  credentialSource: "platform",
  inputTokens: 120,
  memberId: "member_123",
  occurredAt: "2026-03-29T12:00:00.000Z",
  outputTokens: 45,
  provider: "codex-cli",
  providerMetadataJson: {
    headers: {
      authorization: "redacted-test-header",
    },
    nested: {
      ignored: undefined,
    },
    prompt: "redacted test prompt",
    provider: "openai",
  },
  providerName: "openai",
  providerRequestId: "req_123",
  codexThreadId: "session_123",
  rawUsageJson: {
    input_tokens: 120,
    input_tokens_details: {
      cached_tokens: 12,
    },
    output_tokens: 45,
    output_tokens_details: {
      reasoning_tokens: 8,
    },
    total_tokens: 165,
  },
  rawUsageJsonHash: "sha256:hosted-usage-hash",
  reasoningTokens: 8,
  requestedModel: "gpt-5.5",
  routeId: "primary",
  schema: "murph.assistant-usage.v1",
  servedModel: "gpt-5.5",
  sessionId: "asst_123",
  stripeMeterSource: "murph",
  totalTokens: 165,
  turnId: "turn_123",
  usageId: "turn_123.attempt-1",
  usageExtractionSourcePath: "params.usage",
  usageExtractionVersion: "codex-usage-v1",
} as const;

describe("recordHostedAiUsageRecords", () => {
  beforeEach(() => {
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockReset();
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(null);
    allowanceMocks.readHostedAiUsageLimitNoticeCandidate.mockReset();
    allowanceMocks.readHostedAiUsageLimitNoticeCandidate.mockResolvedValue(null);
    allowanceMocks.sendHostedAiUsageLimitNotice.mockReset();
    allowanceMocks.sendHostedAiUsageLimitNotice.mockResolvedValue({ status: "sent" });
  });

  it("sends one proactive limit notice after accounting reports the first crossing", async () => {
    const periodStart = new Date("2026-03-01T00:00:00.000Z");
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const hostedAiUsageFindUnique = vi.fn(async () => ({
      allowancePeriodStart: periodStart,
    }));
    const prisma = makeUsagePrismaClient(
      hostedAiUsageUpsert,
      undefined,
      hostedAiUsageFindUnique,
    );
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(undefined);
    allowanceMocks.readHostedAiUsageLimitNoticeCandidate.mockResolvedValue({
      memberId: "member_123",
      periodStart,
      userNotice: {
        code: "edge_usage_limit_reached",
        message: "limit reached",
      },
    });

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(allowanceMocks.readHostedAiUsageLimitNoticeCandidate).toHaveBeenCalledWith({
      memberId: "member_123",
      periodStart,
      prisma,
    });
    expect(allowanceMocks.sendHostedAiUsageLimitNotice).toHaveBeenCalledExactlyOnceWith({
      memberId: "member_123",
      notice: {
        code: "edge_usage_limit_reached",
        message: "limit reached",
      },
      periodStart,
      prisma,
    });
  });

  it("rejects transaction-compatible clients before recording usage or sending notices", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).rejects.toThrow("requires a PrismaClient owner");

    expect(hostedAiUsageUpsert).not.toHaveBeenCalled();
    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).not.toHaveBeenCalled();
    expect(allowanceMocks.sendHostedAiUsageLimitNotice).not.toHaveBeenCalled();
  });

  it("sends the crossing notice once after recording and keeps the result when delivery fails", async () => {
    const periodStart = new Date("2026-03-01T00:00:00.000Z");
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const hostedAiUsageFindUnique = vi.fn()
      .mockResolvedValueOnce({
        allowancePeriodStart: periodStart,
      })
      .mockResolvedValueOnce({
        allowancePeriodStart: null,
      });
    const prisma = makeUsagePrismaClient(
      hostedAiUsageUpsert,
      undefined,
      hostedAiUsageFindUnique,
    );
    const userNotice = {
      code: "pulse_upgrade_edge",
      message: "limit reached",
    };
    // Only the first record crosses the limit; the second stays under it.
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(undefined);
    allowanceMocks.sendHostedAiUsageLimitNotice.mockResolvedValue({ status: "failed" });
    allowanceMocks.readHostedAiUsageLimitNoticeCandidate.mockResolvedValue({
      memberId: "member_123",
      periodStart,
      userNotice,
    });

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        BASE_USAGE_RECORD,
        {
          ...BASE_USAGE_RECORD,
          providerRequestOrdinal: 1,
          usageId: "turn_123.request-1.attempt-1",
        },
      ],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1", "turn_123.request-1.attempt-1"],
    });

    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledTimes(2);
    expect(allowanceMocks.sendHostedAiUsageLimitNotice).toHaveBeenCalledExactlyOnceWith({
      memberId: "member_123",
      notice: userNotice,
      periodStart,
      prisma,
    });
    // The wrapper keeps recording/accounting DB-only, then flushes the
    // external send after the first record's transaction commits.
    const accountingOrder = allowanceMocks.accountHostedAiUsageForAllowanceTx.mock.invocationCallOrder;
    const sendOrder = allowanceMocks.sendHostedAiUsageLimitNotice.mock.invocationCallOrder[0];
    expect(sendOrder).toBeGreaterThan(accountingOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(sendOrder).toBeLessThan(accountingOrder[1] ?? Number.NEGATIVE_INFINITY);
  });

  it("flushes a proactive notice for an earlier committed record before a later record fails", async () => {
    const periodStart = new Date("2026-03-01T00:00:00.000Z");
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const hostedAiUsageFindUnique = vi.fn(async () => ({
      allowancePeriodStart: periodStart,
    }));
    const prisma = makeUsagePrismaClient(
      hostedAiUsageUpsert,
      undefined,
      hostedAiUsageFindUnique,
    );
    allowanceMocks.accountHostedAiUsageForAllowanceTx
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("accounting failed"));
    allowanceMocks.readHostedAiUsageLimitNoticeCandidate.mockResolvedValue({
      memberId: "member_123",
      periodStart,
      userNotice: {
        code: "pulse_upgrade_edge",
        message: "limit reached",
      },
    });

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        BASE_USAGE_RECORD,
        {
          ...BASE_USAGE_RECORD,
          providerRequestOrdinal: 1,
          usageId: "turn_123.request-1.attempt-1",
        },
      ],
    })).rejects.toThrow("accounting failed");

    expect(allowanceMocks.sendHostedAiUsageLimitNotice).toHaveBeenCalledExactlyOnceWith({
      memberId: "member_123",
      notice: {
        code: "pulse_upgrade_edge",
        message: "limit reached",
      },
      periodStart,
      prisma,
    });
    const sendOrder = allowanceMocks.sendHostedAiUsageLimitNotice.mock.invocationCallOrder[0];
    const secondAccountingOrder =
      allowanceMocks.accountHostedAiUsageForAllowanceTx.mock.invocationCallOrder[1];
    expect(sendOrder).toBeLessThan(secondAccountingOrder ?? Number.NEGATIVE_INFINITY);
  });

  it("does not send a limit notice until the recording transaction resolves", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const periodStart = new Date("2026-03-01T00:00:00.000Z");
    const hostedAiUsageFindUnique = vi.fn(async () => ({
      allowancePeriodStart: periodStart,
    }));
    const tx = makeUsagePrisma(
      hostedAiUsageUpsert,
      undefined,
      hostedAiUsageFindUnique,
    );
    const transactionResolved = vi.fn();
    const prisma = {
      ...tx,
      $transaction: vi.fn(async <T>(run: (transaction: typeof tx) => Promise<T>) => {
        const result = await run(tx);
        expect(allowanceMocks.sendHostedAiUsageLimitNotice).not.toHaveBeenCalled();
        transactionResolved();
        return result;
      }),
    };
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(undefined);
    allowanceMocks.readHostedAiUsageLimitNoticeCandidate.mockResolvedValue({
      memberId: "member_123",
      periodStart,
      userNotice: {
        code: "edge_usage_limit_reached",
        message: "limit reached",
      },
    });

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(transactionResolved).toHaveBeenCalledOnce();
    expect(allowanceMocks.sendHostedAiUsageLimitNotice).toHaveBeenCalledOnce();
    const transactionResolvedOrder = transactionResolved.mock.invocationCallOrder[0];
    const sendOrder = allowanceMocks.sendHostedAiUsageLimitNotice.mock.invocationCallOrder[0];
    expect(sendOrder).toBeGreaterThan(
      transactionResolvedOrder ?? Number.POSITIVE_INFINITY,
    );
  });

  it("reattempts the proactive notice from persisted period state on idempotent usage retries", async () => {
    const periodStart = new Date("2026-03-01T00:00:00.000Z");
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const hostedAiUsageFindUnique = vi.fn(async () => ({
      allowancePeriodStart: periodStart,
    }));
    const prisma = makeUsagePrismaClient(
      hostedAiUsageUpsert,
      undefined,
      hostedAiUsageFindUnique,
    );
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(undefined);
    allowanceMocks.readHostedAiUsageLimitNoticeCandidate.mockResolvedValue({
      memberId: "member_123",
      periodStart,
      userNotice: {
        code: "pulse_upgrade_edge",
        message: "limit reached",
      },
    });

    await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(hostedAiUsageFindUnique).toHaveBeenCalledWith({
      where: {
        id: "turn_123.attempt-1",
      },
      select: {
        allowancePeriodStart: true,
      },
    });
    expect(allowanceMocks.readHostedAiUsageLimitNoticeCandidate).toHaveBeenCalledWith({
      memberId: "member_123",
      periodStart,
      prisma,
    });
    expect(allowanceMocks.sendHostedAiUsageLimitNotice).toHaveBeenCalledExactlyOnceWith({
      memberId: "member_123",
      notice: {
        code: "pulse_upgrade_edge",
        message: "limit reached",
      },
      periodStart,
      prisma,
    });
  });

  it("keeps recorded usage results when the post-commit notice lookup fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const periodStart = new Date("2026-03-01T00:00:00.000Z");
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const hostedAiUsageFindUnique = vi.fn(async () => ({
      allowancePeriodStart: periodStart,
    }));
    const prisma = makeUsagePrismaClient(
      hostedAiUsageUpsert,
      undefined,
      hostedAiUsageFindUnique,
    );
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(undefined);
    allowanceMocks.readHostedAiUsageLimitNoticeCandidate.mockRejectedValue(
      new Error("candidate lookup failed"),
    );

    try {
      await expect(recordHostedAiUsageRecordsAndSendLimitNotices({
        accountAllowance: true,
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      })).resolves.toEqual({
        recordedIds: ["turn_123.attempt-1"],
      });

      expect(allowanceMocks.sendHostedAiUsageLimitNotice).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        "Hosted AI usage limit notice pass failed after accounting commit.",
        {
          errorName: "Error",
        },
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps the transaction-compatible recorder DB-only when accounting reports a crossing", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    allowanceMocks.accountHostedAiUsageForAllowanceTx.mockResolvedValue(undefined);

    await expect(recordHostedAiUsageRecords({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledOnce();
    expect(allowanceMocks.sendHostedAiUsageLimitNotice).not.toHaveBeenCalled();
  });

  it("does not send a limit notice when accounting reports no crossing", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await recordHostedAiUsageRecords({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledOnce();
    expect(allowanceMocks.sendHostedAiUsageLimitNotice).not.toHaveBeenCalled();
  });

  it("does not account allowance or send notices when accounting is disabled", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).not.toHaveBeenCalled();
    expect(allowanceMocks.sendHostedAiUsageLimitNotice).not.toHaveBeenCalled();
  });

  it("persists explicit token pricing basis and accounts the normalized record", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await expect(recordHostedAiUsageRecords({
      accountAllowance: true,
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [{
        ...BASE_USAGE_RECORD,
        tokenPricingBasis: "openai-flex",
      }],
    })).resolves.toEqual({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        tokenPricingBasis: "openai-flex",
      }),
    }));
    expect(allowanceMocks.accountHostedAiUsageForAllowanceTx).toHaveBeenCalledExactlyOnceWith({
      memberId: "member_123",
      record: expect.objectContaining({
        tokenPricingBasis: "openai-flex",
      }),
      tx: prisma,
    });
  });

  it("persists sanitized usage metadata without provider debug fields", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    const result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledWith({
      where: {
        id: "turn_123.attempt-1",
      },
      create: expect.objectContaining({
        id: "turn_123.attempt-1",
        memberId: "member_123",
        providerRequestId: "req_123",
        providerRequestOutcome: "succeeded",
        providerRequestOrdinal: 0,
        rawUsageJson: {
          input_tokens: 120,
          input_tokens_details: {
            cached_tokens: 12,
          },
          output_tokens: 45,
          output_tokens_details: {
            reasoning_tokens: 8,
          },
          total_tokens: 165,
        },
        rawUsageJsonHash: "sha256:hosted-usage-hash",
        stripeMeterError:
          "Hosted AI usage is recorded locally; Stripe usage metering is not configured.",
        stripeMeterSource: "murph",
        stripeMeterStatus: "skipped",
        tokenPricingBasis: "standard",
        totalTokens: 165,
        usageExtractionSourcePath: "params.usage",
        usageExtractionVersion: "codex-usage-v1",
      }),
      select: expect.any(Object),
      update: {},
    });
    const upsertCall = hostedAiUsageUpsert.mock.calls[0]?.[0] as { create?: Record<string, unknown> } | undefined;
    expect(upsertCall?.create).toBeDefined();
    expect(upsertCall?.create).not.toHaveProperty("codexThreadId");
    expect(upsertCall?.create).not.toHaveProperty("providerMetadataJson");
    expect(JSON.stringify(upsertCall?.create?.rawUsageJson)).not.toContain("prompt");
    expect(JSON.stringify(upsertCall?.create?.rawUsageJson)).not.toContain("authorization");
    expect(prisma.hostedAiUsage.updateMany).toHaveBeenCalledWith({
      where: {
        id: "turn_123.attempt-1",
        stripeMeterSource: "murph",
        stripeMeterStatus: {
          in: ["pending", "processing"],
        },
      },
      data: {
        stripeMeterError:
          "Hosted AI usage is recorded locally; Stripe usage metering is not configured.",
        stripeMeterNextAttemptAt: null,
        stripeMeterStatus: "skipped",
      },
    });
  });

  it("does not read billing refs while recording local usage", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const findUnique = vi.fn(async () => {
      throw new Error("billing ref lookup should not run while recording local usage");
    });
    const prisma = makeUsagePrisma(hostedAiUsageUpsert, findUnique);

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(findUnique).not.toHaveBeenCalled();
    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        stripeMeterError:
          "Hosted AI usage is recorded locally; Stripe usage metering is not configured.",
        stripeMeterSource: "murph",
        stripeMeterStatus: "skipped",
      }),
    }));
  });

  it("persists failed provider request outcomes for hosted usage imports", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            ...BASE_USAGE_RECORD,
            providerRequestOutcome: "failed",
          },
        ],
      }),
    ).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        providerRequestOutcome: "failed",
      }),
    }));
  });

  it("persists the validated per-turn profile JSON and drops invalid profiles", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    const turnProfileJson = {
      modelContextWindow: 258400,
      requestCount: 1,
      requests: [{ cachedInput: 12, input: 120, output: 45 }],
      requestsTruncated: false,
      schema: "murph.assistant-turn-profile.v1",
      tools: [
        { calls: 1, durationMs: 420, label: "vault-cli samples query", outputChars: 2048 },
      ],
      toolsTruncated: false,
    };

    const result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [{ ...BASE_USAGE_RECORD, turnProfileJson }],
    });

    expect(result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        turnProfileJson,
      }),
    }));

    // Out-of-contract profiles must not reject the row: the usage record is
    // still persisted for billing, just without the telemetry payload.
    const droppedUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const droppedPrisma = makeUsagePrisma(droppedUpsert);

    const droppedResult = await recordHostedAiUsageRecords({
      prisma: droppedPrisma as never,
      trustedUserId: "member_123",
      usage: [{
        ...BASE_USAGE_RECORD,
        turnProfileJson: {
          ...turnProfileJson,
          tools: [
            { calls: 1, durationMs: 0, label: "grep 'member glucose'", outputChars: 1 },
          ],
        },
      }],
    });

    expect(droppedResult.recordedIds).toEqual(["turn_123.attempt-1"]);
    const droppedCreate = droppedUpsert.mock.calls[0]?.[0]?.create as
      | Record<string, unknown>
      | undefined;
    expect(droppedCreate).toBeDefined();
    expect(droppedCreate?.turnProfileJson).toBeUndefined();
    expect(droppedCreate?.inputTokens).toBe(120);
  });

  it("dedupes identical usage rows by usageId before persisting them", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    const result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD, BASE_USAGE_RECORD],
    });

    expect(result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledTimes(1);
  });

  it("dedupes omitted and explicit first provider request ordinals", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    const result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        BASE_USAGE_RECORD,
        {
          ...BASE_USAGE_RECORD,
          providerRequestOrdinal: 0,
        },
      ],
    });

    expect(result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledTimes(1);
  });

  it("persists continuation provider requests as separate usage rows", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);
    const continuationUsage = {
      ...BASE_USAGE_RECORD,
      providerRequestOrdinal: 1,
      usageId: "turn_123.request-1.attempt-1",
    };

    const result = await recordHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD, continuationUsage],
    });

    expect(result.recordedIds).toEqual([
      "turn_123.attempt-1",
      "turn_123.request-1.attempt-1",
    ]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledTimes(2);
    expect(hostedAiUsageUpsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        id: "turn_123.attempt-1",
      },
      create: expect.objectContaining({
        providerRequestOrdinal: 0,
      }),
    }));
    expect(hostedAiUsageUpsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        id: "turn_123.request-1.attempt-1",
      },
      create: expect.objectContaining({
        providerRequestOrdinal: 1,
      }),
    }));
  });

  it("rejects conflicting duplicate usage ids in one import batch", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => args.create),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          BASE_USAGE_RECORD,
          {
            ...BASE_USAGE_RECORD,
            totalTokens: 166,
          },
        ],
      }),
    ).rejects.toThrow(
      "Hosted AI usage recording contains conflicting records for one usage id.",
    );
  });

  it("rejects non-canonical usage ids before any hosted usage row is persisted", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = makeUsagePrisma(hostedAiUsageUpsert);

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            ...BASE_USAGE_RECORD,
            usageId: "turn_123.unexpected-1",
          },
        ],
      }),
    ).rejects.toThrow(
      "Hosted AI usage recording contains an invalid usage record.",
    );

    expect(hostedAiUsageUpsert).not.toHaveBeenCalled();
  });

  it("rejects an existing usage row when immutable fields do not match", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        totalTokens: 999,
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: totalTokens.",
    );
  });

  it("rejects an existing usage row when the stored provider request ordinal differs", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        providerRequestOrdinal: 1,
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: providerRequestOrdinal.",
    );
  });

  it("accepts an existing usage row when raw usage JSON only differs by key order", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        rawUsageJson: {
          total_tokens: 165,
          output_tokens_details: {
            reasoning_tokens: 8,
          },
          output_tokens: 45,
          input_tokens_details: {
            cached_tokens: 12,
          },
          input_tokens: 120,
        },
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });
  });

  it("rejects an existing usage row when raw usage JSON values differ", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        rawUsageJson: {
          input_tokens: 121,
          input_tokens_details: {
            cached_tokens: 12,
          },
          output_tokens: 45,
          output_tokens_details: {
            reasoning_tokens: 8,
          },
          total_tokens: 166,
        },
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: rawUsageJson.",
    );
  });

  it("rejects an existing usage row when the stored Stripe meter source differs", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        stripeMeterSource: "external-meter",
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: stripeMeterSource.",
    );
  });

  it("rejects an existing usage row when the stored token pricing basis differs", async () => {
    const prisma = makeUsagePrisma(
      vi.fn(async (args: { create: Record<string, unknown> }) => ({
        ...args.create,
        tokenPricingBasis: "standard",
      })),
    );

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [{
          ...BASE_USAGE_RECORD,
          tokenPricingBasis: "openai-flex",
        }],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: tokenPricingBasis.",
    );
  });

  it("rejects usage rows whose memberId does not match the trusted hosted execution user", async () => {
    const prisma = makeUsagePrisma(vi.fn(async () => ({})));

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            attemptCount: 1,
            credentialSource: "platform",
            memberId: "member_other",
            occurredAt: "2026-03-29T12:00:00.000Z",
            provider: "codex-cli",
            routeId: "primary",
            schema: "murph.assistant-usage.v1",
            sessionId: "asst_123",
            totalTokens: 165,
            turnId: "turn_123",
            usageId: "turn_123.attempt-1",
          },
        ],
      }),
    ).rejects.toThrow(
      "Hosted AI usage memberId does not match the authenticated hosted execution user.",
    );
  });

  it("rejects unsupported meter source payloads", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const findUnique = vi.fn(async () => {
      throw new Error("billing ref lookup should not run for usage imports");
    });
    const prisma = makeUsagePrisma(hostedAiUsageUpsert, findUnique);

    await expect(
      recordHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            ...BASE_USAGE_RECORD,
            stripeMeterSource: "external-meter",
          },
        ],
      }),
    ).rejects.toThrow(
      "Hosted AI usage recording contains an invalid usage record.",
    );

    expect(findUnique).not.toHaveBeenCalled();
    expect(hostedAiUsageUpsert).not.toHaveBeenCalled();
  });
});

function makeUsagePrisma(
  upsert: ReturnType<typeof vi.fn>,
  findUnique: ReturnType<typeof vi.fn> = vi.fn(async () => null),
  hostedAiUsageFindUnique: ReturnType<typeof vi.fn> = vi.fn(async () => null),
) {
  return {
    hostedAiUsage: {
      findUnique: hostedAiUsageFindUnique,
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert,
    },
    hostedMemberBillingRef: {
      findUnique,
    },
  };
}

function makeUsagePrismaClient(
  upsert: ReturnType<typeof vi.fn>,
  findUnique: ReturnType<typeof vi.fn> = vi.fn(async () => null),
  hostedAiUsageFindUnique: ReturnType<typeof vi.fn> = vi.fn(async () => null),
) {
  const tx = makeUsagePrisma(upsert, findUnique, hostedAiUsageFindUnique);
  return {
    ...tx,
    $transaction: vi.fn(async <T>(run: (transaction: typeof tx) => Promise<T>) => run(tx)),
  };
}
