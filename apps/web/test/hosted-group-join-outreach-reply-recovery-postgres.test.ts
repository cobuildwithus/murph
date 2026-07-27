import { randomInt, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  getHostedLinqChatSummary: vi.fn().mockResolvedValue({
    handles: [],
    isGroup: false,
  }),
  sendHostedLinqChatMessage: vi.fn(),
}));
const accountDeletionMocks = vi.hoisted(() => ({
  assertHostedPhoneCallsReadyForAccountDeletionTx:
    vi.fn().mockResolvedValue(undefined),
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx:
    vi.fn().mockResolvedValue(undefined),
  closeHostedUsageCreditPurchasesForAccountDeletion:
    vi.fn().mockResolvedValue(undefined),
  deleteHostedPhoneCallsForAccountDeletion:
    vi.fn().mockResolvedValue(undefined),
  deleteHostedRunnerUserDataBestEffort: vi.fn().mockResolvedValue({
    alarmCleared: true,
    configured: true,
    deleteAllCompleted: true,
    deleted: true,
    errorCode: null,
    r2DeletedObjectCount: 0,
    r2SkippedUserScopedPrefixes: false,
    r2Supported: true,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: true,
  }),
  terminateHostedUserRuntimeWorkflowBestEffort: vi.fn().mockResolvedValue({
    configured: true,
    errorCode: null,
    notFound: false,
    terminated: true,
  }),
  pendingHostedAccountDeletionCleanupResult: vi.fn(),
  persistHostedAccountDeletionCleanupTx: vi.fn().mockResolvedValue(undefined),
  prepareHostedAccountDeletionCleanup: vi.fn().mockImplementation(
    async (input: {
      now: Date;
      runtimeMemberIds: readonly string[];
      stripeCustomerIds: readonly string[];
      stripeSubscriptionIds?: readonly string[];
    }) => ({
      cloudflareCompletedAt: null,
      environment: "test",
      id: `cleanup_group_reply_${randomUUID()}`,
      kmsKeyName: "test-key",
      nextAttemptAt: input.now,
      payloadCiphertext: "encrypted",
      privyCompletedAt: input.now,
      privyUserLookupKey: null,
      runtimeMemberIds: [...input.runtimeMemberIds],
      stripeCustomerIds: [...input.stripeCustomerIds],
      stripeCompletedAt: input.now,
      stripeSubscriptionIds: [...(input.stripeSubscriptionIds ?? [])],
    }),
  ),
  runHostedAccountDeletionCleanup: vi.fn().mockResolvedValue({
    cleanupPending: false,
    cloudflare: {
      alarmCleared: true,
      configured: true,
      deleteAllCompleted: true,
      deleted: true,
      errorCode: null,
      r2DeletedObjectCount: 0,
      r2SkippedUserScopedPrefixes: false,
      r2Supported: true,
      r2UserScopedSkipReason: null,
      runnerStateDeleted: true,
    },
    vendorAccounts: {
      privyUser: { errorCode: null, status: "skipped_no_record" },
      stripeCustomer: { errorCode: null, status: "skipped_no_record" },
    },
  }),
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

vi.mock(
  "@/src/lib/hosted-onboarding/usage-credit-purchase-service",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/usage-credit-purchase-service")
    >("@/src/lib/hosted-onboarding/usage-credit-purchase-service");
    return {
      ...actual,
      assertHostedUsageCreditPurchasesReadyForAccountDeletionTx:
        accountDeletionMocks
          .assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
      closeHostedUsageCreditPurchasesForAccountDeletion:
        accountDeletionMocks.closeHostedUsageCreditPurchasesForAccountDeletion,
    };
  },
);

vi.mock("@/src/lib/hosted-execution/user-data-delete", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-execution/user-data-delete")
  >("@/src/lib/hosted-execution/user-data-delete");
  return {
    ...actual,
    deleteHostedRunnerUserDataBestEffort:
      accountDeletionMocks.deleteHostedRunnerUserDataBestEffort,
  };
});

vi.mock("@/src/lib/hosted-privacy/account-deletion-cleanup", () => ({
  HOSTED_ACCOUNT_DELETION_IMMEDIATE_ATTEMPT_TIMEOUT_MS: 5_000,
  pendingHostedAccountDeletionCleanupResult:
    accountDeletionMocks.pendingHostedAccountDeletionCleanupResult,
  persistHostedAccountDeletionCleanupTx:
    accountDeletionMocks.persistHostedAccountDeletionCleanupTx,
  prepareHostedAccountDeletionCleanup:
    accountDeletionMocks.prepareHostedAccountDeletionCleanup,
  runHostedAccountDeletionCleanup:
    accountDeletionMocks.runHostedAccountDeletionCleanup,
}));

vi.mock("@/src/lib/hosted-orchestration/workflow-termination", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-orchestration/workflow-termination")
  >("@/src/lib/hosted-orchestration/workflow-termination");
  return {
    ...actual,
    terminateHostedUserRuntimeWorkflowBestEffort:
      accountDeletionMocks.terminateHostedUserRuntimeWorkflowBestEffort,
  };
});

