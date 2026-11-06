import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHostedLinqChatLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  claimHostedLinqAckReaction,
  confirmHostedLinqAckReaction,
  HOSTED_LINQ_ACK_REACTION_BURST_MAX_AGE_MS,
  isHostedLinqAckReactionCoveringCurrentBurst,
  markHostedLinqAckReactionHeavy,
  readHostedLinqAckReactionOnMessage,
  releaseHostedLinqAckReaction,
} from "@/src/lib/hosted-onboarding/linq-ack-reaction-store";
import { acquireHostedLinqChatOwnershipLockTx } from "@/src/lib/hosted-routing/linq-chat-ownership-lock";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const KEY_V1 = Buffer.from("a".repeat(32), "utf8").toString("base64");
const KEY_V2 = Buffer.from("b".repeat(32), "utf8").toString("base64");

if (runPostgresProof && !/^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost)[:/]/u.test(databaseUrl)) {
  throw new Error("The Linq ack-reaction PostgreSQL proof requires a local DATABASE_URL.");
}

function useKeyring(current: "v1" | "v2"): void {
  process.env.HOSTED_CONTACT_PRIVACY_KEYS = current === "v1" ? `v1:${KEY_V1}` : `v1:${KEY_V1},v2:${KEY_V2}`;
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = current;
  delete (globalThis as { __murphHostedOnboardingEnv?: unknown }).__murphHostedOnboardingEnv;
}

