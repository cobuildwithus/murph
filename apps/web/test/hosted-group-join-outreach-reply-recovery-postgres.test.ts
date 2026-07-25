import { randomInt, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq")
  >("@/src/lib/hosted-onboarding/linq");
  return {
    ...actual,
    sendHostedLinqChatMessage: providerMocks.sendHostedLinqChatMessage,
  };
});

import {
  consumeHostedGroupJoinOutreachReplyContextTx,
  enqueueHostedGroupJoinOutreachTx,
  readHostedGroupJoinOutreachReplyContextTx,
} from "@/src/lib/hosted-groups/group-join-outreach-store";
import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  upsertHostedLinqLineForPhoneTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import { parseHostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  buildHostedMemberIdentityPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  planHostedOnboardingLinqWebhook,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import {
  drainHostedLinqSideEffectsDirect,
} from "@/src/lib/hosted-onboarding/webhook-transport";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))) {
  throw new Error(
    "The hosted group join reply recovery proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted group join reply recovery with PostgreSQL",
  () => {
    it("preserves a blocked reply and consumes it exactly once after accepted delivery", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );

      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      const participantPhone = createUniqueTestPhone("+1202");
      const recipientPhone = createUniqueTestPhone("+1303");
      const participantPhoneLookupKey = createHostedPhoneLookupKey(
        participantPhone,
      );
      const recipientPhoneLookupKey = createHostedPhoneLookupKey(
        recipientPhone,
      );
      if (!participantPhoneLookupKey || !recipientPhoneLookupKey) {
        throw new Error("Expected valid test phone lookup keys.");
      }
      const chatId = `chat-group-reply-${randomUUID()}`;
      const groupId = `hgrp_group_reply_${randomUUID()}`;
      const joinCode = `join-group-reply-${randomUUID()}`;
      const offerId = `hgrpjo_group_reply_${randomUUID()}`;
      const ownerMemberId = `hbm_group_owner_${randomUUID()}`;
      const runtimeMemberId = `hbm_group_runtime_${randomUUID()}`;
      const participantMemberId = `hbm_group_participant_${randomUUID()}`;
      const linqChatLookupKeys =
        createHostedLinqChatLookupKeyReadCandidates(chatId);
      let outreachId: string | null = null;
      let deliveryIdempotencyLookupKey: string | null = null;

      providerMocks.sendHostedLinqChatMessage.mockResolvedValue({
        chatId,
        messageId: `linq-message-${randomUUID()}`,
      });

      try {
        await prisma.hostedMember.createMany({
          data: [
            { id: ownerMemberId },
            { id: runtimeMemberId },
            { id: participantMemberId },
          ],
        });
        await prisma.hostedMemberIdentity.create({
          data: {
            ...(await buildHostedMemberIdentityPrivateColumns({
              memberId: participantMemberId,
              phoneNumber: participantPhone,
              prisma,
              privyUserId: null,
              signupPhoneCodeSendAttemptId: null,
              signupPhoneCodeSendAttemptStartedAt: null,
              signupPhoneCodeSentAt: null,
              signupPhoneNumber: null,
            })),
            maskedPhoneNumberHint: `*** ${participantPhone.slice(-4)}`,
            memberId: participantMemberId,
            phoneLookupKey: participantPhoneLookupKey,
          },
        });
        await prisma.hostedGroup.create({
          data: {
            displayName: "Recovery Proof Group",
            id: groupId,
            joinCode,
            joinCodeCreatedAt: new Date("2026-07-24T18:00:00.000Z"),
            ownerMemberId,
            runtimeMemberId,
          },
        });
        await prisma.hostedGroupJoinOffer.create({
          data: {
            groupId,
            id: offerId,
            messageLookupKey: `message-lookup-${randomUUID()}`,
            postedAt: new Date("2026-07-24T18:30:00.000Z"),
            projectionKindsJson: ["best_effort"],
          },
        });
        await upsertHostedLinqLineForPhoneTx({
          observedAt: new Date("2026-07-24T18:45:00.000Z"),
          phoneNumber: recipientPhone,
          prisma,
          source: "configured",
        });
        const enqueue = await prisma.$transaction((tx) =>
          enqueueHostedGroupJoinOutreachTx({
            groupId,
            offerId,
            participantPhoneNumber: participantPhone,
            requestedAt: new Date("2026-07-24T19:00:00.000Z"),
            tx,
          })
        );
        outreachId = enqueue.outreachId;
        await prisma.hostedGroupJoinOutreach.update({
          data: {
            dispatchStartedAt: new Date("2026-07-24T19:01:00.000Z"),
            linqChatLookupKey: null,
            phoneNumberLookupKey: recipientPhoneLookupKey,
            sentAt: new Date("2026-07-24T19:02:00.000Z"),
          },
          where: { id: outreachId },
        });

        const blockedEvent = buildDirectReplyEvent({
          chatId,
          eventId: `event-blocked-${randomUUID()}`,
          messageId: `message-blocked-${randomUUID()}`,
          occurredAt: "2026-07-24T20:00:00.000Z",
          participantPhone,
          recipientPhone: null,
        });
        const blockedPlan = await prisma.$transaction((tx) =>
          planHostedOnboardingLinqWebhook({
            event: blockedEvent,
            firstContactAdmitted: true,
            prisma: tx,
            requireFirstContactAdmission: true,
          })
        );

        expect(blockedPlan.response).toMatchObject({
          ignored: true,
          reason: "unassignable-home-line",
        });
        await expect(prisma.hostedGroupJoinOutreach.findUnique({
          select: { repliedAt: true },
          where: { id: outreachId },
        })).resolves.toEqual({ repliedAt: null });

        const recoveredEvent = buildDirectReplyEvent({
          chatId,
          eventId: `event-recovered-${randomUUID()}`,
          messageId: `message-recovered-${randomUUID()}`,
          occurredAt: "2026-07-24T20:01:00.000Z",
          participantPhone,
          recipientPhone,
        });
        const recoveredPlan = await prisma.$transaction((tx) =>
          planHostedOnboardingLinqWebhook({
            event: recoveredEvent,
            firstContactAdmitted: true,
            prisma: tx,
            requireFirstContactAdmission: true,
          })
        );

        expect(recoveredPlan.response).toMatchObject({
          joinUrl: expect.stringContaining(
            `/groups/join/${joinCode}?invite=`,
          ),
          reason: "sent-signup-link",
        });
        const [signupLinkEffect] = recoveredPlan.desiredSideEffects;
        if (
          !signupLinkEffect
          || signupLinkEffect.payload.template !== "invite_signup"
        ) {
          throw new Error("Expected the recovered group-aware signup link.");
        }
        expect(signupLinkEffect.payload.memberId).toBe(participantMemberId);
        deliveryIdempotencyLookupKey =
          createHostedLinqDeliveryIdempotencyLookupKey(
            signupLinkEffect.effectId,
          );
        expect(signupLinkEffect.payload).toMatchObject({
          groupJoinCode: joinCode,
          groupJoinOutreachId: outreachId,
        });

        const scheduledTasks: Array<() => Promise<void>> = [];
        const scheduleAfterResponse = (task: () => Promise<void>) => {
          scheduledTasks.push(task);
        };
        await expect(drainHostedLinqSideEffectsDirect({
          prisma,
          scheduleAfterResponse,
          sideEffects: recoveredPlan.desiredSideEffects,
        })).resolves.toMatchObject({ sentCount: 1 });

        expect(scheduledTasks).toHaveLength(1);
        await expect(prisma.hostedGroupJoinOutreach.findUnique({
          select: { repliedAt: true },
          where: { id: outreachId },
        })).resolves.toEqual({ repliedAt: null });

        await scheduledTasks[0]?.();

        await expect(prisma.hostedGroupJoinOutreach.findUnique({
          select: { repliedAt: true },
          where: { id: outreachId },
        })).resolves.toEqual({
          repliedAt: new Date("2026-07-24T20:01:00.000Z"),
        });
        await expect(prisma.$transaction((tx) =>
          readHostedGroupJoinOutreachReplyContextTx({
            linqChatId: chatId,
            participantPhoneNumber: participantPhone,
            recipientPhoneNumber: recipientPhone,
            tx,
          })
        )).resolves.toBeNull();
        await expect(prisma.$transaction((tx) =>
          consumeHostedGroupJoinOutreachReplyContextTx({
            outreachId: outreachId ?? "",
            repliedAt: new Date("2026-07-24T20:02:00.000Z"),
            tx,
          })
        )).resolves.toBe(false);
      } finally {
        await cleanupRecoveryProof({
          deliveryIdempotencyLookupKey,
          groupId,
          linqChatLookupKeys,
          ownerMemberId,
          participantMemberId,
          participantPhoneLookupKey,
          prisma,
          recipientPhoneLookupKey,
          runtimeMemberId,
        });
        await prisma.$disconnect();
      }
    });
  },
);

