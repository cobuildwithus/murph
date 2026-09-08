import { randomInt, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import type { Message } from "@linqapp/sdk/resources/messages";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  applyHostedLinqDeliveryReceiptTx,
  recordHostedLinqRuntimeDeliveryOutcomeTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq-webhook";
import {
  retryHostedLinqTerminalSend,
  retryHostedLinqTerminalSendForEvent,
} from "@/src/lib/hosted-onboarding/linq-terminal-retry";
import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  revokeHostedConsentScope,
} from "@/src/lib/legal/consent";
import { createPrismaClient } from "@/src/lib/prisma";

const provider = vi.hoisted(() => ({
  log: vi.fn(),
  read: vi.fn<() => Promise<Message>>(),
  send: vi.fn<() => Promise<{ chatId: string; messageId: string }>>(),
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/linq-client")>(),
  readHostedLinqFailedMessage: provider.read,
  resendHostedLinqMessage: provider.send,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/logging")>(),
  logHostedOnboardingDiagnostic: provider.log,
  logHostedOnboardingWarning: provider.log,
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
  provider.log.mockReset();
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
  const grantConsent = () => prisma.hostedConsentGrant.create({
    data: {
      memberId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, status: "granted",
      documentVersionsJson: {}, source: "synthetic-test", grantedAt: new Date(),
    },
  });
  const withdrawConsent = () => revokeHostedConsentScope({
    memberId, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, prisma, source: "synthetic-test",
  });
  return {
    prisma, memberId, containerId, chatId, chatKey, lineKey, messageId, retryId,
    deliveryId, accepted, original, receipt, retry, grantConsent, withdrawConsent,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function pauseLegacyReceipt(
  f: Awaited<ReturnType<typeof seed>>,
  event: NonNullable<ReturnType<typeof parseHostedLinqProviderEvent>>,
  ingest = true,
) {
  const lookedUp = deferred();
  const resume = deferred();
  let paused = false;
  const pending = f.prisma.$transaction(async (tx) => {
    const delivery = new Proxy(tx.hostedLinqDelivery, {
      get(target, key) {
        if (key !== "findFirst") return Reflect.get(target, key);
        return async (...args: Parameters<typeof target.findFirst>) => {
          const value = await target.findFirst(...args);
          if (!paused) {
            paused = true;
            lookedUp.resolve();
            await resume.promise;
          }
          return value;
        };
      },
    });
    const prisma = new Proxy(tx, {
      get(target, key) { return key === "hostedLinqDelivery" ? delivery : Reflect.get(target, key); },
    });
    return ingest ? ingestHostedLinqProviderEventTx({ event, prisma })
      : applyHostedLinqDeliveryReceiptTx({ event, prisma });
  }, { timeout: 10_000 });
  await lookedUp.promise;
  return { pending, resume };
}

async function settleOrBlock(prisma: Awaited<ReturnType<typeof seed>>["prisma"], work: Promise<unknown>) {
  let settled = false;
  void work.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 200 && !settled; i++) {
    const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>(Prisma.sql`
      SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
        AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())) AS blocked
    `);
    if (row?.blocked) return;
    await delay(5);
  }
  if (!settled) throw new Error("Synthetic acceptance neither settled nor waited for its receipt lock.");
}

describe.skipIf(!enabled)("terminal Linq retry with PostgreSQL and provider boundary", () => {
  it("keeps successful acceptance quiet and explains failed-event skips and accepted retries", async () => {
    await withFixture(async (f) => {
      await f.retry();
      expect(provider.log).not.toHaveBeenCalled();
      const event = await f.receipt();
      provider.read.mockResolvedValue({ ...f.original, delivery_status: "pending" });
      await retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma });
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        trigger: "failure_webhook", stage: "retrieve", outcome: "skipped",
        reason: "provider_status_not_failed", attemptClaimed: false,
      }));
      provider.read.mockResolvedValue(f.original);
      await f.retry();
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        stage: "record", outcome: "accepted", reason: "replacement_accepted_delivery_unconfirmed", attemptClaimed: true,
      }));
      await f.retry();
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        reason: "original_already_replaced", attemptClaimed: false,
      }));
      const logged = JSON.stringify(provider.log.mock.calls);
      for (const privateValue of [f.chatId, f.messageId, f.retryId, f.original.from!, "Here is the requested document."]) {
        expect(logged).not.toContain(privateValue);
      }
    });
  });

  it("diagnoses retrieval and ambiguous-send errors without exposing provider prose", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      const error = new Error("synthetic private provider body and credential");
      provider.read.mockRejectedValue(error);
      await expect(f.retry()).rejects.toBe(error);
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        stage: "retrieve", outcome: "error", reason: "operation_failed", attemptClaimed: false,
      }));
      provider.read.mockResolvedValue(f.original);
      provider.send.mockRejectedValue(error);
      await expect(f.retry()).rejects.toBe(error);
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        stage: "send", outcome: "error", reason: "send_outcome_unknown", attemptClaimed: true,
      }));
      expect(JSON.stringify(provider.log.mock.calls)).not.toContain(error.message);
      await f.retry();
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({ reason: "attempt_already_consumed" }));
      expect(provider.send).toHaveBeenCalledTimes(1);
    });
  });

  it.each(["empty", "app", "audio", "sender", "expired", "missing"])("explains %s recovery exclusions", async (kind) => {
    await withFixture(async (f) => {
      const event = await f.receipt();
      if (kind === "missing") await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
      if (kind === "expired") await f.prisma.hostedLinqDelivery.update({
        where: { id: f.deliveryId }, data: { acceptedAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      if (kind === "empty") provider.read.mockResolvedValue({ ...f.original, parts: [] });
      if (kind === "sender") provider.read.mockResolvedValue({ ...f.original, from: "+15559999999" });
      if (kind === "app") provider.read.mockResolvedValue({ ...f.original, parts: [{
        type: "imessage_app", reactions: null, url: "https://example.test/private-card",
        app: { bundle_id: "test.app", team_id: "TEST", name: "Example" }, layout: { caption: "Private caption" },
      }] });
      if (kind === "audio") provider.read.mockResolvedValue({ ...f.original, parts: [{
        type: "media", id: "synthetic-audio", filename: "audio.m4a", mime_type: "audio/mp4",
        size_bytes: 100, reactions: null, url: "https://example.test/private-audio",
      }] });
      await retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma });
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        outcome: "skipped", attemptClaimed: false,
        reason: { empty: "content_missing", app: "app_card_not_reconstructible", audio: "audio_not_reconstructible",
          sender: "provider_sender_mismatch", expired: "delivery_expired", missing: "delivery_missing" }[kind],
      }));
      expect(provider.send).not.toHaveBeenCalled();
      expect(JSON.stringify(provider.log.mock.calls)).not.toContain("example.test");
      expect(JSON.stringify(provider.log.mock.calls)).not.toContain("Private caption");
    });
  });

  it("does not let diagnostic failures prevent or duplicate recovery", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      provider.log.mockImplementation(() => { throw new Error("logger unavailable"); });
      await f.retry();
      await f.retry();
      expect(provider.send).toHaveBeenCalledTimes(1);
    });
  });

  it.each(["original", "replacement"])("serializes a concurrent receipt before %s acceptance", async (kind) => {
    await withFixture(async (f) => {
      if (kind === "original") await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
      else await f.receipt();
      const event = parseHostedLinqProviderEvent({
        event: {
          api_version: "v3", webhook_version: "2026-02-03", event_id: `receipt-${randomUUID()}`,
          event_type: kind === "original" ? "message.failed" : "message.delivered",
          created_at: new Date().toISOString(),
          data: { chat_id: f.chatId, message_id: kind === "original" ? f.messageId : f.retryId,
            service: "iMessage", ...(kind === "original" ? { code: 4001, reason: "Message send failed" } : {}) },
        } as HostedLinqWebhookEvent,
      });
      if (!event) throw new Error("Synthetic receipt must parse.");
      const paused = await pauseLegacyReceipt(f, event);
      const acceptance = kind === "original" ? f.accepted() : f.retry();
      try { await settleOrBlock(f.prisma, acceptance); }
      finally { paused.resume.resolve(); }
      await Promise.all([paused.pending, acceptance]);
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true },
      })).toEqual({ status: kind === "original" ? "failed" : "delivered" });
      if (kind === "original") {
        await retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma });
        expect(provider.send).toHaveBeenCalledTimes(1);
      }
    });
  });

  it("does not let a legacy receipt that already read the parent overwrite a replacement", async () => {
    await withFixture(async (f) => {
      const event = await f.receipt();
      const paused = await pauseLegacyReceipt(f, event, false);
      try { await f.retry(); }
      finally { paused.resume.resolve(); }
      expect(await paused.pending).toMatchObject({ advanced: false });
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true },
      })).toEqual({ status: "accepted" });
      await f.receipt(f.retryId, "delivered");
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true },
      })).toEqual({ status: "delivered" });
    });
  });

  it.each(["granted", "missing-legacy"])("recovers with %s consent", async (consent) => {
    await withFixture(async (f) => {
      if (consent === "granted") await f.grantConsent();
      const event = await f.receipt();
      await retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma });
      expect(provider.read).toHaveBeenCalledTimes(1);
      expect(provider.send).toHaveBeenCalledTimes(1);
    });
  });

  it.each(["before-receipt", "during-retrieval"])(
    "honors completed consent withdrawal %s", async (withdrawal) => {
      await withFixture(async (f) => {
        await f.grantConsent();
        if (withdrawal === "before-receipt") {
          await f.withdrawConsent();
        } else {
          provider.read.mockImplementation(async () => {
            await f.withdrawConsent();
            return f.original;
          });
        }
        const event = await f.receipt();
        await retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma });
        expect(provider.read).toHaveBeenCalledTimes(withdrawal === "before-receipt" ? 0 : 1);
        expect(provider.send).not.toHaveBeenCalled();
        expect(await f.prisma.hostedLinqDeliveryMessage.count({
          where: { deliveryId: f.deliveryId, terminalRetryAttemptedAt: { not: null } },
        })).toBe(0);
      });
    },
  );

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
      await f.grantConsent();
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
        await f.retry();
        expect(provider.send).not.toHaveBeenCalled();
        expect(provider.read).not.toHaveBeenCalled();
        expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
          stage: "policy", outcome: "skipped", attemptClaimed: false,
          reason: { disabled: "operator_disabled", FLAGGED: "line_flagged", CRITICAL: "line_critical",
            unhealthy: "delivery_unhealthy", OPTED_OUT: "chat_opted_out", suspended: "hosted_access_inactive",
            "route-changed": "route_mismatch" }[restriction],
        }));
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
