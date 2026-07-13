import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  claimCallCircleNotificationDelivery,
} from "@/src/lib/call-circle/notification-delivery";

const SETUP_EVENT_ID =
  "assistant.notification.requested:call-circle:setup:hgrp_123:member_a:participant:hccp_current:enrollment:1";
const TERMINAL_EVENT_ID =
  "assistant.notification.requested:call-circle:canceled:hccm_123:member_a";
const FINAL_EVENT_ID =
  "assistant.notification.requested:call-circle:final:hccm_123:member_a:2026-07-12T18:00:00.000Z";
const AM_EVENT_ID =
  "assistant.notification.requested:call-circle:am:hccm_123:member_a:2026-07-12T18:00:00.000Z";

describe("Call Circle notification delivery claims", () => {
  it("claims a current setup notification before provider entry", async () => {
    const consumedAt = new Date("2026-07-12T17:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      consumedAt,
      id: "hmi_setup",
      kind: "assistant.notification.requested",
    });

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      now: consumedAt,
      prisma: createActiveSetupPrisma({ findUnique, updateMany }),
      request: {
        answeredMailboxItemIds: ["hmi_setup"],
        deliveryIdempotencyKey: SETUP_EVENT_ID,
      },
    })).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledWith({
      data: { consumedAt },
      where: {
        consumedAt: null,
        dedupeKey: SETUP_EVENT_ID,
        id: { in: ["hmi_setup"] },
        kind: "assistant.notification.requested",
        userId: "member_a",
      },
    });
  });

  it("rejects an already-selected wake after pause supersedes its mailbox item", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({
      consumedAt: new Date("2026-07-12T17:00:00.000Z"),
      id: "hmi_setup",
      kind: "assistant.notification.superseded",
    });

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      prisma: createActiveSetupPrisma({ findUnique, updateMany }),
      request: {
        answeredMailboxItemIds: ["hmi_setup"],
        deliveryIdempotencyKey: SETUP_EVENT_ID,
      },
    })).rejects.toMatchObject({
      code: "HOSTED_CALL_CIRCLE_NOTIFICATION_SUPERSEDED",
      httpStatus: 409,
    });
  });

  it("allows an idempotent retry after the same notification was claimed", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({
      consumedAt: new Date("2026-07-12T17:00:00.000Z"),
      id: "hmi_setup",
      kind: "assistant.notification.requested",
    });

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      prisma: createActiveSetupPrisma({ findUnique, updateMany }),
      request: {
        answeredMailboxItemIds: ["hmi_setup"],
        deliveryIdempotencyKey: SETUP_EVENT_ID,
      },
    })).resolves.toBeUndefined();
  });

  it("does not claim terminal Call Circle notifications", async () => {
    const updateMany = vi.fn();
    const findUnique = vi.fn();

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      prisma: {
        hostedMailboxItem: { findUnique, updateMany },
      } as never,
      request: {
        answeredMailboxItemIds: ["hmi_terminal"],
        deliveryIdempotencyKey: TERMINAL_EVENT_ID,
      },
    })).resolves.toBeUndefined();

    expect(updateMany).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects a setup notification after current access or enrollment is lost", async () => {
    const updateMany = vi.fn();

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      prisma: {
        $queryRaw: vi.fn(),
        hostedCallCircleParticipant: {
          count: vi.fn().mockResolvedValue(0),
        },
        hostedMailboxItem: {
          findUnique: vi.fn(),
          updateMany,
        },
      } as never,
      request: {
        answeredMailboxItemIds: ["hmi_setup"],
        deliveryIdempotencyKey: SETUP_EVENT_ID,
      },
    })).rejects.toMatchObject({
      code: "HOSTED_CALL_CIRCLE_NOTIFICATION_SUPERSEDED",
    });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects a setup notification from an older enrollment generation", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const updateMany = vi.fn();

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      prisma: {
        $queryRaw: vi.fn(),
        hostedCallCircleParticipant: { count },
        hostedMailboxItem: {
          findUnique: vi.fn(),
          updateMany,
        },
      } as never,
      request: {
        answeredMailboxItemIds: ["hmi_setup"],
        deliveryIdempotencyKey: SETUP_EVENT_ID,
      },
    })).rejects.toMatchObject({
      code: "HOSTED_CALL_CIRCLE_NOTIFICATION_SUPERSEDED",
    });

    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        enrollmentGeneration: 1,
        groupId: "hgrp_123",
        id: "hccp_current",
        memberId: "member_a",
        status: "enrolled",
      }),
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects a setup notification from a departed participant incarnation", async () => {
    const count = vi.fn().mockResolvedValue(0);

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      prisma: {
        $queryRaw: vi.fn(),
        hostedCallCircleParticipant: { count },
        hostedMailboxItem: {
          findUnique: vi.fn(),
          updateMany: vi.fn(),
        },
      } as never,
      request: {
        answeredMailboxItemIds: ["hmi_setup"],
        deliveryIdempotencyKey: SETUP_EVENT_ID,
      },
    })).rejects.toMatchObject({
      code: "HOSTED_CALL_CIRCLE_NOTIFICATION_SUPERSEDED",
    });

    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        enrollmentGeneration: 1,
        id: "hccp_current",
      }),
    });
  });

  it("claims a confirmation only while that member still has a pending response", async () => {
    const consumedAt = new Date("2026-07-12T17:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      consumedAt,
      id: "hmi_final",
      kind: "assistant.notification.requested",
    });
    const matchFindUnique = vi.fn().mockResolvedValue({
      amAskedAt: consumedAt,
      finalAskedAt: consumedAt,
      groupId: "hgrp_123",
      memberAId: "member_a",
      memberBId: "member_b",
      sideAResponse: "pending",
      sideBResponse: "pending",
      status: "asking",
      windowStartAt: new Date("2026-07-12T18:00:00.000Z"),
    });
    const queryRaw = vi.fn();

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      now: consumedAt,
      prisma: {
        $queryRaw: queryRaw,
        hostedCallCircleMatch: { findUnique: matchFindUnique },
        hostedCallCircleParticipant: {
          count: vi.fn().mockResolvedValue(1),
        },
        hostedMailboxItem: { findUnique, updateMany },
      } as never,
      request: {
        answeredMailboxItemIds: ["hmi_final"],
        deliveryIdempotencyKey: FINAL_EVENT_ID,
      },
    })).resolves.toBeUndefined();

    expect(queryRaw.mock.calls.map((call) => call[1])).toEqual([
      "member_a",
      "hccm_123",
    ]);
    expect(matchFindUnique.mock.invocationCallOrder[0]).toBeGreaterThan(
      queryRaw.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("claims the current morning confirmation while the response is pending", async () => {
    const consumedAt = new Date("2026-07-12T17:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      now: consumedAt,
      prisma: createConfirmationPrisma({
        findUnique: vi.fn().mockResolvedValue({
          consumedAt,
          id: "hmi_am",
          kind: "assistant.notification.requested",
        }),
        finalAskedAt: null,
        updateMany,
      }),
      request: {
        answeredMailboxItemIds: ["hmi_am"],
        deliveryIdempotencyKey: AM_EVENT_ID,
      },
    })).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects an obsolete morning confirmation after the final stage starts", async () => {
    const updateMany = vi.fn();

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      prisma: createConfirmationPrisma({
        findUnique: vi.fn(),
        finalAskedAt: new Date("2026-07-12T17:30:00.000Z"),
        updateMany,
      }),
      request: {
        answeredMailboxItemIds: ["hmi_am"],
        deliveryIdempotencyKey: AM_EVENT_ID,
      },
    })).rejects.toMatchObject({
      code: "HOSTED_CALL_CIRCLE_NOTIFICATION_SUPERSEDED",
    });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects a confirmation after that member already responded", async () => {
    const updateMany = vi.fn();

    await expect(claimCallCircleNotificationDelivery({
      memberId: "member_a",
      prisma: {
        $queryRaw: vi.fn(),
        hostedCallCircleMatch: {
          findUnique: vi.fn().mockResolvedValue({
            amAskedAt: new Date("2026-07-12T17:00:00.000Z"),
            finalAskedAt: new Date("2026-07-12T17:00:00.000Z"),
            groupId: "hgrp_123",
            memberAId: "member_a",
            memberBId: "member_b",
            sideAResponse: "confirmed",
            sideBResponse: "pending",
            status: "asking",
            windowStartAt: new Date("2026-07-12T18:00:00.000Z"),
          }),
        },
        hostedCallCircleParticipant: {
          count: vi.fn().mockResolvedValue(1),
        },
        hostedMailboxItem: {
          findUnique: vi.fn(),
          updateMany,
        },
      } as never,
      request: {
        answeredMailboxItemIds: ["hmi_final"],
        deliveryIdempotencyKey: FINAL_EVENT_ID,
      },
    })).rejects.toMatchObject({
      code: "HOSTED_CALL_CIRCLE_NOTIFICATION_SUPERSEDED",
    });

    expect(updateMany).not.toHaveBeenCalled();
  });
});

function createActiveSetupPrisma(input: {
  findUnique: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
}) {
  return {
    $queryRaw: vi.fn(),
    hostedCallCircleParticipant: {
      count: vi.fn().mockResolvedValue(1),
    },
    hostedMailboxItem: input,
  } as never;
}

function createConfirmationPrisma(input: {
  finalAskedAt: Date | null;
  findUnique: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
}) {
  return {
    $queryRaw: vi.fn(),
    hostedCallCircleMatch: {
      findUnique: vi.fn().mockResolvedValue({
        amAskedAt: new Date("2026-07-12T17:00:00.000Z"),
        finalAskedAt: input.finalAskedAt,
        groupId: "hgrp_123",
        memberAId: "member_a",
        memberBId: "member_b",
        sideAResponse: "pending",
        sideBResponse: "pending",
        status: "asking",
        windowStartAt: new Date("2026-07-12T18:00:00.000Z"),
      }),
    },
    hostedCallCircleParticipant: {
      count: vi.fn().mockResolvedValue(1),
    },
    hostedMailboxItem: {
      findUnique: input.findUnique,
      updateMany: input.updateMany,
    },
  } as never;
}
