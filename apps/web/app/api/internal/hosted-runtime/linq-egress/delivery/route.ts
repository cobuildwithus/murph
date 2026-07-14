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
  releaseHostedLinqRuntimeProviderDispatchFenceTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  linkHostedIngressLatencyTracesToAcceptedLinqDelivery,
} from "@/src/lib/hosted-runtime-latency/store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_LINQ_EGRESS_DELIVERY_BODY_LIMIT_BYTES = 8 * 1024;
const HOSTED_RUNTIME_ATTEMPT_ID_HEADER = "x-hosted-runtime-attempt-id";
// Must stay >= the hosted mailbox run import limit so one grouped auto-reply
// can stamp every answered conversation item.
const HOSTED_LINQ_DELIVERY_ANSWERED_MAILBOX_ITEM_ID_LIMIT = 100;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_EGRESS_DELIVERY_BODY_LIMIT_BYTES,
  });
  const runtimeAttemptId = request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)?.trim() ?? "";
  const body = await readOptionalJsonObject(request);
  const prisma = getPrisma();
  const providerDispatchClaimRelease = body.providerDispatchClaimRelease === true;
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
  if (providerDispatchClaimRelease && (!failedAt || acceptedAt)) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_PROVIDER_DISPATCH_CLAIM_RELEASE_OUTCOME_INVALID",
      httpStatus: 400,
      message: "Hosted Linq provider dispatch claim release requires failed proof only.",
      retryable: false,
    });
  }

  const attemptedAt = parseRequiredHostedLinqDeliveryDate(
    body.attemptedAt,
    "attemptedAt",
  );
  const idempotencyKey = readOptionalBodyString(body.idempotencyKey);
  const sourceRef = readOptionalBodyString(body.intentId) ?? idempotencyKey;
  if (providerDispatchClaimRelease && failedAt) {
    const release = await releaseHostedLinqRuntimeProviderDispatchFenceTx({
      attemptedAt,
      failedAt,
      idempotencyKey: idempotencyKey ?? "",
      prisma,
      sourceRef: sourceRef ?? "",
    });
    if (!release.released) {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_PROVIDER_DISPATCH_CLAIM_RELEASE_CONFLICT",
        httpStatus: 409,
        message: "Hosted Linq provider dispatch claim could not be released.",
        retryable: false,
      });
    }
    return jsonOk({
      ok: true,
      providerDispatchClaimReleased: true,
      recorded: true,
    });
  }
  const answeredMailboxItemIds = acceptedAt
    ? parseAnsweredMailboxItemIds(body.answeredMailboxItemIds)
    : [];
  const providerTarget = readOptionalBodyString(body.providerTarget);
  const providerThreadId = readOptionalBodyString(body.providerThreadId);
  const target = readOptionalBodyString(body.target);
  const fromPhoneNumber = readOptionalBodyString(body.fromPhoneNumber);
  const lineLookupKey = readOptionalBodyString(body.lineLookupKey);
  const linqChatId = providerThreadId
    ?? (targetKind === "participant" ? null : providerTarget ?? target);
  const routeLineLookupKey = lineLookupKey
    ?? (fromPhoneNumber
      ? null
      : await readHostedLinqDeliveryMemberRouteLineLookupKey({
        linqChatId,
        memberId: userId,
        prisma,
      }));
  const result = await recordHostedLinqRuntimeDeliveryOutcomeTx({
    acceptedAt,
    answeredMailboxItemIds,
    attemptedAt,
    failedAt,
    failureCode: readOptionalBodyString(body.failureCode),
    failureReason: readOptionalBodyString(body.failureReason),
    idempotencyKey,
    linqChatId,
    messageId: readOptionalBodyString(body.providerMessageId),
    phoneNumber: routeLineLookupKey ? null : fromPhoneNumber,
    phoneNumberLookupKey: routeLineLookupKey,
    prisma,
    sourceRef,
    targetKind,
    threadIsDirect,
    userId,
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
