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
  sanitizeHostedOnboardingStructuredLogDetails,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import {
  drainHostedLinqSideEffectsDirect,
} from "./webhook-transport";
import {
  isHostedOnboardingError,
} from "./errors";
import {
  describeHostedOnboardingErrorForLog,
} from "./http";
import {
  classifyHostedLinqFirstContactAdmission,
  readHostedLinqFirstContactAdmissionMode,
  readRecordedHostedLinqFirstContactAdmissionDecision,
  recordHostedLinqFirstContactAdmissionDecision,
} from "./linq-first-contact-admission";
import {
  maybeHandoffHostedExecutionWebhookWake,
} from "./webhook-service-wake";
import {
  assertHostedThreadRouteEgressAuthority,
} from "../hosted-routing/thread-route-store";

export {
  handleHostedStripeWebhook,
} from "./webhook-service-stripe";
export type {
  HostedStripeWebhookResponse,
} from "./webhook-service-types";

type HostedWebhookPostResponseScheduler = (task: () => Promise<void>) => void;
type HostedOnboardingLinqWebhookPlan = Awaited<ReturnType<typeof planHostedOnboardingLinqWebhook>>;
type HostedOnboardingLinqFirstContactAdmissionRequest =
  NonNullable<HostedOnboardingLinqWebhookPlan["firstContactAdmissionRequest"]>;
