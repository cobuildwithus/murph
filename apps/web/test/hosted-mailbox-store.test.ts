import { Buffer } from "node:buffer";

import {
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionEnvironmentVoiceCapturedWake,
  type HostedExecutionDirectRoute,
} from "@murphai/hosted-execution";
import {
  createHostedMailboxAssistantInputId,
  readHostedConversationAssistantIdentifierSecret,
} from "@murphai/hosted-execution/assistant-identifiers";
import { serializeHostedEmailThreadTarget } from "@murphai/runtime-state";
import { describe, expect, it, vi } from "vitest";

import {
  advanceHostedMailboxConsumedSeqByLane,
  appendHostedMailboxEnvelopeTx,
  appendHostedMailboxEnvelopeWithIdentityTx,
  appendHostedMailboxEnvelopeWithSourceMessageTx,
  appendHostedEnvironmentVoiceMailboxEnvelopeTx,
  appendHostedMealPhotoMailboxEnvelopeTx,
  appendHostedMailboxItemTx,
  claimHostedMailboxConversationSubscriptionAction,
  decodeHostedMailboxStoredPayload,
  fetchHostedMailboxPayload,
  fetchHostedMailboxItemsAfterLaneCursors,
  fetchHostedRuntimeMailboxProjection,
  hasPendingHostedEnvironmentVoiceMailboxItemTx,
  hasHostedMailboxMealPhotoCaptureSince,
  hasHostedMailboxItemByKind,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  projectHostedMailboxItem,
  readHostedMailboxConsumedSeqByLane,
  readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
  readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxItemCheckpointById,
  readHostedMailboxLatestPendingConversationItem,
  readHostedMailboxLiveItemById,
  readHostedMailboxMaxSeqByLane,
  readHostedMailboxRecentLiveConversationItemIds,
  readHostedMailboxUserIdsByKind,
  readHostedMailboxWakeAfterDedupeLockTx,
  readHostedMailboxWakeByItemId,
  resolveHostedMailboxRuntimeFetchLaneCursors,
  tryMarkHostedMailboxConversationAiUsageDenied,
  type HostedMailboxItemRow,
  type HostedMailboxPayloadRow,
} from "@/src/lib/hosted-mailbox/store";
import {
  createHostedAssistantInputLookupKey,
  createHostedAssistantInputLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import { setHostedSecureBoxStringTestCodecForTests } from "../src/lib/hosted-crypto/secure-box";

const FIXED_NOW = new Date("2026-04-26T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
// Restated independently of the source constant on purpose: the mailbox
// retention window is a stated privacy policy, so widening it has to fail here
// rather than silently follow whatever the source says.
const HOSTED_MAILBOX_TEST_RETENTION_MS = 14 * DAY_MS;
const MAILBOX_REF_1_PAYLOAD_REF = "hosted-mailbox-payload:mailbox_ref_1";

function requireAssistantInputLookupKey(assistantInputId: string): string {
  const lookupKey = createHostedAssistantInputLookupKey(assistantInputId);
  if (!lookupKey) {
    throw new TypeError("Expected assistant input lookup key.");
  }
  return lookupKey;
}

function expectLiveHostedMailboxWhere(fields: Record<string, unknown>) {
  return expect.objectContaining({
    ...fields,
    createdAt: {
      gt: expect.any(Date),
    },
    OR: [
      {
        expiresAt: null,
      },
      {
        expiresAt: {
          gt: expect.any(Date),
        },
      },
    ],
  });
}

describe("readHostedMailboxLiveItemById", () => {
  it("applies the canonical explicit and retention expiry boundary", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);

    await expect(readHostedMailboxLiveItemById({
      availableAt: FIXED_NOW,
      mailboxItemId: "mailbox-live-1",
      prisma: {
        hostedMailboxItem: { findFirst },
      } as never,
    })).resolves.toBeNull();

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        createdAt: {
          gt: new Date(FIXED_NOW.getTime() - HOSTED_MAILBOX_TEST_RETENTION_MS),
        },
        id: "mailbox-live-1",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: FIXED_NOW } },
        ],
      },
    });
  });

  it("hides payload content at the exact 14-day age boundary", () => {
    const createdAt = new Date(
      FIXED_NOW.getTime() - HOSTED_MAILBOX_TEST_RETENTION_MS,
    );
    const projected = projectHostedMailboxItem(
      buildHostedMailboxItemRow({
        createdAt,
        expiresAt: null,
        payloadInlineCiphertext: "cipher_at_deadline",
        payloadRef: "hosted-mailbox-payload:mailbox_ref_1",
      }),
      { payloadAvailabilityAt: FIXED_NOW },
    );

    expect(projected.payloadInlineCiphertext).toBeNull();
    expect(projected.payloadRef).toBeNull();
  });
});

describe("hasHostedMailboxMealPhotoCaptureSince", () => {
  it("derives recent capture engagement from the accepted mailbox row", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "mailbox-meal-photo" });
    const since = new Date("2026-03-29T00:00:00.000Z");

    await expect(hasHostedMailboxMealPhotoCaptureSince({
      prisma: {
        hostedMailboxItem: { findFirst },
      } as never,
      since,
      userId: "member-meal-photo",
    })).resolves.toBe(true);

    expect(findFirst).toHaveBeenCalledWith({
      select: {
        id: true,
      },
      where: {
        createdAt: {
          gte: since,
        },
        kind: "meal-photo.captured",
        lane: "system",
        userId: "member-meal-photo",
      },
    });
  });
});

describe("readHostedMailboxRecentLiveConversationItemIds", () => {
  it("returns only the member's recent live conversation rows newest first", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "mailbox-newer" },
      { id: "mailbox-older" },
    ]);

    await expect(readHostedMailboxRecentLiveConversationItemIds({
      availableAt: FIXED_NOW,
      limit: 100,
      prisma: {
        hostedMailboxItem: { findMany },
      } as never,
      userId: "member_mailbox_1",
    })).resolves.toEqual(["mailbox-newer", "mailbox-older"]);

    expect(findMany).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "desc",
      },
      select: {
        id: true,
      },
      take: 100,
      where: {
        createdAt: {
          gt: new Date(FIXED_NOW.getTime() - HOSTED_MAILBOX_TEST_RETENTION_MS),
        },
        kind: "conversation.message",
        lane: "conversation",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: FIXED_NOW } },
        ],
        userId: "member_mailbox_1",
      },
    });
  });

  it.each([0, 101, 1.5])("rejects an invalid scan limit of %s", async (limit) => {
    const findMany = vi.fn();

    await expect(readHostedMailboxRecentLiveConversationItemIds({
      availableAt: FIXED_NOW,
      limit,
      prisma: {
        hostedMailboxItem: { findMany },
      } as never,
      userId: "member_mailbox_1",
    })).rejects.toThrow(TypeError);

    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("readHostedMailboxConversationInputAuthorityByAssistantInputIdTx", () => {
  it("projects the logical preference authority from a live conversation input", async () => {
    const occurredAt = new Date("2026-08-06T14:30:00.000Z");
    const findMany = vi.fn().mockResolvedValue([{ causalSeq: 7n, occurredAt }]);
    const prisma = {
      hostedMailboxItem: { findMany },
    } as never;
    const input = {
      assistantInputId: "ain_valid",
      memberId: "member_mailbox_1",
      prisma,
    };

    await expect(
      readHostedMailboxConversationInputAuthorityByAssistantInputIdTx(input),
    ).resolves.toEqual({
      causalSeq: "7",
      occurredAt: "2026-08-06T14:30:00.000Z",
    });
  });

  it("returns only a live canonical conversation sequence owned by the member", async () => {
    const now = new Date();
    const rows = [
      {
        assistantInputLookupKey: requireAssistantInputLookupKey("ain_valid"),
        causalSeq: 7n,
        createdAt: now,
        expiresAt: null,
        kind: "conversation.message",
        lane: "conversation",
        occurredAt: new Date("2026-08-06T14:30:00.000Z"),
        userId: "member_mailbox_1",
      },
      {
        assistantInputLookupKey: requireAssistantInputLookupKey("ain_system"),
        causalSeq: 8n,
        createdAt: now,
        expiresAt: null,
        kind: "assistant.notification.requested",
        lane: "system",
        occurredAt: new Date("2026-08-06T14:31:00.000Z"),
        userId: "member_mailbox_1",
      },
      {
        assistantInputLookupKey: requireAssistantInputLookupKey("ain_without_sequence"),
        causalSeq: null,
        createdAt: now,
        expiresAt: null,
        kind: "conversation.message",
        lane: "conversation",
        occurredAt: new Date("2026-08-06T14:32:00.000Z"),
        userId: "member_mailbox_1",
      },
      {
        assistantInputLookupKey: requireAssistantInputLookupKey("ain_expired"),
        causalSeq: 9n,
        createdAt: now,
        expiresAt: new Date(now.getTime() - 1),
        kind: "conversation.message",
        lane: "conversation",
        occurredAt: new Date("2026-08-06T14:33:00.000Z"),
        userId: "member_mailbox_1",
      },
      {
        assistantInputLookupKey: null,
        causalSeq: 10n,
        createdAt: now,
        expiresAt: null,
        kind: "conversation.message",
        lane: "conversation",
        occurredAt: new Date("2026-08-06T14:34:00.000Z"),
        userId: "member_mailbox_1",
      },
    ];
    const findMany = vi.fn(async (args: {
      select: { causalSeq: true; occurredAt: true };
      take: number;
      where: {
        assistantInputLookupKey: { in: string[] };
        causalSeq: { not: null };
        createdAt: { gt: Date };
        kind: string;
        lane: string;
        OR: [{ expiresAt: null }, { expiresAt: { gt: Date } }];
        userId: string;
      };
    }) => {
      return rows
        .filter((candidate) => (
          candidate.assistantInputLookupKey !== null
          && args.where.assistantInputLookupKey.in.includes(
            candidate.assistantInputLookupKey,
          )
          && candidate.causalSeq !== null
          && candidate.createdAt > args.where.createdAt.gt
          && candidate.kind === args.where.kind
          && candidate.lane === args.where.lane
          && candidate.userId === args.where.userId
          && (
            candidate.expiresAt === null
            || candidate.expiresAt > args.where.OR[1].expiresAt.gt
          )
        ))
        .slice(0, args.take)
        .map((row) => ({
          causalSeq: row.causalSeq,
          occurredAt: row.occurredAt,
        }));
    });
    const prisma = {
      hostedMailboxItem: { findMany },
    } as never;

    await expect(readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
      assistantInputId: "ain_valid",
      memberId: "member_mailbox_1",
      prisma,
    })).resolves.toEqual({
      causalSeq: "7",
      occurredAt: "2026-08-06T14:30:00.000Z",
    });
    await expect(readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
      assistantInputId: "ain_valid",
      memberId: "member_other",
      prisma,
    })).resolves.toBeNull();
    for (const assistantInputId of [
      "ain_unknown",
      "ain_system",
      "ain_without_sequence",
      "ain_expired",
      "ain_legacy",
    ]) {
      await expect(readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
        assistantInputId,
        memberId: "member_mailbox_1",
        prisma,
      })).resolves.toBeNull();
    }

    expect(findMany).toHaveBeenNthCalledWith(1, {
      select: {
        causalSeq: true,
        occurredAt: true,
      },
      take: 2,
      where: expectLiveHostedMailboxWhere({
        assistantInputLookupKey: {
          in: createHostedAssistantInputLookupKeyReadCandidates("ain_valid"),
        },
        causalSeq: { not: null },
        kind: "conversation.message",
        lane: "conversation",
        userId: "member_mailbox_1",
      }),
    });
  });

  it("does not query for blank authority", async () => {
    const findMany = vi.fn();
    const prisma = {
      hostedMailboxItem: { findMany },
    } as never;

    await expect(readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
      assistantInputId: "  ",
      memberId: "member_mailbox_1",
      prisma,
    })).resolves.toBeNull();
    await expect(readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
      assistantInputId: "ain_valid",
      memberId: "  ",
      prisma,
    })).resolves.toBeNull();

    expect(findMany).not.toHaveBeenCalled();
  });

  it("fails closed when more than one lookup-key version matches", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { causalSeq: 7n, occurredAt: new Date("2026-08-06T14:30:00.000Z") },
      { causalSeq: 8n, occurredAt: new Date("2026-08-06T14:31:00.000Z") },
    ]);

    await expect(readHostedMailboxConversationInputAuthorityByAssistantInputIdTx({
      assistantInputId: "ain_ambiguous",
      memberId: "member_mailbox_1",
      prisma: {
        hostedMailboxItem: { findMany },
      } as never,
    })).resolves.toBeNull();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
      }),
    );
  });
});

