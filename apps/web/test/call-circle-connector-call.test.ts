import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendCallCircleHandoffNotificationTx: vi.fn(),
  attachCallCirclePhoneCall: vi.fn(),
  canUseActiveCallCircleParticipantPair: vi.fn(),
  claimCallCircleMatchForConnector: vi.fn(),
  createHostedPhoneCall: vi.fn(),
  getPrisma: vi.fn(),
  markCallCircleMatchOutcome: vi.fn(),
  readCallCircleNotificationSignal: vi.fn(),
  readCallCircleNotificationPreflightTx: vi.fn(),
  resolveVerifiedMemberTransferNumber: vi.fn(),
  signalCallCircleNotificationRuntimesBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/call-circle/match-store", () => ({
  attachCallCirclePhoneCall: mocks.attachCallCirclePhoneCall,
  claimCallCircleMatchForConnector: mocks.claimCallCircleMatchForConnector,
  markCallCircleMatchOutcome: mocks.markCallCircleMatchOutcome,
}));

vi.mock("@/src/lib/call-circle/participant-store", () => ({
  canUseActiveCallCircleParticipantPair: mocks.canUseActiveCallCircleParticipantPair,
}));

vi.mock("@/src/lib/call-circle/notifications", () => ({
  appendCallCircleHandoffNotificationTx: mocks.appendCallCircleHandoffNotificationTx,
  readCallCircleNotificationSignal: mocks.readCallCircleNotificationSignal,
  readCallCircleNotificationPreflightTx: mocks.readCallCircleNotificationPreflightTx,
  signalCallCircleNotificationRuntimesBestEffort: mocks.signalCallCircleNotificationRuntimesBestEffort,
}));

vi.mock("@/src/lib/phone-calls/service", () => ({
  createHostedPhoneCall: mocks.createHostedPhoneCall,
}));

vi.mock("@/src/lib/phone-calls/transfer", () => ({
  resolveVerifiedMemberTransferNumber: mocks.resolveVerifiedMemberTransferNumber,
}));

import {
  buildCallCircleConnectorRequestKey,
  startCallCircleConnectorCall,
} from "@/src/lib/call-circle/connector-call";

