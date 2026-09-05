import { randomInt, randomUUID } from "node:crypto";
import type { Message } from "@linqapp/sdk/resources/messages";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  recordHostedLinqRuntimeDeliveryOutcomeTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq-webhook";
import { retryHostedLinqTerminalSend } from "@/src/lib/hosted-onboarding/linq-terminal-retry";
import { createPrismaClient } from "@/src/lib/prisma";

const provider = vi.hoisted(() => ({
  read: vi.fn<() => Promise<Message>>(),
  send: vi.fn<() => Promise<{ chatId: string; messageId: string }>>(),
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/linq-client")>(),
  readHostedLinqFailedMessage: provider.read,
  resendHostedLinqMessage: provider.send,
}));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/(murph_test|murph_dev_[a-z0-9_]+)$/u.test(url.pathname)
  ) throw new Error("Terminal retry proof requires an explicitly selected local test database.");
}

async function withFixture(run: (fixture: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  const fixture = await seed();
  try {
    await run(fixture);
  } finally {
    const { prisma, chatKey, lineKey, memberId, containerId } = fixture;
    await prisma.hostedLinqAlert.deleteMany({ where: { phoneNumberLookupKey: lineKey } });
    await prisma.hostedLinqProviderEvent.deleteMany({ where: { linqChatLookupKey: chatKey } });
    await prisma.hostedLinqDelivery.deleteMany({ where: { linqChatLookupKey: chatKey } });
    await prisma.hostedMember.deleteMany({ where: { id: containerId } });
    await prisma.hostedMember.deleteMany({ where: { id: memberId } });
    await prisma.hostedLinqLine.delete({ where: { phoneNumberLookupKey: lineKey } });
    await prisma.$disconnect();
  }
}

async function seed() {
  provider.read.mockReset();
  provider.send.mockReset();
  const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
  const nonce = randomUUID();
  const memberId = `retry-member-${nonce}`;
  const containerId = `retry-container-${nonce}`;
  const chatId = `retry-chat-${nonce}`;
  const messageId = `retry-original-${nonce}`;
  const retryId = `retry-replacement-${nonce}`;
  const idempotencyKey = `retry-intent-${nonce}`;
  const phoneNumber = `+1555000${randomInt(1000, 9999)}`;
  const chatKey = createHostedLinqChatLookupKey(chatId)!;
  const lineKey = createHostedPhoneLookupKey(phoneNumber)!;
  let receiptTime = Date.now() - 5_000;
  await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  await prisma.hostedMemberRouting.create({
    data: { memberId, linqChatLookupKey: chatKey, linqRecipientPhoneLookupKey: lineKey },
  });
  await prisma.hostedLinqLine.create({
    data: {
      phoneNumberLookupKey: lineKey, phoneNumberHint: "*** 0000",
      configuredAt: new Date(), healthStatus: "healthy", egressPolicy: "enabled",
      providerReputationStatus: "HEALTHY", providerServiceStatus: "ACTIVE",
    },
  });
  const accepted = (messageIds = [messageId], threadIsDirect = true) =>
    recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt: new Date(Date.now() - 10_000),
      attemptedAt: new Date(Date.now() - 11_000),
      idempotencyKey, linqChatId: chatId,
      messageId: messageIds.at(-1), messageIds,
      phoneNumberLookupKey: lineKey, sourceRef: idempotencyKey,
      targetKind: "thread", threadIsDirect, userId: memberId, prisma,
    });
  const result = await accepted();
  if (!result.deliveryId) throw new Error("Synthetic acceptance must have a delivery.");
  const deliveryId = result.deliveryId;
  const original: Message = {
    id: messageId, chat_id: chatId,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    is_from_me: true, is_delivered: false, is_read: false,
    delivery_status: "failed", service: "iMessage", from: phoneNumber,
    parts: [{ type: "text", value: "Here is the requested document.", reactions: null }],
  };
  provider.read.mockResolvedValue(original);
  provider.send.mockResolvedValue({ chatId, messageId: retryId });
  const receipt = async (
    id = messageId,
    status: "failed" | "delivered" = "failed",
    reason = "Message send failed",
  ) => {
    receiptTime += 100;
    const event = parseHostedLinqProviderEvent({
      event: {
        api_version: "v3", webhook_version: "2026-02-03",
        event_id: `retry-receipt-${randomUUID()}`,
        event_type: `message.${status}`, created_at: new Date(receiptTime).toISOString(),
        data: {
          chat_id: chatId, message_id: id, service: "iMessage",
          ...(status === "failed" ? { code: 4001, reason } : {}),
        },
      } as HostedLinqWebhookEvent,
    });
    if (!event) throw new Error("Synthetic receipt must parse.");
    await prisma.$transaction((tx) => ingestHostedLinqProviderEventTx({ event, prisma: tx }));
    return event;
  };
  const retry = (id = messageId) => retryHostedLinqTerminalSend({ chatId, messageId: id, prisma });
  return {
    prisma, memberId, containerId, chatId, chatKey, lineKey, messageId, retryId,
    deliveryId, accepted, original, receipt, retry,
  };
}