describe("claimHostedMailboxConversationSubscriptionAction", () => {
  it("atomically claims the live member-bound conversation input", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "mailbox_claim_1",
      subscriptionActionClaim: null,
    }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirst = vi.fn();
    const prisma = {
      hostedMailboxItem: { findFirst, findMany, updateMany },
    } as never;

    await expect(claimHostedMailboxConversationSubscriptionAction({
      action: "start_pulse_now",
      assistantInputId: "ain_valid",
      memberId: "member_mailbox_1",
      prisma,
    })).resolves.toBe("claimed");

    expect(findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        subscriptionActionClaim: true,
      },
      take: 2,
      where: expectLiveHostedMailboxWhere({
        assistantInputLookupKey: {
          in: createHostedAssistantInputLookupKeyReadCandidates("ain_valid"),
        },
        causalSeq: { not: null },
        kind: "conversation.message",
        lane: "conversation",
        userId: "member_mailbox_1",
      }),
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        subscriptionActionClaim: "start_pulse_now",
      },
      where: expectLiveHostedMailboxWhere({
        assistantInputLookupKey: {
          in: createHostedAssistantInputLookupKeyReadCandidates("ain_valid"),
        },
        causalSeq: { not: null },
        id: "mailbox_claim_1",
        kind: "conversation.message",
        lane: "conversation",
        subscriptionActionClaim: null,
        userId: "member_mailbox_1",
      }),
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["start_pulse_now", "replayed"],
    ["upgrade_edge", "conflict"],
  ] as const)(
    "classifies an existing %s claim as %s for a start-Pulse replay",
    async (existingClaim, expectedResult) => {
      const updateMany = vi.fn();
      const findFirst = vi.fn();
      const prisma = {
        hostedMailboxItem: {
          findFirst,
          findMany: vi.fn().mockResolvedValue([{
            id: "mailbox_claim_1",
            subscriptionActionClaim: existingClaim,
          }]),
          updateMany,
        },
      } as never;

      await expect(claimHostedMailboxConversationSubscriptionAction({
        action: "start_pulse_now",
        assistantInputId: "ain_valid",
        memberId: "member_mailbox_1",
        prisma,
      })).resolves.toBe(expectedResult);

      expect(updateMany).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["start_pulse_now", "replayed"],
    ["upgrade_edge", "conflict"],
    [null, null],
  ] as const)(
    "classifies a lost claim race followed by %s as %s",
    async (racedClaim, expectedResult) => {
      const findFirst = vi.fn().mockResolvedValue(
        racedClaim === null
          ? null
          : { subscriptionActionClaim: racedClaim },
      );
      const prisma = {
        hostedMailboxItem: {
          findFirst,
          findMany: vi.fn().mockResolvedValue([{
            id: "mailbox_claim_1",
            subscriptionActionClaim: null,
          }]),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      } as never;

      await expect(claimHostedMailboxConversationSubscriptionAction({
        action: "start_pulse_now",
        assistantInputId: "ain_valid",
        memberId: "member_mailbox_1",
        prisma,
      })).resolves.toBe(expectedResult);

      expect(findFirst).toHaveBeenCalledWith({
        select: {
          subscriptionActionClaim: true,
        },
        where: expectLiveHostedMailboxWhere({
          assistantInputLookupKey: {
            in: createHostedAssistantInputLookupKeyReadCandidates("ain_valid"),
          },
          causalSeq: { not: null },
          id: "mailbox_claim_1",
          kind: "conversation.message",
          lane: "conversation",
          userId: "member_mailbox_1",
        }),
      });
    },
  );

  it("allows only one of two concurrent different actions to claim an input", async () => {
    type TestSubscriptionAction = "start_pulse_now" | "upgrade_edge";
    type ClaimUpdateArgs = {
      data: { subscriptionActionClaim: TestSubscriptionAction };
    };

    let currentClaim: TestSubscriptionAction | null = null;
    let readCount = 0;
    let releaseReads!: () => void;
    const bothReadsStarted = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const findMany = vi.fn(async () => {
      const observedClaim = currentClaim;
      readCount += 1;
      if (readCount === 2) {
        releaseReads();
      }
      await bothReadsStarted;
      return [{
        id: "mailbox_claim_1",
        subscriptionActionClaim: observedClaim,
      }];
    });
    const updateMany = vi.fn(async (args: ClaimUpdateArgs) => {
      if (currentClaim !== null) {
        return { count: 0 };
      }
      currentClaim = args.data.subscriptionActionClaim;
      return { count: 1 };
    });
    const findFirst = vi.fn(async () => ({
      subscriptionActionClaim: currentClaim,
    }));
    const prisma = {
      hostedMailboxItem: { findFirst, findMany, updateMany },
    } as never;

    const results = await Promise.all([
      claimHostedMailboxConversationSubscriptionAction({
        action: "start_pulse_now",
        assistantInputId: "ain_valid",
        memberId: "member_mailbox_1",
        prisma,
      }),
      claimHostedMailboxConversationSubscriptionAction({
        action: "upgrade_edge",
        assistantInputId: "ain_valid",
        memberId: "member_mailbox_1",
        prisma,
      }),
    ]);

    expect(new Set(results)).toEqual(new Set(["claimed", "conflict"]));
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("readHostedMailboxConversationWakeByAssistantInputId", () => {
  it("fails closed for another member and for expired input authority", async () => {
    const rows = [
      {
        assistantInputLookupKey: requireAssistantInputLookupKey("ain_live"),
        createdAt: FIXED_NOW,
        expiresAt: null,
        id: "mailbox_live_input",
        kind: "conversation.message",
        lane: "conversation",
        userId: "member_mailbox_1",
      },
      {
        assistantInputLookupKey: requireAssistantInputLookupKey("ain_expired"),
        createdAt: FIXED_NOW,
        expiresAt: new Date(FIXED_NOW.getTime() - 1),
        id: "mailbox_expired_input",
        kind: "conversation.message",
        lane: "conversation",
        userId: "member_mailbox_1",
      },
    ];
    const findMany = vi.fn(async (args: {
      select: { id: true };
      take: number;
      where: {
        assistantInputLookupKey: { in: string[] };
        createdAt: { gt: Date };
        kind: string;
        lane: string;
        OR: [{ expiresAt: null }, { expiresAt: { gt: Date } }];
        userId: string;
      };
    }) => rows
      .filter((candidate) => (
        args.where.assistantInputLookupKey.in.includes(
          candidate.assistantInputLookupKey,
        )
        && candidate.createdAt > args.where.createdAt.gt
        && candidate.kind === args.where.kind
        && candidate.lane === args.where.lane
        && candidate.userId === args.where.userId
        && (
          candidate.expiresAt === null
          || candidate.expiresAt > args.where.OR[1].expiresAt.gt
        )
      ))
      .slice(0, args.take)
      .map(({ id }) => ({ id })));
    const prisma = {
      hostedMailboxItem: { findMany },
    } as never;

    await expect(readHostedMailboxConversationWakeByAssistantInputId({
      assistantInputId: "ain_live",
      availableAt: FIXED_NOW,
      memberId: "member_other",
      prisma,
    })).resolves.toBeNull();
    await expect(readHostedMailboxConversationWakeByAssistantInputId({
      assistantInputId: "ain_expired",
      availableAt: FIXED_NOW,
      memberId: "member_mailbox_1",
      prisma,
    })).resolves.toBeNull();

    expect(findMany).toHaveBeenNthCalledWith(1, {
      select: { id: true },
      take: 2,
      where: expectLiveHostedMailboxWhere({
        assistantInputLookupKey: {
          in: createHostedAssistantInputLookupKeyReadCandidates("ain_live"),
        },
        kind: "conversation.message",
        lane: "conversation",
        userId: "member_other",
      }),
    });
  });

  it("fails closed when more than one lookup-key version matches", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "mailbox_current_lookup" },
      { id: "mailbox_legacy_lookup" },
    ]);

    await expect(readHostedMailboxConversationWakeByAssistantInputId({
      assistantInputId: "ain_ambiguous_wake",
      availableAt: FIXED_NOW,
      memberId: "member_mailbox_1",
      prisma: {
        hostedMailboxItem: { findMany },
      } as never,
    })).resolves.toBeNull();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    );
  });
});

describe("tryMarkHostedMailboxConversationAiUsageDenied", () => {
  it("marks only the observed fresh conversation sequence window once", async () => {
    const executeRaw = vi.fn(async (query: unknown) => {
      void query;
      return 2;
    });

    await expect(tryMarkHostedMailboxConversationAiUsageDenied({
      afterConversationLaneSeq: 11n,
      prisma: {
        $executeRaw: executeRaw,
      } as never,
      throughConversationLaneSeq: 14n,
      userId: "member_mailbox_1",
    })).resolves.toBe(true);

    const query = executeRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(query.strings.join("?")).toContain(
      "lane_seq > ?\n        AND lane_seq <= ?",
    );
    expect(query.strings.join("?")).toContain(
      "statement_timestamp() AT TIME ZONE 'UTC'",
    );
    expect(query.values).toEqual(["member_mailbox_1", 11n, 14n]);
  });

  it("keeps a failed observability mark non-fatal", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const executeRaw = vi.fn(async () => {
      throw new Error("database unavailable");
    });

    await expect(tryMarkHostedMailboxConversationAiUsageDenied({
      afterConversationLaneSeq: 0n,
      prisma: {
        $executeRaw: executeRaw,
      } as never,
      throughConversationLaneSeq: 1n,
      userId: "member_mailbox_1",
    })).resolves.toBe(false);
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted mailbox usage-denial mark failed.",
      expect.objectContaining({
        errorCode: "HOSTED_MAILBOX_USAGE_DENIAL_MARK_FAILED",
      }),
    );
    consoleWarn.mockRestore();
  });
});

