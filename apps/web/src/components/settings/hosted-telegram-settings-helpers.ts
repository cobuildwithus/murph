import {
  extractHostedPrivyTelegramAccount,
  type HostedPrivyLinkedAccountContainer,
  type HostedPrivyTelegramAccount,
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

export interface HostedTelegramSyncResult {
  botLink: string | null;
  runTriggered: boolean;
  telegramUserId: string;
  telegramUsername: string | null;
}

export interface HostedTelegramSettingsDisplayState {
  currentTelegram: HostedPrivyTelegramAccount | null;
}

export type HostedTelegramSyncMode = "link" | "resync";
export type HostedTelegramSyncOverride = Pick<HostedPrivyTelegramAccount, "telegramUserId" | "username">;

export interface HostedTelegramSyncPresentation {
  errorMessage: string | null;
  successMessage: string | null;
  syncResult: HostedTelegramSyncResult | null;
}

export function resolveHostedTelegramSettingsDisplayState(input: {
  initialTelegramAccount?: HostedTelegramSyncOverride | null;
  syncedTelegramOverride?: HostedTelegramSyncOverride | null;
}): HostedTelegramSettingsDisplayState {
  const currentTelegram = input.syncedTelegramOverride
    ? toHostedTelegramDisplayAccount(input.syncedTelegramOverride)
    : input.initialTelegramAccount
      ? toHostedTelegramDisplayAccount(input.initialTelegramAccount)
      : null;

  return {
    currentTelegram,
  };
}

export function resolveHostedPrivyTelegramDisplayState(
  user: HostedPrivyLinkedAccountContainer | null | undefined,
): HostedTelegramSettingsDisplayState {
  return {
    currentTelegram: extractHostedPrivyTelegramAccount(user),
  };
}

export function formatHostedTelegramDisplayValue(
  telegram: {
    telegramUserId?: string | null;
    username?: string | null;
  } | null | undefined,
): string | null {
  if (!telegram?.telegramUserId) {
    return null;
  }

  return telegram.username ? `@${telegram.username}` : "Connected";
}

function toHostedTelegramDisplayAccount(
  account: HostedTelegramSyncOverride,
): HostedPrivyTelegramAccount {
  return {
    firstName: null,
    lastName: null,
    photoUrl: null,
    telegramUserId: account.telegramUserId,
    username: account.username,
  };
}

export async function syncHostedLinkedTelegram(input: {
  expectedTelegramUserId: string;
  fetchImpl?: typeof fetch;
  mode: HostedTelegramSyncMode;
  sleepImpl?: (delayMs: number) => Promise<void>;
}): Promise<HostedTelegramSyncPresentation> {
  try {
    const syncResult = await syncHostedTelegramConnectionWithRetry({
      expectedTelegramUserId: input.expectedTelegramUserId,
      fetchImpl: input.fetchImpl,
      sleepImpl: input.sleepImpl,
    });

    return {
      errorMessage: null,
      successMessage: formatHostedTelegramSyncSuccessMessage(syncResult, input.mode),
      syncResult,
    };
  } catch (error) {
    return {
      errorMessage: toHostedTelegramSyncErrorMessage(error),
      successMessage: input.mode === "link" ? "Telegram linked in Privy." : null,
      syncResult: null,
    };
  }
}

export class HostedTelegramSyncError extends Error {
  readonly code: string | null;

  constructor(code: string | null, message: string) {
    super(message);
    this.name = "HostedTelegramSyncError";
    this.code = code;
  }
}

export function toHostedTelegramLinkErrorMessage(error: unknown): string {
  const errorCode = readPrivyTelegramLinkErrorCode(error);

  switch (errorCode) {
    case "linked_to_another_user":
      return "That Telegram account is already linked to a different Murph account. Contact support so we can merge it safely.";
    case "cannot_link_more_of_type":
      return "This Murph account already has a Telegram account linked.";
    case "disallowed_login_method":
    case "not_supported":
      return "Telegram linking is not enabled for this account yet.";
    case "must_be_authenticated":
      return "Sign in again before linking Telegram.";
    case "exited_link_flow":
      return "Telegram linking was canceled. Try again when you're ready.";
    case "client_request_timeout":
    case "too_many_requests":
      return "Telegram linking is taking too long. Try again in a moment.";
    case "failed_to_link_account":
    case "unknown_auth_error":
    case "oauth_unexpected":
    default:
      return "Could not link Telegram right now.";
  }
}

function readPrivyTelegramLinkErrorCode(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }

  if (!isRecord(error)) {
    return null;
  }

  const privyErrorCode = error.privyErrorCode;
  if (typeof privyErrorCode === "string") {
    return privyErrorCode;
  }

  const code = error.code;
  return typeof code === "string" ? code : null;
}

