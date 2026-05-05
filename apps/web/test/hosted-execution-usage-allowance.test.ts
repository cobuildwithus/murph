import { HostedBillingStatus } from "@prisma/client";
import {
  HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS,
} from "@murphai/hosted-execution/runtime-control";
import type { AssistantUsageRecord } from "@murphai/runtime-state/node/assistant-usage";
import { describe, expect, it, vi } from "vitest";

import {
  accountHostedAiUsageForAllowanceTx,
  priceHostedAiUsageForAllowance,
  resolveHostedAiUsageGate,
} from "@/src/lib/hosted-execution/usage-allowance";

const BASE_USAGE_RECORD = {
  apiKeyEnv: "VERCEL_AI_API_KEY",
  attemptCount: 1,
  baseUrl: "https://ai-gateway.vercel.sh/v1",
  cacheWriteTokens: null,
  cachedInputTokens: 12,
  credentialSource: "platform",
  featureKey: null,
  gatewayTags: [],
  inputTokens: 120,
  memberId: "member_123",
  occurredAt: "2026-03-29T12:00:00.000Z",
  outputTokens: 45,
  provider: "codex-cli",
  providerName: "vercel-ai-gateway",
  providerRequestId: "req_123",
  providerRequestOutcome: "succeeded",
  providerRequestOrdinal: 0,
  rawUsageJson: null,
  rawUsageJsonHash: null,
  reasoningTokens: null,
  reportingUserId: "member_123",
  requestedModel: "gpt-5.4-mini",
  routeId: "primary",
  schema: "murph.assistant-usage.v1",
  servedModel: "gpt-5.4-mini",
  sessionId: "asst_123",
  stripeMeterSource: "murph",
  surface: null,
  totalTokens: 165,
  triggerKind: null,
  turnId: "turn_123",
  usageId: "turn_123.attempt-1",
  usageExtractionSourcePath: null,
  usageExtractionVersion: "codex-usage-v1",
} as const satisfies AssistantUsageRecord;

type AllowanceExecuteRaw = (sql: TemplateStringsArray, ...params: unknown[]) => Promise<number>;
type AllowanceExecuteRawMock = ReturnType<typeof vi.fn<AllowanceExecuteRaw>>;

describe("hosted AI usage allowance pricing", () => {
  it("prices platform usage from uncached input, cached input, and output tokens", () => {
    expect(priceHostedAiUsageForAllowance(BASE_USAGE_RECORD)).toMatchObject({
      costUsdMicros: 285n,
      counted: true,
      pricingVersion: "openai-api-pricing-2026-05-05-standard",
    });
  });

  it("records member-provided credential usage without counting it against allowance", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      credentialSource: "member",
    })).toMatchObject({
      costUsdMicros: 0n,
      counted: false,
    });
  });

  it("fails closed for unknown platform model prices", () => {
    expect(() => priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "gpt-unpriced",
      servedModel: "gpt-unpriced",
    })).toThrow("pricing is missing");
  });

  it("prices every hosted assistant launch model accepted by deploy preflight", () => {
    for (const model of HOSTED_AI_USAGE_ALLOWANCE_PRICED_MODELS) {
      expect(priceHostedAiUsageForAllowance({
        ...BASE_USAGE_RECORD,
        requestedModel: model,
        servedModel: model,
      })).toMatchObject({
        counted: true,
      });
    }
  });

  it("prices Vercel AI Gateway provider-prefixed OpenAI model ids", () => {
    expect(priceHostedAiUsageForAllowance({
      ...BASE_USAGE_RECORD,
      requestedModel: "openai/gpt-5.5",
      servedModel: "openai/gpt-5.5",
    })).toMatchObject({
      counted: true,
      pricingSnapshot: {
        model: "gpt-5.5",
      },
    });
  });
});

