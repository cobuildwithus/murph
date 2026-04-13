import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  preProvisionManagedUserCryptoInHostedExecutionBestEffort: vi.fn(),
  scheduleManagedUserCryptoWarmupBestEffort: vi.fn(),
  requirePrivyCompletionSession: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/hosted-execution/control", () => ({
  preProvisionManagedUserCryptoInHostedExecutionBestEffort:
    mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort,
  scheduleManagedUserCryptoWarmupBestEffort:
    mocks.scheduleManagedUserCryptoWarmupBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/member-service", () => ({
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyCompletionSession:
    mocks.requirePrivyCompletionSession,
}));

type PrivyCompleteRouteModule = typeof import("../app/api/hosted-onboarding/privy/complete/route");

let privyCompleteRoute: PrivyCompleteRouteModule;

describe("hosted onboarding Privy completion route", () => {
  beforeAll(async () => {
    privyCompleteRoute = await import("../app/api/hosted-onboarding/privy/complete/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.after.mockImplementation((callback: () => void | Promise<void>) => {
      const result = callback();

      if (result && typeof (result as Promise<void>).catch === "function") {
        void (result as Promise<void>).catch(() => {});
      }
    });
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.completeHostedPrivyVerification.mockResolvedValue({
      activationPending: false,
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      memberId: "member_123",
      stage: "checkout",
    });
    mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort.mockResolvedValue(true);
    mocks.scheduleManagedUserCryptoWarmupBestEffort.mockImplementation(
      (input: {
        schedule: (callback: () => Promise<void> | void) => void;
        trigger: string;
        userId: string;
      }) => {
        const { schedule, ...warmupInput } = input;
        try {
          schedule(() =>
            mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort(warmupInput),
          );
          return "after";
        } catch (error) {
          console.error(
            `Hosted managed user crypto warmup scheduling failed during ${warmupInput.trigger}. Falling back to inline dispatch.`,
            error instanceof Error ? error.message : String(error),
          );
          void mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort(warmupInput);
          return "fallback-inline";
        }
      },
    );
    mocks.requirePrivyCompletionSession.mockResolvedValue({
      identity: {
        phone: {
          number: "+15550000000",
          verifiedAt: 1742990400,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
    });
  });

  it("returns the public completion payload and warms hosted crypto when checkout is next", async () => {
    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          inviteCode: "invite_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      activationPending: false,
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      ok: true,
      stage: "checkout",
    });
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      identity: {
        phone: {
          number: "+15550000000",
          verifiedAt: 1742990400,
        },
        userId: "did:privy:user_123",
        wallet: null,
      },
      inviteCode: "invite_123",
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort).toHaveBeenCalledWith({
      trigger: "privy-complete-checkout",
      userId: "member_123",
    });
  });

  it("skips the background warmup when the member is already active", async () => {
    mocks.completeHostedPrivyVerification.mockResolvedValueOnce({
      activationPending: false,
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      memberId: "member_123",
      stage: "active",
    });

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      activationPending: false,
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      ok: true,
      stage: "active",
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort).not.toHaveBeenCalled();
  });

  it("keeps the completion response successful when after scheduling throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.after.mockImplementation(() => {
      throw new TypeError("after unavailable");
    });

    const response = await privyCompleteRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/privy/complete", {
        body: JSON.stringify({
          inviteCode: "invite_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      activationPending: false,
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      ok: true,
      stage: "checkout",
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort).toHaveBeenCalledWith({
      trigger: "privy-complete-checkout",
      userId: "member_123",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted managed user crypto warmup scheduling failed during privy-complete-checkout. Falling back to inline dispatch.",
      "after unavailable",
    );
  });
});