describe("startCallCircleConnectorCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RETELL_CONNECTOR_AGENT_ID", "agent_123");
    vi.stubEnv("RETELL_CONNECTOR_AGENT_VERSION", "2");
    mocks.attachCallCirclePhoneCall.mockResolvedValue(true);
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValue(true);
    mocks.claimCallCircleMatchForConnector.mockResolvedValue(true);
    mocks.createHostedPhoneCall.mockImplementation(async (input) => {
      const phoneCallId = "hpc_123";
      if (input.beforeStart && !await input.beforeStart({
        memberId: input.memberId,
        phoneCallId,
      })) {
        throw new Error("Phone call start aborted.");
      }
      return {
        phoneCallId,
        status: "calling",
      };
    });
    mocks.markCallCircleMatchOutcome.mockResolvedValue(true);
    mocks.appendCallCircleHandoffNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_handoff",
      status: "sent",
    });
    mocks.readCallCircleNotificationSignal.mockImplementation(({ memberId, notification }) =>
      notification.status === "sent" && notification.mailboxItemId
        ? { mailboxItemId: notification.mailboxItemId, memberId }
        : null);
    mocks.readCallCircleNotificationPreflightTx.mockResolvedValue({
      route: { channel: "linq" },
      status: "ok",
    });
    mocks.signalCallCircleNotificationRuntimesBestEffort.mockResolvedValue(undefined);
    mocks.resolveVerifiedMemberTransferNumber
      .mockResolvedValueOnce("+15551110000")
      .mockResolvedValueOnce("+15552220000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reuses a claimed bridge with no attached phone call instead of claiming again", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "bridging",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({
      phoneCallId: "hpc_123",
      status: "calling",
    });

    expect(mocks.claimCallCircleMatchForConnector).not.toHaveBeenCalled();
    expect(mocks.createHostedPhoneCall).toHaveBeenCalledWith(expect.objectContaining({
      brief: expect.objectContaining({
        instructions: expect.arrayContaining([
          "Transfer the call immediately after the opening line.",
        ]),
        successCriteria: "The call transfers to the matched group member.",
      }),
      memberId: "member_a",
      requestKey: buildCallCircleConnectorRequestKey("hccm_123"),
      runtimeOptions: expect.objectContaining({
        openingLine:
          "This is Murph. Connecting you with a friend from your group, one moment.",
      }),
    }));
    expect(mocks.attachCallCirclePhoneCall).toHaveBeenCalledWith({
      matchId: "hccm_123",
      phoneCallId: "hpc_123",
      prisma,
    });
  });

  it("does not start Retell when the pre-start match attachment loses a pause race", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.attachCallCirclePhoneCall.mockResolvedValueOnce(false);
    mocks.markCallCircleMatchOutcome.mockResolvedValueOnce(false);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "ignored" });

    expect(mocks.createHostedPhoneCall).toHaveBeenCalledWith(expect.objectContaining({
      beforeStart: expect.any(Function),
      requestKey: buildCallCircleConnectorRequestKey("hccm_123"),
    }));
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "connector_start_failed",
      prisma: expect.any(Object),
      status: "dropped",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
  });

  it("cancels inactive pairs before connector configuration fallback can hand off", async () => {
    vi.stubEnv("RETELL_CONNECTOR_AGENT_ID", "");
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValueOnce(false);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "ignored" });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "participant_unavailable",
      prisma,
      status: "canceled",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
    expect(mocks.createHostedPhoneCall).not.toHaveBeenCalled();
  });

  it("revalidates the active pair inside connector handoff terminalization", async () => {
    vi.stubEnv("RETELL_CONNECTOR_AGENT_ID", "");
    const now = new Date("2026-07-06T15:00:00.000Z");
    const tx = {};
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    }, tx);
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.canUseActiveCallCircleParticipantPair
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "ignored" });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "participant_unavailable",
      prisma: tx,
      status: "canceled",
    });
    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "connector_agent_unconfigured",
      }),
    );
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
  });

  it("keeps a recovered bridge retryable while the duplicate phone-call row is still starting", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "bridging",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.createHostedPhoneCall.mockResolvedValueOnce({
      phoneCallId: "hpc_existing",
      status: "starting",
    });

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({
      phoneCallId: "hpc_existing",
      status: "ignored",
    });

    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
    expect(mocks.attachCallCirclePhoneCall).not.toHaveBeenCalled();
  });

  it("starts an attached unstarted bridge through the stable phone-call request key", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCall: {
        analyzedAt: null,
        providerCallId: null,
        status: "starting",
      },
      phoneCallId: "hpc_existing",
      status: "bridging",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.createHostedPhoneCall.mockImplementationOnce(async (input) => {
      expect(await input.beforeStart({
        memberId: input.memberId,
        phoneCallId: "hpc_existing",
      })).toBe(true);
      return {
        phoneCallId: "hpc_existing",
        status: "calling",
      };
    });

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({
      phoneCallId: "hpc_existing",
      status: "calling",
    });

    expect(mocks.claimCallCircleMatchForConnector).not.toHaveBeenCalled();
    expect(mocks.createHostedPhoneCall).toHaveBeenCalledWith(expect.objectContaining({
      requestKey: buildCallCircleConnectorRequestKey("hccm_123"),
    }));
    expect(mocks.attachCallCirclePhoneCall).not.toHaveBeenCalled();
    expect(prisma.hostedCallCircleMatch.count).toHaveBeenCalledWith({
      where: {
        finalAskedAt: { not: null },
        groupId: "hgrp_123",
        id: "hccm_123",
        memberAId: "member_a",
        memberBId: "member_b",
        phoneCallId: "hpc_existing",
        status: "bridging",
        windowEndAt: { gt: now },
        windowStartAt: { lte: now },
      },
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
  });

  it("ignores an attached bridge after provider start was attempted", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCall: {
        analyzedAt: null,
        providerCallId: null,
        providerStartAttemptedAt: new Date("2026-07-06T15:00:01.000Z"),
        status: "starting",
      },
      phoneCallId: "hpc_existing",
      status: "bridging",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({
      status: "ignored",
    });

    expect(mocks.claimCallCircleMatchForConnector).not.toHaveBeenCalled();
    expect(mocks.createHostedPhoneCall).not.toHaveBeenCalled();
    expect(mocks.attachCallCirclePhoneCall).not.toHaveBeenCalled();
  });

  it("does not notify handoff when the outcome transition no longer applies", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.markCallCircleMatchOutcome.mockResolvedValueOnce(false);
    mocks.resolveVerifiedMemberTransferNumber.mockReset();
    mocks.resolveVerifiedMemberTransferNumber
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("+15552220000");

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "ignored" });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "verified_phone_missing",
      prisma: expect.any(Object),
      status: "dropped",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).not.toHaveBeenCalled();
  });

  it("terminalizes connector handoff even when one notification preflight is blocked", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.resolveVerifiedMemberTransferNumber.mockReset();
    mocks.resolveVerifiedMemberTransferNumber
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("+15552220000");
    mocks.readCallCircleNotificationPreflightTx
      .mockResolvedValueOnce({ reason: "quiet_hours", status: "blocked" })
      .mockResolvedValueOnce({ route: { channel: "linq" }, status: "ok" });

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "handoff" });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      now,
      outcome: "verified_phone_missing",
      prisma: expect.any(Object),
      status: "dropped",
    });
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendCallCircleHandoffNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "member_b" }),
    );
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([
      { mailboxItemId: "mailbox_handoff", memberId: "member_b" },
    ]);
  });
});

function createPrisma(input: {
  finalAskedAt: Date | null;
  phoneCall?: {
    analyzedAt: Date | null;
    providerCallId: string | null;
    providerStartAttemptedAt?: Date | null;
    status: string;
  } | null;
  phoneCallId: string | null;
  status: string;
  windowEndAt: Date;
  windowStartAt: Date;
}, tx: object = {}) {
  return {
    $transaction: vi.fn(async (run: (tx: object) => Promise<unknown>) => run(tx)),
    hostedCallCircleMatch: {
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async () => ({
        finalAskedAt: input.finalAskedAt,
        groupId: "hgrp_123",
        id: "hccm_123",
        memberA: { pendingActivationTimeZone: "UTC" },
        memberAId: "member_a",
        memberB: { pendingActivationTimeZone: "UTC" },
        memberBId: "member_b",
        phoneCall: input.phoneCall
          ? {
              ...input.phoneCall,
              providerStartAttemptedAt: input.phoneCall.providerStartAttemptedAt ?? null,
            }
          : null,
        phoneCallId: input.phoneCallId,
        status: input.status,
        windowEndAt: input.windowEndAt,
        windowStartAt: input.windowStartAt,
      })),
    },
  };
}
