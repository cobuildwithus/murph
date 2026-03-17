import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Api, type ApiClientOptions, type RawApi } from "grammy";
import { createNormalizedChatPollConnector, type ChatPollDriver } from "../chat/poll.js";
import { normalizeTelegramUpdate, type TelegramAttachmentDownloadDriver } from "./normalize.js";
import type {
  TelegramFile,
  TelegramUpdateLike,
  TelegramUser,
  TelegramWebhookInfo,
} from "./types.js";

export const DEFAULT_TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "business_message",
  "edited_business_message",
] as const;

export type TelegramApiClient = Api<RawApi>;
type TelegramApiSignal = Parameters<TelegramApiClient["getMe"]>[0];
type TelegramAllowedUpdate =
  NonNullable<Parameters<TelegramApiClient["getUpdates"]>[0]>["allowed_updates"] extends
    | ReadonlyArray<infer T>
    | undefined ? T
    : never;

export interface TelegramPollDriver
  extends ChatPollDriver<TelegramUpdateLike>,
    TelegramAttachmentDownloadDriver {
  getMe(signal?: AbortSignal): Promise<TelegramUser>;
  deleteWebhook?(input?: { dropPendingUpdates?: boolean }, signal?: AbortSignal): Promise<void>;
  getWebhookInfo?(signal?: AbortSignal): Promise<TelegramWebhookInfo | null>;
}

export interface CreateTelegramApiPollDriverInput {
  api: TelegramApiClient;
  allowedUpdates?: TelegramAllowedUpdate[] | null;
  timeoutSeconds?: number;
  batchSize?: number;
  fileBaseUrl?: string;
  fileDownloadToken?: string;
  downloadFile?: (filePath: string, signal?: AbortSignal) => Promise<Uint8Array>;
}

export interface CreateTelegramBotApiPollDriverInput {
  token: string;
  allowedUpdates?: TelegramAllowedUpdate[] | null;
  timeoutSeconds?: number;
  batchSize?: number;
  apiBaseUrl?: string;
  fileBaseUrl?: string;
}

export interface TelegramConnectorOptions {
  driver: TelegramPollDriver;
  id?: string;
  source?: string;
  accountId?: string | null;
  backfillLimit?: number;
  downloadAttachments?: boolean;
  resetWebhookOnStart?: boolean;
}

export function createTelegramPollConnector({
  driver,
  id,
  source = "telegram",
  accountId,
  backfillLimit = 500,
  downloadAttachments = true,
  resetWebhookOnStart = true,
}: TelegramConnectorOptions) {
  const normalizedAccountId = normalizeTelegramAccountId(accountId);
  const connectorId = id ?? `${source}:${normalizedAccountId ?? "default"}`;
  let pollingPrepared = false;

  const ensurePollingReady = async () => {
    if (pollingPrepared) {
      return;
    }

    if (resetWebhookOnStart && driver.deleteWebhook) {
      await driver.deleteWebhook({ dropPendingUpdates: false });
    }

    pollingPrepared = true;
  };

  return createNormalizedChatPollConnector<
    TelegramUpdateLike,
    TelegramPollDriver,
    { botUser: TelegramUser }
  >({
    driver,
    id: connectorId,
    source,
    accountId: normalizedAccountId,
    includeOwnMessages: true,
    backfillLimit,
    capabilities: {
      attachments: true,
      ownMessages: true,
    },
    loadContext: async () => {
      await ensurePollingReady();
      return {
        botUser: await driver.getMe(),
      };
    },
    normalize: async ({ message, source, accountId, context }) =>
      normalizeTelegramUpdate({
        update: message,
        source,
        accountId,
        botUser: context?.botUser ?? null,
        downloadDriver: downloadAttachments ? driver : null,
      }),
    checkpoint: ({ message }) => createTelegramUpdateCheckpoint(message),
    compare: compareTelegramCaptures,
  });
}

