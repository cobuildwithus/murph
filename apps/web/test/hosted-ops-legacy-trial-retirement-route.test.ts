import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireHostedOpsRequestAccess: vi.fn(),
  requireHostedStripeApiMode: vi.fn(),
  requireValidatedHostedStripeBillingPlanConfig: vi.fn(),
  runHostedLegacyPulseTrialRetirement: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ops/access", () => ({
  requireHostedOpsRequestAccess: mocks.requireHostedOpsRequestAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApiMode: mocks.requireHostedStripeApiMode,
  requireValidatedHostedStripeBillingPlanConfig:
    mocks.requireValidatedHostedStripeBillingPlanConfig,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/legacy-pulse-trial-retirement",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/legacy-pulse-trial-retirement")
    >("@/src/lib/hosted-onboarding/legacy-pulse-trial-retirement");
    return {
      ...actual,
      runHostedLegacyPulseTrialRetirement:
        mocks.runHostedLegacyPulseTrialRetirement,
    };
  },
);

import {
  HostedLegacyPulseTrialCandidateCountChangedError,
  HostedLegacyPulseTrialRetirementBlockedError,
} from "@/src/lib/hosted-onboarding/legacy-pulse-trial-retirement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

type RouteModule = typeof import("../app/api/ops/legacy-trial-retirement/route");

const prisma = { kind: "prisma" };
const stripe = { subscriptions: {} };
let route: RouteModule;

