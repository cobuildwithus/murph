import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireHostedMemberHomeLinqRouteLockTx: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMailboxConversationWakeByAssistantInputId: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberIdentity: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
  reserveHostedLinqHomeLineFromPoolTx: vi.fn(),
  transaction: vi.fn(),
  upsertHostedMemberHomeLinqRecipientPhoneTx: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  acquireHostedMemberHomeLinqRouteLockTx:
    mocks.acquireHostedMemberHomeLinqRouteLockTx,
  readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  upsertHostedMemberHomeLinqRecipientPhoneTx:
    mocks.upsertHostedMemberHomeLinqRecipientPhoneTx,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  readHostedMemberIdentity: mocks.readHostedMemberIdentity,
}));
vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
}));
vi.mock(
  "@/src/lib/hosted-onboarding/linq-home-routing",
  async (importOriginal) => ({
    ...await importOriginal<
      typeof import("@/src/lib/hosted-onboarding/linq-home-routing")
    >(),
    reserveHostedLinqHomeLineFromPoolTx:
      mocks.reserveHostedLinqHomeLineFromPoolTx,
  }),
);
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeActiveAccessForUpdateTx:
    mocks.requireHostedRuntimeActiveAccessForUpdateTx,
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxConversationWakeByAssistantInputId:
    mocks.readHostedMailboxConversationWakeByAssistantInputId,
}));

import {
  handleHostedRuntimeIMessageContactTool,
} from "@/src/lib/hosted-execution/imessage-contact-tool";

const ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;

