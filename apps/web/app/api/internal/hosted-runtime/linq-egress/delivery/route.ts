import { after } from "next/server";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "@/src/lib/hosted-execution/logging";
import {
  createHostedLinqChatLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  recordHostedLinqRuntimeDeliveryOutcomeTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  materializeHostedSignupWelcomeHomeRouteTx,
} from "@/src/lib/hosted-onboarding/linq-home-routing";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "@/src/lib/hosted-onboarding/shared";
import {
  linkHostedIngressLatencyTracesToAcceptedLinqDelivery,
} from "@/src/lib/hosted-runtime-latency/store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_LINQ_EGRESS_DELIVERY_BODY_LIMIT_BYTES = 8 * 1024;
const HOSTED_RUNTIME_ATTEMPT_ID_HEADER = "x-hosted-runtime-attempt-id";
const HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX = "signup-welcome:";
// Must stay >= the hosted mailbox run import limit so one grouped auto-reply
// can stamp every answered conversation item.
const HOSTED_LINQ_DELIVERY_ANSWERED_MAILBOX_ITEM_ID_LIMIT = 100;
const HOSTED_LINQ_DELIVERY_PROVIDER_MESSAGE_ID_LIMIT = 10;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_EGRESS_DELIVERY_BODY_LIMIT_BYTES,
  });
  const runtimeAttemptId = request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)?.trim() ?? "";
  const body = await readOptionalJsonObject(request);
  const prisma = getPrisma();
  const targetKind = parseHostedLinqDeliveryTargetKind(body.targetKind);
  const acceptedAt = parseOptionalHostedLinqDeliveryDate(
    body.acceptedAt,
    "acceptedAt",
  );
  const failedAt = parseOptionalHostedLinqDeliveryDate(body.failedAt, "failedAt");
  const threadIsDirect = parseOptionalHostedLinqDeliveryBoolean(
    body.threadIsDirect,
    "threadIsDirect",
  );

  if (!acceptedAt && !failedAt) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_OUTCOME_MISSING",
      httpStatus: 400,
      message: "Hosted Linq delivery outcome requires an accepted or failed timestamp.",
      retryable: false,
    });
  }
  if (acceptedAt && failedAt) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_OUTCOME_AMBIGUOUS",
      httpStatus: 400,
      message: "Hosted Linq delivery outcome cannot be both accepted and failed.",
      retryable: false,
    });
  }

  const attemptedAt = parseRequiredHostedLinqDeliveryDate(
    body.attemptedAt,
    "attemptedAt",
  );
  const failureCode = readOptionalBodyString(body.failureCode);
  const answeredMailboxItemIds = acceptedAt
    ? parseAnsweredMailboxItemIds(body.answeredMailboxItemIds)
    : [];
  const providerTarget = readOptionalBodyString(body.providerTarget);
  const providerThreadId = readOptionalBodyString(body.providerThreadId);
  const providerMessageId = readOptionalBodyString(body.providerMessageId);
  const providerMessageIds = parseProviderMessageIds(
    body.providerMessageIds,
    providerMessageId,
  );
  const target = readOptionalBodyString(body.target);
  const fromPhoneNumber = readOptionalBodyString(body.fromPhoneNumber);
  const directRecipientPhoneNumber = readOptionalBodyString(
    body.directRecipientPhoneNumber,
  );
  const idempotencyKey = readOptionalBodyString(body.idempotencyKey);
  const sourceRef = readOptionalBodyString(body.intentId) ?? idempotencyKey;
  const lineLookupKey = readOptionalBodyString(body.lineLookupKey);
  const linqChatId = providerThreadId
    ?? (targetKind === "participant" ? null : providerTarget ?? target);
  const routeLineLookupKey = fromPhoneNumber
    ? null
    : lineLookupKey
      ?? await readHostedLinqDeliveryMemberRouteLineLookupKey({
          linqChatId,
          memberId: userId,
          prisma,
        });
  const outcomeInput = {
    acceptedAt,
    answeredMailboxItemIds,
    attemptedAt,
    failedAt,
    failureCode,
    failureReason: readOptionalBodyString(body.failureReason),
    idempotencyKey,
    linqChatId,
    messageId: providerMessageId,
    ...(Array.isArray(body.providerMessageIds)
      ? { messageIds: providerMessageIds }
      : {}),
    phoneNumber: routeLineLookupKey ? null : fromPhoneNumber,
    phoneNumberLookupKey: routeLineLookupKey,
    sourceRef,
    targetKind,
    threadIsDirect,
    userId,
  } as const;
  const acceptedSignupWelcome = acceptedAt
    ? parseHostedSignupWelcomeIdempotencyKey(idempotencyKey)
    : null;
  const claimsParticipantSignupWelcomeNamespace = Boolean(
    acceptedAt
    && targetKind === "participant"
    && idempotencyKey?.startsWith(
      HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX,
    ),
  );
  if (
    (acceptedSignupWelcome && acceptedSignupWelcome !== userId)
    || (
      claimsParticipantSignupWelcomeNamespace
      && acceptedSignupWelcome !== userId
    )
  ) {
    throwHostedSignupWelcomeDeliveryAuthorityInvalid();
  }

  const result = acceptedSignupWelcome && targetKind === "participant"
    ? await prisma.$transaction(async (tx) => {
        if (
          threadIsDirect !== true
          || !providerThreadId
          || !providerMessageId
          || !fromPhoneNumber
          || !directRecipientPhoneNumber
        ) {
          throwHostedSignupWelcomeDeliveryAuthorityInvalid();
        }

        await materializeHostedSignupWelcomeHomeRouteTx({
          directRecipientPhoneNumber,
          fromPhoneNumber,
          idempotencyKey: idempotencyKey ?? "",
          linqChatId: providerThreadId,
          memberId: userId,
          prisma: tx,
        });
        const recorded = await recordHostedLinqRuntimeDeliveryOutcomeTx({
          ...outcomeInput,
          phoneNumber: fromPhoneNumber,
          phoneNumberLookupKey: null,
          prisma: tx,
        });
        if (!recorded.recorded || !recorded.deliveryId) {
          throw hostedOnboardingError({
            code: "HOSTED_LINQ_SIGNUP_WELCOME_DELIVERY_NOT_RECORDED",
            httpStatus: 503,
            message: "Hosted signup welcome delivery outcome was not recorded.",
            retryable: true,
          });
        }
        return recorded;
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS)
    : await recordHostedLinqRuntimeDeliveryOutcomeTx({
        ...outcomeInput,
        prisma,
      });

  if (
    acceptedAt
    && result.recorded
    && result.deliveryId
    && answeredMailboxItemIds.length > 0
    && runtimeAttemptId
  ) {
    scheduleHostedIngressLatencyDeliveryLinkAfterResponse({
      answeredMailboxItemIds,
      authenticatedUserId: userId,
      linqDeliveryId: result.deliveryId,
      prisma,
      replyRuntimeAttemptId: runtimeAttemptId,
    });
  }

  return jsonOk({
    ok: true,
    recorded: result.recorded,
  });
});

