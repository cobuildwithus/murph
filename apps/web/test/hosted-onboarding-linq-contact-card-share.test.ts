import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shareHostedLinqContactCard: vi.fn(async () => undefined),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  shareHostedLinqContactCard: mocks.shareHostedLinqContactCard,
}));

import {
  createHostedLinqChatLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  maybeShareHostedLinqContactCardAfterOutbound,
  maybeShareHostedLinqContactCardAfterOutboundForRuntime,
} from "@/src/lib/hosted-onboarding/linq-contact-card-share";

const TEST_KEYRING_ENTRIES = {
  v1: "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
  v2: "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE=",
} as const;

describe("hosted Linq contact-card sharing", () => {
  let restoreKeyring: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shareHostedLinqContactCard.mockResolvedValue(undefined);
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
  });

  afterEach(() => {
    restoreKeyring?.();
    restoreKeyring = null;
  });

  it("reserves eligible direct iMessage chats without storing the raw chat id", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");

    const decision = await maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
    });

    expect(decision).toEqual({
      action: "share",
    });
    expect(mocks.shareHostedLinqContactCard).toHaveBeenCalledWith({
      chatId: "chat_123",
    });
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      lastContactCardShareAttemptedAt: now,
      memberId: "member_123",
    }));
    expect(prisma.rows[0]?.linqChatLookupKey).toMatch(/^hbidx:linq-chat:v1:/u);
    expect(prisma.rows[0]?.linqChatLookupKey).not.toContain("chat_123");
  });

  it("skips ineligible chats before touching contact-card share state", async () => {
    const prisma = createContactCardSharePrismaStub();

    await expect(maybeShareHostedLinqContactCardAfterOutbound({
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
    await expect(maybeShareHostedLinqContactCardAfterOutbound({
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

    expect(prisma.model.findMany).not.toHaveBeenCalled();
    expect(prisma.model.create).not.toHaveBeenCalled();
    expect(prisma.model.updateMany).not.toHaveBeenCalled();
    expect(mocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

  it("prevents duplicate attempts and keeps failed attempts throttled", async () => {
    const prisma = createContactCardSharePrismaStub();
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
    })).resolves.toEqual({
      action: "share",
    });

    await expect(maybeShareHostedLinqContactCardAfterOutbound({
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
      reason: "recent_attempt",
    });
    expect(mocks.shareHostedLinqContactCard).toHaveBeenCalledTimes(1);

    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      lastContactCardShareAttemptedAt: now,
    }));

    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-29T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "share",
    });
    expect(mocks.shareHostedLinqContactCard).toHaveBeenCalledTimes(2);
  });

  it("throttles share attempts for 48 hours after the reserved attempt", async () => {
    const prisma = createContactCardSharePrismaStub();
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
    })).resolves.toEqual({
      action: "share",
    });

    await expect(maybeShareHostedLinqContactCardAfterOutbound({
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
    expect(mocks.shareHostedLinqContactCard).toHaveBeenCalledTimes(1);
    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-29T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "share",
    });
    expect(mocks.shareHostedLinqContactCard).toHaveBeenCalledTimes(2);
  });

  it("checks every contact-privacy key version before allowing a rotated-key share", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");

    const oldLookupKey = mustCreateHostedLinqChatLookupKey("chat_123");
    restoreKeyring?.();
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
    const currentLookupKey = mustCreateHostedLinqChatLookupKey("chat_123");

    prisma.rows.push(
      createContactCardShareRow({
        lastContactCardShareAttemptedAt: new Date("2026-06-24T12:00:00.000Z"),
        linqChatLookupKey: oldLookupKey,
      }),
      createContactCardShareRow({
        lastContactCardShareAttemptedAt: new Date("2026-06-27T11:00:00.000Z"),
        linqChatLookupKey: currentLookupKey,
      }),
    );

    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });

    expect(mocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
    expect(prisma.model.updateMany).not.toHaveBeenCalled();
    expect(prisma.model.create).not.toHaveBeenCalled();
  });

  it("reserves only the current contact-privacy key when rotated-key rows are stale", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-06-27T12:00:00.000Z");
    const oldAttemptedAt = new Date("2026-06-24T12:00:00.000Z");
    const currentAttemptedAt = new Date("2026-06-24T13:00:00.000Z");

    const oldLookupKey = mustCreateHostedLinqChatLookupKey("chat_123");
    restoreKeyring?.();
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v2",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
    const currentLookupKey = mustCreateHostedLinqChatLookupKey("chat_123");

    prisma.rows.push(
      createContactCardShareRow({
        lastContactCardShareAttemptedAt: oldAttemptedAt,
        linqChatLookupKey: oldLookupKey,
      }),
      createContactCardShareRow({
        lastContactCardShareAttemptedAt: currentAttemptedAt,
        linqChatLookupKey: currentLookupKey,
      }),
    );

    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_123",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_456",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "share",
    });

    expect(mocks.shareHostedLinqContactCard).toHaveBeenCalledTimes(1);
    expect(prisma.model.create).not.toHaveBeenCalled();
    expect(prisma.rows).toEqual([
      expect.objectContaining({
        lastContactCardShareAttemptedAt: oldAttemptedAt,
        linqChatLookupKey: oldLookupKey,
        memberId: "member_123",
      }),
      expect.objectContaining({
        lastContactCardShareAttemptedAt: now,
        linqChatLookupKey: currentLookupKey,
        memberId: "member_456",
      }),
    ]);
  });

  it("shares best-effort and keeps provider failures throttled", async () => {
    const prisma = createContactCardSharePrismaStub();
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
    })).resolves.toEqual({
      action: "share",
    });

    expect(mocks.shareHostedLinqContactCard).toHaveBeenCalledWith({
      chatId: "chat_123",
    });
    expect(prisma.rows[0]).toEqual(expect.objectContaining({
      lastContactCardShareAttemptedAt: now,
    }));

    mocks.shareHostedLinqContactCard.mockRejectedValueOnce(new Error("provider rejected"));
    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_456",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now,
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "share",
    });

    expect(prisma.rows[1]).toEqual(expect.objectContaining({
      lastContactCardShareAttemptedAt: now,
    }));

    mocks.shareHostedLinqContactCard.mockClear();
    await expect(maybeShareHostedLinqContactCardAfterOutbound({
      chatId: "chat_456",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      memberId: "member_123",
      now: new Date("2026-06-28T12:00:00.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });
    expect(mocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

  it("shares the contact card to a first-contact not_started member on their bound pending chat", async () => {
    const prisma = createContactCardShareRuntimeClient({
      billingStatus: HostedBillingStatus.not_started,
      boundChatId: "chat_first_contact",
      boundVia: "pending",
    });

    const decision = await maybeShareHostedLinqContactCardAfterOutboundForRuntime({
      authority: null,
      boundUserId: "member_123",
      chatId: "chat_first_contact",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      prisma: prisma.client,
    });

    expect(decision).toEqual({ action: "share" });
    expect(mocks.shareHostedLinqContactCard).toHaveBeenCalledWith({
      chatId: "chat_first_contact",
    });
  });

  it("refuses the contact card for a suspended member even on their own chat", async () => {
    const prisma = createContactCardShareRuntimeClient({
      billingStatus: HostedBillingStatus.canceled,
      boundChatId: "chat_first_contact",
      boundVia: "pending",
      suspendedAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    await expect(maybeShareHostedLinqContactCardAfterOutboundForRuntime({
      authority: null,
      boundUserId: "member_123",
      chatId: "chat_first_contact",
      eligibility: {
        service: "iMessage",
        threadIsDirect: true,
      },
      prisma: prisma.client,
    })).rejects.toMatchObject({
      code: "HOSTED_LINQ_CONTACT_CARD_SHARE_THREAD_MISMATCH",
    });
    expect(mocks.shareHostedLinqContactCard).not.toHaveBeenCalled();
  });

});

type ContactCardShareRow = {
  createdAt: Date;
  lastContactCardShareAttemptedAt: Date | null;
  linqChatLookupKey: string;
  memberId: string;
  updatedAt: Date;
};

type FindManyArgs = {
  select?: Record<string, boolean>;
  where: {
    linqChatLookupKey: {
      in: readonly string[];
    };
  };
};

type CreateArgs = {
  data: {
    lastContactCardShareAttemptedAt: Date;
    linqChatLookupKey: string;
    memberId: string;
  };
};

type UpdateManyArgs = {
  data: Partial<Pick<
    ContactCardShareRow,
    | "lastContactCardShareAttemptedAt"
    | "memberId"
  >>;
  where: {
    linqChatLookupKey?: string | {
      in: readonly string[];
    };
    memberId?: string;
    OR?: readonly Record<string, DateComparison | null>[];
  };
};

type DateComparison = {
  lt?: Date;
  lte?: Date;
};

function createContactCardSharePrismaStub() {
  const rows: ContactCardShareRow[] = [];
  const model = {
    findMany: vi.fn(async (args: FindManyArgs) =>
      rows
        .filter((candidate) =>
          args.where.linqChatLookupKey.in.includes(candidate.linqChatLookupKey)
        )
        .map((row) => ({
          lastContactCardShareAttemptedAt: row.lastContactCardShareAttemptedAt,
          linqChatLookupKey: row.linqChatLookupKey,
        })),
    ),
    create: vi.fn(async (args: CreateArgs) => {
      const row: ContactCardShareRow = {
        createdAt: args.data.lastContactCardShareAttemptedAt,
        lastContactCardShareAttemptedAt: args.data.lastContactCardShareAttemptedAt,
        linqChatLookupKey: args.data.linqChatLookupKey,
        memberId: args.data.memberId,
        updatedAt: args.data.lastContactCardShareAttemptedAt,
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

type RuntimeShareClient = Parameters<
  typeof maybeShareHostedLinqContactCardAfterOutboundForRuntime
>[0]["prisma"];

function createContactCardShareRuntimeClient(input: {
  billingStatus: HostedBillingStatus;
  boundChatId: string;
  boundVia: "home" | "pending";
  suspendedAt?: Date | null;
}) {
  const stub = createContactCardSharePrismaStub();
  const lookupKey = mustCreateHostedLinqChatLookupKey(input.boundChatId);
  const findUnique = vi.fn(async () => ({
    linqChatLookupKey: input.boundVia === "home" ? lookupKey : null,
    member: {
      billingStatus: input.billingStatus,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: input.suspendedAt ?? null,
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    },
    pendingLinqChatLookupKey: input.boundVia === "pending" ? lookupKey : null,
  }));

  return {
    ...stub,
    // Narrow test boundary: the runtime share only reads hostedMemberRouting
    // and hostedLinqContactCardShare, so a stub of those two models stands in
    // for the full Prisma read client.
    client: {
      ...stub.client,
      hostedMemberRouting: { findUnique },
    } as unknown as RuntimeShareClient,
    routingFindUnique: findUnique,
  };
}

function createContactCardShareRow(input: {
  lastContactCardShareAttemptedAt: Date | null;
  linqChatLookupKey: string;
  memberId?: string;
}): ContactCardShareRow {
  const createdAt = input.lastContactCardShareAttemptedAt
    ?? new Date("2026-06-27T12:00:00.000Z");
  return {
    createdAt,
    lastContactCardShareAttemptedAt: input.lastContactCardShareAttemptedAt,
    linqChatLookupKey: input.linqChatLookupKey,
    memberId: input.memberId ?? "member_123",
    updatedAt: createdAt,
  };
}

function mustCreateHostedLinqChatLookupKey(chatId: string): string {
  const lookupKey = createHostedLinqChatLookupKey(chatId);
  if (!lookupKey) {
    throw new Error("Expected hosted Linq chat lookup key.");
  }
  return lookupKey;
}

function rowMatchesUpdateWhere(
  row: ContactCardShareRow,
  where: UpdateManyArgs["where"],
): boolean {
  if (typeof where.memberId === "string" && row.memberId !== where.memberId) {
    return false;
  }
  if (
    where.linqChatLookupKey !== undefined
    && !linqChatLookupKeyMatches(row.linqChatLookupKey, where.linqChatLookupKey)
  ) {
    return false;
  }

  return (where.OR ?? [null]).some((condition) =>
    condition === null || rowMatchesCondition(row, condition),
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
    case "lastContactCardShareAttemptedAt":
      return row.lastContactCardShareAttemptedAt;
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