describe.skipIf(!runPostgresProof)("hosted Linq ack-reaction burst state (PostgreSQL)", () => {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 8 });
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  beforeAll(() => useKeyring("v1"));

  afterAll(async () => {
    restoreEnv("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousVersion);
    delete (globalThis as { __murphHostedOnboardingEnv?: unknown }).__murphHostedOnboardingEnv;
    await prisma.$disconnect();
  });

  async function recordOutbound(linqChatId: string, attemptedAt: Date): Promise<void> {
    await prisma.hostedLinqDelivery.create({
      data: {
        attemptedAt,
        id: `ack-proof-${randomUUID()}`,
        linqChatLookupKey: createHostedLinqChatLookupKey(linqChatId),
        source: "ack_reaction_proof",
      },
    });
  }

  const at = (seconds: number) => new Date(Date.UTC(2026, 10, 5, 12, 0, 0, seconds * 1000 + 123));
  const clock = (seconds: number) => () => at(seconds);

  /** Coverage seen by a progress note sent at `nowSeconds` (default: just after the claims). */
  async function covered(linqChatId: string, nowSeconds = 70): Promise<boolean> {
    return prisma.$transaction((tx) =>
      isHostedLinqAckReactionCoveringCurrentBurst({ linqChatId, now: clock(nowSeconds), prisma: tx }));
  }

  async function tapbackOn(linqChatId: string, messageId: string): Promise<string | null> {
    return prisma.$transaction((tx) => readHostedLinqAckReactionOnMessage({ linqChatId, messageId, prisma: tx }));
  }

  function ack(messageId = `msg-${randomUUID()}`, reaction = "⏰") {
    return { messageId, reaction };
  }

  it("reserves one tapback per burst, suppresses progress only once confirmed, and reopens after Murph sends", async () => {
    const chat = `ack-proof-${randomUUID()}`;
    await recordOutbound(chat, at(0));

    const claimedAt = await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(5), now: clock(6), prisma });
    expect(claimedAt).toEqual(at(6));
    expect(await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(7), now: clock(8), prisma }))
      .toBeNull();
    expect(await covered(chat)).toBe(false);

    await confirmHostedLinqAckReaction({ claimedAt: claimedAt!, linqChatId: chat, now: clock(6.2), prisma });
    expect(await covered(chat)).toBe(true);

    await recordOutbound(chat, at(10));
    expect(await covered(chat)).toBe(false);
    expect(await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(12), now: clock(13), prisma }))
      .toEqual(at(13));
  });

  it("treats a first-ever chat as fresh and refuses once Murph sent after the message arrived", async () => {
    const fresh = `ack-proof-${randomUUID()}`;
    expect(await claimHostedLinqAckReaction({ ...ack(), linqChatId: fresh, messageReceivedAt: at(1), now: clock(2), prisma }))
      .toEqual(at(2));

    const answered = `ack-proof-${randomUUID()}`;
    await recordOutbound(answered, at(20));
    expect(await claimHostedLinqAckReaction({ ...ack(), linqChatId: answered, messageReceivedAt: at(19), now: clock(21), prisma }))
      .toBeNull();
    expect(await claimHostedLinqAckReaction({ ...ack(), linqChatId: answered, messageReceivedAt: at(20), now: clock(21), prisma }))
      .toBeNull();
  });

  it("keeps a heavy burst quiet until Murph sends, and a late heavy result cannot silence the next burst", async () => {
    const chat = `ack-proof-${randomUUID()}`;
    await markHostedLinqAckReactionHeavy({ linqChatId: chat, messageReceivedAt: at(1), now: clock(1.5), prisma });
    expect(await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(2), now: clock(3), prisma }))
      .toBeNull();
    await recordOutbound(chat, at(4));

    // A heavy classification for the message at 3.5s finishes after Murph
    // replied at 4s and the member sent a new request at 5s.
    await markHostedLinqAckReactionHeavy({ linqChatId: chat, messageReceivedAt: at(3.5), now: clock(5.5), prisma });
    expect(await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(5), now: clock(6), prisma }))
      .toEqual(at(6));
  });

  it("lets exactly one of several concurrent messages reserve the burst", async () => {
    const chat = `ack-proof-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      claimHostedLinqAckReaction({
        ...ack(),
        linqChatId: chat,
        messageReceivedAt: at(30),
        now: () => new Date(at(31).getTime() + index),
        prisma,
      })));
    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it("serializes a claim with a progress dispatch fence held under the chat lock", async () => {
    const chat = `ack-proof-${randomUUID()}`;
    let releaseFence!: () => void;
    const fenceHeld = new Promise<void>((resolve) => { releaseFence = resolve; });
    let lockTaken!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { lockTaken = resolve; });

    // Progress for the message at 40s enters provider dispatch first.
    const fence = prisma.$transaction(async (tx) => {
      await acquireHostedLinqChatOwnershipLockTx({ chatId: chat, tx });
      lockTaken();
      await fenceHeld;
      await tx.hostedLinqDelivery.create({
        data: {
          attemptedAt: at(41),
          id: `ack-proof-${randomUUID()}`,
          linqChatLookupKey: createHostedLinqChatLookupKey(chat),
          source: "ack_reaction_proof",
        },
      });
    }, { timeout: 5_000 });
    await lockAcquired;
    const claim = claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(40), now: clock(42), prisma });
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseFence();
    await fence;
    expect(await claim).toBeNull();
  });

  it("confirms and releases only the exact reservation", async () => {
    const chat = `ack-proof-${randomUUID()}`;
    const claimedAt = await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(50), now: clock(51), prisma });
    expect(claimedAt).toEqual(at(51));

    await releaseHostedLinqAckReaction({ claimedAt: at(99), linqChatId: chat, prisma });
    await confirmHostedLinqAckReaction({ claimedAt: at(99), linqChatId: chat, prisma });
    expect(await covered(chat)).toBe(false);
    expect(await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(52), now: clock(53), prisma }))
      .toBeNull();

    await releaseHostedLinqAckReaction({ claimedAt: claimedAt!, linqChatId: chat, prisma });
    const second = await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(54), now: clock(55), prisma });
    expect(second).toEqual(at(55));

    // A stale release from the first claim cannot free the newer one, and a
    // confirmed reservation is never released.
    await releaseHostedLinqAckReaction({ claimedAt: claimedAt!, linqChatId: chat, prisma });
    await confirmHostedLinqAckReaction({ claimedAt: second!, linqChatId: chat, prisma });
    await releaseHostedLinqAckReaction({ claimedAt: second!, linqChatId: chat, prisma });
    expect(await covered(chat)).toBe(true);
  });

  it("tells Murph's react_to_message which emoji Linq accepted on that exact message only", async () => {
    const chat = `ack-proof-${randomUUID()}`;
    const claimedAt = await claimHostedLinqAckReaction({
      ...ack("msg-tapped", "📊"),
      linqChatId: chat,
      messageReceivedAt: at(80),
      now: clock(81),
      prisma,
    });
    expect(claimedAt).toEqual(at(81));
    // Reserved but not yet confirmed: the send may still fail, so Murph's own
    // reaction must not be skipped.
    expect(await tapbackOn(chat, "msg-tapped")).toBeNull();

    await confirmHostedLinqAckReaction({ claimedAt: claimedAt!, linqChatId: chat, prisma });
    expect(await tapbackOn(chat, "msg-tapped")).toBe("📊");
    expect(await tapbackOn(chat, "msg-other")).toBeNull();
    expect(await tapbackOn(`ack-proof-${randomUUID()}`, "msg-tapped")).toBeNull();
  });

  it("reads no tapback after a definite refusal released the reservation", async () => {
    const chat = `ack-proof-${randomUUID()}`;
    const claimedAt = await claimHostedLinqAckReaction({
      ...ack("msg-refused"),
      linqChatId: chat,
      messageReceivedAt: at(84),
      now: clock(85),
      prisma,
    });
    await releaseHostedLinqAckReaction({ claimedAt: claimedAt!, linqChatId: chat, prisma });
    expect(await tapbackOn(chat, "msg-refused")).toBeNull();
  });

  it("finds the tapback after both the chat and message key families rotate", async () => {
    const chat = `ack-proof-${randomUUID()}`;
    useKeyring("v1");
    const claimedAt = await claimHostedLinqAckReaction({
      ...ack("msg-rotated", "🔎"),
      linqChatId: chat,
      messageReceivedAt: at(88),
      now: clock(89),
      prisma,
    });
    await confirmHostedLinqAckReaction({ claimedAt: claimedAt!, linqChatId: chat, prisma });
    try {
      useKeyring("v2");
      expect(await tapbackOn(chat, "msg-rotated")).toBe("🔎");
      expect(await tapbackOn(chat, "msg-other")).toBeNull();
    } finally {
      useKeyring("v1");
    }
  });

  it("ends a burst that had no outbound after the max age, for both the next tapback and progress", async () => {
    // Message A gets a confirmed tapback; Murph then finishes without any
    // outbound (a skipped reaction-only reply), so no fence closes the burst.
    const chat = `ack-proof-${randomUUID()}`;
    const maxAgeSeconds = HOSTED_LINQ_ACK_REACTION_BURST_MAX_AGE_MS / 1000;
    const claimedAt = await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(100), now: clock(101), prisma });
    await confirmHostedLinqAckReaction({ claimedAt: claimedAt!, linqChatId: chat, prisma });

    expect(await covered(chat, 101 + maxAgeSeconds - 1)).toBe(true);
    expect(await claimHostedLinqAckReaction({
      ...ack(),
      linqChatId: chat,
      messageReceivedAt: at(101 + maxAgeSeconds - 2),
      now: clock(101 + maxAgeSeconds - 1),
      prisma,
    })).toBeNull();

    // Message B arrives after the burst aged out: its progress is not
    // suppressed by A's tapback, and B gets its own tapback.
    expect(await covered(chat, 101 + maxAgeSeconds + 1)).toBe(false);
    expect(await claimHostedLinqAckReaction({
      ...ack(),
      linqChatId: chat,
      messageReceivedAt: at(101 + maxAgeSeconds),
      now: clock(101 + maxAgeSeconds + 1),
      prisma,
    })).toEqual(at(101 + maxAgeSeconds + 1));
  });

  it("sees a reservation written under the previous chat key version", async () => {
    const chat = `ack-proof-${randomUUID()}`;
    useKeyring("v1");
    const claimedAt = await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(60), now: clock(61), prisma });
    try {
      useKeyring("v2");
      expect(await claimHostedLinqAckReaction({ ...ack(), linqChatId: chat, messageReceivedAt: at(62), now: clock(63), prisma }))
        .toBeNull();
      await confirmHostedLinqAckReaction({ claimedAt: claimedAt!, linqChatId: chat, prisma });
      expect(await covered(chat)).toBe(true);
    } finally {
      useKeyring("v1");
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
