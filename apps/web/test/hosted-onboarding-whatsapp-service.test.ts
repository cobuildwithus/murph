import { createHmac } from "node:crypto";

import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  acceptHostedFamilyInviteFromPhoneTx: vi.fn(async (
    _input?: unknown,
  ): Promise<{ memberId: string } | null> => {
    void _input;
    return null;
  }),
  resolveHostedFamilyInviteTokenForInbound: vi.fn(),
  appendHostedMailboxEnvelopeTx: vi.fn(async (input: {
    envelope?: { eventId?: string };
  }) => ({
    duplicate: false,
    item: {
      id: `mailbox_${input.envelope?.eventId ?? "unknown"}`,
    },
  })),
  readHostedMailboxItemOwnerById: vi.fn(async (input: {
    mailboxItemId: string;
  }) => ({
    id: input.mailboxItemId,
    userId: "member_whatsapp_123",
  })),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(async (
    input?: { context?: string; timeoutMs?: number; userId: string },
  ) => {
    void input;
    return {
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    };
  }),
  nudgeHostedAssistantRunnerUserBestEffortResult: vi.fn(async (
    input: { context?: string; timeoutMs?: number; userId: string },
  ) => {
    void input;
    return {
      accepted: true,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
      usageGateDenied: false,
    };
  }),
  signalHostedMailboxAppendRuntime: vi.fn(async () => ({
    signalAccepted: true,
    workflowId: "hosted-user-runtime:member_whatsapp_123",
  })),
}));

vi.mock("@/src/lib/hosted-mailbox/store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-mailbox/store")>(
    "@/src/lib/hosted-mailbox/store",
  );

  return {
    ...actual,
    appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
    readHostedMailboxItemOwnerById: mocks.readHostedMailboxItemOwnerById,
  };
});

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-runner/assistant-nudge", () => ({
  nudgeHostedAssistantRunnerUserBestEffortResult: mocks.nudgeHostedAssistantRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/family-plan")>(
    "@/src/lib/hosted-onboarding/family-plan",
  );
  mocks.resolveHostedFamilyInviteTokenForInbound.mockImplementation(async (input: {
    text: string | null | undefined;
  }) => actual.parseHostedFamilyInviteStartToken(input.text));

  return {
    ...actual,
    acceptHostedFamilyInviteFromPhoneTx: mocks.acceptHostedFamilyInviteFromPhoneTx,
    resolveHostedFamilyInviteTokenForInbound: mocks.resolveHostedFamilyInviteTokenForInbound,
  };
});

import {
  handleHostedOnboardingWhatsAppWebhook as handleHostedOnboardingWhatsAppWebhookImpl,
} from "@/src/lib/hosted-onboarding/webhook-service";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  grantHostedWhatsAppMessagingConsentTx,
  revokeHostedWhatsAppMessagingConsentTx,
} from "@/src/lib/hosted-onboarding/whatsapp-consent";

type HostedOnboardingWhatsAppWebhookInput =
  Parameters<typeof handleHostedOnboardingWhatsAppWebhookImpl>[0];

describe("handleHostedOnboardingWhatsAppWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WHATSAPP_APP_SECRET", "whatsapp-app-secret");
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockResolvedValue(null);
    mocks.readHostedMailboxItemOwnerById.mockImplementation(async (input: {
      mailboxItemId: string;
    }) => ({
      id: input.mailboxItemId,
      userId: "member_whatsapp_123",
    }));
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockImplementation(async (input) => ({
      ...await mocks.nudgeHostedRunnerUserBestEffortResult(input),
      usageGateDenied: false,
    }));
  });

  it("verifies signed WhatsApp webhook payloads and reports no-op updates", async () => {
    const rawBody = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                statuses: [{ id: "status-1" }],
              },
            },
          ],
        },
      ],
      object: "whatsapp_business_account",
    });

    await expect(handleHostedOnboardingWhatsAppWebhook({
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: true,
      inboundTextCount: 0,
      ok: true,
      reason: "unsupported-update",
      routedTextCount: 0,
    });
  });

  it("fails closed after parsing inbound texts from unlinked WhatsApp senders", async () => {
    const rawBody = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    from: "15550100001",
                    id: "wamid.test-message-1",
                    text: {
                      body: "CHECKIN",
                    },
                    timestamp: "1778250000",
                    type: "text",
                  },
                ],
                metadata: {
                  phone_number_id: "phone-number-id",
                },
              },
            },
          ],
        },
      ],
      object: "whatsapp_business_account",
    });

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma: createWhatsAppPrismaHarness(),
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: true,
      inboundTextCount: 1,
      ok: true,
      reason: "unlinked-whatsapp",
      routedTextCount: 0,
    });
  });

  it("records START consent for a linked active member without calling the assistant", async () => {
    const prisma = createWhatsAppPrismaHarness({
      memberId: "member_whatsapp_123",
    });
    const rawBody = buildWhatsAppInboundTextBody("START");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 1,
      ignored: false,
      inboundTextCount: 1,
      ok: true,
      reason: "whatsapp-command-handled",
      routedTextCount: 0,
    });

    expect(prisma.hostedConsentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "granted",
        memberId: "member_whatsapp_123",
        scope: "feature.whatsapp-messaging",
        source: "whatsapp",
      }),
    });
    expect(prisma.hostedConsentGrant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberId: "member_whatsapp_123",
          status: "granted",
        }),
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("dedupes repeated WhatsApp START commands by provider message id", async () => {
    const prisma = createWhatsAppPrismaHarness({
      memberId: "member_whatsapp_123",
    });
    prisma.hostedConsentEvent.findUnique.mockResolvedValueOnce({
      id: "hbce_existing_whatsapp",
    });
    const rawBody = buildWhatsAppInboundTextBody("START");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      duplicate: true,
      ignored: true,
      inboundTextCount: 1,
      ok: true,
      reason: "duplicate-webhook-event",
      routedTextCount: 0,
    });

    expect(prisma.hostedConsentGrant.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("dedupes repeated WhatsApp consent events before mutating an existing grant", async () => {
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: true,
      memberId: "member_whatsapp_123",
    });
    prisma.hostedConsentEvent.findUnique.mockResolvedValueOnce({
      id: "hbce_existing_whatsapp_stop",
    });

    await expect(revokeHostedWhatsAppMessagingConsentTx({
      eventId: "hbce_existing_whatsapp_stop",
      memberId: "member_whatsapp_123",
      now: new Date("2026-05-08T14:00:00.000Z"),
      prisma: prisma as never,
    })).resolves.toEqual({
      applied: false,
      duplicate: true,
      stale: false,
    });

    expect(prisma.hostedConsentGrant.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedConsentGrant.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedConsentEvent.create).not.toHaveBeenCalled();
  });

  it("re-reads a raced WhatsApp consent grant before deciding whether the START command is stale", async () => {
    const now = new Date("2026-05-08T14:00:00.000Z");
    const racedUpdatedAt = new Date("2026-05-08T13:59:59.000Z");
    const prisma = createWhatsAppPrismaHarness({
      memberId: "member_whatsapp_123",
    });
    prisma.hostedConsentGrant.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        updatedAt: racedUpdatedAt,
      });
    prisma.hostedConsentGrant.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(grantHostedWhatsAppMessagingConsentTx({
      memberId: "member_whatsapp_123",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({
      applied: true,
      duplicate: false,
      stale: false,
    });

    expect(prisma.hostedConsentGrant.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.hostedConsentGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "granted",
          updatedAt: now,
        }),
        where: expect.objectContaining({
          memberId: "member_whatsapp_123",
          scope: "feature.whatsapp-messaging",
          updatedAt: racedUpdatedAt,
        }),
      }),
    );
  });

  it("does not record a START consent event when the raced grant update loses", async () => {
    const now = new Date("2026-05-08T14:00:00.000Z");
    const racedUpdatedAt = new Date("2026-05-08T13:59:59.000Z");
    const prisma = createWhatsAppPrismaHarness({
      consentGrantUpdateManyCount: 0,
      memberId: "member_whatsapp_123",
    });
    prisma.hostedConsentGrant.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        updatedAt: racedUpdatedAt,
      });
    prisma.hostedConsentGrant.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(grantHostedWhatsAppMessagingConsentTx({
      memberId: "member_whatsapp_123",
      now,
      prisma: prisma as never,
    })).resolves.toEqual({
      applied: false,
      duplicate: false,
      stale: true,
    });

    expect(prisma.hostedConsentGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberId: "member_whatsapp_123",
          scope: "feature.whatsapp-messaging",
          updatedAt: racedUpdatedAt,
        }),
      }),
    );
    expect(prisma.hostedConsentEvent.create).not.toHaveBeenCalled();
  });

  it("throws when event creation races after the grant update", async () => {
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: true,
      consentUpdatedAt: new Date("2026-05-08T13:59:59.000Z"),
      memberId: "member_whatsapp_123",
    });
    prisma.hostedConsentEvent.create.mockRejectedValueOnce({ code: "P2002" });

    await expect(revokeHostedWhatsAppMessagingConsentTx({
      eventId: "hbce_existing_whatsapp_stop",
      memberId: "member_whatsapp_123",
      now: new Date("2026-05-08T14:00:00.000Z"),
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "P2002",
    });

    expect(prisma.hostedConsentGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "revoked",
        }),
      }),
    );
  });

  it("fails closed when WhatsApp phone lookup matches multiple members", async () => {
    const prisma = createWhatsAppPrismaHarness({
      memberId: "member_whatsapp_123",
    });
    prisma.hostedMemberIdentity.findMany.mockResolvedValueOnce([
      {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_whatsapp_123",
          suspendedAt: null,
        },
      },
      {
        member: {
          billingStatus: HostedBillingStatus.active,
          id: "member_whatsapp_456",
          suspendedAt: null,
        },
      },
    ]);
    const rawBody = buildWhatsAppInboundTextBody("START");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: true,
      inboundTextCount: 1,
      ok: true,
      reason: "unlinked-whatsapp",
      routedTextCount: 0,
    });

    expect(prisma.hostedConsentEvent.create).not.toHaveBeenCalled();
  });

  it("revokes WhatsApp consent for STOP without calling the assistant", async () => {
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: true,
      memberId: "member_whatsapp_123",
    });
    const rawBody = buildWhatsAppInboundTextBody("STOP");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 1,
      ignored: false,
      inboundTextCount: 1,
      ok: true,
      reason: "whatsapp-command-handled",
      routedTextCount: 0,
    });

    expect(prisma.hostedConsentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "revoked",
        memberId: "member_whatsapp_123",
        scope: "feature.whatsapp-messaging",
      }),
    });
    expect(prisma.hostedConsentGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "revoked",
        }),
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("does not treat a raced STOP command as applied when newer consent wins", async () => {
    const staleCommandAt = new Date("2026-05-08T13:59:59.000Z");
    const prisma = createWhatsAppPrismaHarness({
      consentGrantUpdateManyCount: 0,
      consentGranted: true,
      consentUpdatedAt: new Date("2026-05-08T13:00:00.000Z"),
      memberId: "member_whatsapp_123",
    });

    await expect(revokeHostedWhatsAppMessagingConsentTx({
      memberId: "member_whatsapp_123",
      now: staleCommandAt,
      prisma: prisma as never,
    })).resolves.toEqual({
      applied: false,
      duplicate: false,
      stale: true,
    });

    expect(prisma.hostedConsentGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberId: "member_whatsapp_123",
          scope: "feature.whatsapp-messaging",
          updatedAt: new Date("2026-05-08T13:00:00.000Z"),
        }),
      }),
    );
    expect(prisma.hostedConsentEvent.create).not.toHaveBeenCalled();
  });

  it("applies same-timestamp WhatsApp consent commands in observed order", async () => {
    const commandAt = new Date("2026-05-08T14:00:00.000Z");
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: true,
      consentUpdatedAt: commandAt,
      memberId: "member_whatsapp_123",
    });

    await expect(revokeHostedWhatsAppMessagingConsentTx({
      memberId: "member_whatsapp_123",
      now: commandAt,
      prisma: prisma as never,
    })).resolves.toEqual({
      applied: true,
      duplicate: false,
      stale: false,
    });

    expect(prisma.hostedConsentGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "revoked",
          updatedAt: commandAt,
        }),
        where: expect.objectContaining({
          memberId: "member_whatsapp_123",
          scope: "feature.whatsapp-messaging",
          updatedAt: commandAt,
        }),
      }),
    );
    expect(prisma.hostedConsentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "revoked",
        createdAt: commandAt,
        memberId: "member_whatsapp_123",
        scope: "feature.whatsapp-messaging",
      }),
    });
  });

  it("appends opted-in WhatsApp texts to the hosted mailbox and nudges the runner", async () => {
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: true,
      memberId: "member_whatsapp_123",
    });
    const rawBody = buildWhatsAppInboundTextBody("CHECKIN");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: false,
      inboundTextCount: 1,
      ok: true,
      reason: "wake-appended-active-member",
      routedTextCount: 1,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "whatsapp:message:wamid.test-message-1",
        kind: "conversation.message",
        message: expect.objectContaining({
          channel: "whatsapp",
          whatsappMessage: expect.objectContaining({
            fromWaId: "15550100001",
            messageId: "wamid.test-message-1",
            phoneNumberId: "phone-number-id",
            schema: "murph.hosted-whatsapp-message.v1",
            text: "CHECKIN",
            threadId: "15550100001",
          }),
        }),
        userId: "member_whatsapp_123",
      }),
      tx: prisma,
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_whatsapp_123",
      mailboxItemId: "mailbox_whatsapp:message:wamid.test-message-1",
    });
  });

  it("routes Murph Family questions to the assistant", async () => {
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: true,
      memberId: "member_whatsapp_123",
    });
    const rawBody = buildWhatsAppInboundTextBody("wiesz cos o family planie?");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: false,
      inboundTextCount: 1,
      ok: true,
      reason: "wake-appended-active-member",
      routedTextCount: 1,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "whatsapp:message:wamid.test-message-1",
        kind: "conversation.message",
        message: expect.objectContaining({
          whatsappMessage: expect.objectContaining({
            text: "wiesz cos o family planie?",
          }),
        }),
      }),
      tx: prisma,
    });
  });

  it("routes unknown token-shaped WhatsApp text to the assistant", async () => {
    mocks.resolveHostedFamilyInviteTokenForInbound.mockResolvedValueOnce(null);
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: true,
      memberId: "member_whatsapp_123",
    });
    const rawBody = buildWhatsAppInboundTextBody("sending the family_photos album now");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: false,
      inboundTextCount: 1,
      ok: true,
      reason: "wake-appended-active-member",
      routedTextCount: 1,
    });

    expect(mocks.resolveHostedFamilyInviteTokenForInbound).toHaveBeenCalledWith({
      prisma,
      text: "sending the family_photos album now",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "whatsapp:message:wamid.test-message-1",
        kind: "conversation.message",
        message: expect.objectContaining({
          whatsappMessage: expect.objectContaining({
            text: "sending the family_photos album now",
          }),
        }),
      }),
      tx: prisma,
    });
  });

  it("signals the hosted user runtime for opted-in WhatsApp texts", async () => {
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValueOnce({
      accepted: false,
      alarmScheduled: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: true,
      nextAlarmAtPresent: false,
    });
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: true,
      memberId: "member_whatsapp_123",
    });
    const rawBody = buildWhatsAppInboundTextBody("CHECKIN");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: false,
      inboundTextCount: 1,
      ok: true,
      reason: "wake-appended-active-member",
      routedTextCount: 1,
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_whatsapp_123",
      mailboxItemId: "mailbox_whatsapp:message:wamid.test-message-1",
    });
  });

  it("sends WhatsApp family invite acceptance confirmations through WhatsApp routing", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockImplementationOnce(async (input: unknown) => {
      const familyInput = input as {
        onAcceptedMemberValidated?: (accepted: {
          acceptedMemberId: string;
          invite: unknown;
        }) => Promise<void>;
      };
      await familyInput.onAcceptedMemberValidated?.({
        acceptedMemberId: "member_whatsapp_family",
        invite: {},
      });
      return {
        memberId: "member_whatsapp_family",
      };
    });
    const prisma = createWhatsAppPrismaHarness();
    const rawBody = buildWhatsAppInboundTextBody("family_invite_token");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 1,
      ignored: false,
      inboundTextCount: 1,
      ok: true,
      reason: "wake-appended-active-member",
      routedTextCount: 1,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    expect(envelope).toMatchObject({
      kind: "assistant.notification.requested",
      notification: {
        responsePolicy: {
          kind: "require_send_exact_text",
          text: expect.stringContaining("The Family owner cannot see them."),
        },
        route: {
          channel: "whatsapp",
          delivery: {
            kind: "explicit",
            target: "15550100001",
          },
          threadId: "15550100001",
          threadIsDirect: true,
        },
      },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_whatsapp_family",
      mailboxItemId: expect.stringContaining("assistant.notification.requested:family-chat"),
    });
  });

  it("ignores WhatsApp family invite tokens that are not acceptable for the sender", async () => {
    mocks.acceptHostedFamilyInviteFromPhoneTx.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_PHONE_MISMATCH",
      httpStatus: 403,
      message: "This Family invite is bound to a different phone number.",
    }));
    const prisma = createWhatsAppPrismaHarness();
    const rawBody = buildWhatsAppInboundTextBody("family_invite_wrong_phone");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: true,
      inboundTextCount: 1,
      ok: true,
      reason: "family-invite-not-accepted",
      routedTextCount: 0,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.findMany).not.toHaveBeenCalled();
  });

  it("dedupes repeated WhatsApp message ids through the hosted mailbox append", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockImplementationOnce(async () => ({
      duplicate: true,
      item: {
        id: "mailbox_existing_whatsapp",
      },
    }));
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: true,
      memberId: "member_whatsapp_123",
    });
    const rawBody = buildWhatsAppInboundTextBody("CHECKIN");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      duplicate: true,
      ignored: true,
      inboundTextCount: 1,
      ok: true,
      reason: "duplicate-webhook-event",
      routedTextCount: 0,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_whatsapp_123",
      mailboxItemId: "mailbox_existing_whatsapp",
    });
  });

  it("requires WhatsApp consent before appending linked active member texts", async () => {
    const prisma = createWhatsAppPrismaHarness({
      consentGranted: false,
      memberId: "member_whatsapp_123",
    });
    const rawBody = buildWhatsAppInboundTextBody("CHECKIN");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: true,
      inboundTextCount: 1,
      ok: true,
      reason: "whatsapp-consent-required",
      routedTextCount: 0,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it.each([
    ["non-object versions", []],
    ["extra malformed entry", {
      "consumer-health-data-notice": "2026-04-29",
      "privacy-policy": "2026-06-24",
      "terms-of-service": "2026-04-29",
      extra: 123,
    }],
  ])("requires WhatsApp consent when stored consent document versions have %s", async (
    _label,
    consentDocumentVersionsJson,
  ) => {
    const prisma = createWhatsAppPrismaHarness({
      consentDocumentVersionsJson,
      consentGranted: true,
      memberId: "member_whatsapp_123",
    });
    const rawBody = buildWhatsAppInboundTextBody("CHECKIN");

    await expect(handleHostedOnboardingWhatsAppWebhook({
      prisma,
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).resolves.toEqual({
      commandHandledCount: 0,
      ignored: true,
      inboundTextCount: 1,
      ok: true,
      reason: "whatsapp-consent-required",
      routedTextCount: 0,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });

  it("fails closed when the WhatsApp app secret is not configured", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "");

    const rawBody = JSON.stringify({
      entry: [],
      object: "whatsapp_business_account",
    });

    await expect(handleHostedOnboardingWhatsAppWebhook({
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).rejects.toMatchObject({
      code: "WHATSAPP_WEBHOOK_APP_SECRET_NOT_CONFIGURED",
      httpStatus: 500,
    });
  });

  it("fails closed when the webhook payload is invalid JSON", async () => {
    const rawBody = "{\"entry\":";

    await expect(handleHostedOnboardingWhatsAppWebhook({
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).rejects.toMatchObject({
      code: "WHATSAPP_WEBHOOK_PAYLOAD_INVALID",
      httpStatus: 400,
    });
  });

  it("rejects invalid WhatsApp webhook signatures", async () => {
    const rawBody = JSON.stringify({
      entry: [],
      object: "whatsapp_business_account",
    });

    await expect(handleHostedOnboardingWhatsAppWebhook({
      rawBody,
      signature: "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    })).rejects.toMatchObject({
      code: "WHATSAPP_WEBHOOK_SIGNATURE_INVALID",
      httpStatus: 401,
    });
  });

  it("rejects malformed WhatsApp webhook payload shapes", async () => {
    const rawBody = JSON.stringify({
      entry: {},
      object: "whatsapp_business_account",
    });

    await expect(handleHostedOnboardingWhatsAppWebhook({
      rawBody,
      signature: signWhatsAppBody(rawBody),
    })).rejects.toMatchObject({
      code: "WHATSAPP_WEBHOOK_PAYLOAD_INVALID",
      httpStatus: 400,
    });
  });
});

function signWhatsAppBody(rawBody: string): string {
  return `sha256=${createHmac("sha256", "whatsapp-app-secret")
    .update(rawBody)
    .digest("hex")}`;
}

function buildWhatsAppInboundTextBody(text: string): string {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              messages: [
                {
                  from: "15550100001",
                  id: "wamid.test-message-1",
                  text: {
                    body: text,
                  },
                  timestamp: "1778250000",
                  type: "text",
                },
              ],
              metadata: {
                phone_number_id: "phone-number-id",
              },
            },
          },
        ],
      },
    ],
    object: "whatsapp_business_account",
  });
}

