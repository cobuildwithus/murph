import type { HostedPhoneCall } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendCallCircleTerminalNotificationsTx: vi.fn(),
  hostedCallCircleMatchFindUnique: vi.fn(),
  hostedMailboxItemFindUnique: vi.fn(),
  hostedPhoneCallFindUnique: vi.fn(),
  hostedPhoneCallFindUniqueOrThrow: vi.fn(),
  hostedPhoneCallUpdateMany: vi.fn(),
  markCallCircleMatchOutcome: vi.fn(),
  prismaTransaction: vi.fn(),
  readExistingCallCircleNotificationSignalTx: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: mocks.prismaTransaction,
  }),
}));

vi.mock("@/src/lib/call-circle/match-store", () => ({
  markCallCircleMatchOutcome: mocks.markCallCircleMatchOutcome,
}));

vi.mock("@/src/lib/call-circle/notifications", () => ({
  appendCallCircleTerminalNotificationsTx:
    mocks.appendCallCircleTerminalNotificationsTx,
  buildCallCircleTerminalNotificationEventId: ({ kind, matchId, memberId }: {
    kind: "handoff" | "outcome";
    matchId: string;
    memberId: string;
  }) => `assistant.notification.requested:call-circle:${kind}:${matchId}:${memberId}`,
  readExistingCallCircleNotificationSignalTx: mocks.readExistingCallCircleNotificationSignalTx,
}));

import {
  handleRetellCallAnalyzed,
  handleRetellTransferOutcome,
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
      groupId: "hgrp_123",
      id: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
    });
    mocks.hostedMailboxItemFindUnique.mockResolvedValue(null);
    mocks.markCallCircleMatchOutcome.mockResolvedValue(true);
    mocks.appendCallCircleTerminalNotificationsTx.mockResolvedValue([
      { mailboxItemId: "mailbox_123", memberId: "member_a" },
      { mailboxItemId: "mailbox_123", memberId: "member_b" },
    ]);
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
            outcome: "not_completed",
            result: "The model incorrectly said the bridge failed.",
          },
        },
        call_id: "retell_call_123",
        data_storage_setting: "basic_attributes_only",
      },
    })).resolves.toEqual({
      notificationSignals: [
        {
          mailboxItemId: "mailbox_123",
          memberId: "member_a",
        },
        {
          mailboxItemId: "mailbox_123",
          memberId: "member_b",
        },
      ],
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "completed",
      phoneCallId: "hpc_123",
      prisma: expect.any(Object),
      status: "completed",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).toHaveBeenCalledWith({
      groupId: "hgrp_123",
      kind: "outcome",
      matchId: "hccm_123",
      memberAId: "member_a",
      memberBId: "member_b",
      now: expect.any(Date),
      tx: expect.any(Object),
    });
  });

  it("defers a cancelled transfer during the late-bridge grace period", async () => {
    mocks.hostedPhoneCallFindUnique.mockResolvedValueOnce({
      ...buildCallCirclePhoneCall(),
      transferOutcome: "cancelled",
    });

    await expect(handleRetellCallAnalyzed({
      call: {
        call_analysis: {
          custom_analysis_data: {
            outcome: "completed",
            result: "The model incorrectly said the bridge completed.",
          },
        },
        call_id: "retell_call_123",
        data_storage_setting: "basic_attributes_only",
        disconnection_reason: "transfer_cancelled",
      },
    })).resolves.toEqual({ notificationSignals: [] });

    expect(mocks.hostedPhoneCallUpdateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        analyzedAt: expect.any(Date),
        endedAt: expect.any(Date),
        status: "failed",
        transferOutcome: "cancelled",
      }),
      where: expect.objectContaining({
        analyzedAt: null,
        resultJson: { equals: expect.anything() },
      }),
    });
    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleTerminalNotificationsTx).not.toHaveBeenCalled();
  });

  it("uses preference timezone preflight before Retell result notifications", async () => {
    mocks.appendCallCircleTerminalNotificationsTx.mockResolvedValueOnce([
      { mailboxItemId: "mailbox_123", memberId: "member_b" },
    ]);

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
      notificationSignals: [
        {
          mailboxItemId: "mailbox_123",
          memberId: "member_b",
        },
      ],
    });

    expect(mocks.appendCallCircleTerminalNotificationsTx).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "outcome", memberBId: "member_b" }),
    );
  });

  it("does not append Call Circle result notifications when the match outcome was already claimed", async () => {
    mocks.markCallCircleMatchOutcome
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

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
      notificationSignals: [],
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "completed",
      phoneCallId: "hpc_123",
      prisma: expect.any(Object),
      status: "completed",
    });
    expect(mocks.hostedCallCircleMatchFindUnique).toHaveBeenCalledWith({
      select: {
        memberAId: true,
        memberBId: true,
      },
      where: { id: "hccm_123" },
    });
    expect(mocks.hostedMailboxItemFindUnique).toHaveBeenCalledTimes(2);
    expect(mocks.appendCallCircleTerminalNotificationsTx)
      .not.toHaveBeenCalled();
  });

  it("re-signals existing unconsumed Call Circle result notifications on Retell replay", async () => {
    mocks.markCallCircleMatchOutcome
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
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
      notificationSignals: [
        {
          mailboxItemId: "mailbox_a",
          memberId: "member_a",
        },
        {
          mailboxItemId: "mailbox_b",
          memberId: "member_b",
        },
      ],
    });

    expect(mocks.appendCallCircleTerminalNotificationsTx)
      .not.toHaveBeenCalled();
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

  it("emits only the completed outcome when a bridge arrives during grace", async () => {
    mocks.hostedPhoneCallFindUnique.mockResolvedValueOnce({
      ...buildCallCirclePhoneCall(),
      transferOutcome: null,
    });
    const call = {
      call_id: "retell_call_123",
      data_storage_setting: "basic_attributes_only",
      disconnection_reason: "transfer_cancelled",
    };

    await expect(handleRetellCallAnalyzed({ call })).resolves.toEqual({
      notificationSignals: [],
    });
    await expect(handleRetellTransferOutcome({
      call,
      event: "transfer_bridged",
    })).resolves.toEqual({
      notificationSignals: [
        {
          mailboxItemId: "mailbox_123",
          memberId: "member_a",
        },
        {
          mailboxItemId: "mailbox_123",
          memberId: "member_b",
        },
      ],
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "completed",
      phoneCallId: "hpc_123",
      prisma: expect.any(Object),
      status: "completed",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendCallCircleTerminalNotificationsTx).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "outcome" }),
    );
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
    providerStartAttemptedAt: null,
    requestKey: "opaque-idempotency-key",
    resultJson: null,
    status: "ended",
    transferOutcome: "bridged",
    updatedAt: now,
  };
}
