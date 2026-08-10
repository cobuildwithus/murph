import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  createHostedDeviceSyncPublicIngressService: vi.fn(),
  createSdkSignInSession: vi.fn(),
  getPrisma: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readOptionalJsonObject: vi.fn(),
  requireHostedCompanionMemberIdFromRequest: vi.fn(),
  validateCompanionSignInRequestBody: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/companion", () => ({
  COMPANION_DEVICE_SYNC_PROVIDER: "junction",
  validateCompanionSignInRequestBody:
    mocks.validateCompanionSignInRequestBody,
}));

vi.mock("@/src/lib/device-sync/public-ingress-service", () => ({
  createHostedDeviceSyncPublicIngressService:
    mocks.createHostedDeviceSyncPublicIngressService,
}));

vi.mock("@/src/lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/lib/http")>()),
  readOptionalJsonObject: mocks.readOptionalJsonObject,
}));

vi.mock("@/src/lib/hosted-onboarding/companion-member-access", () => ({
  requireHostedCompanionMemberIdFromRequest:
    mocks.requireHostedCompanionMemberIdFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed:
    mocks.assertActiveHostedMemberAccessAllowed,
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type RouteModule = typeof import(
  "../app/api/device-sync/companion/sign-in-token/route"
);

let route: RouteModule;

function request(body?: unknown): Request {
  return new Request(
    "https://app.example.test/api/device-sync/companion/sign-in-token",
    body === undefined
      ? { method: "POST" }
      : {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        },
  );
}

describe("native companion signup token route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/device-sync/companion/sign-in-token/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const prisma = { label: "test-prisma" };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.readOptionalJsonObject.mockResolvedValue({
      connectionIntent: "connect",
      platform: "ios",
      timeZone: "America/Denver",
    });
    mocks.validateCompanionSignInRequestBody.mockReturnValue("connect");
    mocks.requireHostedCompanionMemberIdFromRequest.mockResolvedValue(
      "member_native",
    );
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.assertActiveHostedMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.createSdkSignInSession.mockResolvedValue({
      environment: "sandbox",
      signInToken: "junction-token-do-not-log",
    });
    mocks.createHostedDeviceSyncPublicIngressService.mockReturnValue({
      createSdkSignInSession: mocks.createSdkSignInSession,
    });
  });

  it("validates the public request before allowing account mutation", async () => {
    const incoming = request({ platform: "ios" });
    const response = await route.POST(incoming);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      environment: "sandbox",
      signInToken: "junction-token-do-not-log",
    });
    expect(
      mocks.validateCompanionSignInRequestBody.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.requireHostedCompanionMemberIdFromRequest.mock
        .invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(
      mocks.requireHostedCompanionMemberIdFromRequest,
    ).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
      request: incoming,
      timeZone: "America/Denver",
    });
    expect(mocks.createSdkSignInSession).toHaveBeenCalledWith(
      "member_native",
      "junction",
      "connect",
      { allowConnectionMutation: true },
    );
  });

  it("does not create a member when request validation fails", async () => {
    mocks.validateCompanionSignInRequestBody.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "COMPANION_REQUEST_INVALID",
        httpStatus: 400,
        message: "Companion sign-in request is invalid.",
      });
    });

    const response = await route.POST(request({ platform: "web" }));

    expect(response.status).toBe(400);
    expect(
      mocks.requireHostedCompanionMemberIdFromRequest,
    ).not.toHaveBeenCalled();
    expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
  });

  it("never reaches Junction when hosted signup or consent is incomplete", async () => {
    mocks.requireHostedCompanionMemberIdFromRequest.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the Murph legal consent before continuing.",
      }),
    );

    const response = await route.POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_CONSENT_REQUIRED",
      },
    });
    expect(mocks.createSdkSignInSession).not.toHaveBeenCalled();
  });
});