type HostedOnboardingLinqAdmissionPlanResult = {
  firstContactAdmissionClassified: boolean;
  firstContactAdmissionUnavailable: boolean;
  plan: HostedOnboardingLinqWebhookPlan;
};

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
    let plan: HostedOnboardingLinqWebhookPlan;
    const firstContactAdmissionMode = readHostedLinqFirstContactAdmissionMode();
    const requireFirstContactAdmission = firstContactAdmissionMode === "enforce";
    let firstContactAdmissionClassified = false;
    let firstContactAdmissionUnavailable = false;
    try {
      if (requireFirstContactAdmission) {
        const admissionPlan = await planHostedOnboardingLinqWebhookWithFirstContactAdmission({
          event,
          prisma,
          signal: input.signal,
        });
        plan = admissionPlan.plan;
        firstContactAdmissionClassified = admissionPlan.firstContactAdmissionClassified;
        firstContactAdmissionUnavailable = admissionPlan.firstContactAdmissionUnavailable;
      } else {
        plan = await runHostedOnboardingWebhookTransaction(
          prisma,
          (transaction) =>
            planHostedOnboardingLinqWebhook({
              event,
              firstContactAdmitted: false,
              requireFirstContactAdmission,
              prisma: transaction,
            }),
        );
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
      firstContactAdmissionUnavailable,
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
    if (input.plan.linqReadReceiptRouteAuthority) {
      await assertHostedThreadRouteEgressAuthority({
        authority: input.plan.linqReadReceiptRouteAuthority,
        prisma: input.prisma,
      });
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

function buildBlockedHostedLinqFirstContactAdmissionPlan(): HostedOnboardingLinqWebhookPlan {
  return {
    desiredSideEffects: [],
    response: {
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    },
  };
}

async function planHostedOnboardingLinqWebhookWithFirstContactAdmission(input: {
  event: Parameters<typeof planHostedOnboardingLinqWebhook>[0]["event"];
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedOnboardingLinqAdmissionPlanResult> {
  const initialPlan = await planHostedOnboardingLinqWebhookForCurrentAdmissionState({
    event: input.event,
    prisma: input.prisma,
  });
  if (!("request" in initialPlan)) {
    return initialPlan;
  }

  let classification:
    | {
        decision: Awaited<ReturnType<typeof classifyHostedLinqFirstContactAdmission>>;
        kind: "classified";
      }
    | {
        error: unknown;
        kind: "unavailable";
      };
  try {
    classification = {
      decision: await classifyHostedLinqFirstContactAdmission({
        request: initialPlan.request,
        signal: input.signal,
      }),
      kind: "classified",
    };
  } catch (error) {
    if (!isHostedLinqFirstContactAdmissionClassifierUnavailableError(error)) {
      throw error;
    }

    classification = {
      error,
      kind: "unavailable",
    };
  }

  return await resolveHostedOnboardingLinqWebhookClassifiedAdmission({
    classification,
    event: input.event,
    prisma: input.prisma,
  });
}

async function planHostedOnboardingLinqWebhookForCurrentAdmissionState(input: {
  event: Parameters<typeof planHostedOnboardingLinqWebhook>[0]["event"];
  prisma: PrismaClient;
}): Promise<
  | HostedOnboardingLinqAdmissionPlanResult
  | {
      request: HostedOnboardingLinqFirstContactAdmissionRequest;
    }
> {
  return await runHostedOnboardingWebhookTransaction(
    input.prisma,
    async (transaction) => {
      await acquireHostedLinqFirstContactAdmissionEventLockTx({
        eventId: input.event.event_id,
        transaction,
      });
      const plan = await planHostedOnboardingLinqWebhookForRecordedAdmission({
        event: input.event,
        transaction,
      });
      return plan.firstContactAdmissionRequest
        ? { request: plan.firstContactAdmissionRequest }
        : {
            firstContactAdmissionClassified: false,
            firstContactAdmissionUnavailable: false,
            plan,
          };
    },
  );
}

async function resolveHostedOnboardingLinqWebhookClassifiedAdmission(input: {
  classification:
    | {
        decision: Awaited<ReturnType<typeof classifyHostedLinqFirstContactAdmission>>;
        kind: "classified";
      }
    | {
        error: unknown;
        kind: "unavailable";
      };
  event: Parameters<typeof planHostedOnboardingLinqWebhook>[0]["event"];
  prisma: PrismaClient;
}): Promise<HostedOnboardingLinqAdmissionPlanResult> {
  return await runHostedOnboardingWebhookTransaction(
    input.prisma,
    async (transaction) => {
      await acquireHostedLinqFirstContactAdmissionEventLockTx({
        eventId: input.event.event_id,
        transaction,
      });
      let plan = await planHostedOnboardingLinqWebhookForRecordedAdmission({
        event: input.event,
        transaction,
      });
      if (!plan.firstContactAdmissionRequest) {
        return {
          firstContactAdmissionClassified: input.classification.kind === "classified",
          firstContactAdmissionUnavailable: false,
          plan,
        };
      }

      if (input.classification.kind === "classified") {
        const firstContactAdmission = await recordHostedLinqFirstContactAdmissionDecision({
          decision: input.classification.decision,
          eventId: input.event.event_id,
          prisma: transaction,
        });
        if (firstContactAdmission.kind === "block") {
          return {
            firstContactAdmissionClassified: true,
            firstContactAdmissionUnavailable: false,
            plan: buildBlockedHostedLinqFirstContactAdmissionPlan(),
          };
        }

        plan = await planHostedOnboardingLinqWebhook({
          event: input.event,
          firstContactAdmitted: true,
          requireFirstContactAdmission: true,
          prisma: transaction,
        });
        assertHostedLinqFirstContactAdmissionResolved(plan);
        return {
          firstContactAdmissionClassified: true,
          firstContactAdmissionUnavailable: false,
          plan,
        };
      }

      plan = await planHostedOnboardingLinqWebhook({
        event: input.event,
        firstContactAdmitted: true,
        requireFirstContactAdmission: true,
        prisma: transaction,
      });
      assertHostedLinqFirstContactAdmissionResolved(plan);
      logHostedLinqFirstContactAdmissionFailOpen({
        error: input.classification.error,
        eventId: input.event.event_id,
      });
      return {
        firstContactAdmissionClassified: false,
        firstContactAdmissionUnavailable: true,
        plan,
      };
    },
  );
}

async function planHostedOnboardingLinqWebhookForRecordedAdmission(input: {
  event: Parameters<typeof planHostedOnboardingLinqWebhook>[0]["event"];
  transaction: Prisma.TransactionClient;
}): Promise<HostedOnboardingLinqWebhookPlan> {
  const recordedAdmission = await readRecordedHostedLinqFirstContactAdmissionDecision({
    eventId: input.event.event_id,
    prisma: input.transaction,
  });
  if (recordedAdmission?.kind === "block") {
    return buildBlockedHostedLinqFirstContactAdmissionPlan();
  }

  return await planHostedOnboardingLinqWebhook({
    event: input.event,
    firstContactAdmitted: recordedAdmission?.kind === "allow",
    requireFirstContactAdmission: true,
    prisma: input.transaction,
  });
}

function assertHostedLinqFirstContactAdmissionResolved(
  plan: HostedOnboardingLinqWebhookPlan,
): void {
  if (plan.firstContactAdmissionRequest) {
    throw new Error("Hosted Linq first-contact admission remained unresolved after classification.");
  }
}

async function acquireHostedLinqFirstContactAdmissionEventLockTx(input: {
  eventId: string;
  transaction: Prisma.TransactionClient;
}): Promise<void> {
  const eventId = input.eventId.trim();
  if (!eventId) {
    throw new TypeError("Hosted Linq first-contact admission lock requires an event id.");
  }

  await input.transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted-linq-first-contact-admission:event'),
      hashtext(${eventId})
    )
  `;
}

function isHostedLinqFirstContactAdmissionClassifierUnavailableError(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && error.code === "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE";
}

function logHostedLinqFirstContactAdmissionFailOpen(input: {
  error: unknown;
  eventId: string;
}): void {
  console.warn(
    "Hosted Linq first-contact admission classifier unavailable; admitting first contact.",
    {
      ...(describeHostedOnboardingErrorForLog(input.error) ?? {}),
      ...sanitizeHostedOnboardingStructuredLogDetails({
        admissionDisposition: "fail_open",
        errorCode: isHostedOnboardingError(input.error) ? input.error.code : null,
        retryable: isHostedOnboardingError(input.error) ? input.error.retryable : null,
      }),
      eventIdSuffix: toHostedOnboardingLogIdSuffix(input.eventId),
    },
  );
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
