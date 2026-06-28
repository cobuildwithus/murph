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
import { assertHostedTelegramWebhookSecret, buildHostedTelegramWebhookEventId, parseHostedTelegramWebhookUpdate } from "./telegram";
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
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import {
  drainHostedLinqSideEffectsDirect,
} from "./webhook-transport";
import {
  claimHostedLinqFirstContactAdmissionBudget,
  classifyHostedLinqFirstContactAdmission,
  isHostedLinqFirstContactAdmissionBudgetExhausted,
  readHostedLinqFirstContactAdmissionMode,
  readRecordedHostedLinqFirstContactAdmissionDecision,
  recordHostedLinqFirstContactAdmissionDecision,
  tryHostedLinqFirstContactAdmissionDeterministicDecision,
} from "./linq-first-contact-admission";
import {
  maybeHandoffHostedExecutionWebhookWake,
} from "./webhook-service-wake";
import {
  assertHostedLinqRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";

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

    if (event.event_type === "message.received") {
      requireHostedLinqMessageReceivedEvent(event);
    }

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
        // Resolve deterministic blocks (no OpenAI call) before claiming the
        // per-contact budget so unsupported/textless events cannot exhaust the
        // classifier-attempt cap.
        const deterministicDecision = tryHostedLinqFirstContactAdmissionDeterministicDecision(
          plan.firstContactAdmissionRequest,
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
          // Pre-flight: skip the classifier call entirely for contacts whose
          // per-contact attempt cap is already burned. The cheap count-read
          // here is the read-only side of the same budget guard; the
          // authoritative claim still runs after a successful classification
          // under its advisory lock + composite-PK idempotency.
          const budgetAlreadyExhausted = await isHostedLinqFirstContactAdmissionBudgetExhausted({
            eventId: event.event_id,
            participantContact: firstContactAdmissionParticipantContact,
            prisma,
          });
          if (budgetAlreadyExhausted) {
            plan = buildBlockedHostedLinqFirstContactAdmissionPlan(
              "first-contact-admission-budget-exhausted",
            );
          } else {
            // Classify before claiming the slot so transport/timeout/invalid-
            // output failures do not consume budget. The post-classification
            // claim still surfaces "exhausted" if a concurrent event filled the
            // cap between the pre-flight read and the lock acquisition.
            const classifiedAdmission = await classifyHostedLinqFirstContactAdmission({
              request: plan.firstContactAdmissionRequest,
              signal: input.signal,
            });
            firstContactAdmissionClassified = true;
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
      wakeUserPresent: Boolean(plan.wakeUserId),
    });

    if (plan.desiredSideEffects.length > 0) {
      await drainHostedLinqSideEffectsDirect({
        prisma,
        sideEffects: plan.desiredSideEffects,
        signal: input.signal,
      });
    }

    responseReason = plan.response.reason ?? null;
    const wakeHandoff = await maybeHandoffHostedExecutionWebhookWake({
      eventId: event.event_id,
      mailboxItemId: plan.wakeMailboxItemId,
      response: plan.response,
      scheduleAfterResponse: input.scheduleAfterResponse,
      source: "linq",
      userId: plan.wakeUserId,
    });
    const sendReadReceipt = () => maybeSendHostedLinqIngressReadReceipt({
      plan,
      prisma,
      signal: input.signal,
      wakeHandoff,
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
      wakeHandoffReason: wakeHandoff?.reason ?? null,
      wakeHandoffSignalAccepted: wakeHandoff?.signalAccepted ?? false,
      wakeHandoffStarted: wakeHandoff?.started ?? false,
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

async function maybeSendHostedLinqIngressReadReceipt(input: {
  plan: Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>;
  prisma: PrismaClient;
  signal?: AbortSignal;
  wakeHandoff: Awaited<ReturnType<typeof maybeHandoffHostedExecutionWebhookWake>>;
}): Promise<void> {
  const chatId = input.plan.wakeLinqChatId?.trim() ?? "";

  if (chatId.length === 0) {
    return;
  }

  const responseReason = input.plan.response.reason ?? null;
  const wakeHandoffReason = input.wakeHandoff?.reason ?? null;
  const wakeHandoffStarted = input.wakeHandoff?.started === true;
  const wakeHandoffSignalAccepted = input.wakeHandoff?.signalAccepted ?? false;
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

  try {
    if (!input.plan.linqReadReceiptRouteAuthority) {
      finishHostedOnboardingTiming(readReceiptTiming, "skipped-missing-route-authority", {
        responseReason,
        signalAbortedAfterReadReceipt: input.signal?.aborted ?? false,
        wakeHandoffReason,
        wakeHandoffStarted,
        wakeHandoffSignalAccepted,
      });
      return;
    }

    await assertHostedLinqRouteEgressAuthority({
      authority: input.plan.linqReadReceiptRouteAuthority,
      prisma: input.prisma,
    });

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
  secretToken: string | null;
  prisma?: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingTelegramWebhookResponse> {
  const prisma = input.prisma ?? getPrisma();

  assertHostedTelegramWebhookSecret(input.secretToken);

  const update = parseHostedTelegramWebhookUpdate(input.rawBody);
  const eventId = buildHostedTelegramWebhookEventId(update);
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
    eventId,
    mailboxItemId: plan.wakeMailboxItemId,
    response: plan.response,
    source: "telegram",
    userId: plan.wakeUserId,
  });
  return plan.response;
}

export async function handleHostedOnboardingWhatsAppWebhook(input: {
  rawBody: string;
  prisma?: PrismaClient;
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

    if (plan.desiredSideEffects.length > 0 || plan.wakeMailboxItemId || plan.wakeUserId) {
      throw new Error(
        "Hosted WhatsApp webhook planning unexpectedly requested legacy runtime side effects.",
      );
    }

    const wakeHandoffs = plan.wakeHandoffs ?? [];
    for (const wakeHandoff of wakeHandoffs) {
      await maybeHandoffHostedExecutionWebhookWake({
        eventId: wakeHandoff.eventId,
        mailboxItemId: wakeHandoff.mailboxItemId,
        response: plan.response,
        source: "whatsapp",
        userId: wakeHandoff.userId,
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
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction(callback)
    : callback(prisma as Prisma.TransactionClient);
}
