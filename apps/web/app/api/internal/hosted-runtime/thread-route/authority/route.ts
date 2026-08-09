import {
  parseHostedExecutionPrivateAssistantAskCompletionDeliveryAuthority,
  parseHostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  assertHostedAssistantAskCompletionDeliveryAuthorityTx,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import {
  assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx,
} from "@/src/lib/hosted-groups/group-current-sender-assistant-ask";
import {
  assertHostedAssistantNotificationRouteAuthority,
} from "@/src/lib/hosted-routing/assistant-notification-destination";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_THREAD_ROUTE_AUTHORITY_BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_THREAD_ROUTE_AUTHORITY_BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const assistantAskCompletion = parseAssistantAskCompletionAuthority(
    body.assistantAskCompletion,
  );
  const privateAssistantAskCompletion =
    parsePrivateAssistantAskCompletionAuthority(
      body.privateAssistantAskCompletion,
      body.authority,
    );
  if (assistantAskCompletion && privateAssistantAskCompletion) {
    throwInvalidAssistantAskCompletionAuthority();
  }
  if (privateAssistantAskCompletion) {
    const bodyKeys = Object.keys(body);
    if (
      bodyKeys.length !== 2
      || !bodyKeys.includes("authority")
      || !bodyKeys.includes("privateAssistantAskCompletion")
    ) {
      throwInvalidAssistantAskCompletionAuthority();
    }
    await getPrisma().$transaction(async (tx) => {
      await assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx({
        ...privateAssistantAskCompletion,
        boundRuntimeMemberId: memberId,
        tx,
      });
    });
    return jsonOk({ authorized: true });
  }
  const authority = parseHostedExecutionExternalThreadRouteAuthority(
    assistantAskCompletion ? body.authority : body,
  );
  if (authority.containerMemberId !== memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      httpStatus: 403,
      message: "Hosted thread route is not authorized for this runtime.",
      retryable: false,
    });
  }

  const assertion = await getPrisma().$transaction(async (tx) => {
    await assertHostedAssistantNotificationRouteAuthority({
      authority,
      prisma: tx,
    });
    if (!assistantAskCompletion) {
      return;
    }
    return await assertHostedAssistantAskCompletionDeliveryAuthorityTx({
      ...assistantAskCompletion,
      boundRuntimeMemberId: memberId,
      tx,
    });
  });
  return jsonOk({
    authorized: true,
    ...(assertion?.assistantAskFallbackRequired
      ? { assistantAskFallbackRequired: true }
      : {}),
  });
});

interface AssistantAskCompletionAuthority {
  answeredMailboxItemIds: readonly string[];
  assistantAskCompletionExpiresAt: string;
  assistantAskFallback: boolean;
  idempotencyKey: string;
}

function parsePrivateAssistantAskCompletionAuthority(
  value: unknown,
  route: unknown,
) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throwInvalidAssistantAskCompletionAuthority();
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "answeredMailboxItemIds",
    "expiresAt",
    "idempotencyKey",
    "responseTextDigest",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throwInvalidAssistantAskCompletionAuthority();
  }
  try {
    return parseHostedExecutionPrivateAssistantAskCompletionDeliveryAuthority({
      answeredMailboxItemIds: input.answeredMailboxItemIds,
      assistantAskCompletionExpiresAt: input.expiresAt,
      idempotencyKey: input.idempotencyKey,
      responseTextDigest: input.responseTextDigest,
      route,
    });
  } catch {
    throwInvalidAssistantAskCompletionAuthority();
  }
}

function parseAssistantAskCompletionAuthority(
  value: unknown,
): AssistantAskCompletionAuthority | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throwInvalidAssistantAskCompletionAuthority();
  }
  const input = value as Record<string, unknown>;
  const answeredMailboxItemIds = input.answeredMailboxItemIds;
  const assistantAskCompletionExpiresAt =
    parseRequiredCanonicalTimestamp(input.assistantAskCompletionExpiresAt);
  if (
    !Array.isArray(answeredMailboxItemIds)
    || answeredMailboxItemIds.length !== 1
    || answeredMailboxItemIds.some(
      (item) => typeof item !== "string" || item.trim().length === 0,
    )
    || typeof input.assistantAskFallback !== "boolean"
    || typeof input.idempotencyKey !== "string"
    || input.idempotencyKey.trim().length === 0
  ) {
    throwInvalidAssistantAskCompletionAuthority();
  }
  return {
    answeredMailboxItemIds: answeredMailboxItemIds.map((item) => item.trim()),
    assistantAskCompletionExpiresAt,
    assistantAskFallback: input.assistantAskFallback,
    idempotencyKey: input.idempotencyKey.trim(),
  };
}

function parseRequiredCanonicalTimestamp(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  const parsed = Date.parse(normalized);
  if (
    normalized
    && Number.isFinite(parsed)
    && new Date(parsed).toISOString() === normalized
  ) {
    return normalized;
  }
  throwInvalidAssistantAskCompletionAuthority();
}

function throwInvalidAssistantAskCompletionAuthority(): never {
  throw hostedOnboardingError({
    code: "HOSTED_THREAD_ROUTE_ASSISTANT_ASK_AUTHORITY_INVALID",
    httpStatus: 400,
    message: "Hosted thread route Assistant Ask authority is invalid.",
    retryable: false,
  });
}
