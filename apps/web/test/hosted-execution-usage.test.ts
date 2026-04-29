import { describe, expect, it, vi } from "vitest";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";

import {
  claimHostedAiUsageStripeMetering,
  HostedAiUsageStripeMeterClaimLostError,
  importHostedAiUsageRecords,
  listHostedAiUsagePendingStripeMetering,
  markHostedAiUsageStripeMeteringDisabled,
  markHostedAiUsageStripeProgress,
} from "@/src/lib/hosted-execution/usage";

const BASE_USAGE_RECORD = {
  apiKeyEnv: "VERCEL_AI_API_KEY",
  attemptCount: 1,
  baseUrl: "https://ai-gateway.vercel.sh/v1",
  cacheWriteTokens: 3,
  cachedInputTokens: 12,
  credentialSource: "platform",
  inputTokens: 120,
  memberId: "member_123",
  occurredAt: "2026-03-29T12:00:00.000Z",
  outputTokens: 45,
  provider: "codex-cli",
  providerMetadataJson: {
    nested: {
      ignored: undefined,
    },
    provider: "vercel-ai-gateway",
  },
  providerName: "vercel-ai-gateway",
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
  stripeMeterSource: "murph",
  totalTokens: 165,
  turnId: "turn_123",
  usageId: "turn_123.attempt-1",
} as const;

