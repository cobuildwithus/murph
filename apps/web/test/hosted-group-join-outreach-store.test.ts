import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeHostedGroupJoinOutreachReplyContextTx,
  enqueueHostedGroupJoinOutreachTx,
  isHostedGroupJoinOutreachReplyDeliveryAuthorizedTx,
  readHostedGroupJoinOutreachReplyContextTx,
  reopenHostedGroupJoinOutreachReplyContextTx,
  revokeHostedGroupJoinOutreachForRemovedReactionTx,
} from "@/src/lib/hosted-groups/group-join-outreach-store";
import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const TEST_CONTACT_PRIVACY_KEY =
  "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=";

let restoreEnvironment: (() => void) | null = null;

describe("hosted group join outreach store", () => {
  beforeEach(() => {
    restoreEnvironment = configureContactPrivacyKeyring();
  });

  afterEach(() => {
    restoreEnvironment?.();
    restoreEnvironment = null;
  });

  it("collapses duplicate reactions onto the offer-participant durable row", async () => {
    type OutreachRow = {
      groupId: string;
      id: string;
      nextAttemptAt: Date;
      offerId: string;
      participantPhoneEncrypted: string;
      participantPhoneLookupKey: string;
      requestedAt: Date;
    };
    let row: OutreachRow | null = null;
    const createMany = vi.fn(async (input: {
      data: OutreachRow[];
      skipDuplicates: boolean;
    }) => {
      if (row) {
        return { count: 0 };
      }
      row = input.data[0] ?? null;
      return { count: row ? 1 : 0 };
    });
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      hostedGroupJoinOutreach: {
        createMany,
        findFirst: vi.fn(async () => row ? { id: row.id } : null),
      },
    };
    const requestedAt = new Date("2026-07-24T16:00:00.000Z");

    const first = await enqueueHostedGroupJoinOutreachTx({
      groupId: "hgrp_opaque",
      offerId: "hgrpjo_opaque",
      participantPhoneNumber: "+15551234567",
      requestedAt,
      tx: tx as never,
    });
    const second = await enqueueHostedGroupJoinOutreachTx({
      groupId: "hgrp_opaque",
      offerId: "hgrpjo_opaque",
      participantPhoneNumber: "+15551234567",
      requestedAt: new Date("2026-07-24T16:01:00.000Z"),
      tx: tx as never,
    });

    expect(first).toEqual({
      kind: "enqueued",
      outreachId: expect.stringMatching(/^hgrpjoa_/u),
    });
    expect(second).toEqual({
      kind: "already_recorded",
      outreachId: first.outreachId,
    });
    expect(createMany).toHaveBeenCalledTimes(1);
    const created = createMany.mock.calls[0]?.[0] as {
      data: OutreachRow[];
    } | undefined;
    expect(created?.data[0]?.participantPhoneEncrypted)
      .not.toContain("+15551234567");
  });

  // Reply-context selection turns "someone texted back" into "this reply belongs
  // to that group offer". It stays nonterminal until accepted delivery consumes
  // it, so a temporary no-send result can recover on a later reply.
  function createReplyContextTx(options?: {
    offers?: {
      groupId: string;
      id: string;
      group: { joinCode: string | null; runtimeMemberId: string | null };
    }[];
    outreaches?: {
      groupId: string;
      id: string;
      linqChatLookupKey: string | null;
      offerId: string;
      phoneNumberLookupKey?: string | null;
    }[];
  }) {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const outreaches = options?.outreaches ?? [
      {
        groupId: "hgrp_opaque",
        id: "hgrpjoa_opaque",
        linqChatLookupKey: requireChatLookupKey("chat_direct_opaque"),
        offerId: "hgrpjo_opaque",
        phoneNumberLookupKey: createHostedPhoneLookupKey("+15550000000"),
      },
    ];
    const offers = options?.offers ?? [
      {
        groupId: "hgrp_opaque",
        id: "hgrpjo_opaque",
        group: { joinCode: "join_opaque", runtimeMemberId: "hbm_runtime" },
      },
    ];
    const findManyOutreaches = vi.fn(async () => outreaches);
    const findManyOffers = vi.fn(async () => offers);
    return {
      tx: {
        hostedGroupJoinOffer: { findMany: findManyOffers },
        hostedGroupJoinOutreach: {
          findMany: findManyOutreaches,
          updateMany,
        },
      } as never,
      findManyOffers,
      findManyOutreaches,
      updateMany,
    };
  }

  it.each([
    {
      expected: true,
      label: "live matching context",
      offer: {
        groupId: "hgrp_opaque",
        group: {
          joinCode: "join_opaque",
          runtimeMember: { suspendedAt: null },
          runtimeMemberId: "hbm_runtime",
        },
        revokedAt: null,
      },
      outreach: {
        groupId: "hgrp_opaque",
        offerId: "hgrpjo_opaque",
        repliedAt: null,
        sentAt: new Date("2026-07-24T16:00:00.000Z"),
        skippedAt: null,
      },
    },
    {
      expected: false,
      label: "already consumed context",
      offer: {
        groupId: "hgrp_opaque",
        group: {
          joinCode: "join_opaque",
          runtimeMember: { suspendedAt: null },
          runtimeMemberId: "hbm_runtime",
        },
        revokedAt: null,
      },
      outreach: {
        groupId: "hgrp_opaque",
        offerId: "hgrpjo_opaque",
        repliedAt: new Date("2026-07-24T16:01:00.000Z"),
        sentAt: new Date("2026-07-24T16:00:00.000Z"),
        skippedAt: null,
      },
    },
    {
      expected: false,
      label: "revoked offer",
      offer: {
        groupId: "hgrp_opaque",
        group: {
          joinCode: "join_opaque",
          runtimeMember: { suspendedAt: null },
          runtimeMemberId: "hbm_runtime",
        },
        revokedAt: new Date("2026-07-24T16:01:00.000Z"),
      },
      outreach: {
        groupId: "hgrp_opaque",
        offerId: "hgrpjo_opaque",
        repliedAt: null,
        sentAt: new Date("2026-07-24T16:00:00.000Z"),
        skippedAt: null,
      },
    },
    {
      expected: false,
      label: "suspended group runtime",
      offer: {
        groupId: "hgrp_opaque",
        group: {
          joinCode: "join_opaque",
          runtimeMember: {
            suspendedAt: new Date("2026-07-24T16:01:00.000Z"),
          },
          runtimeMemberId: "hbm_runtime",
        },
        revokedAt: null,
      },
      outreach: {
        groupId: "hgrp_opaque",
        offerId: "hgrpjo_opaque",
        repliedAt: null,
        sentAt: new Date("2026-07-24T16:00:00.000Z"),
        skippedAt: null,
      },
    },
    {
      expected: false,
      label: "group without a runtime",
      offer: {
        groupId: "hgrp_opaque",
        group: {
          joinCode: "join_opaque",
          runtimeMember: null,
          runtimeMemberId: null,
        },
        revokedAt: null,
      },
      outreach: {
        groupId: "hgrp_opaque",
        offerId: "hgrpjo_opaque",
        repliedAt: null,
        sentAt: new Date("2026-07-24T16:00:00.000Z"),
        skippedAt: null,
      },
    },
  ])("authorizes reply delivery only for $label", async ({
    expected,
    offer,
    outreach,
  }) => {
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      hostedGroupJoinOffer: {
        findUnique: vi.fn(async () => offer),
      },
      hostedGroupJoinOutreach: {
        findUnique: vi.fn(async () => outreach),
      },
    };

    await expect(isHostedGroupJoinOutreachReplyDeliveryAuthorizedTx({
      groupJoinCode: "join_opaque",
      outreachId: "hgrpjoa_opaque",
      tx: tx as never,
    })).resolves.toBe(expected);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });


  // Removing the reaction is the participant's only undo at this entry point,
  // so a withdrawal that lands before dispatch must stop the private text.
  function createRevokeTx(existing?: {
    dispatchStartedAt: Date | null;
    id: string;
    sentAt: Date | null;
    skippedAt: Date | null;
  } | null) {
    const createMany = vi.fn(
      async (_input: {
        data: { participantPhoneEncrypted: string; skipReason?: string }[];
        skipDuplicates: boolean;
      }) => ({ count: 1 }),
    );
    const updateMany = vi.fn(async () => ({ count: 1 }));
    return {
      createMany,
      tx: {
        $executeRaw: vi.fn(async () => 0),
        hostedGroupJoinOutreach: {
          createMany,
          findFirst: vi.fn(async () => existing ?? null),
          updateMany,
        },
      } as never,
      updateMany,
    };
  }

  const REVOKE_INPUT = {
    allowMissingRowTombstone: true,
    groupId: "hgrp_opaque",
    now: new Date("2026-07-24T16:05:00.000Z"),
    offerId: "hgrpjo_opaque",
    participantPhoneNumber: "+15551234567",
  };

  it("terminalizes a pending outreach when the reaction is removed", async () => {
    const { tx, updateMany } = createRevokeTx({
      dispatchStartedAt: null,
      id: "hgrpjoa_opaque",
      sentAt: null,
      skippedAt: null,
    });

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...REVOKE_INPUT,
      tx,
    })).resolves.toEqual({ kind: "revoked" });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        skipReason: "reaction_removed",
        skippedAt: REVOKE_INPUT.now,
      },
      where: expect.objectContaining({ dispatchStartedAt: null }),
    }));
  });

  it("records a terminal row so a removal delivered before its add converges", async () => {
    const { createMany, tx } = createRevokeTx(null);

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...REVOKE_INPUT,
      tx,
    })).resolves.toEqual({ kind: "revoked" });

    const created = createMany.mock.calls[0]?.[0];
    expect(created?.data[0]?.skipReason).toBe("reaction_removed");
    expect(created?.data[0]?.participantPhoneEncrypted)
      .not.toContain("+15551234567");
  });

  it("does not roll back an outreach whose dispatch already started", async () => {
    const { tx, updateMany } = createRevokeTx({
      dispatchStartedAt: new Date("2026-07-24T16:01:00.000Z"),
      id: "hgrpjoa_opaque",
      sentAt: null,
      skippedAt: null,
    });

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...REVOKE_INPUT,
      tx,
    })).resolves.toEqual({ kind: "dispatch_started" });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("leaves an already terminal outreach untouched on a duplicate removal", async () => {
    const { tx, updateMany } = createRevokeTx({
      dispatchStartedAt: null,
      id: "hgrpjoa_opaque",
      sentAt: null,
      skippedAt: new Date("2026-07-24T16:02:00.000Z"),
    });

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...REVOKE_INPUT,
      tx,
    })).resolves.toEqual({ kind: "not_pending" });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not tombstone a refused region that had no outreach", async () => {
    // An unsupported recipient is declined before any durable work, so a
    // remove-before-add must not store their encrypted phone.
    const { createMany, tx } = createRevokeTx(null);

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...REVOKE_INPUT,
      allowMissingRowTombstone: false,
      tx,
    })).resolves.toEqual({ kind: "not_pending" });

    expect(createMany).not.toHaveBeenCalled();
  });

  it("still revokes an existing outreach for a refused region", async () => {
    const { tx, updateMany } = createRevokeTx({
      dispatchStartedAt: null,
      id: "hgrpjoa_opaque",
      sentAt: null,
      skippedAt: null,
    });

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...REVOKE_INPUT,
      allowMissingRowTombstone: false,
      tx,
    })).resolves.toEqual({ kind: "revoked" });

    expect(updateMany).toHaveBeenCalled();
  });

  it("reads the originating group without consuming the reply context", async () => {
    const { tx, updateMany } = createReplyContextTx();

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toEqual({
      joinCode: "join_opaque",
      outreachId: "hgrpjoa_opaque",
    });

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("reads nothing when no pending outreach matches the sender", async () => {
    const { tx, updateMany } = createReplyContextTx({ outreaches: [] });

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_unrelated",
      participantPhoneNumber: "+15559876543",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toBeNull();

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("falls back to the generic link when the offer no longer resolves", async () => {
    const { tx } = createReplyContextTx({ offers: [] });

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toBeNull();
  });

  it("does not treat a non-phone sender as a reply", async () => {
    const { tx, updateMany } = createReplyContextTx();

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantPhoneNumber: "not-a-phone",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toBeNull();

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("reads the newest outstanding offer when one direct chat has several", async () => {
    const { findManyOutreaches, tx, updateMany } = createReplyContextTx({
      outreaches: [
        {
          groupId: "hgrp_new",
          id: "hgrpjoa_new",
          linqChatLookupKey: requireChatLookupKey("chat_direct_opaque"),
          offerId: "hgrpjo_new",
        },
        {
          groupId: "hgrp_old",
          id: "hgrpjoa_old",
          linqChatLookupKey: requireChatLookupKey("chat_direct_opaque"),
          offerId: "hgrpjo_old",
        },
      ],
      offers: [
        {
          groupId: "hgrp_old",
          id: "hgrpjo_old",
          group: { joinCode: "join_old", runtimeMemberId: "hbm_old" },
        },
        {
          groupId: "hgrp_new",
          id: "hgrpjo_new",
          group: { joinCode: "join_new", runtimeMemberId: "hbm_new" },
        },
      ],
    });

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toEqual({
      joinCode: "join_new",
      outreachId: "hgrpjoa_new",
    });

    expect(findManyOutreaches).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { sentAt: "desc" },
        { requestedAt: "desc" },
        { id: "desc" },
      ],
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { linqChatLookupKey: { in: expect.any(Array) } },
        ]),
        repliedAt: null,
      }),
    }));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not let an older revoked offer shadow a newer valid offer", async () => {
    const { findManyOffers, tx, updateMany } = createReplyContextTx({
      outreaches: [
        {
          groupId: "hgrp_new",
          id: "hgrpjoa_new",
          linqChatLookupKey: requireChatLookupKey("chat_direct_opaque"),
          offerId: "hgrpjo_new",
        },
        {
          groupId: "hgrp_old",
          id: "hgrpjoa_old",
          linqChatLookupKey: requireChatLookupKey("chat_direct_opaque"),
          offerId: "hgrpjo_old",
        },
      ],
      // The store query excludes revoked offers, so only the newer valid offer
      // reaches this result set.
      offers: [
        {
          groupId: "hgrp_new",
          id: "hgrpjo_new",
          group: { joinCode: "join_new", runtimeMemberId: "hbm_new" },
        },
      ],
    });

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toEqual({
      joinCode: "join_new",
      outreachId: "hgrpjoa_new",
    });

    expect(findManyOffers).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["hgrpjo_new", "hgrpjo_old"] },
        revokedAt: null,
      }),
    }));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("falls back to the sending line when chat creation returned no id", async () => {
    const sendingLineLookupKey = createHostedPhoneLookupKey("+15550000000");
    const { findManyOutreaches, tx } = createReplyContextTx({
      outreaches: [{
        groupId: "hgrp_opaque",
        id: "hgrpjoa_opaque",
        linqChatLookupKey: null,
        offerId: "hgrpjo_opaque",
        phoneNumberLookupKey: sendingLineLookupKey,
      }],
    });

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_created_without_response_id",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toEqual({
      joinCode: "join_opaque",
      outreachId: "hgrpjoa_opaque",
    });

    expect(findManyOutreaches).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{
          linqChatLookupKey: null,
          phoneNumberLookupKey: { in: expect.any(Array) },
        }]),
      }),
    }));
  });

  it("prefers an exact chat over a newer sending-line fallback", async () => {
    const { tx } = createReplyContextTx({
      outreaches: [
        {
          groupId: "hgrp_fallback",
          id: "hgrpjoa_fallback",
          linqChatLookupKey: null,
          offerId: "hgrpjo_fallback",
          phoneNumberLookupKey: createHostedPhoneLookupKey("+15550000000"),
        },
        {
          groupId: "hgrp_exact",
          id: "hgrpjoa_exact",
          linqChatLookupKey: requireChatLookupKey("chat_direct_opaque"),
          offerId: "hgrpjo_exact",
        },
      ],
      offers: [
        {
          groupId: "hgrp_fallback",
          id: "hgrpjo_fallback",
          group: {
            joinCode: "join_fallback",
            runtimeMemberId: "hbm_fallback",
          },
        },
        {
          groupId: "hgrp_exact",
          id: "hgrpjo_exact",
          group: { joinCode: "join_exact", runtimeMemberId: "hbm_exact" },
        },
      ],
    });

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toEqual({
      joinCode: "join_exact",
      outreachId: "hgrpjoa_exact",
    });
  });

  it("consumes reply context only after a sent outreach reaches its outcome", async () => {
    const repliedAt = new Date("2026-07-24T20:00:00.000Z");
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const tx = {
      hostedGroupJoinOutreach: { updateMany },
    } as never;

    await expect(consumeHostedGroupJoinOutreachReplyContextTx({
      outreachId: "hgrpjoa_opaque",
      repliedAt,
      tx,
    })).resolves.toBe(true);
    await expect(consumeHostedGroupJoinOutreachReplyContextTx({
      outreachId: "hgrpjoa_opaque",
      repliedAt,
      tx,
    })).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith({
      data: { repliedAt },
      where: {
        id: "hgrpjoa_opaque",
        repliedAt: null,
        sentAt: { not: null },
        skippedAt: null,
      },
    });
  });

  it("reopens only the reply context consumed by the failed attempt", async () => {
    const failedAttemptRepliedAt = new Date("2026-07-24T20:00:00.000Z");
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const tx = {
      hostedGroupJoinOutreach: { updateMany },
    } as never;

    await expect(reopenHostedGroupJoinOutreachReplyContextTx({
      outreachId: "hgrpjoa_opaque",
      repliedAt: failedAttemptRepliedAt,
      tx,
    })).resolves.toBe(true);
    await expect(reopenHostedGroupJoinOutreachReplyContextTx({
      outreachId: "hgrpjoa_opaque",
      repliedAt: failedAttemptRepliedAt,
      tx,
    })).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith({
      data: { repliedAt: null },
      where: {
        id: "hgrpjoa_opaque",
        repliedAt: failedAttemptRepliedAt,
        sentAt: { not: null },
        skippedAt: null,
      },
    });
  });
});

function configureContactPrivacyKeyring(): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousVersion =
    process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;
  process.env.HOSTED_CONTACT_PRIVACY_KEYS =
    `v1:${TEST_CONTACT_PRIVACY_KEY}`;
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v1";
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnv("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnv(
      "HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION",
      previousVersion,
    );
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

function requireChatLookupKey(chatId: string): string {
  const lookupKey = createHostedLinqChatLookupKey(chatId);
  if (!lookupKey) {
    throw new Error("Expected a valid test chat lookup key.");
  }
  return lookupKey;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
