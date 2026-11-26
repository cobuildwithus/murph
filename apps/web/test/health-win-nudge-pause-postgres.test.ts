import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { healthWinTextKeys } from "../src/lib/health-wins/nudge-delivery";
import { isHealthWinTextPaused } from "../src/lib/health-wins/nudge-pause";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "../src/lib/hosted-onboarding/linq-observability-identifiers";
import { getPrisma } from "../src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Win text pause tests require an isolated loopback database.");
}
const db = getPrisma();
const now = new Date("2030-02-03T11:00:00Z");
const dayMs = 86_400_000;

describe.skipIf(!enabled)("unanswered win texts", () => {
  let memberId: string;
  beforeEach(async () => {
    memberId = randomUUID();
    await db.hostedMember.create({ data: { id: memberId } });
  });
  afterEach(async () => {
    await db.hostedMember.delete({ where: { id: memberId } });
  });

  const paused = () => isHealthWinTextPaused(db, memberId, now);
  async function receipt(key: string, attemptedAt: Date, acceptedAt: Date | null) {
    await db.hostedLinqDelivery.create({ data: {
      id: randomUUID(), payloadOwnerMemberId: memberId, idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(key),
      source: "assistant_runtime", status: acceptedAt ? "accepted" : "attempted", attemptedAt, acceptedAt,
    } });
  }
  async function wake(daysAgo: number) {
    const at = new Date(now.getTime() - daysAgo * dayMs);
    const keys = healthWinTextKeys(memberId, at.toISOString().slice(0, 10));
    await db.hostedMailboxItem.create({ data: {
      userId: memberId, id: randomUUID(), kind: "assistant.notification.requested", lane: "system",
      laneSeq: BigInt(daysAgo), dedupeKey: keys.mailbox, createdAt: at, occurredAt: at,
      expiresAt: new Date(at.getTime() + 1_000), payloadSchema: "synthetic",
    } });
    return { ...keys, at };
  }
  async function reply(at: Date) {
    await db.hostedMailboxItem.create({ data: {
      userId: memberId, id: randomUUID(), kind: "conversation.message", lane: "conversation",
      laneSeq: 1n, dedupeKey: randomUUID(), createdAt: at, occurredAt: at, payloadSchema: "synthetic",
    } });
  }

  it("counts accepted parent deliveries once through their unprefixed identity, even after mailbox expiry", async () => {
    const first = await wake(5), second = await wake(3), third = await wake(1);
    await receipt(first.base, first.at, first.at);
    await receipt(second.base, second.at, second.at);
    await receipt(first.base + ":link", first.at, first.at);
    await receipt(first.base + ":link:fallback", first.at, first.at);
    await receipt(third.mailbox, third.at, third.at);
    await receipt(third.base, third.at, null);
    expect(await paused()).toBe(false);
    await db.hostedLinqDelivery.update({
      where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(third.base)! },
      data: { acceptedAt: third.at, status: "accepted" },
    });
    expect(await paused()).toBe(true);
  });

  it.each(["reply", "post"])("resumes after a member's %s since the oldest of the three latest accepted deliveries", async kind => {
    for (const days of [7, 5, 3, 1]) {
      const item = await wake(days);
      await receipt(item.base, item.at, item.at);
    }
    await db.healthPost.create({ data: { id: randomUUID(), authorMemberId: memberId, createdAt: new Date(now.getTime() - 6 * dayMs) } });
    expect(await paused()).toBe(true);
    const when = new Date(now.getTime() - 4 * dayMs);
    if (kind === "reply") await reply(when);
    else await db.healthPost.create({ data: { id: randomUUID(), authorMemberId: memberId, createdAt: when } });
    expect(await paused()).toBe(false);
  });

  it("uses the acceptance instant for the four-week cutoff", async () => {
    const old = await wake(28);
    const justBefore = new Date(old.at.getTime() - 1);
    await db.hostedMailboxItem.update({
      where: { userId_dedupeKey: { userId: memberId, dedupeKey: old.mailbox } },
      data: { createdAt: justBefore, occurredAt: justBefore },
    });
    await receipt(old.base, justBefore, justBefore);
    for (const days of [2, 1]) {
      const item = await wake(days);
      await receipt(item.base, item.at, item.at);
    }
    expect(await paused()).toBe(false);
    await db.hostedLinqDelivery.update({
      where: { idempotencyKey: createHostedLinqDeliveryIdempotencyLookupKey(old.base)! }, data: { acceptedAt: old.at },
    });
    expect(await paused()).toBe(true);
  });
});
