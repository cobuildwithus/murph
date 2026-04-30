import { describe, expect, it, vi } from "vitest";

import {
  appendHostedMailboxEnvelopeTx,
  appendHostedMailboxItemTx,
  fetchHostedMailboxPayload,
  fetchHostedMailboxItemsAfterLaneCursors,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  readHostedMailboxMaxSeqByLane,
  type HostedMailboxItemRow,
  type HostedMailboxPayloadRow,
} from "@/src/lib/hosted-mailbox/store";

const FIXED_NOW = new Date("2026-04-26T00:00:00.000Z");
const MAILBOX_REF_1_PAYLOAD_REF = "hosted-mailbox-payload:mailbox_ref_1";

describe("appendHostedMailboxItemTx", () => {
  it("allocates a lane sequence and stores small opaque payload ciphertext inline", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await appendHostedMailboxItemTx({
      dedupeKey: "dedupe_inline_1",
      kind: "conversation.message",
      lane: "conversation",
      occurredAt: "2026-04-26T00:00:00.000Z",
      payloadBytes: 64,
      payloadInlineCiphertext: "cipher_inline_1",
      tx,
      userId: "member_mailbox_1",
    });

    expect(result).toMatchObject({
      duplicate: false,
      dedupeConflict: false,
      inserted: true,
      item: {
        dedupeKey: "dedupe_inline_1",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: "1",
        payloadInlineCiphertext: "cipher_inline_1",
        payloadRef: null,
      },
    });
    expect(hostedMailboxItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dedupeKey: "dedupe_inline_1",
        kind: "conversation.message",
        lane: "conversation",
        laneSeq: 1n,
        payloadBytes: 64,
        payloadInlineCiphertext: "cipher_inline_1",
        payloadRef: null,
        payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        userId: "member_mailbox_1",
      }),
    });
    expect(hostedMailboxPayload.create).not.toHaveBeenCalled();
    expect(tx.hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        component: "mailbox",
        eventCode: "mailbox.appended",
        level: "info",
        mailboxLane: "conversation",
        mailboxSeqEnd: 1n,
        mailboxSeqStart: 1n,
        phase: "import",
        redactedJson: expect.objectContaining({
          bytes: 64,
          dedupeKeyPresent: true,
          duplicate: false,
          inserted: true,
          kind: "conversation.message",
          schema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
          storage: "inline",
        }),
        userId: "member_mailbox_1",
      }),
    });
  });

  it("stores oversized opaque payload ciphertext in the payload table", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate();
    const hostedMailboxPayload = createHostedMailboxPayloadDelegate();
    const tx = createHostedMailboxTx({
      hostedMailboxItem,
      hostedMailboxPayload,
    });

    const result = await appendHostedMailboxItemTx({
      dedupeKey: "dedupe_ref_1",
      kind: "assistant.notification.requested",
      lane: "system",
      occurredAt: FIXED_NOW,
      payloadBytes: 128_000,
      payloadCiphertext: "cipher_ref_1",
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
    expect(result.item.payloadRef).toBe(`hosted-mailbox-payload:${result.item.id}`);
    expect(hostedMailboxPayload.create).toHaveBeenCalledWith({
      data: {
        mailboxItemId: result.item.id,
        payloadCiphertext: "cipher_ref_1",
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        userId: "member_mailbox_1",
      },
    });
  });

  it("returns the first item for duplicate dedupe keys without rewriting payload storage", async () => {
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
      payloadBytes: 256,
      payloadInlineCiphertext: "cipher_retry_1",
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
    expect(tx.hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        component: "mailbox",
        eventCode: "mailbox.dedupe_conflict",
        level: "warn",
        mailboxLane: "conversation",
        mailboxSeqEnd: 1n,
        mailboxSeqStart: 1n,
        phase: "import",
        redactedJson: expect.objectContaining({
          existingKind: "conversation.message",
          requestedKind: "member.activated",
        }),
        userId: "member_mailbox_1",
      }),
    });
    expect(tx.hostedRuntimeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        component: "mailbox",
        eventCode: "mailbox.appended",
        level: "info",
        mailboxLane: "conversation",
        mailboxSeqEnd: 1n,
        mailboxSeqStart: 1n,
        phase: "import",
        redactedJson: expect.objectContaining({
          duplicate: true,
          inserted: false,
          kind: "conversation.message",
          storage: "inline",
        }),
        userId: "member_mailbox_1",
      }),
    });
    expect(hostedMailboxItem.create).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.create).not.toHaveBeenCalled();
  });
});

