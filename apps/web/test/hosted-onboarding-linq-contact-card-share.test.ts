import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  releaseHostedLinqContactCardShareAttempt,
  reserveHostedLinqContactCardShareAttempt,
} from "@/src/lib/hosted-onboarding/linq-contact-card-share";

const TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
} as const;

describe("hosted Linq contact-card share reservations", () => {
  let restoreKeyring: (() => void) | null = null;

  beforeEach(() => {
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
  });

  afterEach(() => {
    restoreKeyring?.();
    restoreKeyring = null;
  });

  it("reserves without storing the raw chat id", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");

    await expect(reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "share",
      attemptedAt: now,
    });

    expect(prisma.rows).toEqual([
      expect.objectContaining({
        lastContactCardShareAttemptedAt: now,
        memberId: "member_123",
      }),
    ]);
    expect(prisma.rows[0]?.linqChatLookupKey).toMatch(/^hbidx:linq-chat:v1:/u);
    expect(prisma.rows[0]?.linqChatLookupKey).not.toContain("chat_123");
  });

  it("throttles repeat vCard shares for 90 seconds, then allows a re-share", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");

    await reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });

    await expect(reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now: new Date("2026-06-27T12:01:29.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });

    const nextAttempt = new Date("2026-06-27T12:01:30.000Z");
    await expect(reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now: nextAttempt,
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "share",
      attemptedAt: nextAttempt,
    });
  });

  it("checks every contact-privacy key version before allowing a share", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");
    const oldLookupKey = mustCreateHostedLinqChatLookupKey("chat_123");

    restoreKeyring?.();
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
    prisma.rows.push(createContactCardShareRow({
      lastContactCardShareAttemptedAt: new Date("2026-06-27T11:59:30.000Z"),
      linqChatLookupKey: oldLookupKey,
    }));

    await expect(reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });
    expect(prisma.model.create).not.toHaveBeenCalled();
    expect(prisma.model.updateMany).not.toHaveBeenCalled();
  });

  it("releases only the matching unsent vCard reservation", async () => {
    const prisma = createContactCardSharePrismaStub();
    const attemptedAt = new Date("2026-06-27T12:00:00.000Z");

    await reserveHostedLinqContactCardShareAttempt({
      chatId: "chat_123",
      memberId: "member_123",
      now: attemptedAt,
      prisma: prisma.client,
    });
    await releaseHostedLinqContactCardShareAttempt({
      attemptedAt,
      chatId: "chat_123",
      memberId: "member_123",
      prisma: prisma.client,
    });

    expect(prisma.rows[0]?.lastContactCardShareAttemptedAt).toBeNull();
  });
});

type ContactCardShareRow = {
  lastContactCardShareAttemptedAt: Date | null;
  linqChatLookupKey: string;
  memberId: string;
};

type FindManyArgs = {
  where: {
    linqChatLookupKey: {
      in: readonly string[];
    };
  };
};

type UpdateManyArgs = {
  data: {
    lastContactCardShareAttemptedAt?: Date | null;
    memberId?: string;
  };
  where: {
    lastContactCardShareAttemptedAt?: Date;
    linqChatLookupKey?: string;
    memberId?: string;
    OR?: readonly [
      { lastContactCardShareAttemptedAt: null },
      { lastContactCardShareAttemptedAt: { lte: Date } },
    ];
  };
};

function createContactCardSharePrismaStub() {
  const rows: ContactCardShareRow[] = [];
  const model = {
    findMany: vi.fn(async (args: FindManyArgs) =>
      rows
        .filter((row) =>
          args.where.linqChatLookupKey.in.includes(row.linqChatLookupKey)
        )
        .map((row) => ({
          lastContactCardShareAttemptedAt: row.lastContactCardShareAttemptedAt,
          linqChatLookupKey: row.linqChatLookupKey,
        }))),
    create: vi.fn(async (args: {
      data: {
        lastContactCardShareAttemptedAt: Date;
        linqChatLookupKey: string;
        memberId: string;
      };
    }) => {
      const row: ContactCardShareRow = { ...args.data };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(async (args: UpdateManyArgs) => {
      let count = 0;
      for (const row of rows) {
        if (!rowMatchesUpdate(row, args.where)) {
          continue;
        }
        Object.assign(row, args.data);
        count += 1;
      }
      return { count };
    }),
  };

  return {
    client: {
      hostedLinqContactCardShare: model,
    },
    model,
    rows,
  };
}

function rowMatchesUpdate(
  row: ContactCardShareRow,
  where: UpdateManyArgs["where"],
): boolean {
  if (where.linqChatLookupKey && row.linqChatLookupKey !== where.linqChatLookupKey) {
    return false;
  }
  if (where.memberId && row.memberId !== where.memberId) {
    return false;
  }
  if (
    where.lastContactCardShareAttemptedAt
    && row.lastContactCardShareAttemptedAt?.getTime()
      !== where.lastContactCardShareAttemptedAt.getTime()
  ) {
    return false;
  }
  if (!where.OR) {
    return true;
  }
  const [, stale] = where.OR;
  return row.lastContactCardShareAttemptedAt === null
    || (
      row.lastContactCardShareAttemptedAt !== null
      && row.lastContactCardShareAttemptedAt <= stale.lastContactCardShareAttemptedAt.lte
    );
}

function createContactCardShareRow(input: {
  lastContactCardShareAttemptedAt: Date | null;
  linqChatLookupKey: string;
}): ContactCardShareRow {
  return {
    ...input,
    memberId: "member_123",
  };
}

function mustCreateHostedLinqChatLookupKey(chatId: string): string {
  const lookupKey = createHostedLinqChatLookupKey(chatId);
  if (!lookupKey) {
    throw new Error("Expected hosted Linq chat lookup key.");
  }
  return lookupKey;
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