export function createTelegramApiPollDriver({
  api,
  allowedUpdates = [...DEFAULT_TELEGRAM_ALLOWED_UPDATES],
  timeoutSeconds = 30,
  batchSize = 100,
  fileBaseUrl,
  fileDownloadToken,
  downloadFile,
}: CreateTelegramApiPollDriverInput): TelegramPollDriver {
  const normalizedBatchSize = normalizeBatchSize(batchSize);
  const resolveDownload = createTelegramFileDownloader({
    api,
    fileBaseUrl,
    fileDownloadToken,
    downloadFile,
  });

  return {
    async getMe(signal) {
      return api.getMe(asTelegramApiSignal(signal)) as unknown as Promise<TelegramUser>;
    },
    async getMessages({ cursor, limit = normalizedBatchSize, signal }) {
      const batch = await getUpdates(api, {
        offset: nextUpdateOffset(cursor),
        limit: Math.min(Math.max(limit, 1), normalizedBatchSize),
        timeout: 0,
        allowed_updates: allowedUpdates ?? undefined,
      }, signal);

      return [...batch].sort(compareTelegramUpdates).filter(isTelegramMessageUpdate);
    },
    async startWatching({ cursor, signal, onMessage }) {
      let offset = nextUpdateOffset(cursor);
      const controller = new AbortController();
      const releaseRelay = relayAbort(signal, controller);
      const watchSignal = controller.signal;

      const loop = (async () => {
        while (!watchSignal.aborted) {
          const batch = await getUpdates(api, {
            offset,
            limit: normalizedBatchSize,
            timeout: timeoutSeconds,
            allowed_updates: allowedUpdates ?? undefined,
          }, watchSignal);

          if (batch.length === 0) {
            continue;
          }

          const ordered = [...batch].sort(compareTelegramUpdates);
          offset = ordered.at(-1)!.update_id + 1;

          for (const update of ordered) {
            if (!isTelegramMessageUpdate(update) || watchSignal.aborted) {
              continue;
            }

            await onMessage(update);
          }
        }
      })();

      return {
        done: loop,
        async close() {
          controller.abort();
          releaseRelay();
          try {
            await loop;
          } catch (error) {
            if (!isAbortError(error)) {
              throw error;
            }
          }
        },
      };
    },
    async getFile(fileId, signal) {
      return api.getFile(fileId, asTelegramApiSignal(signal)) as Promise<TelegramFile>;
    },
    async downloadFile(filePath, signal) {
      return resolveDownload(filePath, signal);
    },
    async deleteWebhook(input, signal) {
      if (!api.deleteWebhook) {
        return;
      }

      await api.deleteWebhook(
        { drop_pending_updates: input?.dropPendingUpdates ?? false },
        asTelegramApiSignal(signal),
      );
    },
    async getWebhookInfo(signal) {
      if (!api.getWebhookInfo) {
        return null;
      }

      return api.getWebhookInfo(asTelegramApiSignal(signal)) as unknown as Promise<TelegramWebhookInfo | null>;
    },
  };
}

export function createTelegramBotApiPollDriver({
  token,
  allowedUpdates,
  timeoutSeconds,
  batchSize,
  apiBaseUrl = "https://api.telegram.org",
  fileBaseUrl,
}: CreateTelegramBotApiPollDriverInput): TelegramPollDriver {
  const apiOptions: ApiClientOptions = {
    apiRoot: apiBaseUrl,
  };
  const api = new Api<RawApi>(token, apiOptions);

  return createTelegramApiPollDriver({
    api,
    allowedUpdates,
    timeoutSeconds,
    batchSize,
    fileBaseUrl,
    fileDownloadToken: token,
  });
}

export function createTelegramUpdateCheckpoint(update: TelegramUpdateLike): Record<string, unknown> {
  return {
    updateId: update.update_id,
  };
}

