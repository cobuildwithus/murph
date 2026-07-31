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
import {
  readHostedIngressLatencyDashboard,
} from "@/src/lib/hosted-runtime-latency/store";
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

    it("preserves no-receipt status for new and recovered two-part group sends", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const suffix = randomUUID();
      const memberId = `hbm_rich_link_group_${suffix}`;
      const newIdempotencyKey = `assistant-outbox:rich-link-group-new-${suffix}`;
      const recoveredIdempotencyKey =
        `assistant-outbox:rich-link-group-recovered-${suffix}`;
      const newLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(newIdempotencyKey);
      const recoveredLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(recoveredIdempotencyKey);

      if (!newLookupKey || !recoveredLookupKey) {
        await prisma.$disconnect();
        throw new Error("Expected deterministic delivery lookup keys.");
      }

      try {
        await prisma.hostedMember.create({ data: { id: memberId } });
        await recordHostedLinqRuntimeDeliveryOutcomeTx({
          acceptedAt: new Date("2026-07-29T18:00:02.000Z"),
          attemptedAt: new Date("2026-07-29T18:00:01.000Z"),
          idempotencyKey: newIdempotencyKey,
          linqChatId: `chat-rich-link-group-new-${suffix}`,
          messageIds: [
            `msg-rich-link-group-new-primary-${suffix}`,
            `msg-rich-link-group-new-link-${suffix}`,
          ],
          prisma,
          sourceRef: `intent-rich-link-group-new-${suffix}`,
          targetKind: "thread",
          threadIsDirect: false,
          userId: memberId,
        });

        const recoveredPrimaryMessageId =
          `msg-rich-link-group-recovered-primary-${suffix}`;
        await recordHostedLinqRuntimeDeliveryOutcomeTx({
          attemptedAt: new Date("2026-07-29T18:00:03.000Z"),
          failedAt: new Date("2026-07-29T18:00:04.000Z"),
          failureCode: PARTIAL_FAILURE_CODE,
          idempotencyKey: recoveredIdempotencyKey,
          linqChatId: `chat-rich-link-group-recovered-${suffix}`,
          messageIds: [recoveredPrimaryMessageId],
          prisma,
          sourceRef: `intent-rich-link-group-recovered-${suffix}`,
          targetKind: "thread",
          threadIsDirect: false,
          userId: memberId,
        });
        await recordHostedLinqRuntimeDeliveryOutcomeTx({
          acceptedAt: new Date("2026-07-29T18:00:06.000Z"),
          attemptedAt: new Date("2026-07-29T18:00:05.000Z"),
          idempotencyKey: recoveredIdempotencyKey,
          linqChatId: `chat-rich-link-group-recovered-${suffix}`,
          messageIds: [
            recoveredPrimaryMessageId,
            `msg-rich-link-group-recovered-link-${suffix}`,
          ],
          prisma,
          sourceRef: `intent-rich-link-group-recovered-${suffix}`,
          targetKind: "thread",
          threadIsDirect: false,
          userId: memberId,
        });

        await expect(prisma.hostedLinqDelivery.findMany({
          orderBy: { idempotencyKey: "asc" },
          select: {
            id: true,
            status: true,
            _count: { select: { messages: true } },
          },
          where: {
            idempotencyKey: { in: [newLookupKey, recoveredLookupKey] },
          },
        })).resolves.toEqual([
          expect.objectContaining({
            _count: { messages: 2 },
            status: "sent_no_receipt_expected",
          }),
          expect.objectContaining({
            _count: { messages: 2 },
            status: "sent_no_receipt_expected",
          }),
        ]);
      } finally {
        await prisma.hostedLinqDelivery.deleteMany({
          where: { idempotencyKey: { in: [newLookupKey, recoveredLookupKey] } },
        });
        await prisma.hostedMember.deleteMany({ where: { id: memberId } });
        await prisma.$disconnect();
      }
    });

    it("restores receipt policy after a newer receipt corrects a failed child", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const suffix = randomUUID();
      const memberId = `hbm_rich_link_receipt_policy_${suffix}`;
      const phoneNumber = `+1202${randomInt(1_000_000, 10_000_000)}`;
      const baseAt = new Date("2026-07-30T18:00:00.000Z");
      const groupAcceptedAt = new Date(baseAt.getTime() + 1_000);
      const directAcceptedAt = new Date(baseAt.getTime() + 2_000);
      const cases = [
        {
          acceptedAt: groupAcceptedAt,
          idempotencyKey: `assistant-outbox:rich-link-policy-group-${suffix}`,
          kind: "group",
          mailboxItemId: `hmi_rich_link_policy_group_${suffix}`,
          messageIds: [
            `msg-rich-link-policy-group-primary-${suffix}`,
            `msg-rich-link-policy-group-link-${suffix}`,
          ],
          threadIsDirect: false,
        },
        {
          acceptedAt: directAcceptedAt,
          idempotencyKey: `assistant-outbox:rich-link-policy-direct-${suffix}`,
          kind: "direct",
          mailboxItemId: `hmi_rich_link_policy_direct_${suffix}`,
          messageIds: [
            `msg-rich-link-policy-direct-primary-${suffix}`,
            `msg-rich-link-policy-direct-link-${suffix}`,
          ],
          threadIsDirect: true,
        },
      ] as const;
      const deliveryIds: string[] = [];
      const providerEventIds: string[] = [];

      try {
        await prisma.hostedMember.create({ data: { id: memberId } });
        for (const [index, fixture] of cases.entries()) {
          await prisma.hostedMailboxItem.create({
            data: {
              dedupeKey: `rich-link-receipt-policy:${fixture.kind}:${suffix}`,
              id: fixture.mailboxItemId,
              kind: "conversation.message",
              lane: "conversation",
              laneSeq: BigInt(index + 1),
              occurredAt: fixture.acceptedAt,
              payloadSchema: "murph.hosted-execution.conversation-message.v1",
              userId: memberId,
            },
          });
          const recorded = await recordHostedLinqRuntimeDeliveryOutcomeTx({
            acceptedAt: fixture.acceptedAt,
            attemptedAt: new Date(fixture.acceptedAt.getTime() - 500),
            idempotencyKey: fixture.idempotencyKey,
            linqChatId: `chat-rich-link-policy-${fixture.kind}-${suffix}`,
            messageIds: fixture.messageIds,
            prisma,
            sourceRef: `intent-rich-link-policy-${fixture.kind}-${suffix}`,
            targetKind: "thread",
            threadIsDirect: fixture.threadIsDirect,
            userId: memberId,
          });
          if (!recorded.deliveryId) {
            throw new Error("Expected a recorded multi-part delivery.");
          }
          deliveryIds.push(recorded.deliveryId);
        }
        const groupDeliveryId = deliveryIds[0];
        const directDeliveryId = deliveryIds[1];
        if (!groupDeliveryId || !directDeliveryId) {
          throw new Error("Expected both receipt-policy delivery owners.");
        }
        await prisma.hostedLinqDelivery.update({
          data: { threadIsDirect: null },
          where: { id: groupDeliveryId },
        });

        await prisma.hostedIngressLatencyTrace.create({
          data: {
            acceptedAt: groupAcceptedAt,
            id: `hil_rich_link_policy_group_${suffix}`,
            linqDeliveryId: groupDeliveryId,
            mailboxItemId: cases[0].mailboxItemId,
            mailboxLane: "conversation",
            mailboxLaneSeq: 1n,
            replyRuntimeAttemptId: `runtime-rich-link-policy-group-${suffix}`,
            source: "linq",
            userId: memberId,
          },
        });

        for (const [caseIndex, fixture] of cases.entries()) {
          const deliveryId = fixture.kind === "group"
            ? groupDeliveryId
            : directDeliveryId;
          const chatId = `chat-rich-link-policy-${fixture.kind}-${suffix}`;
          const failedEventId = `evt-rich-link-policy-${fixture.kind}-failed-${suffix}`;
          const correctedEventId =
            `evt-rich-link-policy-${fixture.kind}-corrected-${suffix}`;
          providerEventIds.push(failedEventId, correctedEventId);
          await ingestRuntimeDeliveryReceipt({
            chatId,
            eventId: failedEventId,
            messageId: fixture.messageIds[0],
            phoneNumber,
            prisma,
            receiptAt: new Date(baseAt.getTime() + 10_000 + caseIndex * 2_000),
            status: "failed",
          });
          await expect(prisma.hostedLinqDelivery.findUnique({
            select: { status: true },
            where: { id: deliveryId },
          })).resolves.toEqual({ status: "failed" });
          await ingestRuntimeDeliveryReceipt({
            chatId,
            eventId: correctedEventId,
            messageId: fixture.messageIds[0],
            phoneNumber,
            prisma,
            receiptAt: new Date(baseAt.getTime() + 11_000 + caseIndex * 2_000),
            status: "delivered",
          });

          await expect(prisma.hostedLinqDelivery.findUnique({
            select: { status: true, threadIsDirect: true },
            where: { id: deliveryId },
          })).resolves.toEqual({
            status: fixture.threadIsDirect
              ? "accepted"
              : "sent_no_receipt_expected",
            threadIsDirect: fixture.threadIsDirect,
          });

          if (fixture.kind === "group") {
            const groupDashboard = await readHostedIngressLatencyDashboard({
              inFlightGraceMs: 0,
              now: new Date(baseAt.getTime() + 30 * 60_000),
              prisma,
              source: "linq",
              windowHours: 1,
            });
            expect(
              groupDashboard.replyTraceQuality.acceptedMissingReceiptCount,
            ).toBe(0);
            await prisma.hostedIngressLatencyTrace.create({
              data: {
                acceptedAt: directAcceptedAt,
                id: `hil_rich_link_policy_direct_${suffix}`,
                linqDeliveryId: directDeliveryId,
                mailboxItemId: cases[1].mailboxItemId,
                mailboxLane: "conversation",
                mailboxLaneSeq: 2n,
                replyRuntimeAttemptId:
                  `runtime-rich-link-policy-direct-${suffix}`,
                source: "linq",
                userId: memberId,
              },
            });
          }
        }

        const directDashboard = await readHostedIngressLatencyDashboard({
          inFlightGraceMs: 0,
          now: new Date(baseAt.getTime() + 30 * 60_000),
          prisma,
          source: "linq",
          windowHours: 1,
        });
        expect(
          directDashboard.replyTraceQuality.acceptedMissingReceiptCount,
        ).toBe(1);

        for (const [caseIndex, fixture] of cases.entries()) {
          const deliveredEventId =
            `evt-rich-link-policy-${fixture.kind}-link-delivered-${suffix}`;
          providerEventIds.push(deliveredEventId);
          await ingestRuntimeDeliveryReceipt({
            chatId: `chat-rich-link-policy-${fixture.kind}-${suffix}`,
            eventId: deliveredEventId,
            messageId: fixture.messageIds[1],
            phoneNumber,
            prisma,
            receiptAt: new Date(baseAt.getTime() + 20_000 + caseIndex * 1_000),
            status: "delivered",
          });
        }
        await expect(prisma.hostedLinqDelivery.findMany({
          orderBy: { id: "asc" },
          select: { status: true },
          where: { id: { in: deliveryIds } },
        })).resolves.toEqual([
          { status: "delivered" },
          { status: "delivered" },
        ]);
      } finally {
        await prisma.hostedLinqAlert.deleteMany({
          where: { deliveryId: { in: deliveryIds } },
        });
        await prisma.hostedIngressLatencyTrace.deleteMany({
          where: { userId: memberId },
        });
        await prisma.hostedLinqDelivery.deleteMany({
          where: { id: { in: deliveryIds } },
        });
        const providerEventLookupKeys = providerEventIds
          .map((eventId) => createHostedLinqProviderEventLookupKey(eventId))
          .filter((eventId): eventId is string => eventId !== null);
        await prisma.hostedLinqProviderEvent.deleteMany({
          where: { eventId: { in: providerEventLookupKeys } },
        });
        await prisma.hostedMailboxItem.deleteMany({
          where: { userId: memberId },
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
  await ingestRuntimeDeliveryReceipt({
    chatId: fixture.chatId,
    eventId: fixture.eventId,
    messageId: fixture.messageId,
    phoneNumber: fixture.phoneNumber,
    prisma: fixture.prisma,
    receiptAt: fixture.receiptAt,
    status: receiptStatus,
  });
}

async function ingestRuntimeDeliveryReceipt(input: {
  chatId: string;
  eventId: string;
  messageId: string;
  phoneNumber: string;
  prisma: PrismaClient;
  receiptAt: Date;
  status: "delivered" | "failed";
}): Promise<void> {
  const event = parseHostedLinqProviderEvent({
    event: parseHostedLinqWebhookEvent(JSON.stringify({
      api_version: "v3",
      created_at: input.receiptAt.toISOString(),
      data: {
        ...(input.status === "failed"
          ? {
              error: {
                code: "30007",
                message: "carrier filtered",
              },
            }
          : { chat_id: input.chatId }),
        message_id: input.messageId,
        phone_number: input.phoneNumber,
        service: "sms",
      },
      event_id: input.eventId,
      event_type: `message.${input.status}`,
      trace_id: `trace-${randomUUID()}`,
      webhook_version: "2026-02-03",
    })),
    rawBody: "{}",
  });
  if (!event) {
    throw new Error("Expected a terminal Hosted Linq receipt.");
  }
  await input.prisma.$transaction((transaction) =>
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
