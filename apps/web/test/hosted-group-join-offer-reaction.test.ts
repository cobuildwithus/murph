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
  acceptHostedGroupJoinOfferTx: vi.fn(),
  appendCallCircleSetupNotificationTx: vi.fn(),
  canAppendCallCircleSetupNotification: vi.fn(),
  enrollCallCircleParticipant: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  readCallCircleNotificationSignal: vi.fn(),
  signalCallCircleNotificationRuntimesBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/call-circle/notifications", () => ({
  appendCallCircleSetupNotificationTx: mocks.appendCallCircleSetupNotificationTx,
  readCallCircleNotificationSignal: mocks.readCallCircleNotificationSignal,
  signalCallCircleNotificationRuntimesBestEffort:
    mocks.signalCallCircleNotificationRuntimesBestEffort,
}));

vi.mock("@/src/lib/call-circle/participant-store", () => ({
  canAppendCallCircleSetupNotification: mocks.canAppendCallCircleSetupNotification,
  enrollCallCircleParticipant: mocks.enrollCallCircleParticipant,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  acceptHostedGroupJoinOfferTx: mocks.acceptHostedGroupJoinOfferTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
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
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValue(buildAcceptedJoinOffer());
    mocks.appendCallCircleSetupNotificationTx.mockResolvedValue({
      mailboxItemId: "mailbox_call_circle_setup",
      status: "sent",
    });
    mocks.canAppendCallCircleSetupNotification.mockResolvedValue(true);
    mocks.enrollCallCircleParticipant.mockResolvedValue({
      id: "hccp_1",
    });
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_reactor", suspendedAt: null },
    });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.readCallCircleNotificationSignal.mockImplementation(({ memberId, notification }) =>
      notification.status === "sent" && notification.mailboxItemId
        ? { mailboxItemId: notification.mailboxItemId, memberId }
        : null);
    mocks.signalCallCircleNotificationRuntimesBestEffort.mockResolvedValue(undefined);
  });

  afterEach(() => {
    restoreKeyring?.();
    restoreKeyring = null;
  });

  it("accepts a live liked offer without sending a confirmation reply", async () => {
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
        memberId: "member_reactor",
        messageLookupKeyReadCandidates: expect.arrayContaining([
          expect.stringMatching(/^hbidx:linq-message:/u),
        ]),
        threadIdentityLookupKeyReadCandidates: expect.arrayContaining([
          expect.stringMatching(/^hbidx:external-thread-identity:/u),
        ]),
      }),
    );
    expect(mocks.enrollCallCircleParticipant).not.toHaveBeenCalled();
    expect(mocks.appendCallCircleSetupNotificationTx).not.toHaveBeenCalled();
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).not.toHaveBeenCalled();
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
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValueOnce(buildAcceptedJoinOffer({
      messageLookupKey: storedMessageLookupKey,
    }));
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
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).not.toHaveBeenCalled();
  });

  it("enrolls the liker when the accepted offer activates Call Circle", async () => {
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValue(buildAcceptedJoinOffer({
      featureActivations: ["call-circle.enroll.v0"],
      grantedVaultShareProjectionKinds: ["profile-name.v0"],
      selectedVaultShareProjectionKinds: [],
    }));
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

    expect(mocks.enrollCallCircleParticipant).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "group_1",
        memberId: "member_reactor",
        now: event.providerCreatedAt,
      }),
    );
    expect(mocks.canAppendCallCircleSetupNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "group_1",
        memberId: "member_reactor",
        prisma: expect.any(Object),
      }),
    );
    expect(mocks.appendCallCircleSetupNotificationTx).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "group_1",
        memberId: "member_reactor",
        now: event.providerCreatedAt,
      }),
    );
    expect(mocks.readCallCircleNotificationSignal).toHaveBeenCalledWith({
      memberId: "member_reactor",
      notification: {
        mailboxItemId: "mailbox_call_circle_setup",
        status: "sent",
      },
    });
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).toHaveBeenCalledWith([{
      mailboxItemId: "mailbox_call_circle_setup",
      memberId: "member_reactor",
    }]);
  });

  it("does not append Call Circle setup when active authority fails after enrollment", async () => {
    mocks.acceptHostedGroupJoinOfferTx.mockResolvedValue(buildAcceptedJoinOffer({
      featureActivations: ["call-circle.enroll.v0"],
      grantedVaultShareProjectionKinds: ["profile-name.v0"],
      selectedVaultShareProjectionKinds: [],
    }));
    mocks.canAppendCallCircleSetupNotification.mockResolvedValueOnce(false);
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

    expect(mocks.enrollCallCircleParticipant).toHaveBeenCalled();
    expect(mocks.canAppendCallCircleSetupNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "group_1",
        memberId: "member_reactor",
      }),
    );
    expect(mocks.appendCallCircleSetupNotificationTx).not.toHaveBeenCalled();
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).not.toHaveBeenCalled();
  });

  it("ignores unsupported reactions without accepting", async () => {
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
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).not.toHaveBeenCalled();
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
    expect(mocks.signalCallCircleNotificationRuntimesBestEffort).not.toHaveBeenCalled();
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

function buildAcceptedJoinOffer(input: {
  alreadyMember?: boolean;
  featureActivations?: string[];
  grantedVaultShareProjectionKinds?: string[];
  messageLookupKey?: string;
  selectedVaultShareProjectionKinds?: string[];
} = {}) {
  const featureActivations = input.featureActivations ?? [];
  const selectedVaultShareProjectionKinds =
    input.selectedVaultShareProjectionKinds ?? ["sleep-times.v0"];
  return {
    alreadyMember: input.alreadyMember ?? false,
    featureActivations,
    grantedVaultShareProjectionKinds:
      input.grantedVaultShareProjectionKinds ?? ["profile-name.v0", "sleep-times.v0"],
    groupId: "group_1",
    joinCode: "join_1",
    membershipId: "membership_1",
    messageLookupKey: input.messageLookupKey ?? "hbidx:linq-message:v1:offer",
    offerScope: {
      featureActivations,
      schema: "murph.hosted-group.offer-scope.v1",
      vaultShareProjectionKinds: selectedVaultShareProjectionKinds,
    },
    revokedVaultShareProjectionKinds: [],
    selectedVaultShareProjectionKinds,
    vaultShareCleanupSignals: [],
  };
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
