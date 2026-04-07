import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";

import {
  importHostedAiUsageRecords,
  listHostedAiUsagePendingStripeMetering,
  readHostedAiUsageStoragePolicy,
} from "@/src/lib/hosted-execution/usage";

const BASE_USAGE_RECORD = {
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
    nested: {
      ignored: undefined,
    },
    provider: "example",
  },
  providerName: "example",
  providerRequestId: "req_123",
  providerSessionId: "session_123",
  rawUsageJson: {
    nested: {
      ignored: undefined,
    },
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
} as const;

afterEach(() => {
  delete process.env.HOSTED_AI_USAGE_PERSIST_DEBUG_FIELDS;
  vi.clearAllMocks();
});

describe("readHostedAiUsageStoragePolicy", () => {
  it("defaults to the privacy-first policy", () => {
    expect(readHostedAiUsageStoragePolicy({} as unknown as NodeJS.ProcessEnv)).toEqual({
      includeDebugFields: false,
    });
  });

  it("enables debug storage only when explicitly configured", () => {
    expect(
      readHostedAiUsageStoragePolicy({
        HOSTED_AI_USAGE_PERSIST_DEBUG_FIELDS: "true",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({
      includeDebugFields: true,
    });
  });
});

describe("importHostedAiUsageRecords", () => {
  it("drops provider debug fields by default", async () => {
    const hostedAiUsageUpsert = vi.fn(async () => ({}));
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
    };

    const result = await importHostedAiUsageRecords({
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
        totalTokens: 165,
        providerSessionId: null,
        providerRequestId: null,
        providerMetadataJson: Prisma.DbNull,
        rawUsageJson: Prisma.DbNull,
      }),
      update: {},
    });
  });

  it("persists provider debug fields only when the explicit debug flag is enabled", async () => {
    process.env.HOSTED_AI_USAGE_PERSIST_DEBUG_FIELDS = "true";

    const hostedAiUsageUpsert = vi.fn(async () => ({}));
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
    };

    await importHostedAiUsageRecords({
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith({
      where: {
        id: "turn_123.attempt-1",
      },
      create: expect.objectContaining({
        providerSessionId: "session_123",
        providerRequestId: "req_123",
        providerMetadataJson: {
          nested: {},
          provider: "example",
        },
        rawUsageJson: {
          nested: {},
          totalTokens: 165,
        },
      }),
      update: {},
    });
  });

  it("rejects usage rows whose memberId does not match the trusted hosted execution user", async () => {
    const prisma = {
      hostedAiUsage: {
        upsert: vi.fn(async () => ({})),
      },
    };

    await expect(
      importHostedAiUsageRecords({
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            attemptCount: 1,
            credentialSource: "platform",
            memberId: "member_other",
            occurredAt: "2026-03-29T12:00:00.000Z",
            provider: "openai-compatible",
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
      "Hosted AI usage turn_123.attempt-1 memberId member_other does not match the authenticated hosted execution user member_123.",
    );
  });
});

describe("listHostedAiUsagePendingStripeMetering", () => {
  it("queries pending metering candidates in occurred order", async () => {
    const findMany = vi.fn(async () => [{
      apiKeyEnv: null,
      credentialSource: "platform",
      id: "usage_123",
      inputTokens: 10,
      member: {
        billingRef: {
          memberId: "member_123",
          stripeCustomerIdEncrypted: encryptHostedWebNullableString({
            field: "hosted-member-billing-ref.stripe-customer-id",
            memberId: "member_123",
            value: "cus_123",
          }),
          stripeLatestBillingEventIdEncrypted: null,
          stripeLatestCheckoutSessionIdEncrypted: null,
          stripeSubscriptionIdEncrypted: null,
        },
      },
      memberId: "member_123",
      occurredAt: new Date("2026-03-29T12:00:00.000Z"),
      outputTokens: 5,
      provider: "openai-compatible",
      requestedModel: "gpt-5.4-mini",
      stripeMeterStatus: "pending",
      totalTokens: 15,
    }]);
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
        credentialSource: {
          not: null,
        },
        stripeMeterStatus: "pending",
        member: {
          billingRef: {
            is: {
              stripeCustomerLookupKey: {
                not: null,
              },
            },
          },
        },
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
        apiKeyEnv: true,
        credentialSource: true,
        id: true,
        inputTokens: true,
        member: {
          select: {
            billingRef: {
              select: {
                memberId: true,
                stripeCustomerIdEncrypted: true,
                stripeLatestBillingEventIdEncrypted: true,
                stripeLatestCheckoutSessionIdEncrypted: true,
                stripeSubscriptionIdEncrypted: true,
              },
            },
          },
        },
        memberId: true,
        occurredAt: true,
        outputTokens: true,
        provider: true,
        requestedModel: true,
        stripeMeterStatus: true,
        totalTokens: true,
      },
    });
    expect(
      await listHostedAiUsagePendingStripeMetering({
        limit: 16,
        prisma: prisma as never,
      }),
    ).toEqual([{
      apiKeyEnv: null,
      credentialSource: "platform",
      id: "usage_123",
      inputTokens: 10,
      memberId: "member_123",
      occurredAt: new Date("2026-03-29T12:00:00.000Z"),
      outputTokens: 5,
      provider: "openai-compatible",
      requestedModel: "gpt-5.4-mini",
      stripeCustomerId: "cus_123",
      stripeMeterStatus: "pending",
      totalTokens: 15,
    }]);
  });
});
