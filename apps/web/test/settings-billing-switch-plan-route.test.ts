import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  scheduleHostedBillingPlanSwitch: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest:
    mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service", () => ({
  scheduleHostedBillingPlanSwitch: mocks.scheduleHostedBillingPlanSwitch,
}));

type BillingSwitchRouteModule =
  typeof import("../app/api/settings/billing/switch-plan/route");

let billingSwitchRoute: BillingSwitchRouteModule;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.getPrisma.mockReturnValue({ label: "test-prisma" });
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      billingStatus: "active",
      id: "member_123",
      suspendedAt: null,
    },
  });
  mocks.scheduleHostedBillingPlanSwitch.mockResolvedValue({
    effectiveAt: "2026-08-12T04:00:00.000Z",
    scheduledBillingPlanCode: "launch_group_monthly",
    status: "scheduled",
  });

  billingSwitchRoute =
    await import("../app/api/settings/billing/switch-plan/route");
});

test("schedules an authenticated member to Group", async () => {
  const response = await billingSwitchRoute.POST(
    new Request("https://example.test/api/settings/billing/switch-plan", {
      body: JSON.stringify({
        targetPlanCode: "launch_group_monthly",
      }),
      headers: {
        origin: "https://example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.scheduleHostedBillingPlanSwitch).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: { label: "test-prisma" },
    targetPlanCode: "launch_group_monthly",
  });
});

test("schedules an authenticated member down to Edge", async () => {
  mocks.scheduleHostedBillingPlanSwitch.mockResolvedValue({
    effectiveAt: "2026-09-01T00:00:00.000Z",
    scheduledBillingPlanCode: "launch_edge_monthly",
    status: "scheduled",
  });

  const response = await billingSwitchRoute.POST(
    new Request("https://example.test/api/settings/billing/switch-plan", {
      body: JSON.stringify({
        targetPlanCode: "launch_edge_monthly",
      }),
      headers: {
        origin: "https://example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.scheduleHostedBillingPlanSwitch).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: { label: "test-prisma" },
    targetPlanCode: "launch_edge_monthly",
  });
});

test("rejects an unsupported scheduled target", async () => {
  const response = await billingSwitchRoute.POST(
    new Request("https://example.test/api/settings/billing/switch-plan", {
      body: JSON.stringify({
        targetPlanCode: "launch_max_monthly",
      }),
      headers: {
        origin: "https://example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.scheduleHostedBillingPlanSwitch).not.toHaveBeenCalled();
});

test("rejects cross-origin mutations before reading the session", async () => {
  mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
      httpStatus: 403,
      message: "Invalid request origin.",
    });
  });

  const response = await billingSwitchRoute.POST(
    new Request("https://example.test/api/settings/billing/switch-plan", {
      body: JSON.stringify({
        targetPlanCode: "launch_group_monthly",
      }),
      headers: {
        origin: "https://other.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
  expect(mocks.scheduleHostedBillingPlanSwitch).not.toHaveBeenCalled();
});
