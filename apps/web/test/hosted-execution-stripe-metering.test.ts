import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class HostedAiUsageStripeMeterClaimLostError extends Error {
    constructor(id: string) {
      super(`Hosted AI usage ${id} changed while Stripe metering progress was being written.`);
      this.name = "HostedAiUsageStripeMeterClaimLostError";
    }
  }

  return {
    claimHostedAiUsageStripeMetering: vi.fn(),
    HostedAiUsageStripeMeterClaimLostError,
    listHostedAiUsagePendingStripeMetering: vi.fn(),
    markHostedAiUsageStripeFailed: vi.fn(),
    markHostedAiUsageStripeMetered: vi.fn(),
    markHostedAiUsageStripeMeteringDisabled: vi.fn(),
    markHostedAiUsageStripeProgress: vi.fn(),
    markHostedAiUsageStripeRetryableFailure: vi.fn(),
    markHostedAiUsageStripeSkipped: vi.fn(),
  };
});

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  claimHostedAiUsageStripeMetering: mocks.claimHostedAiUsageStripeMetering,
  HostedAiUsageStripeMeterClaimLostError: mocks.HostedAiUsageStripeMeterClaimLostError,
  listHostedAiUsagePendingStripeMetering: mocks.listHostedAiUsagePendingStripeMetering,
  markHostedAiUsageStripeFailed: mocks.markHostedAiUsageStripeFailed,
  markHostedAiUsageStripeMetered: mocks.markHostedAiUsageStripeMetered,
  markHostedAiUsageStripeMeteringDisabled: mocks.markHostedAiUsageStripeMeteringDisabled,
  markHostedAiUsageStripeProgress: mocks.markHostedAiUsageStripeProgress,
  markHostedAiUsageStripeRetryableFailure: mocks.markHostedAiUsageStripeRetryableFailure,
  markHostedAiUsageStripeSkipped: mocks.markHostedAiUsageStripeSkipped,
}));

import {
  drainHostedAiUsageStripeMetering,
  readHostedAiUsageStripeMeterEnvironment,
} from "@/src/lib/hosted-execution/stripe-metering";

const describe = baseDescribe.sequential;

function createClaim(updatedAt: string, attemptCount = 1) {
  return {
    attemptCount,
    leaseExpiresAt: new Date("2026-03-29T12:10:00.000Z"),
    updatedAt: new Date(updatedAt),
  };
}

function createCandidate(overrides: Record<string, unknown> = {}) {
  return {
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
    stripeMeterAttemptCount: 0,
    stripeMeterIdentifier: null,
    stripeMeterStatus: "pending",
    totalTokens: 15,
    updatedAt: new Date("2026-03-29T12:04:00.000Z"),
    ...overrides,
  };
}

