import type { FormEvent } from "react";

import {
  maskPhoneNumber,
  normalizePhoneNumberForCountry,
} from "@/src/lib/hosted-onboarding/phone";
import type { HostedPrivyClientPendingAction } from "@/src/lib/hosted-onboarding/privy-client";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  completeHostedPrivyAuth,
  type HostedAuthCompletionResult,
} from "./hosted-auth-completion";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";
import { HostedOnboardingApiError, requestHostedOnboardingJson } from "./client-api";
import type {
  HostedPhoneLinkPayload,
  HostedPhoneVerificationAttempt,
  HostedResolvedPhoneSubmission,
} from "./hosted-phone-auth-types";
import {
  requestHostedPrivyCompletionWithRetry,
  runHostedPrivyFinalizationAttempt,
} from "./hosted-privy-auth-support";
import { waitForRetryDelay } from "./hosted-retry-support";

export {
  requestHostedPrivyCompletionWithRetry,
  runHostedPrivyFinalizationAttempt,
};
export { toErrorMessage } from "./hosted-auth-shared";

export async function runHostedPhonePendingAction<TResult>(input: {
  action: HostedPrivyClientPendingAction;
  onBeforeAction?: () => void;
  onError?: (error: unknown) => void;
  run: () => Promise<TResult>;
  setPendingAction: (action: HostedPrivyClientPendingAction) => void;
  shouldClearPendingAction?: () => boolean;
}): Promise<TResult | null> {
  input.onBeforeAction?.();
  input.setPendingAction(input.action);

  try {
    return await input.run();
  } catch (error) {
    input.onError?.(error);
    return null;
  } finally {
    if (input.shouldClearPendingAction?.() ?? true) {
      input.setPendingAction(null);
    }
  }
}

interface PendingInvitePhoneCodeMutation {
  inviteCode: string;
  kind: "abort" | "confirm";
  sendAttemptId: string;
}

type HostedPhoneResendTarget =
  | { kind: "active-attempt"; phoneNumber: string }
  | { kind: "draft-submit" };

const HOSTED_INVITE_SEND_CONFIRM_RETRY_DELAYS_MS = [0, 250, 1_000] as const;
const HOSTED_INVITE_PHONE_CODE_MUTATION_STORAGE_KEY = "murph.hosted-onboarding.invite-phone-code-mutation";
const HOSTED_PRIVY_ACCOUNT_CONFLICT_CODES = new Set([
  "PRIVY_IDENTITY_CONFLICT",
  "PRIVY_USER_MISMATCH",
]);

export function isHostedPrivyAccountConflictError(error: unknown): boolean {
  return (
    error instanceof HostedOnboardingApiError
    && error.code !== null
    && HOSTED_PRIVY_ACCOUNT_CONFLICT_CODES.has(error.code)
  );
}

export function createHostedPhoneVerificationAttempt(phoneNumber: string): HostedPhoneVerificationAttempt {
  return {
    maskedPhoneNumber: maskPhoneNumber(phoneNumber),
    phoneNumber,
  };
}

export function resolveHostedPhoneSubmission(input: {
  countryDialCode: string;
  draftPhoneNumber: string;
  submittedPhoneNumber: string | null;
}): HostedResolvedPhoneSubmission {
  const draftPhoneNumber = input.submittedPhoneNumber ?? input.draftPhoneNumber;

  return {
    draftPhoneNumber,
    normalizedPhoneNumber: normalizePhoneNumberForCountry(draftPhoneNumber, input.countryDialCode),
  };
}

export function normalizeHostedPhoneVerificationCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isHostedPhoneVerificationCodeComplete(value: string): boolean {
  return value.length === 6;
}

export function resolveHostedPhoneResendTarget(input: {
  phoneVerificationAttempt: HostedPhoneVerificationAttempt | null;
}): HostedPhoneResendTarget {
  if (input.phoneVerificationAttempt) {
    return {
      kind: "active-attempt",
      phoneNumber: input.phoneVerificationAttempt.phoneNumber,
    };
  }

  return { kind: "draft-submit" };
}

export function readSubmittedPhoneNumber(event: FormEvent<HTMLFormElement> | undefined): string | null {
  if (!event) {
    return null;
  }

  const formData = new FormData(event.currentTarget);
  const value = formData.get("phone-number");
  return typeof value === "string" ? value : null;
}

export async function finalizeHostedPrivyVerification(input: {
  inviteCode?: string | null;
  onAuthCompleted?: (result: HostedAuthCompletionResult) => Promise<void> | void;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
}) {
  const result = await completeHostedPrivyAuth({
    authMethod: "phone",
    inviteCode: input.inviteCode,
  });

  if (input.onAuthCompleted) {
    await input.onAuthCompleted(result);
    return;
  }

  if (input.onCompleted) {
    await input.onCompleted(result.payload);
    return;
  }

  navigateHostedAuthRedirect(result.redirectUrl);
}

export async function finalizeHostedPhoneLink(input: {
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
}): Promise<void> {
  const payload = await requestHostedPhoneLinkSyncWithRetry();
  await input.onLinked?.(payload);
}

