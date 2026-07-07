import type { HostedPhoneCall } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendCallCircleHandoffNotificationTx: vi.fn(),
  appendCallCircleOutcomeNotificationTx: vi.fn(),
  attachCallCirclePhoneCall: vi.fn(),
  hostedCallCircleMatchFindUnique: vi.fn(),
  hostedMailboxItemFindUnique: vi.fn(),
  hostedPhoneCallFindUnique: vi.fn(),
  hostedPhoneCallFindUniqueOrThrow: vi.fn(),
  hostedPhoneCallUpdateMany: vi.fn(),
  markCallCircleMatchOutcome: vi.fn(),
  prismaTransaction: vi.fn(),
  readExistingCallCircleNotificationSignalTx: vi.fn(),
  readCallCircleNotificationSignal: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: mocks.prismaTransaction,
  }),
}));

vi.mock("@/src/lib/call-circle/match-store", () => ({
  attachCallCirclePhoneCall: mocks.attachCallCirclePhoneCall,
  markCallCircleMatchOutcome: mocks.markCallCircleMatchOutcome,
}));

vi.mock("@/src/lib/call-circle/notifications", () => ({
  appendCallCircleHandoffNotificationTx: mocks.appendCallCircleHandoffNotificationTx,
  appendCallCircleOutcomeNotificationTx: mocks.appendCallCircleOutcomeNotificationTx,
  buildCallCircleHandoffNotificationEventId: ({ matchId, memberId }: {
    matchId: string;
    memberId: string;
  }) => `assistant.notification.requested:call-circle:handoff:${matchId}:${memberId}`,
  buildCallCircleOutcomeNotificationEventId: ({ matchId, memberId }: {
    matchId: string;
    memberId: string;
  }) => `assistant.notification.requested:call-circle:outcome:${matchId}:${memberId}`,
  readExistingCallCircleNotificationSignalTx: mocks.readExistingCallCircleNotificationSignalTx,
  readCallCircleNotificationSignal: mocks.readCallCircleNotificationSignal,
}));

import {
  handleRetellCallAnalyzed,
} from "@/src/lib/phone-calls/result";

