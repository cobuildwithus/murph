import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyHostedCodexAuthUpdate,
  beginHostedCodexAuthAttempt,
  readHostedCodexAuthConnectionView,
} from "@/src/lib/codex-auth/store";
import type {
  PreparedHostedMailboxItemAppendCrypto,
} from "@/src/lib/hosted-mailbox/store";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeWithPreparedCryptoTx: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMailboxItemByDedupeKey: vi.fn(),
  runWithPreparedHostedMailboxItemAppendCrypto: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithPreparedCryptoTx:
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  readHostedMailboxItemByDedupeKey: mocks.readHostedMailboxItemByDedupeKey,
  runWithPreparedHostedMailboxItemAppendCrypto:
    mocks.runWithPreparedHostedMailboxItemAppendCrypto,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/lib/hosted-onboarding/shared")>();
  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

type CodexAuthPrismaForTest = NonNullable<
  Parameters<typeof beginHostedCodexAuthAttempt>[0]["prisma"]
>;

interface StoredCodexAuthConnection {
  attemptId: string;
  memberId: string;
  state: string;
  updatedAt: Date;
  userCode: string | null;
  verificationUrl: string | null;
}

interface StoredCodexAuthConnectionUpdate {
  attemptId?: string;
  state?: string;
  updatedAt?: Date;
  userCode?: string | null;
  verificationUrl?: string | null;
}

interface CodexAuthWhere {
  attemptId?: string;
  memberId: string;
  state?: string | { in: readonly string[] };
}

