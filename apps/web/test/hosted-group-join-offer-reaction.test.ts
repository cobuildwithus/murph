import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  acceptCallCircleOfferEnrollment: vi.fn(),
  acceptHostedGroupJoinOfferTx: vi.fn(),
  appendCallCircleSetupNotificationTx: vi.fn(),
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  signalHostedAssistantNotificationsBestEffort: vi.fn(),
  materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  signalHostedGroupJoinConfirmationRuntimeBestEffort: vi.fn(),
  signalHostedRuntimeMaintenanceRuntime: vi.fn(),
}));

vi.mock("@/src/lib/call-circle/participant-store", () => ({
  acceptCallCircleOfferEnrollment: mocks.acceptCallCircleOfferEnrollment,
}));

vi.mock("@/src/lib/call-circle/notifications", () => ({
  appendCallCircleSetupNotificationTx: mocks.appendCallCircleSetupNotificationTx,
  readCallCircleNotificationSignal: (input: {
    memberId: string;
    notification: { mailboxItemId?: string | null; status: string };
  }) => input.notification.status === "sent" && input.notification.mailboxItemId
    ? { mailboxItemId: input.notification.mailboxItemId, memberId: input.memberId }
    : null,
}));

vi.mock("@/src/lib/hosted-execution/assistant-notifications", () => ({
  signalHostedAssistantNotificationsBestEffort:
    mocks.signalHostedAssistantNotificationsBestEffort,
}));

