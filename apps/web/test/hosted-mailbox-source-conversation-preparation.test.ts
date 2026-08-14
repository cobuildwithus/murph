import { Prisma } from "@prisma/client";
import {
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mailboxCryptoMocks = vi.hoisted(() => ({
  decryptPrepared: vi.fn(),
  prewarmActiveRoot: vi.fn(),
  prewarmPayloads: vi.fn(),
}));

vi.mock("../src/lib/hosted-mailbox/encryption", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-mailbox/encryption")
  >();
  return {
    ...actual,
    decryptHostedMailboxPayloadStringsWithPreparedRoots:
      mailboxCryptoMocks.decryptPrepared,
    prewarmHostedMailboxPayloadActiveRoot:
      mailboxCryptoMocks.prewarmActiveRoot,
    prewarmHostedMailboxPayloadStrings:
      mailboxCryptoMocks.prewarmPayloads,
  };
});

import {
  HostedMailboxSourceConversationPreparationMismatchError,
  prewarmHostedMailboxSourceConversationPreparation,
  readHostedMailboxSourceConversationEntriesTx,
  readHostedMailboxSourceConversationPreparation,
  type HostedMailboxSourceConversationPreparation,
  type HostedMailboxSourceConversationPreparationRow,
} from "../src/lib/hosted-mailbox/store";