describe.skipIf(!enabled)("terminal Linq retry with PostgreSQL and provider boundary", () => {
  it("recovers once under concurrent attempts, then ignores original and duplicate receipts", async () => {
    await withFixture(async (f) => {
      await f.retry();
      expect(provider.read).not.toHaveBeenCalled();
      const event = await f.receipt();
      await Promise.all([f.retry(), f.retry(), f.retry()]);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(provider.send).toHaveBeenCalledWith({
        chatId: f.chatId,
        message: {
          idempotency_key: expect.stringContaining("terminal-retry:"),
          preferred_service: "iMessage",
          parts: [{ type: "text", value: "Here is the requested document." }],
        },
      });
      await f.prisma.$transaction((tx) => ingestHostedLinqProviderEventTx({ event, prisma: tx }));
      await f.retry();
      await f.receipt(f.retryId, "delivered");
      await f.receipt(); // A newer event for the replaced original is still stale.
      await f.accepted(); // Replaying the original callback must keep the replacement active.
      await f.retry();
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true },
      })).toEqual({ status: "delivered" });
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await f.prisma.hostedLinqLine.findUnique({
        where: { phoneNumberLookupKey: f.lineKey },
        select: { totalOutboundCount: true, totalFailedCount: true, healthStatus: true },
      })).toEqual({ totalOutboundCount: 2, totalFailedCount: 1, healthStatus: "healthy" });
    });
  });

  it("stops after the replacement fails and after an ambiguous send response", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      await f.retry();
      await f.receipt(f.retryId);
      await f.retry(f.retryId);
      await f.retry();
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true },
      })).toEqual({ status: "failed" });
    });
    await withFixture(async (f) => {
      await f.receipt();
      provider.send.mockRejectedValue(new Error("synthetic transport ambiguity"));
      await expect(f.retry()).rejects.toThrow("synthetic transport ambiguity");
      await f.retry();
      expect(provider.send).toHaveBeenCalledTimes(1);
    });
  });

  it("catches up a failure received before original acceptance and a receipt before retry acceptance", async () => {
    await withFixture(async (f) => {
      await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
      await f.receipt();
      await f.retry();
      expect(provider.read).not.toHaveBeenCalled();
      await f.accepted();
      provider.send.mockImplementation(async () => {
        await f.receipt(f.retryId, "delivered");
        return { chatId: f.chatId, messageId: f.retryId };
      });
      await f.retry();
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true },
      })).toEqual({ status: "delivered" });
    });
  });

  it("retries only the failed part of a group delivery and preserves no-receipt status", async () => {
    await withFixture(async (f) => {
      await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
      await f.prisma.hostedMember.create({
        data: {
          id: f.containerId, billingStatus: "active",
          threadContainer: { create: { ownerMemberId: f.memberId } },
        },
      });
      await f.prisma.hostedThreadRoute.create({
        data: {
          channel: "linq", accountLookupKey: f.lineKey, containerMemberId: f.containerId,
          threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey({
            channel: "linq", threadId: f.chatId,
          })!,
          threadLookupKey: createHostedExternalThreadLookupKey({
            channel: "linq", threadId: f.chatId, accountLookupKey: f.lineKey,
          })!,
        },
      });
      const siblingId = `sibling-${f.messageId}`;
      await f.accepted([siblingId, f.messageId], false);
      await f.receipt(siblingId, "delivered");
      await f.receipt();
      await f.retry();
      expect(provider.read).toHaveBeenCalledWith(f.messageId);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true },
      })).toEqual({ status: "sent_no_receipt_expected" });
      await f.receipt(f.retryId, "delivered");
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true },
      })).toEqual({ status: "delivered" });
    });
  });

  it.each(["disabled", "FLAGGED", "CRITICAL", "unhealthy", "OPTED_OUT", "suspended", "route-changed"])(
    "respects current restriction %s", async (restriction) => {
      await withFixture(async (f) => {
        await f.receipt();
        if (restriction === "suspended") {
          await f.prisma.hostedMember.update({
            where: { id: f.memberId }, data: { suspendedAt: new Date() },
          });
        } else if (restriction === "route-changed") {
          await f.prisma.hostedMemberRouting.update({
            where: { memberId: f.memberId }, data: { linqChatLookupKey: null },
          });
        } else if (restriction === "OPTED_OUT") {
          await f.prisma.hostedLinqChatHealth.create({
            data: {
              linqChatLookupKey: f.chatKey, phoneNumberLookupKey: f.lineKey,
              providerStatus: restriction, providerUpdatedAt: new Date(), providerObservedAt: new Date(),
            },
          });
        } else {
          await f.prisma.hostedLinqLine.update({
            where: { phoneNumberLookupKey: f.lineKey },
            data: {
              ...(restriction === "disabled" ? { egressPolicy: "disabled" } : {}),
              ...(restriction === "FLAGGED" ? { providerServiceStatus: "FLAGGED" } : {}),
              ...(restriction === "CRITICAL" ? { providerReputationStatus: "CRITICAL" } : {}),
              ...(restriction === "unhealthy" ? { healthStatus: "unhealthy" } : {}),
            },
          });
        }
        await f.retry().catch((error: unknown) => {
          if (restriction !== "suspended") throw error;
        });
        expect(provider.send).not.toHaveBeenCalled();
        expect(provider.read).not.toHaveBeenCalled();
      });
    },
  );

  it("rechecks restrictions after retrieval, and refuses ambiguous or mismatched provider evidence", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      provider.read.mockImplementation(async () => {
        await f.prisma.hostedLinqLine.update({
          where: { phoneNumberLookupKey: f.lineKey }, data: { egressPolicy: "disabled" },
        });
        return f.original;
      });
      await f.retry();
      expect(provider.send).not.toHaveBeenCalled();
    });
    await withFixture(async (f) => {
      await f.receipt(f.messageId, "failed", "Message delivery failed");
      await f.retry();
      expect(provider.read).not.toHaveBeenCalled();
      await f.receipt();
      provider.read.mockResolvedValue({ ...f.original, delivery_status: "delivered" });
      await f.retry();
      provider.read.mockResolvedValue({ ...f.original, chat_id: "different-chat" });
      await f.retry();
      provider.read.mockResolvedValue({ ...f.original, is_from_me: false });
      await f.retry();
      expect(provider.send).not.toHaveBeenCalled();
      expect(await f.prisma.hostedLinqDeliveryMessage.count({
        where: { deliveryId: f.deliveryId },
      })).toBe(0);
    });
  });

  it("does not retry expired deliveries or consume another attempt after an invalid send identity", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      await f.prisma.hostedLinqDelivery.update({
        where: { id: f.deliveryId },
        data: { acceptedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
      });
      await f.retry();
      expect(provider.read).not.toHaveBeenCalled();
      expect(provider.send).not.toHaveBeenCalled();
    });
    await withFixture(async (f) => {
      await f.receipt();
      provider.send.mockResolvedValue({ chatId: f.chatId, messageId: f.messageId });
      await expect(f.retry()).rejects.toThrow("expected identity");
      await f.retry();
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true },
      })).toEqual({ status: "failed" });
    });
  });
});