vi.mock("@/src/lib/hosted-groups/group-newsletter", () => ({
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort:
    mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  acceptHostedGroupJoinOfferTx: mocks.acceptHostedGroupJoinOfferTx,
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort:
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort,
  signalHostedGroupJoinConfirmationRuntimeBestEffort:
    mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
  signalHostedRuntimeMaintenanceRuntime: mocks.signalHostedRuntimeMaintenanceRuntime,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

import {
  handleHostedGroupJoinOfferReaction,
} from "@/src/lib/hosted-groups/join-offer-reaction";
import {
  parseHostedLinqProviderEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";

const TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
} as const;

let restoreKeyring: (() => void) | null = null;

describe("handleHostedGroupJoinOfferReaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValue({
      activation: null,
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
      groupId: "group_1",
      joinCode: "join_1",
      joinConfirmationSignal: {
        mailboxItemId: "mailbox_item_join_confirmation_1",
        memberId: "member_reactor",
      },
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      offerId: "offer_1",
      offerPostedAt: new Date("2026-03-26T12:00:00.000Z"),
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      selectedVaultShareProjectionScopes: [{ projectionKind: "sleep-times.v0" }],
      vaultShareCleanupSignals: [],
    });
    mocks.acceptCallCircleOfferEnrollment.mockResolvedValue({
      enrollmentGeneration: 1,
      id: "hccp_reactor",
    });
    mocks.appendCallCircleSetupNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_call_circle_setup_1",
      status: "sent",
    });
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_reactor", suspendedAt: null },
    });
    mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort.mockResolvedValue(
      undefined,
    );
    mocks.signalHostedAssistantNotificationsBestEffort.mockResolvedValue(undefined);
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://murph.example");
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
    mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort.mockResolvedValue(undefined);
    mocks.signalHostedRuntimeMaintenanceRuntime.mockResolvedValue(undefined);
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mockResolvedValue(undefined);
  });

  afterEach(() => {
    restoreKeyring?.();
    restoreKeyring = null;
  });

  it("accepts a live liked offer and wakes its private join confirmation", async () => {
    const event = parseReactionEvent({
      reactionType: "like",
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event,
      prisma,
    })).resolves.toEqual({
      reason: "accepted",
      status: "accepted",
    });

    expect(mocks.acceptHostedGroupJoinOfferTx).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingPendingAt: expect.any(Date),
        confirmationPublicBaseUrl: "https://murph.example",
        memberId: "member_reactor",
        messageLookupKeyReadCandidates: expect.arrayContaining([
          expect.stringMatching(/^hbidx:linq-message:/u),
        ]),
        threadIdentityLookupKeyReadCandidates: expect.arrayContaining([
          expect.stringMatching(/^hbidx:external-thread-identity:/u),
        ]),
      }),
    );
    const acceptanceInput = mocks.acceptHostedGroupJoinOfferTx.mock.calls[0]?.[0];
    expect(acceptanceInput?.bindingPendingAt.getTime())
      .toBeGreaterThan(event.providerCreatedAt.getTime());
    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      userId: "member_reactor",
    });
    expect(mocks.acceptCallCircleOfferEnrollment).not.toHaveBeenCalled();
  });

  it("enrolls the member and queues setup from a disclosed Call Circle activation", async () => {
    const offerPostedAt = new Date("2026-03-26T11:59:00.000Z");
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce({
      activation: "call-circle.enroll.v0",
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0"],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      offerId: "offer_call_circle_1",
      offerPostedAt,
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionScopes: [],
      vaultShareCleanupSignals: [],
    });
    const event = parseReactionEvent({ reactionType: "like" });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({ event, prisma }))
      .resolves.toEqual({ reason: "accepted", status: "accepted" });

    expect(mocks.acceptCallCircleOfferEnrollment).toHaveBeenCalledWith({
      groupId: "group_1",
      memberId: "member_reactor",
      now: event.providerCreatedAt,
      offerPostedAt,
      prisma: expect.any(Object),
    });
    expect(mocks.appendCallCircleSetupNotificationTx).toHaveBeenCalledWith({
      enrollmentGeneration: 1,
      groupId: "group_1",
      memberId: "member_reactor",
      now: event.providerCreatedAt,
      participantId: "hccp_reactor",
      tx: expect.any(Object),
    });
    expect(mocks.signalHostedAssistantNotificationsBestEffort).toHaveBeenCalledWith([{
      mailboxItemId: "mailbox_call_circle_setup_1",
      memberId: "member_reactor",
    }]);
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      userId: "member_reactor",
    });
  });

  it("honors a stored activation after new offers are gated off", async () => {
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce({
      activation: "call-circle.enroll.v0",
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0"],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      offerId: "offer_call_circle_1",
      offerPostedAt: new Date("2026-03-26T11:59:00.000Z"),
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionScopes: [],
      vaultShareCleanupSignals: [],
    });

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "like" }),
      prisma: createPrismaStub(),
    })).resolves.toEqual({ reason: "accepted", status: "accepted" });

    expect(mocks.acceptCallCircleOfferEnrollment).toHaveBeenCalledOnce();
    expect(mocks.appendCallCircleSetupNotificationTx).toHaveBeenCalledOnce();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledOnce();
  });

  it("signals and materializes a private join confirmation", async () => {
    const prisma = createPrismaStub();
    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "like" }),
      prisma,
    })).resolves.toEqual({ reason: "accepted", status: "accepted" });

    expect(mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_item_join_confirmation_1",
      memberId: "member_reactor",
      prisma,
      timeoutMs: expect.any(Number),
    });
    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_reactor",
      membershipId: "membership_1",
      prisma,
      timeoutMs: expect.any(Number),
    });
  });

  it("enqueues private missing-email nudge candidates after accepting an email-sharing offer", async () => {
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "group-email.v0"],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["group-email.v0"],
      vaultShareCleanupSignals: [],
    });
    const event = parseReactionEvent({
      reactionType: "like",
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event,
      prisma,
    })).resolves.toEqual({
      reason: "accepted",
      status: "accepted",
    });

    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .toHaveBeenCalledWith({
        groupId: "group_1",
        memberId: "member_reactor",
        prisma,
      });
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      userId: "member_reactor",
    });
  });

  it("accepts the reaction when the best-effort runtime wake fails", async () => {
    mocks.signalHostedRuntimeMaintenanceRuntime.mockRejectedValueOnce(
      new Error("runtime unavailable"),
    );
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error("mailbox runtime unavailable"),
    );
    mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort.mockResolvedValueOnce(undefined);
    const event = parseReactionEvent({
      reactionType: "like",
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event,
      prisma,
    })).resolves.toEqual({
      reason: "accepted",
      status: "accepted",
    });

    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      userId: "member_reactor",
    });
    expect(mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort).toHaveBeenCalledWith({
      mailboxItemId: "mailbox_item_join_confirmation_1",
      memberId: "member_reactor",
      prisma,
      timeoutMs: expect.any(Number),
    });
  });

  it("bounds a stalled maintenance wake after confirmation recovery", async () => {
    vi.useFakeTimers();
    try {
      mocks.signalHostedRuntimeMaintenanceRuntime.mockReturnValueOnce(new Promise(() => {}));
      const prisma = createPrismaStub();
      const result = handleHostedGroupJoinOfferReaction({
        event: parseReactionEvent({ reactionType: "like" }),
        prisma,
      });
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(result).resolves.toEqual({
        reason: "accepted",
        status: "accepted",
      });
      expect(
        mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mocks.signalHostedRuntimeMaintenanceRuntime.mock.invocationCallOrder[0],
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses read candidates for rotated offer lookup", async () => {
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
    const storedMessageLookupKey = createHostedLinqMessageLookupKey("msg_offer_123");
    const storedThreadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_1",
    });
    if (!storedMessageLookupKey || !storedThreadIdentityLookupKey) {
      throw new Error("Expected prior-version lookup keys.");
    }
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
    clearHostedOnboardingEnvCache();
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: storedMessageLookupKey,
      membershipId: "membership_1",
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      vaultShareCleanupSignals: [],
    });
    const event = parseReactionEvent({
      reactionType: "like",
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event,
      prisma,
    })).resolves.toEqual({
      reason: "accepted",
      status: "accepted",
    });

    expect(mocks.acceptHostedGroupJoinOfferTx).toHaveBeenCalledWith(
      expect.objectContaining({
        messageLookupKeyReadCandidates: createHostedLinqMessageLookupKeyReadCandidates(
          "msg_offer_123",
        ),
        threadIdentityLookupKeyReadCandidates:
          createHostedExternalThreadIdentityLookupKeyReadCandidates({
            channel: "linq",
            threadId: "chat_group_1",
          }),
      }),
    );
    expect(mocks.acceptHostedGroupJoinOfferTx).toHaveBeenCalledWith(
      expect.not.objectContaining({
        messageLookupKey: expect.anything(),
        threadIdentityLookupKey: expect.anything(),
      }),
    );
  });

  it("drains cleanup runtime signals after a successful accept", async () => {
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce({
      alreadyMember: true,
      grantedVaultShareProjectionKinds: [],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      revokedVaultShareProjectionKinds: ["sleep-times.v0"],
      selectedVaultShareProjectionKinds: [],
      vaultShareCleanupSignals: [{
        mailboxItemId: "mailbox_item_cleanup_1",
        memberId: "member_group_runtime",
      }],
    });
    const event = parseReactionEvent({
      reactionType: "like",
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event,
      prisma,
    })).resolves.toEqual({
      reason: "accepted",
      status: "accepted",
    });

    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_group_runtime",
      mailboxItemId: "mailbox_item_cleanup_1",
    });
  });

  it("records unsupported reactions as skipped without accepting or replying", async () => {
    const event = parseReactionEvent({
      customEmoji: "😂",
      reactionType: "custom",
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event,
      prisma,
    })).resolves.toEqual({
      reason: "unsupported_reaction",
      status: "ignored",
    });

    expect(mocks.acceptHostedGroupJoinOfferTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("records revoked offers as a distinct skip reason", async () => {
    mocks.acceptHostedGroupJoinOfferTx.mockRejectedValue(hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_REVOKED",
      httpStatus: 410,
      message: "This group offer has been revoked.",
      retryable: false,
    }));
    const event = parseReactionEvent({
      reactionType: "like",
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event,
      prisma,
    })).resolves.toEqual({
      reason: "offer_revoked",
      status: "ignored",
    });

    expect(mocks.acceptHostedGroupJoinOfferTx).toHaveBeenCalled();
    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
  });

  it("maps an under-lock access loss to member inactive without granting", async () => {
    mocks.acceptHostedGroupJoinOfferTx.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Active access is required.",
      retryable: false,
    }));

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "like" }),
      prisma: createPrismaStub(),
    })).resolves.toEqual({
      reason: "member_inactive",
      status: "ignored",
    });

    expect(mocks.acceptCallCircleOfferEnrollment).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
  });

  it("terminates reactions when Call Circle is already full", async () => {
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce({
      activation: "call-circle.enroll.v0",
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0"],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      offerId: "offer_1",
      offerPostedAt: new Date("2026-03-26T12:00:00.000Z"),
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionScopes: [],
      vaultShareCleanupSignals: [],
    });
    mocks.acceptCallCircleOfferEnrollment.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CALL_CIRCLE_PARTICIPANT_LIMIT_REACHED",
      httpStatus: 409,
      message: "Call Circle is full.",
      retryable: false,
    }));

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "like" }),
      prisma: createPrismaStub(),
    })).resolves.toEqual({
      reason: "call_circle_full",
      status: "ignored",
    });

    expect(mocks.appendCallCircleSetupNotificationTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
  });

  it("propagates a retryable pending-binding outcome", async () => {
    const pendingError = hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_BINDING_PENDING",
      httpStatus: 503,
      message: "Offer binding pending.",
      retryable: true,
    });
    mocks.acceptHostedGroupJoinOfferTx.mockRejectedValueOnce(pendingError);

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "like" }),
      prisma: createPrismaStub(),
    })).rejects.toBe(pendingError);

    expect(mocks.acceptCallCircleOfferEnrollment).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
  });
});

