import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimHostedLinqContactCardShareAfterOutbound,
  maybeShareHostedLinqContactCardAfterOutbound,
  recordHostedLinqContactCardShareResult,
} from "@/src/lib/hosted-onboarding/linq-contact-card-share";

const TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
} as const;

describe("hosted Linq contact-card sharing", () => {
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

  it("claims eligible direct iMessage chats without storing the raw chat id", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");

    const decision = await claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });

    expect(decision.action).toBe("share");
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      contactCardShareClaimedAt: now,
      lastContactCardShareAttemptedAt: now,
      lastContactCardShareSucceededAt: null,
      memberId: "member_123",
    }));
    expect(prisma.rows[0]?.linqChatLookupKey).toMatch(/^hbidx:linq-chat:v1:/u);
    expect(prisma.rows[0]?.linqChatLookupKey).not.toContain("chat_123");
  });

  it("skips ineligible chats before touching contact-card share state", async () => {
    const prisma = createContactCardSharePrismaStub();

    await expect(claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: null,
        threadIsDirect: true,
      },
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "ineligible_chat",
    });
    await expect(claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: false,
      },
      memberId: "member_123",
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "ineligible_chat",
    });

    expect(prisma.model.findFirst).not.toHaveBeenCalled();
    expect(prisma.model.create).not.toHaveBeenCalled();
    expect(prisma.model.updateMany).not.toHaveBeenCalled();
  });

  it("prevents duplicate active claims and keeps failed attempts throttled", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");

    const first = await claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });
    if (first.action !== "share") {
      throw new Error("Expected initial claim to share.");
    }

    await expect(claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-27T12:05:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "claim_active",
    });

    await recordHostedLinqContactCardShareResult({
      chatId: "chat_123",
      claimId: first.claimId,
      memberId: "member_123",
      prisma: prisma.client,
      status: "failed",
    });

    await expect(claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-27T12:06:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      contactCardShareClaimedAt: null,
      lastContactCardShareAttemptedAt: now,
      lastContactCardShareSucceededAt: null,
    }));

    await expect(claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-29T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toMatchObject({
      action: "share",
    });
  });

  it("throttles share attempts for 48 hours", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");

    const first = await claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });
    if (first.action !== "share") {
      throw new Error("Expected initial claim to share.");
    }

    await recordHostedLinqContactCardShareResult({
      chatId: "chat_123",
      claimId: first.claimId,
      memberId: "member_123",
      now,
      prisma: prisma.client,
      status: "succeeded",
    });

    await expect(claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-29T11:59:59.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });
    await expect(claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-29T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toMatchObject({
      action: "share",
    });
  });

  it("does not retry at the exact claim TTL boundary before the attempt throttle expires", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");

    const first = await claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });
    if (first.action !== "share") {
      throw new Error("Expected initial claim to share.");
    }

    await expect(claimHostedLinqContactCardShareAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-27T12:10:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });
  });

  it("records best-effort share success and releases provider failures", async () => {
    const prisma = createContactCardSharePrismaStub();
    const shareContactCard = vi.fn(async () => undefined);
    const now = new Date("2026-06-27T12:00:00.000Z");

    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
      shareContactCard,
    })).resolves.toMatchObject({
      action: "share",
    });

    expect(shareContactCard).toHaveBeenCalledWith({
      chatId: "chat_123",
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      contactCardShareClaimId: null,
      contactCardShareClaimedAt: null,
      lastContactCardShareAttemptedAt: now,
      lastContactCardShareSucceededAt: now,
    }));

    shareContactCard.mockRejectedValueOnce(new Error("provider rejected"));
    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_456",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
      shareContactCard,
    })).resolves.toMatchObject({
      action: "share",
    });

    const failedRow = prisma.rows.find((row) => row.lastContactCardShareSucceededAt === null);
    expect(failedRow).toEqual(expect.objectContaining({
      contactCardShareClaimId: null,
      contactCardShareClaimedAt: null,
      lastContactCardShareAttemptedAt: now,
      lastContactCardShareSucceededAt: null,
    }));

    shareContactCard.mockClear();
    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_456",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-28T12:00:00.000Z"),
      prisma: prisma.client,
      shareContactCard,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });
    expect(shareContactCard).not.toHaveBeenCalled();
  });

  it("keeps an unknown provider success throttled when success recording fails", async () => {
    const prisma = createContactCardSharePrismaStub();
    const shareContactCard = vi.fn(async () => undefined);
    const now = new Date("2026-06-27T12:00:00.000Z");
    prisma.model.updateMany.mockRejectedValueOnce(new Error("record unavailable"));

    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_unknown_success",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
      shareContactCard,
    })).resolves.toEqual({
      action: "share",
    });
    expect(shareContactCard).toHaveBeenCalledTimes(1);

    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_unknown_success",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-27T12:10:00.000Z"),
      prisma: prisma.client,
      shareContactCard,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });
    expect(shareContactCard).toHaveBeenCalledTimes(1);
  });
});

