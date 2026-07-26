import {
  HostedBillingStatus,
  HostedUsageCreditPurchaseStatus,
} from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  readHostedGrowthDashboard,
  readHostedMessageVolumeTotal,
  startOfUtcDay,
} from "../src/lib/hosted-ops/growth-metrics";
import { HOSTED_MESSAGE_VOLUME_BASE } from "../src/lib/message-volume";
import { GrowthScorecard } from "../app/(dashboard)/ops/growth/growth-scorecard";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getHostedDashboardPageAuthSnapshot: vi.fn(),
  getPrisma: vi.fn(),
  hostedAccountGroup: {
    findMany: vi.fn(),
  },
  hostedGrowthDailySnapshot: {
    aggregate: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  hostedLinqDelivery: {
    count: vi.fn(),
  },
  hostedMailboxItem: {
    count: vi.fn(),
  },
  hostedMember: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  hostedMemberBillingRef: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  hostedUsageCreditPurchase: {
    count: vi.fn(),
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
  hostedLinqDelivery: mocks.hostedLinqDelivery,
  hostedMailboxItem: mocks.hostedMailboxItem,
  hostedMember: mocks.hostedMember,
  hostedMemberBillingRef: mocks.hostedMemberBillingRef,
  hostedUsageCreditPurchase: mocks.hostedUsageCreditPurchase,
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
    mocks.hostedLinqDelivery.count.mockResolvedValue(0);
    mocks.hostedMailboxItem.count.mockResolvedValue(0);
    mocks.hostedMember.count.mockResolvedValue(0);
    mocks.hostedUsageCreditPurchase.count.mockResolvedValue(0);
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
          planCapacities: [
            { billedQuantity: 2, planCode: "pulse" },
            { billedQuantity: 1, planCode: "edge" },
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
    expect(metrics.familyMrrUsdCents).toBe(2 * 700 + 1_900);
    expect(metrics.mrrUsdCents).toBe(800 + 2_000 + 2 * 700 + 1_900);
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
            currentTrialEndsAt: addUtcDays(now, -1),
          },
          billingStatus: HostedBillingStatus.active,
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
      rowCount: 3,
      trialStartRows: [
        {
          currentBillingPhase: "paid",
          member: {
            suspendedAt: null,
          },
          paidViaFamily: false,
          pulseTrialRedeemedAt: new Date("2026-06-21T12:00:00.000Z"),
        },
        {
          currentBillingPhase: null,
          member: {
            suspendedAt: null,
          },
          paidViaFamily: false,
          pulseTrialRedeemedAt: new Date("2026-06-22T12:00:00.000Z"),
        },
        {
          currentBillingPhase: null,
          member: {
            suspendedAt: null,
          },
          paidViaFamily: false,
          pulseTrialRedeemedAt: new Date("2026-06-20T12:00:00.000Z"),
        },
      ],
      windowEnd: now,
    });

    expect(rows[2]).toMatchObject({
      converted: 1,
      conversionPercent: 50,
      started: 3,
      stillTrialing: 1,
    });
  });

  it("keeps suspended paid mature trial rows in the cohort denominator without counting them converted", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const rows = buildTrialCohortRows({
      rowCount: 3,
      trialStartRows: [
        {
          currentBillingPhase: "paid",
          member: {
            suspendedAt: null,
          },
          paidViaFamily: false,
          pulseTrialRedeemedAt: new Date("2026-06-21T12:00:00.000Z"),
        },
        {
          currentBillingPhase: "paid",
          member: {
            suspendedAt: new Date("2026-07-01T00:00:00.000Z"),
          },
          paidViaFamily: false,
          pulseTrialRedeemedAt: new Date("2026-06-20T12:00:00.000Z"),
        },
      ],
      windowEnd: now,
    });

    expect(rows[2]).toMatchObject({
      converted: 1,
      conversionPercent: 50,
      started: 2,
      stillTrialing: 0,
    });
  });

  it("counts mature unsuspended family-paid trial rows as converted", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const rows = buildTrialCohortRows({
      rowCount: 2,
      trialStartRows: [
        {
          currentBillingPhase: null,
          member: {
            suspendedAt: null,
          },
          paidViaFamily: true,
          pulseTrialRedeemedAt: new Date("2026-06-24T12:00:00.000Z"),
        },
      ],
      windowEnd: now,
    });

    expect(rows[1]).toMatchObject({
      converted: 1,
      conversionPercent: 100,
      started: 1,
      stillTrialing: 0,
    });
  });

  it("does not count immature family-paid trial rows as still trialing", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const rows = buildTrialCohortRows({
      rowCount: 2,
      trialStartRows: [
        {
          currentBillingPhase: "paid",
          member: {
            suspendedAt: null,
          },
          paidViaFamily: false,
          pulseTrialRedeemedAt: new Date("2026-06-25T12:00:00.000Z"),
        },
        {
          currentBillingPhase: null,
          member: {
            suspendedAt: null,
          },
          paidViaFamily: true,
          pulseTrialRedeemedAt: new Date("2026-06-26T12:00:00.000Z"),
        },
      ],
      windowEnd: now,
    });

    expect(rows[1]).toMatchObject({
      converted: 2,
      conversionPercent: 100,
      started: 2,
      stillTrialing: 0,
    });
  });

  it("adds snapshot sums and live counts since the last snapshot to the base", async () => {
    const lastSnapshotDate = new Date("2026-07-23T00:00:00.000Z");
    mocks.hostedGrowthDailySnapshot.aggregate.mockResolvedValueOnce({
      _max: {
        snapshotDate: lastSnapshotDate,
      },
      _sum: {
        inboundMessagesPriorDay: 4_100,
        outboundMessagesPriorDay: 3_200,
      },
    });
    mocks.hostedMailboxItem.count.mockResolvedValueOnce(120);
    mocks.hostedLinqDelivery.count.mockResolvedValueOnce(80);

    await expect(
      readHostedMessageVolumeTotal(new Date("2026-07-23T18:00:00.000Z")),
    ).resolves.toBe(HOSTED_MESSAGE_VOLUME_BASE + 7_300 + 200);
    expect(mocks.hostedMailboxItem.count).toHaveBeenCalledWith({
      where: {
        kind: "conversation.message",
        occurredAt: {
          gte: lastSnapshotDate,
        },
      },
    });
    expect(mocks.hostedLinqDelivery.count).toHaveBeenCalledWith({
      where: {
        attemptedAt: {
          gte: lastSnapshotDate,
        },
        status: {
          in: ["accepted", "delivered", "sent_no_receipt_expected"],
        },
      },
    });
  });

  it("counts live messages from the start of today when no snapshot exists", async () => {
    mocks.hostedGrowthDailySnapshot.aggregate.mockResolvedValueOnce({
      _max: {
        snapshotDate: null,
      },
      _sum: {
        inboundMessagesPriorDay: 400,
        outboundMessagesPriorDay: null,
      },
    });
    await expect(
      readHostedMessageVolumeTotal(new Date("2026-07-23T18:00:00.000Z")),
    ).resolves.toBe(HOSTED_MESSAGE_VOLUME_BASE + 400);
    expect(mocks.hostedMailboxItem.count).toHaveBeenCalledWith({
      where: {
        kind: "conversation.message",
        occurredAt: {
          gte: new Date("2026-07-23T00:00:00.000Z"),
        },
      },
    });

    mocks.hostedGrowthDailySnapshot.aggregate.mockRejectedValueOnce(
      new Error("db down"),
    );
    await expect(
      readHostedMessageVolumeTotal(new Date("2026-07-23T18:00:00.000Z")),
    ).resolves.toBe(HOSTED_MESSAGE_VOLUME_BASE);
  });

  it("serves the message volume total with a cacheable response", async () => {
    mocks.hostedGrowthDailySnapshot.aggregate.mockResolvedValueOnce({
      _max: {
        snapshotDate: new Date("2026-07-23T00:00:00.000Z"),
      },
      _sum: {
        inboundMessagesPriorDay: 4_100,
        outboundMessagesPriorDay: 3_200,
      },
    });
    const route = await import("../app/api/message-volume/route");

    const response = await route.GET();

    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    await expect(response.json()).resolves.toEqual({
      total: HOSTED_MESSAGE_VOLUME_BASE + 7_300,
    });
  });

  it("counts own-paid or family-paid members in the mature converted count query", async () => {
    queueCurrentMetricMocks();
    queueCurrentMetricMocks();
    mocks.hostedMember.count
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(3);
    mocks.hostedUsageCreditPurchase.count.mockResolvedValueOnce(12);
    mocks.hostedGrowthDailySnapshot.upsert.mockResolvedValueOnce(
      snapshotRow("2026-07-06", 2_900),
    );
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);

    const markup = renderToStaticMarkup(await growthPage.default());

    expect(markup).toContain("MRR growth per week");
    expect(markup).toMatch(
      /Weekly active member growth<\/div><div[^>]*>\+100%<\/div><div[^>]*>6 direct members messaged<\/div>/u,
    );
    expect(markup).toMatch(
      /Fulfilled top-ups · lifetime<\/span><span[^>]*>12<\/span>/u,
    );
    expect(markup).toMatch(
      /Fulfilled usage top-ups \(lifetime\)<\/td><td[^>]*>12<\/td><td[^>]*>One-time<\/td>/u,
    );
    expect(mocks.hostedMemberBillingRef.findMany.mock.calls[0]?.[0]).toMatchObject({
      select: {
        member: {
          select: {
            accountGroupMemberships: {
              select: {
                id: true,
              },
              take: 1,
              where: {
                group: {
                  billingRef: {
                    is: {
                      billedSeatCount: {
                        gte: 1,
                      },
                      currentBillingPhase: "paid",
                    },
                  },
                  billingStatus: HostedBillingStatus.active,
                  suspendedAt: null,
                },
                status: "active",
              },
            },
            suspendedAt: true,
          },
        },
      },
    });
    expect(mocks.hostedMemberBillingRef.count.mock.calls[1]?.[0]).toMatchObject({
      where: {
        member: {
          OR: [
            {
              billingRef: {
                is: {
                  currentBillingPhase: "paid",
                },
              },
            },
            {
              accountGroupMemberships: {
                some: {
                  group: {
                    billingRef: {
                      is: {
                        billedSeatCount: {
                          gte: 1,
                        },
                        currentBillingPhase: "paid",
                      },
                    },
                    billingStatus: HostedBillingStatus.active,
                    suspendedAt: null,
                  },
                  status: "active",
                },
              },
            },
          ],
          suspendedAt: null,
        },
        pulseTrialRedeemedAt: {
          lt: expect.any(Date),
        },
      },
    });
  });

  it("excludes synthetic runtime members from total and new member count queries", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const realMemberWhere = {
      hostedGroupRuntime: null,
      threadContainer: null,
    };
    queueCurrentMetricMocks();
    mocks.hostedMember.findMany.mockResolvedValueOnce([
      { createdAt: new Date("2026-07-06T11:00:00.000Z") },
    ]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await readHostedGrowthDashboard(now);

    expect(mocks.hostedMember.count.mock.calls[0]?.[0]).toMatchObject({
      where: realMemberWhere,
    });
    expect(mocks.hostedMember.findMany.mock.calls[2]?.[0]).toMatchObject({
      select: {
        createdAt: true,
      },
      where: {
        ...realMemberWhere,
        createdAt: {
          gte: expect.any(Date),
          lte: now,
        },
      },
    });
  });

  it("returns no percent change when the previous window is zero", () => {
    expect(calculatePercentChange(4, 0)).toBeNull();
    expect(calculatePercentChange(6, 3)).toBe(100);
  });

  it("reads weekly active members and counts only fulfilled usage top-ups", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    queueCurrentMetricMocks();
    mocks.hostedMember.count
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(3);
    mocks.hostedUsageCreditPurchase.count.mockResolvedValueOnce(12);
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.activeMembers).toEqual({
      trailing7Days: 6,
      wowPercent: 100,
    });
    expect(dashboard.usageTopUps).toEqual({
      totalFulfilled: 12,
    });
    expect(mocks.hostedUsageCreditPurchase.count).toHaveBeenCalledWith({
      where: {
        status: HostedUsageCreditPurchaseStatus.fulfilled,
      },
    });
    expect(mocks.hostedMember.count.mock.calls[5]?.[0]).toMatchObject({
      where: {
        hostedGroupRuntime: null,
        hostedMailboxItems: {
          some: {
            kind: "conversation.message",
            occurredAt: {
              gte: new Date("2026-06-30T00:00:00.000Z"),
              lt: new Date("2026-07-07T00:00:00.000Z"),
            },
          },
        },
        threadContainer: null,
      },
    });
    expect(mocks.hostedMember.count.mock.calls[6]?.[0]).toMatchObject({
      where: {
        hostedGroupRuntime: null,
        hostedMailboxItems: {
          some: {
            kind: "conversation.message",
            occurredAt: {
              gte: new Date("2026-06-23T00:00:00.000Z"),
              lt: new Date("2026-06-30T00:00:00.000Z"),
            },
          },
        },
        threadContainer: null,
      },
    });
  });

  it("leads the scorecard with weekly revenue growth and keeps usage context honest", () => {
    const scorecardProps = {
      activeMembers: { trailing7Days: 24, wowPercent: 9.1 },
      conversion: { converted: 8, matureStarted: 20, percent: 40 },
      mrrUsdCents: 8_400,
      newMembers: { trailing7Days: 17, wowPercent: 21.4 },
      payingCustomers: 31,
      payingCustomersWowPercent: 6.9,
      trialStarts: { trailing7Days: 11, wowPercent: 10 },
      usageTopUps: { totalFulfilled: 12 },
    };
    const markup = renderToStaticMarkup(
      createElement(GrowthScorecard, {
        ...scorecardProps,
        mrrWowPercent: 9.9,
      }),
    );

    expect(markup.indexOf("MRR growth per week")).toBeLessThan(
      markup.indexOf("Current MRR"),
    );
    expect(markup).toContain("+9.9%");
    expect(markup).toMatch(/text-red-700[^>]*>\+9\.9%/u);
    expect(markup).toContain("Below 10% target");
    expect(markup).toContain("24 direct members messaged");
    expect(markup).toContain("Usage pulse, not a retention cohort");
    expect(markup).toContain("8 of 20 mature trials");

    const targetHitMarkup = renderToStaticMarkup(
      createElement(GrowthScorecard, {
        ...scorecardProps,
        mrrWowPercent: 10,
      }),
    );
    expect(targetHitMarkup).toMatch(/text-primary[^>]*>\+10%/u);
    expect(targetHitMarkup).toContain("10% target hit");
    expect(targetHitMarkup).toContain("Fulfilled top-ups · lifetime");
    expect(targetHitMarkup).toContain(">12<");

    const roundedTargetHitMarkup = renderToStaticMarkup(
      createElement(GrowthScorecard, {
        ...scorecardProps,
        mrrWowPercent: 9.96,
      }),
    );
    expect(roundedTargetHitMarkup).toMatch(/text-primary[^>]*>\+10%/u);
    expect(roundedTargetHitMarkup).toContain("10% target hit");

    const roundedBelowTargetMarkup = renderToStaticMarkup(
      createElement(GrowthScorecard, {
        ...scorecardProps,
        mrrWowPercent: 9.94,
      }),
    );
    expect(roundedBelowTargetMarkup).toMatch(/text-red-700[^>]*>\+9\.9%/u);
    expect(roundedBelowTargetMarkup).toContain("Below 10% target");

    const noBaselineMarkup = renderToStaticMarkup(
      createElement(GrowthScorecard, {
        ...scorecardProps,
        mrrWowPercent: null,
      }),
    );
    expect(noBaselineMarkup).toMatch(/text-muted-foreground[^>]*>N\/A</u);
    expect(noBaselineMarkup).toContain("No weekly baseline");
    expect(noBaselineMarkup).not.toContain(
      "Closest daily snapshot from six to eight days ago",
    );
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

  it("records prior-day message counts in the snapshot", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.count.mockResolvedValueOnce(42);
    mocks.hostedLinqDelivery.count.mockResolvedValueOnce(57);
    mocks.hostedGrowthDailySnapshot.upsert.mockResolvedValueOnce(
      snapshotRow("2026-07-06", 2_900),
    );

    await captureHostedGrowthDailySnapshot(now);

    expect(mocks.hostedMailboxItem.count.mock.calls[0]?.[0]).toEqual({
      where: {
        kind: "conversation.message",
        occurredAt: {
          gte: new Date("2026-07-05T00:00:00.000Z"),
          lt: new Date("2026-07-06T00:00:00.000Z"),
        },
      },
    });
    expect(mocks.hostedLinqDelivery.count.mock.calls[0]?.[0]).toEqual({
      where: {
        attemptedAt: {
          gte: new Date("2026-07-05T00:00:00.000Z"),
          lt: new Date("2026-07-06T00:00:00.000Z"),
        },
        status: {
          in: ["accepted", "delivered", "sent_no_receipt_expected"],
        },
      },
    });
    const upsertArg = mocks.hostedGrowthDailySnapshot.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create).toMatchObject({
      inboundMessagesPriorDay: 42,
      outboundMessagesPriorDay: 57,
    });
    expect(upsertArg?.update).toMatchObject({
      inboundMessagesPriorDay: 42,
      outboundMessagesPriorDay: 57,
    });
  });

  it("anchors the prior-day message window to the UTC day at exactly midnight", async () => {
    const now = new Date("2026-07-06T00:00:00.000Z");
    queueCurrentMetricMocks();
    mocks.hostedGrowthDailySnapshot.upsert.mockResolvedValueOnce(
      snapshotRow("2026-07-06", 2_900),
    );

    await captureHostedGrowthDailySnapshot(now);

    expect(mocks.hostedMailboxItem.count.mock.calls[0]?.[0]?.where.occurredAt).toEqual({
      gte: new Date("2026-07-05T00:00:00.000Z"),
      lt: new Date("2026-07-06T00:00:00.000Z"),
    });
    expect(mocks.hostedLinqDelivery.count.mock.calls[0]?.[0]?.where.attemptedAt).toEqual({
      gte: new Date("2026-07-05T00:00:00.000Z"),
      lt: new Date("2026-07-06T00:00:00.000Z"),
    });
    expect(
      mocks.hostedGrowthDailySnapshot.upsert.mock.calls[0]?.[0].where.snapshotDate,
    ).toEqual(new Date("2026-07-06T00:00:00.000Z"));
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
    expect.soft(mocks.hostedMember.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        billingRef: {
          is: {
            currentBillingPhase: "paid",
          },
        },
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
    });
    expect(mocks.hostedAccountGroup.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        billingRef: {
          is: {
            billedSeatCount: {
              gte: 1,
            },
            currentBillingPhase: "paid",
          },
        },
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
      select: {
        memberships: {
          where: {
            member: {
              suspendedAt: null,
            },
            status: "active",
          },
        },
      },
    });
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
      planCapacities: [{ billedQuantity: 1, planCode: "pulse" }],
    },
  ]);
}

function snapshotRow(date: string, mrrUsdCents: number) {
  return {
    capturedAt: new Date(`${date}T00:05:00.000Z`),
    coveredMembers: 3,
    inboundMessagesPriorDay: 0,
    mrrUsdCents,
    outboundMessagesPriorDay: 0,
    payingCustomers: 3,
    payingFamilyGroups: 1,
    payingFamilySeats: 1,
    payingIndividuals: 2,
    snapshotDate: new Date(`${date}T00:00:00.000Z`),
    totalMembers: 4,
    trialingMembers: 1,
  };
}
