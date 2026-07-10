import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  appendCallCircleTerminalNotificationsTx: vi.fn(),
  attachCallCirclePhoneCall: vi.fn(),
  canUseActiveCallCircleParticipantPair: vi.fn(),
  claimCallCircleMatchForConnector: vi.fn(),
  createHostedPhoneCall: vi.fn(),
  getPrisma: vi.fn(),
  markCallCircleMatchOutcome: vi.fn(),
  readCallCircleMatchParticipantTimeZones: vi.fn(),
  resolveVerifiedMemberTransferNumber: vi.fn(),
  signalHostedAssistantNotificationsBestEffort: vi.fn(),
  terminalizeUnstartedHostedPhoneCall: vi.fn(),
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
  activeCallCircleParticipantPairMatchWhere: ({
    groupId,
    memberAId,
    memberBId,
  }: {
    groupId: string;
    memberAId: string;
    memberBId: string;
  }) => ({
    AND: [
      {
        group: {
          callCircleParticipants: {
            some: {
              memberId: memberAId,
              status: "enrolled",
            },
          },
        },
      },
      {
        group: {
          callCircleParticipants: {
            some: {
              memberId: memberBId,
              status: "enrolled",
            },
          },
        },
      },
      {
        group: {
          members: {
            some: { memberId: memberAId },
          },
        },
      },
      {
        group: {
          members: {
            some: { memberId: memberBId },
          },
        },
      },
    ],
    groupId,
    memberA: { suspendedAt: null },
    memberAId,
    memberB: { suspendedAt: null },
    memberBId,
  }),
  canUseActiveCallCircleParticipantPair: mocks.canUseActiveCallCircleParticipantPair,
  readCallCircleMatchParticipantTimeZones: mocks.readCallCircleMatchParticipantTimeZones,
}));

vi.mock("@/src/lib/call-circle/notifications", () => ({
  appendCallCircleTerminalNotificationsTx:
    mocks.appendCallCircleTerminalNotificationsTx,
}));

vi.mock("@/src/lib/hosted-execution/assistant-notifications", () => ({
  signalHostedAssistantNotificationsBestEffort:
    mocks.signalHostedAssistantNotificationsBestEffort,
}));

vi.mock("@/src/lib/phone-calls/service", () => ({
  createHostedPhoneCall: mocks.createHostedPhoneCall,
  terminalizeUnstartedHostedPhoneCall:
    mocks.terminalizeUnstartedHostedPhoneCall,
}));

vi.mock("@/src/lib/phone-calls/transfer", () => ({
  resolveVerifiedMemberTransferNumber: mocks.resolveVerifiedMemberTransferNumber,
}));

