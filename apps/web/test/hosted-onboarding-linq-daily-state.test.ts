import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_AUTOMATION_ENGAGEMENT_WINDOW_DAYS,
  claimHostedLinqSignupLinkReminderNotice,
  hasHostedLinqInboundWithinDays,
  releaseHostedLinqSignupLinkReminderNoticeClaim,
} from "@/src/lib/hosted-onboarding/linq-daily-state";

describe("hosted Linq daily state", () => {
  it.each([0, 1])("atomically claims a reminder only when one daily row was updated (%s)", async (count) => {
    const updateMany = vi.fn().mockResolvedValue({ count });
    const sentAt = new Date("2026-07-26T00:01:00.000Z");
    await expect(claimHostedLinqSignupLinkReminderNotice({
      memberId: "member_reminder",
      occurredAt: "2026-07-25T20:00:00-04:00",
      prisma: { hostedLinqDailyState: { updateMany } } as never,
      sentAt,
    })).resolves.toBe(count === 1);
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        dayUtc: new Date("2026-07-26T00:00:00.000Z"),
        memberId: "member_reminder",
        signupLinkReminderSentAt: null,
      },
      data: { signupLinkReminderSentAt: sentAt },
    });
  });

  it("releases only the failed reminder's member and UTC day", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await releaseHostedLinqSignupLinkReminderNoticeClaim({
      memberId: "member_reminder",
      occurredAt: new Date("2026-07-25T23:59:00.000Z"),
      prisma: { hostedLinqDailyState: { updateMany } } as never,
    });
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        dayUtc: new Date("2026-07-25T00:00:00.000Z"),
        memberId: "member_reminder",
        signupLinkReminderSentAt: { not: null },
      },
      data: { signupLinkReminderSentAt: null },
    });
  });

  it("reads the automation engagement window from inbound daily state", async () => {
    const findFirst = vi.fn().mockResolvedValue({ memberId: "member-1" });
    const prisma = {
      hostedLinqDailyState: {
        findFirst,
      },
    };

    await expect(hasHostedLinqInboundWithinDays({
      memberId: "member-1",
      now: new Date("2026-07-07T12:00:00.000Z"),
      prisma: prisma as never,
    })).resolves.toBe(true);

    expect(findFirst).toHaveBeenCalledWith({
      select: {
        memberId: true,
      },
      where: {
        dayUtc: {
          gte: new Date("2026-06-09T00:00:00.000Z"),
        },
        inboundCount: {
          gt: 0,
        },
        memberId: "member-1",
      },
    });
    expect(HOSTED_AUTOMATION_ENGAGEMENT_WINDOW_DAYS).toBe(28);
  });

  it("returns false when no inbound day exists in the window", async () => {
    const prisma = {
      hostedLinqDailyState: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(hasHostedLinqInboundWithinDays({
      memberId: "member-1",
      now: "2026-07-07T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toBe(false);
  });
});