describe("drainHostedAiUsageStripeMetering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unconfigured when Stripe metering env is absent", async () => {
    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        aiUsageBillingMode: "stripe_meter",
        batchLimit: 32,
        meterEventName: null,
        stripeSecretKey: null,
      },
    });

    expect(result).toEqual({
      configured: false,
      failed: 0,
      metered: 0,
      skipped: 0,
    });
    expect(mocks.listHostedAiUsagePendingStripeMetering).not.toHaveBeenCalled();
  });

  it("skips due pending rows without posting when AI usage billing is disabled", async () => {
    mocks.markHostedAiUsageStripeMeteringDisabled.mockResolvedValue(2);
    const fetchMock = vi.fn();

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        aiUsageBillingMode: "disabled",
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      fetchImpl: fetchMock as typeof fetch,
      now: "2026-03-29T12:05:00.000Z",
    });

    expect(result).toEqual({
      configured: false,
      failed: 0,
      metered: 0,
      skipped: 2,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.listHostedAiUsagePendingStripeMetering).not.toHaveBeenCalled();
    expect(mocks.markHostedAiUsageStripeMeteringDisabled).toHaveBeenCalledWith({
      limit: 32,
      message:
        "Hosted AI usage billing is disabled until Stripe native LLM billing is enabled.",
      now: new Date("2026-03-29T12:05:00.000Z"),
      prisma: undefined,
    });
  });

  it("skips member-funded usage after claiming the row", async () => {
    const claim = createClaim("2026-03-29T12:05:01.000Z");
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      createCandidate({
        apiKeyEnv: "OPENAI_API_KEY",
        credentialSource: "member",
      }),
    ]);
    mocks.claimHostedAiUsageStripeMetering.mockResolvedValue(claim);

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        aiUsageBillingMode: "stripe_meter",
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      now: "2026-03-29T12:05:00.000Z",
    });

    expect(result).toEqual({
      configured: true,
      failed: 0,
      metered: 0,
      skipped: 1,
    });
    expect(mocks.markHostedAiUsageStripeSkipped).toHaveBeenCalledWith({
      attemptedAt: new Date("2026-03-29T12:05:00.000Z"),
      claim,
      expectedIdentifier: null,
      id: "usage_123",
      message: "Skipped Stripe AI metering because the run used member-supplied credentials.",
      prisma: undefined,
    });
  });

  it("claims the row, fences each token side before POST, and finalizes metered progress", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      createCandidate({
        id: "usage_abc",
        inputTokens: 120,
        occurredAt: new Date("2026-03-29T12:34:56.000Z"),
        outputTokens: 45,
        requestedModel: "venice/deepseek-r1-671b",
      }),
    ]);
    mocks.claimHostedAiUsageStripeMetering.mockResolvedValue(
      createClaim("2026-03-29T12:40:01.000Z"),
    );
    mocks.markHostedAiUsageStripeProgress
      .mockResolvedValueOnce(createClaim("2026-03-29T12:40:02.000Z"))
      .mockResolvedValueOnce(createClaim("2026-03-29T12:40:03.000Z"))
      .mockResolvedValueOnce(createClaim("2026-03-29T12:40:04.000Z"));

    const fetchCalls: Array<[string, RequestInit | undefined]> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push([String(input), init]);
      return new Response(JSON.stringify({ id: "mtr_evt_123" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        aiUsageBillingMode: "stripe_meter",
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      fetchImpl: fetchMock as typeof fetch,
      now: "2026-03-29T12:40:00.000Z",
    });

    expect(result).toEqual({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 0,
    });
    expect(fetchCalls).toHaveLength(2);
    const [firstUrl, firstRequest] = fetchCalls[0] as [string, RequestInit | undefined];
    const [secondUrl, secondRequest] = fetchCalls[1] as [string, RequestInit | undefined];
    expect(firstUrl).toBe("https://api.stripe.com/v1/billing/meter_events");
    expect(secondUrl).toBe("https://api.stripe.com/v1/billing/meter_events");
    expect(new Headers(firstRequest?.headers).get("Idempotency-Key")).toBe("usage_abc:input");
    expect(new Headers(secondRequest?.headers).get("Idempotency-Key")).toBe("usage_abc:output");
    expect(String(firstRequest?.body ?? "")).toContain("payload%5Bvalue%5D=120");
    expect(String(firstRequest?.body ?? "")).toContain("payload%5Bmodel%5D=venice%2Fdeepseek-r1-671b");
    expect(String(secondRequest?.body ?? "")).toContain("payload%5Bvalue%5D=45");

    expect(mocks.markHostedAiUsageStripeProgress).toHaveBeenNthCalledWith(1, {
      attemptedAt: new Date("2026-03-29T12:40:00.000Z"),
      claim: createClaim("2026-03-29T12:40:01.000Z"),
      expectedIdentifier: null,
      id: "usage_abc",
      identifier: "tokens-v2:fenced=input",
      prisma: undefined,
    });
    expect(mocks.markHostedAiUsageStripeProgress).toHaveBeenNthCalledWith(2, {
      attemptedAt: new Date("2026-03-29T12:40:00.000Z"),
      claim: createClaim("2026-03-29T12:40:02.000Z"),
      expectedIdentifier: "tokens-v2:fenced=input",
      id: "usage_abc",
      identifier: "tokens-v2:completed=input",
      prisma: undefined,
    });
    expect(mocks.markHostedAiUsageStripeProgress).toHaveBeenNthCalledWith(3, {
      attemptedAt: new Date("2026-03-29T12:40:00.000Z"),
      claim: createClaim("2026-03-29T12:40:03.000Z"),
      expectedIdentifier: "tokens-v2:completed=input",
      id: "usage_abc",
      identifier: "tokens-v2:completed=input;fenced=output",
      prisma: undefined,
    });
    expect(mocks.markHostedAiUsageStripeMetered).toHaveBeenCalledWith({
      attemptedAt: new Date("2026-03-29T12:40:00.000Z"),
      claim: createClaim("2026-03-29T12:40:04.000Z"),
      expectedIdentifier: "tokens-v2:completed=input;fenced=output",
      id: "usage_abc",
      identifier: "usage_abc:tokens-v1",
      prisma: undefined,
    });
  });

  it("lets only one concurrent drain claim and send the token-side event", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      createCandidate({
        id: "usage_concurrent",
        outputTokens: null,
      }),
    ]);
    mocks.claimHostedAiUsageStripeMetering
      .mockResolvedValueOnce(createClaim("2026-03-29T12:05:01.000Z"))
      .mockResolvedValueOnce(null);
    mocks.markHostedAiUsageStripeProgress.mockResolvedValue(
      createClaim("2026-03-29T12:05:02.000Z"),
    );

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "mtr_evt_input" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }));

    const [first, second] = await Promise.all([
      drainHostedAiUsageStripeMetering({
        environment: {
          aiUsageBillingMode: "stripe_meter",
          batchLimit: 32,
          meterEventName: "ai_total_tokens",
          stripeSecretKey: "sk_test_123",
        },
        fetchImpl: fetchMock as typeof fetch,
        now: "2026-03-29T12:05:00.000Z",
      }),
      drainHostedAiUsageStripeMetering({
        environment: {
          aiUsageBillingMode: "stripe_meter",
          batchLimit: 32,
          meterEventName: "ai_total_tokens",
          stripeSecretKey: "sk_test_123",
        },
        fetchImpl: fetchMock as typeof fetch,
        now: "2026-03-29T12:05:00.000Z",
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([first, second]).toEqual([
      {
        configured: true,
        failed: 0,
        metered: 1,
        skipped: 0,
      },
      {
        configured: true,
        failed: 0,
        metered: 0,
        skipped: 0,
      },
    ]);
  });

  it("keeps partial progress durable and retries only the missing token side", async () => {
    const attemptedAt = "2026-03-29T12:05:00.000Z";
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValueOnce([
      createCandidate({
        id: "usage_partial",
      }),
    ]);
    mocks.claimHostedAiUsageStripeMetering.mockResolvedValueOnce(
      createClaim("2026-03-29T12:05:01.000Z"),
    );
    mocks.markHostedAiUsageStripeProgress
      .mockResolvedValueOnce(createClaim("2026-03-29T12:05:02.000Z"))
      .mockResolvedValueOnce(createClaim("2026-03-29T12:05:03.000Z"))
      .mockResolvedValueOnce(createClaim("2026-03-29T12:05:04.000Z"));

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("payload%5Btoken_type%5D=input")) {
        return new Response(JSON.stringify({ id: "mtr_evt_input" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      }

      return new Response(JSON.stringify({ error: { message: "temporary failure" } }), {
        status: 500,
      });
    });

    await expect(
      drainHostedAiUsageStripeMetering({
        environment: {
          aiUsageBillingMode: "stripe_meter",
          batchLimit: 32,
          meterEventName: "ai_total_tokens",
          stripeSecretKey: "sk_test_123",
        },
        fetchImpl: fetchMock as typeof fetch,
        now: attemptedAt,
      }),
    ).resolves.toEqual({
      configured: true,
      failed: 1,
      metered: 0,
      skipped: 0,
    });

    expect(mocks.markHostedAiUsageStripeRetryableFailure).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      claim: createClaim("2026-03-29T12:05:04.000Z"),
      expectedIdentifier: "tokens-v2:completed=input;fenced=output",
      id: "usage_partial",
      identifier: "tokens-v2:completed=input",
      message: "Stripe meter event usage_partial:output failed with HTTP 500.",
      nextAttemptAt: new Date("2026-03-29T12:10:00.000Z"),
      prisma: undefined,
    });

    vi.clearAllMocks();
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValueOnce([
      createCandidate({
        id: "usage_partial",
        stripeMeterAttemptCount: 1,
        stripeMeterIdentifier: "tokens-v2:completed=input",
        updatedAt: new Date("2026-03-29T12:09:59.000Z"),
      }),
    ]);
    mocks.claimHostedAiUsageStripeMetering.mockResolvedValueOnce(
      createClaim("2026-03-29T12:15:01.000Z", 2),
    );
    mocks.markHostedAiUsageStripeProgress.mockResolvedValueOnce(
      createClaim("2026-03-29T12:15:02.000Z", 2),
    );
    const retryFetchCalls: Array<[string, RequestInit | undefined]> = [];
    const retryFetchMock: typeof fetch = async (input, init) => {
      retryFetchCalls.push([String(input), init]);

      return new Response(JSON.stringify({ id: "mtr_evt_output" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    };

    await expect(
      drainHostedAiUsageStripeMetering({
        environment: {
          aiUsageBillingMode: "stripe_meter",
          batchLimit: 32,
          meterEventName: "ai_total_tokens",
          stripeSecretKey: "sk_test_123",
        },
        fetchImpl: retryFetchMock,
        now: "2026-03-29T12:15:00.000Z",
      }),
    ).resolves.toEqual({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 0,
    });

    expect(retryFetchCalls).toHaveLength(1);
    const retryRequest = retryFetchCalls[0];
    expect(retryRequest).toBeDefined();
    expect(String(retryRequest?.[1]?.body ?? "")).toContain(
      "identifier=usage_partial%3Aoutput",
    );
    expect(mocks.markHostedAiUsageStripeMetered).toHaveBeenCalledWith({
      attemptedAt: new Date("2026-03-29T12:15:00.000Z"),
      claim: createClaim("2026-03-29T12:15:02.000Z", 2),
      expectedIdentifier: "tokens-v2:completed=input;fenced=output",
      id: "usage_partial",
      identifier: "usage_partial:tokens-v1",
      prisma: undefined,
    });
  });

  it("refuses to resend a fenced token side even after the Stripe-side dedupe window has elapsed", async () => {
    const claim = {
      ...createClaim("2026-03-30T13:15:01.000Z", 2),
      leaseExpiresAt: new Date("2026-03-30T13:20:00.000Z"),
    };
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      createCandidate({
        id: "usage_crash",
        stripeMeterAttemptCount: 1,
        stripeMeterIdentifier: "tokens-v2:completed=input;fenced=output",
        stripeMeterStatus: "processing",
        updatedAt: new Date("2026-03-29T12:14:59.000Z"),
      }),
    ]);
    mocks.claimHostedAiUsageStripeMetering.mockResolvedValue(claim);
    const fetchMock = vi.fn();

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        aiUsageBillingMode: "stripe_meter",
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      fetchImpl: fetchMock as typeof fetch,
      now: "2026-03-30T13:15:00.000Z",
    });

    expect(result).toEqual({
      configured: true,
      failed: 1,
      metered: 0,
      skipped: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.markHostedAiUsageStripeFailed).toHaveBeenCalledWith({
      attemptedAt: new Date("2026-03-30T13:15:00.000Z"),
      claim,
      expectedIdentifier: "tokens-v2:completed=input;fenced=output",
      id: "usage_crash",
      identifier: "tokens-v2:completed=input;fenced=output",
      message:
        "Stopped Stripe AI metering retry because a prior worker fenced token-side progress for output before POST and the delivery outcome is unknown; refusing to resend automatically.",
      prisma: undefined,
    });
  });
});