describe("appendHostedMailboxItemTx", () => {
  it("allocates a lane sequence and stores small opaque payload ciphertext inline", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
    });
    const payloadSerializedJson = JSON.stringify({ kind: "inline-test" });
    const payloadBytes = Buffer.byteLength(payloadSerializedJson, "utf8");

    const result = await appendHostedMailboxItemTx({
      dedupeKey: "dedupe_inline_1",
      kind: "conversation.message",
      lane: "conversation",
      occurredAt: "2026-04-26T00:00:00.000Z",
      payloadSerializedJson,
      tx,
      userId: "member_mailbox_1",
    });

    expect(result).toMatchObject({
      duplicate: false,
      dedupeConflict: false,
      inserted: true,
      item: {
        causalSeq: "1",
        dedupeKey: "dedupe_inline_1",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: "1",
        payloadInlineCiphertext: expect.any(String),
        payloadRef: null,
      },
    });
    const executeRawMock = vi.mocked(tx.$executeRaw);
    expect(executeRawMock).toHaveBeenCalledTimes(2);
    expect(executeRawMock.mock.calls[0]?.[2]).toBe("dedupe_inline_1");
    expect(readHostedMailboxRawSql(executeRawMock.mock.calls[1])).toContain(
      "mailbox-causal-seq",
    );
    const queryRawMock = vi.mocked(tx.$queryRaw);
    expect(readHostedMailboxRawSql(queryRawMock.mock.calls[0])).toContain(
      "VALUES (?, 'causal', 2, NOW())",
    );
    expect(readHostedMailboxRawSql(queryRawMock.mock.calls[1])).toContain(
      "VALUES (?, ?, 2, NOW())",
    );
    expect(readHostedMailboxRawSql(queryRawMock.mock.calls[2])).toContain(
      "INSERT INTO hosted_mailbox_item",
    );
    expect(hostedMailboxItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assistantInputLookupKey: null,
        dedupeKey: "dedupe_inline_1",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: 1n,
        payloadBytes,
        payloadHash: expect.stringMatching(/^hmac-sha256:[A-Za-z0-9_-]+$/u),
        payloadInlineCiphertext: expect.any(String),
        payloadRef: null,
        payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        userId: "member_mailbox_1",
      }),
    });
    expect(hostedMailboxPayload.create).not.toHaveBeenCalled();
  });

  it("ignores caller-supplied payload metadata when selecting storage and inserting metadata", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
    });
    const payloadSerializedJson = JSON.stringify({ kind: "spoof-test" });
    const payloadBytes = Buffer.byteLength(payloadSerializedJson, "utf8");
    const inputWithSpoofedMetadata = {
      dedupeKey: "dedupe_spoof_1",
      kind: "conversation.message",
      lane: "conversation",
      occurredAt: "2026-04-26T00:00:00.000Z",
      payloadBytes: 128_000,
      payloadHash: "hmac-sha256:caller-supplied-spoof",
      payloadSerializedJson,
      tx,
      userId: "member_mailbox_1",
    };

    const result = await appendHostedMailboxItemTx(inputWithSpoofedMetadata);
    const createCall = hostedMailboxItem.create.mock.calls[0]?.[0];

    expect(result.item).toMatchObject({
      payloadInlineCiphertext: expect.any(String),
      payloadRef: null,
    });
    expect(createCall?.data).toMatchObject({
      payloadBytes,
      payloadHash: expect.stringMatching(/^hmac-sha256:[A-Za-z0-9_-]+$/u),
      payloadInlineCiphertext: expect.any(String),
      payloadRef: null,
    });
    expect(createCall?.data.payloadHash).not.toBe("hmac-sha256:caller-supplied-spoof");
    expect(hostedMailboxPayload.create).not.toHaveBeenCalled();
  });

  it("stores oversized opaque payload ciphertext in the payload table", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
    });
    const payloadSerializedJson = JSON.stringify({
      body: "x".repeat(140_000),
      kind: "sidecar-test",
    });
    const payloadBytes = Buffer.byteLength(payloadSerializedJson, "utf8");

    const result = await appendHostedMailboxItemTx({
      dedupeKey: "dedupe_ref_1",
      kind: "assistant.notification.requested",
      lane: "system",
      occurredAt: FIXED_NOW,
      payloadSerializedJson,
      tx,
      userId: "member_mailbox_1",
    });
    const createCall = hostedMailboxItem.create.mock.calls[0]?.[0];

    expect(result.item).toMatchObject({
      payloadInlineCiphertext: null,
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    });
    expect(result.item).not.toHaveProperty("payloadCiphertext");
    expect(createCall?.data.payloadRef).toBe(`hosted-mailbox-payload:${createCall?.data.id}`);
    expect(createCall?.data.payloadSchema).toBe(HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA);
    expect(createCall?.data.payloadBytes).toBe(payloadBytes);
    expect(result.item.payloadRef).toBe(`hosted-mailbox-payload:${result.item.id}`);
    expect(hostedMailboxPayload.create).toHaveBeenCalledWith({
      data: {
        mailboxItemId: result.item.id,
        payloadCiphertext: expect.any(String),
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        userId: "member_mailbox_1",
      },
    });
  });

  it("decrypts inline payloads with item-schema AAD and sidecar payloads with payload-schema AAD", async () => {
    installAadCheckingHostedSecureBoxTestCodec();

    try {
      const inlineTx = createHostedMailboxTx({
        hostedMailboxItem: createHostedMailboxItemDelegate(),
        hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
      });
      const inlinePayload = { kind: "inline-aad-test" };
      const inlineResult = await appendHostedMailboxItemTx({
        dedupeKey: "dedupe_inline_aad_1",
        kind: "conversation.message",
        lane: "conversation",
        occurredAt: FIXED_NOW,
        payloadSerializedJson: JSON.stringify(inlinePayload),
        tx: inlineTx,
        userId: "member_mailbox_1",
      });
      const inlineCiphertext = inlineResult.item.payloadInlineCiphertext;
      if (!inlineCiphertext) {
        throw new Error("Expected inline mailbox ciphertext.");
      }

      await expect(decodeHostedMailboxStoredPayload({
        dedupeKey: "dedupe_inline_aad_1",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: inlineResult.item.laneSeq,
        mailboxItemId: inlineResult.item.id,
        occurredAt: inlineResult.item.occurredAt,
        payloadInlineCiphertext: inlineCiphertext,
        payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        userId: "member_mailbox_1",
      })).resolves.toEqual(inlinePayload);
      await expect(decodeHostedMailboxStoredPayload({
        dedupeKey: "dedupe_inline_aad_1",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: inlineResult.item.laneSeq,
        mailboxItemId: inlineResult.item.id,
        occurredAt: inlineResult.item.occurredAt,
        payloadInlineCiphertext: inlineCiphertext,
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        userId: "member_mailbox_1",
      })).rejects.toThrow("Hosted secure-box AAD mismatch.");

      const sidecarMailboxPayload = createHostedMailboxPayloadDelegate();
      const sidecarTx = createHostedMailboxTx({
        hostedMailboxItem: createHostedMailboxItemDelegate(),
        hostedMailboxPayload: sidecarMailboxPayload,
      });
      const sidecarPayload = {
        body: "x".repeat(140_000),
        kind: "sidecar-aad-test",
      };
      const sidecarResult = await appendHostedMailboxItemTx({
        dedupeKey: "dedupe_sidecar_aad_1",
        kind: "assistant.notification.requested",
        lane: "system",
        occurredAt: FIXED_NOW,
        payloadSerializedJson: JSON.stringify(sidecarPayload),
        tx: sidecarTx,
        userId: "member_mailbox_1",
      });
      const sidecarCreateCall = sidecarMailboxPayload.create.mock.calls[0]?.[0];
      if (!sidecarCreateCall || typeof sidecarCreateCall.data.payloadCiphertext !== "string") {
        throw new Error("Expected sidecar mailbox ciphertext.");
      }

      await expect(decodeHostedMailboxStoredPayload({
        dedupeKey: "dedupe_sidecar_aad_1",
        kind: "assistant.notification.requested",
        lane: "system",
        laneSeq: sidecarResult.item.laneSeq,
        mailboxItemId: sidecarResult.item.id,
        occurredAt: sidecarResult.item.occurredAt,
        payloadCiphertext: sidecarCreateCall.data.payloadCiphertext,
        payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        userId: "member_mailbox_1",
      })).resolves.toEqual(sidecarPayload);
      expect(sidecarCreateCall.data.payloadSchema).toBe(HOSTED_MAILBOX_PAYLOAD_SCHEMA);
    } finally {
      restoreDefaultHostedSecureBoxTestCodec();
    }
  });

  it("returns the first item for duplicate dedupe keys without rewriting payload storage", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const existing = buildHostedMailboxItemRow({
      dedupeKey: "dedupe_existing_1",
      kind: "conversation.message",
      lane: "conversation",
      payloadBytes: 64,
      payloadInlineCiphertext: "cipher_first_1",
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findUnique: vi.fn<HostedMailboxFindUnique>(async () => existing),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await appendHostedMailboxItemTx({
      dedupeKey: "dedupe_existing_1",
      kind: "member.activated",
      lane: "system",
      occurredAt: FIXED_NOW,
      payloadSerializedJson: JSON.stringify({ kind: "duplicate-test" }),
      tx,
      userId: "member_mailbox_1",
    });

    expect(result).toMatchObject({
      duplicate: true,
      dedupeConflict: true,
      inserted: false,
      item: {
        id: existing.id,
        payloadInlineCiphertext: "cipher_first_1",
      },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const executeRawMock = vi.mocked(tx.$executeRaw);
    expect(readHostedMailboxRawSql(executeRawMock.mock.calls[0])).toContain(
      "pg_advisory_xact_lock",
    );
    expect(executeRawMock.mock.calls[0]?.[2]).toBe("dedupe_existing_1");
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith("Hosted mailbox dedupe conflict.", {
      component: "mailbox",
      eventCode: "mailbox.dedupe_conflict",
      existingBytes: 64,
      existingHasHash: false,
      existingKind: "conversation.message",
      existingLane: "conversation",
      existingSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      requestedBytes: expect.any(Number),
      requestedHasHash: true,
      requestedKind: "member.activated",
      requestedLane: "system",
      requestedSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    });
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("dedupe_existing_1");
    consoleWarn.mockRestore();
    expect(hostedMailboxItem.create).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.create).not.toHaveBeenCalled();
  });

  it("reads checkpoint ownership without hydrating mailbox payload fields", async () => {
    const findUnique = vi.fn<HostedMailboxFindUnique>(async () =>
      buildHostedMailboxItemRow({
        id: "mailbox_checkpoint_1",
        lane: "system",
        laneSeq: 42n,
        payloadInlineCiphertext: "cipher_should_not_be_selected",
        payloadRef: "payload_ref_should_not_be_selected",
        userId: "member_mailbox_1",
      })
    );
    const prisma = createHostedMailboxTx({
      hostedMailboxItem: createHostedMailboxItemDelegate({
        findUnique,
      }),
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
    });

    await expect(readHostedMailboxItemCheckpointById({
      mailboxItemId: "mailbox_checkpoint_1",
      prisma,
    })).resolves.toEqual({
      id: "mailbox_checkpoint_1",
      lane: "system",
      laneSeq: "42",
      occurredAt: FIXED_NOW.toISOString(),
      userId: "member_mailbox_1",
    });
    expect(findUnique).toHaveBeenCalledWith({
      select: {
        id: true,
        lane: true,
        laneSeq: true,
        occurredAt: true,
        userId: true,
      },
      where: {
        id: "mailbox_checkpoint_1",
      },
    });
  });

  it("compares duplicate dedupe metadata derived from serialized payloads instead of caller spoof fields", async () => {
    const rows: HostedMailboxItemRow[] = [];
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      create: vi.fn<HostedMailboxCreate>(async (args) => {
        const row = buildHostedMailboxItemRow(args.data);
        rows.push(row);
        return row;
      }),
      findUnique: vi.fn<HostedMailboxFindUnique>(async (args) => {
        const where = readHostedMailboxFindUniqueWhere(args);
        return rows.find((row) => (
          row.userId === where.userId && row.dedupeKey === where.dedupeKey
        )) ?? null;
      }),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
    });
    const payloadSerializedJson = JSON.stringify({ kind: "duplicate-stable" });

    const first = await appendHostedMailboxItemTx({
      dedupeKey: "dedupe_duplicate_spoof_1",
      kind: "conversation.message",
      lane: "conversation",
      occurredAt: FIXED_NOW,
      payloadSerializedJson,
      tx,
      userId: "member_mailbox_1",
    });
    const duplicateInputWithSpoofedMetadata = {
      dedupeKey: "dedupe_duplicate_spoof_1",
      kind: "conversation.message",
      lane: "conversation",
      occurredAt: FIXED_NOW,
      payloadBytes: 999_999,
      payloadHash: "hmac-sha256:spoofed-duplicate-hash",
      payloadSerializedJson,
      tx,
      userId: "member_mailbox_1",
    };

    const duplicate = await appendHostedMailboxItemTx(duplicateInputWithSpoofedMetadata);

    expect(first.inserted).toBe(true);
    expect(duplicate).toMatchObject({
      duplicate: true,
      dedupeConflict: false,
      inserted: false,
      item: {
        id: first.item.id,
        payloadInlineCiphertext: first.item.payloadInlineCiphertext,
      },
    });
    expect(hostedMailboxItem.create).toHaveBeenCalledTimes(1);
  });
});

