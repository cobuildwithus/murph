import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import type { Message } from "@linqapp/sdk/resources/messages";
import type { Response as OpenAiResponse } from "openai/resources/responses/responses";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
  createHostedLinqChatLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  applyHostedLinqDeliveryReceiptTx,
  recordHostedLinqRuntimeDeliveryOutcomeTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import { buildHostedLinqInviteSignupEffectId } from "@/src/lib/hosted-onboarding/linq-invite-signup-effect-id";
import { completeHostedLinqInstantFirstTurn } from "@/src/lib/hosted-onboarding/linq-instant-first-turn";
import { buildHostedMemberRoutingPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";
import { readHostedMailboxWakeByItemId } from "@/src/lib/hosted-mailbox/store";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq-webhook";
import {
  retryHostedLinqTerminalSend,
  processHostedLinqTerminalRetry,
  retryHostedLinqTerminalSendForEvent,
} from "@/src/lib/hosted-onboarding/linq-terminal-retry";
import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  revokeHostedConsentScope,
} from "@/src/lib/legal/consent";
import { createPrismaClient } from "@/src/lib/prisma";

const provider = vi.hoisted(() => ({
  firstTurnSend: vi.fn<typeof import("@/src/lib/hosted-onboarding/linq-client").sendHostedLinqChatMessage>(),
  log: vi.fn(),
  start: vi.fn(async (_input: Record<string, unknown>) => ({ runId: "synthetic-retry-workflow" })),
  read: vi.fn<() => Promise<Message>>(),
  send: vi.fn<(input: { chatId: string; message: import("@linqapp/sdk/resources").MessageContent }) => Promise<{ chatId: string; messageId: string }>>(),
}));
vi.mock("@/src/lib/hosted-onboarding/linq-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/linq-client")>(),
  readHostedLinqFailedMessage: provider.read,
  resendHostedLinqMessage: provider.send,
  sendHostedLinqChatMessage: provider.firstTurnSend,
}));

vi.mock("@/src/lib/hosted-onboarding/workflow-start", () => ({ startHostedPointerWorkflow: provider.start }));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  recordHostedAiUsageRecords: vi.fn(async () => ({ recordedIds: [] })),
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
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.search
    || !/^\/(murph_test(?:_[a-z0-9_]+)?|murph_dev_[a-z0-9_]+)$/u.test(url.pathname)
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
  provider.start.mockClear();
  provider.firstTurnSend.mockReset();
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
  const epoch = Date.now() - 10_000;
  const at = (offsetMs: number) => new Date(epoch + offsetMs);
  let receiptTime = epoch + 5_000;
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
  const accepted = (
    messageIds = [messageId], threadIsDirect = true,
    client: Prisma.TransactionClient = prisma,
  ) =>
    recordHostedLinqRuntimeDeliveryOutcomeTx({
      acceptedAt: new Date(Date.now() - 10_000),
      attemptedAt: new Date(Date.now() - 11_000),
      idempotencyKey, linqChatId: chatId,
      messageId: messageIds.at(-1), messageIds,
      phoneNumberLookupKey: lineKey, sourceRef: idempotencyKey,
      targetKind: "thread", threadIsDirect, userId: memberId, prisma: client,
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
  const ingest = (event: NonNullable<ReturnType<typeof parseHostedLinqProviderEvent>>) =>
    prisma.$transaction((tx) => ingestHostedLinqProviderEventTx({ event, prisma: tx }));
  const receipt = async (
    id = messageId,
    status: "failed" | "delivered" = "failed",
    reason = "Message send failed",
    service: string | null = "iMessage",
  ) => {
    receiptTime += 100;
    const event = parseHostedLinqProviderEvent({
      event: {
        api_version: "v3", webhook_version: "2026-02-03",
        event_id: `retry-receipt-${randomUUID()}`,
        event_type: `message.${status}`, created_at: new Date(receiptTime).toISOString(),
        data: {
          chat_id: chatId, message_id: id, service,
          ...(status === "failed" ? { code: 4001, reason } : {}),
        },
      } as HostedLinqWebhookEvent,
    });
    if (!event) throw new Error("Synthetic receipt must parse.");
    await ingest(event);
    return event;
  };
  const retry = async (id = messageId) => {
    await retryHostedLinqTerminalSend({ chatId, messageId: id, prisma });
    // Advance only this synthetic row's durable timer; production never bypasses it.
    await prisma.hostedLinqDeliveryMessage.updateMany({
      where: { deliveryId, messageLookupKey: { in: createHostedLinqMessageLookupKeyReadCandidates(id) },
        terminalRetryNextAt: { not: null } },
      data: { terminalRetryNextAt: new Date(Date.now() - 1) },
    });
    await retryHostedLinqTerminalSend({ chatId, messageId: id, prisma, execute: true });
  };
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
    deliveryId, accepted, at, ingest, original, receipt, retry, grantConsent, withdrawConsent, phoneNumber,
  };
}

