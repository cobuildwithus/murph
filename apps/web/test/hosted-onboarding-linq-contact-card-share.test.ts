import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shareSendMocks = vi.hoisted(() => ({
  buildMurphHostedLinqContactCardVcf: vi.fn(),
  fetchMurphHostedLinqContactCardVcfPhoto: vi.fn(),
  getHostedLinqChatHandles: vi.fn(),
  resolveMurphHostedLinqContactCardBackupPhoneNumber: vi.fn(),
  sendHostedLinqAttachmentMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  getHostedLinqChatHandles: shareSendMocks.getHostedLinqChatHandles,
  isHostedLinqAttachmentSendPrepareFailure: (error: unknown) =>
    Boolean(
      error
      && typeof error === "object"
      && (error as { details?: { phase?: string } }).details?.phase === "prepare",
    ),
  sendHostedLinqAttachmentMessage: shareSendMocks.sendHostedLinqAttachmentMessage,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-contact-card", () => ({
  MURPH_CONTACT_CARD_VCF_CONTENT_TYPE: "text/vcard",
  MURPH_CONTACT_CARD_VCF_FILE_NAME: "Murph.vcf",
  buildMurphHostedLinqContactCardVcf: shareSendMocks.buildMurphHostedLinqContactCardVcf,
  fetchMurphHostedLinqContactCardVcfPhoto:
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto,
  resolveMurphHostedLinqContactCardBackupPhoneNumber:
    shareSendMocks.resolveMurphHostedLinqContactCardBackupPhoneNumber,
}));

import {
  createHostedLinqChatLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  isHostedLinqContactCardAutoShareEligible,
  releaseHostedLinqContactCardShareAttempt,
  reserveHostedLinqContactCardShareAttempt,
  shareMurphHostedLinqContactCardVcfToChat,
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

  it("throttles repeat vCard shares for 10 minutes, then allows a re-share", async () => {
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
      now: new Date("2026-06-27T12:09:59.000Z"),
      prisma: prisma.client,
    })).resolves.toEqual({
      action: "skip",
      reason: "recent_attempt",
    });

    const nextAttempt = new Date("2026-06-27T12:10:00.000Z");
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
      lastContactCardShareAttemptedAt: new Date("2026-06-27T11:55:00.000Z"),
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

describe("isHostedLinqContactCardAutoShareEligible", () => {
  it("allows iMessage threads regardless of direct or group shape", () => {
    expect(isHostedLinqContactCardAutoShareEligible({ service: "iMessage" })).toBe(true);
    expect(isHostedLinqContactCardAutoShareEligible({ service: " imessage " })).toBe(true);
  });

  it("rejects non-iMessage and unknown services", () => {
    expect(isHostedLinqContactCardAutoShareEligible({ service: "sms" })).toBe(false);
    expect(isHostedLinqContactCardAutoShareEligible({ service: "rcs" })).toBe(false);
    expect(isHostedLinqContactCardAutoShareEligible({ service: null })).toBe(false);
    expect(isHostedLinqContactCardAutoShareEligible({ service: "" })).toBe(false);
  });
});

