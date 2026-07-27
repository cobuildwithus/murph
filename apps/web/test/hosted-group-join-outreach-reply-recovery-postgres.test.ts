import { randomInt, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  getHostedLinqChatSummary: vi.fn().mockResolvedValue({
    handles: [],
    isGroup: false,
  }),
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq")
  >("@/src/lib/hosted-onboarding/linq");
  return {
    ...actual,
    sendHostedLinqChatMessage: providerMocks.sendHostedLinqChatMessage,
    verifyAndParseHostedLinqWebhookRequest: vi.fn(
      (input: { rawBody: string }) =>
        actual.parseHostedLinqWebhookEvent(input.rawBody),
    ),
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-client", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/linq-client")
  >("@/src/lib/hosted-onboarding/linq-client");
  return {
    ...actual,
    getHostedLinqChatSummary: providerMocks.getHostedLinqChatSummary,
  };
});

import {
  enqueueHostedGroupJoinOutreachTx,
  readHostedGroupJoinOutreachReplyContextTx,
} from "@/src/lib/hosted-groups/group-join-outreach-store";
import {
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
  claimHostedLinqDeliveryProviderDispatchTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  buildHostedLinqInviteSignupDeliverySourceRef,
  buildHostedLinqInviteSignupEffectId,
} from "@/src/lib/hosted-onboarding/linq-invite-signup-effect-id";
import {
  upsertHostedLinqLineForPhoneTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import { parseHostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  buildHostedMemberIdentityPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
  createHostedLinqProviderEventLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import {
  planHostedOnboardingLinqWebhook,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import {
  handleHostedOnboardingLinqWebhook,
} from "@/src/lib/hosted-onboarding/webhook-service";
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
      const newerGroupId = `hgrp_group_reply_newer_${randomUUID()}`;
      const joinCode = `join-group-reply-${randomUUID()}`;
      const newerJoinCode = `join-group-reply-newer-${randomUUID()}`;
      const offerId = `hgrpjo_group_reply_${randomUUID()}`;
      const newerOfferId = `hgrpjo_group_reply_newer_${randomUUID()}`;
      const ownerMemberId = `hbm_group_owner_${randomUUID()}`;
      const newerOwnerMemberId = `hbm_group_owner_newer_${randomUUID()}`;
      const runtimeMemberId = `hbm_group_runtime_${randomUUID()}`;
      const newerRuntimeMemberId = `hbm_group_runtime_newer_${randomUUID()}`;
      const participantMemberId = `hbm_group_participant_${randomUUID()}`;
      const linqChatLookupKeys =
        createHostedLinqChatLookupKeyReadCandidates(chatId);
      let outreachId: string | null = null;
      let newerOutreachId: string | null = null;
      let deliveryIdempotencyLookupKey: string | null = null;

      const newerProviderMessageId = `linq-message-newer-${randomUUID()}`;
      const originalProviderMessageId = `linq-message-original-${randomUUID()}`;
      const genericProviderMessageId = `linq-message-generic-${randomUUID()}`;
      const retryProviderMessageId = `linq-message-retry-${randomUUID()}`;
      const genericEffectId = buildHostedLinqInviteSignupEffectId({
        memberId: participantMemberId,
        occurredAt: "2026-07-24T19:30:00.000Z",
      });
      const genericDeliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(genericEffectId);
      const genericMessageLookupKey =
        createHostedLinqMessageLookupKey(genericProviderMessageId);
      if (!genericDeliveryLookupKey || !genericMessageLookupKey) {
        throw new Error("Expected generic signup delivery lookup keys.");
      }
      providerMocks.sendHostedLinqChatMessage
        .mockResolvedValueOnce({
          chatId,
          messageId: newerProviderMessageId,
        })
        .mockResolvedValueOnce({
          chatId,
          messageId: originalProviderMessageId,
        })
        .mockResolvedValueOnce({
          chatId,
          messageId: retryProviderMessageId,
        });

      try {
        await prisma.hostedMember.createMany({
          data: [
            { id: ownerMemberId },
            { id: newerOwnerMemberId },
            { id: runtimeMemberId },
            { id: newerRuntimeMemberId },
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
        if (!deliveryIdempotencyLookupKey) {
          throw new Error("Expected the signup delivery lookup key.");
        }

        const genericAcceptedAt = new Date("2026-07-24T19:30:00.000Z");
        await prisma.hostedLinqDelivery.create({
          data: {
            acceptedAt: genericAcceptedAt,
            attemptedAt: new Date("2026-07-24T19:29:59.000Z"),
            id: `hld_generic_${randomUUID()}`,
            idempotencyKey: genericDeliveryLookupKey,
            linqChatLookupKey: createHostedLinqChatLookupKey(chatId),
            messageLookupKey: genericMessageLookupKey,
            source: "hosted_webhook_side_effect",
            sourceRef: genericEffectId,
            status: "accepted",
            targetKind: "thread",
            template: "invite_signup",
          },
        });
        await prisma.hostedLinqDailyState.update({
          data: {
            onboardingLinkSentAt: genericAcceptedAt,
          },
          where: {
            memberId_dayUtc: {
              dayUtc: new Date("2026-07-24T00:00:00.000Z"),
              memberId: participantMemberId,
            },
          },
        });

        // Materialize the exact state left by process termination after the
        // preparation transaction commits and before provider entry. The
        // provider has seen no request and the attempt has no correlation.
        const crashClaimedAt = new Date();
        const originalSourceRef =
          buildHostedLinqInviteSignupDeliverySourceRef({
            effectId: signupLinkEffect.effectId,
            groupJoinOutreachId: outreachId,
            groupJoinRepliedAt: signupLinkEffect.payload.occurredAt,
          });
        await expect(claimHostedLinqDeliveryProviderDispatchTx({
          attemptedAt: crashClaimedAt,
          idempotencyKey: signupLinkEffect.effectId,
          linqChatId: chatId,
          prisma,
          reclaimStalePreProviderAttempt: true,
          source: "hosted_webhook_side_effect",
          sourceRef: originalSourceRef,
          status: "attempted",
          targetKind: "thread",
          template: "invite_signup",
        })).resolves.toMatchObject({ claimed: true });

        const scheduledTasks: Array<() => Promise<void>> = [];
        const scheduleAfterResponse = (task: () => Promise<void>) => {
          scheduledTasks.push(task);
        };
        await expect(handleHostedOnboardingLinqWebhook({
          prisma,
          rawBody: JSON.stringify(recoveredEvent),
          scheduleAfterResponse,
          signature: null,
          timestamp: null,
        })).rejects.toMatchObject({
          code: "HOSTED_LINQ_SIGNUP_DELIVERY_IN_FLIGHT",
          httpStatus: 503,
          retryable: true,
        });
        expect(providerMocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
        expect(scheduledTasks).toHaveLength(0);

        // A newer same-day inbound is an independent group intention. It sends
        // under its own exact-source provider key without rewriting or waiting
        // for the crashed original event.
        await prisma.hostedGroup.create({
          data: {
            displayName: "Newer Recovery Proof Group",
            id: newerGroupId,
            joinCode: newerJoinCode,
            joinCodeCreatedAt: new Date("2026-07-24T20:00:30.000Z"),
            ownerMemberId: newerOwnerMemberId,
            runtimeMemberId: newerRuntimeMemberId,
          },
        });
        await prisma.hostedGroupJoinOffer.create({
          data: {
            groupId: newerGroupId,
            id: newerOfferId,
            messageLookupKey: `message-lookup-${randomUUID()}`,
            postedAt: new Date("2026-07-24T20:00:30.000Z"),
            projectionKindsJson: ["best_effort"],
          },
        });
        const newerEnqueue = await prisma.$transaction((tx) =>
          enqueueHostedGroupJoinOutreachTx({
            groupId: newerGroupId,
            offerId: newerOfferId,
            participantPhoneNumber: participantPhone,
            requestedAt: new Date("2026-07-24T20:00:30.000Z"),
            tx,
          })
        );
        newerOutreachId = newerEnqueue.outreachId;
        await prisma.hostedGroupJoinOutreach.update({
          data: {
            dispatchStartedAt: new Date("2026-07-24T20:00:31.000Z"),
            linqChatLookupKey: linqChatLookupKeys[0],
            phoneNumberLookupKey: recipientPhoneLookupKey,
            sentAt: new Date("2026-07-24T20:00:32.000Z"),
          },
          where: { id: newerOutreachId },
        });
        const newerInboundEvent = buildDirectReplyEvent({
          chatId,
          eventId: `event-newer-${randomUUID()}`,
          messageId: `message-newer-${randomUUID()}`,
          occurredAt: "2026-07-24T20:01:30.000Z",
          participantPhone,
          recipientPhone,
        });
        await expect(handleHostedOnboardingLinqWebhook({
          prisma,
          rawBody: JSON.stringify(newerInboundEvent),
          scheduleAfterResponse,
          signature: null,
          timestamp: null,
        })).resolves.toMatchObject({
          ok: true,
          reason: "sent-signup-link",
        });
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
        const newerProviderCall =
          providerMocks.sendHostedLinqChatMessage.mock.calls[0]?.[0];
        expect(newerProviderCall).toEqual(expect.objectContaining({
          chatId,
          idempotencyKey: expect.any(String),
          message: expect.stringContaining(
            `/groups/join/${newerJoinCode}?invite=`,
          ),
        }));
        expect(newerProviderCall?.idempotencyKey).not.toBe(
          signupLinkEffect.effectId,
        );
        await expect(prisma.hostedLinqDelivery.findUnique({
          select: { sourceRef: true },
          where: {
            idempotencyKey: deliveryIdempotencyLookupKey,
          },
        })).resolves.toEqual({ sourceRef: originalSourceRef });

        for (const task of scheduledTasks.splice(0)) {
          await task();
        }
        await expect(prisma.hostedGroupJoinOutreach.findUnique({
          select: { repliedAt: true },
          where: { id: newerOutreachId },
        })).resolves.toEqual({
          repliedAt: new Date("2026-07-24T20:01:30.000Z"),
        });
        const dailyStateAfterNewerGroup =
          await prisma.hostedLinqDailyState.findFirst({
          select: { onboardingLinkSentAt: true },
          where: {
            dayUtc: new Date("2026-07-24T00:00:00.000Z"),
            memberId: participantMemberId,
          },
        });
        expect(dailyStateAfterNewerGroup?.onboardingLinkSentAt)
          .toEqual(expect.any(Date));
        const groupSignupAcceptedAt =
          dailyStateAfterNewerGroup?.onboardingLinkSentAt ?? null;
        if (!groupSignupAcceptedAt) {
          throw new Error("Expected group signup acceptance to close the daily gate.");
        }

        // A retry of the same webhook effect after the ambiguity window owns
        // continuation. It reclaims the exact row and reuses the immutable
        // effect id, source context, message seed, and provider key.
        await prisma.hostedLinqDelivery.updateMany({
          data: {
            attemptedAt: new Date(
              Date.now() - HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS - 1,
            ),
          },
          where: {
            idempotencyKey: deliveryIdempotencyLookupKey,
          },
        });
        await expect(handleHostedOnboardingLinqWebhook({
          prisma,
          rawBody: JSON.stringify(recoveredEvent),
          scheduleAfterResponse,
          signature: null,
          timestamp: null,
        })).resolves.toMatchObject({
          ok: true,
          reason: "sent-signup-link",
        });
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenLastCalledWith(
          expect.objectContaining({
            chatId,
            idempotencyKey: signupLinkEffect.effectId,
            message: expect.stringContaining(
              `/groups/join/${joinCode}?invite=`,
            ),
          }),
        );

        expect(scheduledTasks.length).toBeGreaterThan(0);
        await expect(prisma.hostedGroupJoinOutreach.findUnique({
          select: { repliedAt: true },
          where: { id: outreachId },
        })).resolves.toEqual({ repliedAt: null });

        for (const task of scheduledTasks.splice(0)) {
          await task();
        }

        await expect(prisma.hostedGroupJoinOutreach.findUnique({
          select: { repliedAt: true },
          where: { id: outreachId },
        })).resolves.toEqual({
          repliedAt: new Date("2026-07-24T20:01:00.000Z"),
        });

        await expect(prisma.hostedGroupJoinOutreach.findUnique({
          select: { repliedAt: true },
          where: { id: newerOutreachId },
        })).resolves.toEqual({
          repliedAt: new Date("2026-07-24T20:01:30.000Z"),
        });
        await expect(prisma.hostedLinqDailyState.findFirst({
          select: { onboardingLinkSentAt: true },
          where: {
            dayUtc: new Date("2026-07-24T00:00:00.000Z"),
            memberId: participantMemberId,
          },
        })).resolves.toEqual({
          onboardingLinkSentAt: groupSignupAcceptedAt,
        });
        await expect(prisma.hostedLinqDelivery.findUnique({
          select: { sourceRef: true },
          where: {
            idempotencyKey: deliveryIdempotencyLookupKey,
          },
        })).resolves.toEqual({ sourceRef: originalSourceRef });

        const delayedGenericFailure = parseHostedLinqProviderEvent({
          event: parseHostedLinqWebhookEvent(JSON.stringify({
            api_version: "v3",
            created_at: "2026-07-24T20:01:45.000Z",
            data: {
              error: {
                code: "30007",
                message: "carrier filtered",
              },
              message_id: genericProviderMessageId,
              phone_number: recipientPhone,
              service: "sms",
            },
            event_id: `event-generic-failed-${randomUUID()}`,
            event_type: "message.failed",
            trace_id: `trace-generic-failed-${randomUUID()}`,
            webhook_version: "2026-02-03",
          })),
          rawBody: "{}",
        });
        if (!delayedGenericFailure) {
          throw new Error("Expected the delayed generic failure to parse.");
        }
        await prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: delayedGenericFailure,
            prisma: tx,
          })
        );
        await expect(prisma.hostedLinqDelivery.findUnique({
          select: { status: true },
          where: { idempotencyKey: genericDeliveryLookupKey },
        })).resolves.toEqual({ status: "failed" });
        await expect(prisma.hostedLinqDailyState.findFirst({
          select: { onboardingLinkSentAt: true },
          where: {
            dayUtc: new Date("2026-07-24T00:00:00.000Z"),
            memberId: participantMemberId,
          },
        })).resolves.toEqual({
          onboardingLinkSentAt: groupSignupAcceptedAt,
        });
        await expect(prisma.$transaction((tx) =>
          readHostedGroupJoinOutreachReplyContextTx({
            linqChatId: chatId,
            participantPhoneNumber: participantPhone,
            recipientPhoneNumber: recipientPhone,
            tx,
          })
        )).resolves.toBeNull();
        const ordinaryInboundEvent = buildDirectReplyEvent({
          chatId,
          eventId: `event-ordinary-${randomUUID()}`,
          messageId: `message-ordinary-${randomUUID()}`,
          occurredAt: "2026-07-24T20:02:00.000Z",
          participantPhone,
          recipientPhone,
        });
        await expect(handleHostedOnboardingLinqWebhook({
          prisma,
          rawBody: JSON.stringify(ordinaryInboundEvent),
          scheduleAfterResponse,
          signature: null,
          timestamp: null,
        })).resolves.toMatchObject({
          ignored: true,
          reason: "signup-link-already-sent",
        });
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);

        // Once every group-aware identity also fails, the same member-owned
        // projection must converge to open regardless of receipt order.
        await prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedFailureReceipt({
              eventId: `event-newer-group-failed-${randomUUID()}`,
              messageId: newerProviderMessageId,
              occurredAt: "2026-07-24T20:02:10.000Z",
              recipientPhone,
            }),
            prisma: tx,
          })
        );
        await expect(prisma.hostedLinqDailyState.findFirst({
          select: { onboardingLinkSentAt: true },
          where: {
            dayUtc: new Date("2026-07-24T00:00:00.000Z"),
            memberId: participantMemberId,
          },
        })).resolves.toEqual({
          onboardingLinkSentAt: groupSignupAcceptedAt,
        });
        await prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedFailureReceipt({
              eventId: `event-original-group-failed-${randomUUID()}`,
              messageId: originalProviderMessageId,
              occurredAt: "2026-07-24T20:02:20.000Z",
              recipientPhone,
            }),
            prisma: tx,
          })
        );
        await expect(prisma.hostedLinqDailyState.findFirst({
          select: { onboardingLinkSentAt: true },
          where: {
            dayUtc: new Date("2026-07-24T00:00:00.000Z"),
            memberId: participantMemberId,
          },
        })).resolves.toEqual({
          onboardingLinkSentAt: null,
        });

        // The exact group owner may disappear before the next inbound. That
        // must not strand the ordinary signup retry behind the old marker.
        await prisma.hostedGroup.deleteMany({
          where: { id: { in: [groupId, newerGroupId] } },
        });
        const retryInboundEvent = buildDirectReplyEvent({
          chatId,
          eventId: `event-retry-${randomUUID()}`,
          messageId: `message-retry-${randomUUID()}`,
          occurredAt: "2026-07-24T20:02:30.000Z",
          participantPhone,
          recipientPhone,
        });
        await expect(handleHostedOnboardingLinqWebhook({
          prisma,
          rawBody: JSON.stringify(retryInboundEvent),
          scheduleAfterResponse,
          signature: null,
          timestamp: null,
        })).resolves.toMatchObject({
          ok: true,
          reason: "sent-signup-link",
        });
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(3);
        for (const task of scheduledTasks.splice(0)) {
          await task();
        }
      } finally {
        await cleanupRecoveryProof({
          deliveryIdempotencyLookupKey,
          groupIds: [groupId, newerGroupId],
          linqChatLookupKeys,
          ownerMemberId,
          additionalMemberIds: [
            newerOwnerMemberId,
            newerRuntimeMemberId,
          ],
          participantMemberId,
          participantPhoneLookupKey,
          prisma,
          recipientPhoneLookupKey,
          runtimeMemberId,
        });
        await prisma.$disconnect();
      }
    });

    it.each([
      ["generic then group", ["generic", "group"]],
      ["group then generic", ["group", "generic"]],
    ] as const)(
      "converges shared signup suppression after %s terminal receipts",
      async (_label, receiptOrder) => {
        const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
        const memberId = `hbm_receipt_order_${randomUUID()}`;
        const dayUtc = new Date("2026-07-25T00:00:00.000Z");
        const acceptedAt = new Date("2026-07-25T12:00:00.000Z");
        const genericMessageId = `linq-generic-order-${randomUUID()}`;
        const groupMessageId = `linq-group-order-${randomUUID()}`;
        const genericEffectId = buildHostedLinqInviteSignupEffectId({
          memberId,
          occurredAt: acceptedAt,
        });
        const groupEffectId = buildHostedLinqInviteSignupEffectId({
          memberId,
          occurredAt: acceptedAt,
          sourceEventDigest: randomUUID().replaceAll("-", "").slice(0, 32),
        });
        const groupOutreachId = `hgrpjoa_deleted_${randomUUID()}`;
        const genericLookupKey =
          createHostedLinqDeliveryIdempotencyLookupKey(genericEffectId);
        const groupLookupKey =
          createHostedLinqDeliveryIdempotencyLookupKey(groupEffectId);
        const genericMessageLookupKey =
          createHostedLinqMessageLookupKey(genericMessageId);
        const groupMessageLookupKey =
          createHostedLinqMessageLookupKey(groupMessageId);
        const recipientPhone = createUniqueTestPhone("+1303");
        const recipientPhoneLookupKey =
          createHostedPhoneLookupKey(recipientPhone);
        if (
          !genericLookupKey
          || !groupLookupKey
          || !genericMessageLookupKey
          || !groupMessageLookupKey
          || !recipientPhoneLookupKey
        ) {
          throw new Error("Expected receipt-order proof lookup keys.");
        }
        const rawEventIds: string[] = [];

        try {
          await prisma.hostedMember.create({
            data: { id: memberId },
          });
          await prisma.hostedLinqDailyState.create({
            data: {
              dayUtc,
              firstSeenAt: acceptedAt,
              lastSeenAt: acceptedAt,
              memberId,
              onboardingLinkSentAt: acceptedAt,
            },
          });
          await prisma.hostedLinqDelivery.createMany({
            data: [
              {
                acceptedAt,
                attemptedAt: acceptedAt,
                id: `hld_generic_order_${randomUUID()}`,
                idempotencyKey: genericLookupKey,
                messageLookupKey: genericMessageLookupKey,
                source: "hosted_webhook_side_effect",
                sourceRef: genericEffectId,
                status: "accepted",
                targetKind: "thread",
                template: "invite_signup",
              },
              {
                acceptedAt,
                attemptedAt: acceptedAt,
                id: `hld_group_order_${randomUUID()}`,
                idempotencyKey: groupLookupKey,
                messageLookupKey: groupMessageLookupKey,
                source: "hosted_webhook_side_effect",
                sourceRef: buildHostedLinqInviteSignupDeliverySourceRef({
                  effectId: groupEffectId,
                  groupJoinOutreachId: groupOutreachId,
                  groupJoinRepliedAt: acceptedAt.toISOString(),
                }),
                status: "accepted",
                targetKind: "thread",
                template: "invite_signup",
              },
            ],
          });

          for (const [index, identity] of receiptOrder.entries()) {
            const eventId = `event-${identity}-order-${randomUUID()}`;
            rawEventIds.push(eventId);
            await prisma.$transaction((tx) =>
              ingestHostedLinqProviderEventTx({
                event: buildParsedFailureReceipt({
                  eventId,
                  messageId: identity === "generic"
                    ? genericMessageId
                    : groupMessageId,
                  occurredAt: new Date(
                    acceptedAt.getTime() + (index + 1) * 60_000,
                  ).toISOString(),
                  recipientPhone,
                }),
                prisma: tx,
              })
            );
            await expect(prisma.hostedLinqDailyState.findUnique({
              select: { onboardingLinkSentAt: true },
              where: {
                memberId_dayUtc: {
                  dayUtc,
                  memberId,
                },
              },
            })).resolves.toEqual({
              onboardingLinkSentAt: index === 0 ? acceptedAt : null,
            });
          }

          await expect(prisma.hostedLinqDelivery.findMany({
            orderBy: { id: "asc" },
            select: { status: true },
            where: {
              idempotencyKey: {
                in: [genericLookupKey, groupLookupKey],
              },
            },
          })).resolves.toEqual([
            { status: "failed" },
            { status: "failed" },
          ]);
        } finally {
          const eventLookupKeys = rawEventIds.map(
            createHostedLinqProviderEventLookupKey,
          );
          await prisma.hostedLinqAlert.deleteMany({
            where: { eventId: { in: eventLookupKeys } },
          });
          await prisma.hostedLinqProviderEvent.deleteMany({
            where: { eventId: { in: eventLookupKeys } },
          });
          await prisma.hostedLinqDelivery.deleteMany({
            where: {
              idempotencyKey: {
                in: [genericLookupKey, groupLookupKey],
              },
            },
          });
          await prisma.hostedMember.deleteMany({
            where: { id: memberId },
          });
          await prisma.hostedLinqLine.deleteMany({
            where: { phoneNumberLookupKey: recipientPhoneLookupKey },
          });
          await prisma.$disconnect();
        }
      },
    );
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

function buildParsedFailureReceipt(input: {
  eventId: string;
  messageId: string;
  occurredAt: string;
  recipientPhone: string;
}) {
  const parsed = parseHostedLinqProviderEvent({
    event: parseHostedLinqWebhookEvent(JSON.stringify({
      api_version: "v3",
      created_at: input.occurredAt,
      data: {
        error: {
          code: "30007",
          message: "carrier filtered",
        },
        message_id: input.messageId,
        phone_number: input.recipientPhone,
        service: "sms",
      },
      event_id: input.eventId,
      event_type: "message.failed",
      trace_id: `trace-${randomUUID()}`,
      webhook_version: "2026-02-03",
    })),
    rawBody: "{}",
  });
  if (!parsed) {
    throw new Error("Expected the terminal failure receipt to parse.");
  }
  return parsed;
}

async function cleanupRecoveryProof(input: {
  additionalMemberIds: string[];
  deliveryIdempotencyLookupKey: string | null;
  groupIds: string[];
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
    where: { id: { in: input.groupIds } },
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
          ...input.additionalMemberIds,
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