// All evidence below passes through the production parser and receipt store.
function timingReceipt(f: Awaited<ReturnType<typeof seed>>, input: {
  eventAt: Date;
  deliveredAt?: unknown;
  messageId?: string;
  status?: "delivered" | "failed";
  webhookVersion?: "2026-02-03" | "2025-01-01";
}) {
  const status = input.status ?? "delivered";
  const lifecycle = input.deliveredAt instanceof Date
    ? input.deliveredAt.toISOString() : input.deliveredAt;
  const event = parseHostedLinqProviderEvent({ event: {
    api_version: "v3", webhook_version: input.webhookVersion ?? "2026-02-03",
    event_id: `timing-receipt-${randomUUID()}`, event_type: `message.${status}`,
    created_at: input.eventAt.toISOString(),
    data: {
      chat_id: f.chatId, service: "iMessage",
      ...(input.webhookVersion === "2025-01-01"
        ? { message: { id: input.messageId ?? f.messageId, delivered_at: lifecycle } }
        : { message_id: input.messageId ?? f.messageId, delivered_at: lifecycle }),
      ...(status === "failed" ? { code: 4001, reason: "Message send failed" } : {}),
    },
  } as HostedLinqWebhookEvent });
  if (!event) throw new Error("Synthetic delivery timing receipt must parse.");
  return event;
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
  it.each(["delivered", "failed", "no-receipt"] as const)("preserves %s through the exported first-turn completion transaction", async (outcome) => {
    await withFixture(async (f) => {
      // Let the real completion flow create its own unbound parent and payload.
      await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
      await f.prisma.hostedMemberRouting.update({ where: { memberId: f.memberId }, data:
        await buildHostedMemberRoutingPrivateColumns({
          linqChatId: f.chatId, linqRecipientPhone: f.phoneNumber, memberId: f.memberId,
          pendingLinqChatId: null, pendingLinqRecipientPhone: null,
          telegramThreadId: null, telegramUserId: null, prisma: f.prisma,
        }),
      });
      const acceptedAt = f.at(1_000);
      const event = outcome === "no-receipt" ? null : timingReceipt(f, {
        eventAt: f.at(10_000), deliveredAt: f.at(2_000), status: outcome,
      });
      const sent = deferred();
      const returnAcceptance = deferred();
      provider.firstTurnSend.mockImplementationOnce(async () => {
        sent.resolve();
        await returnAcceptance.promise;
        return { chatId: f.chatId, messageId: f.messageId, messageCreatedAt: acceptedAt.toISOString() };
      });
      const input = {
        inboundMessageId: `inbound-${f.messageId}`,
        participantContact: { kind: "phone" as const, lookupKey: f.lineKey, value: f.phoneNumber },
        prisma: f.prisma, recipientPhoneNumber: f.phoneNumber, service: "iMessage",
        wakeHandoff: {
          eventId: `first-turn-${f.messageId}`, linqChatId: f.chatId,
          mailboxItemId: `inbound-${f.messageId}`, source: "linq" as const, userId: f.memberId,
          wakeMailboxCheckpoint: { lane: "conversation" as const, laneSeq: "1" },
        },
      };
      const message = "Hey! What would you like help with?";
      const completion = completeHostedLinqInstantFirstTurn({
        ...input,
        generation: { kind: "reply", message, usage: {
          requestedModel: "gpt-5.6-luna",
          // Same narrow accounting fixture as the first-turn unit tests.
          response: { id: "resp_first_turn", model: "gpt-5.6-luna", service_tier: "default", usage: {
            input_tokens: 90, input_tokens_details: { cached_tokens: 0 },
            output_tokens: 22, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 112,
          } } as OpenAiResponse,
        } },
      });
      const readParent = () => f.prisma.hostedLinqDelivery.findFirstOrThrow({
        where: { linqChatLookupKey: f.chatKey, source: "hosted_web_instant_first_turn" },
      });
      let paused: Awaited<ReturnType<typeof pauseLegacyReceipt>> | undefined;
      try {
        await Promise.race([sent.promise, completion.then(() => {
          throw new Error("First-turn completion did not reach provider dispatch.");
        })]);
        // The dispatch transaction has committed before either the receipt or finalization starts.
        const parent = await readParent();
        expect(parent).toMatchObject({ acceptedAt: null, messageLookupKey: null, status: "provider_dispatch_started" });
        expect(parent.payloadCiphertext).not.toBeNull();
        expect(await f.prisma.hostedLinqDeliveryMessage.count({ where: { deliveryId: parent.id } })).toBe(0);
        if (event) {
          paused = await pauseLegacyReceipt(f, event);
          expect(await f.prisma.hostedLinqProviderEvent.count({ where: { linqChatLookupKey: f.chatKey } })).toBe(0);
        }
        returnAcceptance.resolve();
        if (event) await settleOrBlock(f.prisma, completion);
        else await completion;
        // No delivery/routing row lock from dispatch may survive into this receipt wait.
        await f.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM hosted_linq_delivery WHERE id = ${parent.id} FOR UPDATE NOWAIT`;
          await tx.$queryRaw`SELECT 1 FROM hosted_member_routing WHERE member_id = ${f.memberId} FOR UPDATE NOWAIT`;
        });
      } finally {
        returnAcceptance.resolve();
        paused?.resume.resolve();
        await Promise.allSettled([completion, paused?.pending]);
      }
      if (paused) expect(await paused.pending).toMatchObject({ duplicate: false });
      const result = await completion;
      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") throw new Error("First-turn acceptance must retain Web ownership.");
      const parent = await readParent();
      expect(parent).toMatchObject({
        acceptedAt, status: outcome === "no-receipt" ? "accepted" : outcome,
        lastReceiptAt: event ? f.at(10_000) : null,
        deliveredAt: outcome === "delivered" ? f.at(2_000) : null,
        failedAt: outcome === "failed" ? f.at(10_000) : null,
        payloadCiphertext: null, payloadOwnerMemberId: null, payloadSchema: null,
      });
      expect(createHostedLinqMessageLookupKeyReadCandidates(f.messageId)).toContain(parent.messageLookupKey);
      const items = await f.prisma.hostedMailboxItem.findMany({ where: { userId: f.memberId } });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: result.wakeHandoff.mailboxItemId, kind: "conversation.message", lane: "conversation",
        occurredAt: acceptedAt, consumedAt: null,
      });
      expect(result.wakeHandoff.wakeMailboxCheckpoint).toEqual({ lane: "conversation", laneSeq: items[0]!.laneSeq.toString() });
      expect(await readHostedMailboxWakeByItemId({ mailboxItemId: items[0]!.id, prisma: f.prisma })).toMatchObject({
        kind: "conversation.message", userId: f.memberId,
        message: { channel: "linq", linqMessage: {
          chatId: f.chatId, messageId: f.messageId, isFromMe: true,
          replyToMessageId: input.inboundMessageId, parts: [{ type: "text", value: message }],
        } },
      });
      await expect(completeHostedLinqInstantFirstTurn({ ...input, generation: { kind: "resume" } })).resolves.toEqual(result);
      if (event) expect(await f.ingest(event)).toMatchObject({ duplicate: true });
      expect(await readParent()).toEqual(parent);
      expect(await f.prisma.hostedMailboxItem.findMany({ where: { userId: f.memberId } })).toEqual(items);
      expect(provider.firstTurnSend).toHaveBeenCalledTimes(1);
      expect(provider.read).not.toHaveBeenCalled();
      expect(provider.send).not.toHaveBeenCalled();
    });
  });

  it.each(["scalar", "owned"])("keeps first %s delivery through duplicates, reordering, failure and callback replay", async (owner) => {
    await withFixture(async (f) => {
      const messageIds = owner === "owned" ? [f.messageId, `${f.messageId}-part-2`] : [f.messageId];
      if (owner === "owned") {
        await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
        await f.accepted(messageIds);
      }
      const read = () => f.prisma.hostedLinqDelivery.findUniqueOrThrow({
        where: { id: f.deliveryId }, select: { status: true, deliveredAt: true, lastReceiptAt: true, lastProviderEventId: true },
      });
      await f.ingest(timingReceipt(f, { eventAt: f.at(10_000), deliveredAt: f.at(2_000) }));
      if (owner === "owned") {
        expect(await read()).toMatchObject({ status: "accepted", deliveredAt: null });
        await f.ingest(timingReceipt(f, {
          messageId: messageIds[1], eventAt: f.at(12_000), deliveredAt: f.at(1_500),
        }));
      }
      await f.ingest(timingReceipt(f, { eventAt: f.at(600_000), deliveredAt: f.at(590_000) }));
      const latest = await read();
      expect(latest).toMatchObject({ status: "delivered", deliveredAt: f.at(2_000), lastReceiptAt: f.at(600_000) });
      const line = await f.prisma.hostedLinqLine.findUniqueOrThrow({ where: { phoneNumberLookupKey: f.lineKey } });
      const earlier = timingReceipt(f, { eventAt: f.at(500_000), deliveredAt: f.at(1_000), webhookVersion: "2025-01-01" });
      expect(await f.ingest(earlier)).toMatchObject({ duplicate: false });
      expect(await read()).toEqual({ ...latest, deliveredAt: f.at(owner === "owned" ? 1_500 : 1_000) });
      expect(await f.ingest(earlier)).toMatchObject({ duplicate: true });
      expect(await f.prisma.hostedLinqLine.findUniqueOrThrow({ where: { phoneNumberLookupKey: f.lineKey } })).toEqual(line);

      await f.ingest(timingReceipt(f, { eventAt: f.at(700_000), status: "failed" }));
      const failure = await read();
      await f.ingest(timingReceipt(f, { eventAt: f.at(650_000), deliveredAt: f.at(500) }));
      expect(await read()).toEqual({ ...failure, status: "failed", deliveredAt: owner === "owned" ? null : f.at(500) });
      if (owner === "owned") {
        expect(await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({
          where: { deliveryId: f.deliveryId, ordinal: 0 },
        })).toMatchObject({ status: "failed", deliveredAt: f.at(500), lastReceiptAt: f.at(700_000) });
      }
      await f.ingest(timingReceipt(f, { eventAt: f.at(800_000), deliveredAt: f.at(790_000) }));
      const recovered = await read();
      expect(recovered).toMatchObject({
        status: "delivered", deliveredAt: f.at(owner === "owned" ? 1_500 : 500), lastReceiptAt: f.at(800_000),
      });
      await f.accepted(messageIds);
      expect(await read()).toEqual(recovered);
      expect(provider.send).not.toHaveBeenCalled();
    });
  });

  it.each([
    { owner: "scalar", legacyMetadata: false }, { owner: "owned", legacyMetadata: false },
    { owner: "scalar", legacyMetadata: true }, { owner: "owned", legacyMetadata: true },
  ])("catches up first delivery beyond the latest-status window: $owner, legacy metadata=$legacyMetadata", async ({ owner, legacyMetadata }) => {
    await withFixture(async (f) => {
      const ids = Array.from({ length: owner === "owned" ? 10 : 1 }, (_, i) =>
        i === 0 ? f.messageId : `${f.messageId}-part-${i + 1}`);
      const aggregates: Prisma.Sql[] = [];
      let activeAggregates = 0;
      let peakAggregates = 0;
      const observe = (tx: Prisma.TransactionClient): Prisma.TransactionClient =>
        new Proxy(tx, {
          get(target, key) {
            if (key === "$transaction") {
              // Keep observing the real nested transaction used by the store.
              return (operation: (nested: Prisma.TransactionClient) => Promise<unknown>) =>
                target.$transaction((nested) => operation(observe(nested)));
            }
            if (key !== "$queryRaw") return Reflect.get(target, key);
            return async (...args: Parameters<typeof target.$queryRaw>) => {
              const [sql] = args;
              if (!("sql" in sql) || !sql.sql.includes("SELECT MIN(COALESCE(")) {
                return target.$queryRaw(...args);
              }
              // Observe the actual SQL and await the real database, without replacing it.
              aggregates.push(sql);
              peakAggregates = Math.max(peakAggregates, ++activeAggregates);
              try { return await target.$queryRaw(...args); } finally { activeAggregates--; }
            };
          },
        });
      const accept = () => f.prisma.$transaction((tx) => f.accepted(ids, owner !== "owned", observe(tx)));
      await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
      await accept(); // No receipt: no added aggregate, including the ten-part group path.
      expect(aggregates).toHaveLength(0);
      expect(await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).toMatchObject({
        status: owner === "owned" ? "sent_no_receipt_expected" : "accepted", deliveredAt: null,
      });
      await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
      await f.ingest(timingReceipt(f, { eventAt: f.at(10_000), deliveredAt: f.at(2_000) }));
      if (legacyMetadata) {
        // Pre-fix stored receipts have no lifecycle metadata; their event time is the fallback.
        await f.prisma.hostedLinqProviderEvent.updateMany({
          where: { linqChatLookupKey: f.chatKey }, data: { payloadSanitizedJson: Prisma.DbNull },
        });
      }
      for (let i = 0; i < 21; i++) {
        await f.ingest(timingReceipt(f, { eventAt: f.at(60_000 + i * 1_000), deliveredAt: f.at(50_000 + i * 1_000) }));
      }
      await f.ingest(timingReceipt(f, { eventAt: f.at(90_000), deliveredAt: "invalid" }));
      for (let i = 1; i < ids.length; i++) {
        await f.ingest(timingReceipt(f, {
          messageId: ids[i], eventAt: f.at(30_000 + i * 1_000),
          deliveredAt: f.at((i + 1) * 2_000), webhookVersion: "2025-01-01",
        }));
      }
      await accept();
      expect(aggregates.map((sql) => sql.values)).toEqual(
        ids.map((id) => createHostedLinqMessageLookupKeyReadCandidates(id)),
      );
      for (const sql of aggregates) {
        expect(sql.sql).toMatch(/FROM hosted_linq_provider_event\s+WHERE message_lookup_key IN \([?,\s]+\)\s+AND delivery_status = 'delivered'\s*$/u);
      }
      expect(peakAggregates).toBe(1);
      expect(activeAggregates).toBe(0);
      expect(await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).toMatchObject({
        status: "delivered", lastReceiptAt: f.at(90_000),
        deliveredAt: f.at(owner === "owned" ? 20_000 : legacyMetadata ? 10_000 : 2_000),
      });
      if (owner === "owned") expect(await f.prisma.hostedLinqDeliveryMessage.findMany({
        where: { deliveryId: f.deliveryId }, orderBy: { ordinal: "asc" },
        select: { deliveredAt: true, lastReceiptAt: true },
      })).toEqual(ids.map((_, i) => ({
        deliveredAt: f.at(i === 0 ? legacyMetadata ? 10_000 : 2_000 : (i + 1) * 2_000),
        lastReceiptAt: f.at(i === 0 ? 90_000 : 30_000 + i * 1_000),
      })));
      expect(provider.read).not.toHaveBeenCalled();
      expect(provider.send).not.toHaveBeenCalled();
    });
  });

  it.each(["scalar", "owned"])("retains %s buffered first delivery when the latest receipt is failed", async (owner) => {
    await withFixture(async (f) => {
      await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
      await f.ingest(timingReceipt(f, { eventAt: f.at(2_000) })); // Missing lifecycle uses event time.
      await f.ingest(timingReceipt(f, { eventAt: f.at(20_000), status: "failed" }));
      const ids = owner === "owned" ? [f.messageId, `${f.messageId}-part-2`] : [f.messageId];
      if (owner === "owned") await f.ingest(timingReceipt(f, { messageId: ids[1], eventAt: f.at(1_000) }));
      await f.accepted(ids);
      expect(await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).toMatchObject({
        status: "failed", lastReceiptAt: f.at(20_000), deliveredAt: owner === "owned" ? null : f.at(2_000),
      });
      await f.ingest(timingReceipt(f, { eventAt: f.at(30_000), deliveredAt: "invalid" }));
      expect(await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).toMatchObject({
        status: "delivered", lastReceiptAt: f.at(30_000), deliveredAt: f.at(2_000),
      });
    });
  });

  it.each(["scalar", "owned"])("converges concurrent %s delivery evidence to minimum timing and latest event", async (owner) => {
    await withFixture(async (f) => {
      if (owner === "owned") {
        await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
        await f.accepted([f.messageId, `${f.messageId}-part-2`]);
        await f.ingest(timingReceipt(f, { messageId: `${f.messageId}-part-2`, eventAt: f.at(500) }));
      }
      await Promise.all([[8_000, 5_000], [30_000, 2_000], [25_000, 1_000], [10_000, 3_000]].map(([eventAt, deliveredAt]) =>
        f.ingest(timingReceipt(f, { eventAt: f.at(eventAt!), deliveredAt: f.at(deliveredAt!) })),
      ));
      expect(await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).toMatchObject({
        status: "delivered", deliveredAt: f.at(1_000), lastReceiptAt: f.at(30_000),
      });
    });
  });

  it.each(["scalar", "owned"])("does not repeat %s onboarding effects for later or reordered delivered notifications", async (owner) => {
    await withFixture(async (f) => {
      if (owner === "owned") {
        await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
        await f.accepted([f.messageId, `${f.messageId}-part-2`]);
        await f.ingest(timingReceipt(f, { messageId: `${f.messageId}-part-2`, eventAt: f.at(500) }));
      }
      await f.prisma.hostedLinqDelivery.update({ where: { id: f.deliveryId }, data: {
        template: "invite_signup",
        sourceRef: buildHostedLinqInviteSignupEffectId({ memberId: f.memberId, occurredAt: f.at(0) }),
      } });
      expect((await f.ingest(timingReceipt(f, { eventAt: f.at(10_000), deliveredAt: f.at(2_000) }))).restoreOnboardingLink)
        .toMatchObject({ memberId: f.memberId });
      expect((await f.ingest(timingReceipt(f, { eventAt: f.at(30_000), deliveredAt: f.at(20_000) }))).restoreOnboardingLink)
        .toBeUndefined();
      expect((await f.ingest(timingReceipt(f, { eventAt: f.at(20_000), deliveredAt: f.at(1_000) }))).restoreOnboardingLink)
        .toBeUndefined();
      await f.ingest(timingReceipt(f, { eventAt: f.at(40_000), status: "failed" }));
      expect((await f.ingest(timingReceipt(f, { eventAt: f.at(50_000) }))).restoreOnboardingLink)
        .toMatchObject({ memberId: f.memberId });
    });
  });

  it("resets original timing and catches up only replacement delivery evidence", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      provider.send.mockImplementation(async () => {
        await f.ingest(timingReceipt(f, { eventAt: f.at(8_000), deliveredAt: f.at(1_000) }));
        await f.ingest(timingReceipt(f, { messageId: f.retryId, eventAt: f.at(9_000), deliveredAt: f.at(6_000) }));
        await f.ingest(timingReceipt(f, { messageId: f.retryId, eventAt: f.at(600_000), deliveredAt: f.at(590_000) }));
        return { chatId: f.chatId, messageId: f.retryId };
      });
      await f.retry();
      const current = await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } });
      expect(current).toMatchObject({ status: "delivered", deliveredAt: f.at(6_000), lastReceiptAt: f.at(600_000) });
      await f.ingest(timingReceipt(f, { eventAt: f.at(700_000), deliveredAt: f.at(500) }));
      expect(await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).toEqual(current);
      expect(provider.send).toHaveBeenCalledTimes(1);
    });
  });

  it("never resends a message with first-delivery evidence despite a later failure", async () => {
    await withFixture(async (f) => {
      await f.ingest(timingReceipt(f, { eventAt: f.at(2_000), deliveredAt: f.at(1_000) }));
      await f.receipt();
      provider.send.mockRejectedValue(new Error("synthetic ambiguous send"));
      await f.retry();
      expect(provider.send).not.toHaveBeenCalled();
      expect(await f.prisma.hostedLinqDeliveryMessage.count({ where: { deliveryId: f.deliveryId } })).toBe(0);
      await f.ingest(timingReceipt(f, { eventAt: f.at(20_000), deliveredAt: f.at(19_000) }));
      expect(await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } }))
        .toMatchObject({ status: "delivered", deliveredAt: f.at(1_000) });
    });
  });

  it("keeps successful acceptance quiet and explains failed-event skips and accepted retries", async () => {
    await withFixture(async (f) => {
      await f.retry();
      expect(provider.log).not.toHaveBeenCalled();
      const event = await f.receipt();
      provider.read.mockResolvedValue({ ...f.original, delivery_status: "pending" });
      await retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma });
      await f.retry();
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        trigger: "acceptance_callback", stage: "retrieve", outcome: "skipped",
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
      await f.retry();
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

  it.each(["iMessage", null] as const)("does not let diagnostic failures affect recovery with service %s", async (service) => {
    await withFixture(async (f) => {
      provider.read.mockResolvedValue({ ...f.original, service });
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
      await f.retry();
        expect(provider.send).toHaveBeenCalledTimes(1);
      }
    });
  });

  it.each(["failed", "delivered"])("does not let a legacy %s receipt that already read the parent overwrite a replacement", async (status) => {
    await withFixture(async (f) => {
      const failure = await f.receipt();
      const event = status === "delivered"
        ? timingReceipt(f, { eventAt: f.at(20_000), deliveredAt: f.at(1_000) }) : failure;
      const paused = await pauseLegacyReceipt(f, event, false);
      try { await f.retry(); }
      finally { paused.resume.resolve(); }
      expect(await paused.pending).toMatchObject({ advanced: false });
      expect(await f.prisma.hostedLinqDelivery.findUnique({
        where: { id: f.deliveryId }, select: { status: true, deliveredAt: true },
      })).toEqual({ status: "accepted", deliveredAt: null });
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
      await f.retry();
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
      await f.retry();
        expect(provider.read).toHaveBeenCalledTimes(withdrawal === "before-receipt" ? 0 : 1);
        expect(provider.send).not.toHaveBeenCalled();
        expect(await f.prisma.hostedLinqDeliveryMessage.count({
          where: { deliveryId: f.deliveryId, terminalRetryCount: { gt: 0 } },
        })).toBe(0);
      });
    },
  );

  it.each([
    ["iMessage", "imessage"], [null, "null"], [undefined, "omitted"],
  ] as const)("recovers once with retrieved service %s under concurrent triggers, then settles replacement receipts", async (service, serviceClass) => {
    await withFixture(async (f) => {
      const original = { ...f.original, service };
      if (service === undefined) delete original.service;
      provider.read.mockResolvedValue(original);
      await f.retry();
      expect(provider.read).not.toHaveBeenCalled();
      const event = await f.receipt();
      await Promise.all([
        f.retry(),
        retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma }),
        retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma }),
      ]);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await f.prisma.hostedLinqDeliveryMessage.count({
        where: { deliveryId: f.deliveryId, terminalRetryCount: { gt: 0 } },
      })).toBe(1);
      expect(provider.log).toHaveBeenCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        outcome: "accepted", attemptClaimed: true, providerServiceClass: serviceClass,
        providerPreferredServiceClass: "omitted", receiptServiceClass: "imessage",
      }));
      expect(provider.send).toHaveBeenCalledWith({
        chatId: f.chatId,
        message: {
          idempotency_key: expect.stringContaining("terminal-retry:"),
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

  it.each([
    ["scalar", "SMS", "sms"],
    ["scalar", "RCS", "rcs"], ["scalar", "synthetic-private-service", "unknown"],
    ["multipart", "SMS", "sms"],
    ["multipart", "RCS", "rcs"], ["multipart", "synthetic-private-service", "unknown"],
  ] as const)("leaves %s receipt service %s unclaimed without borrowing transport", async (owner, receiptService, receiptClass) => {
    await withFixture(async (f) => {
      const siblingId = `sibling-${f.messageId}`;
      if (owner === "multipart") {
        await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
        await f.accepted([f.messageId, siblingId]);
      }
      await f.receipt(f.messageId, "failed", "Message send failed", receiptService);
      if (owner === "multipart") {
        // The later sibling receipt makes the parent iMessage too. Neither is
        // evidence for the first child's missing or contradictory transport.
        await f.receipt(siblingId, "delivered");
        expect(await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } }))
          .toMatchObject({ status: "failed", service: "iMessage" });
      }
      for (const service of [null, undefined] as const) {
        const original = { ...f.original, service, preferred_service: "iMessage" as const };
        if (service === undefined) delete original.service;
        provider.read.mockResolvedValue(original);
        await f.retry();
        expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
          stage: "retrieve", outcome: "skipped", reason: "provider_service_not_imessage", attemptClaimed: false,
          providerServiceClass: service === null ? "null" : "omitted",
          providerPreferredServiceClass: "imessage", receiptServiceClass: receiptClass,
        }));
      }
      expect(provider.read).toHaveBeenCalledTimes(2);
      expect(provider.send).not.toHaveBeenCalled();
      expect(await f.prisma.hostedLinqDeliveryMessage.count({
        where: { deliveryId: f.deliveryId, terminalRetryCount: { gt: 0 } },
      })).toBe(0);
      expect(JSON.stringify(provider.log.mock.calls)).not.toContain("synthetic-private-service");
    });
  });

  it.each([
    ["SMS", "sms"], ["RCS", "rcs"], ["synthetic-private-service", "unknown"], ["", "unknown"],
  ] as const)("rejects explicit retrieved or requested transport %s despite an iMessage receipt", async (value, serviceClass) => {
    await withFixture(async (f) => {
      await f.receipt();
      for (const [service, preferredService, reason, actualClass, preferredClass] of [
        [value, "iMessage", "provider_service_not_imessage", serviceClass, "imessage"],
        [null, value, "provider_preferred_service_not_imessage", "null", serviceClass],
        [undefined, value, "provider_preferred_service_not_imessage", "omitted", serviceClass],
        ["iMessage", value, "provider_preferred_service_not_imessage", "imessage", serviceClass],
      ] as const) {
        const original = { ...f.original };
        // Malformed provider JSON must stay closed even outside the SDK union.
        Object.assign(original, { service, preferred_service: preferredService });
        if (service === undefined) delete original.service;
        provider.read.mockResolvedValue(original);
        await f.retry();
        expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
          stage: "retrieve", outcome: "skipped", reason, attemptClaimed: false,
          providerServiceClass: actualClass, providerPreferredServiceClass: preferredClass, receiptServiceClass: "imessage",
        }));
      }
      expect(provider.send).not.toHaveBeenCalled();
      expect(await f.prisma.hostedLinqDeliveryMessage.count({
        where: { deliveryId: f.deliveryId, terminalRetryCount: { gt: 0 } },
      })).toBe(0);
      const logged = JSON.stringify(provider.log.mock.calls);
      for (const privateValue of ["synthetic-private-service", f.chatId, f.messageId, f.original.from!, "Here is the requested document."]) {
        expect(logged).not.toContain(privateValue);
      }
    });
  });

  it.each([
    ["scalar", "SMS", "sms"],
    ["multipart", "SMS", "sms"],
  ] as const)("rechecks %s receipt changing to service %s at claim without consuming the attempt", async (owner, service, serviceClass) => {
    await withFixture(async (f) => {
      const siblingId = `sibling-${f.messageId}`;
      if (owner === "multipart") {
        await f.prisma.hostedLinqDelivery.delete({ where: { id: f.deliveryId } });
        await f.accepted([f.messageId, siblingId]);
        await f.receipt(siblingId, "delivered");
      }
      await f.receipt();
      const original = { ...f.original, service: null };
      provider.read.mockImplementation(async () => {
        // Commit newer canonical evidence after candidate selection. Retrieval
        // still passes on the old snapshot, so only the claim recheck can stop it.
        await f.receipt(f.messageId, "failed", "Message send failed", service);
        if (owner === "multipart") await f.receipt(siblingId, "delivered");
        return original;
      });
      await f.retry();
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        stage: "claim", outcome: "skipped", reason: "provider_service_not_imessage", attemptClaimed: false,
        providerServiceClass: "null", receiptServiceClass: serviceClass,
      }));
      expect(provider.read).toHaveBeenCalledTimes(1);
      expect(provider.send).not.toHaveBeenCalled();
      expect(await f.prisma.hostedLinqDeliveryMessage.count({
        where: { deliveryId: f.deliveryId, terminalRetryCount: { gt: 0 } },
      })).toBe(0);
      // A later exact iMessage receipt can still use the unconsumed attempt.
      await f.receipt();
      provider.read.mockResolvedValue(original);
      await f.retry();
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(await f.prisma.hostedLinqDeliveryMessage.count({
        where: { deliveryId: f.deliveryId, terminalRetryCount: { gt: 0 } },
      })).toBe(1);
    });
  });

  it("rejects mismatched replacement retrieval and never reopens an ambiguous send", async () => {
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

  it.each(["iMessage", null, undefined] as const)("retries only the exact failed group part with retrieved service %s, not the parent's transport", async (service) => {
    await withFixture(async (f) => {
      const original: Message = { ...f.original, service, preferred_service: service === null ? null : "iMessage" };
      if (service === undefined) delete original.service;
      provider.read.mockResolvedValue(original);
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
      await f.receipt();
      await f.receipt(siblingId, "delivered", "Message send failed", "SMS");
      expect(await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } }))
        .toMatchObject({ status: "failed", service: "SMS" });
      await f.retry();
      expect(provider.read).toHaveBeenCalledWith(f.messageId);
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.objectContaining(service === null ? {} : { preferred_service: "iMessage" }),
      }));
      expect(provider.log).toHaveBeenLastCalledWith("hosted-onboarding.linq.terminal-retry", expect.objectContaining({
        outcome: "accepted", receiptServiceClass: "imessage",
        providerPreferredServiceClass: service === null ? "null" : "imessage",
      }));
      expect(await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({
        where: { deliveryId: f.deliveryId, ordinal: 0 },
      })).toMatchObject({ status: "delivered", service: "SMS", terminalRetryAttemptedAt: null });
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
        where: { deliveryId: f.deliveryId, terminalRetryCount: { gt: 0 } },
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


describe.skipIf(!enabled)("durable bounded terminal recovery", () => {
  it("migrates existing rows and accepts old writers with empty recovery defaults", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    try {
      const sql = await readFile(new URL("../prisma/migrations/20261008210000_linq_bounded_terminal_recovery/migration.sql", import.meta.url), "utf8");
      await prisma.$transaction(async (tx) => {
        // Connection-local tables shadow only these synthetic names for this transaction.
        await tx.$executeRawUnsafe('CREATE TEMP TABLE hosted_linq_delivery_message (id TEXT PRIMARY KEY) ON COMMIT DROP');
        await tx.$executeRawUnsafe('CREATE TEMP TABLE hosted_linq_delivery (linq_chat_lookup_key TEXT, accepted_at TIMESTAMP(3)) ON COMMIT DROP');
        await tx.$executeRaw`INSERT INTO hosted_linq_delivery_message (id) VALUES ('before-migration')`;
        for (const statement of sql.split(";").filter((part) => part.trim())) {
          await tx.$executeRawUnsafe(statement);
        }
        await tx.$executeRaw`INSERT INTO hosted_linq_delivery_message (id) VALUES ('old-writer-after-migration')`;
        expect(await tx.$queryRaw`
          SELECT id FROM hosted_linq_delivery_message
          WHERE terminal_retry_count = 0
            AND terminal_retry_previous_message_lookup_keys = ARRAY[]::TEXT[]
            AND terminal_retry_next_at IS NULL AND terminal_retry_expires_at IS NULL
            AND terminal_retry_claimed_message_lookup_key IS NULL
            AND terminal_retry_context_ciphertext IS NULL AND terminal_retry_owner_member_id IS NULL
          ORDER BY id
        `).toEqual([{ id: "before-migration" }, { id: "old-writer-after-migration" }]);
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it.each([null, undefined, "iMessage"] as const)("preserves original preferred service %s with no actual transport", async (preferred) => {
    await withFixture(async (f) => {
      await f.receipt(f.messageId, "failed", "Message send failed", null);
      provider.read.mockResolvedValue({ ...f.original, service: null, preferred_service: preferred });
      await f.retry();
      expect(provider.send).toHaveBeenCalledTimes(1);
      const request = provider.send.mock.calls[0]![0];
      if (preferred == null) expect(request.message).not.toHaveProperty("preferred_service");
      else expect(request.message.preferred_service).toBe("iMessage");
    });
  });

  it("persists jittered exponential timers, caps four replacements, and ignores every earlier receipt", async () => {
    await withFixture(async (f) => {
      let activeId = f.messageId;
      const priorIds: string[] = [];
      const keys: string[] = [];
      const originalAcceptedAt = (await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).acceptedAt!;
      for (const [index, delayMs] of [10_000, 20_000, 40_000, 80_000].entries()) {
        await f.receipt(activeId);
        provider.read.mockResolvedValue({ ...f.original, id: activeId });
        const nextId = `synthetic-replacement-${index}-${f.messageId}`;
        provider.send.mockResolvedValue({ chatId: f.chatId, messageId: nextId });
        const start = Date.now();
        await Promise.all([1, 2, 3].map(() => retryHostedLinqTerminalSend({ chatId: f.chatId, messageId: activeId, prisma: f.prisma })));
        let row = await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({ where: { deliveryId: f.deliveryId } });
        expect(row.terminalRetryNextAt!.getTime()).toBeGreaterThanOrEqual(start + delayMs * 0.8);
        expect(row.terminalRetryNextAt!.getTime()).toBeLessThanOrEqual(Date.now() + delayMs);
        expect(row.terminalRetryExpiresAt!.getTime()).toBe(originalAcceptedAt.getTime() + 180_000);
        expect(row.terminalRetryContextCiphertext).not.toContain(activeId);
        await processHostedLinqTerminalRetry({ messageRowId: row.id, prisma: f.prisma });
        expect(provider.send).toHaveBeenCalledTimes(index);
        await f.prisma.hostedLinqDeliveryMessage.update({ where: { id: row.id }, data: { terminalRetryNextAt: new Date(Date.now() - 1) } });
        await Promise.all([1, 2, 3].map(() => processHostedLinqTerminalRetry({ messageRowId: row.id, prisma: f.prisma })));
        expect(provider.send).toHaveBeenCalledTimes(index + 1);
        row = await f.prisma.hostedLinqDeliveryMessage.findUniqueOrThrow({ where: { id: row.id } });
        expect(row.terminalRetryCount).toBe(index + 1);
        expect(row.terminalRetryPreviousMessageLookupKeys).toHaveLength(index + 1);
        expect(row.status).toBe("accepted");
        const request = provider.send.mock.calls[index]![0] as { message: { idempotency_key: string } };
        keys.push(request.message.idempotency_key);
        if (index === 0) await f.accepted(); // Callback replay cannot extend the recovery deadline.
        priorIds.push(activeId);
        activeId = nextId;
        for (const oldId of priorIds) await f.receipt(oldId, "delivered");
        expect((await f.prisma.hostedLinqDeliveryMessage.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("accepted");
      }
      expect(new Set(keys).size).toBe(4);
      await f.receipt(activeId);
      provider.read.mockResolvedValue({ ...f.original, id: activeId });
      await f.retry(activeId);
      expect(provider.send).toHaveBeenCalledTimes(4);
      expect((await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).status).toBe("failed");
      const started = JSON.stringify(provider.start.mock.calls.map((call) => call[0]));
      expect(started).not.toContain(f.chatId);
      expect(started).not.toContain(f.messageId);
    });
  });

  it.each(["expired", "revoked", "superseded", "legacy", "delivered"])("fences delayed work after %s", async (reason) => {
    await withFixture(async (f) => {
      await f.receipt();
      await retryHostedLinqTerminalSend({ chatId: f.chatId, messageId: f.messageId, prisma: f.prisma });
      const row = await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({ where: { deliveryId: f.deliveryId } });
      await f.prisma.hostedLinqDeliveryMessage.update({ where: { id: row.id }, data: { terminalRetryNextAt: new Date(Date.now() - 1) } });
      if (reason === "expired") await f.prisma.hostedLinqDeliveryMessage.update({ where: { id: row.id }, data: { terminalRetryExpiresAt: new Date(Date.now() - 1) } });
      if (reason === "revoked") { await f.grantConsent(); await f.withdrawConsent(); }
      if (reason === "legacy") await f.prisma.hostedLinqDeliveryMessage.update({ where: { id: row.id }, data: { terminalRetryAttemptedAt: new Date(), terminalRetryExpiresAt: null } });
      if (reason === "delivered") await f.receipt(f.messageId, "delivered");
      if (reason === "superseded") await recordHostedLinqRuntimeDeliveryOutcomeTx({
        acceptedAt: new Date(), attemptedAt: new Date(), idempotencyKey: `newer-${f.deliveryId}`,
        linqChatId: f.chatId, messageId: `newer-${f.messageId}`, phoneNumberLookupKey: f.lineKey,
        sourceRef: `newer-${f.deliveryId}`, targetKind: "thread", threadIsDirect: true,
        userId: f.memberId, prisma: f.prisma,
      });
      await processHostedLinqTerminalRetry({ messageRowId: row.id, prisma: f.prisma });
      expect(provider.send).not.toHaveBeenCalled();
    });
  });

  it.each([0, 30_000])("recovers across a 45-second outage with %i ms terminal-failure latency", async (failureLatencyMs) => {
    await withFixture(async (f) => {
      const originalAcceptedAt = (await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).acceptedAt!.getTime();
      const sends: number[] = [];
      let activeId = f.messageId;
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const failAt = async (time: number) => {
          vi.setSystemTime(time);
          const event = timingReceipt(f, { eventAt: new Date(time), messageId: activeId, status: "failed" });
          await f.ingest(event);
          provider.read.mockResolvedValue({ ...f.original, id: activeId, service: null, preferred_service: null });
          await retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma });
        };
        provider.send.mockImplementation(async () => {
          sends.push(Date.now() - originalAcceptedAt);
          activeId = `synthetic-outage-${sends.length}-${f.messageId}`;
          return { chatId: f.chatId, messageId: activeId };
        });
        await failAt(originalAcceptedAt + failureLatencyMs);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const row = await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({ where: { deliveryId: f.deliveryId } });
          expect(row.terminalRetryNextAt).not.toBeNull();
          // Advance the clock to the real persisted due time, never modify it.
          vi.setSystemTime(row.terminalRetryNextAt!.getTime() - 1);
          await processHostedLinqTerminalRetry({ messageRowId: row.id, prisma: f.prisma });
          expect(sends).toHaveLength(attempt);
          vi.setSystemTime(row.terminalRetryNextAt!);
          await processHostedLinqTerminalRetry({ messageRowId: row.id, prisma: f.prisma });
          expect(sends).toHaveLength(attempt + 1);
          if (sends.at(-1)! >= 45_000) break;
          await failAt(Date.now() + failureLatencyMs);
        }
        const bounds = failureLatencyMs === 0
          ? [[8_000, 10_000], [24_000, 30_000], [56_000, 70_000]]
          : [[38_000, 40_000], [84_000, 90_000]];
        expect(sends).toHaveLength(bounds.length);
        sends.forEach((time, index) => {
          expect(time).toBeGreaterThanOrEqual(bounds[index]![0]!);
          expect(time).toBeLessThanOrEqual(bounds[index]![1]!);
        });
        expect(sends.at(-1)).toBeLessThan(180_000);
        await f.ingest(timingReceipt(f, { eventAt: new Date(Date.now() + 100), messageId: activeId, status: "delivered" }));
        expect((await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).status).toBe("delivered");
        const keys = provider.send.mock.calls.map(([request]) => request.message.idempotency_key);
        expect(new Set(keys).size).toBe(sends.length);
        for (const [request] of provider.send.mock.calls) expect(request.message.parts).toEqual([
          { type: "text", value: "Here is the requested document." },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("lets the fixed dispatch deadline win over five sends when each failure takes 30 seconds", async () => {
    await withFixture(async (f) => {
      const originalAcceptedAt = (await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).acceptedAt!.getTime();
      let activeId = f.messageId;
      let sends = 0;
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        provider.send.mockImplementation(async () => {
          sends += 1;
          activeId = `synthetic-delayed-failure-${sends}-${f.messageId}`;
          return { chatId: f.chatId, messageId: activeId };
        });
        vi.setSystemTime(originalAcceptedAt);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          vi.setSystemTime(Date.now() + 30_000);
          const event = timingReceipt(f, { eventAt: new Date(), messageId: activeId, status: "failed" });
          await f.ingest(event);
          provider.read.mockResolvedValue({ ...f.original, id: activeId });
          await retryHostedLinqTerminalSendForEvent({ event, prisma: f.prisma });
          const row = await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({ where: { deliveryId: f.deliveryId } });
          expect(row.terminalRetryExpiresAt!.getTime()).toBe(originalAcceptedAt + 180_000);
          if (attempt === 3) {
            expect(row.terminalRetryNextAt).toBeNull();
            expect(sends).toBe(3);
            await processHostedLinqTerminalRetry({ messageRowId: row.id, prisma: f.prisma });
            expect(sends).toBe(3);
            break;
          }
          vi.setSystemTime(row.terminalRetryNextAt!);
          await processHostedLinqTerminalRetry({ messageRowId: row.id, prisma: f.prisma });
          expect(sends).toBe(attempt + 1);
        }
        expect((await f.prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).status).toBe("failed");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("does not transfer a pending recovery to another member after route reassignment", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      await f.retry();
      await f.prisma.hostedMember.create({ data: { id: f.containerId, billingStatus: "active" } });
      await f.prisma.hostedMemberRouting.update({ where: { memberId: f.memberId }, data: { memberId: f.containerId } });
      await f.receipt(f.retryId);
      provider.read.mockResolvedValue({ ...f.original, id: f.retryId });
      provider.send.mockResolvedValue({ chatId: f.chatId, messageId: `next-${f.retryId}` });
      await f.retry(f.retryId);
      expect(provider.send).toHaveBeenCalledTimes(1);
      const row = await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({ where: { deliveryId: f.deliveryId } });
      expect(row.terminalRetryOwnerMemberId).toBe(f.memberId);
    });
  });

  it("keeps a committed dispatch closed when acceptance recording is interrupted", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      provider.send.mockImplementation(async () => {
        vi.spyOn(f.prisma, "$transaction").mockRejectedValueOnce(new Error("synthetic recording interruption"));
        return { chatId: f.chatId, messageId: f.retryId };
      });
      await expect(f.retry()).rejects.toThrow("synthetic recording interruption");
      vi.restoreAllMocks();
      await f.receipt();
      await f.retry();
      await f.receipt(f.retryId);
      await f.retry(f.retryId);
      expect(provider.send).toHaveBeenCalledTimes(1);
      const row = await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({ where: { deliveryId: f.deliveryId } });
      expect(row.terminalRetryClaimedMessageLookupKey).toBe(row.messageLookupKey);
      expect(row.terminalRetryCount).toBe(1);
      expect(row.status).toBe("failed");
    });
  });

  it("closes the rolling legacy sender before the durable timer is due", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      await retryHostedLinqTerminalSend({ chatId: f.chatId, messageId: f.messageId, prisma: f.prisma });
      const row = await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({ where: { deliveryId: f.deliveryId } });
      const legacyClaim = await f.prisma.hostedLinqDeliveryMessage.updateMany({
        where: { id: row.id, terminalRetryAttemptedAt: null }, data: { terminalRetryAttemptedAt: new Date() },
      });
      expect(legacyClaim.count).toBe(0);
      expect(row.terminalRetryCount).toBe(0);
      expect(provider.send).not.toHaveBeenCalled();
    });
  });

  it("retries workflow admission after a lost start acknowledgement without changing due time or sending", async () => {
    await withFixture(async (f) => {
      await f.receipt();
      provider.start.mockRejectedValueOnce(new Error("synthetic workflow start loss"));
      await expect(retryHostedLinqTerminalSend({ chatId: f.chatId, messageId: f.messageId, prisma: f.prisma })).rejects.toThrow("synthetic workflow start loss");
      const before = await f.prisma.hostedLinqDeliveryMessage.findFirstOrThrow({ where: { deliveryId: f.deliveryId } });
      await retryHostedLinqTerminalSend({ chatId: f.chatId, messageId: f.messageId, prisma: f.prisma });
      const after = await f.prisma.hostedLinqDeliveryMessage.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.terminalRetryNextAt).toEqual(before.terminalRetryNextAt);
      expect(after.terminalRetryCount).toBe(0);
      expect(provider.send).not.toHaveBeenCalled();
    });
  });
});
