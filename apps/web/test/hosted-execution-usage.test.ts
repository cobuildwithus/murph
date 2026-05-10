import { describe, expect, it, vi } from "vitest";

import { recordHostedAiUsageRecords } from "@/src/lib/hosted-execution/usage";

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
  providerSessionId: "session_123",
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
  requestedModel: "gpt-5.4-mini",
  routeId: "primary",
  schema: "murph.assistant-usage.v1",
  servedModel: "gpt-5.4-mini",
  sessionId: "asst_123",
  stripeMeterSource: "murph",
  totalTokens: 165,
  turnId: "turn_123",
  usageId: "turn_123.attempt-1",
  usageExtractionSourcePath: "params.usage",
  usageExtractionVersion: "codex-usage-v1",
} as const;

describe("recordHostedAiUsageRecords", () => {
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
        totalTokens: 165,
        usageExtractionSourcePath: "params.usage",
        usageExtractionVersion: "codex-usage-v1",
      }),
      select: expect.any(Object),
      update: {},
    });
    const upsertCall = hostedAiUsageUpsert.mock.calls[0]?.[0] as { create?: Record<string, unknown> } | undefined;
    expect(upsertCall?.create).toBeDefined();
    expect(upsertCall?.create).not.toHaveProperty("providerSessionId");
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
  findUnique = vi.fn(async () => null),
) {
  return {
    hostedAiUsage: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert,
    },
    hostedMemberBillingRef: {
      findUnique,
    },
  };
}
