import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Api, type ApiClientOptions, type RawApi } from "grammy";
import { relayAbort } from "../../shared-runtime.ts";
import type {
  TelegramChat,
  TelegramContact,
  TelegramFile,
  TelegramFileBase,
  TelegramLocation,
  TelegramMessageLike,
  TelegramPhotoSize,
  TelegramPoll,
  TelegramPollOption,
  TelegramTextQuote,
  TelegramUpdateLike,
  TelegramUser,
  TelegramVenue,
  TelegramWebhookInfo,
  TelegramDirectMessagesTopic,
  TelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";
import {
  buildTelegramThreadTarget,
  extractTelegramMessage,
  parseTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";
import {
  createNormalizedChatPollConnector,
  type ChatPollDriver,
} from "../chat/poll.ts";
import { normalizeTelegramUpdate, type TelegramAttachmentDownloadDriver } from "./normalize.ts";

export const DEFAULT_TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "business_message",
] as const;

const TELEGRAM_WATCH_RETRY_DELAYS_MS = [1000, 3000, 5000, 10000] as const;
export const TELEGRAM_POLL_TRANSPORT_MODES = [
  "take-over-webhook",
  "require-no-webhook",
] as const;

export type TelegramApiClient = Api<RawApi>;
export type TelegramPollTransportMode =
  (typeof TELEGRAM_POLL_TRANSPORT_MODES)[number];
type TelegramApiSignal = Parameters<TelegramApiClient["getMe"]>[0];
type TelegramApiUpdate = Awaited<ReturnType<TelegramApiClient["getUpdates"]>>[number];
type TelegramAllowedUpdate =
  NonNullable<Parameters<TelegramApiClient["getUpdates"]>[0]>["allowed_updates"] extends
    | ReadonlyArray<infer T>
    | undefined ? T
    : never;

interface TelegramApiUserLike {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramApiChatLike {
  id: number | string;
  type?: string;
  title?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  is_direct_messages?: boolean | null;
}

interface TelegramApiFileBaseLike {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
}

interface TelegramApiPhotoSizeLike extends TelegramApiFileBaseLike {
  width?: number;
  height?: number;
}

interface TelegramApiDirectMessagesTopicLike {
  topic_id?: number | null;
  title?: string | null;
}

interface TelegramApiContactLike {
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  user_id?: number | null;
  vcard?: string | null;
}

interface TelegramApiLocationLike {
  latitude?: number | null;
  longitude?: number | null;
}

interface TelegramApiVenueLike {
  title?: string | null;
  address?: string | null;
  location?: TelegramApiLocationLike | null;
}

interface TelegramApiPollOptionLike {
  text?: string | null;
}

interface TelegramApiPollLike {
  question?: string | null;
  options?: TelegramApiPollOptionLike[] | null;
}

interface TelegramApiTextQuoteLike {
  text?: string | null;
}

interface TelegramApiMessageLikeInput {
  message_id: number;
  date?: number | null;
  edit_date?: number | null;
  business_connection_id?: string | null;
  direct_messages_topic?: TelegramApiDirectMessagesTopicLike | null;
  media_group_id?: string | null;
  message_thread_id?: number | null;
  text?: string | null;
  caption?: string | null;
  chat: TelegramApiChatLike;
  from?: TelegramApiUserLike | null;
  sender_chat?: TelegramApiChatLike | null;
  sender_business_bot?: TelegramApiUserLike | null;
  reply_to_message?: TelegramApiMessageLikeInput | null;
  quote?: TelegramApiTextQuoteLike | null;
  photo?: TelegramApiPhotoSizeLike[] | null;
  document?: TelegramApiFileBaseLike | null;
  audio?: TelegramApiFileBaseLike | null;
  voice?: TelegramApiFileBaseLike | null;
  video?: TelegramApiFileBaseLike | null;
  video_note?: TelegramApiFileBaseLike | null;
  animation?: TelegramApiFileBaseLike | null;
  sticker?: TelegramApiFileBaseLike | null;
  contact?: TelegramApiContactLike | null;
  location?: TelegramApiLocationLike | null;
  venue?: TelegramApiVenueLike | null;
  poll?: TelegramApiPollLike | null;
}

interface TelegramApiFileLike {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

interface TelegramApiWebhookInfoLike {
  url?: string;
  pending_update_count?: number;
}

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
  transportMode?: TelegramPollTransportMode;
  resetWebhookOnStart?: boolean;
}

export function createTelegramPollConnector({
  driver,
  id,
  source = "telegram",
  accountId,
  backfillLimit = 500,
  downloadAttachments = true,
  transportMode,
  resetWebhookOnStart,
}: TelegramConnectorOptions) {
  const normalizedAccountId = normalizeTelegramAccountId(accountId);
  const allowUnscopedDirectMessages =
    accountId !== undefined && normalizedAccountId === "bot";
  const authorizedTarget = parseAuthorizedTelegramTarget(normalizedAccountId);
  const connectorId = id ?? `${source}:${normalizedAccountId ?? "default"}`;
  const effectiveTransportMode = resolveTelegramPollTransportMode({
    resetWebhookOnStart,
    transportMode,
  });
  let pollingPrepared = false;

  const ensurePollingReady = async () => {
    if (pollingPrepared) {
      return;
    }

    const activeWebhookUrl = await readActiveTelegramWebhookUrl(driver);

    if (effectiveTransportMode === "take-over-webhook") {
      if (driver.deleteWebhook) {
        await driver.deleteWebhook({ dropPendingUpdates: false });
      } else if (activeWebhookUrl) {
        throw new Error(
          'Telegram polling transportMode "take-over-webhook" requires deleteWebhook support when an active webhook is configured.',
        );
      }
    } else if (activeWebhookUrl) {
      throw new Error(
        'Telegram polling transportMode "require-no-webhook" cannot run while Telegram still has an active webhook. Delete the webhook first or use transportMode "take-over-webhook".',
      );
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
      isAuthorizedTelegramPollUpdate(message, authorizedTarget, {
        allowUnscopedDirectMessages,
      })
        ? normalizeTelegramUpdate({
            update: message,
            source,
            accountId,
            botUser: context?.botUser ?? null,
            downloadDriver: downloadAttachments ? driver : null,
          })
        : null,
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
      return getTelegramBotUser(api, signal);
    },
    async getMessages({ cursor, limit = normalizedBatchSize, signal }) {
      const batch = await getUpdates(api, {
        offset: nextUpdateOffset(cursor),
        limit: Math.min(Math.max(limit, 1), normalizedBatchSize),
        timeout: 0,
        allowed_updates: allowedUpdates ?? undefined,
      }, signal);
      const ordered = [...batch].sort(compareTelegramUpdates);

      return {
        messages: ordered.filter(isTelegramMessageUpdate),
        nextCursor: ordered.length > 0 ? createTelegramUpdateCheckpoint(ordered.at(-1)!) : cursor ?? null,
      };
    },
    async startWatching({ cursor, signal, onMessage }) {
      let offset = nextUpdateOffset(cursor);
      const controller = new AbortController();
      const releaseRelay = relayAbort(signal, controller);
      const watchSignal = controller.signal;
      let failureCount = 0;

      const loop = (async () => {
        while (!watchSignal.aborted) {
          let batch: TelegramUpdateLike[];
          try {
            batch = await getUpdates(api, {
              offset,
              limit: normalizedBatchSize,
              timeout: timeoutSeconds,
              allowed_updates: allowedUpdates ?? undefined,
            }, watchSignal);
            failureCount = 0;
          } catch (error) {
            if (watchSignal.aborted) {
              break;
            }

            if (!shouldRetryTelegramPollingError(error)) {
              throw error;
            }

            try {
              await waitForTelegramRetryDelay(error, failureCount, watchSignal);
            } catch (retryError) {
              if (isAbortError(retryError)) {
                break;
              }

              throw retryError;
            }
            failureCount += 1;
            continue;
          }

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
      return getTelegramFile(api, fileId, signal);
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

      return getTelegramWebhookInfo(api, signal);
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
    return null;
  }

  if (accountId === null) {
    return null;
  }

  const normalized = accountId.trim();
  return normalized.length > 0 ? normalized : null;
}

function isAuthorizedTelegramPollUpdate(
  update: TelegramUpdateLike,
  allowedTarget: TelegramThreadTarget | null,
  options: { allowUnscopedDirectMessages: boolean },
): boolean {
  const message = extractTelegramMessage(update);
  if (!message) {
    return false;
  }

  if (!allowedTarget) {
    return options.allowUnscopedDirectMessages && isDirectTelegramPollMessage(message);
  }

  const messageTarget = buildTelegramThreadTarget(message);
  return telegramTargetMatchesAllowedTarget(messageTarget, allowedTarget);
}

function parseAuthorizedTelegramTarget(
  accountId: string | null | undefined,
): TelegramThreadTarget | null {
  const normalized = normalizeTelegramAccountId(accountId);
  if (!normalized || normalized === "bot") {
    return null;
  }

  return parseTelegramThreadTarget(normalized);
}

function telegramTargetMatchesAllowedTarget(
  messageTarget: TelegramThreadTarget,
  allowedTarget: TelegramThreadTarget,
): boolean {
  if (messageTarget.chatId !== allowedTarget.chatId) {
    return false;
  }

  if ((messageTarget.businessConnectionId ?? null) !== (allowedTarget.businessConnectionId ?? null)) {
    return false;
  }

  if ((messageTarget.messageThreadId ?? null) !== (allowedTarget.messageThreadId ?? null)) {
    return false;
  }

  if ((messageTarget.directMessagesTopicId ?? null) !== (allowedTarget.directMessagesTopicId ?? null)) {
    return false;
  }

  return true;
}

function isDirectTelegramPollMessage(message: TelegramMessageLike): boolean {
  return message.chat.type === "private" || message.chat.is_direct_messages === true;
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
      update.business_message,
  );
}

async function getUpdates(
  api: TelegramApiClient,
  input: Parameters<TelegramApiClient["getUpdates"]>[0],
  signal?: AbortSignal,
): Promise<TelegramUpdateLike[]> {
  try {
    return (await api.getUpdates(input, asTelegramApiSignal(signal))).map(normalizeTelegramApiUpdate);
  } catch (error) {
    throw rewritePollingConflict(error);
  }
}

async function getTelegramBotUser(
  api: TelegramApiClient,
  signal?: AbortSignal,
): Promise<TelegramUser> {
  return normalizeTelegramApiUser(await api.getMe(asTelegramApiSignal(signal)));
}

async function getTelegramFile(
  api: TelegramApiClient,
  fileId: string,
  signal?: AbortSignal,
): Promise<TelegramFile> {
  return normalizeTelegramApiFile(await api.getFile(fileId, asTelegramApiSignal(signal)));
}

async function getTelegramWebhookInfo(
  api: TelegramApiClient & { getWebhookInfo: NonNullable<TelegramApiClient["getWebhookInfo"]> },
  signal?: AbortSignal,
): Promise<TelegramWebhookInfo> {
  return normalizeTelegramApiWebhookInfo(await api.getWebhookInfo(asTelegramApiSignal(signal)));
}

function normalizeTelegramApiUpdate(update: TelegramApiUpdate): TelegramUpdateLike {
  return {
    ...update,
    message: update.message ? normalizeTelegramApiMessage(update.message) : update.message,
    business_message: update.business_message
      ? normalizeTelegramApiMessage(update.business_message)
      : update.business_message,
  };
}

function normalizeTelegramApiMessage(message: TelegramApiMessageLikeInput): TelegramMessageLike {
  return {
    ...message,
    chat: normalizeTelegramApiChat(message.chat),
    from: message.from ? normalizeTelegramApiUser(message.from) : message.from,
    sender_chat: message.sender_chat ? normalizeTelegramApiChat(message.sender_chat) : message.sender_chat,
    sender_business_bot: message.sender_business_bot
      ? normalizeTelegramApiUser(message.sender_business_bot)
      : message.sender_business_bot,
    reply_to_message: message.reply_to_message
      ? normalizeTelegramApiMessage(message.reply_to_message)
      : message.reply_to_message,
    quote: message.quote ? normalizeTelegramApiTextQuote(message.quote) : message.quote,
    direct_messages_topic: message.direct_messages_topic
      ? normalizeTelegramApiDirectMessagesTopic(message.direct_messages_topic)
      : message.direct_messages_topic,
    photo: message.photo?.map(normalizeTelegramApiPhotoSize),
    document: message.document ? normalizeTelegramApiFileBase(message.document) : message.document,
    audio: message.audio ? normalizeTelegramApiFileBase(message.audio) : message.audio,
    voice: message.voice ? normalizeTelegramApiFileBase(message.voice) : message.voice,
    video: message.video ? normalizeTelegramApiFileBase(message.video) : message.video,
    video_note: message.video_note ? normalizeTelegramApiFileBase(message.video_note) : message.video_note,
    animation: message.animation ? normalizeTelegramApiFileBase(message.animation) : message.animation,
    sticker: message.sticker ? normalizeTelegramApiFileBase(message.sticker) : message.sticker,
    contact: message.contact ? normalizeTelegramApiContact(message.contact) : message.contact,
    location: message.location ? normalizeTelegramApiLocation(message.location) : message.location,
    venue: message.venue ? normalizeTelegramApiVenue(message.venue) : message.venue,
    poll: message.poll ? normalizeTelegramApiPoll(message.poll) : message.poll,
  };
}

function normalizeTelegramApiUser(user: TelegramApiUserLike): TelegramUser {
  return { ...user };
}

function normalizeTelegramApiChat(chat: TelegramApiChatLike): TelegramChat {
  return { ...chat };
}

function normalizeTelegramApiDirectMessagesTopic(
  topic: TelegramApiDirectMessagesTopicLike,
): TelegramDirectMessagesTopic {
  return { ...topic };
}

function normalizeTelegramApiPhotoSize(photo: TelegramApiPhotoSizeLike): TelegramPhotoSize {
  return { ...photo };
}

function normalizeTelegramApiFileBase(file: TelegramApiFileBaseLike): TelegramFileBase {
  return { ...file };
}

function normalizeTelegramApiContact(contact: TelegramApiContactLike): TelegramContact {
  return { ...contact };
}

function normalizeTelegramApiLocation(location: TelegramApiLocationLike): TelegramLocation {
  return { ...location };
}

function normalizeTelegramApiVenue(venue: TelegramApiVenueLike): TelegramVenue {
  return {
    ...venue,
    location: venue.location ? normalizeTelegramApiLocation(venue.location) : venue.location,
  };
}

function normalizeTelegramApiPoll(poll: TelegramApiPollLike): TelegramPoll {
  return {
    ...poll,
    options: poll.options?.map(normalizeTelegramApiPollOption),
  };
}

function normalizeTelegramApiPollOption(option: TelegramApiPollOptionLike): TelegramPollOption {
  return { ...option };
}

function normalizeTelegramApiTextQuote(quote: TelegramApiTextQuoteLike): TelegramTextQuote {
  return { ...quote };
}

function normalizeTelegramApiFile(file: TelegramApiFileLike): TelegramFile {
  return { ...file };
}

function normalizeTelegramApiWebhookInfo(webhookInfo: TelegramApiWebhookInfoLike): TelegramWebhookInfo {
  return { ...webhookInfo };
}

function rewritePollingConflict(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  if (/409/u.test(error.message) || /webhook/u.test(error.message)) {
    return new Error(
      'Telegram polling is blocked by an active webhook. Delete the webhook or use transportMode "take-over-webhook" before running the local poll connector.',
      { cause: error },
    );
  }

  return error;
}

async function readActiveTelegramWebhookUrl(
  driver: Pick<TelegramPollDriver, "getWebhookInfo">,
): Promise<string | null> {
  if (!driver.getWebhookInfo) {
    return null;
  }

  const webhookInfo = await driver.getWebhookInfo();
  const webhookUrl = webhookInfo?.url;

  return typeof webhookUrl === "string" && webhookUrl.trim().length > 0
    ? webhookUrl.trim()
    : null;
}

function resolveTelegramPollTransportMode(input: {
  resetWebhookOnStart?: boolean;
  transportMode?: TelegramPollTransportMode;
}): TelegramPollTransportMode {
  if (input.transportMode) {
    return input.transportMode;
  }

  return input.resetWebhookOnStart === false
    ? "require-no-webhook"
    : "take-over-webhook";
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
  const allowLocalFileReads = isTrustedTelegramFileBaseUrl(baseUrl);

  return async (filePath, signal) => {
    if (looksLikeLocalBotApiFilePath(filePath)) {
      if (!allowLocalFileReads) {
        throw new Error(
          "Telegram returned a local file path from an untrusted Bot API file base URL. Only loopback Local Bot API file endpoints may read local files directly.",
        );
      }

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

function isTrustedTelegramFileBaseUrl(fileBaseUrl: string): boolean {
  try {
    const url = new URL(fileBaseUrl);
    const hostname = url.hostname.toLowerCase();

    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function shouldRetryTelegramPollingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }

  const statusCode = extractTelegramPollingStatusCode(error);
  if (statusCode === 409 || /webhook/u.test(error.message)) {
    return false;
  }

  if (statusCode !== null && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    return false;
  }

  return true;
}

function extractTelegramPollingStatusCode(error: Error): number | null {
  const match =
    /^\s*(\d{3})\b/u.exec(error.message) ??
    /\((\d{3}):/u.exec(error.message) ??
    /\bHTTP\s+(\d{3})\b/iu.exec(error.message) ??
    /\bstatus\s+(\d{3})\b/iu.exec(error.message);

  if (!match) {
    return null;
  }

  const statusCode = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(statusCode) ? statusCode : null;
}

async function waitForTelegramRetryDelay(
  error: unknown,
  failureCount: number,
  signal: AbortSignal,
): Promise<void> {
  const retryAfterMilliseconds = parseRetryAfterMilliseconds(error);
  const backoffMilliseconds =
    TELEGRAM_WATCH_RETRY_DELAYS_MS[
      Math.min(failureCount, TELEGRAM_WATCH_RETRY_DELAYS_MS.length - 1)
    ] ?? TELEGRAM_WATCH_RETRY_DELAYS_MS[TELEGRAM_WATCH_RETRY_DELAYS_MS.length - 1];
  const delay = retryAfterMilliseconds ?? backoffMilliseconds;

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryAfterMilliseconds(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const match = /retry after (\d+)/iu.exec(error.message);
  if (!match) {
    return null;
  }

  const seconds = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return null;
  }

  return seconds * 1000;
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
