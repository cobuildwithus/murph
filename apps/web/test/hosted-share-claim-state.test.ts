import { describe, expect, it, vi } from "vitest";

import {
  finalizeHostedShareAcceptance,
  releaseHostedShareAcceptance,
} from "../src/lib/hosted-share/shared";

describe("hosted share claim transitions", () => {
  it("waits for the claim mutation before reading finalization state", async () => {
    let committed = false;
    const updateMany = vi.fn(async (_input: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      await Promise.resolve();
      committed = true;
      return { count: 1 };
    });
    const findUnique = vi.fn(async () => ({
      consumedAt: committed ? new Date("2026-04-12T00:00:00.000Z") : null,
      consumedByMemberId: committed ? "member_123" : null,
      lastEventId: committed ? "event_123" : null,
      senderMemberId: "owner_123",
    }));

    const finalized = await finalizeHostedShareAcceptance({
      eventId: "event_123",
      memberId: "member_123",
      prisma: {
        hostedShareLink: {
          findUnique,
          updateMany,
        },
      } as never,
      shareId: "share_123",
    });

    expect(finalized).toEqual({
      finalized: true,
      shareFound: true,
      sharePackOwnerMemberId: "owner_123",
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledTimes(1);

    const [firstCall] = updateMany.mock.calls;
    expect(firstCall).toBeDefined();
    const [{ where, data }] = firstCall!;

    expect(where).toEqual({
      acceptedByMemberId: "member_123",
      consumedAt: null,
      id: "share_123",
      lastEventId: "event_123",
    });
    expect(data.consumedAt).toBeInstanceOf(Date);
    expect(data.consumedByMemberId).toBe("member_123");
    expect(data).not.toHaveProperty("acceptedAt");
    expect(data).not.toHaveProperty("acceptedByMemberId");
    expect(data).not.toHaveProperty("lastEventId");
  });

  it("keeps the pack cleanup owner available for duplicate finalize callbacks", async () => {
    const updateMany = vi.fn(async (_input: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => ({ count: 0 }));
    const findUnique = vi.fn(async () => ({
      consumedAt: new Date("2026-04-12T00:00:00.000Z"),
      consumedByMemberId: "member_123",
      lastEventId: "event_123",
      senderMemberId: "owner_123",
    }));

    const finalized = await finalizeHostedShareAcceptance({
      eventId: "event_123",
      memberId: "member_123",
      prisma: {
        hostedShareLink: {
          findUnique,
          updateMany,
        },
      } as never,
      shareId: "share_123",
    });

    expect(finalized).toEqual({
      finalized: false,
      shareFound: true,
      sharePackOwnerMemberId: "owner_123",
    });
  });

  it("clears stale consumedByMemberId state when releasing a share acceptance", async () => {
    const updateMany = vi.fn(async (_input: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => ({ count: 1 }));

    const released = await releaseHostedShareAcceptance({
      eventId: "event_123",
      memberId: "member_123",
      prisma: {
        hostedShareLink: {
          updateMany,
        },
      } as never,
      shareId: "share_123",
    });

    expect(released).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);

    const [firstCall] = updateMany.mock.calls;
    expect(firstCall).toBeDefined();
    const [{ where, data }] = firstCall!;

    expect(where).toEqual({
      acceptedByMemberId: "member_123",
      consumedAt: null,
      id: "share_123",
      lastEventId: "event_123",
    });
    expect(data).toEqual({
      acceptedAt: null,
      acceptedByMemberId: null,
      consumedByMemberId: null,
      lastEventId: null,
    });
  });

  it("fails closed on blank callback member ids without updating claim state", async () => {
    const updateMany = vi.fn(async (_input: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => ({ count: 1 }));
    const findUnique = vi.fn(async () => ({
      consumedAt: new Date("2026-04-12T00:00:00.000Z"),
      consumedByMemberId: "member_123",
      lastEventId: "event_123",
      senderMemberId: "owner_123",
    }));

    await expect(finalizeHostedShareAcceptance({
      eventId: "event_123",
      memberId: "   ",
      prisma: {
        hostedShareLink: {
          findUnique,
          updateMany,
        },
      } as never,
      shareId: "share_123",
    })).resolves.toEqual({
      finalized: false,
      shareFound: false,
      sharePackOwnerMemberId: null,
    });

    await expect(releaseHostedShareAcceptance({
      eventId: "event_123",
      memberId: "   ",
      prisma: {
        hostedShareLink: {
          updateMany,
        },
      } as never,
      shareId: "share_123",
    })).resolves.toBe(false);

    expect(updateMany).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("normalizes callback member ids before persisting and matching finalization state", async () => {
    const updateMany = vi.fn(async (_input: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => ({ count: 1 }));
    const findUnique = vi.fn(async () => ({
      consumedAt: new Date("2026-04-12T00:00:00.000Z"),
      consumedByMemberId: "member_123",
      lastEventId: "event_123",
      senderMemberId: "owner_123",
    }));

    const finalized = await finalizeHostedShareAcceptance({
      eventId: "event_123",
      memberId: " member_123 ",
      prisma: {
        hostedShareLink: {
          findUnique,
          updateMany,
        },
      } as never,
      shareId: "share_123",
    });

    expect(finalized).toEqual({
      finalized: true,
      shareFound: true,
      sharePackOwnerMemberId: "owner_123",
    });

    const [firstCall] = updateMany.mock.calls;
    expect(firstCall).toBeDefined();
    const [{ where, data }] = firstCall!;

    expect(where).toEqual({
      acceptedByMemberId: "member_123",
      consumedAt: null,
      id: "share_123",
      lastEventId: "event_123",
    });
    expect(data.consumedByMemberId).toBe("member_123");
  });
});
