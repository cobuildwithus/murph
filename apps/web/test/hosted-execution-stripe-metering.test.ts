import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markHostedAiUsageStripeFailed: vi.fn(),
  listHostedAiUsagePendingStripeMetering: vi.fn(),
  markHostedAiUsageStripeMetered: vi.fn(),
  markHostedAiUsageStripeProgress: vi.fn(),
  markHostedAiUsageStripeRetryableFailure: vi.fn(),
  markHostedAiUsageStripeSkipped: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  markHostedAiUsageStripeFailed: mocks.markHostedAiUsageStripeFailed,
  listHostedAiUsagePendingStripeMetering: mocks.listHostedAiUsagePendingStripeMetering,
  markHostedAiUsageStripeMetered: mocks.markHostedAiUsageStripeMetered,
  markHostedAiUsageStripeProgress: mocks.markHostedAiUsageStripeProgress,
  markHostedAiUsageStripeRetryableFailure: mocks.markHostedAiUsageStripeRetryableFailure,
  markHostedAiUsageStripeSkipped: mocks.markHostedAiUsageStripeSkipped,
}));

import {
  drainHostedAiUsageStripeMetering,
  readHostedAiUsageStripeMeterEnvironment,
} from "@/src/lib/hosted-execution/stripe-metering";

const describe = baseDescribe.sequential;

