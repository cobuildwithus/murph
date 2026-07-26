import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS,
  activeHostedThreadContainerParticipantWhere,
  clampHostedThreadContainerParticipantObservedAt,
  hostedThreadContainerParticipantAccessCutoff,
  renewHostedThreadContainerParticipantLeaseTx,
} from "@/src/lib/hosted-groups/thread-container-participant-access";

describe("hosted thread-container participant access", () => {
  it("expresses participant authority as one canonical seven-day lease", () => {
    const now = new Date("2026-07-25T18:00:00.000Z");
    const cutoff = new Date(
      now.getTime() - HOSTED_THREAD_CONTAINER_PARTICIPANT_ACCESS_LEASE_MS,
    );

    expect(hostedThreadContainerParticipantAccessCutoff(now)).toEqual(cutoff);
    expect(activeHostedThreadContainerParticipantWhere({ now })).toEqual({
      lastSeenAt: { gte: cutoff },
      removedAt: null,
    });
  });

  it("clamps provider observations so they cannot mint future authority", () => {
    const now = new Date("2026-07-25T18:00:00.000Z");

    expect(clampHostedThreadContainerParticipantObservedAt({
      now,
      observedAt: new Date("2026-07-25T17:00:00.000Z"),
    })).toEqual(new Date("2026-07-25T17:00:00.000Z"));
    expect(clampHostedThreadContainerParticipantObservedAt({
      now,
      observedAt: new Date("2026-07-26T18:00:00.000Z"),
    })).toEqual(now);
  });

  it("renews only an existing non-removed relationship and never moves it backward", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const now = new Date("2026-07-25T18:00:00.000Z");
    const observedAt = new Date("2026-07-25T17:30:00.000Z");

    await expect(renewHostedThreadContainerParticipantLeaseTx({
      containerMemberId: "member_group",
      now,
      observedAt,
      participantMemberId: "member_participant",
      prisma: {
        hostedThreadContainerParticipant: { updateMany },
      } as never,
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      data: { lastSeenAt: observedAt },
      where: {
        containerMemberId: "member_group",
        lastSeenAt: { lt: observedAt },
        participantMemberId: "member_participant",
        removedAt: null,
      },
    });
  });
});
