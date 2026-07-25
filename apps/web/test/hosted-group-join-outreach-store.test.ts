import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimHostedGroupJoinOutreachReplyContextTx,
  enqueueHostedGroupJoinOutreachTx,
  revokeHostedGroupJoinOutreachForRemovedReactionTx,
} from "@/src/lib/hosted-groups/group-join-outreach-store";

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

  // The reply-context claim is the owner that turns "someone texted back" into
  // "this reply belongs to that group offer". Proving it here keeps the group
  // handoff from depending only on a URL builder called with a hand-fed code.
  function createReplyContextTx(options?: {
    offer?: {
      group: { joinCode: string | null; runtimeMemberId: string | null } | null;
    } | null;
    outreach?: {
      groupId: string;
      id: string;
      linqChatLookupKey: string | null;
      offerId: string;
    } | null;
  }) {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const outreach = options?.outreach === undefined
      ? {
          groupId: "hgrp_opaque",
          id: "hgrpjoa_opaque",
          linqChatLookupKey: null,
          offerId: "hgrpjo_opaque",
        }
      : options.outreach;
    const offer = options?.offer === undefined
      ? { group: { joinCode: "join_opaque", runtimeMemberId: "hbm_runtime" } }
      : options.offer;
    return {
      tx: {
        hostedGroupJoinOffer: { findFirst: vi.fn(async () => offer) },
        hostedGroupJoinOutreach: {
          findFirst: vi.fn(async () => outreach),
          updateMany,
        },
      } as never,
      updateMany,
    };
  }


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

  it("recovers the originating group and records the reply", async () => {
    const { tx, updateMany } = createReplyContextTx();
    const now = new Date("2026-07-24T20:00:00.000Z");

    await expect(claimHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      now,
      participantPhoneNumber: "+15551234567",
      tx,
    })).resolves.toEqual({ joinCode: "join_opaque" });

    // A reply is the only engagement signal a cold outreach earns, and the
    // thread it arrived on binds the row when dispatch never recorded one.
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        linqChatLookupKey: expect.any(String),
        repliedAt: now,
      }),
    }));
  });

  it("claims nothing when no pending outreach matches the sender", async () => {
    const { tx, updateMany } = createReplyContextTx({ outreach: null });

    await expect(claimHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_unrelated",
      now: new Date("2026-07-24T20:00:00.000Z"),
      participantPhoneNumber: "+15559876543",
      tx,
    })).resolves.toBeNull();

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("falls back to the generic link when the offer no longer resolves", async () => {
    const { tx } = createReplyContextTx({ offer: null });

    await expect(claimHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      now: new Date("2026-07-24T20:00:00.000Z"),
      participantPhoneNumber: "+15551234567",
      tx,
    })).resolves.toBeNull();
  });

  it("does not treat a non-phone sender as a reply", async () => {
    const { tx, updateMany } = createReplyContextTx();

    await expect(claimHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      now: new Date("2026-07-24T20:00:00.000Z"),
      participantPhoneNumber: "not-a-phone",
      tx,
    })).resolves.toBeNull();

    expect(updateMany).not.toHaveBeenCalled();
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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
