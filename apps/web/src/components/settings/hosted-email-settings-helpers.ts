import {
  extractHostedPrivyPreferredEmailAccount,
  extractHostedPrivyVerifiedEmailAccount,
  isHostedPrivyEmailAccountVerified,
  type HostedPrivyEmailAccount,
  type PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";

import {
  isRecord,
  readOptionalJsonObject,
  retrySyncOperation,
  toErrorMessage,
} from "./hosted-settings-sync-helpers";

export interface HostedEmailSyncResult {
  emailAddress: string;
  runTriggered: boolean;
  verifiedAt: string;
}

export interface HostedEmailSettingsDisplayState {
  currentEmail: HostedPrivyEmailAccount | null;
  currentVerifiedEmail: (HostedPrivyEmailAccount & { verifiedAt: number }) | null;
  normalizedCurrentEmail: string | null;
}

export type HostedEmailSyncMode = "resync" | "verify";

export interface HostedEmailSyncPresentation {
  errorMessage: string | null;
  successMessage: string | null;
  syncResult: HostedEmailSyncResult | null;
}

export function resolveHostedEmailSettingsDisplayState(input: {
  linkedAccounts: readonly PrivyLinkedAccountLike[];
  verifiedEmailOverride?: HostedPrivyEmailAccount | null;
}): HostedEmailSettingsDisplayState {
  const currentEmail = input.verifiedEmailOverride ?? extractHostedPrivyPreferredEmailAccount(input.linkedAccounts);
  const currentVerifiedEmail = isHostedPrivyEmailAccountVerified(input.verifiedEmailOverride)
    ? input.verifiedEmailOverride
    : extractHostedPrivyVerifiedEmailAccount(input.linkedAccounts);

  return {
    currentEmail,
    currentVerifiedEmail,
    normalizedCurrentEmail: normalizeComparableEmail(currentEmail?.address ?? null),
  };
}

export async function syncHostedVerifiedEmailAddress(input: {
  fetchImpl?: typeof fetch;
  mode: HostedEmailSyncMode;
  sleepImpl?: (delayMs: number) => Promise<void>;
  verifiedEmailAddress: string;
}): Promise<HostedEmailSyncPresentation> {
  try {
    const syncResult = await syncHostedEmailConnectionWithRetry(input.verifiedEmailAddress, {
      fetchImpl: input.fetchImpl,
      sleepImpl: input.sleepImpl,
    });

    return {
      errorMessage: null,
      successMessage: formatHostedEmailSyncSuccessMessage(syncResult, input.mode),
      syncResult,
    };
  } catch (error) {
    return {
      errorMessage: toHostedEmailSyncErrorMessage(error),
      successMessage: input.mode === "verify" ? `Email verified: ${input.verifiedEmailAddress}` : null,
      syncResult: null,
    };
  }
}

export function normalizeEmailAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function normalizeComparableEmail(value: string | null | undefined): string | null {
  const normalized = normalizeEmailAddress(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

export async function syncHostedEmailConnectionWithRetry(
  expectedEmailAddress: string,
  input: {
    fetchImpl?: typeof fetch;
    sleepImpl?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<HostedEmailSyncResult> {
  return retrySyncOperation({
    errorFactory: (message) => new HostedEmailSyncError(null, message),
    operation: () => syncHostedEmailConnection(expectedEmailAddress, input.fetchImpl ?? fetch),
    retryable: (error) => error instanceof HostedEmailSyncError && error.code === "PRIVY_EMAIL_NOT_READY",
    sleepImpl: input.sleepImpl,
    timeoutMessage:
      "We verified your email, but the hosted assistant could not confirm it yet. Refresh and try again.",
  });
}

export class HostedEmailSyncError extends Error {
  readonly code: string | null;

  constructor(code: string | null, message: string) {
    super(message);
    this.name = "HostedEmailSyncError";
    this.code = code;
  }
}

function formatHostedEmailSyncSuccessMessage(
  syncResult: HostedEmailSyncResult,
  mode: HostedEmailSyncMode,
): string {
  if (mode === "verify") {
    return syncResult.runTriggered
      ? `Email verified and connected: ${syncResult.emailAddress}`
      : `Email verified and saved: ${syncResult.emailAddress}. Your hosted assistant will finish syncing it on the next hosted run.`;
  }

  return syncResult.runTriggered
    ? `Hosted email synced: ${syncResult.emailAddress}`
    : `Verified email saved: ${syncResult.emailAddress}. Your hosted assistant will finish syncing it on the next hosted run.`;
}

async function syncHostedEmailConnection(
  expectedEmailAddress: string,
  fetchImpl: typeof fetch,
): Promise<HostedEmailSyncResult> {
  const response = await fetchImpl("/api/settings/email/sync", {
    body: JSON.stringify({
      expectedEmailAddress,
    }),
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  const payload = await readOptionalJsonObject(response);

  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;

    throw new HostedEmailSyncError(
      typeof errorPayload?.code === "string" ? errorPayload.code : null,
      typeof errorPayload?.message === "string"
        ? errorPayload.message
        : "We could not sync your verified email to the hosted assistant yet.",
    );
  }

  if (
    !isRecord(payload)
    || payload.ok !== true
    || typeof payload.emailAddress !== "string"
    || typeof payload.verifiedAt !== "string"
  ) {
    throw new HostedEmailSyncError(
      null,
      "We verified your email, but the hosted assistant returned an unexpected sync response.",
    );
  }

  return {
    emailAddress: payload.emailAddress,
    runTriggered: payload.runTriggered !== false,
    verifiedAt: payload.verifiedAt,
  };
}

function toHostedEmailSyncErrorMessage(error: unknown): string {
  if (error instanceof HostedEmailSyncError) {
    return error.message;
  }

  return toErrorMessage(
    error,
    "We verified your email, but we could not sync it to the hosted assistant yet. Refresh and try again.",
  );
}
