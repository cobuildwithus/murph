import { HostedBillingStatus } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  issueHostedInvite: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  issueHostedInvite: mocks.issueHostedInvite,
}));

type DashboardRecoveryRouteModule =
  typeof import("../app/api/hosted-onboarding/session/dashboard-recovery/route");

let dashboardRecoveryRoute: DashboardRecoveryRouteModule;

describe("hosted onboarding dashboard recovery route", () => {
  beforeAll(async () => {
    dashboardRecoveryRoute = await import(
      "../app/api/hosted-onboarding/session/dashboard-recovery/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.issueHostedInvite.mockResolvedValue({
      inviteCode: "recovery invite",
    });
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: createHostedMember(),
    });
  });

  it("returns no redirect for active hosted members", async () => {
    const request = createDashboardRecoveryRequest();

    const response = await dashboardRecoveryRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      redirectPath: null,
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
  });

  it("returns a join redirect for checkout-stage hosted members", async () => {
    const request = createDashboardRecoveryRequest();
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: createHostedMember({
        billingStatus: HostedBillingStatus.incomplete,
      }),
    });

    const response = await dashboardRecoveryRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      redirectPath: "/join/recovery%20invite",
    });
    expect(mocks.issueHostedInvite).toHaveBeenCalledWith({
      channel: "web",
      memberId: "member_123",
    });
  });

  it("does not recover suspended checkout-stage hosted members", async () => {
    const request = createDashboardRecoveryRequest();
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: createHostedMember({
        billingStatus: HostedBillingStatus.not_started,
        suspendedAt: new Date("2026-06-24T00:00:00.000Z"),
      }),
    });

    const response = await dashboardRecoveryRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      redirectPath: null,
    });
    expect(mocks.issueHostedInvite).not.toHaveBeenCalled();
  });
});

function createDashboardRecoveryRequest(): Request {
  return new Request("https://join.example.test/api/hosted-onboarding/session/dashboard-recovery", {
    headers: {
      origin: "https://join.example.test",
    },
    method: "POST",
  });
}

function createHostedMember(input: {
  billingStatus?: HostedBillingStatus;
  suspendedAt?: Date | null;
} = {}) {
  return {
    billingStatus: input.billingStatus ?? HostedBillingStatus.active,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    id: "member_123",
    suspendedAt: input.suspendedAt ?? null,
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
  };
}