describe("accountHostedAiUsageForAllowanceTx", () => {
  it("increments the period once when a usage row wins the accounting claim", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: updateMany,
    });

    await accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      now: new Date("2026-03-29T12:00:05.000Z"),
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allowanceAccountedAt: new Date("2026-03-29T12:00:05.000Z"),
        allowanceCostUsdMicros: 285n,
        allowanceCounted: true,
        allowancePeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
        allowancePeriodStart: new Date("2026-03-01T00:00:00.000Z"),
      }),
      where: {
        allowanceAccountedAt: null,
        id: "turn_123.attempt-1",
      },
    }));
    expect(executeRaw).toHaveBeenCalledOnce();
  });

  it("does not increment again when allowanceAccountedAt was already set", async () => {
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 0 })),
    });

    await accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      record: BASE_USAGE_RECORD,
      tx: tx as never,
    });

    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("does not increment allowance spend for member credentials", async () => {
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async () => 1);
    const tx = createAllowanceTx({
      executeRaw,
      hostedAiUsageUpdateMany: vi.fn(async () => ({ count: 1 })),
    });

    await accountHostedAiUsageForAllowanceTx({
      memberId: "member_123",
      record: {
        ...BASE_USAGE_RECORD,
        credentialSource: "member",
      },
      tx: tx as never,
    });

    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe("resolveHostedAiUsageGate", () => {
  it("allows active members while recorded spend is below the period limit", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 9_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      limitUsdMicros: 10_000_000n,
      remainingUsdMicros: 1_000_000n,
      spentUsdMicros: 9_000_000n,
    });
  });

  it("blocks active members once recorded spend reaches the period limit", async () => {
    const prisma = createGatePrisma({
      spentUsdMicros: 10_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      userNotice: {
        code: "pulse_upgrade_edge",
        message: "Hey - you've reached your usage limit for the month. Upgrade to Edge for more usage.",
      },
      reason: "ai_usage_limit_exceeded",
      retryAfter: new Date("2026-04-01T00:00:00.000Z"),
      spentUsdMicros: 10_000_000n,
    });
  });

  it("uses the Edge usage-based pricing notice when an Edge member is over limit", async () => {
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      spentUsdMicros: 25_000_000n,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      userNotice: {
        code: "edge_enable_usage_based_pricing",
        message: "Hey - you've reached your usage limit for the month. Go to the dashboard to enable usage based pricing.",
      },
    });
  });

  it("raises the current period limit on upgrade without lowering spend", async () => {
    const update = vi.fn(async () => ({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 14_000_000n,
    }));
    const prisma = createGatePrisma({
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 10_000_000n,
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      spentUsdMicros: 14_000_000n,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-03-29T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: true,
      billingPlanCode: "launch_edge_monthly",
      limitUsdMicros: 25_000_000n,
      remainingUsdMicros: 11_000_000n,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        blockedAt: null,
        limitUsdMicros: 25_000_000n,
      }),
    }));
  });

  it("carries only in-period fallback usage into the Stripe period when billing markers arrive", async () => {
    let rawSqlText = "";
    const executeRaw = vi.fn<AllowanceExecuteRaw>(async (sql) => {
      rawSqlText = sql.join("");
      return 1;
    });
    const queryRaw = vi.fn(async () => [
      {
        allowance_cost_usd_micros: 6_000_000n,
        allowance_counted: true,
        occurred_at: new Date("2026-04-20T12:00:00.000Z"),
        old_period_start: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);
    const aggregate = vi.fn(async () => ({
      _max: {
        occurredAt: new Date("2026-04-10T12:00:00.000Z"),
      },
      _sum: {
        allowanceCostUsdMicros: 4_000_000n,
      },
    }));
    const update = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 10_000_000n,
        periodEnd: new Date("2026-05-15T00:00:00.000Z"),
        periodStart: new Date("2026-04-15T00:00:00.000Z"),
        spentUsdMicros: 11_000_000n,
      });
    const prisma = createGatePrisma({
      aggregate,
      executeRaw,
      findUniquePeriod: {
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 10_000_000n,
        periodEnd: new Date("2026-05-15T00:00:00.000Z"),
        periodStart: new Date("2026-04-15T00:00:00.000Z"),
        spentUsdMicros: 11_000_000n,
      },
      periodEnd: new Date("2026-05-15T00:00:00.000Z"),
      periodStart: new Date("2026-04-15T00:00:00.000Z"),
      queryRaw,
      spentUsdMicros: 5_000_000n,
      update,
    });

    await expect(resolveHostedAiUsageGate({
      memberId: "member_123",
      now: "2026-04-20T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      allowed: false,
      periodEnd: new Date("2026-05-15T00:00:00.000Z"),
      periodStart: new Date("2026-04-15T00:00:00.000Z"),
      reason: "ai_usage_limit_exceeded",
      spentUsdMicros: 11_000_000n,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(rawSqlText).toContain(
      '"last_usage_at" = CASE',
    );
    expect(rawSqlText).toContain(
      'WHEN "last_usage_at" IS NULL THEN',
    );
    expect(rawSqlText).toContain(
      'ELSE "last_usage_at"',
    );
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        allowancePeriodStart: new Date("2026-04-01T00:00:00.000Z"),
      }),
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        spentUsdMicros: 4_000_000n,
      }),
    }));
  });
});