describe("appendHostedMailboxEnvelopeTx", () => {
  it("indexes accepted Linq input without an extra source-lock query", async () => {
    let insertedRow: HostedMailboxItemRow | null = null;
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      create: vi.fn<HostedMailboxCreate>(async (args) => {
        insertedRow = buildHostedMailboxItemRow(args.data);
        return insertedRow;
      }),
      findUnique: vi.fn<HostedMailboxFindUnique>(async () => insertedRow),
    });
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
    });
    const grouped = buildHostedGroupLinqEnvelope("member_mailbox_1");
    const envelope = {
      ...grouped,
      message: {
        ...grouped.message,
        linqMessage: {
          ...grouped.message.linqMessage,
          threadIsDirect: true,
        },
        routeAuthority: undefined,
        senderMemberId: undefined,
      },
    };

    await expect(appendHostedMailboxEnvelopeWithSourceMessageTx({
      envelope,
      sourceMessageLookupKey: "hbidx:linq-message:v2:current",
      tx,
    })).resolves.toMatchObject({
      inserted: true,
    });

    expect(hostedMailboxItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceMessageLookupKey: "hbidx:linq-message:v2:current",
      }),
    });
    const executeRawMock = vi.mocked(tx.$executeRaw);
    expect(executeRawMock).toHaveBeenCalledTimes(3);
    expect(
      executeRawMock.mock.calls.map(readHostedMailboxRawSql).join("\n"),
    ).not.toContain("mailbox-source-message");
  });

  it("uses an explicit request identity and expiry without changing ordinary appends", async () => {
    let insertedRow: HostedMailboxItemRow | null = null;
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      create: vi.fn<HostedMailboxCreate>(async (args) => {
        insertedRow = buildHostedMailboxItemRow(args.data);
        return insertedRow;
      }),
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => insertedRow),
    });
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
    });
    const itemId = `aask_req_${"a".repeat(64)}`;
    const expiresAt = new Date(FIXED_NOW.getTime() + 10 * 60 * 1_000).toISOString();
    const envelope = buildHostedExecutionAssistantAskRequestedWake({
      ask: {
        expiresAt,
        originAssistantInputId: `ain_${"b".repeat(32)}`,
        originSessionId: "session_private",
        question: "What is today's workout?",
        target: {
          kind: "joined_group",
          membershipId: "membership-one",
          requestedLabel: null,
        },
      },
      eventId: itemId,
      memberId: "member-group-runtime",
      occurredAt: FIXED_NOW.toISOString(),
    });

    await expect(appendHostedMailboxEnvelopeWithIdentityTx({
      envelope,
      expiresAt,
      itemId,
      tx,
    })).resolves.toMatchObject({
      inserted: true,
      item: {
        expiresAt,
        id: itemId,
      },
    });

    expect(hostedMailboxItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expiresAt: new Date(expiresAt),
        id: itemId,
      }),
    });
    await expect(readHostedMailboxWakeByItemId({
      availableAt: FIXED_NOW,
      mailboxItemId: itemId,
      prisma: tx,
    })).resolves.toEqual(envelope);
    await expect(appendHostedMailboxEnvelopeWithIdentityTx({
      envelope,
      expiresAt,
      itemId: `${itemId}_different`,
      tx,
    })).rejects.toThrow(
      "Hosted mailbox item identity must equal the envelope event id.",
    );
    expect(hostedMailboxItem.create).toHaveBeenCalledTimes(1);
  });

  it("serializes post-append reconciliation before reading the mailbox claim", async () => {
    const findUnique = vi.fn<HostedMailboxFindUnique>(async () => null);
    const tx = createHostedMailboxTx({
      hostedMailboxItem: createHostedMailboxItemDelegate({ findUnique }),
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
    });

    await expect(readHostedMailboxWakeAfterDedupeLockTx({
      dedupeKey: "meal-photo:enrollment:capture",
      tx,
      userId: "member_mailbox_1",
    })).resolves.toBeNull();

    expect(vi.mocked(tx.$executeRaw).mock.invocationCallOrder[0]).toBeLessThan(
      findUnique.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("rejects a non-direct Linq envelope whose authority names another workspace", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const hostedThreadRoute = {
      findFirst: vi.fn(async () => ({
        containerMemberId: "member_other_container_123",
      })),
    };
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
      hostedThreadRoute,
    });
    const envelope = buildHostedGroupLinqEnvelope("member_personal_123");
    envelope.message.routeAuthority.containerMemberId = "member_other_container_123";

    await expect(appendHostedMailboxEnvelopeTx({
      envelope,
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_WORKSPACE_TARGET_MISMATCH",
      retryable: true,
    });

    expect(hostedThreadRoute.findFirst).not.toHaveBeenCalled();
    expect(tx.hostedWorkspace.upsert).not.toHaveBeenCalled();
    expect(hostedMailboxItem.create).not.toHaveBeenCalled();
  });

  it("rejects a non-direct Linq envelope unless a persisted thread route owns the target workspace", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const hostedThreadRoute = {
      findFirst: vi.fn(async () => null),
    };
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
      hostedThreadRoute,
    });

    await expect(appendHostedMailboxEnvelopeTx({
      envelope: buildHostedGroupLinqEnvelope("member_personal_123"),
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_WORKSPACE_TARGET_MISMATCH",
      retryable: true,
    });

    expect(hostedThreadRoute.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        channel: "linq",
        threadIdentityLookupKey: {
          in: expect.arrayContaining([
            expect.stringMatching(/^hbidx:external-thread-identity:v\d+:/u),
          ]),
        },
      }),
    }));
    expect(tx.hostedWorkspace.upsert).not.toHaveBeenCalled();
    expect(hostedMailboxItem.create).not.toHaveBeenCalled();
  });

  it("rejects a reported-direct Linq envelope when a persisted route owns another workspace", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const hostedThreadRoute = {
      findFirst: vi.fn(async () => ({
        containerMemberId: "member_thread_container_123",
      })),
    };
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
      hostedThreadRoute,
    });
    const envelope = buildHostedGroupLinqEnvelope("member_personal_123");
    const reportedDirectEnvelope = {
      ...envelope,
      message: {
        ...envelope.message,
        linqMessage: {
          ...envelope.message.linqMessage,
          threadIsDirect: true,
        },
        routeAuthority: undefined,
      },
    };

    await expect(appendHostedMailboxEnvelopeTx({
      envelope: reportedDirectEnvelope,
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_WORKSPACE_TARGET_MISMATCH",
      retryable: true,
    });

    expect(hostedThreadRoute.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.hostedWorkspace.upsert).not.toHaveBeenCalled();
    expect(hostedMailboxItem.create).not.toHaveBeenCalled();
  });

  it("admits a non-direct Linq envelope only for its persisted thread container", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const hostedThreadRoute = {
      findFirst: vi.fn(async () => ({
        containerMemberId: "member_thread_container_123",
      })),
    };
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
      hostedThreadRoute,
    });

    const envelope = buildHostedGroupLinqEnvelope("member_thread_container_123");
    const expectedAssistantInputId = createHostedMailboxAssistantInputId({
      dedupeKey: envelope.eventId,
      eventId: envelope.eventId,
      lane: "conversation",
      secret: readHostedConversationAssistantIdentifierSecret(envelope),
      userId: envelope.userId,
    });
    const expectedAssistantInputLookupKey = requireAssistantInputLookupKey(
      expectedAssistantInputId,
    );

    await expect(appendHostedMailboxEnvelopeTx({
      envelope,
      tx,
    })).resolves.toMatchObject({
      inserted: true,
      item: {
        userId: "member_thread_container_123",
      },
    });

    expect(tx.hostedWorkspace.upsert).toHaveBeenCalledWith({
      create: {
        userId: "member_thread_container_123",
      },
      update: {},
      where: {
        userId: "member_thread_container_123",
      },
    });
    expect(hostedMailboxItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assistantInputLookupKey: expectedAssistantInputLookupKey,
      }),
    });
  });

  it("preserves the first assistant input identity on an exact envelope replay", async () => {
    const rows: HostedMailboxItemRow[] = [];
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      create: vi.fn<HostedMailboxCreate>(async (args) => {
        const row = buildHostedMailboxItemRow(args.data);
        rows.push(row);
        return row;
      }),
      findUnique: vi.fn<HostedMailboxFindUnique>(async (args) => {
        const where = readHostedMailboxFindUniqueWhere(args);
        return rows.find((row) => (
          row.userId === where.userId && row.dedupeKey === where.dedupeKey
        )) ?? null;
      }),
    });
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
      hostedThreadRoute: {
        findFirst: vi.fn(async () => ({
          containerMemberId: "member_thread_container_123",
        })),
      },
    });
    const envelope = buildHostedGroupLinqEnvelope("member_thread_container_123");

    const first = await appendHostedMailboxEnvelopeTx({ envelope, tx });
    const duplicate = await appendHostedMailboxEnvelopeTx({ envelope, tx });

    expect(first.inserted).toBe(true);
    expect(duplicate).toMatchObject({
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: {
        id: first.item.id,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assistantInputLookupKey).toMatch(
      /^hbidx:assistant-input:v[0-9]+:[a-f0-9]{64}$/u,
    );
    expect(hostedMailboxItem.create).toHaveBeenCalledTimes(1);
  });

  it("rejects group email when the target group names another runtime workspace", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const hostedGroup = {
      findUnique: vi.fn(async () => ({
        runtimeMemberId: "member_other_container_123",
      })),
    };
    const tx = createHostedMailboxTx({
      hostedGroup,
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    await expect(appendHostedMailboxEnvelopeTx({
      envelope: buildHostedGroupEmailEnvelope("member_personal_123"),
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_WORKSPACE_TARGET_MISMATCH",
      retryable: true,
    });

    expect(hostedGroup.findUnique).toHaveBeenCalledWith({
      select: {
        runtimeMemberId: true,
      },
      where: {
        id: "group_123",
      },
    });
    expect(tx.hostedThreadContainer.findUnique).not.toHaveBeenCalled();
    expect(tx.hostedWorkspace.upsert).not.toHaveBeenCalled();
  });

  it("rejects group email when its runtime member is not a thread container", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          runtimeMemberId: "member_group_runtime_123",
        })),
      },
      hostedMailboxItem,
      hostedMailboxPayload,
      hostedThreadContainer: {
        findUnique: vi.fn(async () => null),
      },
    });

    await expect(appendHostedMailboxEnvelopeTx({
      envelope: buildHostedGroupEmailEnvelope("member_group_runtime_123"),
      tx,
    })).rejects.toMatchObject({
      code: "HOSTED_GROUP_WORKSPACE_TARGET_MISMATCH",
      retryable: true,
    });

    expect(tx.hostedWorkspace.upsert).not.toHaveBeenCalled();
    expect(hostedMailboxItem.create).not.toHaveBeenCalled();
  });

  it("admits group email only when the group runtime is a thread container", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedGroup: {
        findUnique: vi.fn(async () => ({
          runtimeMemberId: "member_group_runtime_123",
        })),
      },
      hostedMailboxItem,
      hostedMailboxPayload,
      hostedThreadContainer: {
        findUnique: vi.fn(async () => ({
          memberId: "member_group_runtime_123",
        })),
      },
    });

    await expect(appendHostedMailboxEnvelopeTx({
      envelope: buildHostedGroupEmailEnvelope("member_group_runtime_123"),
      tx,
    })).resolves.toMatchObject({
      inserted: true,
      item: {
        userId: "member_group_runtime_123",
      },
    });

    expect(tx.hostedWorkspace.upsert).toHaveBeenCalledTimes(1);
    expect(hostedMailboxItem.create).toHaveBeenCalledTimes(1);
  });

  it("maps a member.channels.updated producer envelope to one system mailbox item", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await appendHostedMailboxEnvelopeTx({
      envelope: {
        eventId: "member.channels.updated:settings.phone.sync:member_mailbox_1:2026-04-26T00:00:00.000Z",
        kind: "member.channels.updated",
        memberChannels: {
          email: true,
          linq: true,
          telegram: false,
        },
        occurredAt: "2026-04-26T00:00:00.000Z",
        userId: "member_mailbox_1",
      },
      tx,
    });
    const createCall = hostedMailboxItem.create.mock.calls[0]?.[0];

    expect(result).toMatchObject({
      duplicate: false,
      inserted: true,
      item: {
        dedupeKey: "member.channels.updated:settings.phone.sync:member_mailbox_1:2026-04-26T00:00:00.000Z",
        kind: "member.channels.updated",
        lane: "system",
        laneSeq: "1",
        payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      },
    });
    expect(hostedMailboxItem.create).toHaveBeenCalledTimes(1);
    expect(createCall?.data).toMatchObject({
      assistantInputLookupKey: null,
      dedupeKey: "member.channels.updated:settings.phone.sync:member_mailbox_1:2026-04-26T00:00:00.000Z",
      kind: "member.channels.updated",
      lane: "system",
      laneSeq: 1n,
      payloadHash: expect.stringMatching(/^hmac-sha256:[A-Za-z0-9_-]+$/u),
      payloadRef: null,
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      userId: "member_mailbox_1",
    });
    expect(createCall?.data.payloadHash).not.toContain("member.channels.updated");
    expect(createCall?.data.payloadHash).not.toContain("settings.phone.sync");
    expect(createCall?.data.payloadInlineCiphertext).toEqual(expect.any(String));
    expect(createCall?.data.payloadInlineCiphertext).not.toContain("member.channels.updated");
    expect(createCall?.data.payloadInlineCiphertext).not.toContain("settings.phone.sync");
    expect(hostedMailboxPayload.create).not.toHaveBeenCalled();
  });

  it("flags duplicate producer envelopes with same-size payload drift without rewriting payload storage", async () => {
    const rows: HostedMailboxItemRow[] = [];
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      create: vi.fn<HostedMailboxCreate>(async (args) => {
        const row = buildHostedMailboxItemRow(args.data);
        rows.push(row);
        return row;
      }),
      findUnique: vi.fn<HostedMailboxFindUnique>(async (args) => {
        const where = readHostedMailboxFindUniqueWhere(args);
        return rows.find((row) => (
          row.userId === where.userId && row.dedupeKey === where.dedupeKey
        )) ?? null;
      }),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
    });
    const envelope = {
      eventId: "member.channels.updated:settings.phone.sync:member_mailbox_1:2026-04-26T00:00:00.000Z",
      kind: "member.channels.updated" as const,
      memberChannels: {
        email: true,
        linq: true,
        telegram: false,
      },
      occurredAt: "2026-04-26T00:00:00.000Z",
      userId: "member_mailbox_1",
    };
    const first = await appendHostedMailboxEnvelopeTx({
      envelope,
      tx,
    });

    const duplicate = await appendHostedMailboxEnvelopeTx({
      envelope: {
        ...envelope,
        memberChannels: {
          email: true,
          linq: false,
          telegram: true,
        },
      },
      tx,
    });

    expect(first.dedupeConflict).toBe(false);
    expect(duplicate).toMatchObject({
      duplicate: true,
      dedupeConflict: true,
      inserted: false,
      item: {
        id: first.item.id,
        payloadInlineCiphertext: first.item.payloadInlineCiphertext,
      },
    });
    expect(hostedMailboxItem.create).toHaveBeenCalledTimes(1);
    expect(hostedMailboxPayload.create).not.toHaveBeenCalled();
  });

  it("keeps the first staged object as the canonical exact-duplicate meal photo", async () => {
    const rows: HostedMailboxItemRow[] = [];
    const findUnique = vi.fn<HostedMailboxFindUnique>(async (args) => {
      const where = readHostedMailboxFindUniqueWhere(args);
      return rows.find((row) => (
        row.userId === where.userId && row.dedupeKey === where.dedupeKey
      )) ?? null;
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      create: vi.fn<HostedMailboxCreate>(async (args) => {
        const row = buildHostedMailboxItemRow(args.data);
        rows.push(row);
        return row;
      }),
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => rows[0] ?? null),
      findUnique,
    });
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
    });

    const first = await appendHostedMealPhotoMailboxEnvelopeTx({
      envelope: buildHostedMealPhotoEnvelope("meal-photo-attempt-a"),
      tx,
    });
    const duplicate = await appendHostedMealPhotoMailboxEnvelopeTx({
      envelope: buildHostedMealPhotoEnvelope(
        "meal-photo-attempt-b",
        { channel: "telegram", threadId: "telegram_home_thread" },
      ),
      tx,
    });

    expect(first).toMatchObject({
      claimedMealPhotoKey: "meal-photo-attempt-a",
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
    });
    expect(duplicate).toMatchObject({
      claimedMealPhotoKey: "meal-photo-attempt-a",
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: { id: first.item.id },
    });
    expect(hostedMailboxItem.create).toHaveBeenCalledTimes(1);
    await expect(readHostedMailboxWakeByItemId({
      availableAt: FIXED_NOW,
      mailboxItemId: first.item.id,
      prisma: tx,
    })).resolves.toMatchObject({
      directRoute: {
        channel: "linq",
        threadId: "linq_home_thread",
      },
    });
    expect(vi.mocked(tx.$executeRaw).mock.invocationCallOrder[0]).toBeLessThan(
      findUnique.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("keeps the first staged object as the canonical exact-duplicate environment recording", async () => {
    const rows: HostedMailboxItemRow[] = [];
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      create: vi.fn<HostedMailboxCreate>(async (args) => {
        const row = buildHostedMailboxItemRow(args.data);
        rows.push(row);
        return row;
      }),
      findUnique: vi.fn<HostedMailboxFindUnique>(async (args) => {
        const where = readHostedMailboxFindUniqueWhere(args);
        return rows.find((row) => (
          row.userId === where.userId && row.dedupeKey === where.dedupeKey
        )) ?? null;
      }),
    });
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
    });

    const first = await appendHostedEnvironmentVoiceMailboxEnvelopeTx({
      envelope: buildHostedEnvironmentVoiceEnvelope("a".repeat(40)),
      tx,
    });
    const duplicate = await appendHostedEnvironmentVoiceMailboxEnvelopeTx({
      envelope: buildHostedEnvironmentVoiceEnvelope("b".repeat(40)),
      tx,
    });

    expect(first).toMatchObject({
      claimedAudioKey: "a".repeat(40),
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
    });
    expect(duplicate).toMatchObject({
      claimedAudioKey: "a".repeat(40),
      dedupeConflict: false,
      duplicate: true,
      inserted: false,
      item: { id: first.item.id },
    });
    expect(hostedMailboxItem.create).toHaveBeenCalledTimes(1);
  });

  it("detects an environment recording ahead of the system lane watermark", async () => {
    const findFirst = vi.fn<HostedMailboxItemFindFirst>(async () => (
      buildHostedMailboxItemRow({
        kind: "environment-voice.captured",
        lane: "system",
        laneSeq: 8n,
        userId: "member_mailbox_1",
      })
    ));
    const findUnique = vi.fn(async () => ({ consumedSeq: 7n }));
    const tx = createHostedMailboxTx({
      hostedMailboxItem: createHostedMailboxItemDelegate({ findFirst }),
      hostedMailboxLaneCounter: { findUnique },
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
    });

    await expect(
      hasPendingHostedEnvironmentVoiceMailboxItemTx({
        tx,
        userId: "member_mailbox_1",
      }),
    ).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      select: { consumedSeq: true },
      where: {
        userId_lane: {
          lane: "system",
          userId: "member_mailbox_1",
        },
      },
    });
    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        kind: "environment-voice.captured",
        lane: "system",
        laneSeq: { gt: 7n },
        userId: "member_mailbox_1",
      },
    });
  });

  it("does not treat an environment recording behind the system lane watermark as pending", async () => {
    const findFirst = vi.fn<HostedMailboxItemFindFirst>(async () => null);
    const tx = createHostedMailboxTx({
      hostedMailboxItem: createHostedMailboxItemDelegate({ findFirst }),
      hostedMailboxLaneCounter: {
        findUnique: vi.fn(async () => ({ consumedSeq: 8n })),
      },
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
    });

    await expect(
      hasPendingHostedEnvironmentVoiceMailboxItemTx({
        tx,
        userId: "member_mailbox_1",
      }),
    ).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        kind: "environment-voice.captured",
        lane: "system",
        laneSeq: { gt: 8n },
        userId: "member_mailbox_1",
      },
    });
  });

  it("still rejects conflicting reuse of a meal-photo capture event", async () => {
    const rows: HostedMailboxItemRow[] = [];
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      create: vi.fn<HostedMailboxCreate>(async (args) => {
        const row = buildHostedMailboxItemRow(args.data);
        rows.push(row);
        return row;
      }),
      findUnique: vi.fn<HostedMailboxFindUnique>(async (args) => {
        const where = readHostedMailboxFindUniqueWhere(args);
        return rows.find((row) => (
          row.userId === where.userId && row.dedupeKey === where.dedupeKey
        )) ?? null;
      }),
    });
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
    });

    await appendHostedMealPhotoMailboxEnvelopeTx({
      envelope: buildHostedMealPhotoEnvelope("meal-photo-attempt-a"),
      tx,
    });
    const conflict = await appendHostedMealPhotoMailboxEnvelopeTx({
      envelope: {
        ...buildHostedMealPhotoEnvelope("meal-photo-attempt-b"),
        mealPhoto: {
          ...buildHostedMealPhotoEnvelope("meal-photo-attempt-b").mealPhoto,
          sha256: "c".repeat(64),
        },
      },
      tx,
    });

    expect(conflict).toMatchObject({
      claimedMealPhotoKey: "meal-photo-attempt-b",
      dedupeConflict: true,
      duplicate: true,
      inserted: false,
    });
    expect(hostedMailboxItem.create).toHaveBeenCalledTimes(1);
  });
});

