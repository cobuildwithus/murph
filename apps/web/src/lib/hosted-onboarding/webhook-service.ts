import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  requireHostedLinqMessageEditedEvent,
  requireHostedLinqParticipantChangedEvent,
  requireHostedLinqTypingIndicatorStartedEvent,
  requireHostedLinqMessageReceivedEvent,
  inspectHostedLinqMessageReceivedParts,
  sendHostedLinqReadReceipt,
  type HostedLinqMessageReceivedPartsInspection,
  verifyAndParseHostedLinqWebhookRequest,
} from "./linq";
import {
  getHostedLinqChatSummary,
  startHostedLinqChatTypingIndicator,
  stopHostedLinqChatTypingIndicator,
  type HostedLinqChatHandleSummary,
} from "./linq-client";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import {
  planHostedLinqPermanentHomeRouteRecovery,
} from "./linq-home-route-recovery";
import {
  HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE,
} from "./linq-group-line-recovery";
import { HOSTED_LINQ_GROUP_SETUP_TEMPLATE } from "./linq-group-setup";
import {
  assertHostedTelegramWebhookSecret,
  buildHostedTelegramMessagePayload,
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "./telegram";
import {
  planHostedLinqMessageEditedWebhook,
  planHostedOnboardingLinqWebhook,
  resolveHostedLinqMailboxPayloadRootPrewarmMemberId,
  resolveHostedLinqTypingPrewarmMemberId,
  shouldPrepareHostedLinqThreadContainerCrypto,
  type HostedOnboardingLinqWebhookResponse,
} from "./webhook-provider-linq";
import {
  planHostedOnboardingTelegramWebhook,
  type HostedOnboardingTelegramWebhookResponse,
} from "./webhook-provider-telegram";
import {
  handleHostedTelegramGroupOfferCallback,
} from "../hosted-groups/telegram-offer-callback";
import {
  sendPendingHostedLinqAlertsBestEffort,
} from "./linq-alert-email";
import {
  ingestHostedLinqProviderEventTx,
} from "./linq-provider-event-store";
import {
  parseHostedLinqProviderEvent,
} from "./linq-provider-events";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  logHostedOnboardingDiagnostic,
  logHostedOnboardingWarning,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import {
  runWithHostedDomainRootUnwrapCache,
} from "../hosted-crypto/domain-root-unwrap-cache";
import { unwrapHostedDomainRootForWeb } from "../hosted-crypto/domain-root-store";
import { getHostedCryptoDomainForLane } from "@murphai/runtime-state";
import {
  runWithPrismaOperationTimings,
  type PrismaOperationTiming,
} from "../prisma-operation-timing";
import {
  buildHostedWebhookDbTimingLogDetails,
} from "./webhook-db-timing";
import {
  drainHostedLinqSideEffectsDirect,
  queueHostedLinqContactCardShareAfterDeliveredInviteSignup,
} from "./webhook-transport";
import {
  buildHostedLinqFirstContactAdmissionClassifierUnavailableDecision,
  claimHostedLinqFirstContactAdmissionBudget,
  classifyHostedLinqFirstContactAdmission,
  isHostedLinqFirstContactAdmissionClassifierUnavailableError,
  readHostedLinqFirstContactAdmissionMode,
  readRecordedHostedLinqFirstContactAdmissionDecision,
  recordHostedLinqFirstContactAdmissionDecision,
  tryHostedLinqFirstContactAdmissionDeterministicDecision,
  type HostedLinqFirstContactAdmissionDecision,
} from "./linq-first-contact-admission";
import {
  ensureHostedLinqInstantStartPulseTrialEnrollment,
  runHostedLinqInstantStartDeferredActivationWakeBestEffort,
  type HostedLinqInstantStartDeferredActivationWake,
} from "./auto-trial-enrollment-service";
import {
  isHostedLinqInstantStartEventCandidate,
} from "./linq-instant-start";
import {
  maybeHandoffHostedExecutionWebhookWake,
} from "./webhook-service-wake";
import {
  startHostedRuntimeShellPrewarmBestEffort,
} from "../hosted-execution/direct-runtime-wake";
import {
  assertHostedThreadRouteEgressAuthority,
  markHostedLinqThreadRouteParticipantAdditionPendingTx,
  readHostedThreadRouteByThreadIdentity,
  type HostedThreadRouteSnapshot,
} from "../hosted-routing/thread-route-store";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "../hosted-routing/linq-chat-ownership-lock";
import {
  prepareHostedThreadContainerCreation,
  prepareHostedThreadContainerDeliveryRoute,
  type PreparedHostedThreadContainerCreation,
  type PreparedHostedThreadContainerDeliveryRoute,
} from "../hosted-routing/thread-container-service";
import {
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
} from "../hosted-routing/thread-delivery-route";
import {
  createHostedPhoneLookupKey,
} from "./contact-privacy";
import {
  resolveHostedMemberCoreByTelegramUserId,
} from "./hosted-member-routing-store";
import {
  isHostedMemberSuspended,
} from "./entitlement";
import { readHostedRuntimeAiAccessDecision } from "./member-access";
import {
  resolveHostedOnboardingLinqMessageContext,
} from "./webhook-provider-linq-shared";
import {
  assertHostedLinqRouteAuthorityMatchesTarget,
} from "./linq-egress-engagement";
import type {
  HostedWebhookWakeHandoff,
} from "./webhook-service-types";
import {
  reconcileHostedThreadContainerParticipants,
} from "../hosted-groups/group-tool";
import {
  lookupHostedGroupParticipantMemberIdByHandle,
} from "../hosted-groups/participant-member";
import {
  HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS,
} from "../hosted-groups/pending-group-setup";
import {
  reconcileHostedUsageReferralRewardAfterCommit,
} from "../hosted-growth/usage-referral";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  handleHostedGroupJoinOfferReaction,
} from "../hosted-groups/join-offer-reaction";
import {
  buildHostedLinqAffirmativeReactionMessageEvent,
  stageHostedLinqGroupReactionContext,
} from "./webhook-provider-linq-reaction-context";
import {
  stageHostedLinqGroupParticipantContextTx,
} from "./webhook-provider-linq-participant-context";
import {
  materializePendingHostedGroupJoinConfirmationsBestEffort,
} from "../hosted-groups/group-join-confirmation";
import type {
  HostedOnboardingLinqGroupRosterReconcile,
} from "./webhook-provider-linq-types";
import {
  createHostedPostCommitDeadline,
  readHostedPostCommitRemainingMs,
} from "./bounded-post-commit";
import { lockHostedMemberRow } from "./shared";

export {
  handleHostedStripeWebhook,
} from "./webhook-service-stripe";
export type {
  HostedStripeWebhookResponse,
} from "./webhook-service-types";

type HostedWebhookPostResponseScheduler = (task: () => Promise<void>) => void;
type HostedLinqCurrentInboundReplyProof = {
  chatId: string | null;
  messageId: string | null;
};

const HOSTED_LINQ_CHAT_CLASSIFICATION_TIMEOUT_MS = 1_500;

