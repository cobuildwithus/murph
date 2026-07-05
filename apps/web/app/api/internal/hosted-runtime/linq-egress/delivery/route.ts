import type {
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
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
  assertHostedLinqRouteAuthorityMatchesTarget,
} from "@/src/lib/hosted-onboarding/linq-egress-engagement";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  assertHostedThreadRouteEgressAuthority,
} from "@/src/lib/hosted-routing/thread-route-store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_LINQ_EGRESS_DELIVERY_BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_EGRESS_DELIVERY_BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const prisma = getPrisma();
  const routeAuthority = parseHostedLinqDeliveryRouteAuthority(body.routeAuthority);
  const currentInbound = parseHostedLinqDeliveryCurrentInbound(body.currentInbound);
  const targetKind = parseHostedLinqDeliveryTargetKind(body.targetKind);
  const acceptedAt = parseOptionalHostedLinqDeliveryDate(
    body.acceptedAt,
    "acceptedAt",
  );
  const failedAt = parseOptionalHostedLinqDeliveryDate(body.failedAt, "failedAt");

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
  const providerTarget = readOptionalBodyString(body.providerTarget);
  const providerThreadId = readOptionalBodyString(body.providerThreadId);
  const target = readOptionalBodyString(body.target);
  const fromPhoneNumber = readOptionalBodyString(body.fromPhoneNumber);
  const linqChatId = providerThreadId
    ?? (targetKind === "participant" ? null : providerTarget ?? target);
  const validatedRouteAuthority = routeAuthority
    ? assertHostedLinqRouteAuthorityMatchesTarget({
        chatId: linqChatId,
        memberId: userId,
        routeAuthority,
      })
    : null;
  let routeLineLookupKey: string | null = null;
  if (validatedRouteAuthority) {
    routeLineLookupKey = await readHostedLinqDeliveryRouteLineLookupKey({
      memberId: userId,
      prisma,
      routeAuthority: validatedRouteAuthority,
    });
  } else if (!fromPhoneNumber) {
    routeLineLookupKey = await readHostedLinqDeliveryMemberRouteLineLookupKey({
      linqChatId,
      memberId: userId,
      prisma,
    });
  }
  const result = await recordHostedLinqRuntimeDeliveryOutcomeTx({
    acceptedAt,
    answeredMailboxItemId: currentInbound?.mailboxItemId ?? null,
    attemptedAt,
    failedAt,
    failureCode: readOptionalBodyString(body.failureCode),
    failureReason: readOptionalBodyString(body.failureReason),
    idempotencyKey: readOptionalBodyString(body.idempotencyKey),
    linqChatId,
    messageId: readOptionalBodyString(body.providerMessageId),
    phoneNumber: routeLineLookupKey ? null : fromPhoneNumber,
    phoneNumberLookupKey: routeLineLookupKey,
    prisma,
    sourceRef: readOptionalBodyString(body.intentId)
      ?? readOptionalBodyString(body.idempotencyKey),
    targetKind,
    userId,
  });

  return jsonOk({
    ok: true,
    recorded: result.recorded,
  });
});

async function readHostedLinqDeliveryRouteLineLookupKey(input: {
  memberId: string;
  prisma: ReturnType<typeof getPrisma>;
  routeAuthority: HostedExecutionLinqExternalThreadRouteAuthority;
}): Promise<string> {
  if (input.routeAuthority.containerMemberId !== input.memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_ROUTE_BOUND_USER_MISMATCH",
      httpStatus: 403,
      message: "Linq delivery route authority does not match the runtime user.",
      retryable: false,
    });
  }

  const route = await assertHostedThreadRouteEgressAuthority({
    authority: input.routeAuthority,
    prisma: input.prisma,
  });
  return route.accountLookupKey;
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

function parseHostedLinqDeliveryRouteAuthority(
  value: unknown,
): HostedExecutionLinqExternalThreadRouteAuthority | null {
  if (value === undefined || value === null) {
    return null;
  }

  const authority = parseHostedExecutionExternalThreadRouteAuthority(
    value,
    "Hosted Linq delivery request route authority",
  );
  if (authority.channel !== "linq") {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_ROUTE_AUTHORITY_MISMATCH",
      httpStatus: 403,
      message: "Linq delivery route authority must be for a Linq thread.",
      retryable: false,
    });
  }

  return {
    ...authority,
    channel: "linq",
  };
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

function parseHostedLinqDeliveryCurrentInbound(value: unknown): {
  mailboxItemId: string;
} | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_CURRENT_INBOUND_INVALID",
      httpStatus: 400,
      message: "Hosted Linq delivery current inbound proof is invalid.",
      retryable: false,
    });
  }
  const record = value as Record<string, unknown>;
  const mailboxItemId = readOptionalBodyString(record.mailboxItemId);
  if (!mailboxItemId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_DELIVERY_CURRENT_INBOUND_INVALID",
      httpStatus: 400,
      message: "Hosted Linq delivery current inbound mailbox item is invalid.",
      retryable: false,
    });
  }
  return { mailboxItemId };
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
