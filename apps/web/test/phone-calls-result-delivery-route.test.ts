import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  recordOutcome: vi.fn(),
  requireCallback: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireCallback,
}));

vi.mock("@/src/lib/phone-calls/result-delivery", () => ({
  recordHostedPhoneCallResultDeliveryOutcome: mocks.recordOutcome,
}));

type PhoneCallResultDeliveryRoute = typeof import(
  "../app/api/internal/hosted-runtime/phone-call-result/delivery/route"
);

let route: PhoneCallResultDeliveryRoute;

describe("hosted phone-call result delivery route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-runtime/phone-call-result/delivery/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCallback.mockResolvedValue("member_123");
    mocks.recordOutcome.mockResolvedValue({
      recorded: true,
      status: "delivered",
    });
  });

  it("authenticates and records one bounded exact-generation outcome", async () => {
    const request = buildRequest({
      generation: 2,
      phoneCallId: "hpc_123",
      status: "sent",
    });

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      recorded: true,
      status: "delivered",
    });
    expect(mocks.requireCallback).toHaveBeenCalledWith(request, {
      maxBodyBytes: 4 * 1024,
    });
    expect(mocks.recordOutcome).toHaveBeenCalledWith({
      memberId: "member_123",
      request: {
        generation: 2,
        phoneCallId: "hpc_123",
        status: "sent",
      },
      signal: request.signal,
    });
  });

  it("rejects provider entry without exact route authority", async () => {
    const response = await route.POST(buildRequest({
      generation: 1,
      phoneCallId: "hpc_123",
      status: "sending",
    }));

    expect(response.status).toBe(400);
    expect(mocks.requireCallback).toHaveBeenCalledOnce();
    expect(mocks.recordOutcome).not.toHaveBeenCalled();
  });

  it("rejects malformed outcome state before the durable owner is called", async () => {
    const request = buildRequest({
      generation: 0,
      phoneCallId: "hpc_123",
      status: "sent",
    });

    const response = await route.POST(request);

    expect(response.status).toBe(400);
    expect(mocks.requireCallback).toHaveBeenCalledOnce();
    expect(mocks.recordOutcome).not.toHaveBeenCalled();
  });

  it("fails closed when callback authentication is rejected", async () => {
    mocks.requireCallback.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_CALLBACK_UNAUTHORIZED",
      httpStatus: 401,
      message: "Hosted callback authorization is required.",
    }));

    const response = await route.POST(buildRequest({
      generation: 1,
      phoneCallId: "hpc_123",
      status: "sending",
    }));

    expect(response.status).toBe(401);
    expect(mocks.recordOutcome).not.toHaveBeenCalled();
  });
});

function buildRequest(body: Record<string, unknown>): Request {
  return new Request(
    "https://join.example.test/api/internal/hosted-runtime/phone-call-result/delivery",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
