import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORDINARY_POLICY_VERSION = "hosted-usage-referral-2026-07-v1";
const SIGNUP_POLICY_VERSION =
  "hosted-signup-referral-activation-2026-08-v1";

const mocks = vi.hoisted(() => ({
  buildOutstandingWhere: vi.fn(),
  creditFindMany: vi.fn(),
  getPrisma: vi.fn(),
  isReferralEnabled: vi.fn(),
  missionFindMany: vi.fn(),
  policyDisplay: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-growth/signup-referral-policy", () => ({
  HOSTED_SIGNUP_REFERRAL_POLICY_VERSION: SIGNUP_POLICY_VERSION,
  HOSTED_SIGNUP_REFERRAL_POLICY_DISPLAY: {
    requirementsLabel:
      "A new member completed Murph setup through your referral link.",
    title: "Invite someone to Murph",
  },
  isHostedSignupReferralPolicyVersion: (policyVersion: string) =>
    policyVersion === SIGNUP_POLICY_VERSION,
}));

vi.mock("@/src/lib/hosted-growth/usage-referral", () => ({
  buildHostedUsageReferralOutstandingWhere: mocks.buildOutstandingWhere,
  getHostedUsageReferralPolicyDisplay: mocks.policyDisplay,
}));

vi.mock("@/src/lib/hosted-growth/usage-referral-policy", () => ({
  HOSTED_USAGE_REFERRAL_POLICY_VERSION: ORDINARY_POLICY_VERSION,
  isHostedUsageReferralEnabled: mocks.isReferralEnabled,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPrisma.mockReturnValue({
    hostedUsageCreditEntry: {
      findMany: mocks.creditFindMany,
    },
    hostedUsageReferral: {
      findMany: mocks.missionFindMany,
    },
  });
  mocks.buildOutstandingWhere.mockImplementation((now: Date) => [
    {
      expiresAt: { gt: now },
      status: "armed",
    },
  ]);
  mocks.isReferralEnabled.mockReturnValue(true);
  mocks.policyDisplay.mockImplementation((policyCode: string) =>
    policyCode === "active_group_v1"
      ? {
          requirementsLabel:
            "Start a fresh group and make it genuinely active, with multiple people actually talking.",
          title: "Start an active group",
        }
      : {
          requirementsLabel:
            "Bring one new person into a fresh Murph group. Murph handles onboarding, and the mission completes once they join the conversation with their own Murph.",
          title: "Bring someone new to Murph",
        }
  );
});

describe("readHostedAiUsageActivity", () => {
  it("projects purchase grants and every ordinary mission state", async () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const outstandingWhere = [
      {
        expiresAt: { gt: now },
        status: "armed",
      },
    ];
    mocks.buildOutstandingWhere.mockReturnValue(outstandingWhere);
    mocks.creditFindMany.mockResolvedValue([
      {
        amountUsdMicros: 10_000_000n,
        effectiveAt: new Date("2026-07-24T18:00:00.000Z"),
        id: "huce_purchase_1",
        purchase: { payerMemberId: "member_123" },
      },
      {
        amountUsdMicros: 5_000_000n,
        effectiveAt: new Date("2026-07-12T18:00:00.000Z"),
        id: "huce_purchase_2",
        purchase: { payerMemberId: "member_family_owner" },
      },
    ]);
    mocks.missionFindMany.mockResolvedValueOnce([
      {
        armedAt: new Date("2026-07-26T12:00:00.000Z"),
        beneficiaryMemberId: "member_123",
        expiresAt: new Date("2026-08-02T12:00:00.000Z"),
        id: "hur_waiting",
        policyCode: "new_person_activation_v1",
        policyVersion: ORDINARY_POLICY_VERSION,
        qualifiedAt: null,
        rewardedAt: null,
        rewardUsdMicros: 2_000_000n,
        status: "armed",
      },
      {
        armedAt: new Date("2026-07-27T12:00:00.000Z"),
        beneficiaryMemberId: "member_group",
        expiresAt: new Date("2026-08-03T12:00:00.000Z"),
        id: "hur_in_progress",
        policyCode: "active_group_v1",
        policyVersion: ORDINARY_POLICY_VERSION,
        qualifiedAt: null,
        rewardedAt: null,
        rewardUsdMicros: 3_500_000n,
        status: "target_bound",
      },
      {
        armedAt: new Date("2026-07-28T10:00:00.000Z"),
        beneficiaryMemberId: "member_group",
        expiresAt: new Date("2026-07-29T11:00:00.000Z"),
        id: "hur_checking_final",
        policyCode: "active_group_v1",
        policyVersion: ORDINARY_POLICY_VERSION,
        qualifiedAt: null,
        rewardedAt: null,
        rewardUsdMicros: 3_500_000n,
        status: "target_bound",
      },
      {
        armedAt: new Date("2026-07-28T12:00:00.000Z"),
        beneficiaryMemberId: "member_group",
        expiresAt: new Date("2026-08-04T12:00:00.000Z"),
        id: "hur_pending",
        policyCode: "active_group_v1",
        policyVersion: ORDINARY_POLICY_VERSION,
        qualifiedAt: new Date("2026-07-29T11:00:00.000Z"),
        rewardedAt: null,
        rewardUsdMicros: 3_500_000n,
        status: "target_bound",
      },
    ]).mockResolvedValueOnce([
      {
        armedAt: new Date("2026-07-10T12:00:00.000Z"),
        beneficiaryMemberId: "member_123",
        expiresAt: new Date("2026-07-17T12:00:00.000Z"),
        id: "hur_completed",
        policyCode: "new_person_activation_v1",
        policyVersion: ORDINARY_POLICY_VERSION,
        qualifiedAt: new Date("2026-07-16T11:00:00.000Z"),
        rewardedAt: new Date("2026-07-16T12:00:00.000Z"),
        rewardUsdMicros: 2_000_000n,
        status: "rewarded",
      },
    ]);

    const { readHostedAiUsageActivity } = await import(
      "@/src/lib/hosted-execution/usage-activity"
    );
    const activity = await readHostedAiUsageActivity({
      memberId: "member_123",
      now,
    });

    expect(mocks.creditFindMany).toHaveBeenCalledWith({
      orderBy: [
        { beneficiarySequence: "desc" },
        { id: "desc" },
      ],
      select: {
        amountUsdMicros: true,
        effectiveAt: true,
        id: true,
        purchase: {
          select: {
            payerMemberId: true,
          },
        },
      },
      take: 50,
      where: {
        beneficiaryMemberId: "member_123",
        kind: "purchase_grant",
      },
    });
    expect(mocks.missionFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        select: expect.objectContaining({
          policyVersion: true,
          rewardUsdMicros: true,
        }),
        take: 50,
        where: {
          OR: outstandingWhere,
          referrerMemberId: "member_123",
        },
      }),
    );
    expect(mocks.missionFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        select: expect.objectContaining({
          policyVersion: true,
          rewardUsdMicros: true,
        }),
        take: 46,
        where: {
          referrerMemberId: "member_123",
          status: "rewarded",
        },
      }),
    );
    expect(activity.credits).toEqual([
      {
        addedLabel: "$10.00",
        dateLabel: "Jul 24, 2026",
        id: "huce_purchase_1",
        sourceLabel: "Purchased by you",
      },
      {
        addedLabel: "$5.00",
        dateLabel: "Jul 12, 2026",
        id: "huce_purchase_2",
        sourceLabel: "Added for you",
      },
    ]);
    expect(activity.missions.map((mission) => ({
      destinationLabel: mission.destinationLabel,
      id: mission.id,
      rewardLabel: mission.rewardLabel,
      selectedLabel: mission.selectedLabel,
      status: mission.status,
      statusLabel: mission.statusLabel,
      timingLabel: mission.timingLabel,
    }))).toEqual([
      {
        destinationLabel: "the group",
        id: "hur_pending",
        rewardLabel: "About 14 more days of Murph usage",
        selectedLabel: "Jul 28, 2026",
        status: "reward_pending",
        statusLabel: "Reward pending",
        timingLabel: "Qualified Jul 29",
      },
      {
        destinationLabel: "the group",
        id: "hur_checking_final",
        rewardLabel: "About 14 more days of Murph usage",
        selectedLabel: "Jul 28, 2026",
        status: "checking_final_activity",
        statusLabel: "Checking final activity",
        timingLabel: "Closed Jul 29 at 11:00 AM UTC",
      },
      {
        destinationLabel: "the group",
        id: "hur_in_progress",
        rewardLabel: "About 14 more days of Murph usage",
        selectedLabel: "Jul 27, 2026",
        status: "in_progress",
        statusLabel: "In progress",
        timingLabel: "Ends Aug 3 at 12:00 PM UTC",
      },
      {
        destinationLabel: "your Murph",
        id: "hur_waiting",
        rewardLabel: "About 10 more days of Murph usage",
        selectedLabel: "Jul 26, 2026",
        status: "waiting_for_group",
        statusLabel: "Waiting for a new group",
        timingLabel: "Start by Aug 2 at 12:00 PM UTC",
      },
      {
        destinationLabel: "your Murph",
        id: "hur_completed",
        rewardLabel: "About 10 more days of Murph usage",
        selectedLabel: "Jul 10, 2026",
        status: "completed",
        statusLabel: "Completed",
        timingLabel: "Earned Jul 16",
      },
    ]);
    expect(activity.missionsEnabled).toBe(true);
  });

  it("uses persisted policy semantics for completed signup-link rewards", async () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    mocks.creditFindMany.mockResolvedValue([]);
    mocks.missionFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        armedAt: new Date("2026-08-05T12:00:00.000Z"),
        beneficiaryMemberId: "member_123",
        expiresAt: new Date("2026-08-12T12:00:00.000Z"),
        id: "hur_signup_link",
        policyCode: "new_person_activation_v1",
        policyVersion: SIGNUP_POLICY_VERSION,
        qualifiedAt: new Date("2026-08-06T10:00:00.000Z"),
        rewardedAt: new Date("2026-08-06T10:01:00.000Z"),
        rewardUsdMicros: 2_750_000n,
        status: "rewarded",
      },
    ]);

    const { readHostedAiUsageActivity } = await import(
      "@/src/lib/hosted-execution/usage-activity"
    );
    const activity = await readHostedAiUsageActivity({
      memberId: "member_123",
      now,
    });

    expect(activity.missions).toEqual([
      expect.objectContaining({
        id: "hur_signup_link",
        requirementsLabel:
          "A new member completed Murph setup through your referral link.",
        rewardLabel: "About 12 more days of Murph usage",
        title: "Invite someone to Murph",
      }),
    ]);
    expect(mocks.policyDisplay).not.toHaveBeenCalled();
  });

  it("omits cap-disqualified signup activations from Settings history", async () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    mocks.creditFindMany.mockResolvedValue([]);
    mocks.missionFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const { readHostedAiUsageActivity } = await import(
      "@/src/lib/hosted-execution/usage-activity"
    );
    const activity = await readHostedAiUsageActivity({
      memberId: "member_123",
      now,
    });

    expect(mocks.missionFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          referrerMemberId: "member_123",
          status: "rewarded",
        },
      }),
    );
    expect(activity.missions).toEqual([]);
  });

  it("switches an unqualified bound mission to final checking at its exact cutoff", async () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const row = (input: { expiresAt: Date; id: string }) => ({
      armedAt: new Date("2026-07-28T12:00:00.000Z"),
      beneficiaryMemberId: "member_group",
      expiresAt: input.expiresAt,
      id: input.id,
      policyCode: "active_group_v1",
      policyVersion: ORDINARY_POLICY_VERSION,
      qualifiedAt: null,
      rewardedAt: null,
      rewardUsdMicros: 3_500_000n,
      status: "target_bound",
    });
    mocks.creditFindMany.mockResolvedValue([]);
    mocks.missionFindMany.mockResolvedValueOnce([
      row({
        expiresAt: new Date(now.getTime() - 1),
        id: "hur_after_cutoff",
      }),
      row({
        expiresAt: new Date(now.getTime() + 1),
        id: "hur_before_cutoff",
      }),
    ]).mockResolvedValueOnce([]);

    const { readHostedAiUsageActivity } = await import(
      "@/src/lib/hosted-execution/usage-activity"
    );
    const activity = await readHostedAiUsageActivity({
      memberId: "member_123",
      now,
    });

    expect(activity.missions.map((mission) => ({
      id: mission.id,
      status: mission.status,
      statusLabel: mission.statusLabel,
      timingLabel: mission.timingLabel,
    }))).toEqual([
      {
        id: "hur_after_cutoff",
        status: "checking_final_activity",
        statusLabel: "Checking final activity",
        timingLabel: "Closed Jul 29 at 11:59 AM UTC",
      },
      {
        id: "hur_before_cutoff",
        status: "in_progress",
        statusLabel: "In progress",
        timingLabel: "Ends Jul 29 at 12:00 PM UTC",
      },
    ]);
  });

  it("keeps the year in mission timing when the deadline crosses into a new year", async () => {
    const now = new Date("2026-12-31T23:30:00.000Z");
    mocks.creditFindMany.mockResolvedValue([]);
    mocks.missionFindMany.mockResolvedValueOnce([
      {
        armedAt: new Date("2026-12-31T12:00:00.000Z"),
        beneficiaryMemberId: "member_group",
        expiresAt: new Date("2027-01-01T00:30:00.000Z"),
        id: "hur_cross_year",
        policyCode: "active_group_v1",
        policyVersion: ORDINARY_POLICY_VERSION,
        qualifiedAt: null,
        rewardedAt: null,
        rewardUsdMicros: 3_500_000n,
        status: "target_bound",
      },
    ]).mockResolvedValueOnce([]);

    const { readHostedAiUsageActivity } = await import(
      "@/src/lib/hosted-execution/usage-activity"
    );
    const activity = await readHostedAiUsageActivity({
      memberId: "member_123",
      now,
    });

    expect(activity.missions[0]?.timingLabel).toBe(
      "Ends Jan 1, 2027 at 12:30 AM UTC",
    );
  });

  it("does not fan out its bounded database reads", async () => {
    let resolveCredits!: (rows: unknown[]) => void;
    let resolveOutstanding!: (rows: unknown[]) => void;
    let resolveRewarded!: (rows: unknown[]) => void;
    const credits = new Promise<unknown[]>((resolve) => {
      resolveCredits = resolve;
    });
    const outstanding = new Promise<unknown[]>((resolve) => {
      resolveOutstanding = resolve;
    });
    const rewarded = new Promise<unknown[]>((resolve) => {
      resolveRewarded = resolve;
    });
    mocks.creditFindMany.mockReturnValueOnce(credits);
    mocks.missionFindMany
      .mockReturnValueOnce(outstanding)
      .mockReturnValueOnce(rewarded);

    const { readHostedAiUsageActivity } = await import(
      "@/src/lib/hosted-execution/usage-activity"
    );
    const activityPromise = readHostedAiUsageActivity({
      memberId: "member_123",
      now: new Date("2026-07-29T12:00:00.000Z"),
    });

    expect(mocks.creditFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.missionFindMany).not.toHaveBeenCalled();

    resolveCredits([]);
    await Promise.resolve();
    expect(mocks.missionFindMany).toHaveBeenCalledTimes(1);

    resolveOutstanding([]);
    await Promise.resolve();
    expect(mocks.missionFindMany).toHaveBeenCalledTimes(2);

    resolveRewarded([]);
    await expect(activityPromise).resolves.toEqual({
      credits: [],
      missions: [],
      missionsEnabled: true,
      referralIdentityKey: "member_123",
    });
  });
});

