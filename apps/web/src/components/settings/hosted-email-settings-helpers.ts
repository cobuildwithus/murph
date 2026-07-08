import {
  extractHostedPrivyPreferredEmailAccount,
  extractHostedPrivyVerifiedEmailAccount,
  isHostedPrivyEmailAccountVerified,
  type HostedPrivyEmailAccount,
  type PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";

import {
  isRecord,
  readJsonErrorDetails,
  readOptionalJsonObject,
  retrySyncOperation,
  toErrorMessage,
} from "./hosted-settings-sync-helpers";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "../hosted-onboarding/client-api";

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
      "Your email is verified, but Murph couldn't confirm it yet. Refresh and try again.",
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
      : `Email verified and saved: ${syncResult.emailAddress}. Murph will finish connecting it shortly.`;
  }

  return syncResult.runTriggered
    ? `Email connected: ${syncResult.emailAddress}`
    : `Email saved: ${syncResult.emailAddress}. Murph will finish connecting it shortly.`;
}

async function syncHostedEmailConnection(
  expectedEmailAddress: string,
  fetchImpl: typeof fetch,
): Promise<HostedEmailSyncResult> {
  if (fetchImpl === fetch) {
    try {
      const payload = await requestHostedOnboardingJson<{
        emailAddress: string;
        runTriggered?: boolean;
        verifiedAt: string;
      }>({
        payload: {
          expectedEmailAddress,
        },
        url: "/api/settings/email/sync",
      });

      return {
        emailAddress: payload.emailAddress,
        runTriggered: payload.runTriggered !== false,
        verifiedAt: payload.verifiedAt,
      };
    } catch (error) {
      if (error instanceof HostedOnboardingApiError) {
        throw new HostedEmailSyncError(
          error.code,
          error.message,
        );
      }
      throw error;
    }
  }

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
    const errorDetails = readJsonErrorDetails(payload);

    throw new HostedEmailSyncError(
      errorDetails.code,
      errorDetails.message ?? "We couldn't finish connecting your email to Murph yet.",
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
      "Your email is verified, but we couldn't confirm the connection. Refresh and try again.",
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
    "Your email is verified, but we couldn't finish connecting it to Murph. Refresh and try again.",
  );
}