function buildDirectReplyEvent(input: {
  chatId: string;
  eventId: string;
  messageId: string;
  occurredAt: string;
  participantPhone: string;
  recipientPhone: string | null;
}) {
  return parseHostedLinqWebhookEvent(JSON.stringify({
    api_version: "v3",
    created_at: input.occurredAt,
    data: {
      chat: {
        id: input.chatId,
        is_group: false,
        ...(input.recipientPhone
          ? {
              owner_handle: {
                handle: input.recipientPhone,
                id: "owner-handle",
                is_me: true,
                service: "sms",
              },
            }
          : {}),
      },
      direction: "inbound",
      id: input.messageId,
      parts: [{ type: "text", value: "yes" }],
      sender_handle: {
        handle: input.participantPhone,
        id: "sender-handle",
        service: "sms",
      },
      sent_at: input.occurredAt,
      service: "sms",
    },
    event_id: input.eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  }));
}

async function cleanupRecoveryProof(input: {
  deliveryIdempotencyLookupKey: string | null;
  groupId: string;
  linqChatLookupKeys: string[];
  ownerMemberId: string;
  participantMemberId: string | null;
  participantPhoneLookupKey: string | null;
  prisma: PrismaClient;
  recipientPhoneLookupKey: string | null;
  runtimeMemberId: string;
}): Promise<void> {
  await input.prisma.hostedLinqDelivery.deleteMany({
    where: {
      OR: [
        ...(input.deliveryIdempotencyLookupKey
          ? [{ idempotencyKey: input.deliveryIdempotencyLookupKey }]
          : []),
        { linqChatLookupKey: { in: input.linqChatLookupKeys } },
      ],
    },
  });
  await input.prisma.hostedGroup.deleteMany({
    where: { id: input.groupId },
  });

  const participantIdentity = input.participantPhoneLookupKey
    ? await input.prisma.hostedMemberIdentity.findUnique({
        select: { memberId: true },
        where: { phoneLookupKey: input.participantPhoneLookupKey },
      })
    : null;
  await input.prisma.hostedMember.deleteMany({
    where: {
      id: {
        in: [
          input.ownerMemberId,
          input.runtimeMemberId,
          ...(input.participantMemberId ? [input.participantMemberId] : []),
          ...(participantIdentity ? [participantIdentity.memberId] : []),
        ],
      },
    },
  });
  if (input.recipientPhoneLookupKey) {
    await input.prisma.hostedLinqLine.deleteMany({
      where: { phoneNumberLookupKey: input.recipientPhoneLookupKey },
    });
  }
}

function createUniqueTestPhone(prefix: "+1202" | "+1303"): string {
  return `${prefix}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
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
