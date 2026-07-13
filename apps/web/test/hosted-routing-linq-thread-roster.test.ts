import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX } from "@murphai/hosted-execution/runtime-control";

const mocks = vi.hoisted(() => ({
  getHostedLinqChatHandles: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress: mocks.lookupHostedMemberByVerifiedEmailAddress,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatHandles: mocks.getHostedLinqChatHandles,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-participant-contact", () => ({
  createHostedLinqParticipantContactLookupKey: (contact: {
    kind: "email" | "phone";
    value: string;
  }) => `lookup:${contact.kind}:${contact.value}`,
}));

import {
  applyHostedLinqThreadRosterSnapshotStrict,
  readHostedLinqThreadRosterStrict,
} from "@/src/lib/hosted-routing/linq-thread-roster";

type ProjectionRow = {
  containerMemberId: string;
  firstSeenAt: Date;
  handleLookupKey: string;
  lastSeenAt: Date;
  participantMemberId: string;
  removedAt: Date | null;
};

function createRosterPrisma(
  initialRows: readonly ProjectionRow[] = [],
  initialAppliedOrdinal: bigint | null = null,
) {
  const rows = new Map(
    initialRows.map((row) => [row.participantMemberId, { ...row }]),
  );
  let participantRosterAppliedOrdinal = initialAppliedOrdinal;
  let nextObservationOrdinal = 1n;
  let transactionOpen = false;

  const participant = {
    createMany: vi.fn(async ({ data }: { data: ProjectionRow[] }) => {
      let count = 0;
      for (const row of data) {
        if (!rows.has(row.participantMemberId)) {
          rows.set(row.participantMemberId, { ...row });
          count += 1;
        }
      }
      return { count };
    }),
    findFirst: vi.fn(async ({ where }: {
      where: {
        containerMemberId: string;
        participantMemberId: { in: string[] };
        removedAt: null;
      };
    }) => {
      for (const projection of rows.values()) {
        if (
          projection.containerMemberId === where.containerMemberId
          && where.participantMemberId.in.includes(projection.participantMemberId)
          && projection.removedAt === null
        ) {
          return { participantMemberId: projection.participantMemberId };
        }
      }
      return null;
    }),
    updateMany: vi.fn(async ({ data, where }: {
      data: Partial<ProjectionRow>;
      where: {
        containerMemberId: string;
        removedAt?: null;
        participantMemberId?: string | { notIn: string[] };
      };
    }) => {
      let count = 0;
      if (typeof where.participantMemberId === "string") {
        const row = rows.get(where.participantMemberId);
        if (
          row
          && row.containerMemberId === where.containerMemberId
        ) {
          rows.set(row.participantMemberId, { ...row, ...data });
          count += 1;
        }
        return { count };
      }

      const excluded = new Set(
        typeof where.participantMemberId === "object"
          ? where.participantMemberId.notIn
          : [],
      );
      for (const [memberId, row] of rows) {
        if (
          row.containerMemberId === where.containerMemberId
          && !excluded.has(memberId)
          && (where.removedAt !== null || row.removedAt === null)
        ) {
          rows.set(memberId, { ...row, ...data });
          count += 1;
        }
      }
      return { count };
    }),
  };
  const outsideParticipant = {
    createMany: vi.fn(() => {
      throw new Error("projection writes must run inside the transaction");
    }),
    findFirst: vi.fn(() => {
      throw new Error("projection reads must run inside the transaction");
    }),
    updateMany: vi.fn(() => {
      throw new Error("projection writes must run inside the transaction");
    }),
  };
  const route = {
    findMany: vi.fn(async ({ where }: {
      where: {
        threadIdentityLookupKey: string | { in: string[] };
      };
    }) => [{
      containerMemberId: "member_container",
      threadIdentityLookupKey: typeof where.threadIdentityLookupKey === "string"
        ? where.threadIdentityLookupKey
        : where.threadIdentityLookupKey.in[0],
    }]),
    updateMany: vi.fn(async ({ data, where }: {
      data: { participantRosterAppliedOrdinal: bigint };
      where: {
        channel: string;
        containerMemberId: string;
        threadIdentityLookupKey: string;
      };
    }) => {
      if (
        where.channel !== "linq"
        || where.containerMemberId !== "member_container"
        || where.threadIdentityLookupKey.length === 0
        || (
          participantRosterAppliedOrdinal !== null
          && participantRosterAppliedOrdinal >= data.participantRosterAppliedOrdinal
        )
      ) {
        return { count: 0 };
      }
      participantRosterAppliedOrdinal = data.participantRosterAppliedOrdinal;
      return { count: 1 };
    }),
  };
  const tx = {
    hostedThreadContainerParticipant: participant,
    hostedThreadRoute: route,
  };
  const prisma = {
    $queryRaw: vi.fn(async () => [{ ordinal: nextObservationOrdinal++ }]),
    $transaction: vi.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => {
      const before = new Map(
        [...rows].map(([memberId, row]) => [memberId, { ...row }]),
      );
      const participantRosterAppliedOrdinalBefore = participantRosterAppliedOrdinal;
      transactionOpen = true;
      try {
        return await run(tx);
      } catch (error) {
        rows.clear();
        for (const [memberId, row] of before) {
          rows.set(memberId, row);
        }
        participantRosterAppliedOrdinal = participantRosterAppliedOrdinalBefore;
        throw error;
      } finally {
        transactionOpen = false;
      }
    }),
    hostedThreadContainerParticipant: outsideParticipant,
  };

  return {
    isTransactionOpen: () => transactionOpen,
    outsideParticipant,
    participant,
    prisma,
    readParticipantRosterAppliedOrdinal: () => participantRosterAppliedOrdinal,
    route,
    rows,
    tx,
  };
}

