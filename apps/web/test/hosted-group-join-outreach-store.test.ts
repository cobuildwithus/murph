import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enqueueHostedGroupJoinOutreachTx,
  readHostedGroupJoinOutreachReplyContextTx,
  readHostedGroupJoinOutreachReplyDeliveryContextTx,
  revokeHostedGroupJoinOutreachForRemovedReactionTx,
} from "@/src/lib/hosted-groups/group-join-outreach-store";
import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const TEST_CONTACT_PRIVACY_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

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
      offerId: "hgrpjo_opaque",
      participantPhoneNumber: "+15551234567",
      requestedAt,
      tx: tx as never,
    });
    const second = await enqueueHostedGroupJoinOutreachTx({
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

  function createRevokeTx(existing?: {
    deliveries: { skippedAt: Date | null }[];
    id: string;
  } | null) {
    const outreachCreateMany = vi.fn(
      async (_input: {
        data: { participantPhoneEncrypted: string }[];
        skipDuplicates: boolean;
      }) => ({ count: 1 }),
    );
    const deliveryCreate = vi.fn(async () => ({ id: "hld_reaction_removed" }));
    return {
      deliveryCreate,
      outreachCreateMany,
      tx: {
        $executeRaw: vi.fn(async () => 0),
        hostedGroupJoinOutreach: {
          createMany: outreachCreateMany,
          findFirst: vi.fn(async () => existing ?? null),
        },
        hostedLinqDelivery: {
          create: deliveryCreate,
          findUnique: vi.fn(async () => null),
        },
      } as never,
    };
  }

  const revokeInput = {
    allowMissingRowTombstone: true,
    now: new Date("2026-07-24T16:05:00.000Z"),
    offerId: "hgrpjo_opaque",
    participantPhoneNumber: "+15551234567",
  };

  it("records reaction removal as a skipped delivery for a pending outreach", async () => {
    const { deliveryCreate, tx } = createRevokeTx({
      deliveries: [],
      id: "hgrpjoa_opaque",
    });

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...revokeInput,
      tx,
    })).resolves.toEqual({ kind: "revoked" });

    expect(deliveryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        groupJoinOutreachId: "hgrpjoa_opaque",
        skipReason: "reaction_removed",
        skippedAt: revokeInput.now,
        source: "hosted_group_join_outreach",
        template: "group_join_outreach",
      }),
      select: { id: true },
    }));
  });

  it("records a tombstone row when a removal arrives before its add", async () => {
    const { deliveryCreate, outreachCreateMany, tx } = createRevokeTx(null);

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...revokeInput,
      tx,
    })).resolves.toEqual({ kind: "revoked" });

    const created = outreachCreateMany.mock.calls[0]?.[0];
    expect(created?.data[0]?.participantPhoneEncrypted)
      .not.toContain("+15551234567");
    expect(deliveryCreate).toHaveBeenCalled();
  });

  it("does not roll back an outreach whose dispatch already started", async () => {
    const { deliveryCreate, tx } = createRevokeTx({
      deliveries: [{ skippedAt: null }],
      id: "hgrpjoa_opaque",
    });

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...revokeInput,
      tx,
    })).resolves.toEqual({ kind: "dispatch_started" });

    expect(deliveryCreate).not.toHaveBeenCalled();
  });

  it("leaves an already terminal outreach untouched on duplicate removal", async () => {
    const { deliveryCreate, tx } = createRevokeTx({
      deliveries: [{ skippedAt: new Date("2026-07-24T16:02:00.000Z") }],
      id: "hgrpjoa_opaque",
    });

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...revokeInput,
      tx,
    })).resolves.toEqual({ kind: "not_pending" });

    expect(deliveryCreate).not.toHaveBeenCalled();
  });

  it("does not tombstone a refused region that had no outreach", async () => {
    const { outreachCreateMany, tx } = createRevokeTx(null);

    await expect(revokeHostedGroupJoinOutreachForRemovedReactionTx({
      ...revokeInput,
      allowMissingRowTombstone: false,
      tx,
    })).resolves.toEqual({ kind: "not_pending" });

    expect(outreachCreateMany).not.toHaveBeenCalled();
  });

  function createReplyDelivery(input?: {
    joinCode?: string | null;
    linqChatLookupKey?: string | null;
    outreachId?: string;
    phoneNumberLookupKey?: string | null;
    revokedAt?: Date | null;
    runtimeSuspendedAt?: Date | null;
  }) {
    return {
      groupJoinOutreach: {
        id: input?.outreachId ?? "hgrpjoa_opaque",
        offer: {
          group: {
            id: "hgrp_opaque",
            joinCode: input?.joinCode ?? "join_opaque",
            runtimeMember: {
              suspendedAt: input?.runtimeSuspendedAt ?? null,
            },
            runtimeMemberId: "hbm_runtime",
          },
          revokedAt: input?.revokedAt ?? null,
        },
      },
      groupJoinOutreachId: input?.outreachId ?? "hgrpjoa_opaque",
      id: `hld_${input?.outreachId ?? "opaque"}`,
      linqChatLookupKey: input && "linqChatLookupKey" in input
        ? input.linqChatLookupKey
        : requireChatLookupKey("chat_direct_opaque"),
      phoneNumberLookupKey: input && "phoneNumberLookupKey" in input
        ? input.phoneNumberLookupKey
        : createHostedPhoneLookupKey("+15550000000"),
    };
  }

  function createReplyContextTx(input?: {
    deliveries?: ReturnType<typeof createReplyDelivery>[];
    existingMembership?: { id: string } | null;
    liveSignupDelivery?: { id: string } | null;
  }) {
    const findMany = vi.fn(async () =>
      input?.deliveries ?? [createReplyDelivery()]);
    const findFirst = vi.fn(async () => input?.liveSignupDelivery ?? null);
    const findMembership = vi.fn(
      async () => input?.existingMembership ?? null,
    );
    return {
      findFirst,
      findMany,
      findMembership,
      tx: {
        hostedGroupMember: {
          findUnique: findMembership,
        },
        hostedLinqDelivery: {
          findFirst,
          findMany,
        },
      } as never,
    };
  }

  it("reads the originating group from an accepted outreach delivery", async () => {
    const { findMany, tx } = createReplyContextTx();

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toEqual({
      joinCode: "join_opaque",
      outreachId: "hgrpjoa_opaque",
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        groupJoinOutreachId: { not: null },
        source: "hosted_group_join_outreach",
        template: "group_join_outreach",
      }),
    }));
  });

  it("drops the group context when the resolved member already joined on the web", async () => {
    const { findMembership, tx } = createReplyContextTx({
      existingMembership: { id: "hgrpm_opaque" },
    });

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantMemberId: "hbm_participant",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toBeNull();

    expect(findMembership).toHaveBeenCalledWith({
      where: {
        groupId_memberId: {
          groupId: "hgrp_opaque",
          memberId: "hbm_participant",
        },
      },
      select: { id: true },
    });
  });

  it("keeps reply context unavailable while a group-aware signup delivery is live", async () => {
    const { tx } = createReplyContextTx({
      liveSignupDelivery: { id: "hld_live_signup" },
    });

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      tx,
    })).resolves.toBeNull();
  });

  it("keeps reply context available for the exact inbound retry", async () => {
    const { findFirst, tx } = createReplyContextTx();
    findFirst.mockResolvedValueOnce(null);

    await expect(readHostedGroupJoinOutreachReplyContextTx({
      linqChatId: "chat_direct_opaque",
      participantPhoneNumber: "+15551234567",
      recipientPhoneNumber: "+15550000000",
      sourceEventId: "event-exact-retry",
      tx,
    })).resolves.toEqual({
      joinCode: "join_opaque",
      outreachId: "hgrpjoa_opaque",
    });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        NOT: {
          sourceRef: {
            contains: expect.stringMatching(/^:e[0-9a-f]{32}$/),
          },
        },
      }),
    }));
  });

  it("prefers an exact chat over a newer sending-line fallback", async () => {
    const { tx } = createReplyContextTx({
      deliveries: [
        createReplyDelivery({
          joinCode: "join_fallback",
          linqChatLookupKey: null,
          outreachId: "hgrpjoa_fallback",
        }),
        createReplyDelivery({
          joinCode: "join_exact",
          linqChatLookupKey: requireChatLookupKey("chat_direct_opaque"),
          outreachId: "hgrpjoa_exact",
        }),
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

  it.each([
    {
      expected: true,
      label: "available delivery context",
      liveSignupDelivery: null,
      outreach: {
        offer: {
          group: {
            id: "hgrp_opaque",
            joinCode: "join_opaque",
            runtimeMember: { suspendedAt: null },
            runtimeMemberId: "hbm_runtime",
          },
          revokedAt: null,
        },
      },
    },
    {
      expected: false,
      label: "live signup delivery",
      liveSignupDelivery: { id: "hld_live_signup" },
      outreach: {
        offer: {
          group: {
            id: "hgrp_opaque",
            joinCode: "join_opaque",
            runtimeMember: { suspendedAt: null },
            runtimeMemberId: "hbm_runtime",
          },
          revokedAt: null,
        },
      },
    },
    {
      expected: false,
      label: "revoked offer",
      liveSignupDelivery: null,
      outreach: {
        offer: {
          group: {
            id: "hgrp_opaque",
            joinCode: "join_opaque",
            runtimeMember: { suspendedAt: null },
            runtimeMemberId: "hbm_runtime",
          },
          revokedAt: new Date("2026-07-24T16:01:00.000Z"),
        },
      },
    },
    {
      expected: false,
      label: "suspended group runtime",
      liveSignupDelivery: null,
      outreach: {
        offer: {
          group: {
            id: "hgrp_opaque",
            joinCode: "join_opaque",
            runtimeMember: {
              suspendedAt: new Date("2026-07-24T16:01:00.000Z"),
            },
            runtimeMemberId: "hbm_runtime",
          },
          revokedAt: null,
        },
      },
    },
  ])("returns reply delivery context only for $label", async ({
    expected,
    liveSignupDelivery,
    outreach,
  }) => {
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      hostedGroupJoinOutreach: {
        findFirst: vi.fn(async () => outreach),
      },
      hostedGroupMember: {
        findUnique: vi.fn(async () => null),
      },
      hostedLinqDelivery: {
        findFirst: vi.fn(async () => liveSignupDelivery),
      },
    };

    await expect(readHostedGroupJoinOutreachReplyDeliveryContextTx({
      outreachId: "hgrpjoa_opaque",
      tx: tx as never,
    })).resolves.toEqual(
      expected
        ? { joinCode: "join_opaque", kind: "available" }
        : null,
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("excludes the persisted signup delivery while reauthorizing its retry", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      hostedGroupJoinOutreach: {
        findFirst: vi.fn(async () => ({
          offer: {
            group: {
              id: "hgrp_opaque",
              joinCode: "join_opaque",
              runtimeMember: { suspendedAt: null },
              runtimeMemberId: "hbm_runtime",
            },
            revokedAt: null,
          },
        })),
      },
      hostedGroupMember: {
        findUnique: vi.fn(async () => null),
      },
      hostedLinqDelivery: { findFirst },
    };

    await expect(readHostedGroupJoinOutreachReplyDeliveryContextTx({
      excludeSignupDeliveryId: "hld_retry",
      outreachId: "hgrpjoa_opaque",
      tx: tx as never,
    })).resolves.toEqual({
      joinCode: "join_opaque",
      kind: "available",
    });

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { not: "hld_retry" },
      }),
    }));
  });

  it("reports a web join separately from lost outreach authority", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMembership = vi.fn().mockResolvedValue({ id: "hgrpm_opaque" });
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      hostedGroupJoinOutreach: {
        findFirst: vi.fn(async () => ({
          offer: {
            group: {
              id: "hgrp_opaque",
              joinCode: "join_opaque",
              runtimeMember: { suspendedAt: null },
              runtimeMemberId: "hbm_runtime",
            },
            revokedAt: null,
          },
        })),
      },
      hostedGroupMember: {
        findUnique: findMembership,
      },
      hostedLinqDelivery: { findFirst },
    };

    await expect(readHostedGroupJoinOutreachReplyDeliveryContextTx({
      memberId: "hbm_participant",
      outreachId: "hgrpjoa_opaque",
      tx: tx as never,
    })).resolves.toEqual({
      joinCode: "join_opaque",
      kind: "already_member",
    });

    expect(findMembership).toHaveBeenCalledWith({
      where: {
        groupId_memberId: {
          groupId: "hgrp_opaque",
          memberId: "hbm_participant",
        },
      },
      select: { id: true },
    });
    expect(findFirst).not.toHaveBeenCalled();
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
