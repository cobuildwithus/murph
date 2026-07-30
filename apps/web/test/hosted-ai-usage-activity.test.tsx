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
        timingLabel: "Qualified Jul 29, 2026",
      },
      {
        destinationLabel: "the group",
        id: "hur_checking_final",
        rewardLabel: "$3.50",
        selectedLabel: "Jul 28, 2026",
        status: "checking_final_activity",
        statusLabel: "Checking final activity",
        timingLabel:
          "Action closed Jul 29, 2026, 11:00:00 AM UTC; checking delayed activity",
      },
      {
        destinationLabel: "the group",
        id: "hur_in_progress",
        rewardLabel: "$3.50",
        selectedLabel: "Jul 27, 2026",
        status: "in_progress",
        statusLabel: "In progress",
        timingLabel: "Ends Aug 3, 2026, 12:00:00 PM UTC",
      },
      {
        destinationLabel: "your Murph",
        id: "hur_waiting",
        rewardLabel: "$2.00",
        selectedLabel: "Jul 26, 2026",
        status: "waiting_for_group",
        statusLabel: "Waiting for a new group",
        timingLabel: "Start a new group by Aug 2, 2026, 12:00:00 PM UTC",
      },
      {
        destinationLabel: "your Murph",
        id: "hur_completed",
        rewardLabel: "$2.00",
        selectedLabel: "Jul 10, 2026",
        status: "completed",
        statusLabel: "Completed",
        timingLabel: "Earned Jul 16, 2026",
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
        timingLabel:
          "Action closed Jul 29, 2026, 11:59:59 AM UTC; checking delayed activity",
      },
      {
        id: "hur_before_cutoff",
        status: "in_progress",
        statusLabel: "In progress",
        timingLabel: "Ends Jul 29, 2026, 12:00:00 PM UTC",
      },
    ]);
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
        ],
        missionsEnabled: true,
      },
      missionContactOption: {
        href: "sms:+15550100001?body=mission",
        kind: "text",
        label: "Messages",
      },
    }));

    assert.match(markup, /<h3[^>]*>Credits &amp; missions<\/h3>/);
    assert.match(markup, /<h4[^>]*>Recent usage credits<\/h4>/);
    assert.match(markup, /<h4[^>]*>Missions<\/h4>/);
    assert.match(markup, /Purchased by you/);
    assert.match(markup, /Amounts show what was added, not what remains/);
    assert.doesNotMatch(markup, /bar above/);
    assert.doesNotMatch(markup, /Remaining|\$6\.42/);
    assert.match(markup, /Start an active group/);
    assert.match(markup, /Reward goes to the group/);
    assert.match(markup, /Ask Murph/);
    assert.match(
      markup,
      /aria-label="Ask Murph about usage missions in Messages"/,
    );
    assert.match(markup, /href="sms:\+15550100001\?body=mission"/);
    assert.equal(markup.match(/<table/g)?.length, 2);
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
    assert.match(markup, /Your existing mission activity remains below/);
    assert.match(markup, /New missions are not available/);
    assert.doesNotMatch(markup, /Ask Murph what is available/);
    assert.doesNotMatch(
      markup,
      /aria-label="Ask Murph about usage missions/,
    );
    assert.doesNotMatch(markup, /href="sms:/);
  });

  it("renders email-only credit history without a mission invitation", async () => {
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

    assert.match(markup, /<h3[^>]*>Usage credits<\/h3>/);
    assert.match(markup, /Added for you/);
    assert.doesNotMatch(markup, /<h4[^>]*>Missions<\/h4>/);
    assert.doesNotMatch(markup, /Ask Murph/);
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

    assert.match(markup, /<h3[^>]*>Credits &amp; missions<\/h3>/);
    assert.match(markup, /Your existing mission activity remains below/);
    assert.match(markup, /New missions are not available/);
    assert.match(markup, /Completed mission/);
    assert.doesNotMatch(markup, /Ask Murph what is available/);
    assert.doesNotMatch(markup, /aria-label="Ask Murph about usage missions/);
  });
});
