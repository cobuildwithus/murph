import { HostedBillingStatus } from "@prisma/client";
import {
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
  createHostedExecutionGroupReactionEventId,
  formatHostedExecutionGroupReactionEventText,
  HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
  HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
  type HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
import {
  createHostedTelegramUserLookupKeyReadCandidates,
} from "../src/lib/hosted-onboarding/contact-privacy";
import {
  createHostedLinqParticipantContact,
  createHostedLinqParticipantContactLookupKeyReadCandidates,
} from "../src/lib/hosted-onboarding/linq-participant-contact";
import {
  addUtcDays,
  buildHostedGrowthMessageSeries,
  buildHostedGrowthMonthlyRevenueSeries,
  buildHostedGrowthReferralLinkUsage,
  buildHostedGrowthTrialStartAttribution,
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
  decodeHostedMailboxStoredPayload: vi.fn(),
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
  hostedGrowthAggregate: {
    findUniqueOrThrow: vi.fn(),
  },
  hostedInvite: {
    findMany: vi.fn(),
  },
  hostedLinqDelivery: {
    count: vi.fn(),
  },
  hostedMailboxItem: {
    count: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  hostedMemberEmailAuthorization: {
    findMany: vi.fn(),
  },
  hostedMemberIdentity: {
    findMany: vi.fn(),
  },
  hostedMemberRouting: {
    findMany: vi.fn(),
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

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  decodeHostedMailboxStoredPayload: mocks.decodeHostedMailboxStoredPayload,
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
  hostedGrowthAggregate: mocks.hostedGrowthAggregate,
  hostedGrowthDailySnapshot: mocks.hostedGrowthDailySnapshot,
  hostedInvite: mocks.hostedInvite,
  hostedLinqDelivery: mocks.hostedLinqDelivery,
  hostedMailboxItem: mocks.hostedMailboxItem,
  hostedMemberEmailAuthorization: mocks.hostedMemberEmailAuthorization,
  hostedMemberIdentity: mocks.hostedMemberIdentity,
  hostedMemberRouting: mocks.hostedMemberRouting,
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
    mocks.hostedMailboxItem.findMany.mockResolvedValue([]);
    mocks.hostedMailboxItem.groupBy.mockResolvedValue([]);
    mocks.hostedMemberEmailAuthorization.findMany.mockResolvedValue([]);
    mocks.hostedMemberIdentity.findMany.mockResolvedValue([]);
    mocks.hostedMemberRouting.findMany.mockResolvedValue([]);
    mocks.decodeHostedMailboxStoredPayload.mockImplementation(async (input: {
      payloadInlineCiphertext: unknown;
    }) => {
      const payload = input.payloadInlineCiphertext;
      return typeof payload === "string" ? JSON.parse(payload) : null;
    });
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValue({
      trackedFulfilledUsageTopUps: 0,
    });
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValue([]);
    mocks.hostedInvite.findMany.mockResolvedValue([]);
    mocks.hostedUsageCreditPurchase.findMany.mockResolvedValue([]);
    mocks.hostedGrowthDailySnapshot.aggregate.mockResolvedValue({
      _count: {
        inboundMessagesPriorDay: 0,
        outboundMessagesPriorDay: 0,
      },
      _max: {
        snapshotDate: null,
      },
      _sum: {
        inboundMessagesPriorDay: null,
        outboundMessagesPriorDay: null,
      },
    });
    mocks.hostedMember.count.mockResolvedValue(0);
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
            billedSeatCount: 4,
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
            { billedQuantity: 1, planCode: "max" },
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
            currentBillingPlanCode: "launch_max_monthly",
          },
          id: "member_max",
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
      totalMembers: 5,
      trialCandidates: [],
      windowEnd: new Date("2026-07-06T12:00:00.000Z"),
    });

    expect(metrics.pulsePaidIndividuals).toBe(1);
    expect(metrics.edgePaidIndividuals).toBe(1);
    expect(metrics.maxPaidIndividuals).toBe(1);
    expect(metrics.maxMrrUsdCents).toBe(5_000);
    expect(metrics.payingIndividuals).toBe(4);
    expect(metrics.payingFamilyGroups).toBe(1);
    expect(metrics.payingFamilySeats).toBe(4);
    expect(metrics.coveredMembers).toBe(5);
    expect(metrics.familyMrrUsdCents).toBe(2 * 700 + 1_900 + 4_900);
    expect(metrics.mrrUsdCents)
      .toBe(800 + 2_000 + 5_000 + 2 * 700 + 1_900 + 4_900);
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

  it("keeps trial-start attribution explicit and orders recent starts newest first", () => {
    const attribution = buildHostedGrowthTrialStartAttribution({
      endExclusive: new Date("2026-08-01T00:00:00.000Z"),
      limit: 4,
      rows: [
        {
          memberCreatedAt: new Date("2026-07-30T09:00:00.000Z"),
          phoneHint: "*** 0194",
          pulseTrialRedeemedAt: new Date("2026-07-30T09:05:00.000Z"),
          pulseTrialStartSource: "linq_instant_start",
        },
        {
          memberCreatedAt: new Date("2026-06-03T11:00:00.000Z"),
          phoneHint: null,
          pulseTrialRedeemedAt: new Date("2026-07-29T16:00:00.000Z"),
          pulseTrialStartSource: "companion_onboarding",
        },
        {
          memberCreatedAt: new Date("2026-06-12T10:00:00.000Z"),
          phoneHint: null,
          pulseTrialRedeemedAt: new Date("2026-07-28T18:00:00.000Z"),
          pulseTrialStartSource: null,
        },
        {
          memberCreatedAt: new Date("2026-07-27T10:00:00.000Z"),
          phoneHint: "*** 4827",
          pulseTrialRedeemedAt: new Date("2026-07-27T10:06:00.000Z"),
          pulseTrialStartSource: "web_onboarding",
        },
        {
          memberCreatedAt: new Date("2026-06-01T10:00:00.000Z"),
          phoneHint: "*** 4421",
          pulseTrialRedeemedAt: new Date("2026-06-30T18:00:00.000Z"),
          pulseTrialStartSource: "web_onboarding",
        },
      ],
      startInclusive: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(attribution).toEqual({
      counts: {
        companion_onboarding: 1,
        linq_instant_start: 1,
        unknown: 1,
        web_onboarding: 1,
      },
      recent: [
        {
          memberCreatedAt: "2026-07-30T09:00:00.000Z",
          phoneHint: "*** 0194",
          pulseTrialStartSource: "linq_instant_start",
          trialStartedAt: "2026-07-30T09:05:00.000Z",
        },
        {
          memberCreatedAt: "2026-06-03T11:00:00.000Z",
          phoneHint: null,
          pulseTrialStartSource: "companion_onboarding",
          trialStartedAt: "2026-07-29T16:00:00.000Z",
        },
        {
          memberCreatedAt: "2026-06-12T10:00:00.000Z",
          phoneHint: null,
          pulseTrialStartSource: "unknown",
          trialStartedAt: "2026-07-28T18:00:00.000Z",
        },
        {
          memberCreatedAt: "2026-07-27T10:00:00.000Z",
          phoneHint: "*** 4827",
          pulseTrialStartSource: "web_onboarding",
          trialStartedAt: "2026-07-27T10:06:00.000Z",
        },
      ],
      windowStartDate: "2026-07-01",
    });
  });

  it("builds referral claim cohorts from attributed invites and later activations", () => {
    const usage = buildHostedGrowthReferralLinkUsage({
      claimRows: [
        {
          createdAt: new Date("2026-07-29T08:00:00.000Z"),
          member: {
            hostedMailboxItems: [{
              occurredAt: new Date("2026-07-30T09:00:00.000Z"),
            }],
          },
          referrerMemberId: "referrer_a",
        },
        {
          createdAt: new Date("2026-07-30T10:00:00.000Z"),
          member: { hostedMailboxItems: [] },
          referrerMemberId: "referrer_a",
        },
        {
          createdAt: new Date("2026-07-31T08:00:00.000Z"),
          member: {
            hostedMailboxItems: [{
              occurredAt: new Date("2026-07-31T08:05:00.000Z"),
            }],
          },
          referrerMemberId: "referrer_b",
        },
        {
          createdAt: new Date("2026-07-31T09:00:00.000Z"),
          member: {
            hostedMailboxItems: [{
              occurredAt: new Date("2026-07-31T08:55:00.000Z"),
            }],
          },
          referrerMemberId: "referrer_c",
        },
        {
          createdAt: new Date("2026-07-28T23:59:59.999Z"),
          member: { hostedMailboxItems: [] },
          referrerMemberId: "referrer_outside",
        },
        {
          createdAt: new Date("2026-07-30T11:00:00.000Z"),
          member: { hostedMailboxItems: [] },
          referrerMemberId: null,
        },
        {
          createdAt: new Date("2026-07-31T12:00:00.001Z"),
          member: { hostedMailboxItems: [] },
          referrerMemberId: "referrer_future",
        },
      ],
      dayCount: 3,
      windowEnd: new Date("2026-07-31T12:00:00.000Z"),
    });

    expect(usage).toEqual({
      activatedClaims: 2,
      activationRatePercent: 50,
      activeReferrers: 3,
      claims: 4,
      dailySeries: [
        { activatedClaims: 1, claims: 1, date: "2026-07-29" },
        { activatedClaims: 0, claims: 1, date: "2026-07-30" },
        { activatedClaims: 1, claims: 2, date: "2026-07-31" },
      ],
    });
  });

  it("counts only retained invite rows with retained referral attribution", () => {
    const windowEnd = new Date("2026-07-31T12:00:00.000Z");
    const retainedClaim = {
      createdAt: new Date("2026-07-30T10:00:00.000Z"),
      member: {
        hostedMailboxItems: [{
          occurredAt: new Date("2026-07-31T09:00:00.000Z"),
        }],
      },
      referrerMemberId: "referrer_retained",
    };

    expect(buildHostedGrowthReferralLinkUsage({
      claimRows: [retainedClaim],
      dayCount: 2,
      windowEnd,
    })).toMatchObject({
      activatedClaims: 1,
      activationRatePercent: 100,
      activeReferrers: 1,
      claims: 1,
    });

    expect(buildHostedGrowthReferralLinkUsage({
      claimRows: [],
      dayCount: 2,
      windowEnd,
    })).toMatchObject({
      activatedClaims: 0,
      activationRatePercent: null,
      activeReferrers: 0,
      claims: 0,
    });

    expect(buildHostedGrowthReferralLinkUsage({
      claimRows: [{
        ...retainedClaim,
        referrerMemberId: null,
      }],
      dayCount: 2,
      windowEnd,
    })).toMatchObject({
      activatedClaims: 0,
      activationRatePercent: null,
      activeReferrers: 0,
      claims: 0,
    });
  });

  it("reads referral claims by durable attribution rather than invite channel", async () => {
    const now = new Date("2026-07-31T12:00:00.000Z");
    queueCurrentMetricMocks();
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    mocks.hostedInvite.findMany.mockResolvedValueOnce([
      {
        createdAt: new Date("2026-07-18T09:00:00.000Z"),
        member: {
          hostedMailboxItems: [{
            occurredAt: new Date("2026-07-19T14:00:00.000Z"),
          }],
        },
        referrerMemberId: "referrer_a",
      },
    ]);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.referralLinkUsage).toMatchObject({
      activatedClaims: 1,
      activationRatePercent: 100,
      activeReferrers: 1,
      claims: 1,
    });
    expect(mocks.hostedInvite.findMany).toHaveBeenCalledWith({
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        createdAt: true,
        member: {
          select: {
            hostedMailboxItems: {
              orderBy: [
                { occurredAt: "asc" },
                { id: "asc" },
              ],
              select: {
                occurredAt: true,
              },
              where: {
                kind: "member.activated",
                occurredAt: {
                  gte: new Date("2026-07-02T00:00:00.000Z"),
                  lte: now,
                },
              },
            },
          },
        },
        referrerMemberId: true,
      },
      where: {
        createdAt: {
          gte: new Date("2026-07-02T00:00:00.000Z"),
          lte: now,
        },
        referrerMemberId: {
          not: null,
        },
      },
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
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(activeUserRows(6))
      .mockResolvedValueOnce(activeUserRows(3))
      .mockResolvedValueOnce(activeUserRows(9))
      .mockResolvedValueOnce(activeUserRows(4));
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 12,
    });
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

    expect(markup).toContain("Referral link usage");
    expect(markup).toContain("MRR growth per week");
    expect(markup).toContain("Total messages sent");
    expect(markup).toContain("Messages sent per day");
    expect(markup).toMatch(
      /Messaged Murph today<\/div><div[^>]*>4<\/div>/u,
    );
    expect(markup).toMatch(
      /Messaged Murph · last 7 days<\/div><div[^>]*>6<\/div><div[^>]*>9 MAU across personal \+ group chats<\/div>/u,
    );
    expect(markup).toMatch(
      /Tracked fulfilled top-ups<\/span><span[^>]*>12<\/span>/u,
    );
    expect(markup).toMatch(
      /Tracked fulfilled usage top-ups<\/td><td[^>]*>12<\/td><td[^>]*>One-time<\/td>/u,
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
            createdAt: true,
            identity: {
              select: {
                maskedPhoneNumberHint: true,
              },
            },
            suspendedAt: true,
          },
        },
        pulseTrialStartSource: true,
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

  it("preserves one 30-day snapshot spine with activity zeroes and unavailable gaps", () => {
    const points = buildHostedGrowthMessageSeries({
      messagesBeforeSeries: 5_000,
      snapshots: [
        {
          ...snapshotRow("2026-07-08", 2_800),
          inboundMessagesPriorDay: null,
          outboundMessagesPriorDay: null,
        },
        {
          ...snapshotRow("2026-07-10", 2_900),
          activeUsersPriorDay: 4,
          activeUsersTrailing7Days: 18,
          inboundMessagesPriorDay: 42,
          outboundMessagesPriorDay: 57,
        },
        {
          ...snapshotRow("2026-07-11", 2_900),
          activeUsersPriorDay: 0,
          activeUsersTrailing7Days: 15,
          inboundMessagesPriorDay: 0,
          outboundMessagesPriorDay: 0,
        },
        {
          ...snapshotRow("2026-07-13", 3_000),
          inboundMessagesPriorDay: 51,
          outboundMessagesPriorDay: 63,
        },
      ],
      trackingEstablishedBeforeSeries: false,
      windowEnd: new Date("2026-07-31T12:00:00.000Z"),
    });

    expect(points).toHaveLength(30);
    expect(points.map((point) => point.date)).toEqual(
      Array.from({ length: 30 }, (_, index) =>
        `2026-07-${String(index + 1).padStart(2, "0")}`
      ),
    );
    expect(points[0]).toEqual({
      activeUsersPerDay: null,
      activeUsersTrailing7Days: null,
      date: "2026-07-01",
      messagesPerDay: null,
      totalMessages: null,
    });
    expect(points[6]).toEqual({
      activeUsersPerDay: null,
      activeUsersTrailing7Days: null,
      date: "2026-07-07",
      messagesPerDay: null,
      totalMessages: null,
    });
    expect(points[8]).toEqual({
      activeUsersPerDay: 4,
      activeUsersTrailing7Days: 18,
      date: "2026-07-09",
      messagesPerDay: 99,
      totalMessages: 5_099,
    });
    expect(points[9]).toEqual({
      activeUsersPerDay: 0,
      activeUsersTrailing7Days: 15,
      date: "2026-07-10",
      messagesPerDay: 0,
      totalMessages: 5_099,
    });
    expect(points[10]).toEqual({
      activeUsersPerDay: null,
      activeUsersTrailing7Days: null,
      date: "2026-07-11",
      messagesPerDay: null,
      totalMessages: null,
    });
    expect(points[11]).toEqual({
      activeUsersPerDay: null,
      activeUsersTrailing7Days: null,
      date: "2026-07-12",
      messagesPerDay: 114,
      totalMessages: null,
    });
  });

  it("seeds the dashboard message series from earlier snapshot history", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    queueCurrentMetricMocks();
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce(
      Array.from({ length: 30 }, (_, index) => {
        const snapshotDate = addUtcDays(
          new Date("2026-06-07T00:00:00.000Z"),
          index,
        );
        const row = snapshotRow(
          snapshotDate.toISOString().slice(0, 10),
          2_900,
        );
        return index === 29
          ? {
              ...row,
              inboundMessagesPriorDay: 42,
              outboundMessagesPriorDay: 57,
            }
          : row;
      }),
    );
    mocks.hostedGrowthDailySnapshot.aggregate.mockResolvedValueOnce({
      _count: {
        inboundMessagesPriorDay: 1,
        outboundMessagesPriorDay: 1,
      },
      _sum: {
        inboundMessagesPriorDay: 300,
        outboundMessagesPriorDay: 200,
      },
    });
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.messageSeries).toHaveLength(30);
    expect(dashboard.messageSeries[0]).toEqual({
      activeUsersPerDay: null,
      activeUsersTrailing7Days: null,
      date: "2026-06-06",
      messagesPerDay: 0,
      totalMessages: HOSTED_MESSAGE_VOLUME_BASE + 500,
    });
    expect(dashboard.messageSeries.at(-1)).toEqual({
      activeUsersPerDay: null,
      activeUsersTrailing7Days: null,
      date: "2026-07-05",
      messagesPerDay: 99,
      totalMessages: HOSTED_MESSAGE_VOLUME_BASE + 599,
    });
    expect(mocks.hostedGrowthDailySnapshot.aggregate).toHaveBeenCalledWith({
      _count: {
        inboundMessagesPriorDay: true,
        outboundMessagesPriorDay: true,
      },
      _sum: {
        inboundMessagesPriorDay: true,
        outboundMessagesPriorDay: true,
      },
      where: {
        snapshotDate: {
          lt: new Date("2026-06-07T00:00:00.000Z"),
        },
      },
    });
  });

  it("counts distinct senders across personal chats and group containers", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const registeredPhone = requireLinqContact("phone", "+15550000001");
    const unregisteredPhone = requireLinqContact("phone", "+15550000002");
    const previousPhone = requireLinqContact("phone", "+15550000003");
    const monthlyEmail = requireLinqContact("email", "monthly@example.test");
    const telegramLookupKey = requireTelegramLookupKey("telegram-user-1");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([
        { userId: "member_direct" },
        { userId: "member_direct_only" },
      ])
      .mockResolvedValueOnce([{ userId: "member_previous" }])
      .mockResolvedValueOnce([
        { userId: "member_direct" },
        { userId: "member_direct_only" },
        { userId: "member_previous" },
        { userId: "member_monthly" },
      ])
      .mockResolvedValueOnce([
        { userId: "member_direct" },
        { userId: "member_today" },
      ]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildLinqGroupMailboxRow({
        contact: registeredPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-06T08:00:00.000Z"),
      }),
      buildLinqGroupMailboxRow({
        contact: registeredPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-05T12:00:00.000Z"),
      }),
      buildLinqGroupMailboxRow({
        contact: unregisteredPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-04T12:00:00.000Z"),
      }),
      buildLinqGroupMailboxRow({
        contact: unregisteredPhone,
        containerMemberId: "thread_container_two",
        occurredAt: new Date("2026-07-03T12:00:00.000Z"),
      }),
      buildTelegramGroupMailboxRow({
        containerMemberId: "thread_container_two",
        occurredAt: new Date("2026-07-02T12:00:00.000Z"),
        senderUserId: "telegram-user-1",
      }),
      buildLinqGroupMailboxRow({
        contact: previousPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-06-25T12:00:00.000Z"),
      }),
      buildLinqGroupMailboxRow({
        contact: monthlyEmail,
        containerMemberId: "thread_container_two",
        occurredAt: new Date("2026-06-10T12:00:00.000Z"),
      }),
    ]);
    mocks.hostedMemberIdentity.findMany.mockResolvedValueOnce([
      {
        memberId: "member_direct",
        phoneLookupKey: registeredPhone.lookupKey,
      },
      {
        memberId: "member_previous",
        phoneLookupKey: previousPhone.lookupKey,
      },
    ]);
    mocks.hostedMemberEmailAuthorization.findMany.mockResolvedValueOnce([
      {
        memberId: "member_monthly",
        verifiedEmailLookupKey: monthlyEmail.lookupKey,
      },
    ]);
    mocks.hostedMemberRouting.findMany.mockResolvedValueOnce([
      {
        memberId: "member_telegram",
        telegramUserLookupKey: telegramLookupKey,
      },
    ]);
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 12,
    });
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.activeUsers).toEqual({
      today: 2,
      todayComplete: true,
      trailing30Days: 6,
      trailing30DaysComplete: true,
      trailing7Days: 4,
      trailing7DaysComplete: true,
      wowComparisonComplete: true,
      wowPercent: 300,
    });
    expect(dashboard.usageTopUps).toEqual({
      trackedFulfilled: 12,
    });
    expect(mocks.hostedGrowthAggregate.findUniqueOrThrow).toHaveBeenCalledWith({
      select: {
        trackedFulfilledUsageTopUps: true,
      },
      where: {
        id: "global",
      },
    });
    expect(mocks.hostedMailboxItem.groupBy.mock.calls[0]?.[0]).toEqual({
      by: ["userId"],
      where: {
        kind: "conversation.message",
        member: {
          hostedGroupRuntime: null,
          threadContainer: null,
        },
        createdAt: {
          gte: new Date("2026-06-29T12:00:00.000Z"),
          lt: new Date("2026-07-06T12:00:00.000Z"),
        },
      },
    });
    expect(mocks.hostedMailboxItem.groupBy.mock.calls[1]?.[0]).toEqual({
      by: ["userId"],
      where: {
        kind: "conversation.message",
        member: {
          hostedGroupRuntime: null,
          threadContainer: null,
        },
        createdAt: {
          gte: new Date("2026-06-22T12:00:00.000Z"),
          lt: new Date("2026-06-29T12:00:00.000Z"),
        },
      },
    });
    expect(mocks.hostedMailboxItem.groupBy.mock.calls[2]?.[0]).toEqual({
      by: ["userId"],
      where: {
        kind: "conversation.message",
        member: {
          hostedGroupRuntime: null,
          threadContainer: null,
        },
        createdAt: {
          gte: new Date("2026-06-06T12:00:00.000Z"),
          lt: new Date("2026-07-06T12:00:00.000Z"),
        },
      },
    });
    expect(mocks.hostedMailboxItem.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        kind: "conversation.message",
        member: {
          threadContainer: {
            isNot: null,
          },
        },
        createdAt: {
          gte: new Date("2026-06-06T12:00:00.000Z"),
          lt: new Date("2026-07-06T12:00:00.000Z"),
        },
      },
    });
    expect(mocks.hostedMailboxItem.groupBy.mock.calls[3]?.[0]).toMatchObject({
      where: {
        createdAt: {
          gte: new Date("2026-07-06T00:00:00.000Z"),
          lt: now,
        },
      },
    });
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledTimes(7);
  });

  it("assigns late provider events to the durable receipt window", async () => {
    const now = new Date("2026-07-06T00:20:00.000Z");
    const providerOccurredAt = new Date("2026-07-05T23:59:00.000Z");
    const mailboxCreatedAt = new Date("2026-07-06T00:15:00.000Z");
    const groupPhone = requireLinqContact("phone", "+15550000001");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([{ userId: "member_direct_late" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: "member_direct_late" }])
      .mockResolvedValueOnce([{ userId: "member_direct_late" }]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildLinqGroupMailboxRow({
        contact: groupPhone,
        containerMemberId: "thread_container_late",
        createdAt: mailboxCreatedAt,
        occurredAt: providerOccurredAt,
      }),
    ]);
    mocks.hostedMemberIdentity.findMany.mockResolvedValueOnce([{
      memberId: "member_group_late",
      phoneLookupKey: groupPhone.lookupKey,
    }]);
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 0,
    });
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.activeUsers).toEqual({
      today: 2,
      todayComplete: true,
      trailing30Days: 2,
      trailing30DaysComplete: true,
      trailing7Days: 2,
      trailing7DaysComplete: true,
      wowComparisonComplete: true,
      wowPercent: null,
    });
    expect(mocks.hostedMailboxItem.groupBy.mock.calls[3]?.[0]).toMatchObject({
      where: {
        createdAt: {
          gte: new Date("2026-07-06T00:00:00.000Z"),
          lt: now,
        },
      },
    });
    expect(mocks.hostedMailboxItem.findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        createdAt: true,
        occurredAt: true,
      },
      where: {
        createdAt: {
          gte: new Date("2026-06-06T00:20:00.000Z"),
          lt: now,
        },
      },
    });
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        occurredAt: providerOccurredAt.toISOString(),
      }),
    );
  });

  it("marks MAU incomplete without discarding an exact weekly comparison", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const retainedPhone = requireLinqContact("phone", "+15550000001");
    const retiredMonthlyPhone = requireLinqContact("phone", "+15550000002");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([{ userId: "member_current" }])
      .mockResolvedValueOnce([{ userId: "member_previous" }])
      .mockResolvedValueOnce([
        { userId: "member_current" },
        { userId: "member_previous" },
        { userId: "member_monthly" },
      ]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildLinqGroupMailboxRow({
        contact: retainedPhone,
        containerMemberId: "thread_container_current",
        occurredAt: new Date("2026-07-04T12:00:00.000Z"),
      }),
      retireGroupMailboxRow(buildLinqGroupMailboxRow({
        contact: retiredMonthlyPhone,
        containerMemberId: "thread_container_monthly",
        occurredAt: new Date("2026-06-10T12:00:00.000Z"),
      })),
    ]);
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 0,
    });
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.activeUsers).toEqual({
      today: 0,
      todayComplete: true,
      trailing30Days: 4,
      trailing30DaysComplete: false,
      trailing7Days: 2,
      trailing7DaysComplete: true,
      wowComparisonComplete: true,
      wowPercent: 100,
    });
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledTimes(1);
    expect(mocks.hostedMailboxItem.findMany.mock.calls[0]?.[0]).toMatchObject({
      select: {
        contentRetiredAt: true,
      },
    });
  });

  it("withholds WAU change when retired content affects a compared week", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const retiredPreviousPhone = requireLinqContact("phone", "+15550000001");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([{ userId: "member_current" }])
      .mockResolvedValueOnce([{ userId: "member_previous" }])
      .mockResolvedValueOnce([
        { userId: "member_current" },
        { userId: "member_previous" },
      ]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      retireGroupMailboxRow(buildLinqGroupMailboxRow({
        contact: retiredPreviousPhone,
        containerMemberId: "thread_container_previous",
        occurredAt: new Date("2026-06-25T12:00:00.000Z"),
      })),
    ]);
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 0,
    });
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.activeUsers).toEqual({
      today: 0,
      todayComplete: true,
      trailing30Days: 2,
      trailing30DaysComplete: false,
      trailing7Days: 1,
      trailing7DaysComplete: true,
      wowComparisonComplete: false,
      wowPercent: null,
    });
    expect(mocks.decodeHostedMailboxStoredPayload).not.toHaveBeenCalled();
  });

  it("marks current WAU incomplete when retired content affects the current week", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const retiredCurrentPhone = requireLinqContact("phone", "+15550000001");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([{ userId: "member_current" }])
      .mockResolvedValueOnce([{ userId: "member_previous" }])
      .mockResolvedValueOnce([
        { userId: "member_current" },
        { userId: "member_previous" },
      ]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      retireGroupMailboxRow(buildLinqGroupMailboxRow({
        contact: retiredCurrentPhone,
        containerMemberId: "thread_container_current",
        occurredAt: new Date("2026-07-04T12:00:00.000Z"),
      })),
    ]);
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 0,
    });
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.activeUsers).toEqual({
      today: 0,
      todayComplete: true,
      trailing30Days: 2,
      trailing30DaysComplete: false,
      trailing7Days: 1,
      trailing7DaysComplete: false,
      wowComparisonComplete: false,
      wowPercent: null,
    });
    expect(mocks.decodeHostedMailboxStoredPayload).not.toHaveBeenCalled();
  });

  it("still rejects missing group content without a retirement marker", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const missingPhone = requireLinqContact("phone", "+15550000001");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      {
        ...buildLinqGroupMailboxRow({
          contact: missingPhone,
          containerMemberId: "thread_container_missing",
          occurredAt: new Date("2026-07-04T12:00:00.000Z"),
        }),
        payloadInlineCiphertext: null,
      },
    ]);
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 0,
    });
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await expect(readHostedGrowthDashboard(now)).rejects.toThrow(
      "Hosted growth group message payload is unavailable.",
    );
  });

  it("keeps a shared-group sender countable from retained admission-time identity", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const registeredPhone = requireLinqContact("phone", "+15550000001");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([{ userId: "member_original" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: "member_original" }]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildLinqGroupMailboxRow({
        contact: registeredPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-05T12:00:00.000Z"),
        senderMemberId: "member_original",
      }),
      buildTelegramGroupMailboxRow({
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-04T12:00:00.000Z"),
        senderMemberId: "member_original",
        senderUserId: "telegram-user-reassigned",
      }),
      buildTelegramGroupMailboxRow({
        containerMemberId: "thread_container_two",
        occurredAt: new Date("2026-07-03T12:00:00.000Z"),
        senderMemberId: "member_later",
        senderUserId: "telegram-user-reassigned",
      }),
      buildTelegramGroupMailboxRow({
        containerMemberId: "thread_container_three",
        occurredAt: new Date("2026-07-02T12:00:00.000Z"),
        senderMemberId: "member_without_provider_identity",
      }),
    ]);
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 0,
    });
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.activeUsers).toEqual({
      today: 0,
      todayComplete: true,
      trailing30Days: 3,
      trailing30DaysComplete: true,
      trailing7Days: 3,
      trailing7DaysComplete: true,
      wowComparisonComplete: true,
      wowPercent: null,
    });
    expect(mocks.hostedMemberIdentity.findMany).not.toHaveBeenCalled();
    expect(mocks.hostedMemberEmailAuthorization.findMany).not.toHaveBeenCalled();
    expect(mocks.hostedMemberRouting.findMany).not.toHaveBeenCalled();
  });

  it("omits unattributable group messages and keeps unmatched legacy Telegram countable", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildEmailGroupMailboxRow({
        containerMemberId: "thread_container_email",
        occurredAt: new Date("2026-07-05T12:00:00.000Z"),
      }),
      buildTelegramGroupMailboxRow({
        containerMemberId: "thread_container_unattributed",
        occurredAt: new Date("2026-07-04T12:00:00.000Z"),
      }),
      buildTelegramGroupMailboxRow({
        containerMemberId: "thread_container_telegram",
        occurredAt: new Date("2026-07-03T12:00:00.000Z"),
        senderUserId: "legacy-unlinked-telegram-user",
      }),
    ]);
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 0,
    });
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.activeUsers).toEqual({
      today: 0,
      todayComplete: true,
      trailing30Days: 1,
      trailing30DaysComplete: true,
      trailing7Days: 1,
      trailing7DaysComplete: true,
      wowComparisonComplete: true,
      wowPercent: null,
    });
    expect(mocks.hostedMemberRouting.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledTimes(3);
  });

  it("omits group reaction attestation rows from active senders", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const senderPhone = requireLinqContact("phone", "+15550000001");
    const reactorPhone = requireLinqContact("phone", "+15550000002");
    const retiredReactorPhone = requireLinqContact("phone", "+15550000003");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildLinqGroupMailboxRow({
        contact: senderPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-05T12:00:00.000Z"),
      }),
      buildLinqGroupReactionMailboxRow({
        contact: reactorPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-04T12:00:00.000Z"),
      }),
      buildTelegramGroupReactionMailboxRow({
        containerMemberId: "thread_container_two",
        occurredAt: new Date("2026-07-03T12:00:00.000Z"),
      }),
      retireGroupMailboxRow(buildLinqGroupReactionMailboxRow({
        contact: retiredReactorPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-06-15T12:00:00.000Z"),
      })),
    ]);
    mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
      trackedFulfilledUsageTopUps: 0,
    });
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.activeUsers).toEqual({
      today: 0,
      todayComplete: true,
      trailing30Days: 1,
      trailing30DaysComplete: true,
      trailing7Days: 1,
      trailing7DaysComplete: true,
      wowComparisonComplete: true,
      wowPercent: null,
    });
    expect(mocks.decodeHostedMailboxStoredPayload).toHaveBeenCalledTimes(3);
  });

  it("still rejects the reaction sender attestation on a non-reaction event", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const forgedPhone = requireLinqContact("phone", "+15550000004");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildLinqGroupMailboxRow({
        contact: forgedPhone,
        containerMemberId: "thread_container_one",
        from: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
        occurredAt: new Date("2026-07-05T12:00:00.000Z"),
      }),
    ]);
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await expect(readHostedGrowthDashboard(now)).rejects.toThrow(
      "Hosted growth Linq group sender contact is invalid.",
    );
  });

  it("still rejects an unknown thread-container conversation channel", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const row = buildEmailGroupMailboxRow({
      containerMemberId: "thread_container_unknown",
      occurredAt: new Date("2026-07-05T12:00:00.000Z"),
    });
    if (!row.payloadInlineCiphertext) {
      throw new Error("Expected inline test mailbox payload.");
    }
    const decoded = JSON.parse(row.payloadInlineCiphertext) as {
      message: Record<string, unknown>;
    };
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([{
      ...row,
      payloadInlineCiphertext: JSON.stringify({
        ...decoded,
        message: {
          ...decoded.message,
          channel: "unsupported",
        },
      }),
    }]);
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    await expect(readHostedGrowthDashboard(now)).rejects.toThrow(
      "conversation.message wake payload channel",
    );
  });

  it("rejects group sender evidence that resolves to multiple members", async () => {
    const restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: {
        v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
        v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
      },
    });

    try {
      const now = new Date("2026-07-06T12:00:00.000Z");
      const email = requireLinqContact("email", "rotated@example.test");
      const [currentLookupKey, previousLookupKey] =
        createHostedLinqParticipantContactLookupKeyReadCandidates({
          kind: email.kind,
          value: email.value,
        });
      if (!currentLookupKey || !previousLookupKey) {
        throw new Error("Expected current and previous email lookup keys.");
      }

      queueCurrentMetricMocks();
      mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
        buildLinqGroupMailboxRow({
          contact: email,
          containerMemberId: "thread_container_one",
          occurredAt: new Date("2026-07-05T12:00:00.000Z"),
        }),
      ]);
      mocks.hostedMemberEmailAuthorization.findMany.mockResolvedValueOnce([
        {
          memberId: "member_current_key",
          verifiedEmailLookupKey: currentLookupKey,
        },
        {
          memberId: "member_previous_key",
          verifiedEmailLookupKey: previousLookupKey,
        },
      ]);
      mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
        trackedFulfilledUsageTopUps: 12,
      });
      mocks.hostedMember.findMany.mockResolvedValueOnce([]);
      mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
      mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
      mocks.hostedMemberBillingRef.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      await expect(readHostedGrowthDashboard(now)).rejects.toThrow(
        "Hosted growth group sender matched multiple registered members.",
      );
    } finally {
      restoreKeyring();
    }
  });

  it.each([
    new Date("2026-07-06T00:05:00.000Z"),
    new Date("2026-07-06T12:05:00.000Z"),
  ])(
    "compares equal rolling active-user windows at %s",
    async (now) => {
      queueCurrentMetricMocks();
      mocks.hostedMailboxItem.groupBy
        .mockResolvedValueOnce(activeUserRows(7))
        .mockResolvedValueOnce(activeUserRows(7))
        .mockResolvedValueOnce(activeUserRows(21));
      mocks.hostedGrowthAggregate.findUniqueOrThrow.mockResolvedValueOnce({
        trackedFulfilledUsageTopUps: 12,
      });
      mocks.hostedMember.findMany.mockResolvedValueOnce([]);
      mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
      mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([]);
      mocks.hostedMemberBillingRef.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const dashboard = await readHostedGrowthDashboard(now);

      expect(dashboard.activeUsers).toEqual({
        today: 0,
        todayComplete: true,
        trailing30Days: 21,
        trailing30DaysComplete: true,
        trailing7Days: 7,
        trailing7DaysComplete: true,
        wowComparisonComplete: true,
        wowPercent: 0,
      });
      expect(mocks.hostedMailboxItem.groupBy.mock.calls[0]?.[0]).toMatchObject({
        where: {
          createdAt: {
            gte: addUtcDays(now, -7),
            lt: now,
          },
        },
      });
      expect(mocks.hostedMailboxItem.groupBy.mock.calls[1]?.[0]).toMatchObject({
        where: {
          createdAt: {
            gte: addUtcDays(now, -14),
            lt: addUtcDays(now, -7),
          },
        },
      });
      expect(mocks.hostedMailboxItem.groupBy.mock.calls[2]?.[0]).toMatchObject({
        where: {
          createdAt: {
            gte: addUtcDays(now, -30),
            lt: now,
          },
        },
      });
    },
  );

  it("leads the scorecard with weekly revenue growth and keeps usage context honest", () => {
    const scorecardProps = {
      activeUsers: {
        today: 9,
        todayComplete: true,
        trailing30Days: 61,
        trailing30DaysComplete: true,
        trailing7Days: 24,
        trailing7DaysComplete: true,
        wowComparisonComplete: true,
        wowPercent: 9.1,
      },
      conversion: { converted: 8, matureStarted: 20, percent: 40 },
      mrrUsdCents: 8_400,
      newMembers: { trailing7Days: 17, wowPercent: 21.4 },
      payingCustomers: 31,
      payingCustomersWowPercent: 6.9,
      trialStarts: { trailing7Days: 11, wowPercent: 10 },
      usageTopUps: { trackedFulfilled: 12 },
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
    expect(markup).toContain("Messaged Murph today");
    expect(markup).toContain(
      "Unique senders whose messages Murph received since 00:00 UTC",
    );
    expect(markup).toContain("Messaged Murph · last 7 days");
    expect(markup).toContain(">24<");
    expect(markup).toContain("61 MAU across personal + group chats");
    expect(markup).toContain("+9.1% WAU versus the prior seven days");
    expect(markup).toContain(
      "Each retained distinct sender counts once when Murph receives a message in the UTC window, across personal + group chats",
    );
    expect(markup).toContain("8 of 20 mature trials");

    const targetHitMarkup = renderToStaticMarkup(
      createElement(GrowthScorecard, {
        ...scorecardProps,
        mrrWowPercent: 10,
      }),
    );
    expect(targetHitMarkup).toMatch(/text-primary[^>]*>\+10%/u);
    expect(targetHitMarkup).toContain("10% target hit");
    expect(targetHitMarkup).toContain("Tracked fulfilled top-ups");
    expect(targetHitMarkup).toContain("Retained history + new fulfillments");
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

    const partialMonthlyHistoryMarkup = renderToStaticMarkup(
      createElement(GrowthScorecard, {
        ...scorecardProps,
        activeUsers: {
          today: 9,
          todayComplete: true,
          trailing30Days: 48,
          trailing30DaysComplete: false,
          trailing7Days: 24,
          trailing7DaysComplete: true,
          wowComparisonComplete: true,
          wowPercent: 9.1,
        },
        mrrWowPercent: 9.9,
      }),
    );
    expect(partialMonthlyHistoryMarkup).toContain(
      "At least 48 MAU across personal + group chats",
    );
    expect(partialMonthlyHistoryMarkup).toContain(
      "+9.1% WAU versus the prior seven days",
    );
    expect(partialMonthlyHistoryMarkup).toContain(
      "MAU is a lower bound because older group sender evidence was intentionally retired",
    );
    expect(partialMonthlyHistoryMarkup).toContain(">24<");
    expect(partialMonthlyHistoryMarkup).not.toContain(
      "Prior-week comparison unavailable",
    );

    const partialWeeklyHistoryMarkup = renderToStaticMarkup(
      createElement(GrowthScorecard, {
        ...scorecardProps,
        activeUsers: {
          today: 7,
          todayComplete: false,
          trailing30Days: 48,
          trailing30DaysComplete: false,
          trailing7Days: 21,
          trailing7DaysComplete: false,
          wowComparisonComplete: false,
          wowPercent: null,
        },
        mrrWowPercent: 9.9,
      }),
    );
    expect(partialWeeklyHistoryMarkup).toContain(
      "At least 21",
    );
    expect(partialWeeklyHistoryMarkup).toContain("At least 7");
    expect(partialWeeklyHistoryMarkup).toContain(
      "Today is a lower bound because group sender evidence was intentionally retired",
    );
    expect(partialWeeklyHistoryMarkup).toContain(
      "Prior-week comparison unavailable because older group sender evidence was intentionally retired",
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

  it("splits monthly subscriptions from the month's latest snapshot and buckets purchases by paid month", () => {
    const series = buildHostedGrowthMonthlyRevenueSeries({
      monthCount: 6,
      purchases: [
        {
          cashAmountMinor: 1_500,
          isGroupSponsorship: true,
          paidAt: new Date("2026-07-31T23:59:59.999Z"),
        },
        {
          cashAmountMinor: 7_500,
          isGroupSponsorship: false,
          paidAt: new Date("2026-07-04T10:00:00.000Z"),
        },
        {
          cashAmountMinor: 2_000,
          isGroupSponsorship: true,
          paidAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        {
          cashAmountMinor: 3_000,
          isGroupSponsorship: false,
          paidAt: new Date("2026-08-05T15:00:00.000Z"),
        },
      ],
      snapshots: [
        {
          familyMrrUsdCents: null,
          individualMrrUsdCents: null,
          mrrUsdCents: 17_100,
          snapshotDate: new Date("2026-07-31T00:00:00.000Z"),
        },
        {
          familyMrrUsdCents: 6_100,
          individualMrrUsdCents: 14_400,
          mrrUsdCents: 20_500,
          snapshotDate: new Date("2026-08-07T00:00:00.000Z"),
        },
        {
          familyMrrUsdCents: 5_000,
          individualMrrUsdCents: 13_000,
          mrrUsdCents: 18_000,
          snapshotDate: new Date("2026-08-03T00:00:00.000Z"),
        },
      ],
      windowEnd: new Date("2026-08-07T12:00:00.000Z"),
    });

    expect(series).toEqual([
      {
        familySubscriptionsUsdCents: null,
        groupSponsorshipUsdCents: 1_500,
        individualSubscriptionsUsdCents: null,
        month: "2026-07",
        monthToDate: false,
        subscriptionsUnsplitUsdCents: 17_100,
        totalUsdCents: 26_100,
        usageTopUpsUsdCents: 7_500,
      },
      {
        familySubscriptionsUsdCents: 6_100,
        groupSponsorshipUsdCents: 2_000,
        individualSubscriptionsUsdCents: 14_400,
        month: "2026-08",
        monthToDate: true,
        subscriptionsUnsplitUsdCents: null,
        totalUsdCents: 25_500,
        usageTopUpsUsdCents: 3_000,
      },
    ]);
  });

  it("falls back to the unsplit subscription value when a recorded split does not sum to the MRR total", () => {
    const series = buildHostedGrowthMonthlyRevenueSeries({
      monthCount: 1,
      purchases: [],
      snapshots: [
        {
          familyMrrUsdCents: 6_100,
          individualMrrUsdCents: 14_400,
          mrrUsdCents: 21_700,
          snapshotDate: new Date("2026-08-07T00:00:00.000Z"),
        },
      ],
      windowEnd: new Date("2026-08-07T12:00:00.000Z"),
    });

    expect(series).toEqual([
      {
        familySubscriptionsUsdCents: null,
        groupSponsorshipUsdCents: 0,
        individualSubscriptionsUsdCents: null,
        month: "2026-08",
        monthToDate: true,
        subscriptionsUnsplitUsdCents: 21_700,
        totalUsdCents: 21_700,
        usageTopUpsUsdCents: 0,
      },
    ]);
  });

  it("withholds the total for months without a subscription snapshot", () => {
    const series = buildHostedGrowthMonthlyRevenueSeries({
      monthCount: 3,
      purchases: [
        {
          cashAmountMinor: 1_000,
          isGroupSponsorship: false,
          paidAt: new Date("2026-06-10T00:00:00.000Z"),
        },
      ],
      snapshots: [],
      windowEnd: new Date("2026-08-07T12:00:00.000Z"),
    });

    expect(series).toEqual([
      {
        familySubscriptionsUsdCents: null,
        groupSponsorshipUsdCents: 0,
        individualSubscriptionsUsdCents: null,
        month: "2026-06",
        monthToDate: false,
        subscriptionsUnsplitUsdCents: null,
        totalUsdCents: null,
        usageTopUpsUsdCents: 1_000,
      },
      {
        familySubscriptionsUsdCents: null,
        groupSponsorshipUsdCents: 0,
        individualSubscriptionsUsdCents: null,
        month: "2026-07",
        monthToDate: false,
        subscriptionsUnsplitUsdCents: null,
        totalUsdCents: null,
        usageTopUpsUsdCents: 0,
      },
      {
        familySubscriptionsUsdCents: null,
        groupSponsorshipUsdCents: 0,
        individualSubscriptionsUsdCents: null,
        month: "2026-08",
        monthToDate: true,
        subscriptionsUnsplitUsdCents: null,
        totalUsdCents: null,
        usageTopUpsUsdCents: 0,
      },
    ]);
  });

  it("renders only the window-end month when no revenue evidence exists", () => {
    const series = buildHostedGrowthMonthlyRevenueSeries({
      monthCount: 6,
      purchases: [],
      snapshots: [],
      windowEnd: new Date("2026-08-07T12:00:00.000Z"),
    });

    expect(series).toEqual([
      {
        familySubscriptionsUsdCents: null,
        groupSponsorshipUsdCents: 0,
        individualSubscriptionsUsdCents: null,
        month: "2026-08",
        monthToDate: true,
        subscriptionsUnsplitUsdCents: null,
        totalUsdCents: null,
        usageTopUpsUsdCents: 0,
      },
    ]);
  });

  it("builds the dashboard monthly revenue series from fulfilled live purchases", async () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    queueCurrentMetricMocks();
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([
      snapshotRow("2026-07-31", 17_100),
      {
        ...snapshotRow("2026-08-07", 20_500),
        familyMrrUsdCents: 6_100,
        individualMrrUsdCents: 14_400,
      },
    ]);
    mocks.hostedUsageCreditPurchase.findMany.mockResolvedValueOnce([
      {
        cashAmountMinor: 1_500,
        groupSponsorshipAuthorizationId: null,
        groupSponsorshipMoment: { purchaseId: "purchase_group_gift" },
        paidAt: new Date("2026-07-27T09:00:00.000Z"),
      },
      {
        cashAmountMinor: 7_500,
        groupSponsorshipAuthorizationId: null,
        groupSponsorshipMoment: null,
        paidAt: new Date("2026-07-04T10:00:00.000Z"),
      },
      {
        cashAmountMinor: 2_000,
        groupSponsorshipAuthorizationId: "auth_recurring",
        groupSponsorshipMoment: null,
        paidAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      {
        cashAmountMinor: 3_000,
        groupSponsorshipAuthorizationId: null,
        groupSponsorshipMoment: null,
        paidAt: new Date("2026-08-05T15:00:00.000Z"),
      },
      {
        cashAmountMinor: 9_900,
        groupSponsorshipAuthorizationId: null,
        groupSponsorshipMoment: null,
        paidAt: null,
      },
    ]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const dashboard = await readHostedGrowthDashboard(now);

    expect(dashboard.monthlyRevenueSeries).toEqual([
      {
        familySubscriptionsUsdCents: null,
        groupSponsorshipUsdCents: 1_500,
        individualSubscriptionsUsdCents: null,
        month: "2026-07",
        monthToDate: false,
        subscriptionsUnsplitUsdCents: 17_100,
        totalUsdCents: 26_100,
        usageTopUpsUsdCents: 7_500,
      },
      {
        familySubscriptionsUsdCents: 6_100,
        groupSponsorshipUsdCents: 2_000,
        individualSubscriptionsUsdCents: 14_400,
        month: "2026-08",
        monthToDate: true,
        subscriptionsUnsplitUsdCents: null,
        totalUsdCents: 25_500,
        usageTopUpsUsdCents: 3_000,
      },
    ]);
    expect(mocks.hostedUsageCreditPurchase.findMany.mock.calls[0]?.[0]).toEqual({
      select: {
        cashAmountMinor: true,
        groupSponsorshipAuthorizationId: true,
        groupSponsorshipMoment: {
          select: {
            purchaseId: true,
          },
        },
        paidAt: true,
      },
      where: {
        paidAt: {
          gte: new Date("2026-03-01T00:00:00.000Z"),
          lte: now,
        },
        status: "fulfilled",
        stripeLiveMode: true,
      },
    });
    expect(mocks.hostedGrowthDailySnapshot.findMany).toHaveBeenCalledTimes(1);
    expect(
      mocks.hostedGrowthDailySnapshot.findMany.mock.calls[0]?.[0],
    ).toMatchObject({
      where: {
        snapshotDate: {
          gte: new Date("2026-03-01T00:00:00.000Z"),
          lte: new Date("2026-08-07T00:00:00.000Z"),
        },
      },
    });
  });

  it("moves a one-time group gift to usage top-ups when payer deletion removes its sponsorship moment", async () => {
    // Payer-only account deletion retains the fulfilled cross-owner purchase
    // but cascades away its HostedGroupSponsorshipMoment, so the same cash is
    // classified as a plain top-up on the next read. The card copy discloses
    // this; the total must not change.
    const now = new Date("2026-08-07T12:00:00.000Z");
    const giftRow = {
      cashAmountMinor: 2_000,
      groupSponsorshipAuthorizationId: null,
      paidAt: new Date("2026-08-03T09:00:00.000Z"),
    };
    queueCurrentMetricMocks();
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([
      snapshotRow("2026-08-07", 2_900),
    ]);
    mocks.hostedUsageCreditPurchase.findMany.mockResolvedValueOnce([
      {
        ...giftRow,
        groupSponsorshipMoment: { purchaseId: "purchase_group_gift" },
      },
    ]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const beforeDeletion = await readHostedGrowthDashboard(now);

    queueCurrentMetricMocks();
    mocks.hostedMember.findMany.mockResolvedValueOnce([]);
    mocks.hostedMemberBillingRef.findMany.mockResolvedValueOnce([]);
    mocks.hostedGrowthDailySnapshot.findMany.mockResolvedValueOnce([
      snapshotRow("2026-08-07", 2_900),
    ]);
    mocks.hostedUsageCreditPurchase.findMany.mockResolvedValueOnce([
      {
        ...giftRow,
        groupSponsorshipMoment: null,
      },
    ]);
    mocks.hostedMemberBillingRef.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const afterDeletion = await readHostedGrowthDashboard(now);

    const beforePoint = beforeDeletion.monthlyRevenueSeries.at(-1);
    const afterPoint = afterDeletion.monthlyRevenueSeries.at(-1);
    expect(beforePoint).toMatchObject({
      groupSponsorshipUsdCents: 2_000,
      usageTopUpsUsdCents: 0,
    });
    expect(afterPoint).toMatchObject({
      groupSponsorshipUsdCents: 0,
      usageTopUpsUsdCents: 2_000,
    });
    expect(afterPoint?.totalUsdCents).toEqual(beforePoint?.totalUsdCents);
  });

  it("records the subscription split in the daily snapshot", async () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    mocks.hostedAccountGroup.findMany.mockResolvedValueOnce([
      {
        billingRef: {
          billedSeatCount: 2,
          currentBillingPhase: "paid",
        },
        id: "group_family",
        memberships: [
          { memberId: "member_family_owner" },
          { memberId: "member_family_seat" },
        ],
        planCapacities: [{ billedQuantity: 2, planCode: "pulse" }],
      },
    ]);
    queueCurrentMetricMocks();
    mocks.hostedGrowthDailySnapshot.upsert.mockResolvedValueOnce(
      snapshotRow("2026-08-07", 4_200),
    );

    await captureHostedGrowthDailySnapshot(now);

    const upsertArg = mocks.hostedGrowthDailySnapshot.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create).toMatchObject({
      familyMrrUsdCents: 1_400,
      individualMrrUsdCents: 2_800,
      mrrUsdCents: 4_200,
    });
    expect(upsertArg?.update).toMatchObject({
      familyMrrUsdCents: 1_400,
      individualMrrUsdCents: 2_800,
      mrrUsdCents: 4_200,
    });
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

  it("records exact prior-day and trailing-seven-day unique senders", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const registeredPhone = requireLinqContact("phone", "+15550000001");
    const unregisteredPhone = requireLinqContact("phone", "+15550000002");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([{ userId: "member_direct" }])
      .mockResolvedValueOnce([
        { userId: "member_direct" },
        { userId: "member_weekly" },
      ]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildLinqGroupMailboxRow({
        contact: registeredPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-05T08:00:00.000Z"),
      }),
      buildLinqGroupMailboxRow({
        contact: unregisteredPhone,
        containerMemberId: "thread_container_two",
        occurredAt: new Date("2026-07-05T09:00:00.000Z"),
      }),
    ]);
    mocks.hostedMemberIdentity.findMany.mockResolvedValueOnce([{
      memberId: "member_direct",
      phoneLookupKey: registeredPhone.lookupKey,
    }]);
    mocks.hostedGrowthDailySnapshot.upsert.mockResolvedValueOnce(
      snapshotRow("2026-07-06", 2_900),
    );

    const capture = await captureHostedGrowthDailySnapshot(now);

    expect(capture.activityAvailable).toBe(true);
    const upsertArg = mocks.hostedGrowthDailySnapshot.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create).toMatchObject({
      activeUsersPriorDay: 2,
      activeUsersTrailing7Days: 3,
    });
    expect(upsertArg?.update).toMatchObject({
      activeUsersPriorDay: 2,
      activeUsersTrailing7Days: 3,
    });
    expect(mocks.hostedMailboxItem.groupBy.mock.calls[0]?.[0]).toMatchObject({
      where: {
        createdAt: {
          gte: new Date("2026-07-05T00:00:00.000Z"),
          lt: new Date("2026-07-06T00:00:00.000Z"),
        },
      },
    });
    expect(mocks.hostedMailboxItem.groupBy.mock.calls[1]?.[0]).toMatchObject({
      where: {
        createdAt: {
          gte: new Date("2026-06-29T00:00:00.000Z"),
          lt: new Date("2026-07-06T00:00:00.000Z"),
        },
      },
    });
    expect(mocks.hostedMailboxItem.findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        createdAt: {
          gte: new Date("2026-06-29T00:00:00.000Z"),
          lt: new Date("2026-07-06T00:00:00.000Z"),
        },
      },
    });
  });

  it("stores unknown activity when retired group evidence affects a window", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const retiredPhone = requireLinqContact("phone", "+15550000001");
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.groupBy
      .mockResolvedValueOnce([{ userId: "member_direct" }])
      .mockResolvedValueOnce([{ userId: "member_direct" }]);
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      retireGroupMailboxRow(buildLinqGroupMailboxRow({
        contact: retiredPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-05T08:00:00.000Z"),
      })),
    ]);
    mocks.hostedGrowthDailySnapshot.upsert.mockResolvedValueOnce(
      snapshotRow("2026-07-06", 2_900),
    );

    const capture = await captureHostedGrowthDailySnapshot(now);

    expect(capture.activityAvailable).toBe(true);
    const upsertArg = mocks.hostedGrowthDailySnapshot.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create).toMatchObject({
      activeUsersPriorDay: null,
      activeUsersTrailing7Days: null,
    });
    expect(upsertArg?.update).toMatchObject({
      activeUsersPriorDay: null,
      activeUsersTrailing7Days: null,
    });
  });

  it("creates unknown activity without overwriting exact activity after attribution failure", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const registeredPhone = requireLinqContact("phone", "+15550000001");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildLinqGroupMailboxRow({
        contact: registeredPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-05T08:00:00.000Z"),
      }),
    ]);
    mocks.decodeHostedMailboxStoredPayload.mockRejectedValueOnce(
      new Error("unavailable sidecar"),
    );
    mocks.hostedMailboxItem.count.mockResolvedValueOnce(42);
    mocks.hostedLinqDelivery.count.mockResolvedValueOnce(57);
    mocks.hostedGrowthDailySnapshot.upsert.mockResolvedValueOnce(
      snapshotRow("2026-07-06", 2_900),
    );

    try {
      const capture = await captureHostedGrowthDailySnapshot(now);
      expect(capture.activityAvailable).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        "Hosted growth activity snapshot attribution failed; preserving existing activity aggregates when present.",
      );
    } finally {
      errorSpy.mockRestore();
    }

    const upsertArg = mocks.hostedGrowthDailySnapshot.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create).toMatchObject({
      activeUsersPriorDay: null,
      activeUsersTrailing7Days: null,
      inboundMessagesPriorDay: 42,
      mrrUsdCents: 2_800,
      outboundMessagesPriorDay: 57,
    });
    expect(upsertArg?.update).toMatchObject({
      inboundMessagesPriorDay: 42,
      mrrUsdCents: 2_800,
      outboundMessagesPriorDay: 57,
    });
    expect(upsertArg?.update).not.toHaveProperty("activeUsersPriorDay");
    expect(upsertArg?.update).not.toHaveProperty("activeUsersTrailing7Days");
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

  it("reports activity failure after preserving the legacy cron snapshot", async () => {
    const registeredPhone = requireLinqContact("phone", "+15550000001");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    queueCurrentMetricMocks();
    mocks.hostedMailboxItem.findMany.mockResolvedValueOnce([
      buildLinqGroupMailboxRow({
        contact: registeredPhone,
        containerMemberId: "thread_container_one",
        occurredAt: new Date("2026-07-05T08:00:00.000Z"),
      }),
    ]);
    mocks.decodeHostedMailboxStoredPayload.mockRejectedValueOnce(
      new Error("unavailable sidecar"),
    );
    mocks.hostedMailboxItem.count.mockResolvedValueOnce(42);
    mocks.hostedLinqDelivery.count.mockResolvedValueOnce(57);
    mocks.hostedGrowthDailySnapshot.upsert.mockResolvedValueOnce(
      snapshotRow("2026-07-06", 2_900),
    );

    try {
      const response = await growthCronRoute.GET(new Request(
        "https://join.example.test/api/internal/hosted-growth/snapshot/cron",
      ));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "HOSTED_GROWTH_ACTIVITY_UNAVAILABLE",
        },
      });
    } finally {
      errorSpy.mockRestore();
    }

    const upsertArg = mocks.hostedGrowthDailySnapshot.upsert.mock.calls[0]?.[0];
    expect(upsertArg?.create).toMatchObject({
      activeUsersPriorDay: null,
      activeUsersTrailing7Days: null,
      inboundMessagesPriorDay: 42,
      outboundMessagesPriorDay: 57,
    });
    expect(upsertArg?.update).not.toHaveProperty("activeUsersPriorDay");
    expect(upsertArg?.update).not.toHaveProperty("activeUsersTrailing7Days");
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

function activeUserRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    userId: `member_${index + 1}`,
  }));
}

function requireLinqContact(
  kind: "email" | "phone",
  value: string,
): NonNullable<ReturnType<typeof createHostedLinqParticipantContact>> {
  const contact = createHostedLinqParticipantContact({ kind, value });
  if (!contact) {
    throw new Error("Expected a valid Linq participant contact.");
  }
  return contact;
}

function requireTelegramLookupKey(userId: string): string {
  const [lookupKey] = createHostedTelegramUserLookupKeyReadCandidates(userId);
  if (!lookupKey) {
    throw new Error("Expected a valid Telegram user lookup key.");
  }
  return lookupKey;
}

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion =
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
      previousCurrentVersion,
    );
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function buildLinqGroupMailboxRow(input: {
  contact: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
  containerMemberId: string;
  createdAt?: Date;
  from?: string;
  occurredAt: Date;
  senderMemberId?: string;
}) {
  const eventId = [
    "linq",
    input.containerMemberId,
    input.occurredAt.getTime(),
    input.contact.lookupKey,
  ].join("_");
  const threadId = `thread_${input.containerMemberId}`;
  const wake = buildHostedExecutionLinqConversationMessageWake({
    contactKind: input.contact.kind,
    contactLookupKey: input.contact.lookupKey,
    eventId,
    linqMessage: {
      chatId: threadId,
      from: input.from ?? input.contact.value,
      isFromMe: false,
      messageId: eventId,
      parts: [{ type: "text", value: "hello" }],
      threadIsDirect: false,
    },
    occurredAt: input.occurredAt.toISOString(),
    phoneLookupKey:
      input.contact.kind === "phone" ? input.contact.lookupKey : null,
    routeAuthority: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      threadId,
    },
    ...(input.senderMemberId
      ? { senderMemberId: input.senderMemberId }
      : {}),
    userId: input.containerMemberId,
  });

  return buildGroupMailboxRow({
    containerMemberId: input.containerMemberId,
    createdAt: input.createdAt,
    eventId,
    occurredAt: input.occurredAt,
    wake,
  });
}