describe("HostedAiUsageActivity", () => {
  it("renders referral actions, current missions, and one collapsed history", async () => {
    const { HostedAiUsageActivity } = await import(
      "@/src/components/settings/hosted-ai-usage-activity"
    );
    const markup = renderToStaticMarkup(createElement(HostedAiUsageActivity, {
      activity: {
        credits: [
          {
            addedLabel: "$10.00",
            dateLabel: "Jul 24, 2026",
            id: "credit_1",
            sourceLabel: "Purchased by you",
          },
        ],
        missions: [
          {
            destinationLabel: "the group",
            id: "mission_1",
            requirementsLabel: "Start a fresh group and get people talking.",
            rewardLabel: "About 14 more days of Murph usage",
            selectedLabel: "Jul 27, 2026",
            status: "in_progress",
            statusLabel: "In progress",
            timingLabel: "Ends Aug 3, 2026",
            title: "Start an active group",
          },
          {
            destinationLabel: "your Murph",
            id: "mission_completed",
            requirementsLabel: "Invite someone.",
            rewardLabel: "About 10 more days of Murph usage",
            selectedLabel: "Jul 10, 2026",
            status: "completed",
            statusLabel: "Completed",
            timingLabel: "Earned Jul 16, 2026",
            title: "Invite someone to Murph",
          },
        ],
        missionsEnabled: true,
      },
      missionContactOption: {
        href: "sms:+15550100001?body=mission",
        kind: "text",
        label: "Messages",
      },
      signupReferralUrl: "https://example.com/r/test-referral",
    }));

    assert.match(markup, /<h3[^>]*>Referrals<\/h3>/);
    assert.match(markup, />Copy link</);
    assert.match(markup, /Ask Murph/);
    assert.match(
      markup,
      /aria-label="Ask Murph about referrals in Messages"/,
    );
    assert.match(markup, /aria-label="Current usage referrals"/);
    assert.match(markup, /Start an active group/);
    assert.match(markup, /About 14 more days of Murph usage/);
    assert.match(markup, />History</);
    assert.match(markup, /aria-label="Usage activity history"/);
    assert.match(markup, /Invite someone to Murph/);
    assert.match(markup, /Usage purchase/);
    assert.match(markup, /Purchased by you/);
    assert.doesNotMatch(markup, /Remaining|\$3\.50|\$6\.42|<table/);
    const detailOpeningTags = markup.match(/<details\b[^>]*>/gu) ?? [];
    assert.equal(detailOpeningTags.length, 2);
    detailOpeningTags.forEach((openingTag) => {
      assert.doesNotMatch(openingTag, /\sopen(?:=|\s|>)/u);
    });
  });

  it("keeps every nonterminal referral current and only completed referrals in History", async () => {
    const { HostedAiUsageActivity } = await import(
      "@/src/components/settings/hosted-ai-usage-activity"
    );
    const mission = (
      id: string,
      status:
        | "checking_final_activity"
        | "completed"
        | "in_progress"
        | "reward_pending"
        | "waiting_for_group",
      statusLabel: string,
    ) => ({
      destinationLabel: "the group",
      id,
      requirementsLabel: `Requirements for ${statusLabel}`,
      rewardLabel: "About 14 more days of Murph usage",
      selectedLabel: "Jul 27, 2026",
      status,
      statusLabel,
      timingLabel: `Timing for ${statusLabel}`,
      title: `Referral ${statusLabel}`,
    });
    const markup = renderToStaticMarkup(createElement(HostedAiUsageActivity, {
      activity: {
        credits: [],
        missions: [
          mission("waiting", "waiting_for_group", "Waiting"),
          mission("active", "in_progress", "Active"),
          mission("checking", "checking_final_activity", "Checking"),
          mission("pending", "reward_pending", "Reward pending"),
          mission("completed", "completed", "Completed"),
        ],
        missionsEnabled: true,
      },
      missionContactOption: null,
      signupReferralUrl: "https://example.com/r/test-referral",
    }));
    const historyIndex = markup.indexOf(">History");

    assert.notEqual(historyIndex, -1);
    for (const label of ["Waiting", "Active", "Checking", "Reward pending"]) {
      assert.ok(markup.indexOf(`Referral ${label}`) < historyIndex);
    }
    assert.ok(markup.indexOf("Referral Completed") > historyIndex);
    assert.match(markup, /aria-label="Current usage referrals"/);
    assert.match(markup, />Copy link</);
    assert.doesNotMatch(markup, /Ask Murph/);
    assert.equal(markup.match(/>Details</gu)?.length, 4);
  });

  it("keeps the stable link when mission offers are disabled", async () => {
    const { HostedAiUsageActivity } = await import(
      "@/src/components/settings/hosted-ai-usage-activity"
    );
    const markup = renderToStaticMarkup(createElement(HostedAiUsageActivity, {
      activity: {
        credits: [],
        missions: [{
          destinationLabel: "your Murph",
          id: "mission_completed",
          requirementsLabel: "Complete the selected mission.",
          rewardLabel: "About 10 more days of Murph usage",
          selectedLabel: "Jul 10, 2026",
          status: "completed",
          statusLabel: "Completed",
          timingLabel: "Earned Jul 16, 2026",
          title: "Completed mission",
        }],
        missionsEnabled: false,
      },
      missionContactOption: {
        href: "sms:+15550100001?body=mission",
        kind: "text",
        label: "Messages",
      },
      signupReferralUrl: "https://example.com/r/test-referral",
    }));

    assert.match(markup, /<h3[^>]*>Referrals<\/h3>/);
    assert.match(markup, />Copy link</);
    assert.match(markup, /Completed mission/);
    assert.match(markup, />History</);
    assert.doesNotMatch(markup, /aria-label="Ask Murph about referrals/);
    assert.doesNotMatch(markup, /href="sms:/);
  });

  it("shows the stable link and purchase history for an email-only member", async () => {
    const { HostedAiUsageActivity } = await import(
      "@/src/components/settings/hosted-ai-usage-activity"
    );
    const markup = renderToStaticMarkup(createElement(HostedAiUsageActivity, {
      activity: {
        credits: [{
          addedLabel: "$5.00",
          dateLabel: "Jul 29, 2026",
          id: "credit_email_history",
          sourceLabel: "Added for you",
        }],
        missions: [],
        missionsEnabled: true,
      },
      missionContactOption: null,
      signupReferralUrl: "https://example.com/r/test-referral",
    }));

    assert.match(markup, /<h3[^>]*>Referrals<\/h3>/);
    assert.match(markup, />Copy link</);
    assert.match(markup, /Invite friends to Murph or ask about referral missions\./);
    assert.match(markup, /aria-label="Usage activity history"/);
    assert.match(markup, /Usage purchase/);
    assert.match(markup, /Added for you/);
    assert.doesNotMatch(markup, /Ask Murph/);
  });

  it("keeps the enabled empty state compact and actionable", async () => {
    const { HostedAiUsageActivity } = await import(
      "@/src/components/settings/hosted-ai-usage-activity"
    );
    const markup = renderToStaticMarkup(createElement(HostedAiUsageActivity, {
      activity: {
        credits: [],
        missions: [],
        missionsEnabled: true,
      },
      missionContactOption: {
        href: "sms:+15550100001?body=mission",
        kind: "text",
        label: "Messages",
      },
      signupReferralUrl: "https://example.com/r/test-referral",
    }));

    assert.match(markup, /<h3[^>]*>Referrals<\/h3>/);
    assert.match(markup, />Copy link</);
    assert.match(markup, /Ask Murph/);
    assert.match(markup, /Invite friends to Murph or ask about referral missions\./);
    assert.doesNotMatch(markup, /No purchased credits yet|<details/);
  });
});