import { startCallCircleConnectorCall } from "@/src/lib/call-circle/connector-call";

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
    mocks.appendCallCircleTerminalNotificationsTx.mockResolvedValue([
      { mailboxItemId: "mailbox_handoff_a", memberId: "member_a" },
      { mailboxItemId: "mailbox_handoff_b", memberId: "member_b" },
    ]);
    mocks.readCallCircleMatchParticipantTimeZones.mockResolvedValue({
      memberATimeZone: "UTC",
      memberBTimeZone: "UTC",
    });
    mocks.signalHostedAssistantNotificationsBestEffort.mockResolvedValue(undefined);
    mocks.terminalizeUnstartedHostedPhoneCall.mockResolvedValue(true);
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
        instructions: [
          "Transfer the call immediately after the opening line.",
          "Do not ask for another confirmation; web already recorded both final confirmations before this connector call started.",
          "Use only the server-supplied transfer target. Never say, spell, or repeat its phone number.",
        ],
        shareableFacts: {},
        successCriteria: "The call transfers to the matched group member.",
      }),
      memberId: "member_a",
      requestKey: "call-circle:hccm_123",
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
      requestKey: "call-circle:hccm_123",
    }));
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "connector_start_failed",
      phoneCallId: null,
      prisma: expect.any(Object),
      status: "dropped",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).not.toHaveBeenCalled();
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
      outcome: "participant_unavailable",
      phoneCallId: null,
      prisma: expect.any(Object),
      status: "canceled",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).not.toHaveBeenCalled();
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
    mocks.canUseActiveCallCircleParticipantPair.mockResolvedValueOnce(false);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "ignored" });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "participant_unavailable",
      phoneCallId: null,
      prisma: tx,
      status: "canceled",
    });
    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "connector_agent_unconfigured",
      }),
    );
    expect(mocks.appendCallCircleTerminalNotificationsTx).not.toHaveBeenCalled();
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
    expect(mocks.appendCallCircleTerminalNotificationsTx).not.toHaveBeenCalled();
    expect(mocks.attachCallCirclePhoneCall).not.toHaveBeenCalled();
  });

  it("cancels an attached bridge when the provider start guard sees a paused pair", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.canUseActiveCallCircleParticipantPair
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mocks.createHostedPhoneCall.mockImplementationOnce(async (input) => {
      expect(await input.beforeStart({
        memberId: input.memberId,
        phoneCallId: "hpc_123",
      })).toBe(true);
      return {
        phoneCallId: "hpc_123",
        status: "starting",
      };
    });

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({
      phoneCallId: "hpc_123",
      status: "ignored",
    });

    expect(mocks.createHostedPhoneCall).toHaveBeenCalledWith(expect.objectContaining({
      providerStartGuardWhere: expect.any(Function),
      requestKey: "call-circle:hccm_123",
    }));
    const attemptedAt = new Date("2026-07-06T15:05:00.000Z");
    const providerStartGuardWhere = mocks.createHostedPhoneCall.mock.calls[0]?.[0]
      .providerStartGuardWhere;
    expect(providerStartGuardWhere?.(attemptedAt)).toEqual({
      callCircleMatch: {
        is: expect.objectContaining({
          finalAskedAt: { not: null },
          groupId: "hgrp_123",
          id: "hccm_123",
          memberA: expect.any(Object),
          memberAId: "member_a",
          memberB: expect.any(Object),
          memberBId: "member_b",
          status: "bridging",
          windowEndAt: { gt: attemptedAt },
          windowStartAt: {
            gt: new Date("2026-07-06T14:50:00.000Z"),
            lte: attemptedAt,
          },
        }),
      },
    });
    expect(mocks.attachCallCirclePhoneCall).toHaveBeenCalledWith({
      matchId: "hccm_123",
      phoneCallId: "hpc_123",
      prisma,
    });
    expect(mocks.terminalizeUnstartedHostedPhoneCall).toHaveBeenCalledWith({
      phoneCallId: "hpc_123",
      prisma: expect.any(Object),
    });
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "participant_unavailable",
      phoneCallId: "hpc_123",
      prisma: expect.any(Object),
      status: "canceled",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).not.toHaveBeenCalled();
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
      requestKey: "call-circle:hccm_123",
    }));
    expect(mocks.attachCallCirclePhoneCall).not.toHaveBeenCalled();
    expect(prisma.hostedCallCircleMatch.count).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            group: {
              callCircleParticipants: {
                some: {
                  memberId: "member_a",
                  status: "enrolled",
                },
              },
            },
          },
          {
            group: {
              callCircleParticipants: {
                some: {
                  memberId: "member_b",
                  status: "enrolled",
                },
              },
            },
          },
          {
            group: {
              members: {
                some: { memberId: "member_a" },
              },
            },
          },
          {
            group: {
              members: {
                some: { memberId: "member_b" },
              },
            },
          },
        ],
        finalAskedAt: { not: null },
        groupId: "hgrp_123",
        id: "hccm_123",
        memberA: { suspendedAt: null },
        memberAId: "member_a",
        memberB: { suspendedAt: null },
        memberBId: "member_b",
        phoneCallId: "hpc_existing",
        status: "bridging",
        windowEndAt: { gt: now },
        windowStartAt: {
          gt: new Date("2026-07-06T14:45:00.000Z"),
          lte: now,
        },
      },
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).not.toHaveBeenCalled();
  });

  it("hands off after a broad stored window has missed the narrow bridge deadline", async () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T08:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T17:00:00.000Z"),
      windowStartAt: new Date("2026-07-06T09:00:00.000Z"),
    });
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "handoff" });

    expect(mocks.claimCallCircleMatchForConnector).not.toHaveBeenCalled();
    expect(mocks.createHostedPhoneCall).not.toHaveBeenCalled();
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "text_handoff",
      phoneCallId: null,
      prisma: expect.any(Object),
      status: "dropped",
    });
  });

  it("leaves a confirmed bridge pending before its window", async () => {
    const now = new Date("2026-07-06T14:30:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:20:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "ignored" });

    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalled();
    expect(mocks.createHostedPhoneCall).not.toHaveBeenCalled();
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

  it("recovers an attached pre-provider failure without replaying create", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCall: {
        analyzedAt: null,
        providerCallId: null,
        providerStartAttemptedAt: new Date("2026-07-06T15:00:01.000Z"),
        status: "failed",
      },
      phoneCallId: "hpc_failed",
      status: "bridging",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({
      phoneCallId: "hpc_failed",
      status: "handoff",
    });

    expect(mocks.createHostedPhoneCall).not.toHaveBeenCalled();
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "connector_start_failed",
      phoneCallId: "hpc_failed",
      prisma: expect.any(Object),
      status: "dropped",
    });
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
      outcome: "verified_phone_missing",
      phoneCallId: null,
      prisma: expect.any(Object),
      status: "dropped",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).not.toHaveBeenCalled();
  });

  it("does not hand off from a stale no-call view after another worker attaches a bridge call", async () => {
    vi.stubEnv("RETELL_CONNECTOR_AGENT_ID", "");
    const now = new Date("2026-07-06T15:00:00.000Z");
    const tx = {
      hostedCallCircleMatch: {
        findUnique: vi.fn(async () => ({
          phoneCall: null,
          phoneCallId: "hpc_attached",
          status: "bridging",
        })),
      },
    };
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    }, tx);
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "ignored" });

    expect(mocks.markCallCircleMatchOutcome).not.toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "connector_agent_unconfigured",
      }),
    );
    expect(mocks.appendCallCircleTerminalNotificationsTx).not.toHaveBeenCalled();
  });

  it("hands off an attached local pre-provider connector failure", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const tx = {
      hostedCallCircleMatch: {
        findUnique: vi.fn(async () => ({
          phoneCall: {
            analyzedAt: null,
            endedAt: null,
            providerCallId: null,
            providerStartAttemptedAt: null,
            status: "failed",
          },
          phoneCallId: "hpc_failed",
          status: "bridging",
        })),
      },
    };
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    }, tx);
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.createHostedPhoneCall.mockImplementationOnce(async (input) => {
      expect(await input.beforeStart({
        memberId: input.memberId,
        phoneCallId: "hpc_failed",
      })).toBe(true);
      throw new Error("Retell config failed before provider start.");
    });

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "handoff" });

    expect(mocks.attachCallCirclePhoneCall).toHaveBeenCalledWith({
      matchId: "hccm_123",
      phoneCallId: "hpc_failed",
      prisma,
    });
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "connector_start_failed",
      phoneCallId: "hpc_failed",
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).toHaveBeenCalledTimes(1);
  });

  it("hands off an attached definite provider rejection without provider identity", async () => {
    const now = new Date("2026-07-06T15:00:00.000Z");
    const tx = {
      hostedCallCircleMatch: {
        findUnique: vi.fn(async () => ({
          phoneCall: {
            analyzedAt: null,
            endedAt: null,
            providerCallId: null,
            providerStartAttemptedAt: new Date("2026-07-06T15:00:01.000Z"),
            status: "failed",
          },
          phoneCallId: "hpc_failed",
          status: "bridging",
        })),
      },
    };
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T15:30:00.000Z"),
      windowStartAt: now,
    }, tx);
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.createHostedPhoneCall.mockResolvedValueOnce({
      phoneCallId: "hpc_failed",
      status: "failed",
    });

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({
      phoneCallId: "hpc_failed",
      status: "handoff",
    });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "connector_start_failed",
      phoneCallId: "hpc_failed",
      prisma: tx,
      status: "dropped",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).toHaveBeenCalledTimes(1);
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
    mocks.appendCallCircleTerminalNotificationsTx.mockResolvedValueOnce([
      { mailboxItemId: "mailbox_handoff", memberId: "member_b" },
    ]);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "handoff" });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "verified_phone_missing",
      phoneCallId: null,
      prisma: expect.any(Object),
      status: "dropped",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberAId: "member_a",
        memberBId: "member_b",
      }),
    );
    expect(mocks.signalHostedAssistantNotificationsBestEffort).toHaveBeenCalledWith([
      { mailboxItemId: "mailbox_handoff", memberId: "member_b" },
    ]);
  });

  it("terminalizes an attached unstarted phone reservation after the bridge window", async () => {
    const now = new Date("2026-07-06T15:16:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCall: {
        analyzedAt: null,
        providerCallId: null,
        providerStartAttemptedAt: null,
        status: "starting",
      },
      phoneCallId: "hpc_unstarted",
      status: "bridging",
      windowEndAt: new Date("2026-07-06T17:00:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "handoff" });

    expect(mocks.terminalizeUnstartedHostedPhoneCall).toHaveBeenCalledWith({
      phoneCallId: "hpc_unstarted",
      prisma: expect.any(Object),
    });
    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "text_handoff",
      phoneCallId: "hpc_unstarted",
      prisma: expect.any(Object),
      status: "dropped",
    });
    expect(mocks.createHostedPhoneCall).not.toHaveBeenCalled();
  });

  it("terminalizes an elapsed bridge even when timezone data blocks notification", async () => {
    const now = new Date("2026-07-06T15:16:00.000Z");
    const prisma = createPrisma({
      finalAskedAt: new Date("2026-07-06T14:45:00.000Z"),
      phoneCallId: null,
      status: "both_confirmed",
      windowEndAt: new Date("2026-07-06T17:00:00.000Z"),
      windowStartAt: new Date("2026-07-06T15:00:00.000Z"),
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.appendCallCircleTerminalNotificationsTx.mockResolvedValueOnce([]);

    await expect(startCallCircleConnectorCall({
      matchId: "hccm_123",
      now,
    })).resolves.toEqual({ status: "handoff" });

    expect(mocks.markCallCircleMatchOutcome).toHaveBeenCalledWith({
      matchId: "hccm_123",
      outcome: "text_handoff",
      phoneCallId: null,
      prisma: expect.any(Object),
      status: "dropped",
    });
    expect(mocks.appendCallCircleTerminalNotificationsTx).toHaveBeenCalledOnce();
  });
});