describe("hosted Ops legacy trial retirement route", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/legacy-trial-retirement/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.requireHostedOpsRequestAccess.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.requireHostedStripeApiMode.mockReturnValue({
      stripe,
      stripeLiveMode: true,
    });
    mocks.requireValidatedHostedStripeBillingPlanConfig.mockResolvedValue({
      billingPlanCode: "launch_monthly",
      priceId: "price_pulse",
      stripe,
    });
  });

  it("runs an authenticated aggregate dry-run with the live runtime config", async () => {
    const report = buildReport({ candidateCount: 2 });
    mocks.runHostedLegacyPulseTrialRetirement.mockResolvedValueOnce(report);
    const request = buildRequest({ operation: "dry-run" });

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedOpsRequestAccess).toHaveBeenCalledWith(request, {
      requireMutationOrigin: true,
    });
    expect(mocks.requireHostedStripeApiMode).toHaveBeenCalledOnce();
    expect(
      mocks.requireValidatedHostedStripeBillingPlanConfig,
    ).toHaveBeenCalledWith({
      billingPlanCode: "launch_monthly",
    });
    expect(mocks.runHostedLegacyPulseTrialRetirement).toHaveBeenCalledWith({
      apply: false,
      priceId: "price_pulse",
      prisma,
      stripe,
      stripeMode: "live",
    });
    await expect(response.json()).resolves.toEqual({
      operation: "dry-run",
      report,
    });
  });

  it("stops before billing work when Ops access is denied", async () => {
    mocks.requireHostedOpsRequestAccess.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_OPS_ACCESS_DENIED",
        httpStatus: 404,
        message: "Hosted ops route was not found.",
        retryable: false,
      }),
    );

    const response = await route.POST(buildRequest({ operation: "dry-run" }));

    expect(response.status).toBe(404);
    expect(mocks.requireHostedStripeApiMode).not.toHaveBeenCalled();
    expect(
      mocks.requireValidatedHostedStripeBillingPlanConfig,
    ).not.toHaveBeenCalled();
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.runHostedLegacyPulseTrialRetirement).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "HOSTED_OPS_ACCESS_DENIED" },
    });
  });

  it("rejects test Stripe in production before billing data is read", async () => {
    mocks.requireHostedStripeApiMode.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_USAGE_CREDIT_LIVE_STRIPE_REQUIRED",
        httpStatus: 500,
        message: "Hosted production billing requires live Stripe.",
        retryable: false,
      });
    });

    const response = await route.POST(buildRequest({ operation: "dry-run" }));

    expect(response.status).toBe(500);
    expect(
      mocks.requireValidatedHostedStripeBillingPlanConfig,
    ).not.toHaveBeenCalled();
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.runHostedLegacyPulseTrialRetirement).not.toHaveBeenCalled();
  });

  it("rejects an unreachable exact Price before billing data is read", async () => {
    mocks.requireValidatedHostedStripeBillingPlanConfig.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_BILLING_PRICE_UNAVAILABLE",
        httpStatus: 502,
        message: "Stripe billing is unavailable for this plan right now.",
        retryable: true,
      }),
    );

    const response = await route.POST(buildRequest({ operation: "dry-run" }));

    expect(response.status).toBe(502);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.runHostedLegacyPulseTrialRetirement).not.toHaveBeenCalled();
  });

  it("applies only the exact dry-run count and automatically verifies zero", async () => {
    const applied = buildReport({
      candidateCount: 2,
      mode: "apply",
      retiredCount: 2,
    });
    const verification = buildReport({ candidateCount: 0 });
    mocks.runHostedLegacyPulseTrialRetirement
      .mockResolvedValueOnce(applied)
      .mockResolvedValueOnce(verification);

    const response = await route.POST(buildRequest({
      expectedCandidates: 2,
      operation: "apply",
    }));

    expect(response.status).toBe(200);
    expect(mocks.runHostedLegacyPulseTrialRetirement).toHaveBeenNthCalledWith(
      1,
      {
        apply: true,
        expectedCandidates: 2,
        priceId: "price_pulse",
        prisma,
        stripe,
        stripeMode: "live",
      },
    );
    expect(mocks.runHostedLegacyPulseTrialRetirement).toHaveBeenNthCalledWith(
      2,
      {
        apply: false,
        priceId: "price_pulse",
        prisma,
        stripe,
        stripeMode: "live",
      },
    );
    await expect(response.json()).resolves.toEqual({
      converged: true,
      operation: "apply",
      report: applied,
      verification,
    });
  });

  it("rejects apply without a safe exact count before loading Stripe", async () => {
    const response = await route.POST(buildRequest({ operation: "apply" }));

    expect(response.status).toBe(400);
    expect(mocks.requireHostedStripeApiMode).not.toHaveBeenCalled();
    expect(
      mocks.requireValidatedHostedStripeBillingPlanConfig,
    ).not.toHaveBeenCalled();
    expect(mocks.runHostedLegacyPulseTrialRetirement).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_LEGACY_TRIAL_RETIREMENT_EXPECTED_COUNT_INVALID",
      },
    });
  });

  it("returns a conflict when the candidate count changed", async () => {
    mocks.runHostedLegacyPulseTrialRetirement.mockRejectedValueOnce(
      new HostedLegacyPulseTrialCandidateCountChangedError(2, 1),
    );

    const response = await route.POST(buildRequest({
      expectedCandidates: 2,
      operation: "apply",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_LEGACY_TRIAL_CANDIDATE_COUNT_CHANGED",
        details: {
          expectedCandidates: 2,
          observedCandidates: 1,
        },
      },
    });
  });

  it("returns a conflict without candidate detail when provider state blocks", async () => {
    mocks.runHostedLegacyPulseTrialRetirement.mockRejectedValueOnce(
      new HostedLegacyPulseTrialRetirementBlockedError(),
    );

    const response = await route.POST(buildRequest({ operation: "dry-run" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_LEGACY_TRIAL_RETIREMENT_BLOCKED",
      },
    });
  });
});

function buildRequest(body: Record<string, unknown>): Request {
  return new Request(
    "https://join.example.test/api/ops/legacy-trial-retirement",
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    },
  );
}

function buildReport(input: {
  candidateCount: number;
  mode?: "apply" | "dry-run";
  retiredCount?: number;
}) {
  return {
    alreadyRetiredCount: 0,
    candidateCount: input.candidateCount,
    missingProviderCount: 0,
    mode: input.mode ?? "dry-run",
    retiredCount: input.retiredCount ?? 0,
    stripeMode: "live" as const,
    subscriptionStatusCounts: input.candidateCount === 0
      ? {}
      : { canceled: input.candidateCount },
  };
}
