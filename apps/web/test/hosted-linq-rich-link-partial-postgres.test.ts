import { randomInt, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  createHostedLinqMessageLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  claimHostedLinqDeliveryProviderDispatchTx,
  markHostedLinqDeliverySendFailedTx,
  recordHostedLinqRuntimeDeliveryOutcomeTx,
  resolveHostedLinqInviteSignupDispatchEffectIdTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  buildHostedLinqInviteSignupEffectId,
} from "@/src/lib/hosted-onboarding/linq-invite-signup-effect-id";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
  createHostedLinqProviderEventLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  parseHostedLinqProviderEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";
import { parseHostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  ingestHostedLinqProviderEventTx,
} from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { createPrismaClient } from "@/src/lib/prisma";

const PARTIAL_FAILURE_CODE =
  "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY";
const PARTIAL_FAILURE_REASON = "[redacted]";
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Hosted Linq rich-link partial proof requires a local DATABASE_URL.",
  );
}

const partialCases = (
  ["invite_signup", "invite_signup_fallback"] as const
).flatMap((template) =>
  (["primary-only", "link-only", "duplicate"] as const).flatMap((identity) =>
    (["delivered", "failed"] as const).map((receiptStatus) => ({
      identity,
      receiptStatus,
      template,
    }))
  )
);

