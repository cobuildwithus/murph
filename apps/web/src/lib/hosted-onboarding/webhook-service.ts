import type {
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import {
  requireHostedLinqMessageReceivedEvent,
  sendHostedLinqReadReceipt,
  verifyAndParseHostedLinqWebhookRequest,
} from "./linq";
import {
  getHostedLinqChatSummary,
} from "./linq-client";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  planHostedLinqPermanentHomeRouteRecovery,
} from "./linq-home-route-recovery";
import { assertHostedTelegramWebhookSecret, parseHostedTelegramWebhookUpdate } from "./telegram";
import {
  planHostedOnboardingLinqWebhook,
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
} from "./linq-first-contact-admission";
import {
  maybeHandoffHostedExecutionWebhookWake,
} from "./webhook-service-wake";
import {
  assertHostedThreadRouteEgressAuthority,
  markHostedLinqThreadRouteParticipantAdditionPendingTx,
  readHostedThreadRouteByThreadIdentity,
  type HostedThreadRouteSnapshot,
} from "../hosted-routing/thread-route-store";
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
  materializePendingHostedGroupJoinConfirmationsBestEffort,
} from "../hosted-groups/group-join-confirmation";
import type {
  HostedOnboardingLinqGroupRosterReconcile,
} from "./webhook-provider-linq-types";
import {
  createHostedPostCommitDeadline,
  readHostedPostCommitRemainingMs,
} from "./bounded-post-commit";

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
  let responseReason: string | null = null;

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
    let affirmativeReaction = false;
    finishHostedOnboardingTiming(verifyTiming, "completed", {
      eventIdSuffix: toHostedOnboardingLogIdSuffix(eventId),
      eventType,
      signalAbortedAfterVerify: input.signal?.aborted ?? false,
    });

    if (event.event_type === "chat.typing_indicator.started") {
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
      const reactionResult = await handleHostedGroupJoinOfferReaction({
        event: providerEvent,
        prisma,
        signal: input.signal,
      });
      if (reactionResult.status === "accepted") {
        const response: HostedOnboardingLinqWebhookResponse = {
          duplicate: providerResult.duplicate || undefined,
          ignored: false,
          ok: true,
          reason: "accepted-linq-group-join-offer-reaction",
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
    if (providerEvent && event.event_type !== "message.received") {
      const prisma = input.prisma ?? getPrisma();
      const providerResult = event.event_type === "participant.added"
        || event.event_type === "participant.removed"
        ? await ingestHostedLinqParticipantEventDirect({
            event: providerEvent,
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
        responseReason,
      });
      return response;
    }

    input.signal?.throwIfAborted();
    const prisma = input.prisma ?? getPrisma();
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
      const recordedAdmission = requireFirstContactAdmission
        ? await readRecordedHostedLinqFirstContactAdmissionDecision({
            eventId: event.event_id,
            prisma,
          })
        : null;

      if (recordedAdmission?.kind === "block") {
        plan = buildBlockedHostedLinqFirstContactAdmissionPlan();
      } else {
        plan = await runHostedOnboardingWebhookTransaction(
          prisma,
          (transaction) =>
            planHostedOnboardingLinqWebhook({
              affirmativeReaction,
              event: planningEvent,
              firstContactAdmitted: recordedAdmission?.kind === "allow",
              requireFirstContactAdmission,
              prisma: transaction,
            }),
          () => warmHostedLinqMailboxPayloadRoot({
            prisma,
            threadRoute: planningResolution.threadRoute,
          }),
        );
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
          const firstContactAdmission = await recordHostedLinqFirstContactAdmissionDecision({
            decision: deterministicDecision,
            eventId: event.event_id,
            prisma,
          });
          plan = firstContactAdmission.kind === "block"
            ? buildBlockedHostedLinqFirstContactAdmissionPlan()
            : await runHostedOnboardingWebhookTransaction(
              prisma,
              (transaction) =>
                planHostedOnboardingLinqWebhook({
                  affirmativeReaction,
                  event: planningEvent,
                  firstContactAdmitted: true,
                  requireFirstContactAdmission,
                  prisma: transaction,
                }),
            );
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
          if (admissionBudget.kind === "exhausted") {
            plan = buildBlockedHostedLinqFirstContactAdmissionPlan(
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

            const firstContactAdmission = await recordHostedLinqFirstContactAdmissionDecision({
              decision: classifiedAdmission,
              eventId: event.event_id,
              prisma,
            });
            if (firstContactAdmission.kind === "block") {
              plan = buildBlockedHostedLinqFirstContactAdmissionPlan();
            } else {
              plan = await runHostedOnboardingWebhookTransaction(
                prisma,
                (transaction) =>
                  planHostedOnboardingLinqWebhook({
                    affirmativeReaction,
                    event: planningEvent,
                    firstContactAdmitted: true,
                    requireFirstContactAdmission,
                    prisma: transaction,
                  }),
              );
            }
          }
        }
      }

      if (plan.firstContactAdmissionRequest) {
        throw new Error("Hosted Linq first-contact admission remained unresolved after classification.");
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
      scheduleAfterResponse: input.scheduleAfterResponse,
    });
    await reconcileHostedUsageReferralRewardsAfterCommitBestEffort({
      prisma,
      referralIds: plan.postCommitUsageReferralIds ?? [],
      scheduleAfterResponse: input.scheduleAfterResponse,
    });

    if (plan.desiredSideEffects.length > 0) {
      await drainHostedLinqSideEffectsDirect({
        prisma,
        scheduleAfterResponse: input.scheduleAfterResponse,
        sideEffects: plan.desiredSideEffects,
        signal: input.signal,
      });
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

interface HostedLinqPlanningEventResolution {
  event: Parameters<typeof requireHostedLinqMessageReceivedEvent>[0];
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
    return { event: messageEvent, threadRoute: null };
  }

  if (messageEvent.data.is_from_me) {
    if (webhookIsGroup === false) {
      logHostedLinqChatClassification("webhook-direct");
    }
    return { event: messageEvent, threadRoute: null };
  }

  const threadRoute = await readHostedThreadRouteByThreadIdentity({
    channel: "linq",
    prisma: input.prisma,
    threadId: messageEvent.data.chat_id,
  });
  let resolvedIsGroup: boolean;
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
    threadRoute,
  };
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
  prisma: PrismaClient;
}): Promise<Awaited<ReturnType<typeof ingestHostedLinqProviderEventTx>>> {
  return runHostedOnboardingWebhookTransaction(input.prisma, async (transaction) => {
    const providerResult = await ingestHostedLinqProviderEventTx({
      event: input.event,
      prisma: transaction,
    });
    if (providerResult.duplicate || input.event.eventType !== "participant.added") {
      return providerResult;
    }

    const chatId = input.event.linqChatId;
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

    await markHostedLinqThreadRouteParticipantAdditionPendingTx({
      containerMemberId: route.containerMemberId,
      prisma: transaction,
      threadId: chatId,
    });
    return providerResult;
  });
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

  const plan = await runHostedOnboardingWebhookTransaction(
    prisma,
    (transaction) =>
      planHostedOnboardingTelegramWebhook({
        prisma: transaction,
        update,
      }),
  );

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

/**
 * Unwrapping the ingress root reads an envelope and then calls KMS. Doing that
 * first inside the planning transaction holds a pooled connection across a
 * network round trip, which is what lets a slow KMS extend both connection
 * occupancy and inbound serialization. The unwrap cache is already request
 * scoped around this transaction, so unwrapping beforehand leaves the
 * in-transaction encrypt as local AES work against the cached root.
 *
 * The route is the one the planning-event resolver already read, so warming
 * costs no additional query. `laneSeq` is authenticated metadata allocated
 * inside the transaction, so only the root is warmed; the payload is still
 * encrypted in place.
 */
export async function warmHostedLinqMailboxPayloadRoot(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  threadRoute: Pick<HostedThreadRouteSnapshot, "containerMemberId"> | null;
}): Promise<void> {
  if (!input.threadRoute) {
    // No established route yet, so there is no known member whose root could be
    // warmed; the planner unwraps as before.
    return;
  }

  const root = await unwrapHostedDomainRootForWeb({
    domain: getHostedCryptoDomainForLane("mailbox-payload"),
    prisma: input.prisma,
    retainFailureInScopedCache: true,
    userId: input.threadRoute.containerMemberId,
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
