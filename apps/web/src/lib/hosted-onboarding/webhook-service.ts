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
  planHostedOnboardingWhatsAppWebhook,
  type HostedOnboardingWhatsAppWebhookResponse,
} from "./webhook-provider-whatsapp";
import {
  parseHostedWhatsAppInboundTexts,
  verifyAndParseHostedWhatsAppWebhookRequest,
} from "./whatsapp";
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
import {
  runWithPrismaOperationTimings,
  type PrismaOperationTiming,
} from "../prisma-operation-timing";
import {
  buildHostedWebhookDbTimingLogDetails,
} from "./webhook-db-timing";
import {
  drainHostedLinqSideEffectsDirect,
  type HostedLinqCurrentInboundReplyProof,
  type HostedLinqSideEffectDrainResult,
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
  handleHostedGroupJoinOfferReaction,
} from "../hosted-groups/join-offer-reaction";
import type {
  HostedOnboardingLinqGroupRosterReconcile,
} from "./webhook-provider-linq-types";

export {
  handleHostedStripeWebhook,
} from "./webhook-service-stripe";
export type {
  HostedStripeWebhookResponse,
} from "./webhook-service-types";

type HostedWebhookPostResponseScheduler = (task: () => Promise<void>) => void;

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
    const event = verifyAndParseHostedLinqWebhookRequest({
      rawBody: input.rawBody,
      signature: input.signature,
      timestamp: input.timestamp,
    });
    eventId = event.event_id;
    eventType = event.event_type;
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

    const providerEvent = parseHostedLinqProviderEvent({
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
      });
      const reactionResult = await handleHostedGroupJoinOfferReaction({
        event: providerEvent,
        prisma,
      });
      const response: HostedOnboardingLinqWebhookResponse = {
        duplicate: providerResult.duplicate || undefined,
        ignored: reactionResult.status !== "accepted",
        ok: true,
        reason: reactionResult.status === "accepted"
          ? "accepted-linq-group-join-offer-reaction"
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
    if (providerEvent && event.event_type !== "message.received") {
      const prisma = input.prisma ?? getPrisma();
      const providerResult = await ingestHostedLinqProviderEventDirect({
        event: providerEvent,
        prisma,
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

    const currentInboundReply: HostedLinqCurrentInboundReplyProof | null =
      event.event_type === "message.received"
        ? buildHostedLinqCurrentInboundReplyProof(event)
        : null;

    const prisma = input.prisma ?? getPrisma();
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
              event,
              firstContactAdmitted: recordedAdmission?.kind === "allow",
              requireFirstContactAdmission,
              prisma: transaction,
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
                  event,
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
                    event,
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
      finishHostedOnboardingTiming(planTiming, "failed", {
        errorName: deriveHostedOnboardingTimingErrorName(error),
      });
      throw error;
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

    let response = plan.response;
    if (plan.desiredSideEffects.length > 0) {
      const drainResult = await drainHostedLinqSideEffectsDirect({
        collectResult: true,
        currentInboundReply,
        prisma,
        scheduleAfterResponse: input.scheduleAfterResponse,
        sideEffects: plan.desiredSideEffects,
        signal: input.signal,
      });
      response = resolveHostedLinqWebhookResponseAfterDrain({
        drainResult,
        response,
      });
    }

    scheduleHostedLinqProviderEventIngestionBestEffort({
      event: providerEvent,
      prisma,
      scheduleAfterResponse: input.scheduleAfterResponse,
    });

    responseReason = response.reason ?? null;
    const wakeHandoff = plan.wakeHandoffs?.[0];
    const wakeHandoffResult = await maybeHandoffHostedExecutionWebhookWake({
      response,
      scheduleAfterResponse: input.scheduleAfterResponse,
      wakeHandoff,
    });
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
    return response;
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

function resolveHostedLinqWebhookResponseAfterDrain(input: {
  drainResult: HostedLinqSideEffectDrainResult;
  response: HostedOnboardingLinqWebhookResponse;
}): HostedOnboardingLinqWebhookResponse {
  if (
    input.response.reason !== "sent-ai-usage-quota-reply"
    || input.drainResult.sentCount > 0
  ) {
    return input.response;
  }

  const alreadyClaimedAiUsageNotice = input.drainResult.skipped.some((skip) =>
    skip.reason === "notice_already_claimed"
    && skip.template === "ai_usage_quota"
  );
  if (!alreadyClaimedAiUsageNotice) {
    return input.response;
  }

  return {
    ...input.response,
    ignored: true,
    reason: "ai-usage-quota-already-notified",
  };
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
}): Promise<Awaited<ReturnType<typeof ingestHostedLinqProviderEventTx>>> {
  return runHostedOnboardingWebhookTransaction(
    input.prisma,
    (transaction) => ingestHostedLinqProviderEventTx({
      event: input.event,
      prisma: transaction,
    }),
  );
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

  await maybeHandoffHostedExecutionWebhookWake({
    response: plan.response,
    scheduleAfterResponse: input.scheduleAfterResponse,
    wakeHandoff: plan.wakeHandoffs?.[0],
  });
  return plan.response;
}

export async function handleHostedOnboardingWhatsAppWebhook(input: {
  rawBody: string;
  prisma?: PrismaClient;
  scheduleAfterResponse?: HostedWebhookPostResponseScheduler;
  signature: string | null;
  signal?: AbortSignal;
}): Promise<HostedOnboardingWhatsAppWebhookResponse> {
  const timing = startHostedOnboardingTiming("hosted-onboarding.webhook.whatsapp", {
    rawBodyBytes: new TextEncoder().encode(input.rawBody).byteLength,
    signalAbortedAtStart: input.signal?.aborted ?? false,
    signaturePresent: Boolean(input.signature),
  });
  let responseReason: string | null = null;

  try {
    const body = verifyAndParseHostedWhatsAppWebhookRequest({
      rawBody: input.rawBody,
      signature: input.signature,
    });
    const inboundTextCount = parseHostedWhatsAppInboundTexts(body).length;
    if (inboundTextCount === 0) {
      const plan = await planHostedOnboardingWhatsAppWebhook({
        body,
      });
      responseReason = plan.response.reason ?? null;
      finishHostedOnboardingTiming(timing, "completed", {
        commandHandledCount: plan.response.commandHandledCount,
        inboundTextCount: plan.response.inboundTextCount,
        responseReason,
        routedTextCount: plan.response.routedTextCount,
        signalAbortedBeforeReturn: input.signal?.aborted ?? false,
        wakeHandoffCount: 0,
      });
      return plan.response;
    }

    const prisma = input.prisma ?? getPrisma();
    const plan = await runHostedOnboardingWebhookTransaction(
      prisma,
      (transaction) =>
        planHostedOnboardingWhatsAppWebhook({
          body,
          prisma: transaction,
        }),
    );

    if (plan.desiredSideEffects.length > 0) {
      throw new Error(
        "Hosted WhatsApp webhook planning unexpectedly requested legacy runtime side effects.",
      );
    }

    const wakeHandoffs = plan.wakeHandoffs ?? [];
    for (const wakeHandoff of wakeHandoffs) {
      await maybeHandoffHostedExecutionWebhookWake({
        response: plan.response,
        scheduleAfterResponse: input.scheduleAfterResponse,
        wakeHandoff,
      });
    }

    responseReason = plan.response.reason ?? null;
    finishHostedOnboardingTiming(timing, "completed", {
      commandHandledCount: plan.response.commandHandledCount,
      inboundTextCount: plan.response.inboundTextCount,
      responseReason,
      routedTextCount: plan.response.routedTextCount,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
      wakeHandoffCount: wakeHandoffs.length,
    });
    return plan.response;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      responseReason,
      signalAbortedBeforeReturn: input.signal?.aborted ?? false,
    });
    throw error;
  }
}

async function runHostedOnboardingWebhookTransaction<TResult>(
  prisma: PrismaClient,
  callback: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<TResult> {
  const startedAtMs = Date.now();
  const operations: PrismaOperationTiming[] = [];
  try {
    return await runWithPrismaOperationTimings(operations, async () =>
      runWithHostedDomainRootUnwrapCache(async () =>
        typeof prisma.$transaction === "function"
          ? prisma.$transaction(callback)
          : callback(prisma as Prisma.TransactionClient),
      ),
    );
  } finally {
    logHostedOnboardingDiagnostic("hosted-onboarding.webhook.plan-db", {
      transactionMs: Date.now() - startedAtMs,
      ...buildHostedWebhookDbTimingLogDetails(operations),
    });
  }
}
