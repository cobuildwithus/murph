import { HostedBillingStatus } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  issueHostedInviteTx: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-onboarding/invite-service", () => ({
  issueHostedInviteTx: mocks.issueHostedInviteTx,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/hosted-onboarding/shared")>();
  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

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
    const tx = { tx: true };
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn((callback) => callback(tx)),
    });
    mocks.issueHostedInviteTx.mockResolvedValue({
      inviteCode: "recovery invite",
    });
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMemberCoreState.mockResolvedValue(createHostedMember());
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
    expect(mocks.issueHostedInviteTx).not.toHaveBeenCalled();
  });

  it.each([
    HostedBillingStatus.incomplete,
    HostedBillingStatus.not_started,
  ])("returns a join redirect for %s hosted members", async (billingStatus) => {
    const request = createDashboardRecoveryRequest();
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: createHostedMember({
        billingStatus,
      }),
    });
    mocks.readHostedMemberCoreState.mockResolvedValueOnce(createHostedMember({
      billingStatus,
    }));

    const response = await dashboardRecoveryRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      redirectPath: "/join/recovery%20invite",
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith({ tx: true }, "member_123");
    expect(mocks.readHostedMemberCoreState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { tx: true },
    });
    expect(mocks.issueHostedInviteTx).toHaveBeenCalledWith({
      channel: "web",
      memberId: "member_123",
      prisma: { tx: true },
    });
  });

  it("does not recover past-due hosted members", async () => {
    const request = createDashboardRecoveryRequest();
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: createHostedMember({
        billingStatus: HostedBillingStatus.past_due,
      }),
    });
    mocks.readHostedMemberCoreState.mockResolvedValueOnce(createHostedMember({
      billingStatus: HostedBillingStatus.past_due,
    }));

    const response = await dashboardRecoveryRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      redirectPath: null,
    });
    expect(mocks.issueHostedInviteTx).not.toHaveBeenCalled();
  });

  it("does not recover suspended checkout-stage hosted members", async () => {
    const request = createDashboardRecoveryRequest();
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: createHostedMember({
        billingStatus: HostedBillingStatus.not_started,
        suspendedAt: new Date("2026-06-24T00:00:00.000Z"),
      }),
    });
    mocks.readHostedMemberCoreState.mockResolvedValueOnce(createHostedMember({
      billingStatus: HostedBillingStatus.not_started,
      suspendedAt: new Date("2026-06-24T00:00:00.000Z"),
    }));

    const response = await dashboardRecoveryRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      redirectPath: null,
    });
    expect(mocks.issueHostedInviteTx).not.toHaveBeenCalled();
  });

  it("does not issue an invite when the locked member state is no longer checkout-stage", async () => {
    const request = createDashboardRecoveryRequest();
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: createHostedMember({
        billingStatus: HostedBillingStatus.incomplete,
      }),
    });
    mocks.readHostedMemberCoreState.mockResolvedValueOnce(createHostedMember({
      billingStatus: HostedBillingStatus.active,
    }));

    const response = await dashboardRecoveryRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      redirectPath: null,
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith({ tx: true }, "member_123");
    expect(mocks.issueHostedInviteTx).not.toHaveBeenCalled();
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
