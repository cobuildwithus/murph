import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireHostedOpsRequestAccess: vi.fn(),
  requireHostedStripeBillingPlanConfig: vi.fn(),
  runHostedLegacyPulseTrialRetirement: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ops/access", () => ({
  requireHostedOpsRequestAccess: mocks.requireHostedOpsRequestAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeBillingPlanConfig:
    mocks.requireHostedStripeBillingPlanConfig,
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
    mocks.requireHostedStripeBillingPlanConfig.mockReturnValue({
      billingPlanCode: "launch_monthly",
      priceId: "price_pulse",
      stripe,
      stripeLiveMode: true,
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
    expect(mocks.requireHostedStripeBillingPlanConfig).toHaveBeenCalledWith({
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
    expect(mocks.requireHostedStripeBillingPlanConfig).not.toHaveBeenCalled();
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