describe("hosted mailbox source-conversation preparation", () => {
  beforeEach(() => {
    mailboxCryptoMocks.decryptPrepared.mockReset();
    mailboxCryptoMocks.prewarmActiveRoot.mockReset();
    mailboxCryptoMocks.prewarmPayloads.mockReset();
    mailboxCryptoMocks.decryptPrepared.mockResolvedValue([]);
    mailboxCryptoMocks.prewarmActiveRoot.mockResolvedValue(undefined);
    mailboxCryptoMocks.prewarmPayloads.mockResolvedValue(undefined);
  });

  it("uses one max-seven item-plus-sidecar set read and caps privacy-version keys at two", async () => {
    const rows = Array.from({ length: 7 }, (_, index) =>
      buildSourceRow({ index, storage: "sidecar" }));
    const queryRaw = vi.fn().mockResolvedValue(rows);

    const preparation = await readHostedMailboxSourceConversationPreparation({
      preparedAt: new Date("2026-08-11T10:00:00.000Z"),
      prisma: { $queryRaw: queryRaw } as never,
      sourceMessageLookupKeys: ["source:v2", "source:v1", "source:v2"],
    });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(preparation.rows).toEqual(rows);
    expect(preparation.sourceMessageLookupKeys).toEqual([
      "source:v1",
      "source:v2",
    ]);
    const query = requirePrismaSql(queryRaw.mock.calls[0]?.[0]);
    expect(query.strings.join("?")).toContain(
      "LEFT JOIN hosted_mailbox_payload AS payload",
    );
    expect(query.strings.join("?")).toContain(
      "ORDER BY item.causal_seq ASC NULLS FIRST, item.id ASC",
    );
    expect(query.strings.join("?")).toContain("LIMIT ?");
    expect(query.values).toEqual([
      "hosted-mailbox-payload:",
      "source:v1",
      "source:v2",
      7,
    ]);

    await expect(readHostedMailboxSourceConversationPreparation({
      prisma: { $queryRaw: vi.fn() } as never,
      sourceMessageLookupKeys: ["source:v3", "source:v2", "source:v1"],
    })).rejects.toThrow(/at most 2 privacy versions/u);
  });

  it("prewarms all exact roots before the possible append root and drains both branches", async () => {
    const exactRootsStarted = createDeferred();
    const releaseExactRoots = createDeferred();
    const appendRootStarted = createDeferred();
    mailboxCryptoMocks.prewarmPayloads.mockImplementation(async () => {
      exactRootsStarted.resolve();
      await releaseExactRoots.promise;
    });
    mailboxCryptoMocks.prewarmActiveRoot.mockImplementation(async () => {
      appendRootStarted.resolve();
    });
    const preparation = buildPreparation(
      Array.from({ length: 6 }, (_, index) => buildSourceRow({ index })),
    );

    const prewarm = prewarmHostedMailboxSourceConversationPreparation({
      preparation,
      prisma: {} as never,
    });
    await exactRootsStarted.promise;
    expect(mailboxCryptoMocks.prewarmPayloads).toHaveBeenCalledOnce();
    expect(mailboxCryptoMocks.prewarmPayloads.mock.calls[0]?.[0].entries)
      .toHaveLength(6);
    expect(mailboxCryptoMocks.prewarmActiveRoot).not.toHaveBeenCalled();

    releaseExactRoots.resolve();
    await appendRootStarted.promise;
    await expect(prewarm).resolves.toBeUndefined();
    expect(mailboxCryptoMocks.prewarmActiveRoot).toHaveBeenCalledWith({
      prisma: {},
      userId: "member_source_owner",
    });
  });

  it("attempts the append-root preparation after an exact-root failure and preserves the first failure", async () => {
    const exactFailure = new Error("Exact source-root preparation failed.");
    const appendFailure = new Error("Active append-root preparation failed.");
    mailboxCryptoMocks.prewarmPayloads.mockRejectedValueOnce(exactFailure);
    mailboxCryptoMocks.prewarmActiveRoot.mockRejectedValueOnce(appendFailure);

    await expect(prewarmHostedMailboxSourceConversationPreparation({
      preparation: buildPreparation([buildSourceRow({ index: 0 })]),
      prisma: {} as never,
    })).rejects.toBe(exactFailure);

    expect(mailboxCryptoMocks.prewarmPayloads).toHaveBeenCalledOnce();
    expect(mailboxCryptoMocks.prewarmActiveRoot).toHaveBeenCalledOnce();
  });

  it("does not prepare an append root for the seventh lineage row", async () => {
    const preparation = buildPreparation(
      Array.from({ length: 7 }, (_, index) =>
        buildSourceRow({ index, storage: "sidecar" })),
    );

    await expect(prewarmHostedMailboxSourceConversationPreparation({
      preparation,
      prisma: {} as never,
    })).resolves.toBeUndefined();

    expect(mailboxCryptoMocks.prewarmPayloads.mock.calls[0]?.[0].entries)
      .toHaveLength(7);
    expect(mailboxCryptoMocks.prewarmActiveRoot).not.toHaveBeenCalled();
  });

  it("reacquires sorted locks and rejects an exact snapshot mismatch before decrypt", async () => {
    const preparedRows = [
      buildSourceRow({ index: 0, sourceMessageLookupKey: "source:v2" }),
      buildSourceRow({
        index: 1,
        sourceMessageLookupKey: "source:v1",
        storage: "sidecar",
      }),
    ];
    const currentRows = preparedRows.map((row, index) =>
      index === 1
        ? { ...row, sidecarPayloadCiphertext: "changed-sidecar-ciphertext" }
        : row
    );
    const calls: string[] = [];
    const executeRaw = vi.fn(async (
      _strings: TemplateStringsArray,
      sourceMessageLookupKey: string,
    ) => {
      calls.push(`lock:${sourceMessageLookupKey}`);
      return 1;
    });
    const queryRaw = vi.fn(async () => {
      calls.push("set-read");
      return currentRows;
    });

    await expect(readHostedMailboxSourceConversationEntriesTx({
      preparation: buildPreparation(preparedRows),
      sourceMessageLookupKeys: ["source:v2", "source:v1"],
      tx: { $executeRaw: executeRaw, $queryRaw: queryRaw } as never,
    })).rejects.toBeInstanceOf(
      HostedMailboxSourceConversationPreparationMismatchError,
    );

    expect(calls).toEqual([
      "lock:source:v1",
      "lock:source:v2",
      "set-read",
    ]);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(mailboxCryptoMocks.decryptPrepared).not.toHaveBeenCalled();
  });

  it("decrypts a stable lineage in one prepared batch without row or sidecar rereads", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      accountLookupKey: "account-lookup",
      contactKind: "phone",
      contactLookupKey: "contact-lookup",
      eventId: "event-source-original",
      linqMessage: {
        chatId: "chat-source-original",
        from: "+15551112222",
        isFromMe: false,
        messageId: "message-source-original",
        parts: [{ type: "text", value: "Original wording" }],
        service: "iMessage",
        threadIsDirect: true,
      },
      occurredAt: "2026-08-11T10:00:00.000Z",
      phoneLookupKey: "contact-lookup",
      userId: "member_source_owner",
    });
    const rows = [buildSourceRow({ index: 0 })];
    mailboxCryptoMocks.decryptPrepared.mockResolvedValue([
      JSON.stringify(wake),
    ]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn().mockResolvedValue(rows);

    await expect(readHostedMailboxSourceConversationEntriesTx({
      preparation: buildPreparation(rows),
      sourceMessageLookupKeys: ["source:v1"],
      tx: { $executeRaw: executeRaw, $queryRaw: queryRaw } as never,
    })).resolves.toMatchObject([{
      contentAvailable: true,
      itemId: "mailbox-item-1",
      userId: "member_source_owner",
      wake: {
        eventId: "event-source-original",
        message: {
          linqMessage: {
            messageId: "message-source-original",
          },
        },
      },
    }]);

    expect(executeRaw).toHaveBeenCalledOnce();
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(mailboxCryptoMocks.decryptPrepared).toHaveBeenCalledOnce();
    expect(mailboxCryptoMocks.decryptPrepared.mock.calls[0]?.[0].entries)
      .toEqual([expect.objectContaining({
        dedupeKey: "mailbox-dedupe-1",
        itemId: "mailbox-item-1",
        payloadSchema: "murph.hosted-mailbox-item.v1",
        payloadStorage: "inline",
        userId: "member_source_owner",
        value: "inline-ciphertext-1",
      })]);
  });
});