describe("Retell call analysis for Call Circle connector calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let storedCall = buildCallCirclePhoneCall();
    const tx = {
      hostedCallCircleMatch: {
        findUnique: mocks.hostedCallCircleMatchFindUnique,
      },
      hostedMailboxItem: {
        findUnique: mocks.hostedMailboxItemFindUnique,
      },
      hostedPhoneCall: {
        findUnique: mocks.hostedPhoneCallFindUnique,
        findUniqueOrThrow: mocks.hostedPhoneCallFindUniqueOrThrow,
        updateMany: mocks.hostedPhoneCallUpdateMany,
      },
    };
    mocks.prismaTransaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback(tx));
    mocks.hostedPhoneCallFindUnique.mockImplementation(async () => storedCall);
    mocks.hostedPhoneCallFindUniqueOrThrow.mockImplementation(async () => storedCall);
    mocks.hostedPhoneCallUpdateMany.mockImplementation(async (args: {
      data: Partial<HostedPhoneCall>;
    }) => {
      storedCall = {
        ...storedCall,
        ...args.data,
      };
      return { count: 1 };
    });
    mocks.hostedCallCircleMatchFindUnique.mockResolvedValue({
      memberAId: "member_a",
      memberBId: "member_b",
    });
    mocks.hostedMailboxItemFindUnique.mockResolvedValue(null);
    mocks.attachCallCirclePhoneCall.mockResolvedValue(true);
    mocks.markCallCircleMatchOutcome.mockResolvedValue(true);
    mocks.appendCallCircleOutcomeNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_123",
      status: "sent",
    });
    mocks.appendCallCircleHandoffNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_123",
      status: "sent",
    });
    mocks.readCallCircleNotificationSignal.mockImplementation(({ memberId, notification }) =>
      notification.status === "sent" && notification.mailboxItemId
        ? { mailboxItemId: notification.mailboxItemId, memberId }
        : null);
    mocks.readExistingCallCircleNotificationSignalTx.mockImplementation(async ({
      eventId,
      memberId,
      tx,
    }: {
      eventId: string;
      memberId: string;
      tx: {
        hostedMailboxItem: {
          findUnique(input: unknown): Promise<{ consumedAt: Date | null; id: string } | null>;
        };
      };
    }) => {
      const existing = await tx.hostedMailboxItem.findUnique({
        select: {
          consumedAt: true,
          id: true,
        },
        where: {
          userId_dedupeKey: {
            dedupeKey: eventId,
            userId: memberId,
          },
        },
      });
      if (!existing) return { exists: false, signal: null };
      if (existing.consumedAt) return { exists: true, signal: null };
      return {
        exists: true,
        signal: {
          mailboxItemId: existing.id,
          memberId,
        },
      };
    });
  });

  it("updates the match and suppresses standard phone-call result notifications", async () => {
    await expect(handleRetellCallAnalyzed({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "The Call Circle bridge completed.",
          },
        },
        call_id: "retell_call_123",
        data_storage_setting: "basic_attributes_only",
      },
    })).resolves.toEqual({
      notificationMailboxItemId: "mailbox_123",
      notificationSignals: [
        {
          notificationMailboxItemId: "mailbox_123",
          notificationUserId: "member_a",
        },
        {
          notificationMailboxItemId: "mailbox_123",
          notificationUserId: "member_b",
        },
      ],
      notificationUserId: "member_a",
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now: expect.any(Date),
      outcome: "completed",
      phoneCallId: "hpc_123",
      prisma: expect.any(Object),
      status: "completed",
    });
    expect(mocks.attachCallCirclePhoneCall).toHaveBeenCalledWith({
      matchId: "hccm_123",
      phoneCallId: "hpc_123",
      prisma: expect.any(Object),
    });
    expect(mocks.attachCallCirclePhoneCall.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markCallCircleMatchOutcome.mock.invocationCallOrder[0],
    );
    expect(mocks.appendCallCircleOutcomeNotificationTx).toHaveBeenCalledTimes(2);
    expect(mocks.appendCallCircleOutcomeNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "hccm_123",
        memberId: "member_a",
      }),
    );
    expect(mocks.appendCallCircleOutcomeNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        matchId: "hccm_123",
        memberId: "member_b",
      }),
    );
  });

  it("does not append Call Circle result notifications when the match outcome was already claimed", async () => {
    mocks.markCallCircleMatchOutcome.mockResolvedValueOnce(false);

    await expect(handleRetellCallAnalyzed({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "The Call Circle bridge completed.",
          },
        },
        call_id: "retell_call_123",
        data_storage_setting: "basic_attributes_only",
      },
    })).resolves.toEqual({
      notificationMailboxItemId: null,
      notificationSignals: [],
      notificationUserId: null,
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now: expect.any(Date),
      outcome: "completed",
      phoneCallId: "hpc_123",
      prisma: expect.any(Object),
      status: "completed",
    });
    expect(mocks.attachCallCirclePhoneCall).toHaveBeenCalledWith({
      matchId: "hccm_123",
      phoneCallId: "hpc_123",
      prisma: expect.any(Object),
    });
    expect(mocks.hostedCallCircleMatchFindUnique).toHaveBeenCalledWith({
      select: {
        memberAId: true,
        memberBId: true,
      },
      where: { id: "hccm_123" },
    });
    expect(mocks.hostedMailboxItemFindUnique).toHaveBeenCalledTimes(2);
    expect(mocks.appendCallCircleOutcomeNotificationTx).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
  });

  it("re-signals existing unconsumed Call Circle result notifications on Retell replay", async () => {
    mocks.markCallCircleMatchOutcome.mockResolvedValueOnce(false);
    mocks.hostedMailboxItemFindUnique
      .mockResolvedValueOnce({ consumedAt: null, id: "mailbox_a" })
      .mockResolvedValueOnce({ consumedAt: null, id: "mailbox_b" });

    await expect(handleRetellCallAnalyzed({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "The Call Circle bridge completed.",
          },
        },
        call_id: "retell_call_123",
        data_storage_setting: "basic_attributes_only",
      },
    })).resolves.toEqual({
      notificationMailboxItemId: "mailbox_a",
      notificationSignals: [
        {
          notificationMailboxItemId: "mailbox_a",
          notificationUserId: "member_a",
        },
        {
          notificationMailboxItemId: "mailbox_b",
          notificationUserId: "member_b",
        },
      ],
      notificationUserId: "member_a",
    });

    expect(mocks.appendCallCircleOutcomeNotificationTx).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
    expect(mocks.hostedMailboxItemFindUnique).toHaveBeenNthCalledWith(1, {
      select: {
        consumedAt: true,
        id: true,
      },
      where: {
        userId_dedupeKey: {
          dedupeKey: "assistant.notification.requested:call-circle:outcome:hccm_123:member_a",
          userId: "member_a",
        },
      },
    });
    expect(mocks.hostedMailboxItemFindUnique).toHaveBeenNthCalledWith(2, {
      select: {
        consumedAt: true,
        id: true,
      },
      where: {
        userId_dedupeKey: {
          dedupeKey: "assistant.notification.requested:call-circle:outcome:hccm_123:member_b",
          userId: "member_b",
        },
      },
    });
  });
});

function buildCallCirclePhoneCall(): HostedPhoneCall {
  const now = new Date("2026-07-06T15:00:00.000Z");
  return {
    analyzedAt: null,
    briefJson: {
      allowTransferToUser: true,
      goal: "Connect two group members for a short Call Circle call.",
      instructions: ["Connect the call."],
      shareableFacts: {},
      successCriteria: "The bridge completes.",
      timeZone: "UTC",
      to: {
        label: "Call Circle participant",
        phoneNumber: "+12125550123",
      },
    },
    createdAt: now,
    endedAt: null,
    id: "hpc_123",
    memberId: "member_a",
    provider: "retell",
    providerCallId: "retell_call_123",
    requestKey: "call-circle:hccm_123",
    resultJson: null,
    status: "ended",
    updatedAt: now,
  };
}