describe("hosted Codex auth store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx.mockImplementation(
      async () => ({
        item: {
          id: "mailbox_item_codex_auth",
        },
      }),
    );
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMailboxItemByDedupeKey.mockImplementation(async () => ({
      id: "mailbox_item_codex_auth",
    }));
    mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementation(
      async (input: {
        append: (
          prepared: PreparedHostedMailboxItemAppendCrypto,
        ) => Promise<unknown>;
        userId: string;
      }) => input.append(buildPreparedMailboxCrypto(input.userId)),
    );
  });

  it("dedupes fresh connect attempts and replaces stale ones with a new runtime wake", async () => {
    const now = new Date("2026-06-23T12:00:00.000Z");
    const prisma = createCodexAuthPrismaHarness();

    const first = await beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });

    expect(first.attemptId).toMatch(/^hca_[A-Za-z0-9_-]{16,64}$/u);
    expect(first.mailboxItemId).toBe("mailbox_item_codex_auth");
    expect(first.view).toEqual({
      state: "connecting",
      userCode: null,
      verificationUrl: null,
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(prisma.tx, "member_123");
    expect(mocks.runWithPreparedHostedMailboxItemAppendCrypto).toHaveBeenCalledWith({
      append: expect.any(Function),
      prisma: prisma.client,
      userId: "member_123",
    });
    expect(
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
    ).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        action: "connect",
        attemptId: first.attemptId,
        eventId: `codex-auth:connect:${first.attemptId}`,
        kind: "runtime.codex-auth-requested",
        occurredAt: "2026-06-23T12:00:00.000Z",
        userId: "member_123",
      }),
      prepared: buildPreparedMailboxCrypto("member_123"),
      tx: prisma.tx,
    });

    const retry = await beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:01:00.000Z"),
      prisma: prisma.client,
    });

    expect(retry).toEqual({
      attemptId: first.attemptId,
      mailboxItemId: "mailbox_item_codex_auth",
      view: {
        state: "connecting",
        userCode: null,
        verificationUrl: null,
      },
    });
    expect(
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.runWithPreparedHostedMailboxItemAppendCrypto,
    ).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledWith({
      dedupeKey: `codex-auth:connect:${first.attemptId}`,
      prisma: prisma.tx,
      userId: "member_123",
    });

    prisma.setRecord({
      ...prisma.getRecord()!,
      updatedAt: new Date("2026-06-23T11:44:59.999Z"),
      userCode: "STALE-CODE",
      verificationUrl: "https://auth.openai.com/device",
    });

    const replacement = await beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });

    expect(replacement.attemptId).not.toBe(first.attemptId);
    expect(replacement.mailboxItemId).toBe("mailbox_item_codex_auth");
    expect(prisma.getRecord()).toMatchObject({
      attemptId: replacement.attemptId,
      state: "connecting",
      userCode: null,
      verificationUrl: null,
    });
    expect(
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
    ).toHaveBeenCalledTimes(2);
    expect(
      mocks.runWithPreparedHostedMailboxItemAppendCrypto,
    ).toHaveBeenCalledTimes(2);
  });

  it("returns terminal no-op states without mailbox crypto preparation", async () => {
    mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementation(
      async () => {
        throw new Error("Terminal no-op states must not prepare mailbox crypto.");
      },
    );

    const connectedPrisma = createCodexAuthPrismaHarness({
      attemptId: "hca_connectedattempt",
      memberId: "member_123",
      state: "connected",
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });
    await expect(beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:01:00.000Z"),
      prisma: connectedPrisma.client,
    })).resolves.toEqual({
      attemptId: null,
      mailboxItemId: null,
      view: { state: "connected" },
    });

    const absentPrisma = createCodexAuthPrismaHarness();
    await expect(beginHostedCodexAuthAttempt({
      action: "disconnect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:01:00.000Z"),
      prisma: absentPrisma.client,
    })).resolves.toEqual({
      attemptId: null,
      mailboxItemId: null,
      view: { state: "disconnected" },
    });

    const disconnectedPrisma = createCodexAuthPrismaHarness({
      attemptId: "hca_disconnectedattempt",
      memberId: "member_123",
      state: "disconnected",
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });
    await expect(beginHostedCodexAuthAttempt({
      action: "disconnect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:01:00.000Z"),
      prisma: disconnectedPrisma.client,
    })).resolves.toEqual({
      attemptId: null,
      mailboxItemId: null,
      view: { state: "disconnected" },
    });

    expect(
      mocks.runWithPreparedHostedMailboxItemAppendCrypto,
    ).not.toHaveBeenCalled();
    expect(
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
    ).not.toHaveBeenCalled();
  });

  it("reuses a fresh disconnect wake so route retries can re-signal runtime", async () => {
    const prisma = createCodexAuthPrismaHarness({
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
      state: "disconnecting",
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });

    const retry = await beginHostedCodexAuthAttempt({
      action: "disconnect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:01:00.000Z"),
      prisma: prisma.client,
    });

    expect(retry).toEqual({
      attemptId: "hca_disconnectattempt",
      mailboxItemId: "mailbox_item_codex_auth",
      view: { state: "disconnecting" },
    });
    expect(
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
    ).not.toHaveBeenCalled();
    expect(
      mocks.runWithPreparedHostedMailboxItemAppendCrypto,
    ).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxItemByDedupeKey).toHaveBeenCalledWith({
      dedupeKey: "codex-auth:disconnect:hca_disconnectattempt",
      prisma: prisma.tx,
      userId: "member_123",
    });
  });

  it("finishes mailbox crypto preparation before the Codex append transaction opens", async () => {
    const events: string[] = [];
    const preparation = createDeferred<void>();
    const prisma = createCodexAuthPrismaHarness(null, { events });
    mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementationOnce(
      async (input: {
        append: (
          prepared: PreparedHostedMailboxItemAppendCrypto,
        ) => Promise<unknown>;
        prisma: CodexAuthPrismaForTest;
        userId: string;
      }) => {
        events.push("provider-start");
        expect(input.prisma).toBe(prisma.client);
        await preparation.promise;
        events.push("provider-finished");
        return input.append(buildPreparedMailboxCrypto(input.userId));
      },
    );
    mocks.lockHostedMemberRow.mockImplementation(async () => {
      events.push("member-lock");
    });
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx.mockImplementationOnce(
      async (input: { tx: object }) => {
        events.push("mailbox-append");
        expect(input.tx).toBe(prisma.tx);
        return { item: { id: "mailbox_item_codex_auth" } };
      },
    );

    const pending = beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:00:00.000Z"),
      prisma: prisma.client,
    });

    await vi.waitFor(() => {
      expect(events).toContain("provider-start");
    });
    expect(prisma.transaction).toHaveBeenCalledTimes(1);
    expect(prisma.getActiveTransactionDepth()).toBe(0);
    expect(
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
    ).not.toHaveBeenCalled();

    preparation.resolve();
    await expect(pending).resolves.toMatchObject({
      mailboxItemId: "mailbox_item_codex_auth",
      view: { state: "connecting" },
    });

    const appendTransactionStart = events.lastIndexOf("transaction-start");
    const appendMemberLock = events.lastIndexOf("member-lock");
    expect(events.indexOf("provider-finished")).toBeLessThan(
      appendTransactionStart,
    );
    expect(appendTransactionStart).toBeLessThan(appendMemberLock);
    expect(appendMemberLock).toBeLessThan(events.indexOf("mailbox-append"));
    expect(prisma.getRootAccessesDuringTransaction()).toEqual([]);
  });

  it("lets an unrelated member begin while another member's crypto preparation waits", async () => {
    const blockedPreparation = createDeferred<void>();
    const blockedPreparationStarted = createDeferred<void>();
    const prisma = createCodexAuthPrismaHarness();
    mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementation(
      async (input: {
        append: (
          prepared: PreparedHostedMailboxItemAppendCrypto,
        ) => Promise<unknown>;
        userId: string;
      }) => {
        if (input.userId === "member_blocked") {
          blockedPreparationStarted.resolve();
          await blockedPreparation.promise;
        }
        return input.append(buildPreparedMailboxCrypto(input.userId));
      },
    );

    const blocked = beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_blocked",
      now: new Date("2026-06-23T12:00:00.000Z"),
      prisma: prisma.client,
    });
    await blockedPreparationStarted.promise;
    expect(prisma.transaction).toHaveBeenCalledTimes(1);
    expect(prisma.getActiveTransactionDepth()).toBe(0);

    await expect(beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_unrelated",
      now: new Date("2026-06-23T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toMatchObject({
      mailboxItemId: "mailbox_item_codex_auth",
      view: { state: "connecting" },
    });
    expect(prisma.transaction).toHaveBeenCalledTimes(3);
    expect(prisma.getRecord("member_unrelated")).toMatchObject({
      memberId: "member_unrelated",
      state: "connecting",
    });

    blockedPreparation.resolve();
    await expect(blocked).resolves.toMatchObject({
      mailboxItemId: "mailbox_item_codex_auth",
      view: { state: "connecting" },
    });
    expect(prisma.transaction).toHaveBeenCalledTimes(4);
    expect(prisma.getRootAccessesDuringTransaction()).toEqual([]);
  });

  it("keeps one attempt and dedupe identity across prepared-root re-entry", async () => {
    const prisma = createCodexAuthPrismaHarness();
    const firstRootDrift = new Error("prepared root changed");
    mocks.runWithPreparedHostedMailboxItemAppendCrypto.mockImplementationOnce(
      async (input: {
        append: (
          prepared: PreparedHostedMailboxItemAppendCrypto,
        ) => Promise<unknown>;
        userId: string;
      }) => {
        try {
          return await input.append(buildPreparedMailboxCrypto(
            input.userId,
            "root_before_rotation",
          ));
        } catch (error) {
          expect(error).toBe(firstRootDrift);
          return input.append(buildPreparedMailboxCrypto(
            input.userId,
            "root_after_rotation",
          ));
        }
      },
    );
    mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx
      .mockRejectedValueOnce(firstRootDrift)
      .mockResolvedValueOnce({ item: { id: "mailbox_item_codex_auth" } });

    const result = await beginHostedCodexAuthAttempt({
      action: "connect",
      memberId: "member_123",
      now: new Date("2026-06-23T12:00:00.000Z"),
      prisma: prisma.client,
    });

    expect(prisma.transaction).toHaveBeenCalledTimes(3);
    expect(
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx,
    ).toHaveBeenCalledTimes(2);
    type PreparedAppendInput = {
      envelope: { attemptId: string; eventId: string };
      prepared: PreparedHostedMailboxItemAppendCrypto;
    };
    const firstAppend = (
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx.mock.calls[0]?.[0]
    ) as PreparedAppendInput | undefined;
    const secondAppend = (
      mocks.appendHostedMailboxEnvelopeWithPreparedCryptoTx.mock.calls[1]?.[0]
    ) as PreparedAppendInput | undefined;
    if (!firstAppend || !secondAppend) {
      throw new Error("Expected both prepared Codex mailbox append attempts.");
    }
    expect(firstAppend.envelope).toEqual(secondAppend.envelope);
    expect(firstAppend.envelope.attemptId).toBe(result.attemptId);
    expect(firstAppend.envelope.eventId).toBe(
      `codex-auth:connect:${result.attemptId}`,
    );
    expect(firstAppend.prepared.rootKeyId).toBe("root_before_rotation");
    expect(secondAppend.prepared.rootKeyId).toBe("root_after_rotation");
    expect(prisma.getRecord()).toMatchObject({
      attemptId: result.attemptId,
      state: "connecting",
    });
  });

  it("applies callback updates only to the active attempt", async () => {
    const prisma = createCodexAuthPrismaHarness({
      attemptId: "hca_abcdefghijklmnop",
      memberId: "member_123",
      state: "connecting",
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_supersededattempt",
        phase: "device_code",
        userCode: "STALE-CODE",
        verificationUrl: "https://auth.openai.com/device",
      },
    })).resolves.toEqual({
      applied: false,
      status: "superseded",
    });
    expect(prisma.getRecord()).toMatchObject({
      attemptId: "hca_abcdefghijklmnop",
      userCode: null,
      verificationUrl: null,
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_abcdefghijklmnop",
        phase: "device_code",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/device",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "connecting",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/device",
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_supersededattempt",
        phase: "connected",
      },
    })).resolves.toEqual({
      applied: false,
      status: "superseded",
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "already_applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "connected",
      userCode: null,
      verificationUrl: null,
    });

    prisma.setRecord({
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
      state: "disconnecting",
      updatedAt: new Date("2026-06-23T12:02:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_supersededattempt",
        phase: "disconnected",
      },
    })).resolves.toEqual({
      applied: false,
      status: "superseded",
    });
    expect(prisma.getRecord()).toMatchObject({
      attemptId: "hca_disconnectattempt",
      state: "disconnecting",
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_disconnectattempt",
        phase: "disconnected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      attemptId: "hca_disconnectattempt",
      state: "disconnected",
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_disconnectattempt",
        phase: "disconnected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "already_applied",
    });
    await expect(readHostedCodexAuthConnectionView({
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({ state: "disconnected" });
  });

  it("preserves the failed in-flight action in projected error states", async () => {
    const prisma = createCodexAuthPrismaHarness({
      attemptId: "hca_connectattempt",
      memberId: "member_123",
      state: "connecting",
      updatedAt: new Date("2026-06-23T12:00:00.000Z"),
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/device",
    });

    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_connectattempt",
        phase: "failed",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "connect_error",
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_connectattempt",
        phase: "failed",
      },
    })).resolves.toEqual({
      applied: true,
      status: "already_applied",
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_connectattempt",
        phase: "connected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "connected",
      userCode: null,
      verificationUrl: null,
    });

    prisma.setRecord({
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
      state: "disconnecting",
      updatedAt: new Date("2026-06-23T12:02:00.000Z"),
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_disconnectattempt",
        phase: "failed",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "disconnect_error",
      userCode: null,
      verificationUrl: null,
    });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_disconnectattempt",
        phase: "disconnected",
      },
    })).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(prisma.getRecord()).toMatchObject({
      state: "disconnected",
      userCode: null,
      verificationUrl: null,
    });
  });

  it("projects stale in-flight attempts to action-specific errors", async () => {
    const prisma = createCodexAuthPrismaHarness({
      attemptId: "hca_connectattempt",
      memberId: "member_123",
      state: "connecting",
      updatedAt: new Date("2026-06-23T11:44:59.999Z"),
      userCode: null,
      verificationUrl: null,
    });

    await expect(readHostedCodexAuthConnectionView({
      memberId: "member_123",
      now: new Date("2026-06-23T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({ state: "connect_error" });

    prisma.setRecord({
      attemptId: "hca_disconnectattempt",
      memberId: "member_123",
      state: "disconnecting",
      updatedAt: new Date("2026-06-23T11:44:59.999Z"),
      userCode: null,
      verificationUrl: null,
    });
    await expect(readHostedCodexAuthConnectionView({
      memberId: "member_123",
      now: new Date("2026-06-23T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({ state: "disconnect_error" });
  });
});

function createCodexAuthPrismaHarness(
  initial: StoredCodexAuthConnection | null = null,
  options: { events?: string[] } = {},
): {
  client: CodexAuthPrismaForTest;
  getActiveTransactionDepth: () => number;
  getRecord: (memberId?: string) => StoredCodexAuthConnection | null;
  getRootAccessesDuringTransaction: () => string[];
  setRecord: (record: StoredCodexAuthConnection | null) => void;
  transaction: ReturnType<typeof vi.fn>;
  tx: object;
} {
  const defaultMemberId = initial?.memberId ?? "member_123";
  const records = new Map<string, StoredCodexAuthConnection>();
  if (initial) {
    records.set(initial.memberId, { ...initial });
  }
  const delegate = {
    deleteMany: vi.fn(async (args: { where: CodexAuthWhere }) => {
      const current = records.get(args.where.memberId) ?? null;
      if (matchesRecordWhere(current, args.where)) {
        records.delete(args.where.memberId);
        return { count: 1 };
      }
      return { count: 0 };
    }),
    findUnique: vi.fn(async (args: { where: { memberId: string } }) => {
      const record = records.get(args.where.memberId);
      return record ? { ...record } : null;
    }),
    updateMany: vi.fn(async (args: {
      data: StoredCodexAuthConnectionUpdate;
      where: CodexAuthWhere;
    }) => {
      const current = records.get(args.where.memberId) ?? null;
      if (!current || !matchesRecordWhere(current, args.where)) {
        return { count: 0 };
      }
      records.set(
        args.where.memberId,
        applyRecordUpdate(current, args.data),
      );
      return { count: 1 };
    }),
    upsert: vi.fn(async (args: {
      create: StoredCodexAuthConnection;
      update: StoredCodexAuthConnectionUpdate;
      where: { memberId: string };
    }) => {
      const current = records.get(args.where.memberId);
      const record = current
        ? applyRecordUpdate(current, args.update)
        : { ...args.create };
      records.set(args.where.memberId, record);
      return { ...record };
    }),
  };
  const tx = {
    hostedCodexAuthConnection: delegate,
  };
  let transactionDepth = 0;
  const rootAccessesDuringTransaction: string[] = [];
  const transaction = vi.fn(async (
    callback: (transactionClient: typeof tx) => Promise<unknown>,
  ) => {
    const snapshot = new Map(records);
    options.events?.push("transaction-start");
    transactionDepth += 1;
    try {
      const result = await callback(tx);
      options.events?.push("transaction-commit");
      return result;
    } catch (error) {
      records.clear();
      for (const [memberId, record] of snapshot) {
        records.set(memberId, record);
      }
      options.events?.push("transaction-rollback");
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  });
  const rawClient = {
    $transaction: transaction,
    hostedCodexAuthConnection: delegate,
  };
  const client = new Proxy(rawClient, {
    get(target, property, receiver) {
      if (transactionDepth > 0) {
        rootAccessesDuringTransaction.push(String(property));
      }
      return Reflect.get(target, property, receiver);
    },
  });

  // Narrow test double: the store touches only this delegate plus $transaction.
  return {
    client: codexAuthPrismaClientForTest(client),
    getActiveTransactionDepth: () => transactionDepth,
    getRecord: (memberId = defaultMemberId) => {
      const record = records.get(memberId);
      return record ? { ...record } : null;
    },
    getRootAccessesDuringTransaction: () => [...rootAccessesDuringTransaction],
    setRecord: (next) => {
      if (next) {
        records.set(next.memberId, { ...next });
      } else {
        records.delete(defaultMemberId);
      }
    },
    transaction,
    tx,
  };
}

function codexAuthPrismaClientForTest(client: {
  $transaction: (
    callback: (transactionClient: { hostedCodexAuthConnection: object }) => Promise<unknown>,
  ) => Promise<unknown>;
  hostedCodexAuthConnection: object;
}): CodexAuthPrismaForTest {
  // Documented test boundary: the store test mocks every dependency that would
  // touch the rest of Prisma's transaction surface.
  const narrowClient = client as Pick<
    CodexAuthPrismaForTest,
    "$transaction" | "hostedCodexAuthConnection"
  >;
  return narrowClient as CodexAuthPrismaForTest;
}

function applyRecordUpdate(
  record: StoredCodexAuthConnection,
  update: StoredCodexAuthConnectionUpdate,
): StoredCodexAuthConnection {
  return {
    attemptId: update.attemptId ?? record.attemptId,
    memberId: record.memberId,
    state: update.state ?? record.state,
    updatedAt: update.updatedAt ?? record.updatedAt,
    userCode: update.userCode === undefined ? record.userCode : update.userCode,
    verificationUrl: update.verificationUrl === undefined
      ? record.verificationUrl
      : update.verificationUrl,
  };
}

function matchesRecordWhere(
  record: StoredCodexAuthConnection | null,
  where: CodexAuthWhere,
): boolean {
  if (!record || record.memberId !== where.memberId) {
    return false;
  }
  if (where.attemptId !== undefined && record.attemptId !== where.attemptId) {
    return false;
  }
  if (where.state === undefined) {
    return true;
  }
  if (typeof where.state === "string") {
    return record.state === where.state;
  }
  return where.state.in.includes(record.state);
}

function buildPreparedMailboxCrypto(
  userId: string,
  rootKeyId = `root_prepared_${userId}`,
): PreparedHostedMailboxItemAppendCrypto {
  return {
    domain: "ingress",
    rootKeyId,
    userId,
  };
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
