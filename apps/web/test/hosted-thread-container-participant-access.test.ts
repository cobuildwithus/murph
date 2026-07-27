import { describe, expect, it, vi } from "vitest";

import {
  activeHostedThreadContainerParticipantWhere,
  HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS,
  hostedThreadContainerParticipantAccessCutoff,
  renewHostedThreadContainerParticipantAccessTx,
} from "@/src/lib/hosted-groups/thread-container-participant-access";

describe("hosted thread-container participant access", () => {
  it("uses one seven-day lease predicate for participant-derived authority", () => {
    const now = new Date("2026-07-26T12:00:00.000Z");
    const cutoff = new Date(
      now.getTime() - HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS,
    );

    expect(hostedThreadContainerParticipantAccessCutoff(now)).toEqual(cutoff);
    expect(activeHostedThreadContainerParticipantWhere({ now })).toEqual({
      lastSeenAt: { gte: cutoff },
      removedAt: null,
    });
  });

  it("renews only an existing nonremoved relationship and never moves it backward", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const now = new Date("2026-07-26T12:00:00.000Z");
    const observedAt = new Date("2026-07-26T11:59:00.000Z");

    await expect(renewHostedThreadContainerParticipantAccessTx({
      containerMemberId: "container_1",
      now,
      observedAt,
      participantMemberId: "member_1",
      prisma: {
        hostedThreadContainerParticipant: { updateMany },
      } as never,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: { lastSeenAt: observedAt },
      where: {
        containerMemberId: "container_1",
        lastSeenAt: { lt: observedAt },
        participantMemberId: "member_1",
        removedAt: null,
      },
    });
  });

  it("clamps future provider timestamps to server time", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const now = new Date("2026-07-26T12:00:00.000Z");

    await expect(renewHostedThreadContainerParticipantAccessTx({
      containerMemberId: "container_1",
      now,
      observedAt: new Date("2026-08-26T12:00:00.000Z"),
      participantMemberId: "member_1",
      prisma: {
        hostedThreadContainerParticipant: { updateMany },
      } as never,
    })).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { lastSeenAt: now },
      where: expect.objectContaining({
        lastSeenAt: { lt: now },
        removedAt: null,
      }),
    }));
  });
});