describe("drainHostedAiUsageStripeMetering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unconfigured when Stripe metering env is absent", async () => {
    const result = await drainHostedAiUsageStripeMetering({
      environment: {
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

  it("skips member-funded usage instead of sending a Stripe meter event", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: "OPENAI_API_KEY",
        credentialSource: "member",
        id: "usage_123",
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
        outputTokens: 5,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeCustomerId: "cus_123",
        stripeMeterAttemptCount: 0,
        stripeMeterStatus: "pending",
        totalTokens: 15,
      },
    ]);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "mtr_evt_123" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }));
    const attemptedAt = "2026-03-29T12:05:00.000Z";

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      fetchImpl: fetchMock as typeof fetch,
      now: attemptedAt,
    });

    expect(result).toEqual({
      configured: true,
      failed: 0,
      metered: 0,
      skipped: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.markHostedAiUsageStripeSkipped).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      id: "usage_123",
      message: "Skipped Stripe AI metering because the run used member-supplied credentials.",
      prisma: undefined,
    });
  });

  it("sends platform input and output token usage to Stripe with deterministic identifiers and the original timestamp", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_abc",
        inputTokens: 120,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:34:56.000Z"),
        outputTokens: 45,
        provider: "openai-compatible",
        requestedModel: "venice/deepseek-r1-671b",
        stripeCustomerId: "cus_123",
        stripeMeterAttemptCount: 0,
        stripeMeterIdentifier: null,
        stripeMeterStatus: "pending",
        totalTokens: 165,
      },
    ]);
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
    const attemptedAt = "2026-03-29T12:40:00.000Z";

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      fetchImpl: fetchMock as typeof fetch,
      now: attemptedAt,
    });

    expect(result).toEqual({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCall = fetchCalls.at(0);
    const secondCall = fetchCalls.at(1);
    expect(firstCall).toBeDefined();
    expect(secondCall).toBeDefined();
    const [firstUrl, firstRequestInit] = firstCall as [string, RequestInit | undefined];
    const [secondUrl, secondRequestInit] = secondCall as [string, RequestInit | undefined];
    expect(firstUrl).toBe("https://api.stripe.com/v1/billing/meter_events");
    expect(secondUrl).toBe("https://api.stripe.com/v1/billing/meter_events");
    const firstHeaders = new Headers(firstRequestInit?.headers);
    const secondHeaders = new Headers(secondRequestInit?.headers);
    expect(firstHeaders.get("authorization")).toBe("Bearer sk_test_123");
    expect(firstHeaders.get("Idempotency-Key")).toBe("usage_abc:input");
    expect(secondHeaders.get("Idempotency-Key")).toBe("usage_abc:output");
    const firstBody = String(firstRequestInit?.body ?? "");
    const secondBody = String(secondRequestInit?.body ?? "");
    expect(firstBody).toContain("event_name=ai_total_tokens");
    expect(firstBody).toContain("identifier=usage_abc%3Ainput");
    expect(firstBody).toContain("payload%5Bstripe_customer_id%5D=cus_123");
    expect(firstBody).toContain("payload%5Bvalue%5D=120");
    expect(firstBody).toContain("payload%5Btoken_type%5D=input");
    expect(firstBody).toContain("payload%5Bmodel%5D=venice%2Fdeepseek-r1-671b");
    expect(firstBody).toContain("timestamp=1774787696");
    expect(secondBody).toContain("identifier=usage_abc%3Aoutput");
    expect(secondBody).toContain("payload%5Bvalue%5D=45");
    expect(secondBody).toContain("payload%5Btoken_type%5D=output");
    expect(mocks.markHostedAiUsageStripeProgress).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      id: "usage_abc",
      identifier: "tokens-v1:input",
      prisma: undefined,
    });
    expect(mocks.markHostedAiUsageStripeMetered).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      id: "usage_abc",
      identifier: "usage_abc:tokens-v1",
      prisma: undefined,
    });
  });

  it("keeps Stripe failures retryable with exponential backoff", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          message: "temporary failure",
        },
      }), {
        status: 500,
      }));
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_retry",
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
        outputTokens: 5,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeCustomerId: "cus_123",
        stripeMeterAttemptCount: 2,
        stripeMeterIdentifier: null,
        stripeMeterStatus: "pending",
        totalTokens: 15,
      },
    ]);
    const attemptedAt = "2026-03-29T12:05:00.000Z";

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      fetchImpl: fetchMock as typeof fetch,
      now: attemptedAt,
    });

    expect(result).toEqual({
      configured: true,
      failed: 1,
      metered: 0,
      skipped: 0,
    });
    expect(mocks.markHostedAiUsageStripeRetryableFailure).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      id: "usage_retry",
      identifier: null,
      message: "Stripe meter event usage_retry:input failed with HTTP 500.",
      nextAttemptAt: new Date("2026-03-29T12:25:00.000Z"),
      prisma: undefined,
    });
    expect(mocks.markHostedAiUsageStripeRetryableFailure).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("temporary failure"),
    }));
  });

  it("marks permanent Stripe client failures as terminal", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          message: "bad request",
        },
      }), {
        status: 400,
      }));
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_bad_request",
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
        outputTokens: 5,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeCustomerId: "cus_123",
        stripeMeterAttemptCount: 0,
        stripeMeterIdentifier: null,
        stripeMeterStatus: "pending",
        totalTokens: 15,
      },
    ]);
    const attemptedAt = "2026-03-29T12:05:00.000Z";

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      fetchImpl: fetchMock as typeof fetch,
      now: attemptedAt,
    });

    expect(result).toEqual({
      configured: true,
      failed: 1,
      metered: 0,
      skipped: 0,
    });
    expect(mocks.markHostedAiUsageStripeFailed).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      id: "usage_bad_request",
      identifier: null,
      message: "Stripe meter event usage_bad_request:input failed with HTTP 400.",
      prisma: undefined,
    });
    expect(mocks.markHostedAiUsageStripeRetryableFailure).not.toHaveBeenCalled();
  });

  it("falls back to input and output token totals when totalTokens is absent", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_fallback_total",
        inputTokens: 120,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:34:56.000Z"),
        outputTokens: 45,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeCustomerId: "cus_123",
        stripeMeterAttemptCount: 0,
        stripeMeterIdentifier: null,
        stripeMeterStatus: "pending",
        totalTokens: null,
      },
    ]);
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
    const attemptedAt = "2026-03-29T12:40:00.000Z";

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      fetchImpl: fetchMock as typeof fetch,
      now: attemptedAt,
    });

    expect(result).toEqual({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 0,
    });
    expect(fetchCalls).toHaveLength(2);
    const inputBody = String(fetchCalls.at(0)?.[1]?.body ?? "");
    const outputBody = String(fetchCalls.at(1)?.[1]?.body ?? "");
    expect(inputBody).toContain("payload%5Bvalue%5D=120");
    expect(inputBody).toContain("payload%5Btoken_type%5D=input");
    expect(outputBody).toContain("payload%5Bvalue%5D=45");
    expect(outputBody).toContain("payload%5Btoken_type%5D=output");
  });

  it("skips usage when no positive token count can be proven", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_missing_total",
        inputTokens: null,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:34:56.000Z"),
        outputTokens: 0,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeCustomerId: "cus_123",
        stripeMeterAttemptCount: 0,
        stripeMeterIdentifier: null,
        stripeMeterStatus: "pending",
        totalTokens: null,
      },
    ]);
    const fetchMock = vi.fn();
    const attemptedAt = "2026-03-29T12:40:00.000Z";

    const result = await drainHostedAiUsageStripeMetering({
      environment: {
        batchLimit: 32,
        meterEventName: "ai_total_tokens",
        stripeSecretKey: "sk_test_123",
      },
      fetchImpl: fetchMock as typeof fetch,
      now: attemptedAt,
    });

    expect(result).toEqual({
      configured: true,
      failed: 0,
      metered: 0,
      skipped: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.markHostedAiUsageStripeSkipped).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      id: "usage_missing_total",
      message: "Skipped Stripe AI metering because no positive input or output token count was available.",
      prisma: undefined,
    });
  });

  it("persists split-meter progress and retries only the missing token side after a partial failure", async () => {
    const attemptedAt = "2026-03-29T12:05:00.000Z";
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

      return new Response(JSON.stringify({
        error: {
          message: "temporary failure",
        },
      }), {
        status: 500,
      });
    });
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValueOnce([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_partial",
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
        outputTokens: 5,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeCustomerId: "cus_123",
        stripeMeterAttemptCount: 0,
        stripeMeterIdentifier: null,
        stripeMeterStatus: "pending",
        totalTokens: 15,
      },
    ]);

    await expect(
      drainHostedAiUsageStripeMetering({
        environment: {
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

    expect(mocks.markHostedAiUsageStripeProgress).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      id: "usage_partial",
      identifier: "tokens-v1:input",
      prisma: undefined,
    });
    expect(mocks.markHostedAiUsageStripeRetryableFailure).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      id: "usage_partial",
      identifier: "tokens-v1:input",
      message: "Stripe meter event usage_partial:output failed with HTTP 500.",
      nextAttemptAt: new Date("2026-03-29T12:10:00.000Z"),
      prisma: undefined,
    });

    vi.clearAllMocks();
    const retryFetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "mtr_evt_output" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }));
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValueOnce([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_partial",
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
        outputTokens: 5,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeCustomerId: "cus_123",
        stripeMeterAttemptCount: 1,
        stripeMeterIdentifier: "tokens-v1:input",
        stripeMeterStatus: "pending",
        totalTokens: 15,
      },
    ]);

    await expect(
      drainHostedAiUsageStripeMetering({
        environment: {
          batchLimit: 32,
          meterEventName: "ai_total_tokens",
          stripeSecretKey: "sk_test_123",
        },
        fetchImpl: retryFetchMock as typeof fetch,
        now: "2026-03-29T12:15:00.000Z",
      }),
    ).resolves.toEqual({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 0,
    });

    expect(retryFetchMock).toHaveBeenCalledTimes(1);
    const retryRequest = retryFetchMock.mock.calls[0] as unknown as
      | [unknown, RequestInit | undefined]
      | undefined;
    expect(retryRequest).toBeDefined();
    const retryBody = String(retryRequest?.[1]?.body ?? "");
    expect(retryBody).toContain("identifier=usage_partial%3Aoutput");
    expect(retryBody).toContain("payload%5Btoken_type%5D=output");
    expect(mocks.markHostedAiUsageStripeMetered).toHaveBeenCalledWith({
      attemptedAt: new Date("2026-03-29T12:15:00.000Z"),
      id: "usage_partial",
      identifier: "usage_partial:tokens-v1",
      prisma: undefined,
    });
  });
});

describe("readHostedAiUsageStripeMeterEnvironment", () => {
  it("reads batch size and the Stripe meter event name", () => {
    expect(
      readHostedAiUsageStripeMeterEnvironment({
        HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT: "16",
        HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME: "ai_total_tokens",
        STRIPE_SECRET_KEY: "sk_test_123",
      }),
    ).toEqual({
      batchLimit: 16,
      meterEventName: "ai_total_tokens",
      stripeSecretKey: "sk_test_123",
    });
  });

  it("defaults the Stripe meter event name when the env var is absent", () => {
    expect(
      readHostedAiUsageStripeMeterEnvironment({
        STRIPE_SECRET_KEY: "sk_test_123",
      }),
    ).toEqual({
      batchLimit: 32,
      meterEventName: "token-billing-tokens",
      stripeSecretKey: "sk_test_123",
    });
  });
});