describe("shareMurphHostedLinqContactCardVcfToChat", () => {
  let restoreKeyring: (() => void) | null = null;

  beforeEach(() => {
    restoreKeyring = configureHostedContactPrivacyKeyringForTest({
      currentVersion: "v1",
      entries: { ...TEST_KEYRING_ENTRIES },
    });
    shareSendMocks.buildMurphHostedLinqContactCardVcf.mockReturnValue(
      "BEGIN:VCARD\r\nEND:VCARD\r\n",
    );
    shareSendMocks.fetchMurphHostedLinqContactCardVcfPhoto.mockResolvedValue(null);
    shareSendMocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15557770000", isMe: true, status: "active" },
      { handle: "+15550000001", isMe: false, status: "active" },
    ]);
    shareSendMocks.resolveMurphHostedLinqContactCardBackupPhoneNumber
      .mockResolvedValue("+15558880000");
    shareSendMocks.sendHostedLinqAttachmentMessage.mockResolvedValue({
      chatId: "chat_123",
      messageId: "msg_1",
    });
  });

  afterEach(() => {
    restoreKeyring?.();
    restoreKeyring = null;
    vi.clearAllMocks();
  });

  it("sends the vcf using the chat's own line and the caller's idempotency prefix", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "signup-contact-card",
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "sent" });

    expect(shareSendMocks.buildMurphHostedLinqContactCardVcf).toHaveBeenCalledWith({
      backupPhoneNumber: "+15558880000",
      phoneNumber: "+15557770000",
      photo: null,
    });
    expect(shareSendMocks.resolveMurphHostedLinqContactCardBackupPhoneNumber)
      .toHaveBeenCalledWith(
        expect.objectContaining({ excludePhoneNumber: "+15557770000" }),
      );
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        contentType: "text/vcard",
        fileName: "Murph.vcf",
        // Keyed to the reservation instant so retries of one reservation
        // dedupe while a later requested re-share is a distinct send.
        idempotencyKey: `signup-contact-card:chat_123:${now.getTime()}`,
      }),
    );
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]?.lastContactCardShareAttemptedAt).toEqual(now);
  });

  it("skips as provider_unavailable when the roster is empty or unreadable", async () => {
    const prisma = createContactCardSharePrismaStub();

    shareSendMocks.getHostedLinqChatHandles.mockResolvedValue([]);
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "signup-contact-card",
      memberId: "member_123",
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "skipped", reason: "provider_unavailable" });

    shareSendMocks.getHostedLinqChatHandles.mockRejectedValue(new Error("provider down"));
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "signup-contact-card",
      memberId: "member_123",
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "skipped", reason: "provider_unavailable" });

    expect(prisma.rows).toHaveLength(0);
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("skips as line_unresolved without reserving when no own handle is present", async () => {
    const prisma = createContactCardSharePrismaStub();
    shareSendMocks.getHostedLinqChatHandles.mockResolvedValue([
      { handle: "+15550000001", isMe: false, status: "active" },
    ]);

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "signup-contact-card",
      memberId: "member_123",
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "skipped", reason: "line_unresolved" });

    expect(prisma.rows).toHaveLength(0);
    expect(shareSendMocks.sendHostedLinqAttachmentMessage).not.toHaveBeenCalled();
  });

  it("reports already_shared inside the 10-minute throttle without sending again", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");

    await shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "group-contact-card",
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
    });
    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "signup-contact-card",
      memberId: "member_123",
      now: new Date("2026-07-24T12:05:00.000Z"),
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "already_shared" });

    expect(shareSendMocks.sendHostedLinqAttachmentMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps the reservation for an ambiguous message-send failure", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const error = new Error("send maybe delivered");
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValue(error);

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "signup-contact-card",
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
    })).resolves.toEqual({ status: "failed", reason: "send_failed", error });

    expect(prisma.rows[0]?.lastContactCardShareAttemptedAt).toEqual(now);
  });

  it("releases the reservation when the failure provably happened before the send", async () => {
    const prisma = createContactCardSharePrismaStub();
    const now = new Date("2026-07-24T12:00:00.000Z");
    const prepareFailure = Object.assign(new Error("upload failed"), {
      details: { phase: "prepare" },
    });
    shareSendMocks.sendHostedLinqAttachmentMessage.mockRejectedValue(prepareFailure);

    await expect(shareMurphHostedLinqContactCardVcfToChat({
      chatId: "chat_123",
      idempotencyKeyPrefix: "signup-contact-card",
      memberId: "member_123",
      now,
      prisma: prisma.client as never,
    })).resolves.toEqual({
      status: "failed",
      reason: "send_failed",
      error: prepareFailure,
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
