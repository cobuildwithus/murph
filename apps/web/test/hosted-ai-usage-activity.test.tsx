import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/src/lib/hosted-growth/usage-referral", () => ({
  buildHostedUsageReferralOutstandingWhere: mocks.buildOutstandingWhere,
  getHostedUsageReferralPolicyDisplay: mocks.policyDisplay,
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
  it("projects purchase grants and active or completed missions", async () => {
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
    expect(mocks.missionFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      take: 50,
      where: {
        OR: outstandingWhere,
        referrerMemberId: "member_123",
      },
    }));
    expect(mocks.missionFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      take: 46,
      where: {
        referrerMemberId: "member_123",
        status: "rewarded",
      },
    }));
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
        rewardLabel: "$3.50",
        selectedLabel: "Jul 28, 2026",
        status: "reward_pending",
        statusLabel: "Reward pending",
        timingLabel: "Qualified Jul 29",
      },
      {
        destinationLabel: "the group",
        id: "hur_checking_final",
        rewardLabel: "$3.50",
        selectedLabel: "Jul 28, 2026",
        status: "checking_final_activity",
        statusLabel: "Checking final activity",
        timingLabel: "Closed Jul 29 at 11:00 AM UTC",
      },
      {
        destinationLabel: "the group",
        id: "hur_in_progress",
        rewardLabel: "$3.50",
        selectedLabel: "Jul 27, 2026",
        status: "in_progress",
        statusLabel: "In progress",
        timingLabel: "Ends Aug 3 at 12:00 PM UTC",
      },
      {
        destinationLabel: "your Murph",
        id: "hur_waiting",
        rewardLabel: "$2.00",
        selectedLabel: "Jul 26, 2026",
        status: "waiting_for_group",
        statusLabel: "Waiting for a new group",
        timingLabel: "Start by Aug 2 at 12:00 PM UTC",
      },
      {
        destinationLabel: "your Murph",
        id: "hur_completed",
        rewardLabel: "$2.00",
        selectedLabel: "Jul 10, 2026",
        status: "completed",
        statusLabel: "Completed",
        timingLabel: "Earned Jul 16",
      },
    ]);
    expect(activity.missionsEnabled).toBe(true);
  });

  it("switches an unqualified bound mission to final checking at its exact cutoff", async () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const row = (input: { expiresAt: Date; id: string }) => ({
      armedAt: new Date("2026-07-28T12:00:00.000Z"),
      beneficiaryMemberId: "member_group",
      expiresAt: input.expiresAt,
      id: input.id,
      policyCode: "active_group_v1",
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
    });
  });
});

