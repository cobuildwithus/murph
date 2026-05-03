import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import * as hostedOnboardingHttp from "../src/lib/hosted-onboarding/http";

const mocks = vi.hoisted(() => ({
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  reconcileHostedBillingCheckoutSuccess: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/billing-success-service", () => ({
  reconcileHostedBillingCheckoutSuccess: mocks.reconcileHostedBillingCheckoutSuccess,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

type BillingSuccessRouteModule = typeof import("../app/api/hosted-onboarding/billing/success/route");

let billingSuccessRoute: BillingSuccessRouteModule;
const readJsonObjectSpy = vi.spyOn(hostedOnboardingHttp, "readJsonObject");

describe("hosted onboarding billing success route", () => {
  beforeAll(async () => {
    billingSuccessRoute = await import("../app/api/hosted-onboarding/billing/success/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedMemberNotSuspended.mockReturnValue(undefined);
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
        suspendedAt: null,
      },
    });
    mocks.reconcileHostedBillingCheckoutSuccess.mockResolvedValue({
      activationPending: true,
      billing: {
        defaultPlanCode: "launch_monthly",
        plans: [],
      },
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: {
        code: "invite-code",
        expiresAt: "2026-03-27T12:00:00.000Z",
        phoneAuthTarget: {
          kind: "saved",
          phoneHint: "+1 415 555 2671",
        },
        phoneHint: "+1 415 555 2671",
        verificationMode: "invite_phone",
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "activating",
    });
  });

  it("reconciles the returned checkout session for the authenticated member", async () => {
    const response = await billingSuccessRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/success", {
        body: JSON.stringify({
          inviteCode: "invite-code",
          sessionId: "cs_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      activationPending: true,
      billing: {
        defaultPlanCode: "launch_monthly",
        plans: [],
      },
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: {
        code: "invite-code",
        expiresAt: "2026-03-27T12:00:00.000Z",
        phoneAuthTarget: {
          kind: "saved",
          phoneHint: "+1 415 555 2671",
        },
        phoneHint: "+1 415 555 2671",
        verificationMode: "invite_phone",
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "activating",
    });
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.reconcileHostedBillingCheckoutSuccess).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      sessionId: "cs_123",
    });
    expect(mocks.requireHostedAppSessionFromRequest.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.assertHostedMemberNotSuspended.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.assertHostedMemberNotSuspended).toHaveBeenCalledWith({
      id: "member_123",
      suspendedAt: null,
    });
    expect(mocks.assertHostedMemberNotSuspended.mock.invocationCallOrder[0])
      .toBeLessThan(readJsonObjectSpy.mock.invocationCallOrder[0] ?? 0);
    expect(readJsonObjectSpy.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.reconcileHostedBillingCheckoutSuccess.mock.invocationCallOrder[0] ?? 0);
  });

  it("blocks suspended members before reconciling the checkout session", async () => {
    const suspendedAt = new Date("2026-05-03T00:00:00.000Z");
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: {
        id: "member_123",
        suspendedAt,
      },
    });
    mocks.assertHostedMemberNotSuspended.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_SUSPENDED",
        httpStatus: 403,
        message: "This hosted account is suspended. Contact support to restore access.",
      });
    });

    const response = await billingSuccessRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/success", {
        body: JSON.stringify({
          inviteCode: "invite-code",
          sessionId: "cs_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.assertHostedMemberNotSuspended).toHaveBeenCalledWith({
      id: "member_123",
      suspendedAt,
    });
    expect(readJsonObjectSpy).not.toHaveBeenCalled();
    expect(mocks.reconcileHostedBillingCheckoutSuccess).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_MEMBER_SUSPENDED",
        message: "This hosted account is suspended. Contact support to restore access.",
        retryable: false,
      },
    });
  });
});