function parseHostedSignupWelcomeIdempotencyKey(
  value: string | null,
): string | null {
  if (!value?.startsWith(HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX)) {
    return null;
  }
  const memberId = value.slice(HOSTED_LINQ_SIGNUP_WELCOME_IDEMPOTENCY_PREFIX.length);
  return memberId && !memberId.includes(":") ? memberId : null;
}

function throwHostedSignupWelcomeDeliveryAuthorityInvalid(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_SIGNUP_WELCOME_DELIVERY_AUTHORITY_INVALID",
    httpStatus: 403,
    message: "Hosted signup welcome delivery authority is invalid.",
    retryable: false,
  });
}

function scheduleHostedIngressLatencyDeliveryLinkAfterResponse(input: {
  answeredMailboxItemIds: readonly string[];
  authenticatedUserId: string;
  linqDeliveryId: string;
  prisma: ReturnType<typeof getPrisma>;
  replyRuntimeAttemptId: string;
}): void {
  const task = async (): Promise<void> => {
    try {
      await linkHostedIngressLatencyTracesToAcceptedLinqDelivery(input);
    } catch (error) {
      const safeError = formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_INGRESS_LATENCY_DELIVERY_LINK_FAILED",
      });
      console.error("Hosted ingress latency delivery link failed.", {
        errorCode: safeError.errorCode,
        errorType: safeError.errorType,
      });
    }
  };

  try {
    after(task);
  } catch {
    // Observability must never add delivery-path work when the post-response
    // scheduler is unavailable.
  }
}