describe.skipIf(!runPostgresProof)(
  "Hosted Linq rich-link partial ordering with PostgreSQL",
  () => {
    it("consumes the exact answered mailbox row only after the rich link recovers", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const suffix = randomUUID();
      const memberId = `hbm_rich_link_mailbox_${suffix}`;
      const mailboxItemId = `hmi_rich_link_mailbox_${suffix}`;
      const idempotencyKey = `assistant-outbox:rich-link-mailbox-${suffix}`;
      const deliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(idempotencyKey);
      const failedAt = new Date("2026-07-29T18:00:02.000Z");

      if (!deliveryLookupKey) {
        await prisma.$disconnect();
        throw new Error("Expected a deterministic delivery lookup key.");
      }

      try {
        await prisma.hostedMember.create({ data: { id: memberId } });
        await prisma.hostedMailboxItem.create({
          data: {
            dedupeKey: `rich-link-mailbox:${suffix}`,
            id: mailboxItemId,
            kind: "conversation.message",
            lane: "conversation",
            laneSeq: 1n,
            occurredAt: new Date("2026-07-29T18:00:00.000Z"),
            payloadSchema: "murph.hosted-execution.conversation-message.v1",
            userId: memberId,
          },
        });

        await recordHostedLinqRuntimeDeliveryOutcomeTx({
          answeredMailboxItemIds: [mailboxItemId],
          attemptedAt: new Date("2026-07-29T18:00:01.000Z"),
          failedAt,
          failureCode: PARTIAL_FAILURE_CODE,
          idempotencyKey,
          linqChatId: `chat-rich-link-mailbox-${suffix}`,
          messageIds: [`msg-rich-link-mailbox-${suffix}`],
          prisma,
          sourceRef: `intent-rich-link-mailbox-${suffix}`,
          targetKind: "thread",
          userId: memberId,
        });

        await expect(prisma.hostedMailboxItem.findUnique({
          select: { consumedAt: true },
          where: { id: mailboxItemId },
        })).resolves.toEqual({ consumedAt: null });
        await expect(prisma.hostedLinqDelivery.findUnique({
          select: { failureCode: true, status: true },
          where: { idempotencyKey: deliveryLookupKey },
        })).resolves.toEqual({
          failureCode: PARTIAL_FAILURE_CODE,
          status: "failed",
        });

        const acceptedAt = new Date("2026-07-29T18:00:05.000Z");
        const primaryMessageId = `msg-rich-link-mailbox-${suffix}`;
        const linkMessageId = `msg-rich-link-recovered-${suffix}`;
        await recordHostedLinqRuntimeDeliveryOutcomeTx({
          acceptedAt: new Date("2026-07-29T18:00:03.000Z"),
          answeredMailboxItemIds: [mailboxItemId],
          attemptedAt: new Date("2026-07-29T18:00:02.500Z"),
          idempotencyKey,
          linqChatId: `chat-rich-link-mailbox-${suffix}`,
          messageIds: [`msg-rich-link-mismatch-${suffix}`, linkMessageId],
          prisma,
          sourceRef: `intent-rich-link-mailbox-${suffix}`,
          targetKind: "thread",
          userId: memberId,
        });
        await expect(prisma.hostedMailboxItem.findUnique({
          select: { consumedAt: true },
          where: { id: mailboxItemId },
        })).resolves.toEqual({ consumedAt: null });
        await expect(prisma.hostedLinqDelivery.findUnique({
          select: { failureCode: true, status: true },
          where: { idempotencyKey: deliveryLookupKey },
        })).resolves.toEqual({
          failureCode: PARTIAL_FAILURE_CODE,
          status: "failed",
        });

        await recordHostedLinqRuntimeDeliveryOutcomeTx({
          acceptedAt,
          answeredMailboxItemIds: [mailboxItemId],
          attemptedAt: new Date("2026-07-29T18:00:04.000Z"),
          idempotencyKey,
          linqChatId: `chat-rich-link-mailbox-${suffix}`,
          messageIds: [primaryMessageId, linkMessageId],
          prisma,
          sourceRef: `intent-rich-link-mailbox-${suffix}`,
          targetKind: "thread",
          userId: memberId,
        });

        await expect(prisma.hostedMailboxItem.findUnique({
          select: { consumedAt: true },
          where: { id: mailboxItemId },
        })).resolves.toEqual({ consumedAt: acceptedAt });
        await expect(prisma.hostedLinqDelivery.findUnique({
          select: { failureCode: true, status: true },
          where: { idempotencyKey: deliveryLookupKey },
        })).resolves.toEqual({
          failureCode: null,
          status: "accepted",
        });
        await expect(prisma.hostedLinqDeliveryMessage.findMany({
          orderBy: { ordinal: "asc" },
          select: { ordinal: true },
          where: {
            delivery: { idempotencyKey: deliveryLookupKey },
          },
        })).resolves.toEqual([{ ordinal: 0 }, { ordinal: 1 }]);
      } finally {
        await prisma.hostedLinqDelivery.deleteMany({
          where: { idempotencyKey: deliveryLookupKey },
        });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });

    it.each(partialCases)(
      "keeps a parent-only $template $identity partial absorbing after a $receiptStatus receipt",
      async ({ identity, receiptStatus, template }) => {
        const fixture = await createPartialFixture(template, identity);
        const failedAt = new Date("2026-07-29T18:00:00.000Z");

        try {
          const messageLookupKey =
            createHostedLinqMessageLookupKey(fixture.messageId);
          if (!messageLookupKey) {
            throw new Error("Expected a provider message lookup key.");
          }
          await fixture.prisma.hostedLinqDelivery.update({
            where: { idempotencyKey: fixture.deliveryLookupKey },
            data: {
              failedAt,
              failureCode: PARTIAL_FAILURE_CODE,
              failureReason: PARTIAL_FAILURE_REASON,
              messageLookupKey,
              status: "failed",
            },
          });

          await ingestReceipt(fixture, receiptStatus);

          await expect(readPartialParent(fixture)).resolves.toEqual({
            deliveredAt: null,
            failedAt,
            failureCode: PARTIAL_FAILURE_CODE,
            failureReason: PARTIAL_FAILURE_REASON,
            lastReceiptAt: null,
            status: "failed",
          });
          await expect(
            fixture.prisma.hostedLinqDeliveryMessage.count({
              where: { deliveryId: fixture.deliveryId },
            }),
          ).resolves.toBe(0);
          await expect(
            resolveHostedLinqInviteSignupDispatchEffectIdTx({
              effectId: fixture.effectId,
              prisma: fixture.prisma,
            }),
          ).resolves.toBe(fixture.effectId);
          await expect(claimFixtureDelivery(fixture)).resolves.toMatchObject({
            claimed: false,
            id: fixture.deliveryId,
            outcome: "completed",
          });
        } finally {
          await cleanupPartialFixture(fixture);
        }
      },
    );

    it.each(partialCases)(
      "attaches a buffered $receiptStatus receipt to a resumed $template $identity child without promoting the parent",
      async ({ identity, receiptStatus, template }) => {
        const fixture = await createPartialFixture(template, identity);
        const failedAt = new Date("2026-07-29T18:00:00.000Z");

        try {
          await ingestReceipt(fixture, receiptStatus);
          await markHostedLinqDeliverySendFailedTx({
            failedAt,
            failureCode: PARTIAL_FAILURE_CODE,
            failureReason: "Incomplete provider identity set.",
            idempotencyKey: fixture.effectId,
            linqChatId: fixture.chatId,
            messageIds: fixture.messageIds,
            prisma: fixture.prisma,
          });

          await expect(readPartialParent(fixture)).resolves.toEqual({
            deliveredAt: null,
            failedAt,
            failureCode: PARTIAL_FAILURE_CODE,
            failureReason: PARTIAL_FAILURE_REASON,
            lastReceiptAt: fixture.receiptAt,
            status: "failed",
          });
          await expect(
            fixture.prisma.hostedLinqDeliveryMessage.findMany({
              orderBy: { ordinal: "asc" },
              select: {
                acceptedAt: true,
                deliveredAt: true,
                failedAt: true,
                ordinal: true,
                status: true,
              },
              where: { deliveryId: fixture.deliveryId },
            }),
          ).resolves.toEqual([{
            acceptedAt: failedAt,
            deliveredAt:
              receiptStatus === "delivered" ? fixture.receiptAt : null,
            failedAt: receiptStatus === "failed" ? fixture.receiptAt : null,
            ordinal: 0,
            status: receiptStatus,
          }]);
          await expect(
            resolveHostedLinqInviteSignupDispatchEffectIdTx({
              effectId: fixture.effectId,
              prisma: fixture.prisma,
            }),
          ).resolves.toBe(fixture.effectId);
          await expect(claimFixtureDelivery(fixture)).resolves.toMatchObject({
            claimed: false,
            id: fixture.deliveryId,
            outcome: "completed",
          });
        } finally {
          await cleanupPartialFixture(fixture);
        }
      },
    );
  },
);

