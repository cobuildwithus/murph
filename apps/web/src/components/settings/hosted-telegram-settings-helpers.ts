import {
  extractHostedPrivyTelegramAccount,
  type HostedPrivyLinkedAccountContainer,
  type HostedPrivyTelegramAccount,
} from "@/src/lib/hosted-onboarding/privy-shared";

import {
  isRecord,
  readOptionalJsonObject,
  retrySyncOperation,
  toErrorMessage,
} from "./hosted-settings-sync-helpers";

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

export interface HostedTelegramSyncPresentation {
  errorMessage: string | null;
  successMessage: string | null;
  syncResult: HostedTelegramSyncResult | null;
}

export function resolveHostedTelegramSettingsDisplayState(input: {
  syncedTelegramOverride?: HostedPrivyTelegramAccount | null;
  user: HostedPrivyLinkedAccountContainer | null | undefined;
}): HostedTelegramSettingsDisplayState {
  return {
    currentTelegram: input.syncedTelegramOverride ?? extractHostedPrivyTelegramAccount(input.user),
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
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;

    throw new HostedTelegramSyncError(
      typeof errorPayload?.code === "string" ? errorPayload.code : null,
      typeof errorPayload?.message === "string"
        ? errorPayload.message
        : "We could not sync Telegram to the hosted assistant yet.",
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