describe("importHostedAiUsageRecords", () => {
  it("never persists provider debug fields", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const findUnique = vi.fn(async () => ({
      memberId: "member_123",
      stripeCustomerIdEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeSubscriptionIdEncrypted: null,
    }));
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique,
      },
    };

    const result = await importHostedAiUsageRecords({
      aiUsageBillingMode: "disabled",
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
        providerRequestOrdinal: 0,
        stripeMeterError:
          "Hosted AI usage billing is disabled until Stripe native LLM billing is enabled.",
        stripeMeterSource: "murph",
        stripeMeterStatus: "skipped",
        totalTokens: 165,
      }),
      select: expect.any(Object),
      update: {},
    });
    const upsertCall = hostedAiUsageUpsert.mock.calls[0]?.[0] as { create?: Record<string, unknown> } | undefined;
    expect(upsertCall?.create).toBeDefined();
    expect(upsertCall?.create).not.toHaveProperty("providerSessionId");
    expect(upsertCall?.create).not.toHaveProperty("providerRequestId");
    expect(upsertCall?.create).not.toHaveProperty("providerMetadataJson");
    expect(upsertCall?.create).not.toHaveProperty("rawUsageJson");
  });

  it("does not delegate Vercel AI Gateway rows or read billing refs while usage billing is disabled", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const findUnique = vi.fn(async () => {
      throw new Error("billing ref lookup should not run while usage billing is disabled");
    });
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique,
      },
    };

    await expect(
      importHostedAiUsageRecords({
        aiUsageBillingMode: "disabled",
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [
          {
            ...BASE_USAGE_RECORD,
            baseUrl: "https://ai-gateway.vercel.sh/v1",
            providerName: "vercel-ai-gateway",
            stripeMeterSource: "vercel-ai-gateway",
          },
        ],
      }),
    ).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });

    expect(findUnique).not.toHaveBeenCalled();
    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        stripeMeterError:
          "Hosted AI usage billing is disabled until Stripe native LLM billing is enabled.",
        stripeMeterSource: "murph",
        stripeMeterStatus: "skipped",
      }),
    }));
  });

  it("fails unsupported env billing modes closed to skipped usage records", async () => {
    const originalBillingMode = process.env.HOSTED_AI_USAGE_BILLING_MODE;
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const findUnique = vi.fn(async () => {
      throw new Error("billing ref lookup should not run for unsupported billing modes");
    });
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique,
      },
    };

    process.env.HOSTED_AI_USAGE_BILLING_MODE = "usage_allowance";
    try {
      await expect(
        importHostedAiUsageRecords({
          prisma: prisma as never,
          trustedUserId: "member_123",
          usage: [BASE_USAGE_RECORD],
        }),
      ).resolves.toMatchObject({
        recordedIds: ["turn_123.attempt-1"],
      });
    } finally {
      if (originalBillingMode === undefined) {
        delete process.env.HOSTED_AI_USAGE_BILLING_MODE;
      } else {
        process.env.HOSTED_AI_USAGE_BILLING_MODE = originalBillingMode;
      }
    }

    expect(findUnique).not.toHaveBeenCalled();
    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        stripeMeterError:
          "Hosted AI usage billing is disabled until Stripe native LLM billing is enabled.",
        stripeMeterSource: "murph",
        stripeMeterStatus: "skipped",
      }),
    }));
  });

  it("dedupes identical usage rows by usageId before persisting them", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };

    const result = await importHostedAiUsageRecords({
      aiUsageBillingMode: "disabled",
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [BASE_USAGE_RECORD, BASE_USAGE_RECORD],
    });

    expect(result.recordedIds).toEqual(["turn_123.attempt-1"]);
    expect(hostedAiUsageUpsert).toHaveBeenCalledTimes(1);
  });

  it("dedupes omitted and explicit first provider request ordinals", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };

    const result = await importHostedAiUsageRecords({
      aiUsageBillingMode: "disabled",
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
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };
    const continuationUsage = {
      ...BASE_USAGE_RECORD,
      providerRequestOrdinal: 1,
      usageId: "turn_123.request-1.attempt-1",
    };

    const result = await importHostedAiUsageRecords({
      aiUsageBillingMode: "disabled",
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
    const prisma = {
      hostedAiUsage: {
        upsert: vi.fn(async (args: { create: Record<string, unknown> }) => args.create),
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };

    await expect(
      importHostedAiUsageRecords({
        aiUsageBillingMode: "disabled",
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
      "Hosted AI usage import contains conflicting records for one usage id.",
    );
  });

  it("rejects non-canonical usage ids before any hosted usage row is persisted", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };

    await expect(
      importHostedAiUsageRecords({
        aiUsageBillingMode: "disabled",
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
      "Hosted AI usage import contains an invalid usage record.",
    );

    expect(hostedAiUsageUpsert).not.toHaveBeenCalled();
  });

  it("rejects an existing usage row when immutable fields do not match", async () => {
    const prisma = {
      hostedAiUsage: {
        upsert: vi.fn(async (args: { create: Record<string, unknown> }) => ({
          ...args.create,
          totalTokens: 999,
        })),
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };

    await expect(
      importHostedAiUsageRecords({
        aiUsageBillingMode: "disabled",
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: totalTokens.",
    );
  });

  it("rejects an existing usage row when the stored provider request ordinal differs", async () => {
    const prisma = {
      hostedAiUsage: {
        upsert: vi.fn(async (args: { create: Record<string, unknown> }) => ({
          ...args.create,
          providerRequestOrdinal: 1,
        })),
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };

    await expect(
      importHostedAiUsageRecords({
        aiUsageBillingMode: "disabled",
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).rejects.toThrow(
      "Hosted AI usage already exists with different immutable fields: providerRequestOrdinal.",
    );
  });

  it("accepts an existing usage row when the stored billing outcome already differs", async () => {
    const prisma = {
      hostedAiUsage: {
        upsert: vi.fn(async (args: { create: Record<string, unknown> }) => ({
          ...args.create,
          stripeMeterSource: "vercel-ai-gateway",
        })),
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };

    await expect(
      importHostedAiUsageRecords({
        aiUsageBillingMode: "disabled",
        prisma: prisma as never,
        trustedUserId: "member_123",
        usage: [BASE_USAGE_RECORD],
      }),
    ).resolves.toMatchObject({
      recordedIds: ["turn_123.attempt-1"],
    });
  });

  it("rejects usage rows whose memberId does not match the trusted hosted execution user", async () => {
    const prisma = {
      hostedAiUsage: {
        upsert: vi.fn(async () => ({})),
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };

    await expect(
      importHostedAiUsageRecords({
        aiUsageBillingMode: "disabled",
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

  it("persists upstream Vercel AI Gateway metering rows as delegated", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const findUnique = vi.fn(async () => ({
      memberId: "member_123",
      stripeCustomerIdEncrypted: encryptHostedWebNullableString({
        field: "hosted-member-billing-ref.stripe-customer-id",
        memberId: "member_123",
        value: "cus_123",
      }),
      stripeSubscriptionIdEncrypted: null,
    }));
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique,
      },
    };

    await importHostedAiUsageRecords({
      aiUsageBillingMode: "stripe_meter",
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        {
          ...BASE_USAGE_RECORD,
          baseUrl: "https://ai-gateway.vercel.sh/v1",
          providerName: "vercel-ai-gateway",
          stripeMeterSource: "vercel-ai-gateway",
        },
      ],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        stripeMeterError:
          "Delegated Stripe token metering is handled upstream by Vercel AI Gateway.",
        stripeMeterSource: "vercel-ai-gateway",
        stripeMeterStatus: "delegated",
      }),
    }));
  });

  it("persists Codex Vercel AI Gateway metering rows as delegated", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => ({
          memberId: "member_123",
          stripeCustomerIdEncrypted: encryptHostedWebNullableString({
            field: "hosted-member-billing-ref.stripe-customer-id",
            memberId: "member_123",
            value: "cus_123",
          }),
          stripeSubscriptionIdEncrypted: null,
        })),
      },
    };

    await importHostedAiUsageRecords({
      aiUsageBillingMode: "stripe_meter",
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        {
          ...BASE_USAGE_RECORD,
          baseUrl: null,
          provider: "codex-cli",
          providerName: "vercel-ai-gateway",
          stripeMeterSource: "vercel-ai-gateway",
        },
      ],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        stripeMeterError:
          "Delegated Stripe token metering is handled upstream by Vercel AI Gateway.",
        stripeMeterSource: "vercel-ai-gateway",
        stripeMeterStatus: "delegated",
      }),
    }));
  });

  it("fails closed back to Murph metering when delegated rows are missing a trusted Stripe customer id", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => null),
      },
    };

    await importHostedAiUsageRecords({
      aiUsageBillingMode: "stripe_meter",
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        {
          ...BASE_USAGE_RECORD,
          baseUrl: "https://ai-gateway.vercel.sh/v1",
          providerName: "vercel-ai-gateway",
          stripeMeterSource: "vercel-ai-gateway",
        },
      ],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        stripeMeterSource: "murph",
      }),
    }));
  });

  it("fails closed back to Murph metering when delegated rows are not trusted gateway records", async () => {
    const hostedAiUsageUpsert = vi.fn(async (args: { create: Record<string, unknown> }) => args.create);
    const prisma = {
      hostedAiUsage: {
        upsert: hostedAiUsageUpsert,
      },
      hostedMemberBillingRef: {
        findUnique: vi.fn(async () => ({
          memberId: "member_123",
          stripeCustomerIdEncrypted: encryptHostedWebNullableString({
            field: "hosted-member-billing-ref.stripe-customer-id",
            memberId: "member_123",
            value: "cus_123",
          }),
          stripeSubscriptionIdEncrypted: null,
        })),
      },
    };

    await importHostedAiUsageRecords({
      aiUsageBillingMode: "stripe_meter",
      prisma: prisma as never,
      trustedUserId: "member_123",
      usage: [
        {
          ...BASE_USAGE_RECORD,
          baseUrl: "https://api.example.test/v1",
          provider: "unsupported-provider",
          providerName: "example",
          stripeMeterSource: "vercel-ai-gateway",
        },
      ],
    });

    expect(hostedAiUsageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        stripeMeterSource: "murph",
      }),
    }));
  });
});