function buildTelegramGroupMailboxRow(input: {
  containerMemberId: string;
  occurredAt: Date;
  senderMemberId?: string;
  senderUserId?: string;
}) {
  const eventId = [
    "telegram",
    input.containerMemberId,
    input.occurredAt.getTime(),
    input.senderUserId ?? "unattributed",
  ].join("_");
  const threadId = `thread_${input.containerMemberId}`;
  const wake = buildHostedExecutionTelegramConversationMessageWake({
    eventId,
    occurredAt: input.occurredAt.toISOString(),
    routeAuthority: {
      channel: "telegram",
      containerMemberId: input.containerMemberId,
      threadId,
    },
    ...(input.senderMemberId
      ? { senderMemberId: input.senderMemberId }
      : {}),
    telegramMessage: {
      ...(input.senderUserId ? { from: input.senderUserId } : {}),
      messageId: eventId,
      schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
      text: "hello",
      threadId,
      threadIsDirect: false,
    },
    userId: input.containerMemberId,
  });

  return buildGroupMailboxRow({
    containerMemberId: input.containerMemberId,
    eventId,
    occurredAt: input.occurredAt,
    wake,
  });
}

function buildLinqGroupReactionMailboxRow(input: {
  contact: NonNullable<ReturnType<typeof createHostedLinqParticipantContact>>;
  containerMemberId: string;
  occurredAt: Date;
}) {
  const eventId = createHostedExecutionGroupReactionEventId([
    "linq-reaction",
    input.containerMemberId,
    input.occurredAt.getTime(),
  ].join("_"));
  const threadId = `thread_${input.containerMemberId}`;
  const wake = buildHostedExecutionLinqConversationMessageWake({
    contactKind: input.contact.kind,
    contactLookupKey: input.contact.lookupKey,
    eventId,
    linqMessage: {
      chatId: threadId,
      from: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
      isFromMe: false,
      messageId: eventId,
      parts: [{
        type: "text",
        value: formatHostedExecutionGroupReactionEventText({
          actor: input.contact.value,
          changes: [{ operation: "added", reaction: "like" }],
          channel: "linq",
          mode: "delta",
          targetMessageId: "target_message",
          targetText: null,
        }),
      }],
      reactionEligible: false,
      replyToMessageId: "target_message",
      service: "iMessage",
      threadIsDirect: false,
    },
    occurredAt: input.occurredAt.toISOString(),
    routeAuthority: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      threadId,
    },
    userId: input.containerMemberId,
  });

  return buildGroupMailboxRow({
    containerMemberId: input.containerMemberId,
    eventId,
    occurredAt: input.occurredAt,
    wake,
  });
}