export async function handleHostedOnboardingLinqWebhook(input: {
  rawBody: string;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
  signature: string | null;
  timestamp: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingLinqWebhookResponse> {
  const timing = startHostedOnboardingTiming("hosted-onboarding.webhook.linq", {
    rawBodyBytes: new TextEncoder().encode(input.rawBody).byteLength,
    signalAbortedAtStart: input.signal?.aborted ?? false,
    signaturePresent: Boolean(input.signature),
    timestampPresent: Boolean(input.timestamp),
  });
  let eventId: string | null = null;
  let eventType: string | null = null;
  let eventWebhookVersion: string | null = null;
  let messagePartsInspection: HostedLinqMessageReceivedPartsInspection | null = null;
  let responseReason: string | null = null;
  let instantStartTypingHint: HostedLinqInstantStartTypingHint | null = null;
  let pendingInstantStartActivationWake: {
    continuation: HostedLinqInstantStartDeferredActivationWake;
    prisma: PrismaClient;
  } | null = null;
  const runPendingInstantStartActivationWake = async (): Promise<void> => {
    const pending = pendingInstantStartActivationWake;
    pendingInstantStartActivationWake = null;
    if (!pending) {
      return;
    }
    await runHostedLinqInstantStartDeferredActivationWakeBestEffort(pending);
  };

  try {
    const verifyTiming = startHostedOnboardingTiming(
      "hosted-onboarding.webhook.linq.verify-request",
      {
        signaturePresent: Boolean(input.signature),
        timestampPresent: Boolean(input.timestamp),
      },
    );
    let event = verifyAndParseHostedLinqWebhookRequest({
      rawBody: input.rawBody,
      signature: input.signature,
      timestamp: input.timestamp,
    });
    eventId = event.event_id;
    eventType = event.event_type;
    eventWebhookVersion = event.webhook_version ?? null;
    messagePartsInspection = inspectHostedLinqMessageReceivedParts(event);
    let affirmativeReaction = false;
    finishHostedOnboardingTiming(verifyTiming, "completed", {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      eventType,
      signalAbortedAfterVerify: input.signal?.aborted ?? false,
    });

    if (event.event_type === "chat.typing_indicator.started") {
      scheduleHostedLinqTypingShellPrewarmBestEffort({
        event: requireHostedLinqTypingIndicatorStartedEvent(event),
        prisma: input.prisma,
        scheduleAfterResponse: input.scheduleAfterResponse,
      });
      const response: HostedOnboardingLinqWebhookResponse = {
        ignored: true,
        ok: true,
        reason: "typing-ignored",
      };
      responseReason = response.reason ?? null;
      finishHostedOnboardingTiming(timing, "completed", {
        eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
        eventType,
        responseReason,
        signalAbortedBeforeReturn: input.signal?.aborted ?? false,
      });
      return response;
    }

    let providerEvent = parseHostedLinqProviderEvent({
      event,
      rawBody: input.rawBody,
    });
    if (messagePartsInspection?.compatibilityFallback) {
      logHostedLinqMessageReceivedPartsWarning({
        eventId,
        inspection: messagePartsInspection,
        outcome: "compatibility-accepted",
        webhookVersion: event.webhook_version,
      });
    }
    if (
      providerEvent
      && (event.event_type === "reaction.added" || event.event_type === "reaction.removed")
    ) {
      const prisma = input.prisma ?? getPrisma();
      const providerResult = await ingestHostedLinqProviderEventDirect({
        event: providerEvent,
        prisma,
        scheduleAfterResponse: input.scheduleAfterResponse,
      });
      if (providerResult.groupJoinOfferHandled) {
        const response: HostedOnboardingLinqWebhookResponse = {
          duplicate: true,
          ignored: true,
          ok: true,
          reason: "duplicate-linq-group-join-offer-reaction",
        };
        responseReason = response.reason ?? null;
        finishHostedOnboardingTiming(timing, "completed", {
          duplicate: true,
          eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
          eventType,
          responseReason,
        });
        return response;
      }
      const reactionResult = await handleHostedGroupJoinOfferReaction({
        event: providerEvent,
        prisma,
        signal: input.signal,
      });
      // Every terminal outcome for a proven canonical join offer is consumed
      // here. Falling through would turn a decided reaction into ordinary group
      // runtime work.
      if (
        reactionResult.status === "accepted"
        || reactionResult.reason === "already_group_member"
        || reactionResult.reason === "member_suspended"
        || reactionResult.reason === "recipient_region_unsupported"
      ) {
        const response: HostedOnboardingLinqWebhookResponse = {
          duplicate: providerResult.duplicate || undefined,
          ignored: reactionResult.status !== "accepted",
          ok: true,
          reason: reactionResult.status === "accepted"
            ? "accepted-linq-group-join-offer-reaction"
            : reactionResult.reason === "member_suspended"
              ? "ignored-linq-group-join-offer-member-suspended"
              : reactionResult.reason === "already_group_member"
                ? "ignored-linq-group-join-offer-already-member"
                : "ignored-linq-group-join-offer-region-unsupported",
        };
        responseReason = response.reason ?? null;
        finishHostedOnboardingTiming(timing, "completed", {
          duplicate: providerResult.duplicate,
          eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
          eventType,
          responseReason,
        });
        return response;
      }

      const messageEvent = await buildHostedLinqAffirmativeReactionMessageEvent({
        event: providerEvent,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (messageEvent) {
        event = messageEvent;
        affirmativeReaction = true;
        providerEvent = null;
      } else {
        const contextStaged = providerResult.duplicate
          ? false
          : await stageHostedLinqGroupReactionContext({
              event: providerEvent,
              prisma,
              ...(input.signal ? { signal: input.signal } : {}),
            });
        const response: HostedOnboardingLinqWebhookResponse = {
          duplicate: providerResult.duplicate || undefined,
          ignored: !contextStaged,
          ok: true,
          reason: contextStaged
            ? "staged-linq-group-reaction-context"
            : `skipped-linq-group-join-offer-reaction:${reactionResult.reason}`,
        };
        responseReason = response.reason ?? null;
        finishHostedOnboardingTiming(timing, "completed", {
          duplicate: providerResult.duplicate,
          eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
          eventType,
          responseReason,
        });
        return response;
      }
    }
    if (
      providerEvent
      && event.event_type !== "message.received"
      && event.event_type !== "message.edited"
    ) {
      const prisma = input.prisma ?? getPrisma();
      const providerResult = event.event_type === "participant.added"
        || event.event_type === "participant.removed"
        ? await ingestHostedLinqParticipantEventDirect({
            event: providerEvent,
            participantChange: requireHostedLinqParticipantChangedEvent(event),
            prisma,
          })
        : await ingestHostedLinqProviderEventDirect({
            event: providerEvent,
            prisma,
            scheduleAfterResponse: input.scheduleAfterResponse,
          });
      await scheduleHostedLinqProviderAlertEmails({
        alertIds: providerResult.alertIds,
        prisma,
        scheduleAfterResponse: input.scheduleAfterResponse,
      });
      const response: HostedOnboardingLinqWebhookResponse = {
        duplicate: providerResult.duplicate || undefined,
        ignored: true,
        ok: true,
        reason: providerResult.duplicate
          ? "duplicate-linq-provider-event"
          : `recorded-linq-provider-event:${providerEvent.eventType}`,
      };
      responseReason = response.reason ?? null;
      finishHostedOnboardingTiming(timing, "completed", {
        alertCount: providerResult.alertIds.length,
        duplicate: providerResult.duplicate,
        eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
        eventType,
        ...(providerEvent.eventType === "chat.group_icon_updated"
          || providerEvent.eventType === "chat.group_icon_update_failed"
            ? {
                chatIdSuffix: toHostedOnboardingLogIdSuffix(providerEvent.linqChatId),
                failureCode: providerEvent.failureCode,
                providerStatus: providerEvent.providerStatus,
              }
            : {}),
        responseReason,
      });
      return response;
    }

    input.signal?.throwIfAborted();
    const prisma = input.prisma ?? getPrisma();
    if (event.event_type === "message.edited") {
      const editedEvent = requireHostedLinqMessageEditedEvent(event);
      const planTiming = startHostedOnboardingTiming(
        "hosted-onboarding.webhook.linq.plan-message-edit",
        {
          eventIdSuffix: toHostedOnboardingLogIdSuffix(event.event_id),
          eventType: event.event_type,
        },
      );
      let editPlan: Awaited<ReturnType<typeof planHostedLinqMessageEditedWebhook>>;
      try {
        editPlan = await runHostedOnboardingWebhookTransaction(
          prisma,
          (transaction) =>
            planHostedLinqMessageEditedWebhook({
              event: editedEvent,
              prisma: transaction,
            }),
        );
      } catch (error) {
        finishHostedOnboardingTiming(planTiming, "failed", {
          errorName: deriveHostedOnboardingTimingErrorName(error),
        });
        throw error;
      }
      finishHostedOnboardingTiming(
        planTiming,
        editPlan.response.reason ?? "completed",
        {
          duplicate: Boolean(editPlan.response.duplicate),
          ok: editPlan.response.ok,
          wakeUserPresent: Boolean(
            editPlan.wakeHandoffs?.some((handoff) => handoff.userId),
          ),
        },
      );

      scheduleHostedLinqProviderEventIngestionBestEffort({
        event: providerEvent,
        prisma,
        scheduleAfterResponse: input.scheduleAfterResponse,
      });
      const wakeHandoff = editPlan.wakeHandoffs?.[0];
      const wakeHandoffResult = await maybeHandoffHostedExecutionWebhookWake({
        response: editPlan.response,
        scheduleAfterResponse: input.scheduleAfterResponse,
        signal: input.signal,
        wakeHandoff,
      });
      responseReason = editPlan.response.reason ?? null;
      finishHostedOnboardingTiming(timing, "completed", {
        duplicate: Boolean(editPlan.response.duplicate),
        eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
        eventType,
        responseReason,
        signalAbortedBeforeReturn: input.signal?.aborted ?? false,
        wakeHandoffReason: wakeHandoffResult?.reason ?? null,
        wakeHandoffSignalAccepted: wakeHandoffResult?.signalAccepted ?? false,
        wakeHandoffStarted: wakeHandoffResult?.started ?? false,
      });
      return editPlan.response;
    }

    const planningResolution = await resolveHostedLinqPlanningEvent({
      event,
      prisma,
      signal: input.signal,
    });
    const planningEvent = planningResolution.event;

    const currentInboundReply: HostedLinqCurrentInboundReplyProof | null =
      event.event_type === "message.received" && !affirmativeReaction
        ? buildHostedLinqCurrentInboundReplyProof(event)
        : null;

    const planTiming = startHostedOnboardingTiming(
      "hosted-onboarding.webhook.linq.plan",
      {
        eventIdSuffix: toHostedOnboardingLogIdSuffix(event.event_id),
        eventType: event.event_type,
      },
    );
    let plan: Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>;
    const firstContactAdmissionMode = readHostedLinqFirstContactAdmissionMode();
    const requireFirstContactAdmission = firstContactAdmissionMode === "enforce";
    let firstContactAdmissionClassified = false;
    try {
      const shouldReuseRecordedFirstContactAdmission =
        planningEvent.event_type === "message.received"
        && (
          requireFirstContactAdmission
          || isHostedLinqInstantStartEventCandidate({
            event: requireHostedLinqMessageReceivedEvent(planningEvent),
            phonePrefixes:
              getHostedOnboardingEnvironment().linqInstantStartPhonePrefixes,
          })
        );
      let firstContactAdmissionDecision: HostedLinqFirstContactAdmissionDecision | null =
        shouldReuseRecordedFirstContactAdmission
          ? await readRecordedHostedLinqFirstContactAdmissionDecision({
              eventId: event.event_id,
              prisma,
            })
          : null;
      const runPlan = (instantStartAllowed = true) =>
        runHostedThreadRoutingPreparedTransaction({
          plan: ({ preparation, transaction }) =>
            planHostedOnboardingLinqWebhook({
              affirmativeReaction,
              event: planningEvent,
              firstContactAdmissionDecision,
              instantStartAllowed,
              pendingGroupParticipantMemberIds:
                planningResolution.pendingGroupParticipantMemberIds ?? null,
              pendingGroupRosterUnavailable:
                planningResolution.pendingGroupRosterUnavailable ?? false,
              ...(preparation.preparedThreadContainerCreation
                ? {
                    preparedThreadContainerCreation:
                      preparation.preparedThreadContainerCreation,
                  }
                : {}),
              ...(preparation.preparedThreadDeliveryRoute
                ? {
                    preparedThreadDeliveryRoute:
                      preparation.preparedThreadDeliveryRoute,
                  }
                : {}),
              requireFirstContactAdmission,
              prisma: transaction,
            }),
          prepare: ({ attempt }) =>
            prepareHostedLinqThreadRoutingCrypto({
              event: planningEvent,
              participantMemberIds:
                planningResolution.pendingGroupParticipantMemberIds ?? [],
              pendingGroupRosterUnavailable:
                planningResolution.pendingGroupRosterUnavailable ?? false,
              prisma,
              // The resolver already performed the first authority read. A
              // route-conflict retry must read again so it can prepare for the
              // winning container instead of reusing a stale snapshot.
              threadRoute: attempt === 0
                ? planningResolution.threadRoute
                : undefined,
            }),
          prisma,
        });
      const planAfterBlockedAdmission = (reason?: string) =>
        requireFirstContactAdmission
          ? Promise.resolve(buildBlockedHostedLinqFirstContactAdmissionPlan(reason))
          : runPlan(false);

      if (firstContactAdmissionDecision?.kind === "block") {
        plan = await planAfterBlockedAdmission();
      } else {
        plan = await runPlan();
      }


      if (plan.firstContactAdmissionRequest) {
        const firstContactAdmissionRequest = plan.firstContactAdmissionRequest;
        // Resolve deterministic blocks (no OpenAI call) before claiming the
        // per-contact budget so unsupported/textless events cannot exhaust the
        // classifier-attempt cap.
        const deterministicDecision = tryHostedLinqFirstContactAdmissionDeterministicDecision(
          firstContactAdmissionRequest,
        );
        if (deterministicDecision) {
          firstContactAdmissionDecision =
            await recordHostedLinqFirstContactAdmissionDecision({
              decision: deterministicDecision,
              eventId: event.event_id,
              prisma,
            });
          plan = firstContactAdmissionDecision.kind === "block"
            ? await planAfterBlockedAdmission()
            : await runPlan();
        } else {
          const firstContactAdmissionParticipantContact = plan.firstContactAdmissionParticipantContact;
          if (!firstContactAdmissionParticipantContact) {
            throw new Error(
              "Hosted Linq first-contact admission plan missing participant contact for budget claim.",
            );
          }
          const admissionBudget = await runHostedOnboardingWebhookTransaction(
            prisma,
            (transaction) =>
              claimHostedLinqFirstContactAdmissionBudget({
                eventId: event.event_id,
                participantContact: firstContactAdmissionParticipantContact,
                tx: transaction,
              }),
          );
          if (admissionBudget.kind === "already_allowed") {
            // This contact cleared admission on an earlier event, so this one
            // is planned on that allow: no attempt is spent and the classifier
            // is not asked to re-decide a sender already admitted. The allow
            // stays owned by the event that earned it and is never written
            // under this event id, and instant start is off here: only a
            // classification of this exact inbound may mint that entitlement.
            firstContactAdmissionDecision = admissionBudget.decision;
            plan = await runPlan(false);
          } else if (admissionBudget.kind === "exhausted") {
            plan = await planAfterBlockedAdmission(
              "first-contact-admission-budget-exhausted",
            );
          } else {
            let classifiedAdmission: Awaited<ReturnType<typeof classifyHostedLinqFirstContactAdmission>>;
            try {
              classifiedAdmission = await classifyHostedLinqFirstContactAdmission({
                request: firstContactAdmissionRequest,
                signal: input.signal,
              });
            } catch (error) {
              if (!isHostedLinqFirstContactAdmissionClassifierUnavailableError(error)) {
                throw error;
              }
              classifiedAdmission = buildHostedLinqFirstContactAdmissionClassifierUnavailableDecision();
            }
            firstContactAdmissionClassified = true;

            firstContactAdmissionDecision =
              await recordHostedLinqFirstContactAdmissionDecision({
                decision: classifiedAdmission,
                eventId: event.event_id,
                prisma,
              });
            if (firstContactAdmissionDecision.kind === "block") {
              plan = await planAfterBlockedAdmission();
            } else {
              plan = await runPlan();
            }
          }
        }
      }

      if (plan.firstContactAdmissionRequest) {
        throw new Error("Hosted Linq first-contact admission remained unresolved after classification.");
      }

      if (plan.instantStartEnrollment) {
        const instantStartEnrollment = plan.instantStartEnrollment;
        // The member row is committed, so show feedback immediately while
        // enrollment and the cold runtime path continue. This hint carries no
        // authority and has no effect on the reply path.
        instantStartTypingHint = startHostedLinqInstantStartTypingHintBestEffort({
          event: planningEvent,
        });
        // The member row is committed, so issue only the deterministic
        // container start command while enrollment runs. This does not resolve
        // a runtime owner, inspect workspace state, create a fence, or process
        // mailbox work; the ordinary post-Temporal ensure owns those steps.
        void startHostedRuntimeShellPrewarmBestEffort({
          source: "linq-instant-start",
          userId: instantStartEnrollment.memberId,
        });
        let enrollmentFailed = false;
        try {
          const enrollment = await ensureHostedLinqInstantStartPulseTrialEnrollment({
            admissionEventId: instantStartEnrollment.admissionEventId,
            inviteCode: instantStartEnrollment.inviteCode,
            memberId: instantStartEnrollment.memberId,
            prisma,
          });
          if (enrollment.deferredActivationWake) {
            pendingInstantStartActivationWake = {
              continuation: enrollment.deferredActivationWake,
              prisma,
            };
          }
        } catch (error) {
          if (
            input.signal?.aborted
            || (
              isHostedOnboardingError(error)
              && error.retryable
            )
          ) {
            throw error;
          }
          enrollmentFailed = true;
          logHostedOnboardingDiagnostic(
            "hosted-onboarding.webhook.linq.instant-start-fallback",
            {
              errorName: deriveHostedOnboardingTimingErrorName(error),
              eventIdSuffix: toHostedOnboardingLogIdSuffix(event.event_id),
            },
          );
        }
        plan = await runPlan(!enrollmentFailed);
        if (plan.instantStartEnrollment) {
          logHostedOnboardingDiagnostic(
            "hosted-onboarding.webhook.linq.instant-start-not-active",
            {
              eventIdSuffix: toHostedOnboardingLogIdSuffix(event.event_id),
            },
          );
          plan = await runPlan(false);
        }
      }

      if (plan.instantStartEnrollment) {
        throw new Error(
          "Hosted Linq instant-start enrollment remained unresolved after fallback.",
        );
      }
    } catch (error) {
      // A recognized home-route owner whose permanent route no longer matches
      // the fallback binding would otherwise retry this rollback forever and
      // never hear anything back. Answer them on the chat they used instead.
      const recoveredPlan =
        isHostedOnboardingError(error)
        && error.code === "HOSTED_LINQ_HOME_ROUTE_CHANGED"
          ? await planHostedLinqPermanentHomeRouteRecovery({ event, prisma })
          : null;
      if (!recoveredPlan) {
        finishHostedOnboardingTiming(planTiming, "failed", {
          errorName: deriveHostedOnboardingTimingErrorName(error),
        });
        throw error;
      }
      plan = recoveredPlan;
    }
    finishHostedOnboardingTiming(planTiming, plan.response.reason ?? "completed", {
      desiredSideEffectCount: plan.desiredSideEffects.length,
      duplicate: Boolean(plan.response.duplicate),
      firstContactAdmissionClassified,
      firstContactAdmissionMode,
      ok: plan.response.ok,
      wakeUserPresent: Boolean(plan.wakeHandoffs?.some((handoff) => handoff.userId)),
    });

    await reconcileHostedLinqGroupRostersAfterCommitBestEffort({
      reconciles: plan.postCommitGroupRosterReconciles ?? [],
      requestLocalRoster: planningResolution.requestLocalGroupRoster,
      scheduleAfterResponse: input.scheduleAfterResponse,
    });
    await reconcileHostedUsageReferralRewardsAfterCommitBestEffort({
      prisma,
      referralIds: plan.postCommitUsageReferralIds ?? [],
      scheduleAfterResponse: input.scheduleAfterResponse,
    });

    if (plan.desiredSideEffects.length > 0) {
      const drainResult = await drainHostedLinqSideEffectsDirect({
        prisma,
        scheduleAfterResponse: input.scheduleAfterResponse,
        sideEffects: plan.desiredSideEffects,
        signal: input.signal,
      });
      const pendingRequiredDelivery = drainResult.skipped.find(
        (skip) =>
          (
            skip.template === "invite_signup"
            || skip.template === "invite_signup_fallback"
            || skip.template === HOSTED_LINQ_GROUP_SETUP_TEMPLATE
            || skip.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
          )
          && skip.reason === "notice_in_flight",
      );
      if (pendingRequiredDelivery) {
        const groupLineRecoveryInFlight =
          pendingRequiredDelivery.template
            === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE;
        const groupSetupInFlight = pendingRequiredDelivery.template
          === HOSTED_LINQ_GROUP_SETUP_TEMPLATE;
        throw hostedOnboardingError({
          code: groupSetupInFlight
            ? "HOSTED_LINQ_GROUP_SETUP_DELIVERY_IN_FLIGHT"
            : groupLineRecoveryInFlight
              ? "HOSTED_LINQ_GROUP_LINE_RECOVERY_IN_FLIGHT"
              : "HOSTED_LINQ_SIGNUP_DELIVERY_IN_FLIGHT",
          httpStatus: 503,
          message: groupSetupInFlight
            ? "The group setup message is still recovering. Retry this webhook after the current delivery attempt expires."
            : groupLineRecoveryInFlight
              ? "The group line recovery message is still recovering. Retry this webhook after the current delivery attempt expires."
              : "The signup link is still recovering. Retry this webhook after the current delivery attempt expires.",
          retryable: true,
        });
      }
      const decidedUnsentGroupLineRecovery = drainResult.skipped.find(
        (skip) =>
          skip.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
          && (
            skip.reason === "effect_unresolved"
            || skip.reason === "notice_target_unauthorized"
          ),
      );
      if (decidedUnsentGroupLineRecovery && drainResult.sentCount === 0) {
        plan = {
          ...plan,
          desiredSideEffects: [],
          response: {
            ignored: true,
            ok: true,
            reason: "group-chat-line-unavailable",
          },
        };
      }
      const decidedUnsentSignup = drainResult.skipped.find(
        (skip) =>
          (
            skip.template === "invite_signup"
            || skip.template === "invite_signup_fallback"
          )
          && (
            skip.reason === "effect_unresolved"
            || skip.reason === "notice_already_claimed"
            || skip.reason === "notice_target_unauthorized"
          ),
      );
      if (decidedUnsentSignup && drainResult.sentCount === 0) {
        plan = {
          ...plan,
          desiredSideEffects: [],
          response: {
            ...(decidedUnsentSignup.reason === "notice_already_claimed"
              ? { duplicate: true }
              : { ignored: true }),
            ok: true,
            reason: decidedUnsentSignup.reason === "effect_unresolved"
              ? "signup-link-attempts-exhausted"
              : decidedUnsentSignup.reason === "notice_already_claimed"
                ? "signup-link-already-sent"
                : "signup-link-target-unavailable",
          },
        };
      }
    }

    scheduleHostedLinqProviderEventIngestionBestEffort({
      event: providerEvent,
      prisma,
      scheduleAfterResponse: input.scheduleAfterResponse,
    });

    responseReason = plan.response.reason ?? null;
    const wakeHandoff = plan.wakeHandoffs?.[0];
    const confirmationDeadlineMs = createHostedPostCommitDeadline(undefined);
    const wakeHandoffResult = await (async () => {
      try {
        return await maybeHandoffHostedExecutionWebhookWake({
          response: plan.response,
          scheduleAfterResponse: input.scheduleAfterResponse,
          signal: input.signal,
          timeoutMs: readHostedPostCommitRemainingMs(confirmationDeadlineMs),
          wakeHandoff,
        });
      } finally {
        await reconcileHostedGroupJoinConfirmationsAfterCommitBestEffort({
          deadlineMs: confirmationDeadlineMs,
          memberIds: plan.postCommitGroupJoinConfirmationMemberIds ?? [],
          prisma,
          scheduleAfterResponse: input.scheduleAfterResponse,
          signal: input.scheduleAfterResponse ? undefined : input.signal,
        });
      }
    })();
    // The ordinary conversation signal, when present, reconciles both its
    // foreground lane and the activation item committed by enrollment. After
    // that handoff settles, run the original activation continuation, which
    // also owns pending group-join confirmation reconciliation.
    await runPendingInstantStartActivationWake();
    const sendReadReceipt = () => maybeSendHostedLinqIngressReadReceipt({
      currentInboundReply,
      plan,
      prisma,
      signal: input.signal,
      wakeHandoff,
      wakeHandoffResult,
    });
    if (input.scheduleAfterResponse) {
      input.scheduleAfterResponse(sendReadReceipt);
    } else {
      await sendReadReceipt();
    }

    finishHostedOnboardingTiming(timing, "completed", {
      duplicate: Boolean(plan.response.duplicate),
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      eventType,
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
      wakeHandoffReason: wakeHandoffResult?.reason ?? null,
      wakeHandoffSignalAccepted: wakeHandoffResult?.signalAccepted ?? false,
      wakeHandoffStarted: wakeHandoffResult?.started ?? false,
    });
    return plan.response;
  } catch (error) {
    if (
      messagePartsInspection
      && isHostedOnboardingError(error)
      && error.code === "LINQ_PAYLOAD_INVALID"
    ) {
      logHostedLinqMessageReceivedPartsWarning({
        errorCode: error.code,
        eventId,
        inspection: messagePartsInspection,
        outcome: "rejected",
        webhookVersion: eventWebhookVersion,
      });
    }
    // Activation is already durable even if replanning, delivery, or the
    // conversation wake failed. Fall back to its original best-effort signal
    // before propagating the error and asking the provider to retry.
    await runPendingInstantStartActivationWake();
    // A failing webhook is retried later with no visible continuation until
    // then, so clear any started typing hint instead of letting its promise
    // decay into silence.
    stopHostedLinqInstantStartTypingHintBestEffort({
      hint: instantStartTypingHint,
      scheduleAfterResponse: input.scheduleAfterResponse,
    });
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      eventType,
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
    });
    throw error;
  }
}

function logHostedLinqMessageReceivedPartsWarning(input: {
  errorCode?: string;
  eventId: string | null;
  inspection: HostedLinqMessageReceivedPartsInspection;
  outcome: "compatibility-accepted" | "rejected";
  webhookVersion?: string | null;
}): void {
  logHostedOnboardingWarning(
    "hosted-onboarding.webhook.linq.message-parts",
    {
      compatibilityFallback: input.inspection.compatibilityFallback,
      dataKind: input.inspection.dataKind,
      errorCode: input.errorCode,
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
      messageKind: input.inspection.messageKind,
      nestedActionPresent: input.inspection.nestedActionPresent,
      outcome: input.outcome,
      partCount: input.inspection.partCount,
      partKinds: input.inspection.partKinds,
      partsKind: input.inspection.partsKind,
      partsLocation: input.inspection.partsLocation,
      payloadShape: input.inspection.payloadShape,
      topLevelActionPresent: input.inspection.topLevelActionPresent,
      unsupportedPartCount: input.inspection.unsupportedPartCount,
      webhookVersion: classifyHostedLinqWebhookVersion(input.webhookVersion),
    },
  );
}

function classifyHostedLinqWebhookVersion(
  value: string | null | undefined,
): "2025-01-01" | "2026-02-03" | "missing" | "other" {
  if (value === "2025-01-01" || value === "2026-02-03") {
    return value;
  }
  return value ? "other" : "missing";
}

function scheduleHostedLinqTypingShellPrewarmBestEffort(input: {
  event: ReturnType<typeof requireHostedLinqTypingIndicatorStartedEvent>;
  prisma?: PrismaClient;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
}): void {
  const task = async (): Promise<void> => {
    try {
      const memberId = await resolveHostedLinqTypingPrewarmMemberId({
        event: input.event,
        prisma: input.prisma ?? getPrisma(),
      });
      if (!memberId) {
        logHostedOnboardingDiagnostic(
          "linq-typing-shell-prewarm",
          { outcome: "target-not-found" },
        );
        return;
      }

      logHostedOnboardingDiagnostic(
        "linq-typing-shell-prewarm",
        { outcome: "target-resolved" },
      );
      await startHostedRuntimeShellPrewarmBestEffort({
        source: "linq-typing-started",
        userId: memberId,
      });
    } catch (error) {
      logHostedOnboardingDiagnostic(
        "linq-typing-shell-prewarm",
        {
          errorName: deriveHostedOnboardingTimingErrorName(error),
          outcome: "failed",
        },
      );
    }
  };

  if (input.scheduleAfterResponse) {
    try {
      input.scheduleAfterResponse(task);
      return;
    } catch (error) {
      logHostedOnboardingDiagnostic(
        "linq-typing-shell-prewarm",
        {
          errorName: deriveHostedOnboardingTimingErrorName(error),
          outcome: "schedule-failed",
        },
      );
    }
  }

  void task();
}

interface HostedLinqPlanningEventResolution {
  event: Parameters<typeof requireHostedLinqMessageReceivedEvent>[0];
  pendingGroupParticipantMemberIds?: readonly string[];
  pendingGroupRosterUnavailable?: boolean;
  requestLocalGroupRoster?: {
    chatId: string;
    handles: readonly HostedLinqChatHandleSummary[];
  };
  /** The route the resolver already read, reused so warming costs no query. */
  threadRoute: HostedThreadRouteSnapshot | null;
}

async function resolveHostedLinqPlanningEvent(input: {
  event: Parameters<typeof requireHostedLinqMessageReceivedEvent>[0];
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedLinqPlanningEventResolution> {
  if (input.event.event_type !== "message.received") {
    return { event: input.event, threadRoute: null };
  }

  const messageEvent = requireHostedLinqMessageReceivedEvent(input.event);
  const webhookIsGroup = messageEvent.data.chat?.is_group;
  if (webhookIsGroup === true) {
    logHostedLinqChatClassification("webhook-group");
    const threadRoute = await readHostedThreadRouteByThreadIdentity({
      channel: "linq",
      prisma: input.prisma,
      threadId: messageEvent.data.chat_id,
    });
    const pendingGroupRoster =
      !messageEvent.data.is_from_me && !threadRoute
        ? await resolveHostedLinqPendingGroupParticipantMemberIds({
            chatId: messageEvent.data.chat_id,
            prisma: input.prisma,
            signal: input.signal,
          })
        : null;
    return {
      event: messageEvent,
      ...(pendingGroupRoster?.participantMemberIds == null
        ? {}
        : {
            pendingGroupParticipantMemberIds:
              pendingGroupRoster.participantMemberIds,
          }),
      ...(pendingGroupRoster?.unavailable === true
        ? { pendingGroupRosterUnavailable: true }
        : {}),
      ...(pendingGroupRoster?.handles == null
        ? {}
        : {
            requestLocalGroupRoster: {
              chatId: messageEvent.data.chat_id,
              handles: pendingGroupRoster.handles,
            },
          }),
      threadRoute,
    };
  }

  const threadRoute = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: messageEvent.data.chat_id,
  });
  if (messageEvent.data.is_from_me && !threadRoute) {
    if (webhookIsGroup === false) {
      logHostedLinqChatClassification("webhook-direct");
    }
    return { event: messageEvent, threadRoute };
  }

  let resolvedIsGroup: boolean;
  let canonicalHandles: readonly HostedLinqChatHandleSummary[] | null = null;
  if (threadRoute) {
    logHostedLinqChatClassification("thread-route-group");
    resolvedIsGroup = true;
  } else {
    let canonicalIsGroup: boolean | null;
    try {
      const summary = await getHostedLinqChatSummary({
        chatId: messageEvent.data.chat_id,
        timeoutMs: HOSTED_LINQ_CHAT_CLASSIFICATION_TIMEOUT_MS,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      canonicalIsGroup = summary.isGroup;
      canonicalHandles = summary.handles;
    } catch (error) {
      logHostedLinqChatClassification("canonical-unavailable");
      if (input.signal?.aborted) {
        throw error;
      }
      throw hostedOnboardingError({
        cause: error,
        code: "LINQ_CHAT_CLASSIFICATION_UNAVAILABLE",
        httpStatus: 502,
        message: "Linq chat classification is unavailable.",
        retryable: true,
      });
    }

    if (canonicalIsGroup === null) {
      logHostedLinqChatClassification("canonical-unavailable");
      throw hostedOnboardingError({
        code: "LINQ_CHAT_CLASSIFICATION_UNAVAILABLE",
        httpStatus: 502,
        message: "Linq chat classification is unavailable.",
        retryable: true,
      });
    }

    logHostedLinqChatClassification(canonicalIsGroup ? "canonical-group" : "canonical-direct");
    resolvedIsGroup = canonicalIsGroup;
  }

  const pendingGroupRoster =
    resolvedIsGroup && !threadRoute
      ? await resolveHostedLinqPendingGroupParticipantMemberIds({
          chatId: messageEvent.data.chat_id,
          handles: canonicalHandles,
          prisma: input.prisma,
          signal: input.signal,
        })
      : null;
  return {
    event: {
      ...messageEvent,
      data: {
        ...messageEvent.data,
        chat: {
          id: messageEvent.data.chat_id,
          ...(messageEvent.data.chat ?? {}),
          is_group: resolvedIsGroup,
        },
      },
    },
    ...(pendingGroupRoster?.participantMemberIds == null
      ? {}
      : {
          pendingGroupParticipantMemberIds:
            pendingGroupRoster.participantMemberIds,
        }),
    ...(pendingGroupRoster?.unavailable === true
      ? { pendingGroupRosterUnavailable: true }
      : {}),
    ...(pendingGroupRoster?.handles == null
      ? {}
      : {
          requestLocalGroupRoster: {
            chatId: messageEvent.data.chat_id,
            handles: pendingGroupRoster.handles,
          },
        }),
    threadRoute,
  };
}

async function resolveHostedLinqPendingGroupParticipantMemberIds(input: {
  chatId: string;
  handles?: readonly HostedLinqChatHandleSummary[] | null;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<{
  handles: readonly HostedLinqChatHandleSummary[] | null;
  participantMemberIds: string[] | null;
  unavailable: boolean;
}> {
  try {
    const summary = input.handles
      ? null
      : await getHostedLinqChatSummary({
          chatId: input.chatId,
          timeoutMs: HOSTED_LINQ_CHAT_CLASSIFICATION_TIMEOUT_MS,
          ...(input.signal ? { signal: input.signal } : {}),
        });
    if (summary?.isGroup === false) {
      logHostedLinqPendingGroupRoster("provider_not_group");
      return {
        handles: null,
        participantMemberIds: null,
        unavailable: false,
      };
    }
    const handles = input.handles ?? summary?.handles ?? [];
    if (handles.length === 0) {
      logHostedLinqPendingGroupRoster("empty_roster");
      return {
        handles,
        participantMemberIds: null,
        unavailable: false,
      };
    }
    const participantHandles = [...new Set(handles.flatMap((handle) => {
      const value = handle.handle.trim();
      const status = handle.status?.trim().toLowerCase() ?? null;
      return !value
          || handle.isMe
          || (status !== null && status !== "active")
        ? []
        : [value];
    }))];
    if (
      participantHandles.length
        > HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS
    ) {
      logHostedLinqPendingGroupRoster("oversized_roster");
      return {
        handles,
        participantMemberIds: null,
        unavailable: false,
      };
    }
    const resolved = await Promise.all(participantHandles.map(async (handle) =>
      await lookupHostedGroupParticipantMemberIdByHandle({
        handle,
        prisma: input.prisma,
      })
    ));
    const memberIds = [...new Set(resolved.flatMap((memberId) =>
      memberId ? [memberId] : []
    ))];
    logHostedLinqPendingGroupRoster("resolved");
    return {
      handles,
      participantMemberIds: memberIds,
      unavailable: false,
    };
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    logHostedLinqPendingGroupRoster("unavailable");
    return {
      handles: null,
      participantMemberIds: null,
      unavailable: true,
    };
  }
}

function logHostedLinqPendingGroupRoster(
  outcome:
    | "empty_roster"
    | "oversized_roster"
    | "provider_not_group"
    | "resolved"
    | "unavailable",
): void {
  logHostedOnboardingDiagnostic(
    "hosted-onboarding.webhook.linq.pending-group-roster",
    { outcome },
  );
}

function logHostedLinqChatClassification(
  outcome:
    | "canonical-direct"
    | "canonical-group"
    | "canonical-unavailable"
    | "thread-route-group"
    | "webhook-direct"
    | "webhook-group",
): void {
  logHostedOnboardingDiagnostic("hosted-onboarding.webhook.linq.chat-classification", {
    outcome,
  });
}

const HOSTED_LINQ_INSTANT_START_TYPING_HINT_TIMEOUT_MS = 2_500;

type HostedLinqInstantStartTypingHint = {
  chatId: string;
  started: Promise<void>;
};

// Instant start is the sender's first-ever message and the reply waits on a
// cold runtime boot, so surface typing feedback immediately instead of leaving
// the chat silent until the runtime's own typing session starts. Losing the
// hint costs nothing; it must never affect webhook handling. The returned
// handle lets a failing webhook clear the indicator so the hint cannot promise
// a reply that no surviving continuation owns.
function startHostedLinqInstantStartTypingHintBestEffort(input: {
  event: Parameters<typeof requireHostedLinqMessageReceivedEvent>[0];
}): HostedLinqInstantStartTypingHint | null {
  try {
    const chatId =
      requireHostedLinqMessageReceivedEvent(input.event).data.chat_id?.trim() ?? "";
    if (chatId.length === 0) {
      return null;
    }
    const started = startHostedLinqChatTypingIndicator({
      chatId,
      timeoutMs: HOSTED_LINQ_INSTANT_START_TYPING_HINT_TIMEOUT_MS,
    })
      .then((result) => {
        if (!result.ok) {
          logHostedOnboardingDiagnostic(
            "hosted-onboarding.webhook.linq.instant-start-typing-hint-failed",
            { httpStatus: result.status },
          );
        }
      })
      .catch((error: unknown) => {
        logHostedOnboardingDiagnostic(
          "hosted-onboarding.webhook.linq.instant-start-typing-hint-failed",
          { errorName: deriveHostedOnboardingTimingErrorName(error) },
        );
      });
    return { chatId, started };
  } catch (error) {
    logHostedOnboardingDiagnostic(
      "hosted-onboarding.webhook.linq.instant-start-typing-hint-failed",
      { errorName: deriveHostedOnboardingTimingErrorName(error) },
    );
    return null;
  }
}

// Chains after the in-flight start settles so cancellation cannot race ahead
// of it, and never affects the webhook's own failure handling. The cleanup is
// registered with the request's post-response scheduler because the failing
// webhook's invocation may freeze right after the error response; a detached
// promise would not be guaranteed to run, leaving the typing promise dangling.
function stopHostedLinqInstantStartTypingHintBestEffort(input: {
  hint: HostedLinqInstantStartTypingHint | null;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
}): void {
  const hint = input.hint;
  if (!hint) {
    return;
  }
  const task = () => hint.started
    .then(() => stopHostedLinqChatTypingIndicator({
      chatId: hint.chatId,
      timeoutMs: HOSTED_LINQ_INSTANT_START_TYPING_HINT_TIMEOUT_MS,
    }))
    .then((result) => {
      if (!result.ok) {
        logHostedOnboardingDiagnostic(
          "hosted-onboarding.webhook.linq.instant-start-typing-hint-stop-failed",
          { httpStatus: result.status },
        );
      }
    })
    .catch((error: unknown) => {
      logHostedOnboardingDiagnostic(
        "hosted-onboarding.webhook.linq.instant-start-typing-hint-stop-failed",
        { errorName: deriveHostedOnboardingTimingErrorName(error) },
      );
    });

  try {
    if (input.scheduleAfterResponse) {
      input.scheduleAfterResponse(task);
      return;
    }
  } catch {
    // Fall through to the immediate best-effort path.
  }
  void task();
}

async function maybeSendHostedLinqIngressReadReceipt(input: {
  currentInboundReply: HostedLinqCurrentInboundReplyProof | null;
  plan: Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>;
  prisma: PrismaClient;
  signal?: AbortSignal;
  wakeHandoff?: HostedWebhookWakeHandoff;
  wakeHandoffResult: Awaited<ReturnType<typeof maybeHandoffHostedExecutionWebhookWake>>;
}): Promise<void> {
  const chatId = input.wakeHandoff?.linqChatId?.trim() ?? "";

  if (chatId.length === 0) {
    return;
  }

  const responseReason = input.plan.response.reason ?? null;
  const wakeHandoffReason = input.wakeHandoffResult?.reason ?? null;
  const wakeHandoffStarted = input.wakeHandoffResult?.started === true;
  const wakeHandoffSignalAccepted = input.wakeHandoffResult?.signalAccepted ?? false;
  const readReceiptTiming = startHostedOnboardingTiming(
    "hosted-onboarding.webhook.linq.ingress-read-receipt",
    {
      chatIdPresent: true,
      responseReason,
      wakeHandoffReason,
      wakeHandoffStarted,
      wakeHandoffSignalAccepted,
    },
  );

  if (!wakeHandoffStarted) {
    finishHostedOnboardingTiming(readReceiptTiming, "skipped-handoff-not-started", {
      responseReason,
      signalAbortedAfterReadReceipt: input.signal?.aborted ?? false,
      wakeHandoffReason,
      wakeHandoffStarted,
      wakeHandoffSignalAccepted,
    });
    return;
  }

  const routeAuthority = input.plan.linqReadReceiptRouteAuthority ?? null;
  const currentInboundChatMatches =
    normalizeHostedLinqReadReceiptChatId(chatId)
      === normalizeHostedLinqReadReceiptChatId(input.currentInboundReply?.chatId);
  if (routeAuthority && (routeAuthority.channel !== "linq" || routeAuthority.threadId !== chatId)) {
    finishHostedOnboardingTiming(readReceiptTiming, "skipped-route-authority-mismatch", {
      responseReason,
      signalAbortedAfterReadReceipt: input.signal?.aborted ?? false,
      wakeHandoffReason,
      wakeHandoffStarted,
      wakeHandoffSignalAccepted,
    });
    return;
  }

  try {
    if (routeAuthority) {
      await assertHostedThreadRouteEgressAuthority({
        authority: assertHostedLinqRouteAuthorityMatchesTarget({
          chatId,
          routeAuthority,
        }),
        prisma: input.prisma,
      });
    } else if (!currentInboundChatMatches) {
      finishHostedOnboardingTiming(readReceiptTiming, "skipped-missing-read-receipt-authority", {
        responseReason,
        signalAbortedAfterReadReceipt: input.signal?.aborted ?? false,
        wakeHandoffReason,
        wakeHandoffStarted,
        wakeHandoffSignalAccepted,
      });
      return;
    }

    const result = await sendHostedLinqReadReceipt({
      chatId,
      signal: input.signal,
    });

    finishHostedOnboardingTiming(readReceiptTiming, result.ok ? "sent" : "failed", {
      httpStatus: result.status,
      responseReason,
      signalAbortedAfterReadReceipt: input.signal?.aborted ?? false,
      wakeHandoffReason,
      wakeHandoffStarted,
      wakeHandoffSignalAccepted,
    });
  } catch (error) {
    finishHostedOnboardingTiming(readReceiptTiming, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      responseReason,
      signalAbortedAfterReadReceipt: input.signal?.aborted ?? false,
      wakeHandoffReason,
      wakeHandoffStarted,
      wakeHandoffSignalAccepted,
    });
  }
}

function normalizeHostedLinqReadReceiptChatId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function reconcileHostedLinqGroupRostersAfterCommitBestEffort(input: {
  reconciles: readonly HostedOnboardingLinqGroupRosterReconcile[];
  requestLocalRoster?: {
    chatId: string;
    handles: readonly HostedLinqChatHandleSummary[];
  };
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
}): Promise<void> {
  if (input.reconciles.length === 0) {
    return;
  }

  const run = async () => {
    for (const reconcile of input.reconciles) {
      try {
        await reconcileHostedThreadContainerParticipants({
          chatId: reconcile.chatId,
          containerMemberId: reconcile.containerMemberId,
          ...(input.requestLocalRoster?.chatId === reconcile.chatId
            ? { handles: input.requestLocalRoster.handles }
            : {}),
          prisma: getPrisma(),
        });
      } catch (error) {
        console.warn("Hosted Linq group roster post-commit reconcile failed.", {
          errorName: deriveHostedOnboardingTimingErrorName(error),
          chatIdSuffix: toHostedOnboardingLogIdSuffix(reconcile.chatId),
          containerMemberIdSuffix: toHostedOnboardingLogIdSuffix(reconcile.containerMemberId),
        });
      }
    }
  };

  if (input.scheduleAfterResponse) {
    input.scheduleAfterResponse(run);
    return;
  }

  await run();
}

async function reconcileHostedGroupJoinConfirmationsAfterCommitBestEffort(input: {
  deadlineMs?: number;
  memberIds: readonly string[];
  prisma: PrismaClient;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
  signal?: AbortSignal;
}): Promise<void> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) {
    return;
  }

  const run = async (deadlineMs: number) => {
    for (const memberId of memberIds) {
      await materializePendingHostedGroupJoinConfirmationsBestEffort({
        memberId,
        prisma: input.prisma,
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: readHostedPostCommitRemainingMs(deadlineMs),
      });
    }
  };

  if (input.scheduleAfterResponse) {
    input.scheduleAfterResponse(() => run(createHostedPostCommitDeadline(undefined)));
    return;
  }

  await run(input.deadlineMs ?? createHostedPostCommitDeadline(undefined));
}

function buildHostedLinqCurrentInboundReplyProof(
  event: Parameters<typeof requireHostedLinqMessageReceivedEvent>[0],
): HostedLinqCurrentInboundReplyProof {
  const messageEvent = requireHostedLinqMessageReceivedEvent(event);
  return {
    chatId: messageEvent.data.chat_id,
    messageId: messageEvent.data.message.id,
  };
}

async function ingestHostedLinqProviderEventDirect(input: {
  event: Parameters<typeof ingestHostedLinqProviderEventTx>[0]["event"];
  prisma: PrismaClient;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
}): Promise<Awaited<ReturnType<typeof ingestHostedLinqProviderEventTx>>> {
  const providerResult = await runHostedOnboardingWebhookTransaction(
    input.prisma,
    (transaction) => ingestHostedLinqProviderEventTx({
      event: input.event,
      prisma: transaction,
    }),
  );
  if (providerResult.restoreOnboardingLink) {
    void queueHostedLinqContactCardShareAfterDeliveredInviteSignup({
      chatId: providerResult.restoreOnboardingLink.linqChatId,
      memberId: providerResult.restoreOnboardingLink.memberId,
      prisma: input.prisma,
      scheduleAfterResponse: input.scheduleAfterResponse,
      service: providerResult.restoreOnboardingLink.service,
    });
  }
  return providerResult;
}

async function ingestHostedLinqParticipantEventDirect(input: {
  event: Parameters<typeof ingestHostedLinqProviderEventTx>[0]["event"];
  participantChange: ReturnType<typeof requireHostedLinqParticipantChangedEvent>;
  prisma: PrismaClient;
}): Promise<Awaited<ReturnType<typeof ingestHostedLinqProviderEventTx>>> {
  return runHostedOnboardingWebhookTransaction(
    input.prisma,
    async (transaction) => {
      const chatId = input.participantChange.data.chat_id;
      if (chatId) {
        await acquireHostedLinqChatOwnershipLockTx({
          chatId,
          tx: transaction,
        });
      }
      const providerResult = await ingestHostedLinqProviderEventTx({
        event: input.event,
        prisma: transaction,
      });
      if (providerResult.duplicate) {
        return providerResult;
      }

      if (!chatId) {
        return providerResult;
      }

      const route = await readHostedThreadRouteByThreadIdentity({
        channel: "linq",
        prisma: transaction,
        threadId: chatId,
      });
      if (!route) {
        return providerResult;
      }

      await applyHostedLinqParticipantChangeToRouteTx({
        event: input.participantChange,
        prisma: transaction,
        route,
      });
      return providerResult;
    },
  );
}

export async function applyHostedLinqParticipantChangeToRouteTx(input: {
  event: ReturnType<typeof requireHostedLinqParticipantChangedEvent>;
  prisma: Prisma.TransactionClient;
  route: HostedThreadRouteSnapshot;
}): Promise<void> {
  const chatId = input.event.data.chat_id;
  if (!chatId) {
    return;
  }
  await lockHostedMemberRow(input.prisma, input.route.owner.id);
  if (input.event.event_type === "participant.added") {
    await markHostedLinqThreadRouteParticipantAdditionPendingTx({
      containerMemberId: input.route.containerMemberId,
      prisma: input.prisma,
      threadId: chatId,
    });
  }
  await stageHostedLinqGroupParticipantContextTx(input);
}

function scheduleHostedLinqProviderEventIngestionBestEffort(input: {
  event: Parameters<typeof ingestHostedLinqProviderEventTx>[0]["event"] | null;
  prisma: PrismaClient;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
}): void {
  if (!input.event) {
    return;
  }

  const event = input.event;
  const ingestProviderEvent = async () => {
    try {
      const providerResult = await ingestHostedLinqProviderEventDirect({
        event,
        prisma: input.prisma,
      });
      await scheduleHostedLinqProviderAlertEmails({
        alertIds: providerResult.alertIds,
        prisma: input.prisma,
      });
    } catch (error) {
      console.warn("Hosted Linq provider event sidecar ingestion failed.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        eventIdSuffix: toHostedOnboardingLogIdSuffix(event.eventId),
        eventType: event.eventType,
      });
    }
  };

  if (input.scheduleAfterResponse) {
    input.scheduleAfterResponse(ingestProviderEvent);
  }
}

async function scheduleHostedLinqProviderAlertEmails(input: {
  alertIds: readonly string[];
  prisma: PrismaClient;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
}): Promise<void> {
  if (input.alertIds.length === 0) {
    return;
  }

  const sendAlerts = () => sendPendingHostedLinqAlertsBestEffort({
    alertIds: input.alertIds,
    prisma: input.prisma,
  });

  if (input.scheduleAfterResponse) {
    input.scheduleAfterResponse(sendAlerts);
    return;
  }

  await sendAlerts();
}

function buildBlockedHostedLinqFirstContactAdmissionPlan(
  reason: HostedOnboardingLinqWebhookResponse["reason"] = "blocked-first-contact-admission",
): Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>> {
  return {
    desiredSideEffects: [],
    response: {
      ignored: true,
      ok: true,
      reason,
    },
  };
}

export async function handleHostedOnboardingTelegramWebhook(input: {
  rawBody: string;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
  secretToken: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingTelegramWebhookResponse> {
  const prisma = input.prisma ?? getPrisma();

  assertHostedTelegramWebhookSecret(input.secretToken);

  const update = parseHostedTelegramWebhookUpdate(input.rawBody);

  // An inline-button tap grants membership or a disclosure directly, so it runs
  // outside the planning transaction: acceptance owns its own transactions and
  // post-commit work, exactly as the Linq reaction path does.
  if (update.callback_query) {
    const callbackResult = await handleHostedTelegramGroupOfferCallback({
      callbackQuery: update.callback_query,
      prisma,
      ...(input.scheduleAfterResponse
        ? { scheduleAfterResponse: input.scheduleAfterResponse }
        : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return {
      ok: true,
      ...(callbackResult.handled ? {} : { ignored: true }),
      reason: callbackResult.reason,
    };
  }

  const plan = await runHostedThreadRoutingPreparedTransaction({
    plan: ({ preparation, transaction }) =>
      planHostedOnboardingTelegramWebhook({
        ...(preparation.preparedSenderMemberId
          ? {
              preparedSenderMemberId:
                preparation.preparedSenderMemberId,
            }
          : {}),
        ...(preparation.preparedThreadContainerCreation
          ? {
              preparedThreadContainerCreation:
                preparation.preparedThreadContainerCreation,
            }
          : {}),
        ...(preparation.preparedThreadDeliveryRoute
          ? {
              preparedThreadDeliveryRoute:
                preparation.preparedThreadDeliveryRoute,
            }
          : {}),
        prisma: transaction,
        update,
      }),
    prepare: () => prepareHostedTelegramThreadRoutingCrypto({
      prisma,
      update,
    }),
    prisma,
  });

  if (plan.desiredSideEffects.length > 0) {
    throw new Error(
      "Hosted Telegram webhook planning unexpectedly queued local side effects.",
    );
  }

  const confirmationDeadlineMs = createHostedPostCommitDeadline(undefined);
  try {
    await maybeHandoffHostedExecutionWebhookWake({
      response: plan.response,
      scheduleAfterResponse: input.scheduleAfterResponse,
      signal: input.signal,
      timeoutMs: readHostedPostCommitRemainingMs(confirmationDeadlineMs),
      wakeHandoff: plan.wakeHandoffs?.[0],
    });
  } finally {
    await reconcileHostedGroupJoinConfirmationsAfterCommitBestEffort({
      deadlineMs: confirmationDeadlineMs,
      memberIds: plan.postCommitGroupJoinConfirmationMemberIds ?? [],
      prisma,
      scheduleAfterResponse: input.scheduleAfterResponse,
      signal: input.scheduleAfterResponse ? undefined : input.signal,
    });
    await reconcileHostedUsageReferralRewardsAfterCommitBestEffort({
      prisma,
      referralIds: plan.postCommitUsageReferralIds ?? [],
      scheduleAfterResponse: input.scheduleAfterResponse,
    });
  }
  return plan.response;
}

async function reconcileHostedUsageReferralRewardsAfterCommitBestEffort(input: {
  prisma: PrismaClient;
  referralIds: readonly string[];
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
}): Promise<void> {
  const referralIds = [...new Set(input.referralIds)];
  if (referralIds.length === 0) {
    return;
  }
  const reconcile = async () => {
    for (const referralId of referralIds) {
      try {
        const wake = await reconcileHostedUsageReferralRewardAfterCommit({
          prisma: input.prisma,
          referralId,
        });
        if (!wake) {
          continue;
        }
        await signalHostedMailboxAppendRuntime({
          expectedUserId: wake.userId,
          ...(wake.wakeMailboxCheckpoint
            ? {
                knownCheckpoint: {
                  ...wake.wakeMailboxCheckpoint,
                  userId: wake.userId,
                },
              }
            : {}),
          mailboxItemId: wake.mailboxItemId,
          prisma: input.prisma,
        });
      } catch (error) {
        logHostedOnboardingDiagnostic(
          "hosted-onboarding.usage-referral-reconcile-failed",
          {
            errorName: deriveHostedOnboardingTimingErrorName(error),
          },
        );
      }
    }
  };
  if (input.scheduleAfterResponse) {
    input.scheduleAfterResponse(reconcile);
    return;
  }
  await reconcile();
}

interface HostedThreadRoutingCryptoPreparation {
  preparedSenderMemberId?: string;
  preparedThreadContainerCreation?: PreparedHostedThreadContainerCreation;
  preparedThreadDeliveryRoute?: PreparedHostedThreadContainerDeliveryRoute;
}

async function prepareHostedLinqThreadRoutingCrypto(input: {
  event: Parameters<typeof requireHostedLinqMessageReceivedEvent>[0];
  participantMemberIds: readonly string[];
  pendingGroupRosterUnavailable: boolean;
  prisma: PrismaClient;
  threadRoute?: HostedThreadRouteSnapshot | null;
}): Promise<HostedThreadRoutingCryptoPreparation> {
  if (input.event.event_type !== "message.received") {
    return {};
  }
  const context = resolveHostedOnboardingLinqMessageContext(input.event);
  const accountLookupKey = createHostedPhoneLookupKey(
    context.recipientPhoneNumber,
  );

  const threadRoute = input.threadRoute === undefined
    ? await readHostedThreadRouteByThreadIdentity({
        channel: "linq",
        prisma: input.prisma,
        threadId: context.summary.chatId,
      })
    : input.threadRoute;
  if (threadRoute) {
    if (!accountLookupKey) {
      throw new TypeError(
        "Hosted Linq thread crypto preparation requires a recipient account lookup key.",
      );
    }
    const [preparedThreadDeliveryRoute] = await Promise.all([
      prepareHostedThreadContainerDeliveryRoute({
        accountLookupKey,
        channel: "linq",
        containerMemberId: threadRoute.containerMemberId,
        observedDeliveryRouteEncrypted:
          threadRoute.deliveryRouteState?.deliveryRouteEncrypted ?? null,
        prisma: input.prisma,
        threadId: context.summary.chatId,
      }),
      warmHostedLinqMailboxPayloadRoot({
        event: input.event,
        prisma: input.prisma,
        threadRoute,
      }),
    ]);
    return { preparedThreadDeliveryRoute };
  }

  if (context.messageEvent.data.chat?.is_group === true) {
    if (!await shouldPrepareHostedLinqThreadContainerCrypto({
      event: input.event,
      participantMemberIds: input.participantMemberIds,
      pendingGroupRosterUnavailable: input.pendingGroupRosterUnavailable,
      prisma: input.prisma,
    })) {
      return {};
    }
    if (!accountLookupKey) {
      return {};
    }
    return {
      preparedThreadContainerCreation:
        await prepareHostedThreadContainerCreation({
          accountLookupKey,
          channel: "linq",
          prisma: input.prisma,
          threadId: context.summary.chatId,
        }),
    };
  }

  if (!accountLookupKey) {
    throw new TypeError(
      "Hosted Linq thread crypto preparation requires a recipient account lookup key.",
    );
  }
  await warmHostedLinqMailboxPayloadRoot({
    event: input.event,
    prisma: input.prisma,
    threadRoute: null,
  });
  return {};
}

async function prepareHostedTelegramThreadRoutingCrypto(input: {
  prisma: PrismaClient;
  update: ReturnType<typeof parseHostedTelegramWebhookUpdate>;
}): Promise<HostedThreadRoutingCryptoPreparation> {
  const summary = await summarizeHostedTelegramWebhook(input.update);
  const message = buildHostedTelegramMessagePayload(input.update);
  if (
    !summary
    || summary.isBotMessage
    || summary.isDirect
    || !summary.senderTelegramUserId
    || !message
  ) {
    return {};
  }
  const memberLookup = await resolveHostedMemberCoreByTelegramUserId({
    prisma: input.prisma,
    telegramUserId: summary.senderTelegramUserId,
  });
  if (
    memberLookup.status !== "found"
  ) {
    return {};
  }
  const preparedSenderMemberId = memberLookup.core.id;
  if (isHostedMemberSuspended(memberLookup.core.suspendedAt)) {
    return { preparedSenderMemberId };
  }
  const access = await readHostedRuntimeAiAccessDecision({
    memberId: memberLookup.core.id,
    now: new Date(),
    prisma: input.prisma,
  });
  if (!access.allowed) {
    return { preparedSenderMemberId };
  }
  const threadRoute = await readHostedThreadRouteByThreadIdentity({
    channel: "telegram",
    prisma: input.prisma,
    threadId: message.threadId,
  });
  if (!threadRoute) {
    return {
      preparedSenderMemberId,
      preparedThreadContainerCreation:
        await prepareHostedThreadContainerCreation({
          accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
          channel: "telegram",
          prisma: input.prisma,
          threadId: message.threadId,
        }),
    };
  }

  const [preparedThreadDeliveryRoute] = await Promise.all([
    prepareHostedThreadContainerDeliveryRoute({
      accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
      channel: "telegram",
      containerMemberId: threadRoute.containerMemberId,
      observedDeliveryRouteEncrypted:
        threadRoute.deliveryRouteState?.deliveryRouteEncrypted ?? null,
      prisma: input.prisma,
      threadId: message.threadId,
    }),
    (async () => {
      const root = await unwrapHostedDomainRootForWeb({
        domain: getHostedCryptoDomainForLane("mailbox-payload"),
        prisma: input.prisma,
        retainFailureInScopedCache: true,
        userId: threadRoute.containerMemberId,
      });
      root.rootKey.fill(0);
    })(),
  ]);
  return { preparedSenderMemberId, preparedThreadDeliveryRoute };
}

const HOSTED_THREAD_ROUTING_PREPARATION_REQUIRED_CODES = new Set([
  "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
  "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
]);

const HOSTED_THREAD_ROUTING_PREPARATION_RETRY_CODES = new Set([
  ...HOSTED_THREAD_ROUTING_PREPARATION_REQUIRED_CODES,
  "HOSTED_THREAD_ROUTE_WRITE_CONFLICT",
]);

async function runHostedThreadRoutingPreparedTransaction<TResult>(input: {
  plan: (input: {
    preparation: HostedThreadRoutingCryptoPreparation;
    transaction: Prisma.TransactionClient;
  }) => Promise<TResult>;
  prepare: (input: {
    attempt: number;
  }) => Promise<HostedThreadRoutingCryptoPreparation>;
  prisma: PrismaClient;
}): Promise<TResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let preparation: HostedThreadRoutingCryptoPreparation = {};
    const preparationFailures: unknown[] = [];
    try {
      return await runHostedOnboardingWebhookTransaction(
        input.prisma,
        (transaction) => input.plan({ preparation, transaction }),
        async () => {
          try {
            preparation = await input.prepare({ attempt });
          } catch (error) {
            preparationFailures.push(error);
            throw error;
          }
        },
      );
    } catch (error) {
      if (
        preparationFailures.length > 0
        && isHostedOnboardingError(error)
        && HOSTED_THREAD_ROUTING_PREPARATION_REQUIRED_CODES.has(error.code)
      ) {
        // The transaction helper deliberately suppresses an irrelevant warm
        // failure so ignored branches can still complete. If the planner then
        // proves that this exact package was required, preserve the original
        // provider/KMS failure instead of misclassifying it as a route race and
        // repeating slow external work inside the same webhook response window.
        throw preparationFailures[0];
      }
      if (
        attempt === 0
        && isHostedOnboardingError(error)
        && HOSTED_THREAD_ROUTING_PREPARATION_RETRY_CODES.has(error.code)
      ) {
        logHostedOnboardingDiagnostic(
          "hosted-onboarding.webhook.thread-routing-preparation-retry",
          { code: error.code },
        );
        continue;
      }
      throw error;
    }
  }
  throw new Error("Hosted thread routing preparation retry exhausted unexpectedly.");
}

/**
 * Unwrapping the ingress root reads an envelope and then calls KMS. Doing that
 * first inside the planning transaction holds a pooled connection across a
 * network round trip, which is what lets a slow KMS extend both connection
 * occupancy and inbound serialization. The unwrap cache is already request
 * scoped around this transaction, so unwrapping beforehand leaves the
 * in-transaction encrypt as local AES work against the cached root.
 *
 * An established group reuses the planning-event route. A direct message uses
 * a narrow blind-index/member-id preflight that mirrors planner precedence
 * without decrypting private identity or routing fields. Both remain hints:
 * the planner repeats every authority check inside the transaction.
 * `laneSeq` is authenticated metadata allocated inside the transaction, so
 * only the root is warmed; the payload is still encrypted in place.
 */
export async function warmHostedLinqMailboxPayloadRoot(input: {
  event: Parameters<typeof requireHostedLinqMessageReceivedEvent>[0];
  prisma: PrismaClient | Prisma.TransactionClient;
  threadRoute: Pick<HostedThreadRouteSnapshot, "containerMemberId"> | null;
}): Promise<void> {
  const memberId = await resolveHostedLinqMailboxPayloadRootPrewarmMemberId({
    event: input.event,
    prisma: input.prisma,
    threadRoute: input.threadRoute,
  });
  if (!memberId) {
    return;
  }

  const root = await unwrapHostedDomainRootForWeb({
    domain: getHostedCryptoDomainForLane("mailbox-payload"),
    prisma: input.prisma,
    retainFailureInScopedCache: true,
    userId: memberId,
  });
  // The scoped cache hands every caller its own copy and expects that copy to
  // be wiped; the cached master is zeroized separately when the scope closes.
  // Warming needs the unwrap, not the plaintext, so wipe it immediately.
  root.rootKey.fill(0);
}

export async function runHostedOnboardingWebhookTransaction<TResult>(
  prisma: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
  /**
   * Runs inside the unwrap cache but before the transaction opens, so a root
   * this planner is certain to need is unwrapped without a connection held.
   */
  warmUnwrapCache?: () => Promise<void>,
): Promise<TResult> {
  const operations: PrismaOperationTiming[] = [];
  let transactionMs = 0;
  let warmUnwrapMs: number | undefined;
  try {
    return await runWithPrismaOperationTimings(operations, async () =>
      runWithHostedDomainRootUnwrapCache(async () => {
        if (warmUnwrapCache) {
          const warmStartedAtMs = Date.now();
          try {
            await warmUnwrapCache();
          } catch (error) {
            // A failed preflight must not suppress branches that never need
            // this root. If the planner does request it, the scoped cache
            // returns the retained rejection instead of repeating KMS while a
            // connection is held.
            logHostedOnboardingDiagnostic("hosted-onboarding.webhook.warm-failed", {
              reason: error instanceof Error ? error.name : "unknown",
            });
          } finally {
            warmUnwrapMs = Date.now() - warmStartedAtMs;
          }
        }
        const transactionStartedAtMs = Date.now();
        try {
          return await (typeof prisma.$transaction === "function"
            ? prisma.$transaction(callback)
            : callback(prisma as Prisma.TransactionClient));
        } finally {
          transactionMs = Date.now() - transactionStartedAtMs;
        }
      }),
    );
  } finally {
    logHostedOnboardingDiagnostic("hosted-onboarding.webhook.plan-db", {
      transactionMs,
      ...(warmUnwrapMs === undefined ? {} : { warmUnwrapMs }),
      ...buildHostedWebhookDbTimingLogDetails(operations),
    });
  }
}