vi.mock("@/src/lib/phone-calls/account-deletion", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/phone-calls/account-deletion")
  >("@/src/lib/phone-calls/account-deletion");
  return {
    ...actual,
    assertHostedPhoneCallsReadyForAccountDeletionTx:
      accountDeletionMocks.assertHostedPhoneCallsReadyForAccountDeletionTx,
    deleteHostedPhoneCallsForAccountDeletion:
      accountDeletionMocks.deleteHostedPhoneCallsForAccountDeletion,
  };
});

import {
  HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
  HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
  acquireHostedGroupJoinOutreachDrainLockTx,
  buildHostedGroupJoinOutreachIdempotencyKey,
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
import {
  sendHostedLinqChatMessage as sendHostedLinqChatMessageOverHttp,
} from "@/src/lib/hosted-onboarding/linq-client";
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
  createHostedWebhookLinqMessageSideEffect,
  drainHostedLinqSideEffectsDirect,
} from "@/src/lib/hosted-onboarding/webhook-transport";
import {
  planHostedOnboardingLinqWebhook,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq";
import {
  handleHostedOnboardingLinqWebhook,
} from "@/src/lib/hosted-onboarding/webhook-service";
import { deleteHostedAccountData } from "@/src/lib/hosted-privacy/account-data-service";
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
            offerId,
            participantPhoneNumber: participantPhone,
            requestedAt: new Date("2026-07-24T19:00:00.000Z"),
            tx,
          })
        );
        outreachId = enqueue.outreachId;
        await recordAcceptedGroupJoinOutreachOpener({
          acceptedAt: new Date("2026-07-24T19:02:00.000Z"),
          attemptedAt: new Date("2026-07-24T19:01:00.000Z"),
          chatId: null,
          messageId: `linq-message-opener-${randomUUID()}`,
          outreachId,
          prisma,
          recipientPhoneLookupKey,
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
          groupJoinOutreachId: outreachId,
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
            offerId: newerOfferId,
            participantPhoneNumber: participantPhone,
            requestedAt: new Date("2026-07-24T20:00:30.000Z"),
            tx,
          })
        );
        newerOutreachId = newerEnqueue.outreachId;
        await recordAcceptedGroupJoinOutreachOpener({
          acceptedAt: new Date("2026-07-24T20:00:32.000Z"),
          attemptedAt: new Date("2026-07-24T20:00:31.000Z"),
          chatId,
          messageId: `linq-message-opener-newer-${randomUUID()}`,
          outreachId: newerOutreachId,
          prisma,
          recipientPhoneLookupKey,
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

        // Group-aware delivery correlation is part of the provider fence and
        // is durable before the drain-owning send returns. Unrelated generic
        // post-response work may still remain scheduled.
        expect(scheduledTasks.length).toBeGreaterThan(0);

        for (const task of scheduledTasks.splice(0)) {
          await task();
        }

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

        // Production account deletion removes the first group destination and
        // its correlation. The distinct live group identity must continue to
        // justify shared suppression.
        await deleteHostedAccountData({
          memberId: ownerMemberId,
          prisma,
          request: new Request("https://join.example.test/settings"),
        });
        await expect(prisma.hostedLinqDelivery.findFirst({
          select: { id: true },
          where: {
            messageLookupKey:
              createHostedLinqMessageLookupKey(originalProviderMessageId),
          },
        })).resolves.toBeNull();
        await expect(prisma.hostedLinqDailyState.findFirst({
          select: { onboardingLinkSentAt: true },
          where: {
            dayUtc: new Date("2026-07-24T00:00:00.000Z"),
            memberId: participantMemberId,
          },
        })).resolves.toEqual({
          onboardingLinkSentAt: groupSignupAcceptedAt,
        });

        // A receipt that loses its deleted provider correlation cannot be the
        // projection owner. The deletion transaction must already have
        // converged the marker.
        await prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedFailureReceipt({
              eventId: `event-original-group-failed-${randomUUID()}`,
              messageId: originalProviderMessageId,
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

        // Removing the final live group identity clears the participant's
        // marker inside deleteHostedAccountData before the group cascade.
        await deleteHostedAccountData({
          memberId: newerOwnerMemberId,
          prisma,
          request: new Request("https://join.example.test/settings"),
        });
        await expect(prisma.hostedLinqDailyState.findFirst({
          select: { onboardingLinkSentAt: true },
          where: {
            dayUtc: new Date("2026-07-24T00:00:00.000Z"),
            memberId: participantMemberId,
          },
        })).resolves.toEqual({
          onboardingLinkSentAt: null,
        });
        await prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedFailureReceipt({
              eventId: `event-newer-group-failed-${randomUUID()}`,
              messageId: newerProviderMessageId,
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

        // Both exact group owners are gone before the next inbound. The
        // participant must still receive an ordinary signup retry.
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
        vi.unstubAllEnvs();
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

    it("lets a reply already holding the drain finish before the same deletion request", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const fixture = await createDeletionReplyRaceFixture();
      let releaseProvider = () => {};
      const providerMayContinue = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      let reportProviderStarted = () => {};
      const providerStarted = new Promise<void>((resolve) => {
        reportProviderStarted = resolve;
      });
      let reportDeletionCrossedFence = () => {};
      const deletionCrossedFence = new Promise<void>((resolve) => {
        reportDeletionCrossedFence = resolve;
      });
      let cleanupCalls = 0;
      accountDeletionMocks.prepareHostedAccountDeletionCleanup
        .mockReset()
        .mockImplementation(async (input) => {
          reportDeletionCrossedFence();
          return makePreparedDeletionCleanup(input);
        });
      accountDeletionMocks.runHostedAccountDeletionCleanup
        .mockReset()
        .mockImplementation(async () => {
          cleanupCalls += 1;
          return makeDeletionCleanupRunResult();
        });
      providerMocks.sendHostedLinqChatMessage
        .mockReset()
        .mockImplementation(async () => {
          reportProviderStarted();
          await providerMayContinue;
          return {
            chatId: fixture.chatId,
            messageId: `linq-delete-fence-${randomUUID()}`,
          };
        });
      let deletionPromise: ReturnType<typeof deleteHostedAccountData> | null =
        null;
      let replyPromise: ReturnType<typeof drainDeletionReplyEffect> | null =
        null;

      try {
        replyPromise = drainDeletionReplyEffect({
          effect: fixture.effect,
          prisma: fixture.replyPrisma,
        });
        await providerStarted;

        let deletionSettled = false;
        deletionPromise = deleteHostedAccountData({
          memberId: fixture.ownerMemberId,
          prisma: fixture.deletionPrisma,
          request: new Request("https://join.example.test/settings"),
        }).finally(() => {
          deletionSettled = true;
        });
        const crossedFenceBeforeProviderCompleted = await Promise.race([
          deletionCrossedFence.then(() => true),
          new Promise<false>((resolve) => {
            setTimeout(() => resolve(false), 1_000);
          }),
        ]);
        expect(crossedFenceBeforeProviderCompleted).toBe(false);
        expect(cleanupCalls).toBe(0);
        expect(deletionSettled).toBe(false);
        releaseProvider();

        const [replyResult] = await withTimeout(
          Promise.all([replyPromise, deletionPromise]),
          10_000,
        );
        expect(replyResult).toMatchObject({ sentCount: 1, skipped: [] });
        expect(cleanupCalls).toBe(1);
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
        await expectDeletionReplyRaceConverged(fixture);
      } finally {
        releaseProvider();
        await Promise.allSettled([
          ...(replyPromise ? [replyPromise] : []),
          ...(deletionPromise ? [deletionPromise] : []),
        ]);
        await cleanupDeletionReplyRaceFixture(fixture);
        accountDeletionMocks.prepareHostedAccountDeletionCleanup
          .mockReset()
          .mockImplementation(async (input) =>
            makePreparedDeletionCleanup(input)
          );
        accountDeletionMocks.runHostedAccountDeletionCleanup
          .mockReset()
          .mockResolvedValue(makeDeletionCleanupRunResult());
        providerMocks.sendHostedLinqChatMessage.mockReset();
        vi.unstubAllEnvs();
      }
    });

    it("aborts a stalled provider body before fence expiry while deletion waits", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const fixture = await createDeletionReplyRaceFixture();
      let reportHeadersFlushed = () => {};
      const headersFlushed = new Promise<void>((resolve) => {
        reportHeadersFlushed = resolve;
      });
      let providerConnectionClosed = false;
      const server = createServer((_request, response) => {
        response.on("close", () => {
          providerConnectionClosed = true;
        });
        response.writeHead(200, {
          "content-type": "application/json",
        });
        response.flushHeaders();
        response.write(
          `{"chat_id":${JSON.stringify(fixture.chatId)},"message":{"id":`,
        );
        reportHeadersFlushed();
      });
      const apiBaseUrl = await listenOnLoopback(server);
      vi.stubEnv("LINQ_API_BASE_URL", apiBaseUrl);
      vi.stubEnv("LINQ_API_TOKEN", "test-token");
      clearHostedOnboardingEnvCache();
      let cleanupCalls = 0;
      accountDeletionMocks.runHostedAccountDeletionCleanup
        .mockReset()
        .mockImplementation(async () => {
          cleanupCalls += 1;
          return makeDeletionCleanupRunResult();
        });
      providerMocks.sendHostedLinqChatMessage
        .mockReset()
        .mockImplementation(sendHostedLinqChatMessageOverHttp);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      let deletionPromise: ReturnType<typeof deleteHostedAccountData> | null =
        null;
      let replyPromise: ReturnType<typeof drainDeletionReplyEffect> | null =
        null;

      try {
        replyPromise = drainDeletionReplyEffect({
          effect: fixture.effect,
          prisma: fixture.replyPrisma,
        });
        await headersFlushed;

        let deletionSettled = false;
        deletionPromise = deleteHostedAccountData({
          memberId: fixture.ownerMemberId,
          prisma: fixture.deletionPrisma,
          request: new Request("https://join.example.test/settings"),
        }).finally(() => {
          deletionSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        expect(deletionSettled).toBe(false);
        expect(cleanupCalls).toBe(0);

        const replyError = await withTimeout(
          replyPromise.then(
            () => null,
            (error: unknown) => error,
          ),
          15_000,
        );
        expect(replyError).toMatchObject({
          code: "LINQ_SEND_FAILED",
          httpStatus: 502,
          message: "Linq outbound reply timed out.",
          retryable: true,
        });
        expect(replyError).not.toMatchObject({ code: "P2028" });
        await expect(withTimeout(deletionPromise, 15_000)).resolves.toBeDefined();
        expect(cleanupCalls).toBe(1);
        await vi.waitFor(() => {
          expect(providerConnectionClosed).toBe(true);
        });
        await expectDeletionReplyRaceConverged(fixture);
      } finally {
        await Promise.allSettled([
          ...(replyPromise ? [replyPromise] : []),
          ...(deletionPromise ? [deletionPromise] : []),
        ]);
        errorSpy.mockRestore();
        await closeTestServer(server);
        await cleanupDeletionReplyRaceFixture(fixture);
        accountDeletionMocks.runHostedAccountDeletionCleanup
          .mockReset()
          .mockResolvedValue(makeDeletionCleanupRunResult());
        providerMocks.sendHostedLinqChatMessage.mockReset();
        vi.unstubAllEnvs();
        clearHostedOnboardingEnvCache();
      }
    }, 40_000);

    it("times out drain contention before provider entry without a durable attempt", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const fixture = await createDeletionReplyRaceFixture();
      let releaseDrain = () => {};
      const drainMayRelease = new Promise<void>((resolve) => {
        releaseDrain = resolve;
      });
      let reportDrainOwned = () => {};
      const drainOwned = new Promise<void>((resolve) => {
        reportDrainOwned = resolve;
      });
      const holdingDrain = fixture.deletionPrisma.$transaction(async (tx) => {
        await acquireHostedGroupJoinOutreachDrainLockTx(tx);
        reportDrainOwned();
        await drainMayRelease;
      });
      providerMocks.sendHostedLinqChatMessage
        .mockReset()
        .mockResolvedValue({
          chatId: fixture.chatId,
          messageId: `linq-lock-budget-${randomUUID()}`,
        });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        await drainOwned;
        const reply = drainDeletionReplyEffect({
          effect: fixture.effect,
          prisma: fixture.replyPrisma,
        });
        await expect(withTimeout(reply, 5_000)).rejects.toBeDefined();
        expect(providerMocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
        await expect(fixture.replyPrisma.hostedLinqDelivery.findUnique({
          select: { id: true },
          where: { idempotencyKey: fixture.deliveryLookupKey },
        })).resolves.toBeNull();
      } finally {
        releaseDrain();
        await holdingDrain;
        errorSpy.mockRestore();
        await cleanupDeletionReplyRaceFixture(fixture);
        providerMocks.sendHostedLinqChatMessage.mockReset();
        vi.unstubAllEnvs();
      }
    });

    it("leaves buffered group failure unsuppressed and permits a fresh generic retry", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const fixture = await createDeletionReplyRaceFixture();
      const providerMessageId = `linq-buffered-failure-${randomUUID()}`;
      const failureEventId = `event-buffered-failure-${randomUUID()}`;
      const failureEventLookupKey =
        createHostedLinqProviderEventLookupKey(failureEventId);
      const genericEffect = createHostedWebhookLinqMessageSideEffect({
        chatId: fixture.chatId,
        inviteId: fixture.inviteId,
        memberId: fixture.participantMemberId,
        occurredAt: "2026-07-27T16:01:00.000Z",
        sourceEventId: `event-generic-retry-${randomUUID()}`,
        template: "invite_signup",
      });
      const genericDeliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(genericEffect.effectId);
      if (!failureEventLookupKey || !genericDeliveryLookupKey) {
        throw new Error("Expected buffered-failure proof lookup keys.");
      }
      providerMocks.sendHostedLinqChatMessage
        .mockReset()
        .mockResolvedValueOnce({
          chatId: fixture.chatId,
          messageId: providerMessageId,
        })
        .mockResolvedValueOnce({
          chatId: fixture.chatId,
          messageId: `linq-generic-retry-${randomUUID()}`,
        });

      try {
        await fixture.deletionPrisma.hostedLinqDailyState.create({
          data: {
            dayUtc: new Date("2026-07-27T00:00:00.000Z"),
            firstSeenAt: new Date("2026-07-27T16:00:00.000Z"),
            lastSeenAt: new Date("2026-07-27T16:00:00.000Z"),
            memberId: fixture.participantMemberId,
          },
        });
        await fixture.deletionPrisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedFailureReceipt({
              eventId: failureEventId,
              messageId: providerMessageId,
              occurredAt: "2026-07-27T16:00:01.000Z",
              recipientPhone: createUniqueTestPhone("+1303"),
            }),
            prisma: tx,
          })
        );

        await expect(drainDeletionReplyEffect({
          effect: fixture.effect,
          prisma: fixture.replyPrisma,
        })).resolves.toMatchObject({ sentCount: 1, skipped: [] });
        await expect(fixture.replyPrisma.hostedLinqDelivery.findUnique({
          select: { status: true },
          where: { idempotencyKey: fixture.deliveryLookupKey },
        })).resolves.toEqual({ status: "failed" });
        const dailyStateAfterBufferedFailure =
          await fixture.replyPrisma.hostedLinqDailyState.findUnique({
          select: { onboardingLinkSentAt: true },
          where: {
            memberId_dayUtc: {
              dayUtc: new Date("2026-07-27T00:00:00.000Z"),
              memberId: fixture.participantMemberId,
            },
          },
        });
        expect(
          dailyStateAfterBufferedFailure?.onboardingLinkSentAt ?? null,
        ).toBeNull();

        await expect(drainDeletionReplyEffect({
          effect: genericEffect,
          prisma: fixture.replyPrisma,
        })).resolves.toMatchObject({ sentCount: 1, skipped: [] });
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
        await expect(fixture.replyPrisma.hostedLinqDailyState.findUnique({
          select: { onboardingLinkSentAt: true },
          where: {
            memberId_dayUtc: {
              dayUtc: new Date("2026-07-27T00:00:00.000Z"),
              memberId: fixture.participantMemberId,
            },
          },
        })).resolves.toEqual({
          onboardingLinkSentAt: expect.any(Date),
        });
      } finally {
        await fixture.deletionPrisma.hostedLinqAlert.deleteMany({
          where: { eventId: failureEventLookupKey },
        });
        await fixture.deletionPrisma.hostedLinqProviderEvent.deleteMany({
          where: { eventId: failureEventLookupKey },
        });
        await fixture.deletionPrisma.hostedLinqDelivery.deleteMany({
          where: {
            idempotencyKey: {
              in: [fixture.deliveryLookupKey, genericDeliveryLookupKey],
            },
          },
        });
        await cleanupDeletionReplyRaceFixture(fixture);
        providerMocks.sendHostedLinqChatMessage.mockReset();
        vi.unstubAllEnvs();
      }
    });

    it("rejects a reply after the deletion suspension fence and completes that request", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const fixture = await createDeletionReplyRaceFixture();
      let releaseDeletion = () => {};
      const deletionMayContinue = new Promise<void>((resolve) => {
        releaseDeletion = resolve;
      });
      let reportSuspensionFence = () => {};
      const suspensionFenceCommitted = new Promise<void>((resolve) => {
        reportSuspensionFence = resolve;
      });
      let cleanupCalls = 0;
      accountDeletionMocks.deleteHostedPhoneCallsForAccountDeletion
        .mockReset()
        .mockImplementation(async () => {
          reportSuspensionFence();
          await deletionMayContinue;
        });
      accountDeletionMocks.runHostedAccountDeletionCleanup
        .mockReset()
        .mockImplementation(async () => {
          cleanupCalls += 1;
          return makeDeletionCleanupRunResult();
        });
      providerMocks.sendHostedLinqChatMessage.mockReset();

      try {
        const deletion = deleteHostedAccountData({
          memberId: fixture.ownerMemberId,
          prisma: fixture.deletionPrisma,
          request: new Request("https://join.example.test/settings"),
        });
        await suspensionFenceCommitted;
        await expect(fixture.replyPrisma.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: fixture.runtimeMemberId },
        })).resolves.toEqual({
          suspendedAt: expect.any(Date),
        });

        const replyResult = await drainDeletionReplyEffect({
          effect: fixture.effect,
          prisma: fixture.replyPrisma,
        });
        expect(replyResult).toMatchObject({
          sentCount: 0,
          skipped: [{
            effectId: fixture.effect.effectId,
            reason: "notice_target_unauthorized",
            template: "invite_signup",
          }],
        });
        expect(providerMocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
        releaseDeletion();

        await expect(withTimeout(deletion, 10_000)).resolves.toBeDefined();
        expect(cleanupCalls).toBe(1);
        await expectDeletionReplyRaceConverged(fixture);
      } finally {
        releaseDeletion();
        await cleanupDeletionReplyRaceFixture(fixture);
        accountDeletionMocks.deleteHostedPhoneCallsForAccountDeletion
          .mockReset()
          .mockResolvedValue(undefined);
        accountDeletionMocks.runHostedAccountDeletionCleanup
          .mockReset()
          .mockResolvedValue(makeDeletionCleanupRunResult());
        providerMocks.sendHostedLinqChatMessage.mockReset();
        vi.unstubAllEnvs();
      }
    });
  },
);