function createPrisma(input: {
  finalAskedAt: Date | null;
  phoneCall?: {
    analyzedAt: Date | null;
    endedAt?: Date | null;
    providerCallId: string | null;
    providerStartAttemptedAt?: Date | null;
    status: string;
  } | null;
  phoneCallId: string | null;
  status: string;
  windowEndAt: Date;
  windowStartAt: Date;
}, tx: object = {}) {
  const readMatch = () => ({
    finalAskedAt: input.finalAskedAt,
    groupId: "hgrp_123",
    id: "hccm_123",
    memberAId: "member_a",
    memberBId: "member_b",
    phoneCall: input.phoneCall
      ? {
          ...input.phoneCall,
          endedAt: input.phoneCall.endedAt ?? null,
          providerStartAttemptedAt: input.phoneCall.providerStartAttemptedAt ?? null,
        }
      : null,
    phoneCallId: input.phoneCallId,
    status: input.status,
    windowEndAt: input.windowEndAt,
    windowStartAt: input.windowStartAt,
  });
  const transactionClient = tx as {
    hostedCallCircleMatch?: {
      findUnique?: ReturnType<typeof vi.fn>;
    };
  };
  transactionClient.hostedCallCircleMatch ??= {
    findUnique: vi.fn(async () => readMatch()),
  };
  return {
    $transaction: vi.fn(async (run: (tx: object) => Promise<unknown>) => run(tx)),
    hostedCallCircleMatch: {
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async () => readMatch()),
    },
    hostedCallCircleParticipant: {
      findMany: vi.fn(async (args: { where?: { memberId?: { in?: string[] } } }) =>
        (args.where?.memberId?.in ?? []).map((memberId) => ({
          memberId,
          preferencesJson: {
            timeZone: "UTC",
            windows: [{
              dayOfWeek: 1,
              endLocalTime: "17:30",
              startLocalTime: "17:00",
            }],
          },
        }))),
    },
  };
}