type WhatsAppPrismaHarness = {
  $transaction: <T>(callback: (tx: WhatsAppPrismaHarness) => Promise<T>) => Promise<T>;
  hostedConsentEvent: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  hostedConsentGrant: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  hostedMember: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  hostedMemberIdentity: {
    findMany: ReturnType<typeof vi.fn>;
  };
};

type HostedOnboardingWhatsAppWebhookTestInput =
  Omit<HostedOnboardingWhatsAppWebhookInput, "prisma"> & {
    prisma?: WhatsAppPrismaHarness;
  };

async function handleHostedOnboardingWhatsAppWebhook(
  input: HostedOnboardingWhatsAppWebhookTestInput,
) {
  return handleHostedOnboardingWhatsAppWebhookImpl(
    input as HostedOnboardingWhatsAppWebhookInput,
  );
}

function createWhatsAppPrismaHarness(input: {
  consentDocumentVersionsJson?: unknown;
  consentGrantUpdateManyCount?: number;
  consentGranted?: boolean;
  consentUpdatedAt?: Date;
  memberId?: string;
} = {}): WhatsAppPrismaHarness {
  const memberId = input.memberId ?? null;
  const consentGranted = input.consentGranted ?? false;
  const now = new Date("2026-05-08T14:00:00.000Z");
  const prisma = {
    async $transaction<T>(callback: (tx: WhatsAppPrismaHarness) => Promise<T>): Promise<T> {
      return callback(prisma);
    },
    hostedConsentEvent: {
      create: vi.fn(async () => ({
        id: "hbce_test_whatsapp",
      })),
      findUnique: vi.fn(async () => null),
    },
    hostedConsentGrant: {
      findUnique: vi.fn(async () => consentGranted && memberId
        ? {
            documentVersionsJson: input.consentDocumentVersionsJson ?? {
              "consumer-health-data-notice": "2026-04-29",
              "privacy-policy": "2026-06-24",
              "terms-of-service": "2026-04-29",
            },
            grantedAt: now,
            revokedAt: null,
            status: "granted",
            updatedAt: input.consentUpdatedAt ?? now,
          }
        : null),
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: input.consentGrantUpdateManyCount ?? 1 })),
    },
    hostedMember: {
      findUnique: vi.fn(async () => memberId
        ? {
            accountGroupMemberships: [],
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
            threadContainer: null,
          }
        : null),
    },
    hostedMemberIdentity: {
      findMany: vi.fn(async () => memberId
        ? [
            {
              member: {
                billingStatus: HostedBillingStatus.active,
                id: memberId,
                suspendedAt: null,
              },
            },
          ]
        : []),
    },
  } satisfies WhatsAppPrismaHarness;

  return prisma;
}