type PartialFixture = {
  chatId: string;
  deliveryId: string;
  deliveryLookupKey: string;
  effectId: string;
  eventId: string;
  eventLookupKey: string;
  messageId: string;
  messageIds: string[];
  phoneLookupKey: string;
  phoneNumber: string;
  prisma: PrismaClient;
  receiptAt: Date;
  template: "invite_signup" | "invite_signup_fallback";
};

async function createPartialFixture(
  template: PartialFixture["template"],
  identity: "primary-only" | "link-only" | "duplicate",
): Promise<PartialFixture> {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
  const suffix = randomUUID();
  const effectId = buildHostedLinqInviteSignupEffectId({
    memberId: `hbm_rich_link_partial_${suffix}`,
    occurredAt: "2026-07-29T18:00:00.000Z",
  });
  const deliveryLookupKey =
    createHostedLinqDeliveryIdempotencyLookupKey(effectId);
  const chatId = `chat-rich-link-partial-${suffix}`;
  const messageId = `msg-${identity}-${suffix}`;
  const messageIds =
    identity === "duplicate" ? [messageId, messageId] : [messageId];
  const phoneNumber = `+1202${randomInt(1_000_000, 10_000_000)}`;
  const phoneLookupKey = createHostedPhoneLookupKey(phoneNumber);
  const eventId = `evt-rich-link-partial-${randomUUID()}`;
  const eventLookupKey = createHostedLinqProviderEventLookupKey(eventId);
  if (!deliveryLookupKey || !phoneLookupKey) {
    await prisma.$disconnect();
    throw new Error("Expected deterministic Hosted Linq lookup keys.");
  }
  const claim = await claimHostedLinqDeliveryProviderDispatchTx({
    idempotencyKey: effectId,
    linqChatId: chatId,
    prisma,
    source: "hosted_webhook_side_effect",
    sourceRef: effectId,
    targetKind: "thread",
    template,
  });
  if (!claim.claimed || !claim.id) {
    await prisma.$disconnect();
    throw new Error("Expected the initial Hosted Linq delivery claim.");
  }
  return {
    chatId,
    deliveryId: claim.id,
    deliveryLookupKey,
    effectId,
    eventId,
    eventLookupKey,
    messageId,
    messageIds,
    phoneLookupKey,
    phoneNumber,
    prisma,
    receiptAt: new Date("2026-07-29T18:00:01.000Z"),
    template,
  };
}

function claimFixtureDelivery(fixture: PartialFixture) {
  return claimHostedLinqDeliveryProviderDispatchTx({
    idempotencyKey: fixture.effectId,
    linqChatId: fixture.chatId,
    prisma: fixture.prisma,
    source: "hosted_webhook_side_effect",
    sourceRef: fixture.effectId,
    targetKind: "thread",
    template: fixture.template,
  });
}

function readPartialParent(fixture: PartialFixture) {
  return fixture.prisma.hostedLinqDelivery.findUnique({
    select: {
      deliveredAt: true,
      failedAt: true,
      failureCode: true,
      failureReason: true,
      lastReceiptAt: true,
      status: true,
    },
    where: { idempotencyKey: fixture.deliveryLookupKey },
  });
}

async function ingestReceipt(
  fixture: PartialFixture,
  receiptStatus: "delivered" | "failed",
): Promise<void> {
  const event = parseHostedLinqProviderEvent({
    event: parseHostedLinqWebhookEvent(JSON.stringify({
      api_version: "v3",
      created_at: fixture.receiptAt.toISOString(),
      data: {
        ...(receiptStatus === "failed"
          ? {
              error: {
                code: "30007",
                message: "carrier filtered",
              },
            }
          : { chat_id: fixture.chatId }),
        message_id: fixture.messageId,
        phone_number: fixture.phoneNumber,
        service: "sms",
      },
      event_id: fixture.eventId,
      event_type: `message.${receiptStatus}`,
      trace_id: `trace-${randomUUID()}`,
      webhook_version: "2026-02-03",
    })),
    rawBody: "{}",
  });
  if (!event) {
    throw new Error("Expected a terminal Hosted Linq receipt.");
  }
  await fixture.prisma.$transaction((transaction) =>
    ingestHostedLinqProviderEventTx({
      event,
      prisma: transaction,
    })
  );
}

async function cleanupPartialFixture(
  fixture: PartialFixture,
): Promise<void> {
  await fixture.prisma.hostedLinqAlert.deleteMany({
    where: {
      OR: [
        { deliveryId: fixture.deliveryId },
        { eventId: fixture.eventLookupKey },
      ],
    },
  });
  await fixture.prisma.hostedLinqDelivery.deleteMany({
    where: { id: fixture.deliveryId },
  });
  await fixture.prisma.hostedLinqProviderEvent.deleteMany({
    where: { eventId: fixture.eventLookupKey },
  });
  await fixture.prisma.hostedLinqLine.deleteMany({
    where: { phoneNumberLookupKey: fixture.phoneLookupKey },
  });
  await fixture.prisma.$disconnect();
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}
