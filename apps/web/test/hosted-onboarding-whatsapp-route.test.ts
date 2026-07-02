import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handleHostedOnboardingWhatsAppWebhook: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  handleHostedOnboardingWhatsAppWebhook: mocks.handleHostedOnboardingWhatsAppWebhook,
}));

type HostedOnboardingWhatsAppRouteModule = typeof import("../app/api/whatsapp/webhook/route");

let hostedOnboardingWhatsAppRoute: HostedOnboardingWhatsAppRouteModule;

describe("hosted onboarding WhatsApp webhook route", () => {
  beforeAll(async () => {
    hostedOnboardingWhatsAppRoute = await import("../app/api/whatsapp/webhook/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "verify-token");
    mocks.after.mockImplementation((callback: () => void) => callback());
    mocks.handleHostedOnboardingWhatsAppWebhook.mockResolvedValue({
      inboundTextCount: 0,
      ok: true,
      routedTextCount: 0,
    });
  });

  it("returns Meta challenge text for a matching verify token", async () => {
    const response = await hostedOnboardingWhatsAppRoute.GET(
      new Request(
        "https://join.example.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-123",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("challenge-123");
  });

  it("rejects Meta challenge requests with the wrong verify token", async () => {
    const response = await hostedOnboardingWhatsAppRoute.GET(
      new Request(
        "https://join.example.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123",
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WHATSAPP_WEBHOOK_VERIFY_TOKEN_INVALID",
        message: "Invalid WhatsApp webhook verification request.",
        retryable: false,
      },
    });
  });

  it("fails closed when the WhatsApp verify token is not configured", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");

    const response = await hostedOnboardingWhatsAppRoute.GET(
      new Request(
        "https://join.example.test/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-123",
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WHATSAPP_WEBHOOK_VERIFY_TOKEN_NOT_CONFIGURED",
        message: "WHATSAPP_VERIFY_TOKEN must be configured for WhatsApp webhooks.",
        retryable: false,
      },
    });
  });

  it("forwards signed webhook POSTs into the hosted WhatsApp webhook service", async () => {
    const rawBody = JSON.stringify({
      entry: [],
      object: "whatsapp_business_account",
    });
    const request = new Request("https://join.example.test/api/whatsapp/webhook", {
      body: rawBody,
      headers: {
        "x-hub-signature-256": "sha256=test",
      },
      method: "POST",
    });

    const response = await hostedOnboardingWhatsAppRoute.POST(request);

    expect(response.status).toBe(202);
    expect(mocks.handleHostedOnboardingWhatsAppWebhook).toHaveBeenCalledWith({
      rawBody,
      scheduleAfterResponse: expect.any(Function),
      signature: "sha256=test",
      signal: request.signal,
    });
  });

  it("rejects oversized webhook bodies before invoking the WhatsApp service", async () => {
    const response = await hostedOnboardingWhatsAppRoute.POST(
      new Request("https://join.example.test/api/whatsapp/webhook", {
        body: "x".repeat((256 * 1024) + 1),
        headers: {
          "content-length": String((256 * 1024) + 1),
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.handleHostedOnboardingWhatsAppWebhook).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WHATSAPP_WEBHOOK_BODY_TOO_LARGE",
        message: "WhatsApp webhook body is too large.",
        retryable: false,
      },
    });
  });
});