type ContactCardShareRow = {
  contactCardShareClaimedAt: Date | null;
  contactCardShareClaimId: string | null;
  createdAt: Date;
  lastContactCardShareAttemptedAt: Date | null;
  lastContactCardShareSucceededAt: Date | null;
  linqChatLookupKey: string;
  memberId: string;
  updatedAt: Date;
};

type FindFirstArgs = {
  select?: Record<string, boolean>;
  where: {
    linqChatLookupKey: {
      in: readonly string[];
    };
  };
};

type CreateArgs = {
  data: {
    contactCardShareClaimedAt: Date;
    contactCardShareClaimId: string;
    lastContactCardShareAttemptedAt: Date;
    linqChatLookupKey: string;
    memberId: string;
  };
};

type UpdateManyArgs = {
  data: Partial<Pick<
    ContactCardShareRow,
    | "contactCardShareClaimedAt"
    | "contactCardShareClaimId"
    | "lastContactCardShareAttemptedAt"
    | "lastContactCardShareSucceededAt"
    | "memberId"
  >>;
  where: {
    AND?: readonly ContactCardShareWhereClause[];
    contactCardShareClaimId?: string;
    linqChatLookupKey?: string | {
      in: readonly string[];
    };
    memberId?: string;
  };
};

type ContactCardShareWhereClause = {
  OR?: readonly Record<string, DateComparison | null>[];
};

type DateComparison = {
  lt?: Date;
  lte?: Date;
};

function createContactCardSharePrismaStub() {
  const rows: ContactCardShareRow[] = [];
  const model = {
    findFirst: vi.fn(async (args: FindFirstArgs) => {
      const row = rows.find((candidate) =>
        args.where.linqChatLookupKey.in.includes(candidate.linqChatLookupKey),
      );
      if (!row) {
        return null;
      }
      return {
        contactCardShareClaimedAt: row.contactCardShareClaimedAt,
        lastContactCardShareAttemptedAt: row.lastContactCardShareAttemptedAt,
        lastContactCardShareSucceededAt: row.lastContactCardShareSucceededAt,
        linqChatLookupKey: row.linqChatLookupKey,
      };
    }),
    create: vi.fn(async (args: CreateArgs) => {
      const row: ContactCardShareRow = {
        contactCardShareClaimedAt: args.data.contactCardShareClaimedAt,
        contactCardShareClaimId: args.data.contactCardShareClaimId,
        createdAt: args.data.contactCardShareClaimedAt,
        lastContactCardShareAttemptedAt: args.data.lastContactCardShareAttemptedAt,
        lastContactCardShareSucceededAt: null,
        linqChatLookupKey: args.data.linqChatLookupKey,
        memberId: args.data.memberId,
        updatedAt: args.data.contactCardShareClaimedAt,
      };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(async (args: UpdateManyArgs) => {
      let count = 0;
      for (const row of rows) {
        if (!rowMatchesUpdateWhere(row, args.where)) {
          continue;
        }
        Object.assign(row, args.data, {
          updatedAt: new Date("2026-06-27T12:00:00.000Z"),
        });
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

function rowMatchesUpdateWhere(
  row: ContactCardShareRow,
  where: UpdateManyArgs["where"],
): boolean {
  if (
    typeof where.contactCardShareClaimId === "string"
    && row.contactCardShareClaimId !== where.contactCardShareClaimId
  ) {
    return false;
  }
  if (typeof where.memberId === "string" && row.memberId !== where.memberId) {
    return false;
  }
  if (
    where.linqChatLookupKey !== undefined
    && !linqChatLookupKeyMatches(row.linqChatLookupKey, where.linqChatLookupKey)
  ) {
    return false;
  }

  return (where.AND ?? []).every((clause) =>
    (clause.OR ?? []).some((condition) => rowMatchesCondition(row, condition)),
  );
}

function linqChatLookupKeyMatches(
  value: string,
  expected: string | { in: readonly string[] },
): boolean {
  return typeof expected === "string"
    ? value === expected
    : expected.in.includes(value);
}

function rowMatchesCondition(
  row: ContactCardShareRow,
  condition: Record<string, DateComparison | null>,
): boolean {
  const entry = Object.entries(condition)[0];
  if (!entry) {
    return false;
  }
  const [key, expected] = entry;
  const current = readRowDate(row, key);
  if (expected === null) {
    return current === null;
  }
  if (!(current instanceof Date)) {
    return false;
  }
  if (expected.lt) {
    return current < expected.lt;
  }
  if (expected.lte) {
    return current <= expected.lte;
  }
  return false;
}

function readRowDate(
  row: ContactCardShareRow,
  key: string,
): Date | null | undefined {
  switch (key) {
    case "contactCardShareClaimedAt":
      return row.contactCardShareClaimedAt;
    case "lastContactCardShareAttemptedAt":
      return row.lastContactCardShareAttemptedAt;
    case "lastContactCardShareSucceededAt":
      return row.lastContactCardShareSucceededAt;
    default:
      return undefined;
  }
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