function parseReactionEvent(input: {
  customEmoji?: string | null;
  reactionType: string;
}) {
  const parsed = parseHostedLinqProviderEvent({
    event: {
      api_version: "v3",
      created_at: "2026-03-26T12:00:00.000Z",
      data: {
        chat_id: "chat_group_1",
        custom_emoji: input.customEmoji ?? undefined,
        from_handle: { handle: "+15551234567", service: "iMessage" },
        line: { phone_number: "+15550000000" },
        message_id: "msg_offer_123",
        reacted_at: "2026-03-26T12:01:00.000Z",
        reaction_type: input.reactionType,
      },
      event_id: "evt_reaction_123",
      event_type: "reaction.added",
      trace_id: "trace_1234567890",
      webhook_version: "2026-02-03",
    } as HostedLinqWebhookEvent,
  });
  if (!parsed) {
    throw new Error("Expected reaction provider event to parse.");
  }
  return parsed;
}

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousCurrentVersion);
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function createPrismaStub(): PrismaClient {
  const prisma = createPrismaClient({
    databaseUrl: "postgresql://test:test@127.0.0.1:1/test",
  });
  Object.defineProperty(prisma, "$transaction", {
    configurable: true,
    value: vi.fn(async <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) =>
      run({} as Prisma.TransactionClient)),
  });
  return prisma;
}
