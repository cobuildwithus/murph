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
  syncedTelegramOverride?: HostedTelegramSyncOverride | null;
  user: HostedPrivyLinkedAccountContainer | null | undefined;
}): HostedTelegramSettingsDisplayState {
  return {
    currentTelegram: input.syncedTelegramOverride
      ? {
          firstName: null,
          lastName: null,
          photoUrl: null,
          telegramUserId: input.syncedTelegramOverride.telegramUserId,
          username: input.syncedTelegramOverride.username,
        }
      : extractHostedPrivyTelegramAccount(input.user),
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

export async function syncHostedTelegramConnectionWithRetry(input: {
  expectedTelegramUserId: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (delayMs: number) => Promise<void>;
}): Promise<HostedTelegramSyncResult> {
  return retrySyncOperation({
    errorFactory: (message) => new HostedTelegramSyncError(null, message),
    operation: () => syncHostedTelegramConnection(input.expectedTelegramUserId, input.fetchImpl ?? fetch),
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

async function syncHostedTelegramConnection(
  expectedTelegramUserId: string,
  fetchImpl: typeof fetch,
): Promise<HostedTelegramSyncResult> {
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
