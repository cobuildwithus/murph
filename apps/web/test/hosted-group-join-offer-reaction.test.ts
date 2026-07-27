import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({
  acceptHostedGroupDisclosurePermissionReactionTx: vi.fn(),
  acceptHostedGroupJoinOfferTx: vi.fn(),
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
  prepareHostedLinqGroupJoinApplicationClaimTx: vi.fn(),
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
  prepareHostedLinqGroupJoinApplicationClaimTx:
    mocks.prepareHostedLinqGroupJoinApplicationClaimTx,
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

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeMaintenanceRuntime: mocks.signalHostedRuntimeMaintenanceRuntime,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

import {
  handleHostedGroupJoinOfferReaction,
  prepareHostedGroupJoinOfferReactionApplicationClaimTx,
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
    mocks.acceptHostedGroupDisclosurePermissionReactionTx.mockResolvedValue({
      kind: "not_found",
    });
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValue({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
      grantedVaultShareProjectionScopes: [],
      groupId: "group_1",
      joinCode: "join_1",
      joinConfirmationSignal: {
        mailboxItemId: "mailbox_item_join_confirmation_1",
        memberId: "member_reactor",
      },
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      revokedVaultShareProjectionKinds: [],
      revokedVaultShareProjectionScopes: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      selectedVaultShareProjectionScopes: [],
    });
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_reactor", suspendedAt: null },
    });
    mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort.mockResolvedValue(
      undefined,
    );
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://murph.example");
    mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort.mockResolvedValue(undefined);
    mocks.signalHostedRuntimeMaintenanceRuntime.mockResolvedValue(undefined);
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mockResolvedValue(undefined);
    mocks.prepareHostedLinqGroupJoinApplicationClaimTx.mockResolvedValue({
      groupId: "group_1",
      groupRuntimeMemberId: "member_group_runtime",
      memberId: "member_reactor",
      membershipId: null,
      schema: "murph.hosted-linq.group-join-application-claim.v1",
      selectedShareAuthorityHash: "a".repeat(64),
    });
  });

  afterEach(() => {
    restoreKeyring?.();
    restoreKeyring = null;
  });

  it("binds the receipt claim to the resolved member before application", async () => {
    const event = parseReactionEvent({ reactionType: "love" });
    const tx = createPrismaStub();

    await expect(prepareHostedGroupJoinOfferReactionApplicationClaimTx({
      event,
      tx,
    })).resolves.toMatchObject({
      memberId: "member_reactor",
      membershipId: null,
    });

    expect(mocks.prepareHostedLinqGroupJoinApplicationClaimTx).toHaveBeenCalledWith({
      memberId: "member_reactor",
      messageLookupKeyReadCandidates: createHostedLinqMessageLookupKeyReadCandidates(
        "msg_offer_123",
      ),
      threadIdentityLookupKeyReadCandidates:
        createHostedExternalThreadIdentityLookupKeyReadCandidates({
          channel: "linq",
          threadId: "chat_group_1",
        }),
      tx,
    });
  });

  it("does not create a retryable claim for an unsupported reaction", async () => {
    const tx = createPrismaStub();

    await expect(prepareHostedGroupJoinOfferReactionApplicationClaimTx({
      event: parseReactionEvent({ customEmoji: "😂", reactionType: "custom" }),
      tx,
    })).resolves.toBeNull();

    expect(mocks.lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
    expect(mocks.prepareHostedLinqGroupJoinApplicationClaimTx).not.toHaveBeenCalled();
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
        linqAffirmation: {
          eventId: event.eventId,
          linqChatLookupKeyReadCandidates:
            createHostedLinqChatLookupKeyReadCandidates("chat_group_1"),
          payloadHash: event.payloadHash,
        },
        memberId: "member_reactor",
        messageLookupKeyReadCandidates: expect.arrayContaining([
          expect.stringMatching(/^hbidx:linq-message:/u),
        ]),
        threadIdentityLookupKeyReadCandidates: expect.arrayContaining([
          expect.stringMatching(/^hbidx:external-thread-identity:/u),
        ]),
      }),
    );
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

  it("accepts an already-applied replay without regranting and retries confirmation", async () => {
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce({
      alreadyMember: true,
      grantedVaultShareProjectionKinds: [],
      grantedVaultShareProjectionScopes: [],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      revokedVaultShareProjectionKinds: [],
      revokedVaultShareProjectionScopes: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      selectedVaultShareProjectionScopes: [],
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "love" }),
      prisma,
    })).resolves.toEqual({ reason: "accepted", status: "accepted" });

    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_reactor",
      membershipId: "membership_1",
      prisma,
      timeoutMs: expect.any(Number),
    });
    expect(mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .not.toHaveBeenCalled();
  });

  it("runs no post-commit effects for a superseded event or missing applied membership", async () => {
    // Both terminal supersession and an applied replay after leave return this
    // no-mutation result shape from the durable provider-event owner.
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: [],
      grantedVaultShareProjectionScopes: [],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: null,
      revokedVaultShareProjectionKinds: [],
      revokedVaultShareProjectionScopes: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      selectedVaultShareProjectionScopes: [],
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "love" }),
      prisma,
    })).resolves.toEqual({ reason: "accepted", status: "accepted" });

    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort)
      .not.toHaveBeenCalled();
    expect(mocks.signalHostedGroupJoinConfirmationRuntimeBestEffort).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort)
      .not.toHaveBeenCalled();
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

  it("does not turn a nonmember's disclosure Like into a join", async () => {
    mocks.acceptHostedGroupDisclosurePermissionReactionTx.mockResolvedValueOnce({
      kind: "not_group_member",
    });
    const prisma = createPrismaStub();

    await expect(handleHostedGroupJoinOfferReaction({
      event: parseReactionEvent({ reactionType: "like" }),
      prisma,
    })).resolves.toEqual({ status: "ignored", reason: "not_a_member" });

    expect(mocks.acceptHostedGroupJoinOfferTx).not.toHaveBeenCalled();
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
      grantedVaultShareProjectionScopes: [],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      revokedVaultShareProjectionKinds: [],
      revokedVaultShareProjectionScopes: [],
      selectedVaultShareProjectionKinds: ["group-email.v0"],
      selectedVaultShareProjectionScopes: [],
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
    const storedChatLookupKey = createHostedLinqChatLookupKey("chat_group_1");
    const storedMessageLookupKey = createHostedLinqMessageLookupKey("msg_offer_123");
    const storedThreadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: "chat_group_1",
    });
    if (
      !storedChatLookupKey
      || !storedMessageLookupKey
      || !storedThreadIdentityLookupKey
    ) {
      throw new Error("Expected prior-version lookup keys.");
    }
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
    clearHostedOnboardingEnvCache();
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce({
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
      grantedVaultShareProjectionScopes: [],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: storedMessageLookupKey,
      membershipId: "membership_1",
      revokedVaultShareProjectionKinds: [],
      revokedVaultShareProjectionScopes: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      selectedVaultShareProjectionScopes: [],
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
        linqAffirmation: {
          eventId: event.eventId,
          linqChatLookupKeyReadCandidates: expect.arrayContaining([
            storedChatLookupKey,
            expect.stringMatching(/^hbidx:linq-chat:v2:/u),
          ]),
          payloadHash: event.payloadHash,
        },
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
        from_handle: { handle: "+15551234567", service: "iMessage" },
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
