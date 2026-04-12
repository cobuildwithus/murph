import { describe, expect, it, vi } from "vitest";

import { finalizeHostedShareAcceptance } from "../src/lib/hosted-share/shared";

describe("finalizeHostedShareAcceptance", () => {
  it("preserves the original acceptance fields when marking a share consumed", async () => {
    const updateMany = vi.fn<(input: {
      data: {
        acceptedAt?: Date;
        acceptedByMemberId?: string;
        consumedAt: Date;
        consumedByMemberId: string;
        lastEventId?: string;
      };
      where: {
        acceptedByMemberId: string;
        consumedAt: null;
        id: string;
        lastEventId: string;
      };
    }) => Promise<{ count: number }>>(async () => ({ count: 1 }));

    await expect(finalizeHostedShareAcceptance({
      eventId: "evt_accepted",
      memberId: "member_123",
      prisma: {
        hostedShareLink: {
          updateMany,
        },
      } as never,
      shareId: "share_123",
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: {
        consumedAt: expect.any(Date),
        consumedByMemberId: "member_123",
      },
      where: {
        acceptedByMemberId: "member_123",
        consumedAt: null,
        id: "share_123",
        lastEventId: "evt_accepted",
      },
    });
    const payload = updateMany.mock.calls[0]?.[0];

    expect(payload?.data.acceptedAt).toBeUndefined();
    expect(payload?.data.acceptedByMemberId).toBeUndefined();
    expect(payload?.data.lastEventId).toBeUndefined();
  });
});
