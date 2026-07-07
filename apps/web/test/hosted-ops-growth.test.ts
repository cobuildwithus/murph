import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import {
  addUtcDays,
  buildTrialCohortRows,
  calculateHostedGrowthCurrentMetrics,
  calculateHostedTrialMetrics,
  calculatePercentChange,
  captureHostedGrowthDailySnapshot,
  findComparableSnapshot,
  startOfUtcDay,
} from "../src/lib/hosted-ops/growth-metrics";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getHostedDashboardPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(),
  hostedAccountGroup: {
    findMany: vi.fn(),
  },
  hostedGrowthDailySnapshot: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  hostedMember: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  hostedMemberBillingRef: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  requireActiveHostedAppSession: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  requireVercelCronRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSession: mocks.requireActiveHostedAppSession,
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedDashboardPageAuthSnapshot: mocks.getHostedDashboardPageAuthSnapshot,
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  }),
}));

type GrowthPageModule = typeof import("../app/(dashboard)/ops/growth/page");
type GrowthCronRouteModule =
  typeof import("../app/api/internal/hosted-growth/snapshot/cron/route");

let growthPage: GrowthPageModule;
let growthCronRoute: GrowthCronRouteModule;

const originalHostedOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;
const prisma = {
  hostedAccountGroup: mocks.hostedAccountGroup,
  hostedGrowthDailySnapshot: mocks.hostedGrowthDailySnapshot,
  hostedMember: mocks.hostedMember,
  hostedMemberBillingRef: mocks.hostedMemberBillingRef,
};

const zeroStatusCounts = {
  canceled: 0,
  past_due: 0,
  paused: 0,
  unpaid: 0,
};

