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
  acceptHostedGroupDisclosurePermissionReactionTx: vi.fn(),
  acceptHostedGroupJoinOfferTx: vi.fn(),
  enqueueHostedGroupJoinOutreachTx: vi.fn(),
  revokeHostedGroupJoinOutreachForRemovedReactionTx: vi.fn(),
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  markHostedLinqGroupJoinOfferHandledTx: vi.fn(),
  readHostedGroupJoinOfferTargetTx: vi.fn(),
  materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
  signalHostedGroupJoinConfirmationRuntimeBestEffort: vi.fn(),
  signalHostedRuntimeMaintenanceRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-newsletter", () => ({
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort:
    mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  acceptHostedGroupJoinOfferTx: mocks.acceptHostedGroupJoinOfferTx,
  readHostedGroupJoinOfferTargetTx: mocks.readHostedGroupJoinOfferTargetTx,
}));

vi.mock("@/src/lib/hosted-groups/group-join-outreach-store", () => ({
  enqueueHostedGroupJoinOutreachTx: mocks.enqueueHostedGroupJoinOutreachTx,
  revokeHostedGroupJoinOutreachForRemovedReactionTx:
    mocks.revokeHostedGroupJoinOutreachForRemovedReactionTx,
}));

vi.mock("@/src/lib/hosted-groups/group-disclosure-store", () => ({
  acceptHostedGroupDisclosurePermissionReactionTx:
    mocks.acceptHostedGroupDisclosurePermissionReactionTx,
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

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress:
    mocks.lookupHostedMemberByVerifiedEmailAddress,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-provider-event-store", () => ({
  markHostedLinqGroupJoinOfferHandledTx:
    mocks.markHostedLinqGroupJoinOfferHandledTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
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
    mocks.revokeHostedGroupJoinOutreachForRemovedReactionTx.mockResolvedValue({
      kind: "not_pending",
    });
    mocks.acceptHostedGroupDisclosurePermissionReactionTx.mockResolvedValue({
      kind: "not_found",
    });
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValue({
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
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
    });
    mocks.enqueueHostedGroupJoinOutreachTx.mockResolvedValue({
      kind: "enqueued",
      outreachId: "hgrpjoa_opaque",
    });
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_reactor", suspendedAt: null },
    });
    mocks.readHostedGroupJoinOfferTargetTx.mockResolvedValue({
      displayName: "Training circle",
      groupId: "hgrp_opaque",
      joinCode: "join_opaque",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      offerId: "hgrpjo_opaque",
      projectionKindsJson: [],
      runtimeMemberId: "hbm_runtime",
    });
    mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort.mockResolvedValue(
      undefined,
    );
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://murph.example");
    mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort.mockResolvedValue(undefined);
    mocks.signalHostedRuntimeMaintenanceRuntime.mockResolvedValue(undefined);
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mockResolvedValue(undefined);
    mocks.markHostedLinqGroupJoinOfferHandledTx.mockResolvedValue(undefined);
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
    expect(mocks.markHostedLinqGroupJoinOfferHandledTx).toHaveBeenCalledWith({
      eventId: "evt_reaction_123",
      handledAt: new Date("2026-03-26T12:01:00.000Z"),
      prisma: expect.anything(),
    });
    expect(mocks.acceptHostedGroupDisclosurePermissionReactionTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_reactor",
        messageLookupKeyReadCandidates: expect.arrayContaining([
          expect.stringMatching(/^hbidx:linq-message:/u),
        ]),
        threadIdentityLookupKeyReadCandidates: expect.arrayContaining([
          expect.stringMatching(/^hbidx:external-thread-identity:/u),
        ]),
      }),
    );
    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledTimes(1);
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
    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_reactor",
      membershipId: "membership_1",
      prisma,
      timeoutMs: expect.any(Number),
    });
  });

  it("grants only the exact permission bound to an exact Like and existing membership", async () => {
    mocks.acceptHostedGroupDisclosurePermissionReactionTx.mockResolvedValueOnce({
      kind: "accepted",
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "like" }),
      prisma,
    })).resolves.toEqual({
      reason: "accepted",
      status: "accepted",
    });

    expect(mocks.acceptHostedGroupJoinOfferTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort)
      .not.toHaveBeenCalled();
  });

  it("keeps non-Like reactions on the legacy join path", async () => {
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "love" }),
      prisma,
    })).resolves.toEqual({ reason: "accepted", status: "accepted" });

    expect(mocks.acceptHostedGroupDisclosurePermissionReactionTx).not.toHaveBeenCalled();
    expect(mocks.acceptHostedGroupJoinOfferTx).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["case-folded Like", { reactionType: "Like" }],
    ["uppercase Like", { reactionType: "LIKE" }],
    ["Like with a custom emoji", { customEmoji: "👍", reactionType: "like" }],
  ])("does not treat %s as exact disclosure consent", async (_label, reaction) => {
    const prisma = createPrismaStub();

    await handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent(reaction),
      prisma,
    });

    expect(mocks.acceptHostedGroupDisclosurePermissionReactionTx).not.toHaveBeenCalled();
  });

  it("emits recipient_region_unsupported for a refused-region canonical removal", async () => {
    // The producer half of the ownership exception: the webhook can only consume
    // this decision if the handler actually emits it, so assert it here rather
    // than mocking the handler at the consumer.
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValueOnce(null);
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({
        eventType: "reaction.removed",
        handle: "+353871234567",
        reactionType: "like",
      }),
      prisma,
    })).resolves.toEqual({
      reason: "recipient_region_unsupported",
      status: "ignored",
    });

    // Nothing durable is written for a participant this feature declines.
    expect(mocks.enqueueHostedGroupJoinOutreachTx).not.toHaveBeenCalled();
  });

  it("keeps a supported-region removal on its ordinary reaction_removed path", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValueOnce(null);
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({
        eventType: "reaction.removed",
        reactionType: "like",
      }),
      prisma,
    })).resolves.toEqual({ reason: "reaction_removed", status: "ignored" });
  });

  it("does not treat a removed Like as disclosure consent or a legacy join", async () => {
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({
        eventType: "reaction.removed",
        reactionType: "like",
      }),
      prisma,
    })).resolves.toEqual({ reason: "reaction_removed", status: "ignored" });

    expect(mocks.acceptHostedGroupDisclosurePermissionReactionTx).not.toHaveBeenCalled();
    expect(mocks.acceptHostedGroupJoinOfferTx).not.toHaveBeenCalled();
  });

  it("durably enqueues first outreach for a nonmember phone reaction", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValueOnce(null);
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "like" }),
      prisma,
    })).resolves.toEqual({
      status: "accepted",
      reason: "outreach_enqueued",
    });

    expect(mocks.readHostedGroupJoinOfferTargetTx).toHaveBeenCalledWith(
      expect.objectContaining({
        messageLookupKeyReadCandidates: expect.arrayContaining([
          expect.stringMatching(/^hbidx:linq-message:/u),
        ]),
      }),
    );
    expect(mocks.enqueueHostedGroupJoinOutreachTx).toHaveBeenCalledWith({
      offerId: "hgrpjo_opaque",
      participantPhoneNumber: "+15551234567",
      // Reaction events carry `reacted_at` as providerCreatedAt, matching the
      // existing join path's `now`.
      requestedAt: new Date("2026-03-26T12:01:00.000Z"),
      tx: expect.anything(),
    });
    expect(mocks.markHostedLinqGroupJoinOfferHandledTx).toHaveBeenCalledWith({
      eventId: "evt_reaction_123",
      handledAt: new Date("2026-03-26T12:01:00.000Z"),
      prisma: expect.anything(),
    });
    expect(mocks.acceptHostedGroupDisclosurePermissionReactionTx).not.toHaveBeenCalled();
    expect(mocks.acceptHostedGroupJoinOfferTx).not.toHaveBeenCalled();
  });

  it("records a non-phone pre-member handle instead of silently dropping it", async () => {
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({
        handle: "usr_pre@example.test",
        reactionType: "like",
      }),
      prisma,
    })).resolves.toEqual({
      status: "ignored",
      reason: "non_phone_handle",
    });

    expect(mocks.lookupHostedMemberByVerifiedEmailAddress).toHaveBeenCalled();
    expect(mocks.enqueueHostedGroupJoinOutreachTx).not.toHaveBeenCalled();
  });

  it("records a revoked pre-member offer before enqueue", async () => {
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValueOnce(null);
    mocks.readHostedGroupJoinOfferTargetTx.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_GROUP_JOIN_OFFER_REVOKED",
        httpStatus: 410,
        message: "This group offer has been revoked.",
        retryable: false,
      }),
    );
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "like" }),
      prisma,
    })).resolves.toEqual({ status: "ignored", reason: "offer_revoked" });

    expect(mocks.enqueueHostedGroupJoinOutreachTx).not.toHaveBeenCalled();
  });

  it("does not treat a reaction from the hosted line as member consent", async () => {
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ isFromMe: true, reactionType: "like" }),
      prisma,
    })).resolves.toEqual({ status: "ignored", reason: "unsupported_reaction" });

    expect(mocks.acceptHostedGroupDisclosurePermissionReactionTx).not.toHaveBeenCalled();
    expect(mocks.acceptHostedGroupJoinOfferTx).not.toHaveBeenCalled();
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
});

function parseReactionEvent(input: {
  customEmoji?: string | null;
  eventType?: "reaction.added" | "reaction.removed";
  handle?: string;
  isFromMe?: boolean;
  reactionType: string;
}) {
  const parsed = parseHostedLinqProviderEvent({
    event: {
      api_version: "v3",
      created_at: "2026-03-26T12:00:00.000Z",
      data: {
        chat_id: "chat_group_1",
        custom_emoji: input.customEmoji ?? undefined,
        from_handle: {
          handle: input.handle ?? "+15551234567",
          service: "iMessage",
        },
        is_from_me: input.isFromMe,
        line: { phone_number: "+15550000000" },
        message_id: "msg_offer_123",
        reacted_at: "2026-03-26T12:01:00.000Z",
        reaction_type: input.reactionType,
      },
      event_id: "evt_reaction_123",
      event_type: input.eventType ?? "reaction.added",
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