function row(input: {
  lastSeenAt: string;
  memberId: string;
  removedAt?: string | null;
}): ProjectionRow {
  return {
    containerMemberId: "member_container",
    firstSeenAt: new Date(input.lastSeenAt),
    handleLookupKey: `lookup:phone:+1555${input.memberId.slice(-4)}`,
    lastSeenAt: new Date(input.lastSeenAt),
    participantMemberId: input.memberId,
    removedAt: input.removedAt ? new Date(input.removedAt) : null,
  };
}

describe("hosted Linq thread roster authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue(null);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(false);
  });

  it("atomically replaces a complete projection and removes absent rows", async () => {
    const observedAt = new Date("2026-07-10T12:00:00.000Z");
    const state = createRosterPrisma([
      row({ lastSeenAt: "2026-07-10T11:00:00.000Z", memberId: "member_absent" }),
    ]);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_present" },
    });

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_group",
      containerMemberId: "member_container",
      handles: [{ handle: "+15550001111", isMe: false, status: "active" }],
      observationOrdinal: 1n,
      observedAt,
      prisma: state.prisma as never,
    })).resolves.toEqual({ hasActiveParticipantAccess: false });

    expect(state.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(state.outsideParticipant.createMany).not.toHaveBeenCalled();
    expect(state.rows.get("member_present")).toMatchObject({
      lastSeenAt: observedAt,
      removedAt: null,
    });
    expect(state.rows.get("member_absent")?.removedAt).toEqual(observedAt);
  });

  it.each([
    { handles: [], name: "empty" },
    {
      handles: Array.from(
        { length: HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX + 1 },
        (_, index) => ({
          handle: `+15551${index.toString().padStart(6, "0")}`,
          isMe: false,
          status: "active",
        }),
      ),
      name: "over-cap",
    },
  ])("rejects an $name snapshot as retryable without mutation", async ({ handles }) => {
    const state = createRosterPrisma([
      row({ lastSeenAt: "2026-07-10T11:00:00.000Z", memberId: "member_existing" }),
    ]);

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_group",
      containerMemberId: "member_container",
      handles,
      observationOrdinal: 1n,
      observedAt: new Date("2026-07-10T12:00:00.000Z"),
      prisma: state.prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    expect(state.prisma.$transaction).not.toHaveBeenCalled();
    expect(state.rows.get("member_existing")?.removedAt).toBeNull();
  });

  it("keeps provider failure retryable and non-mutating", async () => {
    const state = createRosterPrisma([
      row({ lastSeenAt: "2026-07-10T11:00:00.000Z", memberId: "member_existing" }),
    ]);
    mocks.getHostedLinqChatHandles.mockRejectedValue(new Error("provider unavailable"));

    await expect(readHostedLinqThreadRosterStrict({
      chatId: "chat_group",
      prisma: state.prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    expect(state.prisma.$transaction).not.toHaveBeenCalled();
    expect(state.rows.get("member_existing")?.removedAt).toBeNull();
  });

  it("decides access from the fetched roster instead of a stale active projection", async () => {
    const state = createRosterPrisma([
      row({ lastSeenAt: "2026-07-10T11:00:00.000Z", memberId: "member_stale_active" }),
    ]);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_current_inactive" },
    });
    mocks.readActiveHostedMemberAccess.mockImplementation(async ({ memberId }) =>
      memberId === "member_stale_active");

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_group",
      containerMemberId: "member_container",
      handles: [{ handle: "+15550002222", isMe: false, status: "active" }],
      observationOrdinal: 1n,
      observedAt: new Date("2026-07-10T12:00:00.000Z"),
      prisma: state.prisma as never,
    })).resolves.toEqual({ hasActiveParticipantAccess: false });

    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledTimes(1);
    expect(mocks.readActiveHostedMemberAccess).toHaveBeenCalledWith(expect.objectContaining({
      memberId: "member_current_inactive",
    }));
  });

  it("allocates the ordinal before fetching outside the projection transaction", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const state = createRosterPrisma();
    mocks.getHostedLinqChatHandles.mockImplementation(async () => {
      expect(state.isTransactionOpen()).toBe(false);
      expect(state.prisma.$queryRaw).toHaveBeenCalledOnce();
      vi.setSystemTime(new Date("2026-07-10T12:01:00.000Z"));
      return [{ handle: "+15550003333", isMe: false, status: "active" }];
    });
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockImplementation(async () => {
      expect(state.isTransactionOpen()).toBe(true);
      return { core: { id: "member_active" } };
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);

    try {
      const snapshot = await readHostedLinqThreadRosterStrict({
        chatId: "chat_group",
        prisma: state.prisma as never,
      });
      expect(snapshot.observationOrdinal).toBe(1n);
      await expect(applyHostedLinqThreadRosterSnapshotStrict({
        chatId: "chat_group",
        containerMemberId: "member_container",
        handles: snapshot.handles,
        observationOrdinal: snapshot.observationOrdinal,
        observedAt: snapshot.observedAt,
        prisma: state.prisma as never,
      })).resolves.toEqual({ hasActiveParticipantAccess: true });

      expect(state.rows.get("member_active")?.lastSeenAt).toEqual(
        new Date("2026-07-10T12:00:00.000Z"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes an older or equal snapshot retry instead of resurrecting a newer removal", async () => {
    const removalAt = new Date("2026-07-10T10:00:00.000Z");
    const state = createRosterPrisma([
      row({
        lastSeenAt: "2026-07-10T12:00:00.000Z",
        memberId: "member_newer",
      }),
    ]);

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_group",
      containerMemberId: "member_container",
      handles: [{ handle: "+15550000000", isMe: true, status: "active" }],
      observationOrdinal: 2n,
      observedAt: removalAt,
      prisma: state.prisma as never,
    })).resolves.toEqual({ hasActiveParticipantAccess: false });

    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_newer" },
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);

    for (const observationOrdinal of [1n, 2n]) {
      await expect(applyHostedLinqThreadRosterSnapshotStrict({
        chatId: "chat_group",
        containerMemberId: "member_container",
        handles: [{ handle: "+15550004444", isMe: false, status: "active" }],
        observationOrdinal,
        observedAt: new Date("2026-07-10T13:00:00.000Z"),
        prisma: state.prisma as never,
      })).rejects.toMatchObject({
        code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
        httpStatus: 503,
        retryable: true,
      });
      expect(state.rows.get("member_newer")?.removedAt).toEqual(removalAt);
      expect(state.rows.get("member_newer")?.lastSeenAt).toEqual(
        new Date("2026-07-10T12:00:00.000Z"),
      );
    }
    expect(state.participant.findFirst).not.toHaveBeenCalled();
  });

  it("makes a superseded active snapshot retry instead of denying from the winner", async () => {
    const state = createRosterPrisma();
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_late" },
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_group",
      containerMemberId: "member_container",
      handles: [{ handle: "+15550000000", isMe: true, status: "active" }],
      observationOrdinal: 2n,
      observedAt: new Date("2026-07-10T12:00:00.000Z"),
      prisma: state.prisma as never,
    })).resolves.toEqual({ hasActiveParticipantAccess: false });

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_group",
      containerMemberId: "member_container",
      handles: [{ handle: "+15550006666", isMe: false, status: "active" }],
      observationOrdinal: 1n,
      observedAt: new Date("2026-07-10T11:00:00.000Z"),
      prisma: state.prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });

    expect(state.readParticipantRosterAppliedOrdinal()).toBe(2n);
    expect(state.rows.has("member_late")).toBe(false);
    expect(state.participant.createMany).not.toHaveBeenCalled();
    expect(state.participant.findFirst).not.toHaveBeenCalled();
    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledOnce();
  });

  it("fails closed when the snapshot route is absent or belongs to another container", async () => {
    const state = createRosterPrisma();
    state.route.findMany.mockResolvedValueOnce([]);

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_missing",
      containerMemberId: "member_container",
      handles: [{ handle: "+15550000000", isMe: true, status: "active" }],
      observationOrdinal: 1n,
      observedAt: new Date("2026-07-10T12:00:00.000Z"),
      prisma: state.prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      details: { reason: "route_mismatch" },
      httpStatus: 503,
      retryable: true,
    });

    expect(state.participant.createMany).not.toHaveBeenCalled();
    expect(state.participant.updateMany).not.toHaveBeenCalled();
    expect(state.route.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when privacy-key candidates match more than one route row", async () => {
    const state = createRosterPrisma();
    state.route.findMany.mockResolvedValueOnce([
      {
        containerMemberId: "member_container",
        threadIdentityLookupKey: "identity_v1",
      },
      {
        containerMemberId: "member_container",
        threadIdentityLookupKey: "identity_v2",
      },
    ]);

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_group",
      containerMemberId: "member_container",
      handles: [{ handle: "+15550000000", isMe: true, status: "active" }],
      observationOrdinal: 1n,
      observedAt: new Date("2026-07-10T12:00:00.000Z"),
      prisma: state.prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      details: { reason: "route_mismatch" },
      retryable: true,
    });

    expect(state.route.updateMany).not.toHaveBeenCalled();
    expect(state.participant.createMany).not.toHaveBeenCalled();
  });

  it("reactivates a removed row when a newer ordinal observes it despite clock skew", async () => {
    const observedAt = new Date("2026-07-10T09:00:00.000Z");
    const state = createRosterPrisma([
      row({
        lastSeenAt: "2026-07-10T10:00:00.000Z",
        memberId: "member_returned",
        removedAt: "2026-07-10T11:00:00.000Z",
      }),
    ], 1n);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_returned" },
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_group",
      containerMemberId: "member_container",
      handles: [{ handle: "+15550005555", isMe: false, status: "active" }],
      observationOrdinal: 2n,
      observedAt,
      prisma: state.prisma as never,
    })).resolves.toEqual({ hasActiveParticipantAccess: true });

    expect(state.rows.get("member_returned")).toMatchObject({
      lastSeenAt: observedAt,
      removedAt: null,
    });
  });

  it("makes an older removal retry instead of overwriting a newer active row", async () => {
    const newerSeenAt = "2026-07-10T12:00:00.000Z";
    const state = createRosterPrisma([
      row({ lastSeenAt: newerSeenAt, memberId: "member_newer" }),
    ], 2n);

    await expect(applyHostedLinqThreadRosterSnapshotStrict({
      chatId: "chat_group",
      containerMemberId: "member_container",
      handles: [{ handle: "+15550000000", isMe: true, status: "active" }],
      observationOrdinal: 1n,
      observedAt: new Date("2026-07-10T11:00:00.000Z"),
      prisma: state.prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_GROUP_ROSTER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
    expect(state.rows.get("member_newer")?.removedAt).toBeNull();
    expect(state.rows.get("member_newer")?.lastSeenAt).toEqual(new Date(newerSeenAt));
  });
});
