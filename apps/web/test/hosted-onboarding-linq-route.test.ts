import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
  finishHostedOnboardingTiming: vi.fn(),
  handleHostedOnboardingLinqWebhook: vi.fn(),
  logHostedOnboardingDiagnostic: vi.fn(),
  startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
    baseDetails,
    startedAtMs: 0,
    step,
  })),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  handleHostedOnboardingLinqWebhook: mocks.handleHostedOnboardingLinqWebhook,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/logging")>(
    "@/src/lib/hosted-onboarding/logging",
  );

  return {
    ...actual,
    deriveHostedOnboardingTimingErrorName: mocks.deriveHostedOnboardingTimingErrorName,
    finishHostedOnboardingTiming: mocks.finishHostedOnboardingTiming,
    logHostedOnboardingDiagnostic: mocks.logHostedOnboardingDiagnostic,
    startHostedOnboardingTiming: mocks.startHostedOnboardingTiming,
  };
});

type HostedOnboardingLinqRouteModule = typeof import("../app/api/hosted-onboarding/linq/webhook/route");

let hostedOnboardingLinqRoute: HostedOnboardingLinqRouteModule;

describe("hosted onboarding Linq webhook route", () => {
  beforeAll(async () => {
    hostedOnboardingLinqRoute = await import("../app/api/hosted-onboarding/linq/webhook/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.mockImplementation((callback: () => void) => callback());
    mocks.handleHostedOnboardingLinqWebhook.mockResolvedValue({
      ok: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not expose a public GET health handler", () => {
    expect(hostedOnboardingLinqRoute).not.toHaveProperty("GET");
  });

  it("does not bind durable Linq webhook handling to the public request abort signal", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
      method: "POST",
      body: JSON.stringify({
        ok: true,
      }),
      headers: {
        "x-webhook-signature": "sha256=test",
        "x-webhook-timestamp": "1711278000",
      },
    });

    const response = await hostedOnboardingLinqRoute.POST(request);

    expect(response.status).toBe(202);
    expect(mocks.handleHostedOnboardingLinqWebhook).toHaveBeenCalledWith({
      rawBody: JSON.stringify({
        ok: true,
      }),
      scheduleAfterResponse: expect.any(Function),
      signature: "sha256=test",
      timestamp: "1711278000",
    });
    expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
      "hosted-onboarding.route.linq-webhook",
      expect.objectContaining({
        signaturePresent: true,
        signalAbortedAtStart: false,
        timestampPresent: true,
      }),
    );
    expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
      "hosted-onboarding.route.linq-webhook.read-body",
      expect.objectContaining({
        signalAbortedAtStart: false,
      }),
    );
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.route.linq-webhook.read-body",
      }),
      "completed",
      expect.objectContaining({
        rawBodyBytes: JSON.stringify({ ok: true }).length,
        signalAbortedAfterRead: false,
      }),
    );
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.route.linq-webhook",
      }),
      "completed",
      expect.objectContaining({
        duplicate: false,
        rawBodyBytes: JSON.stringify({ ok: true }).length,
        reason: null,
        signalAbortedBeforeReturn: false,
      }),
    );
  });

  it("logs redacted Linq ingress timing deltas for message webhooks", async () => {
    const routeStartedAtMs = Date.parse("2026-06-24T18:46:10.522Z");
    vi.spyOn(Date, "now").mockReturnValue(routeStartedAtMs);
    mocks.handleHostedOnboardingLinqWebhook.mockResolvedValueOnce({
      duplicate: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    const rawBody = JSON.stringify({
      api_version: "v3",
      created_at: "2026-06-24T18:46:09.900Z",
      data: {
        received_at: "2026-06-24T18:46:04.780Z",
        sent_at: "2026-06-24T18:46:04.700Z",
      },
      event_id: "evt_392aa7",
      event_type: "message.received",
      trace_id: "trace_abcdef",
    });
    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        body: rawBody,
        headers: {
          "x-webhook-signature": "sha256=test",
          "x-webhook-timestamp": String(Date.parse("2026-06-24T18:46:10.000Z") / 1000),
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.logHostedOnboardingDiagnostic).toHaveBeenCalledWith(
      "hosted-onboarding.route.linq-webhook.ingress",
      expect.objectContaining({
        diagnosticSchemaVersion: 1,
        duplicate: false,
        eventCreatedAtParsed: true,
        eventCreatedAtPresent: true,
        eventCreatedMinusMessageTimestampMs: 5120,
        eventIdSuffix: "392aa7",
        eventType: "message.received",
        messageTimestampParsed: true,
        messageTimestampSource: "received_at",
        payloadParsed: true,
        rawBodyBytes: new TextEncoder().encode(rawBody).byteLength,
        responseReason: "wake-appended-active-member",
        routeStartMinusEventCreatedAtMs: 622,
        routeStartMinusMessageTimestampMs: 5742,
        routeStartMinusWebhookTimestampMs: 522,
        signalAbortedBeforeDiagnostic: false,
        traceIdSuffix: "abcdef",
        webhookTimestampMinusMessageTimestampMs: 5220,
        webhookTimestampParsed: true,
        webhookTimestampPresent: true,
      }),
    );
  });

  it("routes scheduled Linq webhook follow-up work through Next after", async () => {
    let scheduled = false;
    mocks.handleHostedOnboardingLinqWebhook.mockImplementationOnce((input: {
      scheduleAfterResponse?: (task: () => Promise<void>) => void;
    }) => {
      input.scheduleAfterResponse?.(() => {
        scheduled = true;
        return Promise.resolve();
      });

      return Promise.resolve({
        ok: true,
        reason: "wake-appended-active-member",
      });
    });

    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(scheduled).toBe(true);
  });

  it("falls back to fire-and-forget scheduled follow-up work when Next after throws", async () => {
    let scheduled = false;
    mocks.after.mockImplementationOnce(() => {
      throw new Error("after unavailable");
    });
    mocks.handleHostedOnboardingLinqWebhook.mockImplementationOnce((input: {
      scheduleAfterResponse?: (task: () => Promise<void>) => void;
    }) => {
      input.scheduleAfterResponse?.(() => {
        scheduled = true;
        return Promise.resolve();
      });

      return Promise.resolve({
        ok: true,
        reason: "wake-appended-active-member",
      });
    });

    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(scheduled).toBe(true);
  });

  it("maps in-progress receipt retries to a retryable 503 response", async () => {
    mocks.handleHostedOnboardingLinqWebhook.mockRejectedValue(
      hostedOnboardingError({
        code: "WEBHOOK_RECEIPT_IN_PROGRESS",
        httpStatus: 503,
        message: "Hosted webhook receipt is already being processed.",
        retryable: true,
      }),
    );

    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WEBHOOK_RECEIPT_IN_PROGRESS",
        message: "Hosted webhook receipt is already being processed.",
        retryable: true,
      },
    });
  });

  it("rejects oversized webhook bodies before invoking the Linq service", async () => {
    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        body: "x".repeat((256 * 1024) + 1),
        headers: {
          "content-length": String((256 * 1024) + 1),
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.handleHostedOnboardingLinqWebhook).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LINQ_WEBHOOK_BODY_TOO_LARGE",
        message: "Linq webhook body is too large.",
        retryable: false,
      },
    });
  });

  it("rejects streamed oversized webhook bodies without a declared content length", async () => {
    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        body: "x".repeat((256 * 1024) + 1),
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.handleHostedOnboardingLinqWebhook).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LINQ_WEBHOOK_BODY_TOO_LARGE",
        message: "Linq webhook body is too large.",
        retryable: false,
      },
    });
  });
});