type DeletionReplyRaceFixture = {
  chatId: string;
  deletionPrisma: PrismaClient;
  deliveryLookupKey: string;
  effect: ReturnType<typeof createHostedWebhookLinqMessageSideEffect>;
  groupId: string;
  inviteId: string;
  joinCode: string;
  offerId: string;
  outreachId: string;
  ownerMemberId: string;
  participantMemberId: string;
  replyPrisma: PrismaClient;
  runtimeMemberId: string;
};

function makePreparedDeletionCleanup(input: {
  now: Date;
  runtimeMemberIds: readonly string[];
  stripeCustomerIds: readonly string[];
  stripeSubscriptionIds?: readonly string[];
}) {
  return {
    cloudflareCompletedAt: null,
    environment: "test",
    id: `cleanup_group_reply_${randomUUID()}`,
    kmsKeyName: "test-key",
    nextAttemptAt: input.now,
    payloadCiphertext: "encrypted",
    privyCompletedAt: input.now,
    privyUserLookupKey: null,
    runtimeMemberIds: [...input.runtimeMemberIds],
    stripeCustomerIds: [...input.stripeCustomerIds],
    stripeCompletedAt: input.now,
    stripeSubscriptionIds: [...(input.stripeSubscriptionIds ?? [])],
  };
}