describe("hosted iMessage contact tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const tx = { tx: true };
    mocks.transaction.mockImplementation(
      async (callback: (value: unknown) => Promise<unknown>) => callback(tx),
    );
    mocks.getPrisma.mockReturnValue({ $transaction: mocks.transaction });
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue({
      eventId: "telegram-contact-request",
      kind: "conversation.message",
      message: {
        channel: "telegram",
        telegramMessage: {
          messageId: "1",
          schema: "murph.hosted-telegram-message.v1",
          threadId: "telegram-direct-thread",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-07-27T20:00:00.000Z",
      userId: "member_telegram",
    });
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneLookupKey: "hbidx:phone:v1:member-telegram",
      phoneNumberVerifiedAt: new Date("2026-07-27T19:00:00.000Z"),
    });
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.acquireHostedMemberHomeLinqRouteLockTx.mockResolvedValue(undefined);
    mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mockResolvedValue(undefined);
  });

  it("returns an existing assigned number without reading or consuming the pool", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqRecipientPhone: "+15550100001",
    });

    await expect(handleHostedRuntimeIMessageContactTool({
      memberId: "member_telegram",
      request: { assistantInputId: ASSISTANT_INPUT_ID },
    })).resolves.toEqual({
      phoneNumber: "+15550100001",
      status: "existing",
    });

    expect(mocks.reserveHostedLinqHomeLineFromPoolTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("does not assign or return a line until an iMessage sender identity is verified", async () => {
    mocks.readHostedMemberIdentity.mockResolvedValue({
      phoneLookupKey: "hbidx:phone:v1:unverified",
      phoneNumberVerifiedAt: null,
    });
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      verifiedEmail: null,
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqRecipientPhone: "+15550100001",
    });

    await expect(handleHostedRuntimeIMessageContactTool({
      memberId: "member_telegram",
      request: { assistantInputId: ASSISTANT_INPUT_ID },
    })).resolves.toEqual({
      phoneNumber: null,
      status: "identity_required",
    });

    expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberRoutingState).not.toHaveBeenCalled();
    expect(mocks.reserveHostedLinqHomeLineFromPoolTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("accepts a verified iMessage email identity when no phone is connected", async () => {
    mocks.readHostedMemberIdentity.mockResolvedValue(null);
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      verifiedEmail: {
        address: "member@example.test",
        lookupKey: "hbidx:email:v1:member-telegram",
        verifiedAt: new Date("2026-07-27T19:00:00.000Z"),
      },
    });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqRecipientPhone: "+15550100001",
    });

    await expect(handleHostedRuntimeIMessageContactTool({
      memberId: "member_telegram",
      request: { assistantInputId: ASSISTANT_INPUT_ID },
    })).resolves.toEqual({
      phoneNumber: "+15550100001",
      status: "existing",
    });
  });

  it("assigns one line and returns the same line on a repeated request", async () => {
    let assignedPhoneNumber: string | null = null;
    mocks.readHostedMemberRoutingState.mockImplementation(async () => ({
      linqChatId: null,
      linqHomeLineAssignedAt: null,
      linqParticipantContact: null,
      linqRecipientPhone: assignedPhoneNumber,
      pendingLinqRecipientPhone: null,
    }));
    mocks.reserveHostedLinqHomeLineFromPoolTx.mockResolvedValue({
      kind: "reserved",
      reservation: {
        assignedAt: new Date("2026-07-27T20:00:00.000Z"),
        line: {
          phoneNumber: "+15550100002",
        },
        proactiveConversationReserved: false,
      },
    });
    mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mockImplementation(
      async (input: { recipientPhone: string }) => {
        assignedPhoneNumber = input.recipientPhone;
      },
    );

    const request = {
      memberId: "member_telegram",
      request: { assistantInputId: ASSISTANT_INPUT_ID },
    };
    await expect(handleHostedRuntimeIMessageContactTool(request)).resolves.toEqual({
      phoneNumber: "+15550100002",
      status: "assigned",
    });
    await expect(handleHostedRuntimeIMessageContactTool(request)).resolves.toEqual({
      phoneNumber: "+15550100002",
      status: "existing",
    });

    expect(mocks.reserveHostedLinqHomeLineFromPoolTx).toHaveBeenCalledTimes(1);
    expect(mocks.reserveHostedLinqHomeLineFromPoolTx).toHaveBeenCalledWith({
      preferredRecipientPhone: null,
      prisma: { tx: true },
    });
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledTimes(1);
    expect(
      mocks.acquireHostedMemberHomeLinqRouteLockTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.readHostedMemberRoutingState.mock.invocationCallOrder[0]!,
    );
  });

  it("serializes concurrent requests so only one line is reserved", async () => {
    let assignedPhoneNumber: string | null = null;
    let transactionOrdinal = 0;
    let previousLock = Promise.resolve();
    let continueFirstReservation: () => void = () => {
      throw new Error("First reservation release was not initialized.");
    };
    let signalFirstReservation: () => void = () => {
      throw new Error("First reservation signal was not initialized.");
    };
    const firstReservationStarted = new Promise<void>((resolve) => {
      signalFirstReservation = resolve;
    });
    const firstReservationCanFinish = new Promise<void>((resolve) => {
      continueFirstReservation = resolve;
    });

    mocks.transaction.mockImplementation(
      async (
        callback: (value: {
          releaseRouteLock?: () => void;
          tx: number;
        }) => Promise<unknown>,
      ) => {
        const tx: {
          releaseRouteLock?: () => void;
          tx: number;
        } = { tx: transactionOrdinal += 1 };
        try {
          return await callback(tx);
        } finally {
          tx.releaseRouteLock?.();
        }
      },
    );
    mocks.acquireHostedMemberHomeLinqRouteLockTx.mockImplementation(
      async (input: {
        prisma: {
          releaseRouteLock?: () => void;
        };
      }) => {
        const waitForPreviousLock = previousLock;
        let releaseRouteLock = () => {};
        previousLock = new Promise<void>((resolve) => {
          releaseRouteLock = resolve;
        });
        await waitForPreviousLock;
        input.prisma.releaseRouteLock = releaseRouteLock;
      },
    );
    mocks.readHostedMemberRoutingState.mockImplementation(async () => ({
      linqRecipientPhone: assignedPhoneNumber,
    }));
    mocks.reserveHostedLinqHomeLineFromPoolTx.mockImplementation(async () => {
      signalFirstReservation();
      await firstReservationCanFinish;
      return {
        kind: "reserved",
        reservation: {
          assignedAt: new Date("2026-07-27T20:00:00.000Z"),
          line: {
            phoneNumber: "+15550100004",
          },
          proactiveConversationReserved: false,
        },
      };
    });
    mocks.upsertHostedMemberHomeLinqRecipientPhoneTx.mockImplementation(
      async (input: { recipientPhone: string }) => {
        assignedPhoneNumber = input.recipientPhone;
      },
    );

    const request = {
      memberId: "member_telegram",
      request: { assistantInputId: ASSISTANT_INPUT_ID },
    };
    const first = handleHostedRuntimeIMessageContactTool(request);
    await firstReservationStarted;
    const second = handleHostedRuntimeIMessageContactTool(request);
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledTimes(1);
    continueFirstReservation();

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        phoneNumber: "+15550100004",
        status: "assigned",
      },
      {
        phoneNumber: "+15550100004",
        status: "existing",
      },
    ]);
    expect(mocks.reserveHostedLinqHomeLineFromPoolTx).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).toHaveBeenCalledTimes(1);
  });

  it.each(["capacity_exhausted", "unassignable"] as const)(
    "returns unavailable without persisting when the line pool is %s",
    async (kind) => {
      mocks.readHostedMemberRoutingState.mockResolvedValue({
        linqRecipientPhone: null,
      });
      mocks.reserveHostedLinqHomeLineFromPoolTx.mockResolvedValue({ kind });

      await expect(handleHostedRuntimeIMessageContactTool({
        memberId: "member_telegram",
        request: { assistantInputId: ASSISTANT_INPUT_ID },
      })).resolves.toEqual({
        phoneNumber: null,
        status: "unavailable",
      });

      expect(mocks.reserveHostedLinqHomeLineFromPoolTx).toHaveBeenCalledOnce();
      expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
    },
  );

  it("does not claim another line while pending route authority exists", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqRecipientPhone: null,
      pendingLinqChatId: "pending-chat",
      pendingLinqRecipientPhone: "+15550100003",
    });

    await expect(handleHostedRuntimeIMessageContactTool({
      memberId: "member_telegram",
      request: { assistantInputId: ASSISTANT_INPUT_ID },
    })).resolves.toEqual({
      phoneNumber: null,
      status: "unavailable",
    });

    expect(mocks.reserveHostedLinqHomeLineFromPoolTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberHomeLinqRecipientPhoneTx).not.toHaveBeenCalled();
  });

  it("does not assign a number without current direct Telegram input", async () => {
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue({
      eventId: "email-contact-request",
      kind: "conversation.message",
      message: {
        channel: "email",
        identityId: "email-identity",
        rawMessageKey: "email-message",
        threadIsDirect: true,
      },
      occurredAt: "2026-07-27T20:00:00.000Z",
      userId: "member_telegram",
    });

    await expect(handleHostedRuntimeIMessageContactTool({
      memberId: "member_telegram",
      request: { assistantInputId: ASSISTANT_INPUT_ID },
    })).rejects.toThrow(
      "iMessage contact assignment requires current direct Telegram input.",
    );

    expect(mocks.acquireHostedMemberHomeLinqRouteLockTx).not.toHaveBeenCalled();
    expect(mocks.reserveHostedLinqHomeLineFromPoolTx).not.toHaveBeenCalled();
  });
});