function parseAnsweredMailboxItemIds(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_ANSWERED_MAILBOX_ITEM_IDS_INVALID",
      httpStatus: 400,
      message: "Hosted Linq delivery answered mailbox item ids must be an array.",
      retryable: false,
    });
  }
  const itemIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const itemId = readOptionalBodyString(entry);
    if (!itemId) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_DELIVERY_ANSWERED_MAILBOX_ITEM_ID_INVALID",
        httpStatus: 400,
        message: "Hosted Linq delivery answered mailbox item id is invalid.",
        retryable: false,
      });
    }
    if (seen.has(itemId)) {
      continue;
    }
    seen.add(itemId);
    itemIds.push(itemId);
    if (itemIds.length > HOSTED_LINQ_DELIVERY_ANSWERED_MAILBOX_ITEM_ID_LIMIT) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_DELIVERY_ANSWERED_MAILBOX_ITEM_IDS_TOO_MANY",
        httpStatus: 400,
        message: "Hosted Linq delivery answered mailbox item ids are too many.",
        retryable: false,
      });
    }
  }

  return itemIds;
}

function parseProviderMessageIds(
  value: unknown,
  providerMessageId: string | null,
): string[] {
  if (value !== undefined && value !== null && !Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_PROVIDER_MESSAGE_IDS_INVALID",
      httpStatus: 400,
      message: "Hosted Linq delivery provider message ids must be an array.",
      retryable: false,
    });
  }
  const messageIds: string[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const messageId = readOptionalBodyString(entry);
    if (!messageId) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_DELIVERY_PROVIDER_MESSAGE_ID_INVALID",
        httpStatus: 400,
        message: "Hosted Linq delivery provider message id is invalid.",
        retryable: false,
      });
    }
    if (!messageIds.includes(messageId) && messageId !== providerMessageId) {
      messageIds.push(messageId);
    }
  }
  if (providerMessageId) {
    messageIds.push(providerMessageId);
  }
  if (messageIds.length > HOSTED_LINQ_DELIVERY_PROVIDER_MESSAGE_ID_LIMIT) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_PROVIDER_MESSAGE_IDS_TOO_MANY",
      httpStatus: 400,
      message: "Hosted Linq delivery provider message ids are too many.",
      retryable: false,
    });
  }
  return messageIds;
}

async function readHostedLinqDeliveryMemberRouteLineLookupKey(input: {
  linqChatId: string | null;
  memberId: string;
  prisma: ReturnType<typeof getPrisma>;
}): Promise<string | null> {
  const chatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.linqChatId);
  if (chatLookupKeys.length === 0) {
    return null;
  }

  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      linqChatLookupKey: true,
      linqRecipientPhoneLookupKey: true,
      pendingLinqChatLookupKey: true,
      pendingLinqRecipientPhoneLookupKey: true,
    },
  });
  if (!routing) {
    return null;
  }

  if (
    routing.linqChatLookupKey
    && chatLookupKeys.includes(routing.linqChatLookupKey)
  ) {
    return routing.linqRecipientPhoneLookupKey ?? null;
  }

  if (
    routing.pendingLinqChatLookupKey
    && chatLookupKeys.includes(routing.pendingLinqChatLookupKey)
  ) {
    return routing.pendingLinqRecipientPhoneLookupKey ?? null;
  }

  return null;
}

function parseHostedLinqDeliveryTargetKind(
  value: unknown,
): "explicit" | "participant" | "thread" | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === "explicit" || value === "participant" || value === "thread") {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_DELIVERY_TARGET_KIND_INVALID",
    httpStatus: 400,
    message: "Hosted Linq delivery target kind is invalid.",
    retryable: false,
  });
}

function parseOptionalHostedLinqDeliveryBoolean(
  value: unknown,
  field: string,
): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_DELIVERY_BOOLEAN_INVALID",
    details: { code: field },
    httpStatus: 400,
    message: "Hosted Linq delivery boolean is invalid.",
    retryable: false,
  });
}

function parseRequiredHostedLinqDeliveryDate(value: unknown, field: string): Date {
  const date = parseOptionalHostedLinqDeliveryDate(value, field);
  if (!date) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_DATE_MISSING",
      httpStatus: 400,
      message: "Hosted Linq delivery timestamp is required.",
      retryable: false,
    });
  }
  return date;
}

function parseOptionalHostedLinqDeliveryDate(
  value: unknown,
  field: string,
): Date | null {
  if (value === undefined || value === null) {
    return null;
  }
  const raw = readOptionalBodyString(value);
  const date = raw ? new Date(raw) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_DATE_INVALID",
      details: { code: field },
      httpStatus: 400,
      message: "Hosted Linq delivery timestamp is invalid.",
      retryable: false,
    });
  }
  return date;
}

function readOptionalBodyString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