function makeDeletionCleanupRunResult() {
  return {
    cleanupPending: false,
    cloudflare: {
      alarmCleared: true,
      configured: true,
      deleteAllCompleted: true,
      deleted: true,
      errorCode: null,
      r2DeletedObjectCount: 0,
      r2SkippedUserScopedPrefixes: false,
      r2Supported: true,
      r2UserScopedSkipReason: null,
      runnerStateDeleted: true,
    },
    vendorAccounts: {
      privyUser: { errorCode: null, status: "skipped_no_record" },
      stripeCustomer: { errorCode: null, status: "skipped_no_record" },
    },
  };
}

async function createDeletionReplyRaceFixture():
  Promise<DeletionReplyRaceFixture> {
  const deletionPrisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const replyPrisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const ownerMemberId = `hbm_delete_owner_${randomUUID()}`;
  const runtimeMemberId = `hbm_delete_runtime_${randomUUID()}`;
  const participantMemberId = `hbm_delete_participant_${randomUUID()}`;
  const groupId = `hgrp_delete_fence_${randomUUID()}`;
  const offerId = `hgrpjo_delete_fence_${randomUUID()}`;
  const outreachId = `hgrpjoa_delete_fence_${randomUUID()}`;
  const inviteId = `hinv_delete_fence_${randomUUID()}`;
  const chatId = `chat-delete-fence-${randomUUID()}`;
  const joinCode = `join-delete-fence-${randomUUID()}`;
  const occurredAt = new Date("2026-07-27T16:00:00.000Z");
  const participantPhoneLookupKey = createHostedPhoneLookupKey(
    createUniqueTestPhone("+1202"),
  );
  if (!participantPhoneLookupKey) {
    throw new Error("Expected an account-deletion fence phone lookup key.");
  }
  const effect = createHostedWebhookLinqMessageSideEffect({
    chatId,
    groupJoinCode: joinCode,
    groupJoinOutreachId: outreachId,
    inviteId,
    memberId: participantMemberId,
    occurredAt: occurredAt.toISOString(),
    sourceEventId: `event-delete-fence-${randomUUID()}`,
    template: "invite_signup",
  });
  const deliveryLookupKey =
    createHostedLinqDeliveryIdempotencyLookupKey(effect.effectId);
  if (!deliveryLookupKey) {
    throw new Error("Expected an account-deletion fence delivery lookup key.");
  }

  await deletionPrisma.hostedMember.createMany({
    data: [
      { id: ownerMemberId },
      { id: runtimeMemberId },
      { id: participantMemberId },
    ],
  });
  await deletionPrisma.hostedThreadContainer.create({
    data: {
      memberId: runtimeMemberId,
      ownerMemberId,
    },
  });
  await deletionPrisma.hostedGroup.create({
    data: {
      displayName: "Deletion Fence Group",
      id: groupId,
      joinCode,
      joinCodeCreatedAt: occurredAt,
      ownerMemberId,
      runtimeMemberId,
    },
  });
  await deletionPrisma.hostedGroupJoinOffer.create({
    data: {
      groupId,
      id: offerId,
      messageLookupKey: `offer-delete-fence-${randomUUID()}`,
      postedAt: occurredAt,
      projectionKindsJson: ["best_effort"],
    },
  });
  await deletionPrisma.hostedGroupJoinOutreach.create({
    data: {
      id: outreachId,
      nextAttemptAt: occurredAt,
      offerId,
      participantPhoneEncrypted: "encrypted-test-phone",
      participantPhoneLookupKey,
      requestedAt: occurredAt,
    },
  });
  await recordAcceptedGroupJoinOutreachOpener({
    acceptedAt: occurredAt,
    attemptedAt: occurredAt,
    chatId,
    messageId: `linq-message-delete-opener-${randomUUID()}`,
    outreachId,
    prisma: deletionPrisma,
    recipientPhoneLookupKey: null,
  });
  await deletionPrisma.hostedInvite.create({
    data: {
      expiresAt: new Date("2026-07-28T16:00:00.000Z"),
      id: inviteId,
      inviteCode: `invite-delete-fence-${randomUUID()}`,
      memberId: participantMemberId,
    },
  });

  return {
    chatId,
    deletionPrisma,
    deliveryLookupKey,
    effect,
    groupId,
    inviteId,
    joinCode,
    offerId,
    outreachId,
    ownerMemberId,
    participantMemberId,
    replyPrisma,
    runtimeMemberId,
  };
}

