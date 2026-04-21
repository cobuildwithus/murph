import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markHostedAiUsageStripeFailed: vi.fn(),
  listHostedAiUsagePendingStripeMetering: vi.fn(),
  markHostedAiUsageStripeMetered: vi.fn(),
  markHostedAiUsageStripeRetryableFailure: vi.fn(),
  markHostedAiUsageStripeSkipped: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  markHostedAiUsageStripeFailed: mocks.markHostedAiUsageStripeFailed,
  listHostedAiUsagePendingStripeMetering: mocks.listHostedAiUsagePendingStripeMetering,
  markHostedAiUsageStripeMetered: mocks.markHostedAiUsageStripeMetered,
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

  it("sends platform total-token usage to Stripe with a deterministic identifier and original timestamp", async () => {
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestCall = fetchCalls.at(0);
    expect(requestCall).toBeDefined();
    const [url, requestInit] = requestCall as [string, RequestInit | undefined];
    expect(url).toBe("https://api.stripe.com/v1/billing/meter_events");
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk_test_123");
    expect(headers.get("Idempotency-Key")).toBe("usage_abc");
    const body = String(requestInit?.body ?? "");
    expect(body).toContain("event_name=ai_total_tokens");
    expect(body).toContain("identifier=usage_abc");
    expect(body).toContain("payload%5Bstripe_customer_id%5D=cus_123");
    expect(body).toContain("payload%5Bvalue%5D=165");
    expect(body).toContain("timestamp=1774787696");
    expect(mocks.markHostedAiUsageStripeMetered).toHaveBeenCalledWith({
      attemptedAt: new Date(attemptedAt),
      id: "usage_abc",
      identifier: "usage_abc",
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
      message: "Stripe meter event usage_retry failed with HTTP 500.",
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
      message: "Stripe meter event usage_bad_request failed with HTTP 400.",
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
    const requestCall = fetchCalls.at(0);
    expect(requestCall).toBeDefined();
    const requestInit = requestCall?.[1];
    const body = String(requestInit?.body ?? "");
    expect(body).toContain("payload%5Bvalue%5D=165");
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
      message: "Skipped Stripe AI metering because no positive token count was available.",
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
});