describe("hosted ops growth metrics", () => {
  beforeAll(async () => {
    growthPage = await import("../app/(dashboard)/ops/growth/page");
    growthCronRoute = await import(
      "../app/api/internal/hosted-growth/snapshot/cron/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_OPS_MEMBER_IDS = "member_ops";
    mocks.getHostedDashboardPageAuthSnapshot.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.requireActiveHostedAppSession.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
  });

  afterEach(() => {
    if (originalHostedOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalHostedOpsMemberIds;
    }
  });

  it("counts paid individuals, family seats, covered members, and unpriced paid members", () => {
    const metrics = calculateHostedGrowthCurrentMetrics({
      payingFamilyGroups: [
        {
          billingRef: {
            billedSeatCount: 3,
            currentBillingPhase: "paid",
          },
          id: "group_family",
          memberships: [
            { memberId: "member_edge" },
            { memberId: "member_family_child" },
          ],
        },
      ],
      payingIndividuals: [
        {
          billingRef: {
            currentBillingPhase: "paid",
            currentBillingPlanCode: "launch_monthly",
          },
          id: "member_pulse",
        },
        {
          billingRef: {
            currentBillingPhase: "paid",
            currentBillingPlanCode: "launch_edge_monthly",
          },
          id: "member_edge",
        },
        {
          billingRef: {
            currentBillingPhase: "paid",
            currentBillingPlanCode: "retired_plan",
          },
          id: "member_unknown",
        },
      ],
      statusCounts: zeroStatusCounts,
      totalMembers: 4,
      trialCandidates: [],
      windowEnd: new Date("2026-07-06T12:00:00.000Z"),
    });

    expect(metrics.pulsePaidIndividuals).toBe(1);
    expect(metrics.edgePaidIndividuals).toBe(1);
    expect(metrics.payingIndividuals).toBe(3);
    expect(metrics.payingFamilyGroups).toBe(1);
    expect(metrics.payingFamilySeats).toBe(3);
    expect(metrics.coveredMembers).toBe(4);
    expect(metrics.mrrUsdCents).toBe(800 + 2_000 + 3 * 700);
    expect(metrics.unpricedPaidMembers).toBe(1);
  });

  it("uses shared trial state logic for active or paused unsuspended trial members", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");

    expect(calculateHostedTrialMetrics({
      rows: [
        {
          billingRef: {
            currentBillingPhase: "trial",
            currentCheckoutOffer: null,
            currentTrialEndsAt: addUtcDays(now, 2),
          },
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
        {
          billingRef: {
            currentBillingPhase: null,
            currentCheckoutOffer: "pulse_trial_7d",
            currentTrialEndsAt: addUtcDays(now, 5),
          },
          billingStatus: HostedBillingStatus.paused,
          suspendedAt: null,
        },
        {
          billingRef: {
            currentBillingPhase: "trial",
            currentCheckoutOffer: null,
            currentTrialEndsAt: addUtcDays(now, 1),
          },
          billingStatus: HostedBillingStatus.canceled,
          suspendedAt: null,
        },
        {
          billingRef: {
            currentBillingPhase: "trial",
            currentCheckoutOffer: null,
            currentTrialEndsAt: addUtcDays(now, 1),
          },
          billingStatus: HostedBillingStatus.active,
          suspendedAt: now,
        },
      ],
      windowEnd: now,
    })).toEqual({
      trialingMembers: 2,
      trialsEndingSoon: 1,
    });
  });

  it("keeps exact trial maturity boundary rows immature", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const rows = buildTrialCohortRows({
      rowCount: 2,
      trialStartRows: [
        {
          currentBillingPhase: "paid",
          pulseTrialRedeemedAt: new Date("2026-06-25T12:00:00.000Z"),
        },
        {
          currentBillingPhase: null,
          pulseTrialRedeemedAt: new Date("2026-06-26T12:00:00.000Z"),
        },
        {
          currentBillingPhase: null,
          pulseTrialRedeemedAt: new Date("2026-06-24T12:00:00.000Z"),
        },
      ],
      windowEnd: now,
    });

    expect(rows[1]).toMatchObject({
      converted: 1,
      conversionPercent: 50,
      started: 3,
      stillTrialing: 1,
    });
  });

  it("returns no percent change when the previous window is zero", () => {
    expect(calculatePercentChange(4, 0)).toBeNull();
    expect(calculatePercentChange(6, 3)).toBe(100);
  });

  it("selects the closest six to eight day snapshot for live comparisons", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const selected = findComparableSnapshot(
      [
        snapshotRow("2026-06-28", 900),
        snapshotRow("2026-06-29", 1_000),
        snapshotRow("2026-06-30", 1_100),
      ],
      now,
    );

    expect(selected?.mrrUsdCents).toBe(1_000);
  });

  it("upserts one daily snapshot per UTC date", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    queueCurrentMetricMocks();
    queueCurrentMetricMocks();
    mocks.hostedGrowthDailySnapshot.upsert
      .mockResolvedValueOnce(snapshotRow("2026-07-06", 2_900))
      .mockResolvedValueOnce(snapshotRow("2026-07-06", 2_900));

    await captureHostedGrowthDailySnapshot(now);
    await captureHostedGrowthDailySnapshot(addUtcDays(now, 0));

    expect(mocks.hostedGrowthDailySnapshot.upsert).toHaveBeenCalledTimes(2);
    expect(
      mocks.hostedGrowthDailySnapshot.upsert.mock.calls[0]?.[0].where.snapshotDate,
    ).toEqual(startOfUtcDay(now));
    expect(
      mocks.hostedGrowthDailySnapshot.upsert.mock.calls[1]?.[0].where.snapshotDate,
    ).toEqual(startOfUtcDay(now));
  });

  it("fails closed before reading growth data when page ops access is missing", async () => {
    delete process.env.HOSTED_OPS_MEMBER_IDS;

    await expect(growthPage.default()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("requires cron auth before creating a growth snapshot", async () => {
    mocks.requireVercelCronRequest.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "VERCEL_CRON_UNAUTHORIZED",
        httpStatus: 401,
        message: "Unauthorized Vercel cron request.",
      });
    });

    const request = new Request(
      "https://join.example.test/api/internal/hosted-growth/snapshot/cron",
    );
    const response = await growthCronRoute.GET(request);

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(request);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.hostedGrowthDailySnapshot.upsert).not.toHaveBeenCalled();
  });

  it("captures the snapshot after cron auth succeeds", async () => {
    queueCurrentMetricMocks();
    mocks.hostedGrowthDailySnapshot.upsert.mockResolvedValueOnce(
      snapshotRow("2026-07-06", 2_900),
    );

    const request = new Request(
      "https://join.example.test/api/internal/hosted-growth/snapshot/cron",
    );
    const response = await growthCronRoute.GET(request);

    expect(response.status).toBe(200);
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(request);
    expect(mocks.getPrisma).toHaveBeenCalledTimes(1);
    expect(mocks.hostedGrowthDailySnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(
      mocks.requireVercelCronRequest.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.getPrisma.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    await expect(response.json()).resolves.toMatchObject({
      snapshot: {
        mrrUsdCents: 2_900,
        snapshotDate: "2026-07-06T00:00:00.000Z",
      },
    });
  });
});

function queueCurrentMetricMocks() {
  mocks.hostedMember.count
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0);
  mocks.hostedMember.findMany
    .mockResolvedValueOnce([
      {
        billingRef: {
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_monthly",
        },
        id: "member_pulse",
      },
      {
        billingRef: {
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_edge_monthly",
        },
        id: "member_edge",
      },
    ])
    .mockResolvedValueOnce([
      {
        billingRef: {
          currentBillingPhase: "trial",
          currentCheckoutOffer: null,
          currentTrialEndsAt: new Date("2026-07-08T12:00:00.000Z"),
        },
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
    ]);
  mocks.hostedAccountGroup.findMany.mockResolvedValueOnce([
    {
      billingRef: {
        billedSeatCount: 1,
        currentBillingPhase: "paid",
      },
      id: "group_family",
      memberships: [{ memberId: "member_family" }],
    },
  ]);
}

function snapshotRow(date: string, mrrUsdCents: number) {
  return {
    capturedAt: new Date(`${date}T00:05:00.000Z`),
    coveredMembers: 3,
    mrrUsdCents,
    payingCustomers: 3,
    payingFamilyGroups: 1,
    payingFamilySeats: 1,
    payingIndividuals: 2,
    snapshotDate: new Date(`${date}T00:00:00.000Z`),
    totalMembers: 4,
    trialingMembers: 1,
  };
}