describe("markHostedAiUsageStripeMeteringDisabled", () => {
  it("marks pending or expired processing Murph-metered rows as skipped without requiring a Stripe customer", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "usage_pending",
      },
    ]);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      hostedAiUsage: {
        findMany,
        updateMany,
      },
    };

    await expect(
      markHostedAiUsageStripeMeteringDisabled({
        limit: 16,
        now: "2026-03-29T12:05:00.000Z",
        prisma: prisma as never,
      }),
    ).resolves.toBe(1);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        stripeMeterSource: "murph",
        OR: [
          {
            stripeMeterStatus: "pending",
          },
          {
            stripeMeterStatus: "processing",
            OR: [
              {
                stripeMeterNextAttemptAt: null,
              },
              {
                stripeMeterNextAttemptAt: {
                  lte: new Date("2026-03-29T12:05:00.000Z"),
                },
              },
            ],
          },
        ],
      },
      orderBy: [
        {
          stripeMeterNextAttemptAt: "asc",
        },
        {
          occurredAt: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
      take: 16,
      select: {
        id: true,
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["usage_pending"],
        },
        stripeMeterSource: "murph",
        OR: [
          {
            stripeMeterStatus: "pending",
          },
          {
            stripeMeterStatus: "processing",
            OR: [
              {
                stripeMeterNextAttemptAt: null,
              },
              {
                stripeMeterNextAttemptAt: {
                  lte: new Date("2026-03-29T12:05:00.000Z"),
                },
              },
            ],
          },
        ],
      },
      data: {
        stripeMeterError:
          "Hosted AI usage billing is disabled until Stripe native LLM billing is enabled.",
        stripeMeterIdentifier: null,
        stripeMeterLastAttemptedAt: new Date("2026-03-29T12:05:00.000Z"),
        stripeMeterNextAttemptAt: null,
        stripeMeterStatus: "skipped",
        stripeMeteredAt: null,
      },
    });
  });
});