describe("HostedAiUsageActivity", () => {
  it("keeps earned mission credit visible while purchase history stays explicitly scoped", async () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    mocks.creditFindMany.mockResolvedValue([]);
    mocks.missionFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        armedAt: new Date("2026-07-10T12:00:00.000Z"),
        beneficiaryMemberId: "member_123",
        expiresAt: new Date("2026-07-17T12:00:00.000Z"),
        id: "hur_completed_without_purchase",
        policyCode: "new_person_activation_v1",
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
    const { HostedAiUsageActivity } = await import(
      "@/src/components/settings/hosted-ai-usage-activity"
    );
    const markup = renderToStaticMarkup(createElement(HostedAiUsageActivity, {
      activity,
      missionContactOption: null,
    }));

    assert.match(markup, /Bring someone new to Murph/);
    assert.match(markup, /Completed/);
    assert.match(markup, /\$2\.00/);
    assert.match(markup, /History/);
    assert.doesNotMatch(markup, /Purchased credits/);
    assert.doesNotMatch(markup, /No (?:purchased|usage) credits yet/);
  });

  it("renders a single ledger surface and prefilled Murph handoff", async () => {
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
            rewardLabel: "$3.50",
            selectedLabel: "Jul 27, 2026",
            status: "in_progress",
            statusLabel: "In progress",
            timingLabel: "Ends Aug 3, 2026",
            title: "Start an active group",
          },
          {
            destinationLabel: "the group",
            id: "mission_2",
            requirementsLabel: "Wait while Murph checks final activity.",
            rewardLabel: "$3.50",
            selectedLabel: "Jul 28, 2026",
            status: "checking_final_activity",
            statusLabel: "Checking final activity",
            timingLabel: "Closed Jul 29, 2026",
            title: "Start an active group",
          },
        ],
        missionsEnabled: true,
      },
      missionContactOption: {
        href: "sms:+15550100001?body=mission",
        kind: "text",
        label: "Messages",
      },
    }));

    assert.match(markup, /<h3[^>]*>Referrals<\/h3>/);
    assert.match(markup, /aria-label="Current usage referrals"/);
    assert.match(markup, />History</);
    assert.match(markup, /aria-label="Usage activity history"/);
    assert.match(markup, /Usage purchase/);
    assert.match(markup, /Purchased by you/);
    assert.doesNotMatch(markup, /bar above/);
    assert.doesNotMatch(markup, /Remaining|\$6\.42/);
    assert.match(markup, /Start an active group/);
    assert.match(markup, /to the group/);
    const detailOpeningTags = markup.match(/<details\b[^>]*>/gu) ?? [];
    assert.equal(detailOpeningTags.length, 3);
    detailOpeningTags.forEach((openingTag) => {
      assert.doesNotMatch(openingTag, /\sopen(?:=|\s|>)/u);
    });
    assert.match(markup, /Start a fresh group and get people talking\./);
    assert.match(markup, /Selected Jul 27, 2026/);
    assert.match(markup, /Wait while Murph checks final activity\./);
    assert.match(markup, /Selected Jul 28, 2026/);
    assert.equal(markup.match(/>Details</gu)?.length, 2);
    assert.match(
      markup,
      /aria-label="Details for Start an active group: In progress, Ends Aug 3, 2026"/,
    );
    assert.match(
      markup,
      /aria-label="Details for Start an active group: Checking final activity, Closed Jul 29, 2026"/,
    );
    assert.ok(
      markup.indexOf("Checking final activity") < markup.indexOf(">History"),
    );
    assert.doesNotMatch(markup, /Amounts added, not current balance/);
    assert.match(markup, /Ask Murph/);
    assert.match(
      markup,
      /aria-label="Ask Murph about referrals in Messages"/,
    );
    assert.match(markup, /href="sms:\+15550100001\?body=mission"/);
    assert.doesNotMatch(markup, /<table/);
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
      rewardLabel: "$3.50",
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
    }));
    const historyIndex = markup.indexOf(">History");

    assert.notEqual(historyIndex, -1);
    for (const label of ["Waiting", "Active", "Checking", "Reward pending"]) {
      assert.ok(markup.indexOf(`Referral ${label}`) < historyIndex);
    }
    assert.ok(markup.indexOf("Referral Completed") > historyIndex);
    assert.match(markup, /aria-label="Current usage referrals"/);
    for (const label of ["Waiting", "Active", "Checking", "Reward pending"]) {
      assert.match(
        markup,
        new RegExp(
          `aria-label="Details for Referral ${label}: ${label}, Timing for ${label}"`,
          "u",
        ),
      );
    }
    assert.equal(markup.match(/>Details</gu)?.length, 4);
  });

  it("keeps compact referral guidance visible alongside existing History", async () => {
    const { HostedAiUsageActivity } = await import(
      "@/src/components/settings/hosted-ai-usage-activity"
    );
    const markup = renderToStaticMarkup(createElement(HostedAiUsageActivity, {
      activity: {
        credits: [{
          addedLabel: "$5.00",
          dateLabel: "Jul 29, 2026",
          id: "credit_with_empty_referrals",
          sourceLabel: "Purchased by you",
        }],
        missions: [{
          destinationLabel: "your Murph",
          id: "completed_with_empty_referrals",
          requirementsLabel: "Invite a friend.",
          rewardLabel: "$2.00",
          selectedLabel: "Jul 10, 2026",
          status: "completed",
          statusLabel: "Completed",
          timingLabel: "Earned Jul 16, 2026",
          title: "Completed referral",
        }],
        missionsEnabled: true,
      },
      missionContactOption: {
        href: "sms:+15550100001?body=mission",
        kind: "text",
        label: "Messages",
      },
    }));

    assert.match(
      markup,
      /Earn usage by inviting friends or adding Murph to a groupchat/,
    );
    assert.match(markup, />History</);
    assert.match(markup, /Completed referral/);
    assert.match(markup, /Usage purchase/);
  });

  it("keeps completed history while hiding the mission handoff when new missions are disabled", async () => {
    const { HostedAiUsageActivity } = await import(
      "@/src/components/settings/hosted-ai-usage-activity"
    );
    const markup = renderToStaticMarkup(createElement(HostedAiUsageActivity, {
      activity: {
        credits: [],
        missions: [
          {
            destinationLabel: "your Murph",
            id: "mission_completed",
            requirementsLabel: "Complete the selected mission.",
            rewardLabel: "$2.00",
            selectedLabel: "Jul 10, 2026",
            status: "completed",
            statusLabel: "Completed",
            timingLabel: "Earned Jul 16, 2026",
            title: "Completed mission",
          },
        ],
        missionsEnabled: false,
      },
      missionContactOption: {
        href: "sms:+15550100001?body=mission",
        kind: "text",
        label: "Messages",
      },
    }));

    assert.match(markup, /Completed mission/);
    assert.match(markup, /<h3[^>]*>Referrals<\/h3>/);
    assert.match(markup, />History</);
    assert.doesNotMatch(markup, /Purchased credits/);
    assert.doesNotMatch(markup, /No active referrals/);
    assert.doesNotMatch(
      markup,
      /aria-label="Ask Murph about referrals/,
    );
    assert.doesNotMatch(markup, /href="sms:/);
  });

  it("renders email-only purchased credits without a mission invitation", async () => {
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
    }));

    assert.match(markup, /Purchased credits/);
    assert.match(markup, /aria-label="Usage activity history"/);
    assert.match(markup, /Usage purchase/);
    assert.match(markup, /Added for you/);
    assert.doesNotMatch(markup, /<h3[^>]*>Referrals<\/h3>/);
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
    }));

    assert.match(markup, /<h3[^>]*>Referrals<\/h3>/);
    assert.match(markup, /Ask Murph/);
    assert.match(
      markup,
      /Earn usage by inviting friends or adding Murph to a groupchat/,
    );
    assert.doesNotMatch(markup, /No purchased credits yet/);
    assert.doesNotMatch(markup, /<details/);
  });

  it("renders email-only mission history without action-oriented copy", async () => {
    const { HostedAiUsageActivity } = await import(
      "@/src/components/settings/hosted-ai-usage-activity"
    );
    const markup = renderToStaticMarkup(createElement(HostedAiUsageActivity, {
      activity: {
        credits: [],
        missions: [{
          destinationLabel: "your Murph",
          id: "mission_email_history",
          requirementsLabel: "Complete the selected mission.",
          rewardLabel: "$2.00",
          selectedLabel: "Jul 20, 2026",
          status: "completed",
          statusLabel: "Completed",
          timingLabel: "Earned Jul 27, 2026",
          title: "Completed mission",
        }],
        missionsEnabled: true,
      },
      missionContactOption: null,
    }));

    assert.match(markup, /<h3[^>]*>Referrals<\/h3>/);
    assert.match(markup, /Completed mission/);
    assert.doesNotMatch(markup, /Purchased credits/);
    assert.doesNotMatch(markup, /aria-label="Ask Murph about referrals/);
  });
});
