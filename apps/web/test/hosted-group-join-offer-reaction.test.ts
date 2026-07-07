import { createHash } from "node:crypto";

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
  drainHostedLinqSideEffectsDirect: vi.fn(),
  lookupHostedMemberIdentityByPhoneNumber: vi.fn(),
  markHostedLinqDeliverySkippedTx: vi.fn(),
  readActiveHostedMemberAccess: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  acceptHostedGroupJoinOfferTx: mocks.acceptHostedGroupJoinOfferTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-identity-store", () => ({
  lookupHostedMemberIdentityByPhoneNumber: mocks.lookupHostedMemberIdentityByPhoneNumber,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-delivery-store", () => ({
  markHostedLinqDeliverySkippedTx: mocks.markHostedLinqDeliverySkippedTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-transport", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/webhook-transport")
  >("@/src/lib/hosted-onboarding/webhook-transport");
  return {
    ...actual,
    drainHostedLinqSideEffectsDirect: mocks.drainHostedLinqSideEffectsDirect,
  };
});

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

import {
  buildHostedGroupJoinOfferAcceptedReply,
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
      alreadyMember: false,
      grantedVaultShareProjectionKinds: ["profile-name.v0", "sleep-times.v0"],
      groupId: "group_1",
      joinCode: "join_1",
      messageLookupKey: "hbidx:linq-message:v1:offer",
      membershipId: "membership_1",
      revokedVaultShareProjectionKinds: [],
      selectedVaultShareProjectionKinds: ["sleep-times.v0"],
      vaultShareCleanupSignals: [],
    });
    mocks.drainHostedLinqSideEffectsDirect.mockResolvedValue(undefined);
    mocks.lookupHostedMemberIdentityByPhoneNumber.mockResolvedValue({
      core: { id: "member_reactor", suspendedAt: null },
    });
    mocks.markHostedLinqDeliverySkippedTx.mockResolvedValue({ id: "hld_skip" });
    mocks.readActiveHostedMemberAccess.mockResolvedValue(true);
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://www.withmurph.ai");
  });

  afterEach(() => {
    restoreKeyring?.();
    restoreKeyring = null;
  });

  it("accepts a live liked offer and dispatches the deterministic confirmation", async () => {
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
    expect(mocks.drainHostedLinqSideEffectsDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        currentInboundReply: {
          chatId: "chat_group_1",
          messageId: "msg_offer_123",
        },
        sideEffects: [
          expect.objectContaining({
            payload: expect.objectContaining({
              message: "Added you to this Murph group. Sharing your Murph profile name and recent sleep timing with this group. Manage what you share anytime: https://www.withmurph.ai/groups/join/join_1",
              replyToMessageId: "msg_offer_123",
              template: "group_join_offer_accepted",
            }),
          }),
        ],
      }),
    );
    expect(mocks.markHostedLinqDeliverySkippedTx).not.toHaveBeenCalled();
  });

  it("uses read candidates for rotated offer lookup and keys confirmation to the stored offer row", async () => {
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
    const sideEffect = mocks.drainHostedLinqSideEffectsDirect.mock.calls[0]?.[0]
      ?.sideEffects?.[0];
    expect(sideEffect?.effectId).toBe(
      buildExpectedGroupJoinOfferAcceptedEffectId({
        memberId: "member_reactor",
        offerMessageLookupKey: storedMessageLookupKey,
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
    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliverySkippedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "HOSTED_GROUP_JOIN_OFFER_REACTION_SKIPPED",
        reason: "unsupported_reaction",
        template: "group_join_offer_accepted",
      }),
    );
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

    expect(mocks.drainHostedLinqSideEffectsDirect).not.toHaveBeenCalled();
    expect(mocks.markHostedLinqDeliverySkippedTx).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "offer_revoked",
        template: "group_join_offer_accepted",
      }),
    );
  });

  it("keeps confirmation copy deterministic and free of em dashes", () => {
    const message = buildHostedGroupJoinOfferAcceptedReply({
      joinUrl: "https://www.withmurph.ai/groups/join/join_1",
      projectionKinds: ["sleep-times.v0"],
    });

    expect(message).toBe(
      "Added you to this Murph group. Sharing your Murph profile name and recent sleep timing with this group. Manage what you share anytime: https://www.withmurph.ai/groups/join/join_1",
    );
    expect(message).not.toContain("—");
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

function buildExpectedGroupJoinOfferAcceptedEffectId(input: {
  memberId: string;
  offerMessageLookupKey: string;
}): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({
      memberId: input.memberId,
      offerMessageLookupKey: input.offerMessageLookupKey,
    }))
    .digest("hex")
    .slice(0, 32);
  return `linq-group-join-offer-accepted:${hash}`;
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