describe("fetchHostedMailboxItemsAfterLaneCursors", () => {
  it("fetches each lane after the imported cursor without hydrating sidecar payloads", async () => {
    const conversationRef = buildHostedMailboxItemRow({
      consumedAt: new Date("2026-04-26T00:00:04.000Z"),
      id: "mailbox_ref_1",
      lane: "conversation",
      laneSeq: 12n,
      payloadInlineCiphertext: null,
      payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
    });
    const conversationInline = buildHostedMailboxItemRow({
      id: "mailbox_inline_2",
      lane: "conversation",
      laneSeq: 13n,
      payloadInlineCiphertext: "cipher_inline_2",
      payloadRef: null,
    });
    const systemItem = buildHostedMailboxItemRow({
      id: "mailbox_system_1",
      kind: "member.activated",
      lane: "system",
      laneSeq: 3n,
      payloadInlineCiphertext: "cipher_system_1",
      payloadRef: null,
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findMany: vi.fn<HostedMailboxFindMany>(async (args) => {
        if (args.where.lane === "conversation") {
          return [conversationRef, conversationInline];
        }

        return [systemItem];
      }),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await fetchHostedMailboxItemsAfterLaneCursors({
      lanes: [
        {
          afterSeq: "11",
          lane: "conversation",
        },
        {
          afterSeq: 2n,
          lane: "system",
        },
      ],
      limitPerLane: 2,
      now: FIXED_NOW,
      prisma,
      userId: "member_mailbox_1",
    });

    expect(hostedMailboxItem.findMany).toHaveBeenNthCalledWith(1, {
      orderBy: {
        laneSeq: "asc",
      },
      take: 2,
      where: expectLiveHostedMailboxWhere({
        lane: "conversation",
        laneSeq: {
          gt: 11n,
        },
        userId: "member_mailbox_1",
      }),
    });
    expect(hostedMailboxItem.findMany).toHaveBeenNthCalledWith(2, {
      orderBy: {
        laneSeq: "asc",
      },
      take: 2,
      where: expectLiveHostedMailboxWhere({
        lane: "system",
        laneSeq: {
          gt: 2n,
        },
        userId: "member_mailbox_1",
      }),
    });
    expect(result.items.map((item) => ({
      consumedAt: item.consumedAt,
      id: item.id,
      payloadInlineCiphertext: item.payloadInlineCiphertext,
      payloadRef: item.payloadRef,
    }))).toEqual([
      {
        consumedAt: "2026-04-26T00:00:04.000Z",
        id: "mailbox_ref_1",
        payloadInlineCiphertext: null,
        payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      },
      {
        consumedAt: null,
        id: "mailbox_inline_2",
        payloadInlineCiphertext: "cipher_inline_2",
        payloadRef: null,
      },
      {
        consumedAt: null,
        id: "mailbox_system_1",
        payloadInlineCiphertext: "cipher_system_1",
        payloadRef: null,
      },
    ]);
    expect(hostedMailboxPayload.findFirst).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.findMany).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.findUnique).not.toHaveBeenCalled();
  });

  it("fetches after the runtime imported watermark when consumed metadata lags local import", async () => {
    const rows = Array.from({ length: 251 }, (_, index) => {
      const seq = BigInt(index + 1);
      return buildHostedMailboxItemRow({
        id: `mailbox_seq_${seq.toString().padStart(3, "0")}`,
        lane: "conversation",
        laneSeq: seq,
        payloadInlineCiphertext: `cipher_${seq.toString()}`,
      });
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findMany: vi.fn<HostedMailboxFindMany>(async (args) => {
        const gt = args.where.laneSeq.gt;
        return rows
          .filter((row) => row.lane === args.where.lane && row.laneSeq > gt)
          .slice(0, args.take);
      }),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });
    const lanes = resolveHostedMailboxRuntimeFetchLaneCursors({
      consumedSeqByLane: [
        {
          consumedSeq: "13",
          lane: "conversation",
        },
      ],
      cursorMode: "imported_seq",
      lanes: [
        {
          importedSeq: "250",
          lane: "conversation",
        },
      ],
    });

    expect(lanes).toEqual([
      {
        afterSeq: "250",
        lane: "conversation",
      },
    ]);

    const result = await fetchHostedMailboxItemsAfterLaneCursors({
      lanes,
      limitPerLane: 10,
      now: FIXED_NOW,
      prisma,
      userId: "member_mailbox_1",
    });

    expect(hostedMailboxItem.findMany).toHaveBeenCalledTimes(1);
    expect(hostedMailboxItem.findMany).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "asc",
      },
      take: 10,
      where: expectLiveHostedMailboxWhere({
        lane: "conversation",
        laneSeq: {
          gt: 250n,
        },
        userId: "member_mailbox_1",
      }),
    });
    expect(result.items).toHaveLength(1);
    expect(result.items.at(-1)?.id).toBe("mailbox_seq_251");
  });

  it("anchors legacy conversation fetches at the consumed floor when it lags imported", async () => {
    const rows = Array.from({ length: 251 }, (_, index) => {
      const seq = BigInt(index + 1);
      return buildHostedMailboxItemRow({
        id: `mailbox_legacy_seq_${seq.toString().padStart(3, "0")}`,
        lane: "conversation",
        laneSeq: seq,
        payloadInlineCiphertext: `cipher_${seq.toString()}`,
      });
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findMany: vi.fn<HostedMailboxFindMany>(async (args) => {
        const gt = args.where.laneSeq.gt;
        return rows
          .filter((row) => row.lane === args.where.lane && row.laneSeq > gt)
          .slice(0, args.take);
      }),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });
    const lanes = resolveHostedMailboxRuntimeFetchLaneCursors({
      consumedSeqByLane: [
        {
          consumedSeq: "13",
          lane: "conversation",
        },
      ],
      lanes: [
        {
          importedSeq: "250",
          lane: "conversation",
        },
      ],
    });

    expect(lanes).toEqual([
      {
        afterSeq: "13",
        lane: "conversation",
      },
    ]);

    const result = await fetchHostedMailboxItemsAfterLaneCursors({
      lanes,
      limitPerLane: 10,
      now: FIXED_NOW,
      prisma,
      userId: "member_mailbox_1",
    });

    expect(hostedMailboxItem.findMany).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "asc",
      },
      take: 10,
      where: expectLiveHostedMailboxWhere({
        lane: "conversation",
        laneSeq: {
          gt: 13n,
        },
        userId: "member_mailbox_1",
      }),
    });
    expect(result.items.map((item) => item.laneSeq)).toEqual([
      "14",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
      "22",
      "23",
    ]);
  });

  it("keeps legacy system fetches after the runtime imported watermark", () => {
    const lanes = resolveHostedMailboxRuntimeFetchLaneCursors({
      consumedSeqByLane: [
        {
          consumedSeq: "1",
          lane: "system",
        },
      ],
      lanes: [
        {
          importedSeq: "8",
          lane: "system",
        },
      ],
    });

    expect(lanes).toEqual([
      {
        afterSeq: "8",
        lane: "system",
      },
    ]);
  });

  it("pages consumed-ahead context from the local imported watermark before fresh rows", async () => {
    const rows = Array.from({ length: 251 }, (_, index) => {
      const seq = BigInt(index + 1);
      return buildHostedMailboxItemRow({
        id: `mailbox_consumed_ahead_${seq.toString().padStart(3, "0")}`,
        lane: "conversation",
        laneSeq: seq,
        payloadInlineCiphertext: `cipher_${seq.toString()}`,
      });
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findMany: vi.fn<HostedMailboxFindMany>(async (args) => {
        const gt = args.where.laneSeq.gt;
        return rows
          .filter((row) => row.lane === args.where.lane && row.laneSeq > gt)
          .slice(0, args.take);
      }),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });
    const lanes = resolveHostedMailboxRuntimeFetchLaneCursors({
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
    });

    expect(lanes).toEqual([
      {
        afterSeq: "0",
        lane: "conversation",
      },
    ]);

    const result = await fetchHostedMailboxItemsAfterLaneCursors({
      lanes,
      limitPerLane: 2,
      now: FIXED_NOW,
      prisma,
      userId: "member_mailbox_1",
    });

    expect(hostedMailboxItem.findMany).toHaveBeenCalledTimes(1);
    expect(hostedMailboxItem.findMany).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "asc",
      },
      take: 2,
      where: expectLiveHostedMailboxWhere({
        lane: "conversation",
        laneSeq: {
          gt: 0n,
        },
        userId: "member_mailbox_1",
      }),
    });
    expect(result.items.map((item) => item.laneSeq)).toEqual(["1", "2"]);
  });

  it("fetches only live rows after the requested lane cursor", async () => {
    const expiredInlineSeq1 = buildHostedMailboxItemRow({
      expiresAt: new Date("2026-04-25T00:00:00.000Z"),
      id: "mailbox_expired_inline_1",
      lane: "conversation",
      laneSeq: 1n,
      payloadInlineCiphertext: "cipher_expired_1",
    });
    const expiredSidecarSeq2 = buildHostedMailboxItemRow({
      expiresAt: new Date("2026-04-25T00:00:00.000Z"),
      id: "mailbox_expired_sidecar_2",
      lane: "conversation",
      laneSeq: 2n,
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_expired_sidecar_2",
    });
    const agedInlineSeq3 = buildHostedMailboxItemRow({
      createdAt: new Date(FIXED_NOW.getTime() - HOSTED_MAILBOX_TEST_RETENTION_MS - 1),
      expiresAt: null,
      id: "mailbox_aged_inline_3",
      lane: "conversation",
      laneSeq: 3n,
      payloadInlineCiphertext: "cipher_aged_3",
    });
    const liveSeq4 = buildHostedMailboxItemRow({
      expiresAt: new Date("2026-04-27T00:00:00.000Z"),
      id: "mailbox_live_4",
      lane: "conversation",
      laneSeq: 4n,
      payloadInlineCiphertext: "cipher_live_4",
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findMany: vi.fn<HostedMailboxFindMany>(async () =>
        [
          expiredInlineSeq1,
          expiredSidecarSeq2,
          agedInlineSeq3,
          liveSeq4,
        ].filter((row) =>
          row.createdAt.getTime() > FIXED_NOW.getTime() - HOSTED_MAILBOX_TEST_RETENTION_MS
          && (row.expiresAt === null || row.expiresAt > FIXED_NOW)
        )
      ),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await fetchHostedMailboxItemsAfterLaneCursors({
      lanes: [
        {
          afterSeq: 0,
          lane: "conversation",
        },
      ],
      limitPerLane: 10,
      now: FIXED_NOW,
      prisma,
      userId: "member_mailbox_1",
    });

    expect(hostedMailboxItem.findMany).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "asc",
      },
      take: 10,
      where: expectLiveHostedMailboxWhere({
        lane: "conversation",
        laneSeq: {
          gt: 0n,
        },
        userId: "member_mailbox_1",
      }),
    });
    expect(result.items.map((item) => ({
      expiresAt: item.expiresAt,
      id: item.id,
      laneSeq: item.laneSeq,
      payloadInlineCiphertext: item.payloadInlineCiphertext,
      payloadRef: item.payloadRef,
    }))).toEqual([
      {
        expiresAt: "2026-04-27T00:00:00.000Z",
        id: "mailbox_live_4",
        laneSeq: "4",
        payloadInlineCiphertext: "cipher_live_4",
        payloadRef: null,
      },
    ]);
    expect(hostedMailboxPayload.findFirst).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.findMany).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.findUnique).not.toHaveBeenCalled();
  });

  it("reads max lane sequence from live mailbox rows", async () => {
    const liveSeq2 = buildHostedMailboxItemRow({
      expiresAt: new Date("2026-04-27T00:00:00.000Z"),
      id: "mailbox_live_2",
      lane: "conversation",
      laneSeq: 2n,
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => liveSeq2),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await readHostedMailboxMaxSeqByLane({
      lanes: ["conversation"],
      prisma,
      userId: "member_mailbox_1",
    });

    expect(hostedMailboxItem.findFirst).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "desc",
      },
      where: expectLiveHostedMailboxWhere({
        lane: "conversation",
        userId: "member_mailbox_1",
      }),
    });
    expect(result).toEqual([
      {
        lane: "conversation",
        maxSeq: "2",
        maxUpdatedAt: FIXED_NOW.toISOString(),
      },
    ]);
  });

  it("checks whether a member has any mailbox item for a given kind", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => buildHostedMailboxItemRow({
        id: "mailbox_activation_1",
        kind: "member.activated",
        lane: "system",
      })),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    await expect(hasHostedMailboxItemByKind({
      kind: "member.activated",
      prisma,
      userId: "member_mailbox_1",
    })).resolves.toBe(true);

    expect(hostedMailboxItem.findFirst).toHaveBeenCalledWith({
      select: {
        id: true,
      },
      where: {
        kind: "member.activated",
        userId: "member_mailbox_1",
      },
    });
  });

  it("reads activation mailbox facts for a maximum member set in one narrow query", async () => {
    const userIds = Array.from({ length: 32 }, (_, index) => `member_${index}`);
    const groupBy = vi.fn().mockResolvedValue([
      { userId: "member_1" },
      { userId: "member_31" },
    ]);

    await expect(readHostedMailboxUserIdsByKind({
      kind: "member.activated",
      prisma: {
        hostedMailboxItem: { groupBy },
      } as never,
      userIds,
    })).resolves.toEqual(new Set(["member_1", "member_31"]));

    expect(groupBy).toHaveBeenCalledExactlyOnceWith({
      by: ["userId"],
      where: {
        kind: "member.activated",
        userId: { in: userIds },
      },
    });
  });

  it("reads the latest unconsumed pending conversation item after the replay floor", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => buildHostedMailboxItemRow({
        id: "mailbox_conversation_3",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: 3n,
      })),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await readHostedMailboxLatestPendingConversationItem({
      afterSeq: "2",
      prisma,
      userId: "member_mailbox_1",
    });

    expect(result).toMatchObject({
      id: "mailbox_conversation_3",
      laneSeq: "3",
    });
    expect(hostedMailboxItem.findFirst).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "desc",
      },
      where: expectLiveHostedMailboxWhere({
        consumedAt: null,
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: {
          gt: 2n,
        },
        userId: "member_mailbox_1",
      }),
    });
  });

  it("fetches sidecar payload ciphertext through the separate payload helper", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => buildHostedMailboxItemRow({
        createdAt: new Date(),
        id: "mailbox_ref_1",
        payloadInlineCiphertext: null,
        payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      })),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate({
      findFirst: vi.fn<HostedMailboxPayloadFindFirst>(async () => (
        buildHostedMailboxPayloadRow({
          mailboxItemId: "mailbox_ref_1",
          payloadCiphertext: "cipher_ref_1",
        })
      )),
    });
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await fetchHostedMailboxPayload({
      dedupeKey: "dedupe_1",
      mailboxItemId: "mailbox_ref_1",
      payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      prisma,
      requestId: "request_payload_1",
      userId: "member_mailbox_1",
    });

    expect(hostedMailboxItem.findFirst).toHaveBeenCalledWith({
      where: {
        dedupeKey: "dedupe_1",
        id: "mailbox_ref_1",
        userId: "member_mailbox_1",
      },
    });
    expect(hostedMailboxPayload.findFirst).toHaveBeenCalledWith({
      where: {
        mailboxItem: expectLiveHostedMailboxWhere({}),
        mailboxItemId: "mailbox_ref_1",
        userId: "member_mailbox_1",
      },
    });
    expect(result.payload).toMatchObject({
      mailboxItemId: "mailbox_ref_1",
      payloadCiphertext: "cipher_ref_1",
      userId: "member_mailbox_1",
    });
    expect(result.unavailable).toBeNull();
  });

  it("does not return expired sidecar payload ciphertext", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => buildHostedMailboxItemRow({
        expiresAt: new Date("2026-04-25T00:00:00.000Z"),
        id: "mailbox_ref_1",
        payloadInlineCiphertext: null,
        payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      })),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate({
      findFirst: vi.fn<HostedMailboxPayloadFindFirst>(async () => (
        buildHostedMailboxPayloadRow({
          mailboxItemId: "mailbox_ref_1",
          payloadCiphertext: "cipher_ref_1",
        })
      )),
    });
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await fetchHostedMailboxPayload({
      dedupeKey: "dedupe_1",
      mailboxItemId: "mailbox_ref_1",
      payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      prisma,
      requestId: "request_payload_1",
      userId: "member_mailbox_1",
    });

    expect(result).toMatchObject({
      payload: null,
      unavailable: {
        code: "expired",
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("cipher_ref_1");
    expect(hostedMailboxPayload.findFirst).not.toHaveBeenCalled();
  });

  it("does not return age-expired sidecar payload ciphertext", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => buildHostedMailboxItemRow({
        createdAt: new Date(Date.now() - HOSTED_MAILBOX_TEST_RETENTION_MS - DAY_MS),
        expiresAt: null,
        id: "mailbox_ref_1",
        payloadInlineCiphertext: null,
        payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      })),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate({
      findFirst: vi.fn<HostedMailboxPayloadFindFirst>(async () => (
        buildHostedMailboxPayloadRow({
          mailboxItemId: "mailbox_ref_1",
          payloadCiphertext: "cipher_ref_1",
        })
      )),
    });
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await fetchHostedMailboxPayload({
      dedupeKey: "dedupe_1",
      mailboxItemId: "mailbox_ref_1",
      payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      prisma,
      requestId: "request_payload_1",
      userId: "member_mailbox_1",
    });

    expect(result).toMatchObject({
      payload: null,
      unavailable: {
        code: "expired",
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("cipher_ref_1");
    expect(hostedMailboxPayload.findFirst).not.toHaveBeenCalled();
  });

  it("reports missing sidecar payload rows as retryable", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => buildHostedMailboxItemRow({
        createdAt: new Date(),
        id: "mailbox_ref_1",
        payloadInlineCiphertext: null,
        payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      })),
    });
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate({
      findFirst: vi.fn<HostedMailboxPayloadFindFirst>(async () => null),
    });
    const prisma = createHostedMailboxClient({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await fetchHostedMailboxPayload({
      dedupeKey: "dedupe_1",
      mailboxItemId: "mailbox_ref_1",
      payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      prisma,
      requestId: "request_payload_missing_1",
      userId: "member_mailbox_1",
    });

    expect(result).toMatchObject({
      payload: null,
      unavailable: {
        code: "not_found",
        retryable: true,
      },
    });
  });
});