describe("listHostedAiUsagePendingStripeMetering", () => {
  it("queries pending metering candidates in due order", async () => {
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
          stripeSubscriptionIdEncrypted: null,
        },
      },
      memberId: "member_123",
      occurredAt: new Date("2026-03-29T12:00:00.000Z"),
      outputTokens: 5,
      provider: "codex-cli",
      requestedModel: "gpt-5.4-mini",
      servedModel: null,
      stripeMeterAttemptCount: 2,
      stripeMeterIdentifier: null,
      stripeMeterStatus: "pending",
      totalTokens: 15,
      updatedAt: new Date("2026-03-29T12:04:00.000Z"),
    }]);
    const prisma = {
      hostedAiUsage: {
        findMany,
      },
    };

    await listHostedAiUsagePendingStripeMetering({
      limit: 16,
      now: "2026-03-29T12:05:00.000Z",
      prisma: prisma as never,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        credentialSource: {
          not: null,
        },
        OR: [
          {
            stripeMeterNextAttemptAt: null,
          },
          {
            stripeMeterNextAttemptAt: {
              lte: new Date("2026-03-29T12:05:00.000Z"),
            },
          },
        ],
        stripeMeterSource: "murph",
        stripeMeterStatus: {
          in: ["pending", "processing"],
        },
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
          stripeMeterNextAttemptAt: "asc",
        },
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
        servedModel: true,
        stripeMeterAttemptCount: true,
        stripeMeterIdentifier: true,
        stripeMeterStatus: true,
        totalTokens: true,
        updatedAt: true,
      },
    });
    expect(
      await listHostedAiUsagePendingStripeMetering({
        limit: 16,
        now: "2026-03-29T12:05:00.000Z",
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
      provider: "codex-cli",
      requestedModel: "gpt-5.4-mini",
      servedModel: null,
      stripeCustomerId: "cus_123",
      stripeMeterAttemptCount: 2,
      stripeMeterIdentifier: null,
      stripeMeterStatus: "pending",
      totalTokens: 15,
      updatedAt: new Date("2026-03-29T12:04:00.000Z"),
    }]);
  });
});