function buildPreparation(
  rows: readonly HostedMailboxSourceConversationPreparationRow[],
): HostedMailboxSourceConversationPreparation {
  return {
    preparedAt: new Date(),
    rows,
    sourceMessageLookupKeys: [...new Set(
      rows.flatMap((row) => row.sourceMessageLookupKey ?? []),
    )].sort(),
  };
}

function buildSourceRow(input: {
  index: number;
  sourceMessageLookupKey?: string;
  storage?: "inline" | "sidecar";
}): HostedMailboxSourceConversationPreparationRow {
  const ordinal = input.index + 1;
  const itemId = `mailbox-item-${ordinal}`;
  const storage = input.storage ?? "inline";
  const occurredAt = new Date(Date.now() - 60_000 + input.index * 1_000);
  return {
    causalSeq: BigInt(ordinal),
    createdAt: occurredAt,
    dedupeKey: `mailbox-dedupe-${ordinal}`,
    expiresAt: null,
    itemId,
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: BigInt(ordinal),
    occurredAt,
    payloadInlineCiphertext:
      storage === "inline" ? `inline-ciphertext-${ordinal}` : null,
    payloadRef:
      storage === "sidecar" ? `hosted-mailbox-payload:${itemId}` : null,
    payloadSchema: "murph.hosted-mailbox-item.v1",
    sidecarMailboxItemId: storage === "sidecar" ? itemId : null,
    sidecarPayloadCiphertext:
      storage === "sidecar" ? `sidecar-ciphertext-${ordinal}` : null,
    sidecarPayloadSchema:
      storage === "sidecar" ? "murph.hosted-mailbox-payload.v1" : null,
    sidecarUserId: storage === "sidecar" ? "member_source_owner" : null,
    sourceMessageLookupKey:
      input.sourceMessageLookupKey ?? "source:v1",
    userId: "member_source_owner",
  };
}

function requirePrismaSql(value: unknown): Prisma.Sql {
  if (
    !value
    || typeof value !== "object"
    || !("strings" in value)
    || !("values" in value)
  ) {
    throw new Error("Expected a Prisma.Sql query.");
  }
  return value as Prisma.Sql;
}

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