describe("appendHostedMailboxEnvelopeTx", () => {
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
});

describe("fetchHostedMailboxItemsAfterLaneCursors", () => {
  it("fetches each lane after the imported cursor without hydrating sidecar payloads", async () => {
    const conversationRef = buildHostedMailboxItemRow({
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
      prisma,
      userId: "member_mailbox_1",
    });

    expect(hostedMailboxItem.findMany).toHaveBeenNthCalledWith(1, {
      orderBy: {
        laneSeq: "asc",
      },
      take: 2,
      where: {
        lane: "conversation",
        laneSeq: {
          gt: 11n,
        },
        userId: "member_mailbox_1",
      },
    });
    expect(hostedMailboxItem.findMany).toHaveBeenNthCalledWith(2, {
      orderBy: {
        laneSeq: "asc",
      },
      take: 2,
      where: {
        lane: "system",
        laneSeq: {
          gt: 2n,
        },
        userId: "member_mailbox_1",
      },
    });
    expect(result.items.map((item) => ({
      id: item.id,
      payloadInlineCiphertext: item.payloadInlineCiphertext,
      payloadRef: item.payloadRef,
    }))).toEqual([
      {
        id: "mailbox_ref_1",
        payloadInlineCiphertext: null,
        payloadRef: MAILBOX_REF_1_PAYLOAD_REF,
      },
      {
        id: "mailbox_inline_2",
        payloadInlineCiphertext: "cipher_inline_2",
        payloadRef: null,
      },
      {
        id: "mailbox_system_1",
        payloadInlineCiphertext: "cipher_system_1",
        payloadRef: null,
      },
    ]);
    expect(hostedMailboxPayload.findFirst).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.findMany).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.findUnique).not.toHaveBeenCalled();
  });

  it("returns expired rows in lane order so runtime import can preserve a strict prefix", async () => {
    const expiredSeq1 = buildHostedMailboxItemRow({
      expiresAt: new Date("2026-04-25T00:00:00.000Z"),
      id: "mailbox_expired_1",
      lane: "conversation",
      laneSeq: 1n,
      payloadInlineCiphertext: "cipher_expired_1",
    });
    const liveSeq2 = buildHostedMailboxItemRow({
      expiresAt: new Date("2026-04-27T00:00:00.000Z"),
      id: "mailbox_live_2",
      lane: "conversation",
      laneSeq: 2n,
      payloadInlineCiphertext: "cipher_live_2",
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findMany: vi.fn<HostedMailboxFindMany>(async () => [expiredSeq1, liveSeq2]),
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
      prisma,
      userId: "member_mailbox_1",
    });

    expect(hostedMailboxItem.findMany).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "asc",
      },
      take: 10,
      where: {
        lane: "conversation",
        laneSeq: {
          gt: 0n,
        },
        userId: "member_mailbox_1",
      },
    });
    expect(result.items.map((item) => ({
      expiresAt: item.expiresAt,
      id: item.id,
      laneSeq: item.laneSeq,
      payloadInlineCiphertext: item.payloadInlineCiphertext,
    }))).toEqual([
      {
        expiresAt: "2026-04-25T00:00:00.000Z",
        id: "mailbox_expired_1",
        laneSeq: "1",
        payloadInlineCiphertext: "cipher_expired_1",
      },
      {
        expiresAt: "2026-04-27T00:00:00.000Z",
        id: "mailbox_live_2",
        laneSeq: "2",
        payloadInlineCiphertext: "cipher_live_2",
      },
    ]);
    expect(hostedMailboxPayload.findFirst).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.findMany).not.toHaveBeenCalled();
    expect(hostedMailboxPayload.findUnique).not.toHaveBeenCalled();
  });

  it("reads max lane sequence from append-only mailbox rows including expired items", async () => {
    const expiredSeq2 = buildHostedMailboxItemRow({
      expiresAt: new Date("2026-04-25T00:00:00.000Z"),
      id: "mailbox_expired_2",
      lane: "conversation",
      laneSeq: 2n,
    });
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => expiredSeq2),
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
      where: {
        lane: "conversation",
        userId: "member_mailbox_1",
      },
    });
    expect(result).toEqual([
      {
        lane: "conversation",
        maxSeq: "2",
      },
    ]);
  });

  it("fetches sidecar payload ciphertext through the separate payload helper", async () => {
    const hostedMailboxItem = createHostedMailboxItemDelegate({
      findFirst: vi.fn<HostedMailboxItemFindFirst>(async () => buildHostedMailboxItemRow({
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
        mailboxItem: {
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
        },
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
});

interface HostedMailboxCreateArgs {
  data: {
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
    createdAt: FIXED_NOW,
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
  hostedMailboxItem: ReturnType<typeof createHostedMailboxItemDelegate>;
  hostedMailboxPayload: ReturnType<typeof createHostedMailboxPayloadDelegate>;
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
            lane: String(values[2]),
            laneSeq: values[3] as bigint,
            dedupeKey: String(values[4]),
            kind: String(values[5]),
            occurredAt: values[6] as Date,
            payloadSchema: String(values[7]),
            payloadInlineCiphertext: values[8] as string | null,
            payloadRef: values[9] as string | null,
            payloadBytes: values[10] as number,
            payloadHash: values[11] as string | null,
            expiresAt: values[12] as Date | null,
          },
        });
        return [row];
      }

      throw new Error(`Unexpected hosted mailbox query: ${sql}`);
    }),
    hostedMailboxItem: input.hostedMailboxItem,
    hostedMailboxPayload: input.hostedMailboxPayload,
    hostedRuntimeLog: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        at: args.data.at as Date,
        attemptId: args.data.attemptId as string | null,
        checkpointVersion: args.data.checkpointVersion as bigint | null,
        component: String(args.data.component),
        createdAt: FIXED_NOW,
        errorCode: args.data.errorCode as string | null,
        eventCode: String(args.data.eventCode),
        id: String(args.data.id),
        leaseGeneration: args.data.leaseGeneration as bigint | null,
        level: String(args.data.level),
        mailboxLane: args.data.mailboxLane as string | null,
        mailboxSeqEnd: args.data.mailboxSeqEnd as bigint | null,
        mailboxSeqStart: args.data.mailboxSeqStart as bigint | null,
        outboxIntentRef: args.data.outboxIntentRef as string | null,
        phase: String(args.data.phase),
        redactedJson: args.data.redactedJson,
        userId: String(args.data.userId),
        workspaceVersion: args.data.workspaceVersion as bigint | null,
      })),
    },
    hostedWorkspace: {
      upsert: vi.fn(async () => null),
    },
  }) as Parameters<typeof appendHostedMailboxItemTx>[0]["tx"];
}

function readHostedMailboxRawSql(call: unknown[] | undefined): string {
  const strings = call?.[0] as TemplateStringsArray | undefined;
  return strings ? strings.join("?") : "";
}

function createHostedMailboxClient(input: {
  hostedMailboxItem: ReturnType<typeof createHostedMailboxItemDelegate>;
  hostedMailboxPayload: ReturnType<typeof createHostedMailboxPayloadDelegate>;
}) {
  return Object.assign(Object.create(null), {
    hostedMailboxItem: input.hostedMailboxItem,
    hostedMailboxPayload: input.hostedMailboxPayload,
  }) as Parameters<typeof fetchHostedMailboxItemsAfterLaneCursors>[0]["prisma"];
}