function buildTelegramGroupReactionMailboxRow(input: {
  containerMemberId: string;
  occurredAt: Date;
}) {
  const eventId = createHostedExecutionGroupReactionEventId([
    "telegram-reaction",
    input.containerMemberId,
    input.occurredAt.getTime(),
  ].join("_"));
  const threadId = `thread_${input.containerMemberId}`;
  const wake = buildHostedExecutionTelegramConversationMessageWake({
    eventId,
    occurredAt: input.occurredAt.toISOString(),
    routeAuthority: {
      channel: "telegram",
      containerMemberId: input.containerMemberId,
      threadId,
    },
    telegramMessage: {
      from: HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
      messageId: eventId,
      schema: HOSTED_EXECUTION_TELEGRAM_MESSAGE_SCHEMA,
      text: formatHostedExecutionGroupReactionEventText({
        actor: "Group Member",
        changes: [{ operation: "added", reaction: "👍" }],
        channel: "telegram",
        mode: "delta",
        targetMessageId: "target_message",
        targetText: null,
      }),
      threadId,
      threadIsDirect: false,
    },
    userId: input.containerMemberId,
  });

  return buildGroupMailboxRow({
    containerMemberId: input.containerMemberId,
    eventId,
    occurredAt: input.occurredAt,
    wake,
  });
}

