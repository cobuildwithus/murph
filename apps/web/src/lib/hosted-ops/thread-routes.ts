import "server-only";

import type {
  HostedThreadContainerRouteEnsureResult,
} from "../hosted-routing/thread-container-service";
import {
  ensureHostedThreadContainerRoute,
} from "../hosted-routing/thread-container-service";
import {
  createHostedPhoneLookupKey,
} from "../hosted-onboarding/contact-privacy";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";

export interface HostedOpsLinqThreadRouteEnsureInput {
  containerMemberId?: string | null;
  linqAccountPhoneNumber: string | null | undefined;
  linqChatId: string | number | null | undefined;
  ownerMemberId: string | null | undefined;
}

export interface HostedOpsLinqThreadRouteEnsureResult {
  activationEventId: string | null;
  activationMailboxItemId: string | null;
  containerMemberId: string;
  created: boolean;
}

export async function ensureHostedOpsLinqThreadRoute(
  input: HostedOpsLinqThreadRouteEnsureInput,
): Promise<HostedOpsLinqThreadRouteEnsureResult> {
  const ownerMemberId = normalizeRequiredOpsString(
    input.ownerMemberId,
    "HOSTED_OPS_THREAD_ROUTE_OWNER_MEMBER_ID_REQUIRED",
    "Owner member id is required.",
  );
  const linqChatId = normalizeRequiredOpsString(
    input.linqChatId,
    "HOSTED_OPS_THREAD_ROUTE_LINQ_CHAT_ID_REQUIRED",
    "Linq chat id is required.",
  );
  const accountLookupKey = createHostedPhoneLookupKey(input.linqAccountPhoneNumber);
  if (!accountLookupKey) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_THREAD_ROUTE_LINQ_ACCOUNT_PHONE_INVALID",
      httpStatus: 400,
      message: "A valid Linq recipient phone number is required.",
      retryable: false,
    });
  }

  return projectHostedOpsThreadRouteResult(await ensureHostedThreadContainerRoute({
    accountLookupKey,
    channel: "linq",
    containerMemberId: normalizeOptionalOpsString(input.containerMemberId),
    ownerMemberId,
    threadId: linqChatId,
  }));
}

function projectHostedOpsThreadRouteResult(
  result: HostedThreadContainerRouteEnsureResult,
): HostedOpsLinqThreadRouteEnsureResult {
  return {
    activationEventId: result.activationEventId,
    activationMailboxItemId: result.activationMailboxItemId,
    containerMemberId: result.containerMemberId,
    created: result.created,
  };
}

function normalizeRequiredOpsString(
  value: string | number | null | undefined,
  code: string,
  message: string,
): string {
  const normalized = normalizeOptionalOpsString(value);
  if (!normalized) {
    throw hostedOnboardingError({
      code,
      httpStatus: 400,
      message,
      retryable: false,
    });
  }

  return normalized;
}

function normalizeOptionalOpsString(value: string | number | null | undefined): string | null {
  const normalized = typeof value === "number"
    ? String(value).trim()
    : value?.trim() ?? "";

  return normalized.length > 0 ? normalized : null;
}
