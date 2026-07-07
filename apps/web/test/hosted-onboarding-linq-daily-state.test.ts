import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_AUTOMATION_ENGAGEMENT_WINDOW_DAYS,
  hasHostedLinqInboundWithinDays,
} from "@/src/lib/hosted-onboarding/linq-daily-state";

describe("hosted Linq daily state", () => {
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