function createAllowanceTx(input: {
  executeRaw: AllowanceExecuteRawMock;
  hostedAiUsageUpdateMany: ReturnType<typeof vi.fn>;
}) {
  return {
    $executeRaw: input.executeRaw,
    $queryRaw: vi.fn(async () => []),
    hostedAiUsage: {
      updateMany: input.hostedAiUsageUpdateMany,
    },
    hostedAiUsagePeriod: {
      findUniqueOrThrow: vi.fn(async () => ({
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 10_000_000n,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: 0n,
      })),
      upsert: vi.fn(async () => ({
        billingPlanCode: "launch_monthly",
        limitUsdMicros: 10_000_000n,
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        spentUsdMicros: 0n,
      })),
    },
    hostedMember: {
      findUnique: vi.fn(async () => ({
        billingRef: {
          currentBillingPlanCode: "launch_monthly",
          currentPeriodEnd: new Date("2026-04-01T00:00:00.000Z"),
          currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
        },
        id: "member_123",
      })),
    },
  };
}

function createGatePrisma(input: {
  aggregate?: ReturnType<typeof vi.fn>;
  billingPlanCode?: string;
  executeRaw?: ReturnType<typeof vi.fn>;
  findUniquePeriod?: {
    billingPlanCode: string;
    limitUsdMicros: bigint;
    periodEnd: Date;
    periodStart: Date;
    spentUsdMicros: bigint;
  };
  limitUsdMicros?: bigint;
  periodEnd?: Date;
  periodStart?: Date;
  queryRaw?: ReturnType<typeof vi.fn>;
  spentUsdMicros: bigint;
  update?: ReturnType<typeof vi.fn>;
}) {
  const periodStart = input.periodStart ?? new Date("2026-03-01T00:00:00.000Z");
  const periodEnd = input.periodEnd ?? new Date("2026-04-01T00:00:00.000Z");

  return {
    $executeRaw: input.executeRaw ?? vi.fn(async () => 1),
    $queryRaw: input.queryRaw ?? vi.fn(async () => []),
    hostedAiUsage: {
      aggregate: input.aggregate ?? vi.fn(async () => ({
        _max: {
          occurredAt: null,
        },
        _sum: {
          allowanceCostUsdMicros: null,
        },
      })),
    },
    hostedAiUsagePeriod: {
      delete: vi.fn(async () => undefined),
      findUnique: vi.fn(async () => ({
        blockedAt: null,
        limitUsdMicros: input.limitUsdMicros ?? 10_000_000n,
      })),
      findUniqueOrThrow: vi.fn(async () => input.findUniquePeriod ?? ({
        billingPlanCode: input.billingPlanCode ?? "launch_monthly",
        limitUsdMicros: input.limitUsdMicros ?? 10_000_000n,
        periodEnd,
        periodStart,
        spentUsdMicros: input.spentUsdMicros,
      })),
      update: input.update ?? vi.fn(),
      upsert: vi.fn(async () => ({
        billingPlanCode: input.billingPlanCode ?? "launch_monthly",
        limitUsdMicros: input.limitUsdMicros ?? 10_000_000n,
        periodEnd,
        periodStart,
        spentUsdMicros: input.spentUsdMicros,
      })),
    },
    hostedMember: {
      findUnique: vi.fn()
        .mockResolvedValueOnce({
          billingRef: {
            currentBillingPlanCode: input.billingPlanCode ?? "launch_monthly",
            currentPeriodEnd: periodEnd,
            currentPeriodStart: periodStart,
          },
          id: "member_123",
        })
        .mockResolvedValueOnce({
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        }),
    },
  };
}
