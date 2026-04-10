import type { FormEvent } from "react";

import {
  maskPhoneNumber,
  normalizePhoneNumberForCountry,
} from "@/src/lib/hosted-onboarding/phone";
import {
  ensureHostedPrivyPhoneReady,
  HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS,
  type HostedPrivyFinalizationState,
  type HostedPrivyClientPendingAction,
} from "@/src/lib/hosted-onboarding/privy-client";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "./client-api";
import type {
  HostedPhoneAuthIntent,
  HostedPhoneVerificationAttempt,
  HostedResolvedPhoneSubmission,
} from "./hosted-phone-auth-types";

interface HostedPrivyFinalizationAttemptInput {
  action: "continue" | "verify-code";
  finalize: () => Promise<void>;
  getFinalizationState: () => HostedPrivyFinalizationState;
  setPendingAction: (action: HostedPrivyClientPendingAction) => void;
  updateFinalizationState: (nextState: HostedPrivyFinalizationState) => void;
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

export async function runHostedPrivyFinalizationAttempt({
  action,
  finalize,
  getFinalizationState,
  setPendingAction,
  updateFinalizationState,
}: HostedPrivyFinalizationAttemptInput): Promise<void> {
  if (getFinalizationState() !== "idle") {
    return;
  }

  setPendingAction(action);
  updateFinalizationState("running");

  try {
    await finalize();
    updateFinalizationState("completed");
  } catch (error) {
    updateFinalizationState("idle");
    throw error;
  } finally {
    if (getFinalizationState() !== "running") {
      setPendingAction(null);
    }
  }
}

export async function finalizeHostedPrivyVerification(input: {
  createWallet: () => Promise<unknown>;
  inviteCode?: string | null;
  intent: HostedPhoneAuthIntent;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  user: { linkedAccounts?: unknown } | null;
}) {
  await ensureHostedPrivyPhoneReady(input);
  const payload = await requestHostedPrivyCompletionWithRetry(input.inviteCode);

  if (input.onCompleted) {
    await input.onCompleted(payload);
    return;
  }

  window.location.assign(resolveHostedPrivyCompletionRedirectUrl({
    intent: input.intent,
    payload,
  }));
}

export function resolveHostedPrivyCompletionRedirectUrl(input: {
  intent: HostedPhoneAuthIntent;
  payload: HostedPrivyCompletionPayload;
}): string {
  if (input.intent === "signin" && input.payload.stage === "active") {
    return "/settings";
  }

  return `/join/${encodeURIComponent(input.payload.inviteCode)}`;
}

export function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
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

function isRetryableHostedPrivyCompletionError(error: unknown): boolean {
  if (!(error instanceof HostedOnboardingApiError)) {
    return false;
  }

  if (error.code === "AUTH_REQUIRED") {
    return true;
  }

  return (
    error.retryable &&
    (error.code === "PRIVY_PHONE_NOT_READY" || error.code === "PRIVY_WALLET_NOT_READY")
  );
}

async function requestHostedPrivyCompletionWithRetry(
  inviteCode?: string | null,
): Promise<HostedPrivyCompletionPayload> {
  let lastError: unknown = null;

  for (const delayMs of HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      return await requestHostedOnboardingJson<HostedPrivyCompletionPayload>({
        payload: inviteCode ? { inviteCode } : {},
        url: "/api/hosted-onboarding/privy/complete",
      });
    } catch (error) {
      lastError = error;

      if (!isRetryableHostedPrivyCompletionError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("We could not verify your Privy session.");
}

async function confirmInvitePhoneCodeSend(input: {
  inviteCode: string;
  sendAttemptId: string;
}): Promise<boolean> {
  for (const delayMs of HOSTED_INVITE_SEND_CONFIRM_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
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

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
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