describe("claimHostedAiUsageStripeMetering", () => {
  it("claims a due row into processing and returns the refreshed write fence", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findUnique = vi.fn(async () => ({
      stripeMeterAttemptCount: 3,
      updatedAt: new Date("2026-03-29T12:05:01.000Z"),
    }));
    const prisma = {
      hostedAiUsage: {
        findUnique,
        updateMany,
      },
    };

    await expect(
      claimHostedAiUsageStripeMetering({
        attemptedAt: "2026-03-29T12:05:00.000Z",
        candidate: {
          apiKeyEnv: null,
          credentialSource: "platform",
          id: "usage_claim",
          inputTokens: 10,
          memberId: "member_123",
          occurredAt: new Date("2026-03-29T12:00:00.000Z"),
          outputTokens: 5,
          provider: "codex-cli",
          requestedModel: "gpt-5.4-mini",
          servedModel: null,
          stripeCustomerId: "cus_123",
          stripeMeterAttemptCount: 2,
          stripeMeterIdentifier: "tokens-v2:completed=input",
          stripeMeterStatus: "pending",
          totalTokens: 15,
          updatedAt: new Date("2026-03-29T12:04:59.000Z"),
        },
        leaseMs: 60_000,
        prisma: prisma as never,
      }),
    ).resolves.toEqual({
      attemptCount: 3,
      leaseExpiresAt: new Date("2026-03-29T12:06:00.000Z"),
      updatedAt: new Date("2026-03-29T12:05:01.000Z"),
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "usage_claim",
        OR: [
          {
            stripeMeterNextAttemptAt: null,
          },
          {
            stripeMeterNextAttemptAt: {
              lte: new Date("2026-03-29T12:05:00.000Z"),
            },
          },
        ],
        stripeMeterAttemptCount: 2,
        stripeMeterIdentifier: "tokens-v2:completed=input",
        stripeMeterStatus: "pending",
        updatedAt: new Date("2026-03-29T12:04:59.000Z"),
      },
      data: {
        stripeMeterAttemptCount: {
          increment: 1,
        },
        stripeMeterError: null,
        stripeMeterIdentifier: "tokens-v2:completed=input",
        stripeMeterLastAttemptedAt: new Date("2026-03-29T12:05:00.000Z"),
        stripeMeterNextAttemptAt: new Date("2026-03-29T12:06:00.000Z"),
        stripeMeterStatus: "processing",
        stripeMeteredAt: null,
      },
    });
  });
});

describe("markHostedAiUsageStripeProgress", () => {
  it("fences progress on the old identifier and updatedAt so stale writers cannot clear newer state", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const prisma = {
      hostedAiUsage: {
        findUnique: vi.fn(async () => null),
        updateMany,
      },
    };

    await expect(
      markHostedAiUsageStripeProgress({
        attemptedAt: "2026-03-29T12:05:00.000Z",
        claim: {
          attemptCount: 3,
          leaseExpiresAt: new Date("2026-03-29T12:10:00.000Z"),
          updatedAt: new Date("2026-03-29T12:05:01.000Z"),
        },
        expectedIdentifier: "tokens-v2:completed=input",
        id: "usage_claim",
        identifier: "tokens-v2:completed=input;fenced=output",
        prisma: prisma as never,
      }),
    ).rejects.toBeInstanceOf(HostedAiUsageStripeMeterClaimLostError);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "usage_claim",
        stripeMeterAttemptCount: 3,
        stripeMeterIdentifier: "tokens-v2:completed=input",
        stripeMeterStatus: "processing",
        updatedAt: new Date("2026-03-29T12:05:01.000Z"),
      },
      data: {
        stripeMeterError: null,
        stripeMeterIdentifier: "tokens-v2:completed=input;fenced=output",
        stripeMeterLastAttemptedAt: new Date("2026-03-29T12:05:00.000Z"),
        stripeMeterNextAttemptAt: new Date("2026-03-29T12:10:00.000Z"),
        stripeMeterStatus: "processing",
        stripeMeteredAt: null,
      },
    });
  });
});
