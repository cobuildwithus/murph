import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecentMemberRetention } from "../app/(dashboard)/ops/growth/recent-member-retention";
import {
  HOSTED_RECENT_MEMBER_RETENTION_LIMIT,
  readHostedRecentMemberRetention,
  type HostedRecentMemberRetention,
} from "../src/lib/hosted-ops/recent-member-retention";

const mocks = vi.hoisted(() => ({
  hostedMailboxItemGroupBy: vi.fn(),
  hostedMemberFindMany: vi.fn(),
}));

vi.mock("../src/lib/prisma", () => ({
  getPrisma: () => ({
    hostedMailboxItem: {
      groupBy: mocks.hostedMailboxItemGroupBy,
    },
    hostedMember: {
      findMany: mocks.hostedMemberFindMany,
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hosted recent-member retention", () => {
  it("reads the newest real members and maps bounded receipt-time aggregates", async () => {
    const now = new Date("2026-08-26T15:00:00.000Z");
    mocks.hostedMemberFindMany.mockResolvedValue([
      {
        billingRef: {
          currentBillingPhase: "trial",
          currentBillingPlanCode: "launch_monthly",
        },
        billingStatus: "active",
        createdAt: new Date("2026-08-26T13:00:00.000Z"),
        id: "member_no_message",
        identity: { maskedPhoneNumberHint: "*** 0130" },
        initialOnboardingCompletedAt: null,
        suspendedAt: null,
      },
      {
        billingRef: {
          currentBillingPhase: "paid",
          currentBillingPlanCode: "launch_edge_monthly",
        },
        billingStatus: "active",
        createdAt: new Date("2026-08-25T20:00:00.000Z"),
        id: "member_returned",
        identity: null,
        initialOnboardingCompletedAt: new Date("2026-08-25T20:10:00.000Z"),
        suspendedAt: null,
      },
      {
        billingRef: null,
        billingStatus: "not_started",
        createdAt: new Date("2026-08-25T10:00:00.000Z"),
        id: "member_first_day",
        identity: { maskedPhoneNumberHint: "*** 0192" },
        initialOnboardingCompletedAt: new Date("2026-08-25T10:02:00.000Z"),
        suspendedAt: null,
      },
    ]);
    mocks.hostedMailboxItemGroupBy
      .mockResolvedValueOnce([
        {
          _count: { _all: 12 },
          _max: { createdAt: new Date("2026-08-26T14:30:00.000Z") },
          _min: { createdAt: new Date("2026-08-25T20:05:00.000Z") },
          userId: "member_returned",
        },
        {
          _count: { _all: 3 },
          _max: { createdAt: new Date("2026-08-25T14:00:00.000Z") },
          _min: { createdAt: new Date("2026-08-25T10:04:00.000Z") },
          userId: "member_first_day",
        },
      ])
      .mockResolvedValueOnce([
        { _count: { _all: 9 }, userId: "member_returned" },
        { _count: { _all: 3 }, userId: "member_first_day" },
      ])
      .mockResolvedValueOnce([
        { _count: { _all: 4 }, userId: "member_returned" },
      ]);

    const retention = await readHostedRecentMemberRetention(now);

    expect(mocks.hostedMemberFindMany).toHaveBeenCalledWith({
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      select: {
        billingRef: {
          select: {
            currentBillingPhase: true,
            currentBillingPlanCode: true,
          },
        },
        billingStatus: true,
        createdAt: true,
        id: true,
        identity: {
          select: {
            maskedPhoneNumberHint: true,
          },
        },
        initialOnboardingCompletedAt: true,
        suspendedAt: true,
      },
      take: HOSTED_RECENT_MEMBER_RETENTION_LIMIT,
      where: {
        createdAt: { lte: now },
        hostedGroupRuntime: null,
        threadContainer: null,
      },
    });
    expect(mocks.hostedMailboxItemGroupBy).toHaveBeenCalledTimes(3);
    expect(mocks.hostedMailboxItemGroupBy).toHaveBeenNthCalledWith(1, {
      _count: { _all: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
      by: ["userId"],
      where: {
        createdAt: { lt: now },
        kind: "conversation.message",
        userId: {
          in: ["member_no_message", "member_returned", "member_first_day"],
        },
      },
    });
    expect(mocks.hostedMailboxItemGroupBy).toHaveBeenNthCalledWith(2, {
      _count: { _all: true },
      by: ["userId"],
      where: {
        createdAt: {
          gte: new Date("2026-08-19T15:00:00.000Z"),
          lt: now,
        },
        kind: "conversation.message",
        userId: {
          in: ["member_no_message", "member_returned", "member_first_day"],
        },
      },
    });
    expect(mocks.hostedMailboxItemGroupBy).toHaveBeenNthCalledWith(3, {
      _count: { _all: true },
      by: ["userId"],
      where: {
        createdAt: {
          gte: new Date("2026-08-26T00:00:00.000Z"),
          lt: now,
        },
        kind: "conversation.message",
        userId: {
          in: ["member_no_message", "member_returned", "member_first_day"],
        },
      },
    });
    expect(retention).toEqual({
      capturedAt: "2026-08-26T15:00:00.000Z",
      members: [
        {
          billingPhase: "trial",
          billingPlanName: "Pulse",
          billingStatus: "active",
          createdAt: "2026-08-26T13:00:00.000Z",
          firstMessageAt: null,
          lastMessageAt: null,
          lifecycle: "no_message",
          maskedPhoneNumberHint: "*** 0130",
          memberId: "member_no_message",
          messagesAllTime: 0,
          messagesLast7Days: 0,
          messagesToday: 0,
          onboardingCompleted: false,
          suspended: false,
        },
        {
          billingPhase: "paid",
          billingPlanName: "Edge",
          billingStatus: "active",
          createdAt: "2026-08-25T20:00:00.000Z",
          firstMessageAt: "2026-08-25T20:05:00.000Z",
          lastMessageAt: "2026-08-26T14:30:00.000Z",
          lifecycle: "returned",
          maskedPhoneNumberHint: null,
          memberId: "member_returned",
          messagesAllTime: 12,
          messagesLast7Days: 9,
          messagesToday: 4,
          onboardingCompleted: true,
          suspended: false,
        },
        {
          billingPhase: null,
          billingPlanName: null,
          billingStatus: "not_started",
          createdAt: "2026-08-25T10:00:00.000Z",
          firstMessageAt: "2026-08-25T10:04:00.000Z",
          lastMessageAt: "2026-08-25T14:00:00.000Z",
          lifecycle: "activated",
          maskedPhoneNumberHint: "*** 0192",
          memberId: "member_first_day",
          messagesAllTime: 3,
          messagesLast7Days: 3,
          messagesToday: 0,
          onboardingCompleted: true,
          suspended: false,
        },
      ],
    });
  });

  it("returns an empty result without message queries", async () => {
    mocks.hostedMemberFindMany.mockResolvedValue([]);

    await expect(readHostedRecentMemberRetention(
      new Date("2026-08-26T15:00:00.000Z"),
    )).resolves.toEqual({
      capturedAt: "2026-08-26T15:00:00.000Z",
      members: [],
    });
    expect(mocks.hostedMailboxItemGroupBy).not.toHaveBeenCalled();
  });
});

describe("RecentMemberRetention", () => {
  it("renders rich and sparse member activity without exposing a full member id", () => {
    const retention = buildRetentionStudy();
    const html = renderToStaticMarkup(
      <RecentMemberRetention retention={retention} />,
    );

    expect(html).toContain("Recent member retention");
    expect(html).toContain("Returned");
    expect(html).toContain("No message yet");
    expect(html).toContain("Active today");
    expect(html).toContain("Edge");
    expect(html).toContain("Onboarding complete");
    expect(html).toContain("12");
    expect(html).toContain("9");
    expect(html).toContain("4");
    expect(html).toContain("Member · 00006419");
    expect(html).not.toContain("opaque_member_identifier_00006419");
  });

  it("renders the explicit empty state", () => {
    const html = renderToStaticMarkup(
      <RecentMemberRetention
        retention={{
          capturedAt: "2026-08-26T15:00:00.000Z",
          members: [],
        }}
      />,
    );

    expect(html).toContain("No real member signups yet.");
  });
});

function buildRetentionStudy(): HostedRecentMemberRetention {
  return {
    capturedAt: "2026-08-26T15:00:00.000Z",
    members: [
      {
        billingPhase: "paid",
        billingPlanName: "Edge",
        billingStatus: "active",
        createdAt: "2026-08-25T20:00:00.000Z",
        firstMessageAt: "2026-08-25T20:05:00.000Z",
        lastMessageAt: "2026-08-26T14:30:00.000Z",
        lifecycle: "returned",
        maskedPhoneNumberHint: null,
        memberId: "opaque_member_identifier_00006419",
        messagesAllTime: 12,
        messagesLast7Days: 9,
        messagesToday: 4,
        onboardingCompleted: true,
        suspended: false,
      },
      {
        billingPhase: "trial",
        billingPlanName: "Pulse",
        billingStatus: "active",
        createdAt: "2026-08-26T14:40:00.000Z",
        firstMessageAt: null,
        lastMessageAt: null,
        lifecycle: "no_message",
        maskedPhoneNumberHint: "*** 0130",
        memberId: "opaque_member_identifier_00000130",
        messagesAllTime: 0,
        messagesLast7Days: 0,
        messagesToday: 0,
        onboardingCompleted: false,
        suspended: false,
      },
    ],
  };
}
