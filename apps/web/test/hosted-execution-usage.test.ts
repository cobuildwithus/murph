import { describe, expect, it, vi } from "vitest";

import {
  importHostedAiUsageRecords,
  listHostedAiUsagePendingStripeMetering,
} from "@/src/lib/hosted-execution/usage";

describe("importHostedAiUsageRecords", () => {
  it("upserts hosted AI usage rows from assistant usage records", async () => {
    const hostedAiUsageUpsert = vi.fn(async () => ({}));
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
    };

    const result = await importHostedAiUsageRecords({
      prisma: prisma as never,
      usage: [
        {
          apiKeyEnv: "OPENAI_API_KEY",
          attemptCount: 1,
          baseUrl: "https://api.example.test/v1",
          cacheWriteTokens: 3,
          cachedInputTokens: 12,
          credentialSource: "platform",
          inputTokens: 120,
          memberId: "member_123",
          occurredAt: "2026-03-29T12:00:00.000Z",
          outputTokens: 45,
          provider: "openai-compatible",
          providerMetadataJson: {
            provider: "example",
          },
          providerName: "example",
          providerRequestId: "req_123",
          providerSessionId: null,
          rawUsageJson: {
            totalTokens: 165,
          },
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
      ],
    });

    expect(result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledWith({
      where: {
        id: "turn_123.attempt-1",
      },
      create: expect.objectContaining({
        id: "turn_123.attempt-1",
        memberId: "member_123",
        turnId: "turn_123",
        attemptCount: 1,
        provider: "openai-compatible",
        totalTokens: 165,
      }),
      update: {},
    });
  });
});

describe("listHostedAiUsagePendingStripeMetering", () => {
  it("queries pending metering candidates in occurred order", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      hostedAiUsage: {
        findMany,
      },
    };

    await listHostedAiUsagePendingStripeMetering({
      limit: 16,
      prisma: prisma as never,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        stripeMeterStatus: "pending",
      },
      orderBy: [
        {
          occurredAt: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
      take: 16,
      select: {
        credentialSource: true,
        id: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        member: {
          select: {
            stripeCustomerId: true,
          },
        },
      },
    });
  });
});
