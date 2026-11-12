import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { buildHostedExecutionLinqConversationMessageWake } from "@murphai/hosted-execution";
import { appendHostedMailboxEnvelopeTx } from "@/src/lib/hosted-mailbox/store";
import { createPrismaClient } from "@/src/lib/prisma";
import { createHostedLinqChatLookupKey, createHostedPhoneLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { rosterRoute, syntheticPhone } from "./support/roster-postgres";

const mocks = vi.hoisted(() => ({ prisma: vi.fn(), memberId: "" }));
vi.mock("@/src/lib/prisma", async original => ({
  ...await original<typeof import("@/src/lib/prisma")>(), getPrisma: mocks.prisma,
}));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: async () => mocks.memberId,
}));
import { POST } from "../app/api/internal/hosted-runtime/linq-egress/engagement/route";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.search || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname)) {
    throw new Error("Reply claim proof requires an explicitly selected local test database.");
  }
}

it.skipIf(!enabled).each([true, false])(
  "claims the current conversation without an expected route and replays the same fence (direct=%s)",
  async (threadIsDirect) => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 3 });
    mocks.prisma.mockReturnValue(prisma);
    const memberId = `reply-claim-member-${randomUUID()}`;
    const ownerId = `reply-claim-owner-${randomUUID()}`;
    mocks.memberId = memberId;
    const target = `reply-claim-chat-${randomUUID()}`;
    const chatKey = createHostedLinqChatLookupKey(target)!;
    const messageId = `reply-claim-message-${randomUUID()}`;
    const idempotencyKey = `assistant-outbox:${randomUUID()}`;
    const phone = syntheticPhone();
    let lineKey: string | null = null;
    try {
      await prisma.hostedMember.createMany({ data: [memberId, ownerId].map(id => ({ id, billingStatus: "active" })) });
      if (!threadIsDirect) {
        await prisma.hostedThreadContainer.create({ data: { memberId, ownerMemberId: ownerId } });
        lineKey = await rosterRoute(prisma, memberId, target, syntheticPhone());
      }
      const envelope = buildHostedExecutionLinqConversationMessageWake({
        eventId: `reply-claim-event-${randomUUID()}`,
        occurredAt: new Date().toISOString(), userId: memberId,
        phoneLookupKey: createHostedPhoneLookupKey(phone)!,
        ...(lineKey ? { routeAuthority: { channel: "linq" as const, containerMemberId: memberId,
          accountLookupKey: lineKey, threadId: target } } : {}),
        linqMessage: { chatId: target, from: phone, isFromMe: false, messageId,
          parts: [{ type: "text", value: "Synthetic current conversation" }], threadIsDirect },
      });
      const item = await prisma.$transaction(tx => appendHostedMailboxEnvelopeTx({ envelope, tx }));
      const request = () => new Request("https://web.example.test/api/internal/hosted-runtime/linq-egress/engagement", {
        method: "POST", headers: { "content-type": "application/json" },
        // The runner sends the fallback flag on direct replies; a claiming call ignores it.
        body: JSON.stringify({ authorityCheckOnly: false, target, targetKind: "thread", homeRouteFallbackAllowed: threadIsDirect,
          replyToMessageId: messageId, answeredMailboxItemIds: [item.item.id], idempotencyKey, intentId: idempotencyKey }),
      });
      const first = await POST(request());
      expect(first.status).toBe(200);
      const claimed = await first.json();
      expect(claimed).toMatchObject({ ok: true, providerDispatchClaimed: true,
        resolvedRoute: { target, targetKind: "thread", threadIsDirect } });
      expect(claimed.deliveryBlockCode).toBeUndefined();
      const rows = () => prisma.hostedLinqDelivery.findMany({ where: { linqChatLookupKey: chatKey } });
      const before = await rows();
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({ status: "provider_dispatch_started", attemptedAt: expect.any(Date) });
      const replay = await POST(request());
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ ...claimed, providerDispatchClaimed: false });
      expect(await rows()).toEqual(before);
      // A claiming call never re-homes: an unowned chat is rejected and nothing is claimed.
      const stale = `reply-claim-stale-${randomUUID()}`;
      const rejected = await POST(new Request("https://web.example.test/api/internal/hosted-runtime/linq-egress/engagement", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorityCheckOnly: false, target: stale, targetKind: "thread", homeRouteFallbackAllowed: true,
          replyToMessageId: `reply-claim-unknown-${randomUUID()}`, idempotencyKey: `assistant-outbox:${randomUUID()}`,
          intentId: `assistant-outbox:${randomUUID()}` }),
      }));
      expect(rejected.status).toBeGreaterThanOrEqual(400);
      expect(await prisma.hostedLinqDelivery.count({
        where: { linqChatLookupKey: createHostedLinqChatLookupKey(stale)! },
      })).toBe(0);
    } finally {
      await prisma.hostedLinqDelivery.deleteMany({ where: { linqChatLookupKey: chatKey } });
      await prisma.hostedThreadContainer.deleteMany({ where: { memberId } });
      await prisma.hostedMember.deleteMany({ where: { id: { in: [memberId, ownerId] } } });
      if (lineKey) await prisma.hostedLinqLine.deleteMany({ where: { phoneNumberLookupKey: lineKey } });
      await prisma.$disconnect();
    }
  },
);