describe("fetchHostedRuntimeMailboxProjection", () => {
  it("projects both requested lanes with one query while preserving item payload metadata", async () => {
    const queryRaw = vi.fn(async () => [
      {
        consumedSeq: 11n,
        itemConsumedAt: new Date("2026-04-26T00:00:04.000Z"),
        itemCreatedAt: new Date("2026-04-26T00:00:01.000Z"),
        itemDedupeKey: "conversation-dedupe-1",
        itemExpiresAt: null,
        itemId: "mailbox_conversation_12",
        itemKind: "member.channels.updated",
        itemLane: "conversation",
        itemLaneSeq: 12n,
        itemOccurredAt: new Date("2026-04-26T00:00:00.000Z"),
        itemPayloadBytes: 64,
        itemPayloadHash: "hash-conversation-12",
        itemPayloadInlineCiphertext: "cipher-conversation-12",
        itemPayloadRef: null,
        itemPayloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        itemUpdatedAt: new Date("2026-04-26T00:00:02.000Z"),
        itemUserId: "member_mailbox_1",
        maxSeq: 12n,
        maxUpdatedAt: new Date("2026-04-26T00:00:02.000Z"),
        requestedLane: "conversation",
      },
      {
        consumedSeq: 2n,
        itemConsumedAt: null,
        itemCreatedAt: new Date("2026-04-26T00:00:03.000Z"),
        itemDedupeKey: "system-dedupe-3",
        itemExpiresAt: null,
        itemId: "mailbox_system_3",
        itemKind: "runtime.manual-requested",
        itemLane: "system",
        itemLaneSeq: 3n,
        itemOccurredAt: new Date("2026-04-26T00:00:03.000Z"),
        itemPayloadBytes: 128_001,
        itemPayloadHash: "hash-system-3",
        itemPayloadInlineCiphertext: null,
        itemPayloadRef: "hosted-mailbox-payload:mailbox_system_3",
        itemPayloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        itemUpdatedAt: new Date("2026-04-26T00:00:04.000Z"),
        itemUserId: "member_mailbox_1",
        maxSeq: 3n,
        maxUpdatedAt: new Date("2026-04-26T00:00:04.000Z"),
        requestedLane: "system",
      },
    ]);
    const prisma = createHostedMailboxClient({
      hostedMailboxItem: createHostedMailboxItemDelegate(),
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
      queryRaw,
    });

    const result = await fetchHostedRuntimeMailboxProjection({
      cursorMode: "imported_seq",
      lanes: [
        { importedSeq: "11", lane: "conversation" },
        { importedSeq: "2", lane: "system" },
      ],
      limitPerLane: 10,
      now: FIXED_NOW,
      prisma,
      userId: "member_mailbox_1",
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.consumedSeqByLane).toEqual([
      { consumedSeq: "11", lane: "conversation" },
      { consumedSeq: "2", lane: "system" },
    ]);
    expect(result.maxSeqByLane).toEqual([
      {
        lane: "conversation",
        maxSeq: "12",
        maxUpdatedAt: "2026-04-26T00:00:02.000Z",
      },
      {
        lane: "system",
        maxSeq: "3",
        maxUpdatedAt: "2026-04-26T00:00:04.000Z",
      },
    ]);
    expect(result.items).toMatchObject([
      {
        consumedAt: "2026-04-26T00:00:04.000Z",
        id: "mailbox_conversation_12",
        laneSeq: "12",
        payloadInlineCiphertext: "cipher-conversation-12",
        payloadRef: null,
      },
      {
        consumedAt: null,
        id: "mailbox_system_3",
        laneSeq: "3",
        payloadInlineCiphertext: null,
        payloadRef: "hosted-mailbox-payload:mailbox_system_3",
      },
    ]);
  });

  it("keeps runtime mailbox projection read-only when a Linq route changed", async () => {
    restoreDefaultHostedSecureBoxTestCodec();
    const sourceUserId = "member_personal";
    const containerUserId = "member_container";
    const sourceWake = {
      eventId: "evt_group_transition",
      kind: "conversation.message",
      message: {
        channel: "linq",
        contactKind: "phone",
        contactLookupKey: "hbidx:phone:v1:sender",
        linqMessage: {
          chatId: "chat_group_transition",
          from: "+15551234567",
          isFromMe: false,
          messageId: "message_group_transition",
          parts: [{ type: "text", value: "hello group" }],
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-04-26T00:00:00.000Z",
      userId: sourceUserId,
    };
    const sourceCiphertext = buildHostedMailboxDefaultTestCiphertext({
      userId: sourceUserId,
      value: JSON.stringify(sourceWake),
    });
    const sourceRow = {
      consumedSeq: 0n,
      itemConsumedAt: new Date("2026-04-26T00:00:04.000Z"),
      itemCreatedAt: new Date("2026-04-26T00:00:01.000Z"),
      itemDedupeKey: sourceWake.eventId,
      itemExpiresAt: null,
      itemId: "mailbox_personal_group_transition",
      itemKind: "conversation.message",
      itemLane: "conversation",
      itemLaneSeq: 1n,
      itemOccurredAt: new Date(sourceWake.occurredAt),
      itemPayloadBytes: Buffer.byteLength(JSON.stringify(sourceWake), "utf8"),
      itemPayloadHash: "hash-personal-group-transition",
      itemPayloadInlineCiphertext: sourceCiphertext,
      itemPayloadRef: null,
      itemPayloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      itemUpdatedAt: new Date("2026-04-26T00:00:02.000Z"),
      itemUserId: sourceUserId,
      maxSeq: 1n,
      maxUpdatedAt: new Date("2026-04-26T00:00:02.000Z"),
      requestedLane: "conversation",
    };
    const emptySourceProjection = {
      consumedSeq: 0n,
      itemConsumedAt: null,
      itemCreatedAt: null,
      itemDedupeKey: null,
      itemExpiresAt: null,
      itemId: null,
      itemKind: null,
      itemLane: null,
      itemLaneSeq: null,
      itemOccurredAt: null,
      itemPayloadBytes: null,
      itemPayloadHash: null,
      itemPayloadInlineCiphertext: null,
      itemPayloadRef: null,
      itemPayloadSchema: null,
      itemUpdatedAt: null,
      itemUserId: null,
      maxSeq: 0n,
      maxUpdatedAt: null,
      requestedLane: "conversation",
    };
    const queryRaw = vi.fn(async (...args: unknown[]) => {
      switch (queryRaw.mock.calls.length) {
        case 1:
          return [sourceRow];
        case 2:
          return [{ seq: 1n }];
        case 3: {
          const values = args.slice(1);
          return [buildHostedMailboxItemRow({
            createdAt: FIXED_NOW,
            dedupeKey: String(values[4]),
            expiresAt: values[12] as Date | null,
            id: String(values[0]),
            kind: String(values[5]),
            lane: String(values[2]),
            laneSeq: values[3] as bigint,
            occurredAt: values[6] as Date,
            payloadBytes: values[10] as number,
            payloadHash: values[11] as string,
            payloadInlineCiphertext: values[8] as string,
            payloadRef: values[9] as string | null,
            payloadSchema: String(values[7]),
            updatedAt: FIXED_NOW,
            userId: String(values[1]),
          })];
        }
        case 4:
          return [emptySourceProjection];
        default:
          throw new Error("Unexpected hosted mailbox rehome query.");
      }
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const routeTimestamp = new Date("2026-04-01T00:00:00.000Z");
    const tx = Object.assign(Object.create(null), {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: queryRaw,
      hostedMailboxItem: {
        deleteMany,
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany,
      },
      hostedMailboxPayload: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedThreadRoute: {
        findFirst: vi.fn().mockResolvedValue({
          containerMemberId: containerUserId,
        }),
        findMany: vi.fn().mockResolvedValue([{
          channel: "linq",
          container: {
            member: {
              billingStatus: "inactive",
              createdAt: routeTimestamp,
              id: containerUserId,
              suspendedAt: null,
              updatedAt: routeTimestamp,
            },
            owner: {
              accountGroupMemberships: [],
              billingStatus: "active",
              createdAt: routeTimestamp,
              id: "member_owner",
              suspendedAt: null,
              updatedAt: routeTimestamp,
            },
          },
          containerMemberId: containerUserId,
        }]),
      },
      hostedWorkspace: {
        upsert: vi.fn().mockResolvedValue(null),
      },
    });
    const transaction = vi.fn(async (
      operation: (transactionClient: typeof tx) => Promise<unknown>,
    ) => operation(tx));
    const prisma = Object.assign(Object.create(null), {
      $transaction: transaction,
    }) as never;

    const result = await fetchHostedRuntimeMailboxProjection({
      lanes: [{ importedSeq: "0", lane: "conversation" }],
      limitPerLane: 10,
      now: FIXED_NOW,
      prisma,
      userId: sourceUserId,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result.items).toMatchObject([{
      consumedAt: sourceRow.itemConsumedAt.toISOString(),
      id: sourceRow.itemId,
      payloadInlineCiphertext: sourceCiphertext,
      userId: sourceUserId,
    }]);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(tx.hostedMailboxPayload.findUnique).not.toHaveBeenCalled();
    expect(tx.hostedThreadRoute.findFirst).not.toHaveBeenCalled();
    expect(tx.hostedThreadRoute.findMany).not.toHaveBeenCalled();
  });

  it("returns lane sentinels and rejects duplicate lane projections before querying", async () => {
    const queryRaw = vi.fn(async () => [{
      consumedSeq: 14n,
      itemConsumedAt: null,
      itemCreatedAt: null,
      itemDedupeKey: null,
      itemExpiresAt: null,
      itemId: null,
      itemKind: null,
      itemLane: null,
      itemLaneSeq: null,
      itemOccurredAt: null,
      itemPayloadBytes: null,
      itemPayloadHash: null,
      itemPayloadInlineCiphertext: null,
      itemPayloadRef: null,
      itemPayloadSchema: null,
      itemUpdatedAt: null,
      itemUserId: null,
      maxSeq: 0n,
      maxUpdatedAt: null,
      requestedLane: "conversation",
    }]);
    const prisma = createHostedMailboxClient({
      hostedMailboxItem: createHostedMailboxItemDelegate(),
      hostedMailboxPayload: createHostedMailboxPayloadDelegate(),
      queryRaw,
    });

    await expect(fetchHostedRuntimeMailboxProjection({
      lanes: [
        { importedSeq: "14", lane: "conversation" },
        { importedSeq: "15", lane: "conversation" },
      ],
      limitPerLane: 10,
      now: FIXED_NOW,
      prisma,
      userId: "member_mailbox_1",
    })).rejects.toThrow("requested more than once");
    expect(queryRaw).not.toHaveBeenCalled();

    const result = await fetchHostedRuntimeMailboxProjection({
      lanes: [{ importedSeq: "14", lane: "conversation" }],
      limitPerLane: 10,
      now: FIXED_NOW,
      prisma,
      userId: "member_mailbox_1",
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      consumedSeqByLane: [{ consumedSeq: "14", lane: "conversation" }],
      items: [],
      maxSeqByLane: [{ lane: "conversation", maxSeq: "0", maxUpdatedAt: null }],
    });
  });
});

interface HostedMailboxCreateArgs {
  data: {
    assistantInputLookupKey: string | null;
    causalSeq: bigint;
    dedupeKey: string;
    expiresAt: Date | null;
    id: string;
    kind: string;
    lane: string;
    laneSeq: bigint;
    occurredAt: Date;
    payloadBytes: number;
    payloadHash: string | null;
    payloadInlineCiphertext: string | null;
    payloadRef: string | null;
    payloadSchema: string;
    sourceMessageLookupKey: string | null;
    userId: string;
  };
}

interface HostedMailboxPayloadCreateArgs {
  data: {
    mailboxItemId: string;
    payloadCiphertext: string;
    payloadSchema: string;
    userId: string;
  };
}

interface HostedMailboxFindManyArgs {
  orderBy: {
    laneSeq: "asc";
  };
  take: number;
  where: {
    lane: string;
    laneSeq: {
      gt: bigint;
    };
    userId: string;
  };
}

type HostedMailboxCreate = (args: HostedMailboxCreateArgs) => Promise<HostedMailboxItemRow>;
type HostedMailboxItemFindFirst = (args: unknown) => Promise<HostedMailboxItemRow | null>;
type HostedMailboxFindMany = (args: HostedMailboxFindManyArgs) => Promise<HostedMailboxItemRow[]>;
type HostedMailboxFindUnique = (args: unknown) => Promise<HostedMailboxItemRow | null>;
type HostedMailboxPayloadCreate = (args: HostedMailboxPayloadCreateArgs) => Promise<void>;
type HostedMailboxPayloadFindFirst = (args: unknown) => Promise<HostedMailboxPayloadRow | null>;
type HostedMailboxPayloadFindMany = (args: unknown) => Promise<HostedMailboxPayloadRow[]>;
type HostedMailboxPayloadFindUnique = (args: unknown) => Promise<HostedMailboxPayloadRow | null>;

function buildHostedMailboxItemRow(
  overrides: Partial<HostedMailboxItemRow> = {},
): HostedMailboxItemRow {
  return {
    assistantInputLookupKey: null,
    causalSeq: 1n,
    createdAt: FIXED_NOW,
    consumedAt: null,
    dedupeKey: "dedupe_1",
    expiresAt: null,
    id: "mailbox_1",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: 1n,
    occurredAt: FIXED_NOW,
    payloadBytes: 64,
    payloadHash: null,
    payloadInlineCiphertext: "cipher_inline_1",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    sourceMessageLookupKey: null,
    updatedAt: FIXED_NOW,
    userId: "member_mailbox_1",
    ...overrides,
  };
}

function readHostedMailboxFindUniqueWhere(args: unknown): {
  dedupeKey: string;
  userId: string;
} {
  if (!args || typeof args !== "object" || !("where" in args)) {
    throw new TypeError("Expected hosted mailbox findUnique where input.");
  }

  const where = (args as { where?: unknown }).where;

  if (!where || typeof where !== "object" || !("userId_dedupeKey" in where)) {
    throw new TypeError("Expected hosted mailbox findUnique userId_dedupeKey input.");
  }

  const unique = (where as { userId_dedupeKey?: unknown }).userId_dedupeKey;

  if (!unique || typeof unique !== "object") {
    throw new TypeError("Expected hosted mailbox findUnique userId_dedupeKey values.");
  }

  const dedupeKey = (unique as { dedupeKey?: unknown }).dedupeKey;
  const userId = (unique as { userId?: unknown }).userId;

  if (typeof dedupeKey !== "string" || typeof userId !== "string") {
    throw new TypeError("Expected hosted mailbox findUnique string keys.");
  }

  return { dedupeKey, userId };
}

function buildHostedMailboxPayloadRow(
  overrides: Partial<HostedMailboxPayloadRow> = {},
): HostedMailboxPayloadRow {
  return {
    createdAt: FIXED_NOW,
    mailboxItemId: "mailbox_1",
    payloadCiphertext: "cipher_ref_default",
    payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
    userId: "member_mailbox_1",
    ...overrides,
  };
}

function createHostedMailboxItemDelegate(overrides: Partial<{
  create: ReturnType<typeof vi.fn<HostedMailboxCreate>>;
  findFirst: ReturnType<typeof vi.fn<HostedMailboxItemFindFirst>>;
  findMany: ReturnType<typeof vi.fn<HostedMailboxFindMany>>;
  findUnique: ReturnType<typeof vi.fn<HostedMailboxFindUnique>>;
}> = {}) {
  return {
    create: vi.fn<HostedMailboxCreate>(async (args) => buildHostedMailboxItemRow(args.data)),
    findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => null),
    findMany: vi.fn<HostedMailboxFindMany>(async () => []),
    findUnique: vi.fn<HostedMailboxFindUnique>(async () => null),
    ...overrides,
  };
}

function createHostedMailboxPayloadDelegate(overrides: Partial<{
  create: ReturnType<typeof vi.fn<HostedMailboxPayloadCreate>>;
  findFirst: ReturnType<typeof vi.fn<HostedMailboxPayloadFindFirst>>;
  findMany: ReturnType<typeof vi.fn<HostedMailboxPayloadFindMany>>;
  findUnique: ReturnType<typeof vi.fn<HostedMailboxPayloadFindUnique>>;
}> = {}) {
  const rows: HostedMailboxPayloadRow[] = [];

  return {
    create: vi.fn<HostedMailboxPayloadCreate>(async (args) => {
      rows.push(buildHostedMailboxPayloadRow(args.data));
    }),
    findFirst: vi.fn<HostedMailboxPayloadFindFirst>(async () => rows[0] ?? null),
    findMany: vi.fn<HostedMailboxPayloadFindMany>(async () => rows),
    findUnique: vi.fn<HostedMailboxPayloadFindUnique>(async () => rows[0] ?? null),
    ...overrides,
  };
}

function createHostedMailboxTx(input: {
  hostedGroup?: { findUnique: ReturnType<typeof vi.fn> };
  hostedMailboxItem: ReturnType<typeof createHostedMailboxItemDelegate>;
  hostedMailboxLaneCounter?: { findUnique: ReturnType<typeof vi.fn> };
  hostedMailboxPayload: ReturnType<typeof createHostedMailboxPayloadDelegate>;
  hostedThreadContainer?: { findUnique: ReturnType<typeof vi.fn> };
  hostedThreadRoute?: { findFirst: ReturnType<typeof vi.fn> };
}) {
  return Object.assign(Object.create(null), {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("hosted_mailbox_lane_counter")) {
        return [{ seq: 1n }];
      }

      if (sql.includes("INSERT INTO hosted_mailbox_item")) {
        const row = await input.hostedMailboxItem.create({
          data: {
            id: String(values[0]),
            userId: String(values[1]),
            assistantInputLookupKey: values[2] as string | null,
            sourceMessageLookupKey: values[3] as string | null,
            causalSeq: values[4] as bigint,
            lane: String(values[5]),
            laneSeq: values[6] as bigint,
            dedupeKey: String(values[7]),
            kind: String(values[8]),
            occurredAt: values[9] as Date,
            payloadSchema: String(values[10]),
            payloadInlineCiphertext: values[11] as string | null,
            payloadRef: values[12] as string | null,
            payloadBytes: values[13] as number,
            payloadHash: values[14] as string | null,
            expiresAt: values[15] as Date | null,
          },
        });
        return [row];
      }

      throw new Error(`Unexpected hosted mailbox query: ${sql}`);
    }),
    hostedMailboxItem: input.hostedMailboxItem,
    hostedMailboxLaneCounter: input.hostedMailboxLaneCounter ?? {
      findUnique: vi.fn(async () => null),
    },
    hostedMailboxPayload: input.hostedMailboxPayload,
    hostedGroup: input.hostedGroup ?? {
      findUnique: vi.fn(async () => null),
    },
    hostedThreadContainer: input.hostedThreadContainer ?? {
      findUnique: vi.fn(async () => null),
    },
    hostedThreadRoute: input.hostedThreadRoute ?? {
      findFirst: vi.fn(async () => null),
    },
    hostedWorkspace: {
      upsert: vi.fn(async () => null),
    },
  }) as Parameters<typeof appendHostedMailboxItemTx>[0]["tx"];
}

function buildHostedGroupLinqEnvelope(userId: string) {
  return {
    eventId: "linq-group-envelope-1",
    kind: "conversation.message" as const,
    message: {
      channel: "linq" as const,
      contactKind: "phone" as const,
      contactLookupKey: "hbidx:phone:v1:sender",
      linqMessage: {
        chatId: "chat_group_123",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_group_123",
        parts: [{ type: "text" as const, value: "hello group" }],
        threadIsDirect: false,
      },
      routeAuthority: {
        channel: "linq" as const,
        containerMemberId: userId,
        threadId: "chat_group_123",
      },
    },
    occurredAt: "2026-04-26T00:00:00.000Z",
    userId,
  };
}

function buildHostedGroupEmailEnvelope(userId: string) {
  return {
    eventId: "email-group-envelope-1",
    kind: "conversation.message" as const,
    message: {
      channel: "email" as const,
      identityId: "identity_123",
      rawMessageKey: "raw_group_123",
      threadTarget: serializeHostedEmailThreadTarget({
        groupId: "group_123",
        targetKind: "group",
      }),
    },
    occurredAt: "2026-04-26T00:00:00.000Z",
    userId,
  };
}

function buildHostedMealPhotoEnvelope(
  mealPhotoKey: string,
  directRoute: HostedExecutionDirectRoute = {
    channel: "linq",
    threadId: "linq_home_thread",
  },
) {
  return {
    directRoute,
    eventId: `meal-photo:hmp_enrollment:${"a".repeat(64)}`,
    kind: "meal-photo.captured" as const,
    mealPhoto: {
      byteLength: 4,
      captureId: "a".repeat(64),
      capturedAt: "2026-07-12T16:30:45.000Z",
      mealPhotoKey,
      sha256: "b".repeat(64),
    },
    occurredAt: "2026-07-12T16:30:45.000Z",
    userId: "member_mailbox_1",
  };
}

function buildHostedEnvironmentVoiceEnvelope(
  audioKey: string,
  capturedAt = "2026-07-30T12:00:00.000Z",
) {
  const captureId = "c".repeat(64);
  return buildHostedExecutionEnvironmentVoiceCapturedWake({
    audioKey,
    byteLength: 64_000,
    captureId,
    capturedAt,
    contentType: "audio/webm",
    durationMs: 12_000,
    eventId: `environment-voice:${captureId}`,
    memberId: "member_mailbox_1",
    occurredAt: capturedAt,
    sha256: captureId,
  });
}

function readHostedMailboxRawSql(call: unknown[] | undefined): string {
  const strings = call?.[0] as TemplateStringsArray | undefined;
  return strings ? strings.join("?") : "";
}

function createHostedMailboxClient(input: {
  hostedMailboxItem: ReturnType<typeof createHostedMailboxItemDelegate>;
  hostedMailboxPayload: ReturnType<typeof createHostedMailboxPayloadDelegate>;
  queryRaw?: ReturnType<typeof vi.fn>;
}) {
  return Object.assign(Object.create(null), {
    ...(input.queryRaw ? { $queryRaw: input.queryRaw } : {}),
    hostedMailboxItem: input.hostedMailboxItem,
    hostedMailboxPayload: input.hostedMailboxPayload,
  }) as Parameters<typeof fetchHostedMailboxItemsAfterLaneCursors>[0]["prisma"];
}

function installAadCheckingHostedSecureBoxTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = parseHostedSecureBoxAadTestPayload(input.value);
      const expectedAad = normalizeHostedSecureBoxTestValue(input.aad);
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || JSON.stringify(decoded.aad) !== JSON.stringify(expectedAad)
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box AAD mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      return `hsb-aad-test:${Buffer.from(JSON.stringify({
        aad: normalizeHostedSecureBoxTestValue(input.aad),
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}

function restoreDefaultHostedSecureBoxTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = parseHostedSecureBoxDefaultTestPayload(input.value);
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}

function buildHostedMailboxDefaultTestCiphertext(input: {
  userId: string;
  value: string;
}): string {
  return `hsb-test:${Buffer.from(JSON.stringify({
    lane: "mailbox-payload",
    scope: "hosted-mailbox-payload:hosted-mailbox-inline-payload",
    userId: input.userId,
    value: input.value,
  }), "utf8").toString("base64url")}`;
}

function parseHostedSecureBoxAadTestPayload(value: string): Record<string, unknown> {
  return parseHostedSecureBoxTestPayload(value, "hsb-aad-test:");
}

function parseHostedSecureBoxDefaultTestPayload(value: string): Record<string, unknown> {
  return parseHostedSecureBoxTestPayload(value, "hsb-test:");
}

function parseHostedSecureBoxTestPayload(
  value: string,
  prefix: "hsb-aad-test:" | "hsb-test:",
): Record<string, unknown> {
  if (!value.startsWith(prefix)) {
    throw new Error("Hosted secure-box test payload has an unexpected prefix.");
  }

  const decoded: unknown = JSON.parse(
    Buffer.from(value.slice(prefix.length), "base64url").toString("utf8"),
  );

  if (!decoded || typeof decoded !== "object") {
    throw new Error("Hosted secure-box test payload must be an object.");
  }

  return decoded as Record<string, unknown>;
}

function normalizeHostedSecureBoxTestValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeHostedSecureBoxTestValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeHostedSecureBoxTestValue(item)]),
    );
  }

  return value;
}

describe("advanceHostedMailboxConsumedSeqByLane", () => {
  function createLaneCounterClient(initialRow: {
    consumedSeq: bigint;
    nextSeq: bigint;
  } | null) {
    const state = initialRow ? { ...initialRow } : null;
    const findUnique = vi.fn(async () =>
      state
        ? {
            consumedSeq: state.consumedSeq,
            lane: "conversation",
            nextSeq: state.nextSeq,
            updatedAt: new Date("2026-06-10T00:00:00.000Z"),
            userId: "member_mailbox_1",
          }
        : null
    );
    const updateMany = vi.fn(async (args: { data: { consumedSeq: bigint } }) => {
      if (state && args.data.consumedSeq > state.consumedSeq) {
        state.consumedSeq = args.data.consumedSeq;
        return { count: 1 };
      }
      return { count: 0 };
    });
    const prisma = Object.assign(Object.create(null), {
      hostedMailboxLaneCounter: { findUnique, updateMany },
    }) as Parameters<typeof advanceHostedMailboxConsumedSeqByLane>[0]["prisma"];

    return { findUnique, prisma, updateMany };
  }

  it("clamps the requested seq to the lane append high-water", async () => {
    const { prisma, updateMany } = createLaneCounterClient({
      consumedSeq: 1n,
      nextSeq: 5n,
    });

    const result = await advanceHostedMailboxConsumedSeqByLane({
      lanes: [{ consumedSeq: "9".repeat(30), lane: "conversation" }],
      prisma,
      userId: "member_mailbox_1",
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { consumedSeq: 4n },
    });
    expect(result).toEqual([{ consumedSeq: "4", lane: "conversation" }]);
  });

  it("never moves the watermark backwards", async () => {
    const { prisma, updateMany } = createLaneCounterClient({
      consumedSeq: 3n,
      nextSeq: 5n,
    });

    const result = await advanceHostedMailboxConsumedSeqByLane({
      lanes: [{ consumedSeq: "2", lane: "conversation" }],
      prisma,
      userId: "member_mailbox_1",
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([{ consumedSeq: "3", lane: "conversation" }]);
  });

  it("treats a lane with no counter row as a no-op", async () => {
    const { prisma, updateMany } = createLaneCounterClient(null);

    const result = await advanceHostedMailboxConsumedSeqByLane({
      lanes: [{ consumedSeq: "7", lane: "conversation" }],
      prisma,
      userId: "member_mailbox_1",
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(result).toEqual([{ consumedSeq: "0", lane: "conversation" }]);
  });

  it("rejects duplicate lanes in one request", async () => {
    const { prisma } = createLaneCounterClient({
      consumedSeq: 0n,
      nextSeq: 5n,
    });

    await expect(advanceHostedMailboxConsumedSeqByLane({
      lanes: [
        { consumedSeq: "1", lane: "conversation" },
        { consumedSeq: "2", lane: "conversation" },
      ],
      prisma,
      userId: "member_mailbox_1",
    })).rejects.toThrow(/consumed more than once/u);
  });
});

describe("readHostedMailboxConsumedSeqByLane", () => {
  it("returns the stored watermark and zero for missing rows", async () => {
    const findUnique = vi.fn(async (args: {
      where: { userId_lane: { lane: string } };
    }) =>
      args.where.userId_lane.lane === "conversation"
        ? {
            consumedSeq: 6n,
            lane: "conversation",
            nextSeq: 9n,
            updatedAt: new Date("2026-06-10T00:00:00.000Z"),
            userId: "member_mailbox_1",
          }
        : null
    );
    const prisma = Object.assign(Object.create(null), {
      hostedMailboxItem: {
        findFirst: vi.fn(async () => buildHostedMailboxItemRow({
          lane: "conversation",
          laneSeq: 1n,
        })),
      },
      hostedMailboxLaneCounter: { findUnique },
    }) as Parameters<typeof readHostedMailboxConsumedSeqByLane>[0]["prisma"];

    const result = await readHostedMailboxConsumedSeqByLane({
      lanes: ["conversation", "system"],
      prisma,
      userId: "member_mailbox_1",
    });

    expect(result).toEqual([
      { consumedSeq: "6", lane: "conversation" },
      { consumedSeq: "0", lane: "system" },
    ]);
  });

  it("repairs a stale consumed floor to the row before the oldest retained item", async () => {
    const findUnique = vi.fn(async (args: {
      where: { userId_lane: { lane: string } };
    }) => ({
      consumedSeq: 13n,
      lane: args.where.userId_lane.lane,
      nextSeq: 16n,
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
      userId: "member_mailbox_1",
    }));
    const findFirst = vi.fn(async (args: {
      where: { lane: string };
    }) => buildHostedMailboxItemRow({
      id: `mailbox_retained_${args.where.lane}_15`,
      lane: args.where.lane,
      laneSeq: 15n,
    }));
    const prisma = Object.assign(Object.create(null), {
      hostedMailboxItem: { findFirst },
      hostedMailboxLaneCounter: { findUnique },
    }) as Parameters<typeof readHostedMailboxConsumedSeqByLane>[0]["prisma"];

    const result = await readHostedMailboxConsumedSeqByLane({
      lanes: ["conversation", "system"],
      prisma,
      userId: "member_mailbox_1",
    });

    expect(result).toEqual([
      { consumedSeq: "14", lane: "conversation" },
      { consumedSeq: "14", lane: "system" },
    ]);
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      orderBy: {
        laneSeq: "asc",
      },
      where: expectLiveHostedMailboxWhere({
        lane: "conversation",
        userId: "member_mailbox_1",
      }),
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      orderBy: {
        laneSeq: "asc",
      },
      where: expectLiveHostedMailboxWhere({
        lane: "system",
        userId: "member_mailbox_1",
      }),
    });
  });
});