async function drainDeletionReplyEffect(input: {
  effect: DeletionReplyRaceFixture["effect"];
  prisma: Prisma.TransactionClient | PrismaClient;
}) {
  const scheduledTasks: Array<() => Promise<void>> = [];
  const result = await drainHostedLinqSideEffectsDirect({
    prisma: input.prisma,
    scheduleAfterResponse: (task) => {
      scheduledTasks.push(task);
    },
    sideEffects: [input.effect],
  });
  for (const task of scheduledTasks) {
    await task();
  }
  return result;
}

async function expectDeletionReplyRaceConverged(
  fixture: DeletionReplyRaceFixture,
): Promise<void> {
  const dailyState = await fixture.deletionPrisma.hostedLinqDailyState.findUnique({
    select: { onboardingLinkSentAt: true },
    where: {
      memberId_dayUtc: {
        dayUtc: new Date("2026-07-27T00:00:00.000Z"),
        memberId: fixture.participantMemberId,
      },
    },
  });
  expect(dailyState?.onboardingLinkSentAt ?? null).toBeNull();
  await expect(fixture.deletionPrisma.hostedLinqDelivery.findUnique({
    select: { id: true },
    where: { idempotencyKey: fixture.deliveryLookupKey },
  })).resolves.toBeNull();
  await expect(fixture.deletionPrisma.hostedGroup.findUnique({
    select: { id: true },
    where: { id: fixture.groupId },
  })).resolves.toBeNull();
  await expect(fixture.deletionPrisma.hostedGroupJoinOutreach.findUnique({
    select: { id: true },
    where: { id: fixture.outreachId },
  })).resolves.toBeNull();
  await expect(fixture.deletionPrisma.hostedMember.findMany({
    select: { id: true },
    where: {
      id: {
        in: [fixture.ownerMemberId, fixture.runtimeMemberId],
      },
    },
  })).resolves.toEqual([]);
}

