import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyHostedCodexAuthUpdate,
  beginHostedCodexAuthAttempt,
  readHostedCodexAuthConnectionView,
} from "@/src/lib/codex-auth/store";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  lockHostedMemberRow: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
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
    mocks.appendHostedMailboxEnvelopeTx.mockImplementation(async () => ({
      item: {
        id: "mailbox_item_codex_auth",
      },
    }));
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
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
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        action: "connect",
        attemptId: first.attemptId,
        eventId: `codex-auth:connect:${first.attemptId}`,
        kind: "runtime.codex-auth-requested",
        occurredAt: "2026-06-23T12:00:00.000Z",
        userId: "member_123",
      }),
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
      mailboxItemId: null,
      view: {
        state: "connecting",
        userCode: null,
        verificationUrl: null,
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);

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
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
  });

  it("applies callback updates only to the active attempt and deletes after disconnect", async () => {
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
    })).resolves.toEqual({ applied: false });
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
    })).resolves.toEqual({ applied: true });
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
    })).resolves.toEqual({ applied: false });
    await expect(applyHostedCodexAuthUpdate({
      memberId: "member_123",
      prisma: prisma.client,
      update: {
        attemptId: "hca_abcdefghijklmnop",
        phase: "connected",
      },
    })).resolves.toEqual({ applied: true });
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
    })).resolves.toEqual({ applied: false });
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
    })).resolves.toEqual({ applied: true });
    expect(prisma.getRecord()).toBeNull();
    await expect(readHostedCodexAuthConnectionView({
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({ state: "disconnected" });
  });
});

function createCodexAuthPrismaHarness(initial: StoredCodexAuthConnection | null = null): {
  client: CodexAuthPrismaForTest;
  getRecord: () => StoredCodexAuthConnection | null;
  setRecord: (record: StoredCodexAuthConnection | null) => void;
  tx: object;
} {
  let record: StoredCodexAuthConnection | null = initial;
  const delegate = {
    deleteMany: vi.fn(async (args: { where: CodexAuthWhere }) => {
      if (matchesRecordWhere(record, args.where)) {
        record = null;
        return { count: 1 };
      }
      return { count: 0 };
    }),
    findUnique: vi.fn(async (args: { where: { memberId: string } }) =>
      record?.memberId === args.where.memberId ? { ...record } : null),
    updateMany: vi.fn(async (args: {
      data: StoredCodexAuthConnectionUpdate;
      where: CodexAuthWhere;
    }) => {
      const current = record;
      if (!current || !matchesRecordWhere(current, args.where)) {
        return { count: 0 };
      }
      record = applyRecordUpdate(current, args.data);
      return { count: 1 };
    }),
    upsert: vi.fn(async (args: {
      create: StoredCodexAuthConnection;
      update: StoredCodexAuthConnectionUpdate;
      where: { memberId: string };
    }) => {
      if (record?.memberId === args.where.memberId) {
        record = applyRecordUpdate(record, args.update);
      } else {
        record = { ...args.create };
      }
      return { ...record };
    }),
  };
  const tx = {
    hostedCodexAuthConnection: delegate,
  };
  const client = {
    $transaction: vi.fn(async (
      callback: (transactionClient: typeof tx) => Promise<unknown>,
    ) => callback(tx)),
    hostedCodexAuthConnection: delegate,
  };

  // Narrow test double: the store touches only this delegate plus $transaction.
  return {
    client: codexAuthPrismaClientForTest(client),
    getRecord: () => record,
    setRecord: (next) => {
      record = next;
    },
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
