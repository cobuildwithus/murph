import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  prismaClient: {
    label: "test-prisma",
  },
  readHostedPhoneHint: vi.fn(),
  reconcileHostedPrivyIdentityOnMember: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  readHostedPhoneHint: mocks.readHostedPhoneHint,
}));

vi.mock("@/src/lib/hosted-onboarding/member-identity-service", () => ({
  reconcileHostedPrivyIdentityOnMember: mocks.reconcileHostedPrivyIdentityOnMember,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyMemberAuth: mocks.requirePrivyMemberAuth,
}));

type SettingsPhoneSyncRouteModule = typeof import("../app/api/settings/phone/sync/route");

let settingsPhoneSyncRoute: SettingsPhoneSyncRouteModule;
const SAME_ORIGIN_HEADERS = {
  origin: "https://join.example.test",
};

describe("settings phone sync route", () => {
  beforeAll(async () => {
    settingsPhoneSyncRoute = await import("../app/api/settings/phone/sync/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.readHostedPhoneHint.mockReturnValue("+1 415 555 2671");
    mocks.reconcileHostedPrivyIdentityOnMember.mockResolvedValue(undefined);
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      identity: {
        phone: {
          number: "+14155552671",
        },
      },
      member: {
        id: "member_123",
      },
    });
  });

  it("verifies the server-side Privy cookie-backed session and syncs the phone identity onto the hosted member", async () => {
    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requirePrivyMemberAuth).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.reconcileHostedPrivyIdentityOnMember).toHaveBeenCalledWith({
      identity: {
        phone: {
          number: "+14155552671",
        },
      },
      member: {
        id: "member_123",
      },
      now: expect.any(Date),
      prisma: mocks.prismaClient,
    });
    expect(mocks.readHostedPhoneHint).toHaveBeenCalledWith("+14155552671");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      phoneNumber: "+14155552671",
      phoneNumberHint: "+1 415 555 2671",
    });
  });

  it("requires Privy-authenticated hosted member context before syncing the phone number", async () => {
    mocks.requirePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Verify your phone to continue.",
    }));

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.reconcileHostedPrivyIdentityOnMember).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Verify your phone to continue.",
        retryable: false,
      },
    });
  });

  it("returns a retryable conflict while the phone number has not reached the server-side Privy session yet", async () => {
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      identity: {
        phone: null,
      },
      member: {
        id: "member_123",
      },
    });

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.reconcileHostedPrivyIdentityOnMember).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_PHONE_NOT_READY",
        message: "Your verified phone number has not reached the server-side Privy session yet. Wait a moment and try again.",
        retryable: true,
      },
    });
  });

  it("rejects sync attempts when the cookie-backed Privy session no longer maps to a hosted member", async () => {
    mocks.requirePrivyMemberAuth.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_MEMBER_NOT_FOUND",
      httpStatus: 403,
      message: "Finish signup from your latest Murph link before continuing.",
    }));

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.reconcileHostedPrivyIdentityOnMember).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_MEMBER_NOT_FOUND",
        message: "Finish signup from your latest Murph link before continuing.",
        retryable: false,
      },
    });
  });

  it("surfaces identity conflicts when the verified phone belongs to a different hosted member", async () => {
    mocks.reconcileHostedPrivyIdentityOnMember.mockRejectedValue(hostedOnboardingError({
      code: "PRIVY_IDENTITY_CONFLICT",
      httpStatus: 409,
      message: "That phone number is already linked to a different Murph account.",
    }));

    const response = await settingsPhoneSyncRoute.POST(
      new Request("https://join.example.test/api/settings/phone/sync", {
        headers: SAME_ORIGIN_HEADERS,
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.reconcileHostedPrivyIdentityOnMember).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRIVY_IDENTITY_CONFLICT",
        message: "That phone number is already linked to a different Murph account.",
        retryable: false,
      },
    });
  });
});