export function readTelegramUpdateCheckpoint(cursor: Record<string, unknown> | null | undefined): number | null {
  const value = cursor?.updateId;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeTelegramAccountId(accountId: string | null | undefined): string | null {
  if (accountId === undefined) {
    return "bot";
  }

  if (accountId === null) {
    return null;
  }

  const normalized = accountId.trim();
  return normalized.length > 0 ? normalized : null;
}

function nextUpdateOffset(cursor: Record<string, unknown> | null | undefined): number {
  const checkpoint = readTelegramUpdateCheckpoint(cursor);
  return checkpoint === null ? 0 : checkpoint + 1;
}

function normalizeBatchSize(batchSize: number): number {
  const normalized = Math.trunc(batchSize);

  if (!Number.isInteger(normalized) || normalized < 1) {
    return 100;
  }

  return Math.min(normalized, 100);
}

function compareTelegramUpdates(left: TelegramUpdateLike, right: TelegramUpdateLike): number {
  return left.update_id - right.update_id;
}

function compareTelegramCaptures(
  left: { externalId: string; occurredAt: string },
  right: { externalId: string; occurredAt: string },
): number {
  const leftUpdateId = parseTelegramUpdateExternalId(left.externalId);
  const rightUpdateId = parseTelegramUpdateExternalId(right.externalId);

  if (leftUpdateId !== null && rightUpdateId !== null && leftUpdateId !== rightUpdateId) {
    return leftUpdateId - rightUpdateId;
  }

  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt.localeCompare(right.occurredAt);
  }

  return left.externalId.localeCompare(right.externalId);
}

function parseTelegramUpdateExternalId(externalId: string): number | null {
  const match = /^update:(\d+)$/u.exec(externalId);

  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(value) ? value : null;
}

function isTelegramMessageUpdate(update: TelegramUpdateLike): boolean {
  return Boolean(
    update.message ??
      update.edited_message ??
      update.channel_post ??
      update.edited_channel_post ??
      update.business_message ??
      update.edited_business_message,
  );
}

async function getUpdates(
  api: TelegramApiClient,
  input: Parameters<TelegramApiClient["getUpdates"]>[0],
  signal?: AbortSignal,
): Promise<TelegramUpdateLike[]> {
  try {
    return await api.getUpdates(input, asTelegramApiSignal(signal)) as TelegramUpdateLike[];
  } catch (error) {
    throw rewritePollingConflict(error);
  }
}

function rewritePollingConflict(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  if (/409/u.test(error.message) || /webhook/u.test(error.message)) {
    return new Error(
      "Telegram polling is blocked by an active webhook. Delete the webhook or enable resetWebhookOnStart before running the local poll connector.",
      { cause: error },
    );
  }

  return error;
}

function createTelegramFileDownloader(input: {
  api: TelegramApiClient;
  fileBaseUrl?: string;
  fileDownloadToken?: string;
  downloadFile?: (filePath: string, signal?: AbortSignal) => Promise<Uint8Array>;
}): (filePath: string, signal?: AbortSignal) => Promise<Uint8Array> {
  if (input.downloadFile) {
    return input.downloadFile;
  }

  const token = input.fileDownloadToken ?? input.api.token;

  if (!token) {
    return async () => {
      throw new TypeError(
        "Telegram file downloads require a bot token or a custom downloadFile implementation.",
      );
    };
  }

  const baseUrl = (input.fileBaseUrl ?? "https://api.telegram.org/file").replace(/\/$/u, "");

  return async (filePath, signal) => {
    if (looksLikeLocalBotApiFilePath(filePath)) {
      const absolutePath = filePath.startsWith("file://")
        ? fileURLToPath(filePath)
        : filePath;
      return new Uint8Array(await readFile(absolutePath));
    }

    const response = await fetch(`${baseUrl}/bot${token}/${filePath}`, {
      method: "GET",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Telegram file download failed with ${response.status} ${response.statusText}.`);
    }

    return new Uint8Array(await response.arrayBuffer());
  };
}

function looksLikeLocalBotApiFilePath(filePath: string): boolean {
  return (
    filePath.startsWith("file://") ||
    path.posix.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath)
  );
}

function relayAbort(signal: AbortSignal, controller: AbortController): () => void {
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }

  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function asTelegramApiSignal(signal: AbortSignal | undefined): TelegramApiSignal {
  return signal as TelegramApiSignal;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /abort/i.test(error.message))
  );
}
