import { randomInt, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import { HostedBillingStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  createHostedLinqChat: vi.fn(),
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
  pendingHostedAccountDeletionCleanupResult: vi.fn().mockReturnValue({
    cleanupPending: true,
    cloudflare: {
      alarmCleared: null,
      configured: false,
      deleteAllCompleted: null,
      deleted: false,
      errorCode: "ACCOUNT_DELETION_CLEANUP_PENDING",
      r2DeletedObjectCount: null,
      r2SkippedUserScopedPrefixes: null,
      r2Supported: null,
      r2UserScopedSkipReason: null,
      runnerStateDeleted: null,
    },
    vendorAccounts: {
      privyUser: {
        errorCode: "ACCOUNT_DELETION_CLEANUP_PENDING",
        status: "failed",
      },
      stripeCustomer: {
        errorCode: "ACCOUNT_DELETION_CLEANUP_PENDING",
        status: "failed",
      },
    },
  }),
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
    createHostedLinqChat: providerMocks.createHostedLinqChat,
    getHostedLinqChatSummary: providerMocks.getHostedLinqChatSummary,
  };
});

const reactionEvidenceMocks = vi.hoisted(() => ({
  failNextAppend: { value: false },
  failNextRevoke: { value: false },
}));
vi.mock("@/src/lib/hosted-groups/group-join-outreach-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-groups/group-join-outreach-store")
  >("@/src/lib/hosted-groups/group-join-outreach-store");
  const revokeHostedGroupJoinOutreachForRemovedReactionTx: typeof actual.revokeHostedGroupJoinOutreachForRemovedReactionTx =
    (input) => {
      if (reactionEvidenceMocks.failNextRevoke.value) {
        reactionEvidenceMocks.failNextRevoke.value = false;
        throw new Error("simulated revocation outage");
      }
      return actual.revokeHostedGroupJoinOutreachForRemovedReactionTx(input);
    };
  return {
    ...actual,
    revokeHostedGroupJoinOutreachForRemovedReactionTx,
  };
});
vi.mock(
  "@/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context")
    >("@/src/lib/hosted-onboarding/webhook-provider-linq-reaction-context");
    const appendHostedLinqGroupReactionMailboxTx: typeof actual.appendHostedLinqGroupReactionMailboxTx =
      (input) => {
        if (reactionEvidenceMocks.failNextAppend.value) {
          reactionEvidenceMocks.failNextAppend.value = false;
          throw new Error("simulated room-evidence outage");
        }
        return actual.appendHostedLinqGroupReactionMailboxTx(input);
      };
    return {
      ...actual,
      appendHostedLinqGroupReactionMailboxTx,
    };
  },
);

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
  drainOneHostedGroupJoinOutreach,
} from "@/src/lib/hosted-groups/group-join-outreach-drain";
import {
  handleHostedGroupJoinOfferReaction,
} from "@/src/lib/hosted-groups/join-offer-reaction";
import {
  readHostedGroupJoinOfferTargetTx,
} from "@/src/lib/hosted-groups/group-store";
import {
  HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
  HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
  acquireHostedGroupJoinOutreachDrainLockTx,
  buildHostedGroupJoinOutreachIdempotencyKey,
  enqueueHostedGroupJoinOutreachTx,
  readHostedGroupJoinOutreachReplyContextTx,
} from "@/src/lib/hosted-groups/group-join-outreach-store";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
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
  buildHostedLinqInviteSignupEffectId,
} from "@/src/lib/hosted-onboarding/linq-invite-signup-effect-id";
import {
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  upsertHostedLinqLineForPhoneTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import {
  sendHostedLinqChatMessage as sendHostedLinqChatMessageOverHttp,
} from "@/src/lib/hosted-onboarding/linq-client";
import { parseHostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  createHostedExecutionGroupReactionEventId,
} from "@murphai/hosted-execution";
import {
  buildHostedVaultShareProjectionScopeKey,
  hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";
import { ingestHostedLinqProviderEventTx } from "@/src/lib/hosted-onboarding/linq-provider-event-store";
import { parseHostedLinqProviderEvent } from "@/src/lib/hosted-onboarding/linq-provider-events";
import {
  buildHostedMemberIdentityPrivateColumns,
} from "@/src/lib/hosted-onboarding/member-private-codecs";
import {
  acquireHostedLinqParticipantPhoneLockTx,
  createHostedLinqParticipantContact,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
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
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  replaceHostedVaultShareProjectionSnapshot,
} from "@/src/lib/hosted-vault-share/projection-store";
import { createPrismaClient } from "@/src/lib/prisma";
import { sha256Hex } from "@/src/lib/primitives";

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
      const newerOpenerMessageId =
        `linq-message-opener-newer-${randomUUID()}`;
      const originalOpenerMessageId =
        `linq-message-opener-original-${randomUUID()}`;
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
          messageId: originalOpenerMessageId,
          outreachId,
          prisma,
          recipientPhoneLookupKey,
        });
        await prisma.hostedGroup.create({
          data: {
            displayName: "Newer Recovery Proof Group",
            id: newerGroupId,
            joinCode: newerJoinCode,
            joinCodeCreatedAt: new Date("2026-07-24T19:03:00.000Z"),
            ownerMemberId: newerOwnerMemberId,
            runtimeMemberId: newerRuntimeMemberId,
          },
        });
        await prisma.hostedGroupJoinOffer.create({
          data: {
            groupId: newerGroupId,
            id: newerOfferId,
            messageLookupKey: `message-lookup-${randomUUID()}`,
            postedAt: new Date("2026-07-24T19:03:00.000Z"),
            projectionKindsJson: ["best_effort"],
          },
        });
        const newerEnqueue = await prisma.$transaction((tx) =>
          enqueueHostedGroupJoinOutreachTx({
            offerId: newerOfferId,
            participantPhoneNumber: participantPhone,
            requestedAt: new Date("2026-07-24T19:03:00.000Z"),
            tx,
          })
        );
        newerOutreachId = newerEnqueue.outreachId;
        await recordAcceptedGroupJoinOutreachOpener({
          acceptedAt: new Date("2026-07-24T19:03:02.000Z"),
          attemptedAt: new Date("2026-07-24T19:03:01.000Z"),
          chatId,
          messageId: newerOpenerMessageId,
          outreachId: newerOutreachId,
          prisma,
          recipientPhoneLookupKey,
        });
        await expect(prisma.$transaction((tx) =>
          readHostedGroupJoinOutreachReplyContextTx({
            linqChatId: chatId,
            participantMemberId,
            participantPhoneNumber: participantPhone,
            recipientPhoneNumber: recipientPhone,
            replyToMessageId: originalOpenerMessageId,
            tx,
          })
        )).resolves.toEqual({
          joinCode,
          outreachId,
        });
        await expect(prisma.$transaction((tx) =>
          readHostedGroupJoinOutreachReplyContextTx({
            linqChatId: chatId,
            participantMemberId,
            participantPhoneNumber: participantPhone,
            recipientPhoneNumber: recipientPhone,
            replyToMessageId: newerOpenerMessageId,
            tx,
          })
        )).resolves.toEqual({
          joinCode: newerJoinCode,
          outreachId: newerOutreachId,
        });
        await expect(prisma.$transaction((tx) =>
          readHostedGroupJoinOutreachReplyContextTx({
            linqChatId: chatId,
            participantMemberId,
            participantPhoneNumber: participantPhone,
            recipientPhoneNumber: recipientPhone,
            replyToMessageId: `unmatched-opener-${randomUUID()}`,
            tx,
          })
        )).resolves.toBeNull();

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
            firstContactAdmissionDecision: {
              confidence: 1,
              kind: "allow",
              source: "deterministic",
            },
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
          replyToMessageId: originalOpenerMessageId,
        });
        const recoveredPlan = await prisma.$transaction((tx) =>
          planHostedOnboardingLinqWebhook({
            event: recoveredEvent,
            firstContactAdmissionDecision: {
              confidence: 1,
              kind: "allow",
              source: "deterministic",
            },
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
        const originalSourceRef = signupLinkEffect.effectId;
        const exactReplyOccurredAt = new Date(signupLinkEffect.payload.occurredAt);
        await expect(claimHostedLinqDeliveryProviderDispatchTx({
          attemptedAt: crashClaimedAt,
          groupJoinOutreachId: outreachId,
          groupJoinReplyOccurredAt: exactReplyOccurredAt,
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
        const newerInboundEvent = buildDirectReplyEvent({
          chatId,
          eventId: `event-newer-${randomUUID()}`,
          messageId: `message-newer-${randomUUID()}`,
          occurredAt: "2026-07-24T20:01:30.000Z",
          participantPhone,
          recipientPhone,
          replyToMessageId: newerOpenerMessageId,
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
                sourceRef: groupEffectId,
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

    it("serializes opener dispatch with phone-bound member creation in both orders", async () => {
      const memberFirst = await createOpenerRaceFixture();
      providerMocks.createHostedLinqChat
        .mockReset()
        .mockResolvedValue({
          chatId: `chat-member-first-${randomUUID()}`,
          messageId: `message-member-first-${randomUUID()}`,
        });
      let releaseMemberCommit = () => {};
      const memberMayCommit = new Promise<void>((resolve) => {
        releaseMemberCommit = resolve;
      });
      let reportMemberIdentityReady = () => {};
      const memberIdentityReady = new Promise<void>((resolve) => {
        reportMemberIdentityReady = resolve;
      });
      let memberFirstPromise: Promise<unknown> | null = null;
      let memberFirstDrain: ReturnType<typeof drainOneHostedGroupJoinOutreach>
        | null = null;
      try {
        memberFirstPromise = memberFirst.contenderPrisma.$transaction(
          async (tx) => {
            await createPhoneBoundMemberIdentityTx({
              phoneNumber: memberFirst.participantPhone,
              tx,
            });
            reportMemberIdentityReady();
            await memberMayCommit;
          },
        );
        await memberIdentityReady;

        let drainSettled = false;
        memberFirstDrain = drainOneHostedGroupJoinOutreach({
          now: memberFirst.now,
          prisma: memberFirst.drainPrisma,
        }).finally(() => {
          drainSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(drainSettled).toBe(false);
        expect(providerMocks.createHostedLinqChat).not.toHaveBeenCalled();
        await expect(memberFirst.drainPrisma.hostedMemberIdentity.findFirst({
          select: { memberId: true },
          where: {
            phoneLookupKey: memberFirst.participantPhoneLookupKey,
          },
        })).resolves.toBeNull();

        releaseMemberCommit();
        const [, memberFirstDrainResult] = await withTimeout(
          Promise.all([memberFirstPromise, memberFirstDrain]),
          10_000,
        );
        expect(memberFirstDrainResult).toEqual({
          kind: "sent",
          outreachId: memberFirst.outreachId,
        });
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
      } finally {
        releaseMemberCommit();
        await Promise.allSettled([
          ...(memberFirstPromise ? [memberFirstPromise] : []),
          ...(memberFirstDrain ? [memberFirstDrain] : []),
        ]);
        await cleanupOpenerRaceFixture(memberFirst);
      }

      const openerFirst = await createOpenerRaceFixture();
      let releaseProvider = () => {};
      const providerMayContinue = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      let reportProviderStarted = () => {};
      const providerStarted = new Promise<void>((resolve) => {
        reportProviderStarted = resolve;
      });
      providerMocks.createHostedLinqChat
        .mockReset()
        .mockImplementation(async () => {
          reportProviderStarted();
          await providerMayContinue;
          return {
            chatId: `chat-opener-race-${randomUUID()}`,
            messageId: `message-opener-race-${randomUUID()}`,
          };
        });
      let drainPromise: ReturnType<typeof drainOneHostedGroupJoinOutreach> | null =
        null;
      let memberPromise: Promise<unknown> | null = null;

      try {
        drainPromise = drainOneHostedGroupJoinOutreach({
          now: openerFirst.now,
          prisma: openerFirst.drainPrisma,
        });
        await providerStarted;

        let memberSettled = false;
        memberPromise = openerFirst.contenderPrisma.$transaction((tx) =>
          createPhoneBoundMemberIdentityTx({
            phoneNumber: openerFirst.participantPhone,
            tx,
          })
        ).finally(() => {
          memberSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(memberSettled).toBe(false);
        await expect(openerFirst.contenderPrisma.hostedMemberIdentity.findFirst({
          select: { memberId: true },
          where: {
            phoneLookupKey: openerFirst.participantPhoneLookupKey,
          },
        })).resolves.toBeNull();

        releaseProvider();
        const [drainResult] = await withTimeout(
          Promise.all([drainPromise, memberPromise]),
          10_000,
        );
        expect(drainResult).toEqual({
          kind: "sent",
          outreachId: openerFirst.outreachId,
        });
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
        await expect(openerFirst.drainPrisma.hostedLinqDelivery.findFirst({
          select: {
            groupJoinOutreachId: true,
            status: true,
          },
          where: {
            groupJoinOutreachId: openerFirst.outreachId,
            source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
            template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
          },
        })).resolves.toEqual({
          groupJoinOutreachId: openerFirst.outreachId,
          status: "accepted",
        });
      } finally {
        releaseProvider();
        await Promise.allSettled([
          ...(drainPromise ? [drainPromise] : []),
          ...(memberPromise ? [memberPromise] : []),
        ]);
        providerMocks.createHostedLinqChat.mockReset();
        await cleanupOpenerRaceFixture(openerFirst);
      }
    });

    it("serializes opener dispatch with inactive-member activation in both orders", async () => {
      const activationFirst = await createOpenerRaceFixture();
      const activationFirstMemberId =
        await activationFirst.contenderPrisma.$transaction((tx) =>
          createPhoneBoundMemberIdentityTx({
            phoneNumber: activationFirst.participantPhone,
            phoneNumberVerifiedAt: new Date("2026-07-20T00:00:00.000Z"),
            tx,
          })
        );
      providerMocks.createHostedLinqChat.mockReset();
      let releaseActivationCommit = () => {};
      const activationMayCommit = new Promise<void>((resolve) => {
        releaseActivationCommit = resolve;
      });
      let reportActivationReady = () => {};
      const activationReady = new Promise<void>((resolve) => {
        reportActivationReady = resolve;
      });
      let activationPromise: Promise<unknown> | null = null;

      try {
        activationPromise = activationFirst.contenderPrisma.$transaction(
          async (tx) => {
            await tx.hostedMember.update({
              data: { billingStatus: HostedBillingStatus.active },
              where: { id: activationFirstMemberId },
            });
            reportActivationReady();
            await activationMayCommit;
          },
        );
        await activationReady;

        await expect(withTimeout(
          drainOneHostedGroupJoinOutreach({
            now: activationFirst.now,
            prisma: activationFirst.drainPrisma,
          }),
          10_000,
        )).resolves.toEqual({
          kind: "deferred",
          outreachId: activationFirst.outreachId,
          reason: "recipient_state_in_flight",
        });
        expect(providerMocks.createHostedLinqChat).not.toHaveBeenCalled();

        releaseActivationCommit();
        await expect(withTimeout(
          activationPromise,
          10_000,
        )).resolves.toBeUndefined();
        await expect(drainOneHostedGroupJoinOutreach({
          now: new Date(activationFirst.now.getTime() + 60_000),
          prisma: activationFirst.drainPrisma,
        })).resolves.toEqual({
          kind: "skipped",
          outreachId: activationFirst.outreachId,
          reason: "recipient_now_active",
        });
        expect(providerMocks.createHostedLinqChat).not.toHaveBeenCalled();
      } finally {
        releaseActivationCommit();
        await Promise.allSettled([
          ...(activationPromise ? [activationPromise] : []),
        ]);
        await cleanupOpenerRaceFixture(activationFirst);
      }

      const openerFirst = await createOpenerRaceFixture();
      const openerFirstMemberId =
        await openerFirst.contenderPrisma.$transaction((tx) =>
          createPhoneBoundMemberIdentityTx({
            phoneNumber: openerFirst.participantPhone,
            phoneNumberVerifiedAt: new Date("2026-07-20T00:00:00.000Z"),
            tx,
          })
        );
      let releaseProvider = () => {};
      const providerMayContinue = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      let reportProviderStarted = () => {};
      const providerStarted = new Promise<void>((resolve) => {
        reportProviderStarted = resolve;
      });
      providerMocks.createHostedLinqChat
        .mockReset()
        .mockImplementation(async () => {
          reportProviderStarted();
          await providerMayContinue;
          return {
            chatId: `chat-activation-race-${randomUUID()}`,
            messageId: `message-activation-race-${randomUUID()}`,
          };
        });
      let openerFirstDrain:
        ReturnType<typeof drainOneHostedGroupJoinOutreach> | null = null;
      let openerFirstActivation: Promise<unknown> | null = null;

      try {
        openerFirstDrain = drainOneHostedGroupJoinOutreach({
          now: openerFirst.now,
          prisma: openerFirst.drainPrisma,
        });
        await providerStarted;

        let activationSettled = false;
        openerFirstActivation = openerFirst.contenderPrisma.hostedMember.update({
          data: { billingStatus: HostedBillingStatus.active },
          where: { id: openerFirstMemberId },
        }).finally(() => {
          activationSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(activationSettled).toBe(false);

        releaseProvider();
        const [drainResult] = await withTimeout(
          Promise.all([openerFirstDrain, openerFirstActivation]),
          10_000,
        );
        expect(drainResult).toEqual({
          kind: "sent",
          outreachId: openerFirst.outreachId,
        });
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
        await expect(openerFirst.drainPrisma.hostedMember.findUnique({
          select: { billingStatus: true },
          where: { id: openerFirstMemberId },
        })).resolves.toEqual({ billingStatus: HostedBillingStatus.active });
      } finally {
        releaseProvider();
        await Promise.allSettled([
          ...(openerFirstDrain ? [openerFirstDrain] : []),
          ...(openerFirstActivation ? [openerFirstActivation] : []),
        ]);
        providerMocks.createHostedLinqChat.mockReset();
        await cleanupOpenerRaceFixture(openerFirst);
      }
    });

    it("gives direct join ownership when activation commits before reaction admission", async () => {
      const fixture = await createReactionAdmissionFixture();
      const event = buildReactionAdmissionEvent({
        eventId: `event-reaction-activation-first-${randomUUID()}`,
        eventType: "reaction.added",
        fixture,
      });
      await ingestReactionAdmissionEvent({ event, fixture });
      await assertReactionAdmissionOfferTarget({ event, fixture });
      let releaseActivation = () => {};
      const activationMayCommit = new Promise<void>((resolve) => {
        releaseActivation = resolve;
      });
      let reportActivationReady = () => {};
      const activationReady = new Promise<void>((resolve) => {
        reportActivationReady = resolve;
      });
      let activationPromise: Promise<unknown> | null = null;
      let reactionPromise:
        ReturnType<typeof handleHostedGroupJoinOfferReaction> | null = null;

      try {
        activationPromise = fixture.contenderPrisma.$transaction(async (tx) => {
          await tx.hostedMember.update({
            data: { billingStatus: HostedBillingStatus.active },
            where: { id: fixture.participantMemberId },
          });
          reportActivationReady();
          await activationMayCommit;
        });
        await activationReady;

        let reactionSettled = false;
        reactionPromise = handleHostedGroupJoinOfferReaction({
          event,
          prisma: fixture.reactionPrisma,
        }).finally(() => {
          reactionSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(reactionSettled).toBe(false);

        releaseActivation();
        const [, reactionResult] = await withTimeout(
          Promise.all([activationPromise, reactionPromise]),
          10_000,
        );
        expect(reactionResult).toEqual({
          reason: "accepted",
          status: "accepted",
        });
        await expect(fixture.reactionPrisma.hostedGroupMember.findUnique({
          select: { id: true },
          where: {
            groupId_memberId: {
              groupId: fixture.groupId,
              memberId: fixture.participantMemberId,
            },
          },
        })).resolves.toEqual({ id: expect.any(String) });
        await expect(fixture.reactionPrisma.hostedGroupJoinOutreach.count({
          where: { offerId: fixture.offerId },
        })).resolves.toBe(0);
        await expect(fixture.reactionPrisma.hostedLinqProviderEvent.findUnique({
          select: { groupJoinOfferHandledAt: true },
          where: {
            eventId: createHostedLinqProviderEventLookupKey(event.eventId),
          },
        })).resolves.toEqual({
          groupJoinOfferHandledAt: expect.any(Date),
        });
      } finally {
        releaseActivation();
        await Promise.allSettled([
          ...(activationPromise ? [activationPromise] : []),
          ...(reactionPromise ? [reactionPromise] : []),
        ]);
        await cleanupReactionAdmissionFixture(fixture);
      }
    });

    it("gives outreach ownership when reaction admission holds the member lock first", async () => {
      const fixture = await createReactionAdmissionFixture();
      const event = buildReactionAdmissionEvent({
        eventId: `event-reaction-outreach-first-${randomUUID()}`,
        eventType: "reaction.added",
        fixture,
      });
      await ingestReactionAdmissionEvent({ event, fixture });
      await assertReactionAdmissionOfferTarget({ event, fixture });
      let releaseDrainLock = () => {};
      const drainLockMayRelease = new Promise<void>((resolve) => {
        releaseDrainLock = resolve;
      });
      let reportDrainLockReady = () => {};
      const drainLockReady = new Promise<void>((resolve) => {
        reportDrainLockReady = resolve;
      });
      let drainLockPromise: Promise<unknown> | null = null;
      let reactionPromise:
        ReturnType<typeof handleHostedGroupJoinOfferReaction> | null = null;
      let activationPromise: Promise<unknown> | null = null;

      try {
        drainLockPromise = fixture.contenderPrisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              hashtext('hosted_group_join_outreach'),
              hashtext(${sha256Hex(
                `${fixture.offerId}\0${fixture.participantPhone}`,
              )})
            )
          `;
          reportDrainLockReady();
          await drainLockMayRelease;
        });
        await drainLockReady;

        let reactionSettled = false;
        reactionPromise = handleHostedGroupJoinOfferReaction({
          event,
          prisma: fixture.reactionPrisma,
        }).finally(() => {
          reactionSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(reactionSettled).toBe(false);

        let activationSettled = false;
        activationPromise = fixture.contenderPrisma.hostedMember.update({
          data: { billingStatus: HostedBillingStatus.active },
          where: { id: fixture.participantMemberId },
        }).finally(() => {
          activationSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(activationSettled).toBe(false);
        await expect(fixture.reactionPrisma.hostedGroupJoinOutreach.count({
          where: { offerId: fixture.offerId },
        })).resolves.toBe(0);

        releaseDrainLock();
        const [, reactionResult] = await withTimeout(
          Promise.all([drainLockPromise, reactionPromise, activationPromise])
            .then(([, result]) => [undefined, result] as const),
          10_000,
        );
        expect(reactionResult).toEqual({
          reason: "outreach_enqueued",
          status: "accepted",
        });
        await expect(fixture.reactionPrisma.hostedGroupJoinOutreach.count({
          where: { offerId: fixture.offerId },
        })).resolves.toBe(1);
        await expect(fixture.reactionPrisma.hostedGroupMember.count({
          where: {
            groupId: fixture.groupId,
            memberId: fixture.participantMemberId,
          },
        })).resolves.toBe(0);
        await expect(fixture.reactionPrisma.hostedLinqProviderEvent.findUnique({
          select: { groupJoinOfferHandledAt: true },
          where: {
            eventId: createHostedLinqProviderEventLookupKey(event.eventId),
          },
        })).resolves.toEqual({
          groupJoinOfferHandledAt: expect.any(Date),
        });
      } finally {
        releaseDrainLock();
        await Promise.allSettled([
          ...(drainLockPromise ? [drainLockPromise] : []),
          ...(reactionPromise ? [reactionPromise] : []),
          ...(activationPromise ? [activationPromise] : []),
        ]);
        await cleanupReactionAdmissionFixture(fixture);
      }
    });

    it.each([
      ["active", { billingStatus: HostedBillingStatus.active, suspendedAt: null }],
      [
        "suspended",
        {
          billingStatus: HostedBillingStatus.not_started,
          suspendedAt: new Date("2026-07-28T16:01:00.000Z"),
        },
      ],
    ])(
      "revokes pending outreach while the member is temporarily %s",
      async (_state, transition) => {
        const fixture = await createReactionAdmissionFixture();
        const addedEvent = buildReactionAdmissionEvent({
          eventId: `event-reaction-added-${randomUUID()}`,
          eventType: "reaction.added",
          fixture,
        });
        const removedEvent = buildReactionAdmissionEvent({
          eventId: `event-reaction-removed-${randomUUID()}`,
          eventType: "reaction.removed",
          fixture,
        });
        await ingestReactionAdmissionEvent({ event: addedEvent, fixture });
        providerMocks.createHostedLinqChat.mockReset();

        try {
          await expect(handleHostedGroupJoinOfferReaction({
            event: addedEvent,
            prisma: fixture.reactionPrisma,
          })).resolves.toEqual({
            reason: "outreach_enqueued",
            status: "accepted",
          });
          await fixture.reactionPrisma.hostedMember.update({
            data: transition,
            where: { id: fixture.participantMemberId },
          });
          await ingestReactionAdmissionEvent({ event: removedEvent, fixture });

          await expect(handleHostedGroupJoinOfferReaction({
            event: removedEvent,
            prisma: fixture.reactionPrisma,
          })).resolves.toEqual({
            reason: "outreach_revoked",
            status: "accepted",
          });
          // Both member reactions must survive as consumed durable room
          // evidence: the terminal owner decisions mark the provider events
          // handled, after which webhook retry never replays the projection.
          const reactionEvidence =
            await fixture.reactionPrisma.hostedMailboxItem.findMany({
              select: { consumedAt: true, dedupeKey: true },
              where: {
                dedupeKey: {
                  in: [
                    createHostedExecutionGroupReactionEventId(
                      addedEvent.eventId,
                    ),
                    createHostedExecutionGroupReactionEventId(
                      removedEvent.eventId,
                    ),
                  ],
                },
                userId: fixture.runtimeMemberId,
              },
            });
          expect(reactionEvidence).toHaveLength(2);
          expect(
            reactionEvidence.every((row) => row.consumedAt !== null),
          ).toBe(true);
          await fixture.reactionPrisma.hostedMember.update({
            data: {
              billingStatus: HostedBillingStatus.not_started,
              suspendedAt: null,
            },
            where: { id: fixture.participantMemberId },
          });

          await expect(drainOneHostedGroupJoinOutreach({
            now: new Date("2026-07-28T16:02:00.000Z"),
            prisma: fixture.reactionPrisma,
          })).resolves.toEqual({ kind: "idle" });
          expect(providerMocks.createHostedLinqChat).not.toHaveBeenCalled();
          await expect(fixture.reactionPrisma.hostedLinqDelivery.findFirst({
            select: { skipReason: true, status: true },
            where: {
              groupJoinOutreach: { is: { offerId: fixture.offerId } },
              source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
              template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
            },
          })).resolves.toEqual({
            skipReason: "reaction_removed",
            status: "skipped",
          });
        } finally {
          providerMocks.createHostedLinqChat.mockReset();
          await cleanupReactionAdmissionFixture(fixture);
        }
      },
    );

    it("keeps a withdrawal terminal across an evidence outage so the drain never dispatches", async () => {
      const fixture = await createReactionAdmissionFixture();
      const addedEvent = buildReactionAdmissionEvent({
        eventId: `event-reaction-added-${randomUUID()}`,
        eventType: "reaction.added",
        fixture,
      });
      const removedEvent = buildReactionAdmissionEvent({
        eventId: `event-reaction-removed-${randomUUID()}`,
        eventType: "reaction.removed",
        fixture,
      });
      await ingestReactionAdmissionEvent({ event: addedEvent, fixture });
      providerMocks.createHostedLinqChat.mockReset();

      try {
        await expect(handleHostedGroupJoinOfferReaction({
          event: addedEvent,
          prisma: fixture.reactionPrisma,
        })).resolves.toEqual({
          reason: "outreach_enqueued",
          status: "accepted",
        });
        await ingestReactionAdmissionEvent({ event: removedEvent, fixture });

        // The evidence outage costs only this removal's room context. The
        // withdrawal and terminal marker still commit, so the production
        // drain running inside the outage window finds nothing to send.
        reactionEvidenceMocks.failNextAppend.value = true;
        await expect(handleHostedGroupJoinOfferReaction({
          event: removedEvent,
          prisma: fixture.reactionPrisma,
        })).resolves.toEqual({
          reason: "outreach_revoked",
          status: "accepted",
        });
        await expect(fixture.reactionPrisma.hostedLinqDelivery.findFirst({
          select: { skipReason: true, status: true },
          where: {
            groupJoinOutreach: { is: { offerId: fixture.offerId } },
            source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
            template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
          },
        })).resolves.toEqual({
          skipReason: "reaction_removed",
          status: "skipped",
        });
        await expect(fixture.reactionPrisma.hostedLinqProviderEvent.findUnique({
          select: { groupJoinOfferHandledAt: true },
          where: {
            eventId: createHostedLinqProviderEventLookupKey(
              removedEvent.eventId,
            ),
          },
        })).resolves.toEqual({
          groupJoinOfferHandledAt: removedEvent.providerCreatedAt,
        });
        await expect(fixture.reactionPrisma.hostedMailboxItem.findFirst({
          select: { id: true },
          where: {
            dedupeKey: createHostedExecutionGroupReactionEventId(
              removedEvent.eventId,
            ),
            userId: fixture.runtimeMemberId,
          },
        })).resolves.toBeNull();
        await expect(drainOneHostedGroupJoinOutreach({
          now: new Date("2026-07-28T16:02:00.000Z"),
          prisma: fixture.reactionPrisma,
        })).resolves.toEqual({ kind: "idle" });
        expect(providerMocks.createHostedLinqChat).not.toHaveBeenCalled();
      } finally {
        reactionEvidenceMocks.failNextAppend.value = false;
        providerMocks.createHostedLinqChat.mockReset();
        await cleanupReactionAdmissionFixture(fixture);
      }
    });

    it("stays deletion-safe when a marker-less removal replays after account deletion", async () => {
      const fixture = await createReactionAdmissionFixture();
      const addedEvent = buildReactionAdmissionEvent({
        eventId: `event-reaction-added-${randomUUID()}`,
        eventType: "reaction.added",
        fixture,
      });
      const removedEvent = buildReactionAdmissionEvent({
        eventId: `event-reaction-removed-${randomUUID()}`,
        eventType: "reaction.removed",
        fixture,
      });
      await ingestReactionAdmissionEvent({ event: addedEvent, fixture });
      providerMocks.createHostedLinqChat.mockReset();

      try {
        await expect(handleHostedGroupJoinOfferReaction({
          event: addedEvent,
          prisma: fixture.reactionPrisma,
        })).resolves.toEqual({
          reason: "outreach_enqueued",
          status: "accepted",
        });
        await ingestReactionAdmissionEvent({ event: removedEvent, fixture });

        // Nothing partial commits when the decision transaction itself fails:
        // no delivery, no marker, no evidence.
        reactionEvidenceMocks.failNextRevoke.value = true;
        await expect(handleHostedGroupJoinOfferReaction({
          event: removedEvent,
          prisma: fixture.reactionPrisma,
        })).rejects.toThrow("simulated revocation outage");
        await expect(fixture.reactionPrisma.hostedLinqDelivery.findFirst({
          select: { id: true },
          where: {
            groupJoinOutreach: { is: { offerId: fixture.offerId } },
            source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
            template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
          },
        })).resolves.toBeNull();
        await expect(fixture.reactionPrisma.hostedLinqProviderEvent.findUnique({
          select: { groupJoinOfferHandledAt: true },
          where: {
            eventId: createHostedLinqProviderEventLookupKey(
              removedEvent.eventId,
            ),
          },
        })).resolves.toEqual({ groupJoinOfferHandledAt: null });

        // The participant completes production account deletion while the
        // interrupted event is still marker-less; deletion removes the pending
        // outreach through the still-present phone identity.
        await deleteHostedAccountData({
          memberId: fixture.participantMemberId,
          prisma: fixture.reactionPrisma,
          request: new Request("https://join.example.test/settings"),
        });
        await expect(fixture.reactionPrisma.hostedGroupJoinOutreach.findMany({
          select: { id: true },
          where: { offerId: fixture.offerId },
        })).resolves.toEqual([]);

        // Provider replay resolves no member and converges on the documented
        // anonymous pre-member removal: a terminal marker, anonymous room
        // evidence, and the non-deliverable remove-before-add tombstone that
        // group deletion owns and that blocks any marker-less add replay from
        // texting the deleted phone. The drain never reaches the provider.
        await ingestReactionAdmissionEvent({ event: removedEvent, fixture });
        await expect(handleHostedGroupJoinOfferReaction({
          event: removedEvent,
          prisma: fixture.reactionPrisma,
        })).resolves.toEqual({
          reason: "outreach_revoked",
          status: "accepted",
        });
        await expect(fixture.reactionPrisma.hostedLinqProviderEvent.findUnique({
          select: { groupJoinOfferHandledAt: true },
          where: {
            eventId: createHostedLinqProviderEventLookupKey(
              removedEvent.eventId,
            ),
          },
        })).resolves.toEqual({
          groupJoinOfferHandledAt: removedEvent.providerCreatedAt,
        });
        const removalEvidence =
          await fixture.reactionPrisma.hostedMailboxItem.findMany({
            select: { consumedAt: true },
            where: {
              dedupeKey: createHostedExecutionGroupReactionEventId(
                removedEvent.eventId,
              ),
              userId: fixture.runtimeMemberId,
            },
          });
        expect(removalEvidence).toHaveLength(1);
        expect(removalEvidence[0]?.consumedAt).not.toBeNull();
        await expect(fixture.reactionPrisma.hostedLinqDelivery.findFirst({
          select: { skipReason: true, status: true },
          where: {
            groupJoinOutreach: { is: { offerId: fixture.offerId } },
            source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
            template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
          },
        })).resolves.toEqual({
          skipReason: "reaction_removed",
          status: "skipped",
        });
        await expect(drainOneHostedGroupJoinOutreach({
          now: new Date("2026-07-28T16:05:00.000Z"),
          prisma: fixture.reactionPrisma,
        })).resolves.toEqual({ kind: "idle" });
        expect(providerMocks.createHostedLinqChat).not.toHaveBeenCalled();
      } finally {
        reactionEvidenceMocks.failNextRevoke.value = false;
        providerMocks.createHostedLinqChat.mockReset();
        await cleanupReactionAdmissionFixture(fixture);
      }
    });

    it("keeps a pre-existing inactive member on the group-aware signup reply path", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const fixture = await createOpenerRaceFixture();
      const participantMemberId =
        await fixture.contenderPrisma.$transaction((tx) =>
          createPhoneBoundMemberIdentityTx({
            phoneNumber: fixture.participantPhone,
            phoneNumberVerifiedAt: new Date("2026-07-20T00:00:00.000Z"),
            tx,
          })
        );
      const chatId = `chat-existing-member-reply-${randomUUID()}`;
      const openerMessageId = `message-existing-member-opener-${randomUUID()}`;
      providerMocks.createHostedLinqChat
        .mockReset()
        .mockResolvedValue({
          chatId,
          messageId: openerMessageId,
        });

      try {
        await expect(drainOneHostedGroupJoinOutreach({
          now: fixture.now,
          prisma: fixture.drainPrisma,
        })).resolves.toEqual({
          kind: "sent",
          outreachId: fixture.outreachId,
        });

        const replyEvent = buildDirectReplyEvent({
          chatId,
          eventId: `event-existing-member-reply-${randomUUID()}`,
          messageId: `message-existing-member-reply-${randomUUID()}`,
          occurredAt: "2026-07-27T16:00:01.000Z",
          participantPhone: fixture.participantPhone,
          recipientPhone: fixture.linePhone,
          replyToMessageId: openerMessageId,
        });
        const plan = await fixture.contenderPrisma.$transaction((tx) =>
          planHostedOnboardingLinqWebhook({
            event: replyEvent,
            firstContactAdmissionDecision: {
              confidence: 1,
              kind: "allow",
              source: "deterministic",
            },
            prisma: tx,
            requireFirstContactAdmission: true,
          })
        );

        expect(plan.response).toMatchObject({
          joinUrl: expect.stringContaining(
            `/groups/join/${fixture.joinCode}?invite=`,
          ),
          reason: "sent-signup-link",
        });
        const [signupLinkEffect] = plan.desiredSideEffects;
        if (
          !signupLinkEffect
          || signupLinkEffect.payload.template !== "invite_signup"
        ) {
          throw new Error("Expected the existing group-aware signup effect.");
        }
        expect(signupLinkEffect.payload).toMatchObject({
          groupJoinCode: fixture.joinCode,
          groupJoinOutreachId: fixture.outreachId,
          memberId: participantMemberId,
        });
      } finally {
        providerMocks.createHostedLinqChat.mockReset();
        vi.unstubAllEnvs();
        await cleanupOpenerRaceFixture(fixture);
      }
    });

    it.each([
      ["same", true],
      ["different", false],
    ])(
      "honors an accepted opener reply in the %s chat without replacing a lapsed member's home route",
      async (_chatRelationship, openerUsesHomeChat) => {
        vi.stubEnv(
          "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
          "https://join.example.test",
        );
        const fixture = await createOpenerRaceFixture();
        const participantMemberId =
          await fixture.contenderPrisma.$transaction((tx) =>
            createPhoneBoundMemberIdentityTx({
              phoneNumber: fixture.participantPhone,
              phoneNumberVerifiedAt: new Date("2026-07-20T00:00:00.000Z"),
              tx,
            })
          );
        const homeChatId = `chat-existing-member-home-${randomUUID()}`;
        const openerChatId = openerUsesHomeChat
          ? homeChatId
          : `chat-existing-member-opener-${randomUUID()}`;
        const homeLinePhone = createUniqueTestPhone("+1303");
        const participantContact = createHostedLinqParticipantContact({
          kind: "phone",
          value: fixture.participantPhone,
        });
        if (!participantContact) {
          throw new Error("Expected a phone participant contact.");
        }
        await fixture.contenderPrisma.hostedMember.update({
          data: { billingStatus: HostedBillingStatus.paused },
          where: { id: participantMemberId },
        });
        await fixture.contenderPrisma.$transaction((tx) =>
          upsertHostedMemberHomeLinqBindingTx({
            homeLineAssignedAt: new Date("2026-07-20T00:00:00.000Z"),
            linqChatId: homeChatId,
            memberId: participantMemberId,
            participantContact,
            prisma: tx,
            recipientPhone: homeLinePhone,
          })
        );
        const homeRouteBefore = await fixture.contenderPrisma.hostedMemberRouting
          .findUnique({
            select: {
              linqChatLookupKey: true,
              linqRecipientPhoneLookupKey: true,
            },
            where: { memberId: participantMemberId },
          });
        const openerMessageId = `message-existing-member-opener-${randomUUID()}`;
        providerMocks.createHostedLinqChat
          .mockReset()
          .mockResolvedValue({
            chatId: openerChatId,
            messageId: openerMessageId,
          });

        try {
          await expect(drainOneHostedGroupJoinOutreach({
            now: fixture.now,
            prisma: fixture.drainPrisma,
          })).resolves.toEqual({
            kind: "sent",
            outreachId: fixture.outreachId,
          });

          const replyEvent = buildDirectReplyEvent({
            chatId: openerChatId,
            eventId: `event-existing-member-home-reply-${randomUUID()}`,
            messageId: `message-existing-member-home-reply-${randomUUID()}`,
            occurredAt: "2026-07-27T16:00:01.000Z",
            participantPhone: fixture.participantPhone,
            recipientPhone: fixture.linePhone,
            replyToMessageId: openerMessageId,
          });
          const plan = await fixture.contenderPrisma.$transaction((tx) =>
            planHostedOnboardingLinqWebhook({
              event: replyEvent,
              firstContactAdmissionDecision: {
                confidence: 1,
                kind: "allow",
                source: "deterministic",
              },
              prisma: tx,
              requireFirstContactAdmission: true,
            })
          );

          expect(plan.response).toMatchObject({
            joinUrl: expect.stringContaining(
              `/groups/join/${fixture.joinCode}?invite=`,
            ),
            reason: "sent-signup-link",
          });
          const [signupLinkEffect] = plan.desiredSideEffects;
          if (
            !signupLinkEffect
            || signupLinkEffect.payload.template !== "invite_signup"
          ) {
            throw new Error("Expected the group-aware signup effect.");
          }
          expect(signupLinkEffect.payload).toMatchObject({
            chatId: openerChatId,
            groupJoinCode: fixture.joinCode,
            groupJoinOutreachId: fixture.outreachId,
            memberId: participantMemberId,
          });
          await expect(
            fixture.contenderPrisma.hostedMemberRouting.findUnique({
              select: {
                linqChatLookupKey: true,
                linqRecipientPhoneLookupKey: true,
              },
              where: { memberId: participantMemberId },
            }),
          ).resolves.toEqual(homeRouteBefore);
        } finally {
          providerMocks.createHostedLinqChat.mockReset();
          vi.unstubAllEnvs();
          await cleanupOpenerRaceFixture(fixture);
        }
      },
    );

    it.each([
      ["same", true],
      ["different", false],
    ])(
      "keeps SMS opt-out ahead of an accepted opener in the %s persisted-route relationship",
      async (_chatRelationship, openerUsesHomeChat) => {
        vi.stubEnv(
          "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
          "https://join.example.test",
        );
        const fixture = await createOpenerRaceFixture();
        const participantMemberId =
          await fixture.contenderPrisma.$transaction((tx) =>
            createPhoneBoundMemberIdentityTx({
              phoneNumber: fixture.participantPhone,
              phoneNumberVerifiedAt: new Date("2026-07-20T00:00:00.000Z"),
              tx,
            })
          );
        const homeChatId = `chat-opt-out-home-${randomUUID()}`;
        const openerChatId = openerUsesHomeChat
          ? homeChatId
          : `chat-opt-out-opener-${randomUUID()}`;
        const homeLinePhone = createUniqueTestPhone("+1303");
        const participantContact = createHostedLinqParticipantContact({
          kind: "phone",
          value: fixture.participantPhone,
        });
        if (!participantContact) {
          throw new Error("Expected a phone participant contact.");
        }
        await fixture.contenderPrisma.hostedMember.update({
          data: { billingStatus: HostedBillingStatus.paused },
          where: { id: participantMemberId },
        });
        await fixture.contenderPrisma.$transaction((tx) =>
          upsertHostedMemberHomeLinqBindingTx({
            homeLineAssignedAt: new Date("2026-07-20T00:00:00.000Z"),
            linqChatId: homeChatId,
            memberId: participantMemberId,
            participantContact,
            prisma: tx,
            recipientPhone: homeLinePhone,
          })
        );
        const homeRouteBefore = await fixture.contenderPrisma.hostedMemberRouting
          .findUnique({
            select: {
              linqChatLookupKey: true,
              linqRecipientPhoneLookupKey: true,
            },
            where: { memberId: participantMemberId },
          });
        const inviteCountBefore = await fixture.contenderPrisma.hostedInvite.count({
          where: { memberId: participantMemberId },
        });
        const dailyStateCountBefore =
          await fixture.contenderPrisma.hostedLinqDailyState.count({
            where: { memberId: participantMemberId },
          });
        const openerMessageId = `message-opt-out-opener-${randomUUID()}`;
        providerMocks.createHostedLinqChat
          .mockReset()
          .mockResolvedValue({
            chatId: openerChatId,
            messageId: openerMessageId,
          });

        try {
          await expect(drainOneHostedGroupJoinOutreach({
            now: fixture.now,
            prisma: fixture.drainPrisma,
          })).resolves.toEqual({
            kind: "sent",
            outreachId: fixture.outreachId,
          });

          for (const messageText of [
            "STOP",
            "UNSUBSCRIBE",
            "CANCEL",
            "END",
            "QUIT",
            "OPT OUT",
          ]) {
            const replyEvent = buildDirectReplyEvent({
              chatId: openerChatId,
              eventId: `event-opt-out-reply-${randomUUID()}`,
              messageId: `message-opt-out-reply-${randomUUID()}`,
              messageText,
              occurredAt: "2026-07-27T16:00:01.000Z",
              participantPhone: fixture.participantPhone,
              recipientPhone: fixture.linePhone,
              replyToMessageId: openerMessageId,
            });
            const plan = await fixture.contenderPrisma.$transaction((tx) =>
              planHostedOnboardingLinqWebhook({
                event: replyEvent,
                firstContactAdmissionDecision: {
                  confidence: 1,
                  kind: "allow",
                  source: "deterministic",
                },
                prisma: tx,
                requireFirstContactAdmission: true,
              })
            );

            expect(plan.response, messageText).toMatchObject({
              ignored: true,
              ok: true,
              reason: "blocked-first-contact-content",
            });
            expect(plan.desiredSideEffects, messageText).toEqual([]);
          }

          await expect(fixture.contenderPrisma.hostedInvite.count({
            where: { memberId: participantMemberId },
          })).resolves.toBe(inviteCountBefore);
          await expect(fixture.contenderPrisma.hostedLinqDailyState.count({
            where: { memberId: participantMemberId },
          })).resolves.toBe(dailyStateCountBefore);
          await expect(
            fixture.contenderPrisma.hostedMemberRouting.findUnique({
              select: {
                linqChatLookupKey: true,
                linqRecipientPhoneLookupKey: true,
              },
              where: { memberId: participantMemberId },
            }),
          ).resolves.toEqual(homeRouteBefore);
        } finally {
          providerMocks.createHostedLinqChat.mockReset();
          vi.unstubAllEnvs();
          await cleanupOpenerRaceFixture(fixture);
        }
      },
    );

    it("holds an immediate reply until the opener correlation commits", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const fixture = await createOpenerRaceFixture();
      const memberPrisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const chatId = `chat-immediate-reply-${randomUUID()}`;
      let releaseProvider = () => {};
      const providerMayContinue = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      let reportProviderStarted = () => {};
      const providerStarted = new Promise<void>((resolve) => {
        reportProviderStarted = resolve;
      });
      providerMocks.createHostedLinqChat
        .mockReset()
        .mockImplementation(async () => {
          reportProviderStarted();
          await providerMayContinue;
          return {
            chatId,
            messageId: `message-immediate-reply-${randomUUID()}`,
          };
        });
      let drainPromise: ReturnType<typeof drainOneHostedGroupJoinOutreach> | null =
        null;
      let memberPromise: Promise<unknown> | null = null;
      let planPromise: Promise<
        Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>
      > | null = null;

      try {
        drainPromise = drainOneHostedGroupJoinOutreach({
          now: fixture.now,
          prisma: fixture.drainPrisma,
        });
        await providerStarted;

        // Queue canonical member creation ahead of the reply on the same phone
        // lock. Once the opener commits, the reply must see both durable facts
        // rather than trying to provision a second member.
        memberPromise = memberPrisma.$transaction((tx) =>
          createPhoneBoundMemberIdentityTx({
            phoneNumber: fixture.participantPhone,
            tx,
          })
        );
        await new Promise((resolve) => setTimeout(resolve, 100));

        const replyEvent = buildDirectReplyEvent({
          chatId,
          eventId: `event-immediate-reply-${randomUUID()}`,
          messageId: `message-immediate-reply-${randomUUID()}`,
          occurredAt: "2026-07-27T16:00:01.000Z",
          participantPhone: fixture.participantPhone,
          recipientPhone: fixture.linePhone,
        });
        let planSettled = false;
        planPromise = fixture.contenderPrisma.$transaction((tx) =>
          planHostedOnboardingLinqWebhook({
            event: replyEvent,
            firstContactAdmissionDecision: {
              confidence: 1,
              kind: "allow",
              source: "deterministic",
            },
            prisma: tx,
            requireFirstContactAdmission: true,
          })
        ).finally(() => {
          planSettled = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(planSettled).toBe(false);

        releaseProvider();
        const [drainResult, , plan] = await withTimeout(
          Promise.all([drainPromise, memberPromise, planPromise]),
          10_000,
        );
        expect(drainResult).toEqual({
          kind: "sent",
          outreachId: fixture.outreachId,
        });
        expect(plan.response).toMatchObject({
          joinUrl: expect.stringContaining(
            `/groups/join/${fixture.joinCode}?invite=`,
          ),
          reason: "sent-signup-link",
        });
      } finally {
        releaseProvider();
        await Promise.allSettled([
          ...(drainPromise ? [drainPromise] : []),
          ...(memberPromise ? [memberPromise] : []),
          ...(planPromise ? [planPromise] : []),
        ]);
        providerMocks.createHostedLinqChat.mockReset();
        vi.unstubAllEnvs();
        await memberPrisma.$disconnect();
        await cleanupOpenerRaceFixture(fixture);
      }
    });

    it("retries when web membership commits before group-link dispatch", async () => {
      const fixture = await createDeletionReplyRaceFixture();
      providerMocks.sendHostedLinqChatMessage.mockReset();
      try {
        await fixture.deletionPrisma.hostedGroupMember.create({
          data: {
            groupId: fixture.groupId,
            id: `hgrpm_web_join_${randomUUID()}`,
            joinedAt: new Date("2026-07-27T16:00:01.000Z"),
            memberId: fixture.participantMemberId,
          },
        });

        await expect(drainDeletionReplyEffect({
          effect: fixture.effect,
          prisma: fixture.replyPrisma,
        })).rejects.toMatchObject({
          code: "HOSTED_GROUP_JOIN_MEMBERSHIP_CHANGED",
          retryable: true,
        });

        expect(providerMocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
        await expect(fixture.deletionPrisma.hostedLinqDelivery.findUnique({
          select: { id: true },
          where: { idempotencyKey: fixture.deliveryLookupKey },
        })).resolves.toBeNull();
      } finally {
        providerMocks.sendHostedLinqChatMessage.mockReset();
        await cleanupDeletionReplyRaceFixture(fixture);
      }
    });

    it("suppresses a fresh generic dispatch after a concurrent group link wins the member lock", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const fixture = await createDeletionReplyRaceFixture();
      const genericEffect = createHostedWebhookLinqMessageSideEffect({
        chatId: fixture.chatId,
        inviteId: fixture.inviteId,
        memberId: fixture.participantMemberId,
        occurredAt: "2026-07-27T16:00:00.000Z",
        sourceEventId: `event-generic-race-${randomUUID()}`,
        template: "invite_signup",
      });
      const genericDeliveryLookupKey =
        createHostedLinqDeliveryIdempotencyLookupKey(genericEffect.effectId);
      if (!genericDeliveryLookupKey) {
        throw new Error("Expected the generic-race delivery lookup key.");
      }
      let releaseProvider = () => {};
      const providerMayContinue = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      let reportProviderStarted = () => {};
      const providerStarted = new Promise<void>((resolve) => {
        reportProviderStarted = resolve;
      });
      providerMocks.sendHostedLinqChatMessage
        .mockReset()
        .mockImplementation(async () => {
          reportProviderStarted();
          await providerMayContinue;
          return {
            chatId: fixture.chatId,
            messageId: `linq-group-race-${randomUUID()}`,
          };
        });
      let groupPromise: ReturnType<typeof drainDeletionReplyEffect> | null = null;
      let genericPromise: ReturnType<typeof drainDeletionReplyEffect> | null =
        null;

      try {
        // Planning either signup effect first materializes the occurrence-day
        // row that owns onboardingLinkSentAt. This direct-drain fixture must
        // preserve that production prerequisite so both effects share the same
        // member/day suppression marker.
        await fixture.deletionPrisma.hostedLinqDailyState.create({
          data: {
            dayUtc: new Date("2026-07-27T00:00:00.000Z"),
            firstSeenAt: new Date("2026-07-27T16:00:00.000Z"),
            lastSeenAt: new Date("2026-07-27T16:00:00.000Z"),
            memberId: fixture.participantMemberId,
          },
        });

        groupPromise = drainDeletionReplyEffect({
          effect: fixture.effect,
          prisma: fixture.replyPrisma,
        });
        await providerStarted;

        let genericSettled = false;
        genericPromise = drainDeletionReplyEffect({
          effect: genericEffect,
          prisma: fixture.deletionPrisma,
        }).finally(() => {
          genericSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(genericSettled).toBe(false);
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);

        releaseProvider();
        const [groupResult, genericResult] = await withTimeout(
          Promise.all([groupPromise, genericPromise]),
          10_000,
        );
        expect(groupResult).toEqual({ sentCount: 1, skipped: [] });
        expect(genericResult).toEqual({
          sentCount: 0,
          skipped: [{
            effectId: genericEffect.effectId,
            reason: "notice_already_claimed",
            template: "invite_signup",
          }],
        });
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
        await expect(fixture.deletionPrisma.hostedLinqDailyState.findUnique({
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
        await expect(fixture.deletionPrisma.hostedLinqDelivery.findUnique({
          select: { id: true },
          where: { idempotencyKey: genericDeliveryLookupKey },
        })).resolves.toBeNull();
      } finally {
        releaseProvider();
        await Promise.allSettled([
          ...(groupPromise ? [groupPromise] : []),
          ...(genericPromise ? [genericPromise] : []),
        ]);
        await fixture.deletionPrisma.hostedLinqDelivery.deleteMany({
          where: { idempotencyKey: genericDeliveryLookupKey },
        });
        providerMocks.sendHostedLinqChatMessage.mockReset();
        vi.unstubAllEnvs();
        await cleanupDeletionReplyRaceFixture(fixture);
      }
    });

    it("holds account deletion behind the opener provider fence", async () => {
      const fixture = await createOpenerRaceFixture();
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
      providerMocks.createHostedLinqChat
        .mockReset()
        .mockImplementation(async () => {
          reportProviderStarted();
          await providerMayContinue;
          return {
            chatId: `chat-opener-delete-${randomUUID()}`,
            messageId: `message-opener-delete-${randomUUID()}`,
          };
        });
      accountDeletionMocks.prepareHostedAccountDeletionCleanup
        .mockReset()
        .mockImplementation(async (input) => {
          reportDeletionCrossedFence();
          return makePreparedDeletionCleanup(input);
        });
      accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
        .mockReset()
        .mockReturnValue(makePendingDeletionCleanupResult());
      let drainPromise: ReturnType<typeof drainOneHostedGroupJoinOutreach> | null =
        null;
      let deletionPromise: ReturnType<typeof deleteHostedAccountData> | null = null;

      try {
        drainPromise = drainOneHostedGroupJoinOutreach({
          now: fixture.now,
          prisma: fixture.drainPrisma,
        });
        await providerStarted;

        deletionPromise = deleteHostedAccountData({
          memberId: fixture.ownerMemberId,
          prisma: fixture.contenderPrisma,
          request: new Request("https://join.example.test/settings"),
        });
        const crossedFenceBeforeProviderCompleted = await Promise.race([
          deletionCrossedFence.then(() => true),
          new Promise<false>((resolve) => {
            setTimeout(() => resolve(false), 1_000);
          }),
        ]);
        expect(crossedFenceBeforeProviderCompleted).toBe(false);

        releaseProvider();
        const [drainResult] = await withTimeout(
          Promise.all([drainPromise, deletionPromise]),
          15_000,
        );
        expect(drainResult).toEqual({
          kind: "sent",
          outreachId: fixture.outreachId,
        });
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
        await expect(fixture.drainPrisma.hostedGroupJoinOutreach.findUnique({
          select: { id: true },
          where: { id: fixture.outreachId },
        })).resolves.toBeNull();
        await expect(fixture.drainPrisma.hostedLinqDelivery.findFirst({
          select: { id: true },
          where: { groupJoinOutreachId: fixture.outreachId },
        })).resolves.toBeNull();
      } finally {
        releaseProvider();
        await Promise.allSettled([
          ...(drainPromise ? [drainPromise] : []),
          ...(deletionPromise ? [deletionPromise] : []),
        ]);
        providerMocks.createHostedLinqChat.mockReset();
        accountDeletionMocks.prepareHostedAccountDeletionCleanup
          .mockReset()
          .mockImplementation(async (input) => makePreparedDeletionCleanup(input));
        accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
          .mockReset()
          .mockReturnValue(makePendingDeletionCleanupResult());
        await cleanupOpenerRaceFixture(fixture);
      }
    });

    it("rejects an opener after the account-deletion suspension fence commits", async () => {
      const fixture = await createOpenerRaceFixture();
      let releaseDeletion = () => {};
      const deletionMayContinue = new Promise<void>((resolve) => {
        releaseDeletion = resolve;
      });
      let reportSuspensionFenceCommitted = () => {};
      const suspensionFenceCommitted = new Promise<void>((resolve) => {
        reportSuspensionFenceCommitted = resolve;
      });
      accountDeletionMocks.deleteHostedPhoneCallsForAccountDeletion
        .mockReset()
        .mockImplementation(async () => {
          reportSuspensionFenceCommitted();
          await deletionMayContinue;
        });
      accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
        .mockReset()
        .mockReturnValue(makePendingDeletionCleanupResult());
      providerMocks.createHostedLinqChat.mockReset();
      let deletionPromise: ReturnType<typeof deleteHostedAccountData> | null = null;

      try {
        deletionPromise = deleteHostedAccountData({
          memberId: fixture.ownerMemberId,
          prisma: fixture.contenderPrisma,
          request: new Request("https://join.example.test/settings"),
        });
        await suspensionFenceCommitted;
        await expect(fixture.drainPrisma.hostedMember.findUnique({
          select: { suspendedAt: true },
          where: { id: fixture.runtimeMemberId },
        })).resolves.toEqual({ suspendedAt: expect.any(Date) });

        await expect(drainOneHostedGroupJoinOutreach({
          now: fixture.now,
          prisma: fixture.drainPrisma,
        })).resolves.toEqual({
          kind: "skipped",
          outreachId: fixture.outreachId,
          reason: "group_unavailable",
        });
        expect(providerMocks.createHostedLinqChat).not.toHaveBeenCalled();

        releaseDeletion();
        await expect(withTimeout(deletionPromise, 10_000)).resolves.toBeDefined();
        await expect(fixture.drainPrisma.hostedGroupJoinOutreach.findUnique({
          select: { id: true },
          where: { id: fixture.outreachId },
        })).resolves.toBeNull();
      } finally {
        releaseDeletion();
        await Promise.allSettled([
          ...(deletionPromise ? [deletionPromise] : []),
        ]);
        accountDeletionMocks.deleteHostedPhoneCallsForAccountDeletion
          .mockReset()
          .mockResolvedValue(undefined);
        accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
          .mockReset()
          .mockReturnValue(makePendingDeletionCleanupResult());
        providerMocks.createHostedLinqChat.mockReset();
        await cleanupOpenerRaceFixture(fixture);
      }
    });

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
      accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
        .mockReset()
        .mockImplementation(() => {
          cleanupCalls += 1;
          return makePendingDeletionCleanupResult();
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
        accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
          .mockReset()
          .mockReturnValue(makePendingDeletionCleanupResult());
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
      accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
        .mockReset()
        .mockImplementation(() => {
          cleanupCalls += 1;
          return makePendingDeletionCleanupResult();
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
        accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
          .mockReset()
          .mockReturnValue(makePendingDeletionCleanupResult());
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

    it("recovers the exact group after terminal failure and restores suppression after late delivery", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const fixture = await createDeletionReplyRaceFixture();
      const recipientPhone = createUniqueTestPhone("+1303");
      const recoveryLinePhone = createUniqueTestPhone("+1303");
      const participantPhoneLookupKey =
        createHostedPhoneLookupKey(fixture.participantPhone);
      const recipientPhoneLookupKey =
        createHostedPhoneLookupKey(recipientPhone);
      const recoveryLinePhoneLookupKey =
        createHostedPhoneLookupKey(recoveryLinePhone);
      const providerMessageId = `linq-buffered-failure-${randomUUID()}`;
      const recoveryProviderMessageId =
        `linq-recovered-group-${randomUUID()}`;
      const failureEventId = `event-buffered-failure-${randomUUID()}`;
      const recoveryEventId = `event-group-recovery-${randomUUID()}`;
      const recoveryFailureEventId =
        `event-group-recovery-failed-${randomUUID()}`;
      const lateDeliveredEventId =
        `event-group-late-delivered-${randomUUID()}`;
      const laterReplyEventId = `event-group-later-reply-${randomUUID()}`;
      const providerEventLookupKeys = [
        failureEventId,
        recoveryEventId,
        recoveryFailureEventId,
        lateDeliveredEventId,
        laterReplyEventId,
      ]
        .map(createHostedLinqProviderEventLookupKey)
        .filter((value): value is string => Boolean(value));
      const recoveryEvent = buildDirectReplyEvent({
        chatId: fixture.chatId,
        eventId: recoveryEventId,
        messageId: `message-group-recovery-${randomUUID()}`,
        occurredAt: "2026-07-27T16:01:00.000Z",
        participantPhone: fixture.participantPhone,
        recipientPhone,
      });
      const laterReplyEvent = buildDirectReplyEvent({
        chatId: fixture.chatId,
        eventId: laterReplyEventId,
        messageId: `message-group-later-reply-${randomUUID()}`,
        occurredAt: "2026-07-27T16:04:00.000Z",
        participantPhone: fixture.participantPhone,
        recipientPhone,
      });
      if (
        !participantPhoneLookupKey
        || !recipientPhoneLookupKey
        || !recoveryLinePhoneLookupKey
        || providerEventLookupKeys.length !== 5
      ) {
        throw new Error("Expected terminal-recovery proof lookup keys.");
      }
      providerMocks.sendHostedLinqChatMessage
        .mockReset()
        .mockResolvedValue({
          chatId: fixture.chatId,
          messageId: providerMessageId,
        });
      providerMocks.createHostedLinqChat
        .mockReset()
        .mockResolvedValue({
          chatId: fixture.chatId,
          messageId: recoveryProviderMessageId,
        });

      try {
        await fixture.deletionPrisma.hostedMemberIdentity.create({
          data: {
            ...(await buildHostedMemberIdentityPrivateColumns({
              memberId: fixture.participantMemberId,
              phoneNumber: fixture.participantPhone,
              prisma: fixture.deletionPrisma,
              privyUserId: null,
              signupPhoneCodeSendAttemptId: null,
              signupPhoneCodeSendAttemptStartedAt: null,
              signupPhoneCodeSentAt: null,
              signupPhoneNumber: null,
            })),
            maskedPhoneNumberHint:
              `*** ${fixture.participantPhone.slice(-4)}`,
            memberId: fixture.participantMemberId,
            phoneLookupKey: participantPhoneLookupKey,
          },
        });
        await upsertHostedLinqLineForPhoneTx({
          observedAt: new Date("2026-07-27T15:59:00.000Z"),
          phoneNumber: recipientPhone,
          prisma: fixture.deletionPrisma,
          source: "configured",
        });
        await upsertHostedLinqLineForPhoneTx({
          observedAt: new Date("2026-07-27T15:59:00.000Z"),
          phoneNumber: recoveryLinePhone,
          prisma: fixture.deletionPrisma,
          source: "configured",
        });
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
              recipientPhone,
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

        const recoveryPlan = await fixture.replyPrisma.$transaction((tx) =>
          planHostedOnboardingLinqWebhook({
            event: recoveryEvent,
            firstContactAdmissionDecision: {
              confidence: 1,
              kind: "allow",
              source: "deterministic",
            },
            prisma: tx,
            requireFirstContactAdmission: true,
          })
        );
        expect(recoveryPlan.response).toMatchObject({
          joinUrl: expect.stringContaining(
            `/groups/join/${fixture.joinCode}?invite=`,
          ),
          reason: "sent-signup-link",
        });
        const [recoveryEffect] = recoveryPlan.desiredSideEffects;
        if (
          !recoveryEffect
          || recoveryEffect.payload.template !== "invite_signup_fallback"
        ) {
          throw new Error("Expected the recovered group signup effect.");
        }
        await expect(drainDeletionReplyEffect({
          effect: recoveryEffect,
          prisma: fixture.replyPrisma,
        })).resolves.toMatchObject({ sentCount: 1, skipped: [] });
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
        expect(providerMocks.createHostedLinqChat)
          .toHaveBeenLastCalledWith(expect.objectContaining({
            message: expect.stringContaining(
              `/groups/join/${fixture.joinCode}?invite=`,
            ),
          }));

        // Replaying the exact planned source-event identity cannot create a
        // second group delivery or provider call.
        await expect(drainDeletionReplyEffect({
          effect: recoveryEffect,
          prisma: fixture.replyPrisma,
        })).resolves.toMatchObject({
          sentCount: 0,
          skipped: [{
            effectId: recoveryEffect.effectId,
            reason: "notice_already_claimed",
          }],
        });
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);

        // Once the recovered delivery also fails, neither delivery is live and
        // the shared suppression marker reopens.
        await fixture.deletionPrisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedFailureReceipt({
              eventId: recoveryFailureEventId,
              messageId: recoveryProviderMessageId,
              occurredAt: "2026-07-27T16:02:00.000Z",
              recipientPhone,
            }),
            prisma: tx,
          })
        );
        await expect(fixture.replyPrisma.hostedLinqDelivery.findMany({
          orderBy: { attemptedAt: "asc" },
          select: { status: true },
          where: {
            groupJoinOutreachId: fixture.outreachId,
            template: {
              in: ["invite_signup", "invite_signup_fallback"],
            },
          },
        })).resolves.toEqual([
          { status: "failed" },
          { status: "failed" },
        ]);
        await expect(fixture.replyPrisma.hostedLinqDailyState.findUnique({
          select: { onboardingLinkSentAt: true },
          where: {
            memberId_dayUtc: {
              dayUtc: new Date("2026-07-27T00:00:00.000Z"),
              memberId: fixture.participantMemberId,
            },
          },
        })).resolves.toEqual({ onboardingLinkSentAt: null });

        // A later winning delivered receipt makes the original delivery live
        // again. Its current status restores both exact-outreach and shared
        // member/day suppression even though the row retains failed history.
        await fixture.deletionPrisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedDeliveredReceipt({
              chatId: fixture.chatId,
              eventId: lateDeliveredEventId,
              messageId: providerMessageId,
              occurredAt: "2026-07-27T16:03:00.000Z",
              recipientPhone,
            }),
            prisma: tx,
          })
        );
        await expect(fixture.replyPrisma.hostedLinqDelivery.findUnique({
          select: { status: true },
          where: { idempotencyKey: fixture.deliveryLookupKey },
        })).resolves.toEqual({ status: "delivered" });
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
        // Keep this proof on the first-contact planner boundary rather than the
        // home-line redirect installed by the recovered fallback send.
        await fixture.replyPrisma.hostedMemberRouting.deleteMany({
          where: { memberId: fixture.participantMemberId },
        });
        const laterPlan = await fixture.replyPrisma.$transaction((tx) =>
          planHostedOnboardingLinqWebhook({
            event: laterReplyEvent,
            firstContactAdmissionDecision: {
              confidence: 1,
              kind: "allow",
              source: "deterministic",
            },
            prisma: tx,
            requireFirstContactAdmission: true,
          })
        );
        expect(laterPlan.response).toMatchObject({
          ignored: true,
          reason: "signup-link-already-sent",
        });
        expect(laterPlan.desiredSideEffects).toEqual([]);
        expect(providerMocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
      } finally {
        await fixture.deletionPrisma.hostedLinqAlert.deleteMany({
          where: { eventId: { in: providerEventLookupKeys } },
        });
        await fixture.deletionPrisma.hostedLinqProviderEvent.deleteMany({
          where: { eventId: { in: providerEventLookupKeys } },
        });
        await fixture.deletionPrisma.hostedLinqDelivery.deleteMany({
          where: {
            phoneNumberLookupKey: {
              in: [
                recipientPhoneLookupKey,
                recoveryLinePhoneLookupKey,
              ],
            },
          },
        });
        await fixture.deletionPrisma.hostedLinqLine.deleteMany({
          where: {
            phoneNumberLookupKey: {
              in: [
                recipientPhoneLookupKey,
                recoveryLinePhoneLookupKey,
              ],
            },
          },
        });
        await cleanupDeletionReplyRaceFixture(fixture);
        providerMocks.sendHostedLinqChatMessage.mockReset();
        providerMocks.createHostedLinqChat.mockReset();
        vi.unstubAllEnvs();
      }
    });

    it("reuses the receipt-correlated recovery sender after a real failure projection", async () => {
      const fixture = await createGroupLineRecoveryFixture();
      const firstProviderMessageId =
        `linq-group-line-recovery-first-${randomUUID()}`;
      const secondProviderMessageId =
        `linq-group-line-recovery-second-${randomUUID()}`;
      const failureEventId =
        `event-group-line-recovery-failed-${randomUUID()}`;
      const lateDeliveredEventId =
        `event-group-line-recovery-late-delivered-${randomUUID()}`;
      const providerEventLookupKeys = [failureEventId, lateDeliveredEventId]
        .map(createHostedLinqProviderEventLookupKey)
        .filter((value): value is string => Boolean(value));
      providerMocks.createHostedLinqChat
        .mockReset()
        .mockResolvedValueOnce({
          chatId: `chat-group-line-recovery-first-${randomUUID()}`,
          messageId: firstProviderMessageId,
        })
        .mockResolvedValueOnce({
          chatId: `chat-group-line-recovery-second-${randomUUID()}`,
          messageId: secondProviderMessageId,
        });

      try {
        const firstEffect = fixture.buildEffect(
          "event-group-line-recovery-intro-1",
          "2026-07-29T16:00:00.000Z",
        );
        const secondEffect = fixture.buildEffect(
          "event-group-line-recovery-intro-2",
          "2026-07-29T16:01:00.000Z",
        );
        const thirdEffect = fixture.buildEffect(
          "event-group-line-recovery-intro-3",
          "2026-07-29T16:03:00.000Z",
        );

        await expect(drainHostedLinqEffectWithMilestones({
          effect: firstEffect,
          prisma: fixture.prisma,
        })).resolves.toEqual({ sentCount: 1, skipped: [] });
        const firstProviderCall =
          providerMocks.createHostedLinqChat.mock.calls[0]?.[0];
        expect(firstProviderCall).toMatchObject({
          from: fixture.backupPhone,
          to: [fixture.participantPhone],
        });
        await fixture.prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedFailureReceipt({
              eventId: failureEventId,
              messageId: firstProviderMessageId,
              occurredAt: "2026-07-29T16:00:30.000Z",
              recipientPhone: fixture.backupPhone,
            }),
            prisma: tx,
          })
        );
        const failureEventLookupKey =
          createHostedLinqProviderEventLookupKey(failureEventId);
        await expect(fixture.prisma.hostedLinqLine.findUnique({
          select: {
            healthStatus: true,
            lastReceiptEventId: true,
            proactiveConversationCount: true,
          },
          where: { phoneNumberLookupKey: fixture.backupPhoneLookupKey },
        })).resolves.toEqual({
          healthStatus: "warning",
          lastReceiptEventId: failureEventLookupKey,
          proactiveConversationCount: 1,
        });

        await expect(drainHostedLinqEffectWithMilestones({
          effect: firstEffect,
          prisma: fixture.prisma,
        })).resolves.toEqual({
          sentCount: 0,
          skipped: [{
            effectId: firstEffect.effectId,
            reason: "notice_target_unauthorized",
            template: "group_line_recovery",
          }],
        });
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);

        await expect(drainHostedLinqEffectWithMilestones({
          effect: secondEffect,
          prisma: fixture.prisma,
        })).resolves.toEqual({ sentCount: 1, skipped: [] });
        const secondProviderCall =
          providerMocks.createHostedLinqChat.mock.calls[1]?.[0];
        expect(secondProviderCall).toMatchObject({
          from: fixture.backupPhone,
          to: [fixture.participantPhone],
        });
        expect(secondProviderCall?.message).toBe(firstProviderCall?.message);
        expect(secondProviderCall?.idempotencyKey)
          .not.toBe(firstProviderCall?.idempotencyKey);
        await expect(fixture.prisma.hostedLinqLine.findUnique({
          select: { proactiveConversationCount: true },
          where: { phoneNumberLookupKey: fixture.backupPhoneLookupKey },
        })).resolves.toEqual({ proactiveConversationCount: 1 });
        await expect(fixture.prisma.hostedLinqDelivery.findMany({
          orderBy: { attemptedAt: "asc" },
          select: {
            phoneNumberLookupKey: true,
            sourceRef: true,
            status: true,
          },
          where: {
            phoneNumberLookupKey: fixture.backupPhoneLookupKey,
            template: "group_line_recovery",
          },
        })).resolves.toEqual([
          {
            phoneNumberLookupKey: fixture.backupPhoneLookupKey,
            sourceRef: expect.any(String),
            status: "failed",
          },
          {
            phoneNumberLookupKey: fixture.backupPhoneLookupKey,
            sourceRef: expect.any(String),
            status: "accepted",
          },
        ]);

        await expect(drainHostedLinqEffectWithMilestones({
          effect: secondEffect,
          prisma: fixture.prisma,
        })).resolves.toEqual({
          sentCount: 0,
          skipped: [{
            effectId: secondEffect.effectId,
            reason: "notice_already_claimed",
            template: "group_line_recovery",
          }],
        });
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(2);

        await fixture.prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedDeliveredReceipt({
              chatId: `chat-group-line-recovery-first-${randomUUID()}`,
              eventId: lateDeliveredEventId,
              messageId: firstProviderMessageId,
              occurredAt: "2026-07-29T16:02:00.000Z",
              recipientPhone: fixture.backupPhone,
            }),
            prisma: tx,
          })
        );
        await expect(fixture.prisma.hostedLinqDelivery.findFirst({
          select: { status: true },
          where: {
            messageLookupKey:
              createHostedLinqMessageLookupKey(firstProviderMessageId),
          },
        })).resolves.toEqual({ status: "delivered" });
        await expect(drainHostedLinqEffectWithMilestones({
          effect: thirdEffect,
          prisma: fixture.prisma,
        })).resolves.toEqual({
          sentCount: 0,
          skipped: [{
            effectId: thirdEffect.effectId,
            reason: "notice_already_claimed",
            template: "group_line_recovery",
          }],
        });
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(2);
      } finally {
        await cleanupGroupLineRecoveryFixture({
          fixture,
          providerEventLookupKeys,
        });
        providerMocks.createHostedLinqChat.mockReset();
      }
    });

    it("fails a recovery retry closed after a newer line failure or provider block", async () => {
      const fixture = await createGroupLineRecoveryFixture();
      const firstProviderMessageId =
        `linq-group-line-recovery-closed-${randomUUID()}`;
      const failureEventId =
        `event-group-line-recovery-closed-failed-${randomUUID()}`;
      const newerFailureEventId =
        `event-group-line-recovery-newer-failed-${randomUUID()}`;
      const blockedEventId =
        `event-group-line-recovery-provider-blocked-${randomUUID()}`;
      const providerEventLookupKeys = [
        failureEventId,
        newerFailureEventId,
        blockedEventId,
      ]
        .map(createHostedLinqProviderEventLookupKey)
        .filter((value): value is string => Boolean(value));
      providerMocks.createHostedLinqChat
        .mockReset()
        .mockResolvedValue({
          chatId: `chat-group-line-recovery-closed-${randomUUID()}`,
          messageId: firstProviderMessageId,
        });

      try {
        const firstEffect = fixture.buildEffect(
          "event-group-line-recovery-closed-intro-1",
          "2026-07-29T17:00:00.000Z",
        );
        const secondEffect = fixture.buildEffect(
          "event-group-line-recovery-closed-intro-2",
          "2026-07-29T17:02:00.000Z",
        );
        const thirdEffect = fixture.buildEffect(
          "event-group-line-recovery-closed-intro-3",
          "2026-07-29T17:04:00.000Z",
        );

        await expect(drainHostedLinqEffectWithMilestones({
          effect: firstEffect,
          prisma: fixture.prisma,
        })).resolves.toEqual({ sentCount: 1, skipped: [] });
        await fixture.prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedFailureReceipt({
              eventId: failureEventId,
              messageId: firstProviderMessageId,
              occurredAt: "2026-07-29T17:00:30.000Z",
              recipientPhone: fixture.backupPhone,
            }),
            prisma: tx,
          })
        );
        await fixture.prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedFailureReceipt({
              eventId: newerFailureEventId,
              messageId: `unrelated-message-${randomUUID()}`,
              occurredAt: "2026-07-29T17:01:00.000Z",
              recipientPhone: fixture.backupPhone,
            }),
            prisma: tx,
          })
        );
        await expect(drainHostedLinqEffectWithMilestones({
          effect: secondEffect,
          prisma: fixture.prisma,
        })).resolves.toEqual({
          sentCount: 0,
          skipped: [{
            effectId: secondEffect.effectId,
            reason: "notice_target_unauthorized",
            template: "group_line_recovery",
          }],
        });
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);

        await fixture.prisma.$transaction((tx) =>
          ingestHostedLinqProviderEventTx({
            event: buildParsedProviderStatusEvent({
              eventId: blockedEventId,
              occurredAt: "2026-07-29T17:03:00.000Z",
              phoneNumber: fixture.backupPhone,
              providerReputationStatus: "CRITICAL",
            }),
            prisma: tx,
          })
        );
        await expect(fixture.prisma.hostedLinqLine.findUnique({
          select: {
            healthStatus: true,
            providerReputationStatus: true,
          },
          where: { phoneNumberLookupKey: fixture.backupPhoneLookupKey },
        })).resolves.toEqual({
          healthStatus: "warning",
          providerReputationStatus: "CRITICAL",
        });
        await expect(drainHostedLinqEffectWithMilestones({
          effect: thirdEffect,
          prisma: fixture.prisma,
        })).resolves.toEqual({
          sentCount: 0,
          skipped: [{
            effectId: thirdEffect.effectId,
            reason: "notice_target_unauthorized",
            template: "group_line_recovery",
          }],
        });
        expect(providerMocks.createHostedLinqChat).toHaveBeenCalledTimes(1);
      } finally {
        await cleanupGroupLineRecoveryFixture({
          fixture,
          providerEventLookupKeys,
        });
        providerMocks.createHostedLinqChat.mockReset();
      }
    });

    it("composes D-to-R vault replacement with the actual O-to-R account deletion path", async () => {
      vi.stubEnv(
        "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
        "https://join.example.test",
      );
      const suffix = randomUUID().replaceAll("-", "");
      const deletionApplicationName = `delete_vault_${suffix.slice(0, 8)}`;
      const projectionApplicationName = `project_vault_${suffix.slice(0, 8)}`;
      const fixture = await createDeletionReplyRaceFixture({
        deletionApplicationName,
        externalParticipantSortsBeforeOwner: true,
      });
      const blocker = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const projectionPrisma = createPrismaClient({
        databaseUrl: withPostgresApplicationName(
          databaseUrl,
          projectionApplicationName,
        ),
        poolMax: 1,
      });
      const projectionScope = hostedVaultShareProjectionKindToScope(
        "sleep-times.v0",
      );
      const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(
        projectionScope,
      );
      const shareId = `share_delete_projection_${suffix}`;
      let releaseDeletionPreparation = (): void => undefined;
      const deletionPreparationMayContinue = new Promise<void>((resolve) => {
        releaseDeletionPreparation = resolve;
      });
      let reportDeletionPrepared = (): void => undefined;
      const deletionPrepared = new Promise<void>((resolve) => {
        reportDeletionPrepared = resolve;
      });
      let releaseOutreachTable = (): void => undefined;
      const outreachTableMayRelease = new Promise<void>((resolve) => {
        releaseOutreachTable = resolve;
      });
      let reportOutreachTableLocked = (): void => undefined;
      const outreachTableLocked = new Promise<void>((resolve) => {
        reportOutreachTableLocked = resolve;
      });
      const inFlight: Promise<unknown>[] = [];

      setHostedSecureBoxStringTestCodecForTests({
        decrypt: ({ value }) => value,
        encrypt: () => `ciphertext_${shareId}`,
      });
      accountDeletionMocks.deleteHostedPhoneCallsForAccountDeletion
        .mockReset()
        .mockImplementation(async () => {
          reportDeletionPrepared();
          await deletionPreparationMayContinue;
        });
      providerMocks.sendHostedLinqChatMessage
        .mockReset()
        .mockResolvedValue({
          chatId: fixture.chatId,
          messageId: `message-delete-projection-${suffix}`,
        });

      try {
        expect(fixture.participantMemberId < fixture.ownerMemberId).toBe(true);
        await drainDeletionReplyEffect({
          effect: fixture.effect,
          prisma: fixture.replyPrisma,
        });
        await fixture.deletionPrisma.hostedWorkspace.create({
          data: { userId: fixture.participantMemberId, version: 1n },
        });
        await fixture.deletionPrisma.hostedVaultShare.create({
          data: {
            destinationMemberId: fixture.runtimeMemberId,
            grantedAt: new Date("2026-07-27T16:00:00.000Z"),
            grantorMemberId: fixture.participantMemberId,
            id: shareId,
            projectionKind: projectionScope.projectionKind,
            projectionScopeJson: JSON.parse(
              JSON.stringify(projectionScope),
            ) as Prisma.InputJsonValue,
            projectionScopeKey,
            status: "granted",
          },
        });

        const deletion = deleteHostedAccountData({
          memberId: fixture.ownerMemberId,
          prisma: fixture.deletionPrisma,
          request: new Request("https://join.example.test/settings"),
        });
        inFlight.push(deletion);
        await deletionPrepared;

        const outreachTableHolder = blocker.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            'LOCK TABLE "hosted_group_join_outreach" IN ACCESS EXCLUSIVE MODE',
          );
          reportOutreachTableLocked();
          await outreachTableMayRelease;
        });
        inFlight.push(outreachTableHolder);
        await outreachTableLocked;
        releaseDeletionPreparation();
        await waitForPostgresApplicationLock({
          applicationName: deletionApplicationName,
          observer,
        });

        const projection = replaceHostedVaultShareProjectionSnapshot({
          prisma: projectionPrisma,
          records: [],
          share: {
            destinationMemberId: fixture.runtimeMemberId,
            grantorMemberId: fixture.participantMemberId,
            id: shareId,
            projectionKind: projectionScope.projectionKind,
            projectionScope,
            projectionScopeKey,
          },
          sourceWorkspaceVersion: "1",
        });
        inFlight.push(projection);
        await waitForPostgresApplicationLock({
          applicationName: projectionApplicationName,
          observer,
        });

        releaseOutreachTable();
        await outreachTableHolder;
        const [, projectionResult] = await withTimeout(
          Promise.all([deletion, projection]),
          15_000,
        );
        expect(projectionResult).toBe("no-active-share");
        await expect(fixture.deletionPrisma.hostedVaultShare.findUnique({
          select: { id: true },
          where: { id: shareId },
        })).resolves.toBeNull();
        await expectDeletionReplyRaceConverged(fixture);
      } finally {
        releaseDeletionPreparation();
        releaseOutreachTable();
        await Promise.allSettled(inFlight);
        setHostedSecureBoxStringTestCodecForTests(null);
        accountDeletionMocks.deleteHostedPhoneCallsForAccountDeletion
          .mockReset()
          .mockResolvedValue(undefined);
        providerMocks.sendHostedLinqChatMessage.mockReset();
        vi.unstubAllEnvs();
        await cleanupDeletionReplyRaceFixture(fixture);
        await Promise.all([
          blocker.$disconnect(),
          observer.$disconnect(),
          projectionPrisma.$disconnect(),
        ]);
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
      accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
        .mockReset()
        .mockImplementation(() => {
          cleanupCalls += 1;
          return makePendingDeletionCleanupResult();
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
        accountDeletionMocks.pendingHostedAccountDeletionCleanupResult
          .mockReset()
          .mockReturnValue(makePendingDeletionCleanupResult());
        providerMocks.sendHostedLinqChatMessage.mockReset();
        vi.unstubAllEnvs();
      }
    });
  },
);

type GroupLineRecoveryFixture = {
  backupPhone: string;
  backupPhoneLookupKey: string;
  buildEffect: (
    sourceEventId: string,
    occurredAt: string,
  ) => ReturnType<typeof createHostedWebhookLinqMessageSideEffect>;
  incomingPhoneLookupKey: string;
  memberId: string;
  participantPhone: string;
  prisma: PrismaClient;
};

async function createGroupLineRecoveryFixture():
  Promise<GroupLineRecoveryFixture> {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const memberId = `hbm_group_line_recovery_${randomUUID()}`;
  const participantPhone = createUniqueTestPhone("+1202");
  const incomingPhone = createUniqueTestPhone("+1303");
  const backupPhone = createUniqueTestPhone("+1303");
  const participantPhoneLookupKey =
    createHostedPhoneLookupKey(participantPhone);
  const incomingPhoneLookupKey = createHostedPhoneLookupKey(incomingPhone);
  const backupPhoneLookupKey = createHostedPhoneLookupKey(backupPhone);
  if (
    !participantPhoneLookupKey
    || !incomingPhoneLookupKey
    || !backupPhoneLookupKey
  ) {
    throw new Error("Expected group-line recovery fixture lookup keys.");
  }
  const assignedAt = new Date("2026-07-29T15:59:00.000Z");
  const threadId = `chat-group-line-recovery-${randomUUID()}`;

  await prisma.hostedMember.create({
    data: {
      billingStatus: HostedBillingStatus.active,
      id: memberId,
    },
  });
  await prisma.hostedMemberIdentity.create({
    data: {
      ...(await buildHostedMemberIdentityPrivateColumns({
        memberId,
        phoneNumber: participantPhone,
        prisma,
        privyUserId: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
      })),
      maskedPhoneNumberHint: `*** ${participantPhone.slice(-4)}`,
      memberId,
      phoneLookupKey: participantPhoneLookupKey,
    },
  });
  await upsertHostedLinqLineForPhoneTx({
    observedAt: assignedAt,
    phoneNumber: incomingPhone,
    prisma,
    source: "configured",
  });
  await upsertHostedLinqLineForPhoneTx({
    observedAt: assignedAt,
    phoneNumber: backupPhone,
    prisma,
    source: "configured",
  });
  await prisma.hostedLinqLine.update({
    data: {
      providerReputationStatus: "CRITICAL",
      providerServiceStatus: "ACTIVE",
    },
    where: { phoneNumberLookupKey: incomingPhoneLookupKey },
  });
  await prisma.hostedLinqLine.update({
    data: {
      assignmentWeight: 2_147_483_647,
      healthStatus: "healthy",
      maxNewConversationsPerDay: 10,
      providerReputationStatus: "HEALTHY",
      providerServiceStatus: "ACTIVE",
    },
    where: { phoneNumberLookupKey: backupPhoneLookupKey },
  });
  await prisma.$transaction((tx) =>
    upsertHostedMemberHomeLinqRecipientPhoneTx({
      homeLineAssignedAt: assignedAt,
      memberId,
      prisma: tx,
      recipientPhone: incomingPhone,
    })
  );

  return {
    backupPhone,
    backupPhoneLookupKey,
    buildEffect: (sourceEventId, occurredAt) =>
      createHostedWebhookLinqMessageSideEffect({
        incomingRecipientPhone: incomingPhone,
        memberId,
        occurredAt,
        participantContact: {
          kind: "phone",
          value: participantPhone,
        },
        sourceEventId,
        template: "group_line_recovery",
        threadId,
      }),
    incomingPhoneLookupKey,
    memberId,
    participantPhone,
    prisma,
  };
}

async function cleanupGroupLineRecoveryFixture(input: {
  fixture: GroupLineRecoveryFixture;
  providerEventLookupKeys: string[];
}): Promise<void> {
  await input.fixture.prisma.hostedLinqAlert.deleteMany({
    where: { eventId: { in: input.providerEventLookupKeys } },
  });
  await input.fixture.prisma.hostedLinqDelivery.deleteMany({
    where: {
      phoneNumberLookupKey: input.fixture.backupPhoneLookupKey,
      template: "group_line_recovery",
    },
  });
  await input.fixture.prisma.hostedLinqProviderEvent.deleteMany({
    where: { eventId: { in: input.providerEventLookupKeys } },
  });
  await input.fixture.prisma.hostedMember.deleteMany({
    where: { id: input.fixture.memberId },
  });
  await input.fixture.prisma.hostedLinqLine.deleteMany({
    where: {
      phoneNumberLookupKey: {
        in: [
          input.fixture.backupPhoneLookupKey,
          input.fixture.incomingPhoneLookupKey,
        ],
      },
    },
  });
  await input.fixture.prisma.$disconnect();
}

type OpenerRaceFixture = {
  contenderPrisma: PrismaClient;
  drainPrisma: PrismaClient;
  groupId: string;
  joinCode: string;
  linePhone: string;
  linePhoneLookupKey: string;
  now: Date;
  outreachId: string;
  ownerMemberId: string;
  participantPhone: string;
  participantPhoneLookupKey: string;
  runtimeMemberId: string;
};

async function createOpenerRaceFixture(): Promise<OpenerRaceFixture> {
  const drainPrisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const contenderPrisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const now = new Date("2026-07-27T16:00:00.000Z");
  const ownerMemberId = `hbm_opener_owner_${randomUUID()}`;
  const runtimeMemberId = `hbm_opener_runtime_${randomUUID()}`;
  const groupId = `hgrp_opener_race_${randomUUID()}`;
  const joinCode = `join-opener-race-${randomUUID()}`;
  const offerId = `hgrpjo_opener_race_${randomUUID()}`;
  const participantPhone = createUniqueTestPhone("+1202");
  const participantPhoneLookupKey = createHostedPhoneLookupKey(participantPhone);
  const linePhone = createUniqueTestPhone("+1303");
  const linePhoneLookupKey = createHostedPhoneLookupKey(linePhone);
  if (!participantPhoneLookupKey || !linePhoneLookupKey) {
    throw new Error("Expected opener-race phone lookup keys.");
  }

  await drainPrisma.hostedMember.createMany({
    data: [
      { id: ownerMemberId },
      { id: runtimeMemberId },
    ],
  });
  await drainPrisma.hostedThreadContainer.create({
    data: {
      memberId: runtimeMemberId,
      ownerMemberId,
    },
  });
  await drainPrisma.hostedGroup.create({
    data: {
      displayName: "Opener Fence Group",
      id: groupId,
      joinCode,
      joinCodeCreatedAt: now,
      ownerMemberId,
      runtimeMemberId,
    },
  });
  await drainPrisma.hostedGroupJoinOffer.create({
    data: {
      groupId,
      id: offerId,
      messageLookupKey: `offer-opener-race-${randomUUID()}`,
      postedAt: now,
      projectionKindsJson: ["best_effort"],
    },
  });
  await upsertHostedLinqLineForPhoneTx({
    observedAt: now,
    phoneNumber: linePhone,
    prisma: drainPrisma,
    source: "configured",
  });
  await drainPrisma.hostedLinqLine.update({
    data: {
      assignmentWeight: 1_000_000,
      healthStatus: "healthy",
      maxNewConversationsPerDay: 100,
      providerReputationStatus: "HEALTHY",
      providerServiceStatus: "ACTIVE",
    },
    where: { phoneNumberLookupKey: linePhoneLookupKey },
  });
  const enqueued = await drainPrisma.$transaction((tx) =>
    enqueueHostedGroupJoinOutreachTx({
      offerId,
      participantPhoneNumber: participantPhone,
      requestedAt: now,
      tx,
    })
  );

  return {
    contenderPrisma,
    drainPrisma,
    groupId,
    joinCode,
    linePhone,
    linePhoneLookupKey,
    now,
    outreachId: enqueued.outreachId,
    ownerMemberId,
    participantPhone,
    participantPhoneLookupKey,
    runtimeMemberId,
  };
}

async function createPhoneBoundMemberIdentityTx(input: {
  phoneNumber: string;
  phoneNumberVerifiedAt?: Date | null;
  tx: Prisma.TransactionClient;
}): Promise<string> {
  await acquireHostedLinqParticipantPhoneLockTx({
    phoneNumber: input.phoneNumber,
    tx: input.tx,
  });
  const memberId = `hbm_opener_participant_${randomUUID()}`;
  const phoneLookupKey = createHostedPhoneLookupKey(input.phoneNumber);
  if (!phoneLookupKey) {
    throw new Error("Expected opener-race participant phone lookup key.");
  }
  await input.tx.hostedMember.create({
    data: { id: memberId },
  });
  await input.tx.hostedMemberIdentity.create({
    data: {
      ...(await buildHostedMemberIdentityPrivateColumns({
        memberId,
        phoneNumber: input.phoneNumber,
        prisma: input.tx,
        privyUserId: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: null,
      })),
      maskedPhoneNumberHint: `*** ${input.phoneNumber.slice(-4)}`,
      memberId,
      phoneLookupKey,
      phoneNumberVerifiedAt: input.phoneNumberVerifiedAt ?? null,
    },
  });
  return memberId;
}

async function cleanupOpenerRaceFixture(
  fixture: OpenerRaceFixture,
): Promise<void> {
  const participantIdentity =
    await fixture.drainPrisma.hostedMemberIdentity.findFirst({
      select: { memberId: true },
      where: { phoneLookupKey: fixture.participantPhoneLookupKey },
    });
  await fixture.drainPrisma.hostedGroup.deleteMany({
    where: { id: fixture.groupId },
  });
  await fixture.drainPrisma.hostedThreadContainer.deleteMany({
    where: { memberId: fixture.runtimeMemberId },
  });
  await fixture.drainPrisma.hostedMember.deleteMany({
    where: {
      id: {
        in: [
          fixture.ownerMemberId,
          fixture.runtimeMemberId,
          ...(participantIdentity ? [participantIdentity.memberId] : []),
        ],
      },
    },
  });
  await fixture.drainPrisma.hostedLinqLine.deleteMany({
    where: { phoneNumberLookupKey: fixture.linePhoneLookupKey },
  });
  await Promise.all([
    fixture.contenderPrisma.$disconnect(),
    fixture.drainPrisma.$disconnect(),
  ]);
}

type ReactionAdmissionFixture = {
  contenderPrisma: PrismaClient;
  eventLookupKeys: string[];
  groupId: string;
  linePhone: string;
  linePhoneLookupKey: string;
  offerChatId: string;
  offerId: string;
  offerMessageId: string;
  ownerMemberId: string;
  participantMemberId: string;
  participantPhone: string;
  reactionPrisma: PrismaClient;
  runtimeMemberId: string;
};

async function createReactionAdmissionFixture(): Promise<ReactionAdmissionFixture> {
  const reactionPrisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const contenderPrisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const now = new Date("2026-07-28T16:00:00.000Z");
  const ownerMemberId = `hbm_reaction_owner_${randomUUID()}`;
  const runtimeMemberId = `hbm_reaction_runtime_${randomUUID()}`;
  const groupId = `hgrp_reaction_race_${randomUUID()}`;
  const offerId = `hgrpjo_reaction_race_${randomUUID()}`;
  const offerChatId = `chat-reaction-race-${randomUUID()}`;
  const offerMessageId = `message-reaction-race-${randomUUID()}`;
  const offerMessageLookupKey = createHostedLinqMessageLookupKey(offerMessageId);
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: "linq",
    threadId: offerChatId,
  });
  const participantPhone = createUniqueTestPhone("+1202");
  const linePhone = createUniqueTestPhone("+1303");
  const linePhoneLookupKey = createHostedPhoneLookupKey(linePhone);
  if (
    !offerMessageLookupKey
    || !threadIdentityLookupKey
    || !linePhoneLookupKey
  ) {
    throw new Error("Expected reaction-admission lookup keys.");
  }

  await reactionPrisma.hostedMember.createMany({
    data: [
      { billingStatus: HostedBillingStatus.active, id: ownerMemberId },
      { id: runtimeMemberId },
    ],
  });
  await reactionPrisma.hostedThreadContainer.create({
    data: {
      memberId: runtimeMemberId,
      ownerMemberId,
    },
  });
  await reactionPrisma.hostedGroup.create({
    data: {
      displayName: "Reaction Admission Group",
      id: groupId,
      joinCode: `join-reaction-race-${randomUUID()}`,
      joinCodeCreatedAt: now,
      ownerMemberId,
      runtimeMemberId,
    },
  });
  await reactionPrisma.hostedThreadRoute.create({
    data: {
      channel: "linq",
      containerMemberId: runtimeMemberId,
      pendingParticipantAddition: false,
      threadIdentityLookupKey,
      threadLookupKey: `reaction-race-thread-${randomUUID()}`,
    },
  });
  await reactionPrisma.hostedGroupJoinOffer.create({
    data: {
      groupId,
      id: offerId,
      messageLookupKey: offerMessageLookupKey,
      postedAt: now,
      projectionKindsJson: [],
    },
  });
  await upsertHostedLinqLineForPhoneTx({
    observedAt: now,
    phoneNumber: linePhone,
    prisma: reactionPrisma,
    source: "configured",
  });
  const participantMemberId = await reactionPrisma.$transaction((tx) =>
    createPhoneBoundMemberIdentityTx({
      phoneNumber: participantPhone,
      phoneNumberVerifiedAt: new Date("2026-07-20T00:00:00.000Z"),
      tx,
    })
  );
  await reactionPrisma.hostedConsentGrant.createMany({
    data: ["launch.legal", "launch.health-data"].map((scope) => ({
      documentVersionsJson: {},
      grantedAt: now,
      memberId: participantMemberId,
      scope,
      source: "test",
      status: "granted",
    })),
  });

  return {
    contenderPrisma,
    eventLookupKeys: [],
    groupId,
    linePhone,
    linePhoneLookupKey,
    offerChatId,
    offerId,
    offerMessageId,
    ownerMemberId,
    participantMemberId,
    participantPhone,
    reactionPrisma,
    runtimeMemberId,
  };
}

function buildReactionAdmissionEvent(input: {
  eventId: string;
  eventType: "reaction.added" | "reaction.removed";
  fixture: ReactionAdmissionFixture;
}) {
  const parsed = parseHostedLinqProviderEvent({
    event: {
      api_version: "v3",
      created_at: "2026-07-28T16:00:00.000Z",
      data: {
        chat_id: input.fixture.offerChatId,
        from_handle: {
          handle: input.fixture.participantPhone,
          service: "iMessage",
        },
        is_from_me: false,
        line: { phone_number: input.fixture.linePhone },
        message_id: input.fixture.offerMessageId,
        reacted_at: "2026-07-28T16:00:01.000Z",
        reaction_type: "love",
      },
      event_id: input.eventId,
      event_type: input.eventType,
      trace_id: `trace-${randomUUID()}`,
      webhook_version: "2026-02-03",
    } as Parameters<typeof parseHostedLinqProviderEvent>[0]["event"],
  });
  if (!parsed) {
    throw new Error("Expected the reaction-admission event to parse.");
  }
  return parsed;
}

async function ingestReactionAdmissionEvent(input: {
  event: ReturnType<typeof buildReactionAdmissionEvent>;
  fixture: ReactionAdmissionFixture;
}): Promise<void> {
  const eventLookupKey = createHostedLinqProviderEventLookupKey(
    input.event.eventId,
  );
  input.fixture.eventLookupKeys.push(eventLookupKey);
  await input.fixture.reactionPrisma.$transaction((tx) =>
    ingestHostedLinqProviderEventTx({
      event: input.event,
      prisma: tx,
    })
  );
}

async function assertReactionAdmissionOfferTarget(input: {
  event: ReturnType<typeof buildReactionAdmissionEvent>;
  fixture: ReactionAdmissionFixture;
}): Promise<void> {
  await expect(input.fixture.reactionPrisma.$transaction((tx) =>
    readHostedGroupJoinOfferTargetTx({
      channel: "linq",
      messageLookupKeyReadCandidates:
        input.event.messageLookupKeyReadCandidates,
      threadIdentityLookupKeyReadCandidates:
        createHostedExternalThreadIdentityLookupKeyReadCandidates({
          channel: "linq",
          threadId: input.event.linqChatId,
        }),
      tx,
    })
  )).resolves.toMatchObject({
    groupId: input.fixture.groupId,
    offerId: input.fixture.offerId,
  });
}

async function cleanupReactionAdmissionFixture(
  fixture: ReactionAdmissionFixture,
): Promise<void> {
  await fixture.reactionPrisma.hostedLinqAlert.deleteMany({
    where: { eventId: { in: fixture.eventLookupKeys } },
  });
  await fixture.reactionPrisma.hostedLinqProviderEvent.deleteMany({
    where: { eventId: { in: fixture.eventLookupKeys } },
  });
  await fixture.reactionPrisma.hostedGroup.deleteMany({
    where: { id: fixture.groupId },
  });
  await fixture.reactionPrisma.hostedThreadContainer.deleteMany({
    where: { memberId: fixture.runtimeMemberId },
  });
  await fixture.reactionPrisma.hostedMember.deleteMany({
    where: {
      id: {
        in: [
          fixture.ownerMemberId,
          fixture.participantMemberId,
          fixture.runtimeMemberId,
        ],
      },
    },
  });
  await fixture.reactionPrisma.hostedLinqLine.deleteMany({
    where: { phoneNumberLookupKey: fixture.linePhoneLookupKey },
  });
  await Promise.all([
    fixture.contenderPrisma.$disconnect(),
    fixture.reactionPrisma.$disconnect(),
  ]);
}

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
  participantPhone: string;
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

function makePendingDeletionCleanupResult() {
  return {
    cleanupPending: true,
    cloudflare: {
      alarmCleared: null,
      configured: false,
      deleteAllCompleted: null,
      deleted: false,
      errorCode: "ACCOUNT_DELETION_CLEANUP_PENDING",
      r2DeletedObjectCount: null,
      r2SkippedUserScopedPrefixes: null,
      r2Supported: null,
      r2UserScopedSkipReason: null,
      runnerStateDeleted: null,
    },
    vendorAccounts: {
      privyUser: {
        errorCode: "ACCOUNT_DELETION_CLEANUP_PENDING",
        status: "failed",
      },
      stripeCustomer: {
        errorCode: "ACCOUNT_DELETION_CLEANUP_PENDING",
        status: "failed",
      },
    },
  };
}

async function createDeletionReplyRaceFixture(input: {
  deletionApplicationName?: string;
  externalParticipantSortsBeforeOwner?: boolean;
} = {}):
  Promise<DeletionReplyRaceFixture> {
  const deletionPrisma = createPrismaClient({
    databaseUrl: input.deletionApplicationName
      ? withPostgresApplicationName(databaseUrl, input.deletionApplicationName)
      : databaseUrl,
    poolMax: 2,
  });
  const replyPrisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const ownerMemberId = input.externalParticipantSortsBeforeOwner
    ? `hbm_delete_z_owner_${randomUUID()}`
    : `hbm_delete_owner_${randomUUID()}`;
  const runtimeMemberId = `hbm_delete_runtime_${randomUUID()}`;
  const participantMemberId = input.externalParticipantSortsBeforeOwner
    ? `hbm_delete_a_participant_${randomUUID()}`
    : `hbm_delete_participant_${randomUUID()}`;
  const groupId = `hgrp_delete_fence_${randomUUID()}`;
  const offerId = `hgrpjo_delete_fence_${randomUUID()}`;
  const outreachId = `hgrpjoa_delete_fence_${randomUUID()}`;
  const inviteId = `hinv_delete_fence_${randomUUID()}`;
  const chatId = `chat-delete-fence-${randomUUID()}`;
  const joinCode = `join-delete-fence-${randomUUID()}`;
  const occurredAt = new Date("2026-07-27T16:00:00.000Z");
  const participantPhone = createUniqueTestPhone("+1202");
  const participantPhoneLookupKey =
    createHostedPhoneLookupKey(participantPhone);
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
      { billingStatus: HostedBillingStatus.active, id: ownerMemberId },
      { billingStatus: HostedBillingStatus.not_started, id: runtimeMemberId },
      { billingStatus: HostedBillingStatus.active, id: participantMemberId },
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
    participantPhone,
    replyPrisma,
    runtimeMemberId,
  };
}

async function drainDeletionReplyEffect(input: {
  effect: DeletionReplyRaceFixture["effect"];
  prisma: Prisma.TransactionClient | PrismaClient;
}) {
  return drainHostedLinqEffectWithMilestones(input);
}

async function drainHostedLinqEffectWithMilestones(input: {
  effect: ReturnType<typeof createHostedWebhookLinqMessageSideEffect>;
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
  messageText?: string;
  occurredAt: string;
  participantPhone: string;
  recipientPhone: string | null;
  replyToMessageId?: string;
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
      parts: [{ type: "text", value: input.messageText ?? "yes" }],
      ...(input.replyToMessageId
        ? {
            reply_to: {
              message_id: input.replyToMessageId,
              part_index: 0,
            },
          }
        : {}),
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

function buildParsedProviderStatusEvent(input: {
  eventId: string;
  occurredAt: string;
  phoneNumber: string;
  providerReputationStatus: string;
}) {
  const parsed = parseHostedLinqProviderEvent({
    event: parseHostedLinqWebhookEvent(JSON.stringify({
      api_version: "v3",
      created_at: input.occurredAt,
      data: {
        changed_at: input.occurredAt,
        new_reputation: input.providerReputationStatus,
        phone_number: input.phoneNumber,
      },
      event_id: input.eventId,
      event_type: "phone_number.status_updated",
      trace_id: `trace-${randomUUID()}`,
      webhook_version: "2026-02-03",
    })),
    rawBody: "{}",
  });
  if (!parsed) {
    throw new Error("Expected the provider status event to parse.");
  }
  return parsed;
}

function buildParsedDeliveredReceipt(input: {
  chatId: string;
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
        chat_id: input.chatId,
        message_id: input.messageId,
        phone_number: input.recipientPhone,
        service: "sms",
      },
      event_id: input.eventId,
      event_type: "message.delivered",
      trace_id: `trace-${randomUUID()}`,
      webhook_version: "2026-02-03",
    })),
    rawBody: "{}",
  });
  if (!parsed) {
    throw new Error("Expected the delivered receipt to parse.");
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

async function waitForPostgresApplicationLock(input: {
  applicationName: string;
  observer: PrismaClient;
}): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [activity] = await input.observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE application_name = ${input.applicationName}
        AND state = 'active'
    `;
    if (activity?.waitEventType === "Lock") {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Expected ${input.applicationName} to wait on a PostgreSQL lock.`,
  );
}

function withPostgresApplicationName(
  value: string,
  applicationName: string,
): string {
  const url = new URL(value);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
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
