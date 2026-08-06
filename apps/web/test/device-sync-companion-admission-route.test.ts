import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedCompanionMemberIdFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService:
    mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/hosted-onboarding/companion-member-access", () => ({
  requireHostedCompanionMemberIdFromRequest:
    mocks.requireHostedCompanionMemberIdFromRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type RouteModule = typeof import(
  "../app/api/device-sync/companion/admission/route"
);

let route: RouteModule;

function request(
  body?: unknown,
  headers: HeadersInit = {},
): Request {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("authorization", "Bearer privy-identity-token");

  if (body === undefined) {
    return new Request(
      "https://app.example.test/api/device-sync/companion/admission",
      {
        headers: requestHeaders,
        method: "POST",
      },
    );
  }

  requestHeaders.set("content-type", "application/json");
  return new Request(
    "https://app.example.test/api/device-sync/companion/admission",
    {
      body: JSON.stringify(body),
      headers: requestHeaders,
      method: "POST",
    },
  );
}

describe("POST /api/device-sync/companion/admission", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/device-sync/companion/admission/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({ label: "test-prisma" });
    mocks.requireHostedCompanionMemberIdFromRequest.mockResolvedValue(
      "member_native",
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the exact non-identifying v1 response without device ingress", async () => {
    const incoming = request({ timeZone: "America/Denver" });
    const response = await route.POST(incoming);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.requireHostedCompanionMemberIdFromRequest).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
      request: incoming,
      timeZone: "America/Denver",
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("uses the trusted hosting time-zone hint when the optional field is absent", async () => {
    const incoming = request(undefined, {
      "x-vercel-ip-timezone": "America/New_York",
    });
    const response = await route.POST(incoming);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCompanionMemberIdFromRequest).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
      request: incoming,
      timeZone: "America/New_York",
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("validates the complete closed body before any member mutation", async () => {
    const response = await route.POST(request({
      connectionIntent: "connect",
      platform: "android",
      timeZone: "America/Denver",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "COMPANION_REQUEST_INVALID" },
    });
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.requireHostedCompanionMemberIdFromRequest).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it.each([
    ["non-string", 17],
    ["non-IANA", "local"],
  ])("rejects %s time zones before admission", async (_label, timeZone) => {
    const response = await route.POST(request({ timeZone }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "COMPANION_REQUEST_INVALID" },
    });
    expect(mocks.requireHostedCompanionMemberIdFromRequest).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it("bounds the admission request before parsing or member mutation", async () => {
    const response = await route.POST(request({
      timeZone: "A".repeat(300),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_BODY_TOO_LARGE" },
    });
    expect(mocks.requireHostedCompanionMemberIdFromRequest).not.toHaveBeenCalled();
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
      status: 401,
    },
    {
      code: "HOSTED_CONSENT_REQUIRED",
      message: "Accept the Murph legal consent before continuing.",
      status: 403,
    },
    {
      code: "HOSTED_ACCESS_REQUIRED",
      message: "Active hosted access is required to continue.",
      status: 403,
    },
  ])("returns $code without crossing into device sync", async ({ code, message, status }) => {
    mocks.requireHostedCompanionMemberIdFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code,
        httpStatus: status,
        message,
      }),
    );

    const response = await route.POST(request({ timeZone: null }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      error: { code },
    });
    expect(mocks.createHostedDeviceSyncPublicIngressService).not.toHaveBeenCalled();
  });
});
