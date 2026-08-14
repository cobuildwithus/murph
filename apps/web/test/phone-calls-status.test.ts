import { describe, expect, it, vi } from "vitest";

import { readHostedPhoneCallStatus } from "@/src/lib/phone-calls/status";

describe("hosted phone-call status", () => {
  it("binds an exact lookup to the authenticated member and returns its result", async () => {
    const findMany = vi.fn(async () => [{
      analyzedAt: new Date("2026-09-01T15:01:10.000Z"),
      createdAt: new Date("2026-09-01T15:00:00.000Z"),
      endedAt: new Date("2026-09-01T15:01:00.000Z"),
      id: "hpc_status_exact",
      memberId: "member_status_owner",
      resultEncrypted: null,
      resultJson: {
        followUp: "The requester must provide one missing detail.",
        outcome: "not_completed",
        summary: "The requested task was not completed.",
      },
      status: "failed" as const,
      updatedAt: new Date("2026-09-01T15:01:10.000Z"),
    }]);

    const result = await readHostedPhoneCallStatus({
      memberId: "member_status_owner",
      phoneCallId: "hpc_status_exact",
      prisma: {
        hostedPhoneCall: { findMany },
      },
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 1,
      where: {
        id: "hpc_status_exact",
        memberId: "member_status_owner",
      },
    }));
    expect(result.calls).toEqual([expect.objectContaining({
      phoneCallId: "hpc_status_exact",
      result: expect.objectContaining({
        outcome: "not_completed",
      }),
      status: "failed",
    })]);
  });

  it("caps an unscoped lookup to the three most recent member calls", async () => {
    const findMany = vi.fn(async () => []);

    await readHostedPhoneCallStatus({
      memberId: "member_status_owner",
      prisma: {
        hostedPhoneCall: { findMany },
      },
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
      where: {
        memberId: "member_status_owner",
      },
    }));
  });
});