export async function requestHostedPhoneLinkSyncWithRetry(): Promise<HostedPhoneLinkPayload> {
  let lastError: unknown = null;

  for (const delayMs of [0, 500] as const) {
    if (delayMs > 0) {
      await waitForRetryDelay(delayMs);
    }

    try {
      return await requestHostedOnboardingJson<HostedPhoneLinkPayload>({
        method: "POST",
        url: "/api/settings/phone/sync",
      });
    } catch (error) {
      lastError = error;

      if (!isRetryableHostedPhoneLinkError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("We could not save your verified phone number.");
}

function isRetryableHostedPhoneLinkError(error: unknown): boolean {
  if (!(error instanceof HostedOnboardingApiError)) {
    return false;
  }

  if (error.code === "AUTH_REQUIRED") {
    return true;
  }

  return (
    error.retryable
    && (error.code === "PRIVY_ACCOUNT_NOT_READY"
      || error.code === "PRIVY_PHONE_NOT_READY")
  );
}

export async function finalizeInvitePhoneCodeSendConfirmation(input: {
  confirm?: (input: { inviteCode: string; sendAttemptId: string }) => Promise<boolean>;
  inviteCode: string;
  sendAttemptId: string;
  writePending?: (input: PendingInvitePhoneCodeMutation) => void;
}): Promise<void> {
  const confirm = input.confirm ?? confirmInvitePhoneCodeSend;
  const writePending = input.writePending ?? writePendingInvitePhoneCodeMutation;
  try {
    const confirmSucceeded = await confirm({
      inviteCode: input.inviteCode,
      sendAttemptId: input.sendAttemptId,
    });

    if (confirmSucceeded) {
      return;
    }
  } catch {
    // Queue a retry below.
  }

  writePending({
    inviteCode: input.inviteCode,
    kind: "confirm",
    sendAttemptId: input.sendAttemptId,
  });
}

export function queuePendingInvitePhoneCodeMutation(input: {
  inviteCode: string;
  kind: "abort" | "confirm";
  sendAttemptId: string;
}) {
  writePendingInvitePhoneCodeMutation(input);
}

export async function abortInvitePhoneCodeSend(input: {
  inviteCode: string;
  sendAttemptId: string;
}): Promise<boolean> {
  try {
    await requestHostedOnboardingJson<{ ok: true }>({
      method: "POST",
      payload: {
        sendAttemptId: input.sendAttemptId,
      },
      keepalive: true,
      url: `/api/hosted-onboarding/invites/${encodeURIComponent(input.inviteCode)}/send-code/abort`,
    });
    clearPendingInvitePhoneCodeMutation(input.inviteCode, input.sendAttemptId);
    return true;
  } catch {
    return false;
  }
}

export async function flushPendingInvitePhoneCodeMutation(inviteCode: string): Promise<void> {
  const pending = readPendingInvitePhoneCodeMutation();

  if (!pending || pending.inviteCode !== inviteCode) {
    return;
  }

  const succeeded =
    pending.kind === "confirm"
      ? await confirmInvitePhoneCodeSend({
          inviteCode,
          sendAttemptId: pending.sendAttemptId,
        })
      : await abortInvitePhoneCodeSend({
          inviteCode,
          sendAttemptId: pending.sendAttemptId,
        });

  if (succeeded) {
    clearPendingInvitePhoneCodeMutation(inviteCode, pending.sendAttemptId);
  }
}

async function confirmInvitePhoneCodeSend(input: {
  inviteCode: string;
  sendAttemptId: string;
}): Promise<boolean> {
  for (const delayMs of HOSTED_INVITE_SEND_CONFIRM_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await waitForRetryDelay(delayMs);
    }

    try {
      await requestHostedOnboardingJson<{ ok: true }>({
        method: "POST",
        payload: {
          sendAttemptId: input.sendAttemptId,
        },
        keepalive: true,
        url: `/api/hosted-onboarding/invites/${encodeURIComponent(input.inviteCode)}/send-code/confirm`,
      });
      clearPendingInvitePhoneCodeMutation(input.inviteCode, input.sendAttemptId);
      return true;
    } catch {
      // Retry the confirm a few times before falling back to queued retry.
    }
  }

  return false;
}

function readPendingInvitePhoneCodeMutation(): PendingInvitePhoneCodeMutation | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(HOSTED_INVITE_PHONE_CODE_MUTATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.inviteCode !== "string"
      || typeof value.kind !== "string"
      || (value.kind !== "abort" && value.kind !== "confirm")
      || typeof value.sendAttemptId !== "string"
    ) {
      return null;
    }

    return {
      inviteCode: value.inviteCode,
      kind: value.kind,
      sendAttemptId: value.sendAttemptId,
    };
  } catch {
    return null;
  }
}

function writePendingInvitePhoneCodeMutation(input: PendingInvitePhoneCodeMutation): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      HOSTED_INVITE_PHONE_CODE_MUTATION_STORAGE_KEY,
      JSON.stringify(input),
    );
  } catch {
    // Local storage is best effort only.
  }
}

function clearPendingInvitePhoneCodeMutation(inviteCode: string, sendAttemptId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const pending = readPendingInvitePhoneCodeMutation();
  if (!pending || pending.inviteCode !== inviteCode || pending.sendAttemptId !== sendAttemptId) {
    return;
  }

  try {
    window.localStorage.removeItem(HOSTED_INVITE_PHONE_CODE_MUTATION_STORAGE_KEY);
  } catch {
    // Local storage is best effort only.
  }
}