async function cleanupDeletionReplyRaceFixture(
  fixture: DeletionReplyRaceFixture,
): Promise<void> {
  await fixture.deletionPrisma.hostedLinqDelivery.deleteMany({
    where: { idempotencyKey: fixture.deliveryLookupKey },
  });
  await fixture.deletionPrisma.hostedGroup.deleteMany({
    where: { id: fixture.groupId },
  });
  await fixture.deletionPrisma.hostedThreadContainer.deleteMany({
    where: { memberId: fixture.runtimeMemberId },
  });
  await fixture.deletionPrisma.hostedInvite.deleteMany({
    where: { id: fixture.inviteId },
  });
  await fixture.deletionPrisma.hostedMember.deleteMany({
    where: {
      id: {
        in: [
          fixture.ownerMemberId,
          fixture.runtimeMemberId,
          fixture.participantMemberId,
        ],
      },
    },
  });
  await Promise.all([
    fixture.deletionPrisma.$disconnect(),
    fixture.replyPrisma.$disconnect(),
  ]);
}

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

async function recordAcceptedGroupJoinOutreachOpener(input: {
  acceptedAt: Date;
  attemptedAt: Date;
  chatId: string | null;
  messageId: string;
  outreachId: string;
  prisma: PrismaClient;
  recipientPhoneLookupKey: string | null;
}): Promise<void> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(
    buildHostedGroupJoinOutreachIdempotencyKey(input.outreachId),
  );
  const messageLookupKey = createHostedLinqMessageLookupKey(input.messageId);
  if (!idempotencyKey || !messageLookupKey) {
    throw new Error("Expected group join outreach opener delivery lookup keys.");
  }
  await input.prisma.hostedLinqDelivery.create({
    data: {
      acceptedAt: input.acceptedAt,
      attemptedAt: input.attemptedAt,
      groupJoinOutreachId: input.outreachId,
      id: `hld_group_join_opener_${randomUUID()}`,
      idempotencyKey,
      linqChatLookupKey: input.chatId
        ? createHostedLinqChatLookupKey(input.chatId)
        : null,
      messageLookupKey,
      phoneNumberLookupKey: input.recipientPhoneLookupKey,
      source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
      sourceRef: input.outreachId,
      status: "accepted",
      targetKind: "participant",
      template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
    },
  });
}

function createUniqueTestPhone(prefix: "+1202" | "+1303"): string {
  return `${prefix}${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
}

async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a loopback provider test server address.");
  }
  return `http://127.0.0.1:${address.port}/api/partner/v3`;
}

async function closeTestServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