function buildEmailGroupMailboxRow(input: {
  containerMemberId: string;
  occurredAt: Date;
}) {
  const eventId = [
    "email",
    input.containerMemberId,
    input.occurredAt.getTime(),
  ].join("_");
  const wake = buildHostedExecutionEmailConversationMessageWake({
    eventId,
    from: "group-sender@example.test",
    identityId: null,
    occurredAt: input.occurredAt.toISOString(),
    rawMessageKey: `raw_${eventId}`,
    threadIsDirect: false,
    userId: input.containerMemberId,
  });

  return buildGroupMailboxRow({
    containerMemberId: input.containerMemberId,
    eventId,
    occurredAt: input.occurredAt,
    wake,
  });
}

function buildGroupMailboxRow(input: {
  containerMemberId: string;
  createdAt?: Date;
  eventId: string;
  occurredAt: Date;
  wake: HostedExecutionConversationMessageWake;
}): {
  contentRetiredAt: Date | null;
  createdAt: Date;
  dedupeKey: string;
  id: string;
  kind: string;
  lane: string;
  laneSeq: bigint;
  occurredAt: Date;
  payload: null;
  payloadInlineCiphertext: string | null;
  payloadRef: string | null;
  payloadSchema: string;
  userId: string;
} {
  return {
    contentRetiredAt: null,
    createdAt: input.createdAt ?? input.occurredAt,
    dedupeKey: input.eventId,
    id: `mailbox_${input.eventId}`,
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: 1n,
    occurredAt: input.occurredAt,
    payload: null,
    payloadInlineCiphertext: JSON.stringify(input.wake),
    payloadRef: null,
    payloadSchema: "murph.hosted-mailbox-item-payload.v1",
    userId: input.containerMemberId,
  };
}

function retireGroupMailboxRow(
  row: ReturnType<typeof buildGroupMailboxRow>,
): ReturnType<typeof buildGroupMailboxRow> {
  return {
    ...row,
    contentRetiredAt: new Date("2026-07-06T00:00:00.000Z"),
    payload: null,
    payloadInlineCiphertext: null,
    payloadRef: null,
  };
}

function snapshotRow(date: string, mrrUsdCents: number) {
  return {
    activeUsersPriorDay: null,
    activeUsersTrailing7Days: null,
    capturedAt: new Date(`${date}T00:05:00.000Z`),
    coveredMembers: 3,
    familyMrrUsdCents: null,
    inboundMessagesPriorDay: 0,
    individualMrrUsdCents: null,
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