describe("readHostedAiUsageStripeMeterEnvironment", () => {
  it("reads batch size and the Stripe meter event name", () => {
    expect(
      readHostedAiUsageStripeMeterEnvironment({
        HOSTED_AI_USAGE_BILLING_MODE: "stripe_meter",
        HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT: "16",
        HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME: "ai_total_tokens",
        STRIPE_SECRET_KEY: "sk_test_123",
      }),
    ).toEqual({
      aiUsageBillingMode: "stripe_meter",
      batchLimit: 16,
      meterEventName: "ai_total_tokens",
      stripeSecretKey: "sk_test_123",
    });
  });

  it("defaults AI usage billing to disabled without synthesizing a Stripe meter event name", () => {
    expect(
      readHostedAiUsageStripeMeterEnvironment({
        STRIPE_SECRET_KEY: "sk_test_123",
      }),
    ).toEqual({
      aiUsageBillingMode: "disabled",
      batchLimit: 32,
      meterEventName: null,
      stripeSecretKey: "sk_test_123",
    });
  });

  it("fails unsupported AI usage billing modes closed to disabled", () => {
    expect(
      readHostedAiUsageStripeMeterEnvironment({
        HOSTED_AI_USAGE_BILLING_MODE: "usage_allowance",
        HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME: "ai_total_tokens",
        STRIPE_SECRET_KEY: "sk_test_123",
      }),
    ).toEqual({
      aiUsageBillingMode: "disabled",
      batchLimit: 32,
      meterEventName: "ai_total_tokens",
      stripeSecretKey: "sk_test_123",
    });
  });
});