export async function syncHostedTelegramConnectionWithRetry(input: {
  expectedTelegramUserId: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (delayMs: number) => Promise<void>;
}): Promise<HostedTelegramSyncResult> {
  return retrySyncOperation({
    errorFactory: (message) => new HostedTelegramSyncError(null, message),
    operation: () => syncHostedTelegramConnection({
      expectedTelegramUserId: input.expectedTelegramUserId,
      fetchImpl: input.fetchImpl ?? fetch,
    }),
    retryable: (error) =>
      error instanceof HostedTelegramSyncError && error.code === "PRIVY_TELEGRAM_NOT_READY",
    sleepImpl: input.sleepImpl,
    timeoutMessage:
      "Telegram linked in Privy, but the hosted assistant could not confirm it yet. Refresh and try again.",
  });
}

function formatHostedTelegramSyncSuccessMessage(
  syncResult: HostedTelegramSyncResult,
  mode: HostedTelegramSyncMode,
): string {
  const username = syncResult.telegramUsername ? ` @${syncResult.telegramUsername}` : "";
  const base = `Telegram connected${username}.`;

  return mode === "link"
    ? `${base} Open the bot in Telegram and press Start once so Murph can receive your messages.`
    : base;
}

async function syncHostedTelegramConnection(input: {
  expectedTelegramUserId: string;
  fetchImpl: typeof fetch;
}): Promise<HostedTelegramSyncResult> {
  const { expectedTelegramUserId, fetchImpl } = input;

  if (fetchImpl === fetch) {
    try {
      const payload = await requestHostedOnboardingJson<{
        botLink?: string | null;
        runTriggered?: boolean;
        telegramUserId: string;
        telegramUsername?: string | null;
      }>({
        payload: {
          expectedTelegramUserId,
        },
        url: "/api/settings/telegram/sync",
      });

      return {
        botLink: typeof payload.botLink === "string" ? payload.botLink : null,
        runTriggered: payload.runTriggered === true,
        telegramUserId: payload.telegramUserId,
        telegramUsername: typeof payload.telegramUsername === "string" ? payload.telegramUsername : null,
      };
    } catch (error) {
      if (error instanceof HostedOnboardingApiError) {
        throw new HostedTelegramSyncError(
          error.code,
          error.message,
        );
      }
      throw error;
    }
  }

  const response = await fetchImpl("/api/settings/telegram/sync", {
    body: JSON.stringify({
      expectedTelegramUserId,
    }),
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  const payload = await readOptionalJsonObject(response);

  if (!response.ok) {
    const errorDetails = readJsonErrorDetails(payload);

    throw new HostedTelegramSyncError(
      errorDetails.code,
      errorDetails.message ?? "We could not sync Telegram to the hosted assistant yet.",
    );
  }

  if (
    !isRecord(payload)
    || payload.ok !== true
    || typeof payload.telegramUserId !== "string"
  ) {
    throw new HostedTelegramSyncError(
      null,
      "Telegram linked, but the hosted assistant returned an unexpected sync response.",
    );
  }

  return {
    botLink: typeof payload.botLink === "string" ? payload.botLink : null,
    runTriggered: payload.runTriggered === true,
    telegramUserId: payload.telegramUserId,
    telegramUsername: typeof payload.telegramUsername === "string" ? payload.telegramUsername : null,
  };
}

function toHostedTelegramSyncErrorMessage(error: unknown): string {
  if (error instanceof HostedTelegramSyncError) {
    return error.message;
  }

  return toErrorMessage(
    error,
    "Telegram linked in Privy, but we could not sync it to the hosted assistant yet. Refresh and try again.",
  );
}
