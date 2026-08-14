import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedLinqChatLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  reserveHostedLinqContactCardShareAttempt,
} from "@/src/lib/hosted-onboarding/linq-contact-card-share";

const SHARED_PROCESS_ENV = process.env;
const TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
} as const;

describe("hosted Linq contact-card share reservation privacy", () => {
  beforeEach(() => {
    // Detach this worker from Vitest's shared environment before exercising
    // the real contact-privacy keyring derivation.
    process.env = { ...SHARED_PROCESS_ENV };
    configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { v1: TEST_KEYRING_ENTRIES.v1 },
    });
  });

  afterEach(() => {
    process.env = SHARED_PROCESS_ENV;
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

  it("checks every contact-privacy key version before allowing a share", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");
    const oldLookupKey = mustCreateHostedLinqChatLookupKey("chat_123");

    configureHostedContactPrivacyKeyringForTest({
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
    updateMany: vi.fn(async () => ({ count: 0 })),
  };

  return {
    client: {
      hostedLinqContactCardShare: model,
    },
    model,
    rows,
  };
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
}): void {
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
}
