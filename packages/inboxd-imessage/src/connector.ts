import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  createNormalizedChatPollConnector,
  type ChatPollDriver,
} from "@murphai/inboxd";

import {
  type ImessageKitChatLike,
  type ImessageKitMessageLike,
  normalizeImessageMessage,
} from "./normalize.ts";

const MAX_EAGER_IMESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const PHOTON_IMESSAGE_KIT_MODULE_ID: string = "@photon-ai/imessage-kit";

interface PhotonImessageAttachmentLike {
  id?: string | null;
  filename?: string | null;
  path?: string | null;
  mimeType?: string | null;
  size?: number | null;
}

interface PhotonImessageMessageLike {
  guid?: string | null;
  id?: string | null;
  text?: string | null;
  date?: Date | string | number | null;
  chatId?: string | null;
  sender?: string | null;
  senderName?: string | null;
  isFromMe?: boolean | null;
  attachments: PhotonImessageAttachmentLike[];
}

interface PhotonImessageChatSummaryLike {
  chatId?: string | null;
  displayName?: string | null;
  isGroup?: boolean | null;
}

interface PhotonImessageSdk {
  getMessages(filter?: Record<string, unknown>): Promise<{
    messages: PhotonImessageMessageLike[];
  }>;
  listChats(): Promise<PhotonImessageChatSummaryLike[]>;
  startWatching(events?: {
    onError?: (error: Error) => void;
    onMessage?: (message: PhotonImessageMessageLike) => void | Promise<void>;
  }): Promise<void>;
  stopWatching(): void;
  close(): Promise<void>;
}

type PhotonImessageKitModule = {
  IMessageSDK: new () => PhotonImessageSdk;
};

export interface ImessageGetMessagesInput {
  cursor?: Record<string, unknown> | null;
  limit?: number;
  includeOwnMessages?: boolean;
  signal?: AbortSignal;
}

export interface ImessageWatchOptions {
  cursor?: Record<string, unknown> | null;
  includeOwnMessages?: boolean;
  signal: AbortSignal;
  onMessage(message: ImessageKitMessageLike): Promise<void> | void;
}

export interface ImessageWatcherHandle {
  close?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  done?: Promise<void>;
}

interface ImessagePollMessagePage {
  messages: ImessageKitMessageLike[];
  nextCursor?: Record<string, unknown> | null;
}

export interface ImessagePollDriver extends ChatPollDriver<ImessageKitMessageLike> {
  getMessages(input: ImessageGetMessagesInput): Promise<ImessagePollMessagePage>;
  listChats?(): Promise<ImessageKitChatLike[]>;
  startWatching(options: ImessageWatchOptions): Promise<ImessageWatcherHandle | (() => Promise<void> | void) | void>;
}

export interface ImessageConnectorOptions {
  driver: ImessagePollDriver;
  id?: string;
  source?: string;
  accountId?: string | null;
  includeOwnMessages?: boolean;
  backfillLimit?: number;
}

export function createImessageConnector({
  driver,
  id,
  source = "imessage",
  accountId,
  includeOwnMessages = true,
  backfillLimit = 500,
}: ImessageConnectorOptions) {
  const normalizedAccountId = normalizeImessageAccountId(accountId);
  const connectorId = id ?? `${source}:${normalizedAccountId ?? "default"}`;

  return createNormalizedChatPollConnector<
    ImessageKitMessageLike,
    ImessagePollDriver,
    Map<string, ImessageKitChatLike>
  >({
    driver,
    id: connectorId,
    source,
    accountId: normalizedAccountId,
    includeOwnMessages,
    backfillLimit,
    capabilities: {
      attachments: true,
      ownMessages: includeOwnMessages,
    },
    loadContext: loadChats,
    refreshContext: async (input: {
      driver: ImessagePollDriver;
      context: Map<string, ImessageKitChatLike> | null;
      message: ImessageKitMessageLike;
    }) => {
      const { driver, context, message } = input;
      const existing = context ? resolveChat(context, message) : null;

      if (existing || !driver.listChats) {
        return context;
      }

      return loadChats(driver);
    },
    normalize: async (input: {
      message: ImessageKitMessageLike;
      source: string;
      accountId?: string | null;
      context: Map<string, ImessageKitChatLike> | null;
    }) =>
      normalizeImessageMessage({
        message: await hydrateEphemeralImessageAttachments(input.message),
        source: input.source,
        accountId: input.accountId,
        chat: resolveChat(input.context ?? new Map(), input.message),
      }),
  });
}

export async function loadImessageKitDriver(): Promise<ImessagePollDriver> {
  return {
    getMessages(input) {
      return withIMessageSdk(async (sdk) => {
        const result = await sdk.getMessages({
          limit: input.limit,
          excludeOwnMessages: input.includeOwnMessages === false,
        });

        return {
          messages: filterImessageMessages({
            messages: result.messages.map(toImessageKitMessageLike),
            cursor: input.cursor,
            limit: input.limit,
          }),
        };
      });
    },
    listChats() {
      return withIMessageSdk(async (sdk) => {
        const chats = await sdk.listChats();
        return chats.map(toImessageKitChatLike);
      });
    },
    async startWatching(options) {
      if (options.signal.aborted) {
        return;
      }

      const sdk = await createIMessageSdk();
      let closed = false;
      let resolveDone!: () => void;
      let rejectDone!: (error: Error) => void;
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });

      const close = async () => {
        if (closed) {
          return;
        }

        closed = true;
        options.signal.removeEventListener("abort", onAbort);
        sdk.stopWatching();
        await closeIMessageSdk(sdk);
        resolveDone();
      };

      const onAbort = () => {
        void close();
      };

      options.signal.addEventListener("abort", onAbort, { once: true });

      try {
        await sdk.startWatching({
          onMessage: async (message: PhotonImessageMessageLike) => {
            if (options.signal.aborted) {
              return;
            }

            if (options.includeOwnMessages === false && message.isFromMe) {
              return;
            }

            await options.onMessage(toImessageKitMessageLike(message));
          },
          onError(error: Error) {
            rejectDone(error);
            void close();
          },
        });
      } catch (error) {
        options.signal.removeEventListener("abort", onAbort);
        await closeIMessageSdk(sdk);
        throw error;
      }

      return {
        close,
        stop: close,
        done,
      };
    },
  };
}

async function withIMessageSdk<TResult>(
  run: (sdk: PhotonImessageSdk) => Promise<TResult>,
): Promise<TResult> {
  const sdk = await createIMessageSdk();

  try {
    return await run(sdk);
  } finally {
    await closeIMessageSdk(sdk);
  }
}

async function createIMessageSdk(): Promise<PhotonImessageSdk> {
  const module = await import(PHOTON_IMESSAGE_KIT_MODULE_ID) as PhotonImessageKitModule;
  return new module.IMessageSDK();
}

async function closeIMessageSdk(sdk: PhotonImessageSdk): Promise<void> {
  try {
    await sdk.close();
  } catch {}
}

function toImessageKitMessageLike(
  message: PhotonImessageMessageLike,
): ImessageKitMessageLike {
  return {
    guid: message.guid,
    id: message.id,
    text: message.text,
    date: message.date,
    chatId: message.chatId,
    handleId: message.sender,
    sender: message.sender,
    displayName: message.senderName,
    senderName: message.senderName,
    isFromMe: message.isFromMe,
    attachments: message.attachments.map((
      attachment: NonNullable<PhotonImessageMessageLike["attachments"]>[number],
    ) => ({
      id: attachment.id,
      filename: attachment.filename,
      path: attachment.path,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
  };
}

function toImessageKitChatLike(
  chat: PhotonImessageChatSummaryLike,
): ImessageKitChatLike {
  return {
    id: chat.chatId,
    displayName: chat.displayName,
    title: chat.displayName,
    isGroup: chat.isGroup,
    participantCount: chat.isGroup ? 3 : 1,
  };
}

function filterImessageMessages(input: {
  messages: ImessageKitMessageLike[];
  cursor?: Record<string, unknown> | null;
  limit?: number;
}): ImessageKitMessageLike[] {
  const normalizedLimit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.max(Math.trunc(input.limit), 0)
      : input.messages.length;
  const cursor = readImessageMessageCursor(input.cursor);
  const ordered = [...input.messages].sort(compareImessageMessages);
  const filtered = cursor
    ? ordered.filter((message) => compareImessageMessageToCursor(message, cursor) > 0)
    : ordered;

  return filtered.slice(0, normalizedLimit);
}

function compareImessageMessages(
  left: ImessageKitMessageLike,
  right: ImessageKitMessageLike,
): number {
  const leftCursor = createImessageMessageCursor(left);
  const rightCursor = createImessageMessageCursor(right);

  if (!leftCursor || !rightCursor) {
    return 0;
  }

  return compareImessageCursor(leftCursor, rightCursor);
}

function compareImessageMessageToCursor(
  message: ImessageKitMessageLike,
  cursor: { occurredAt: string; externalId: string },
): number {
  const messageCursor = createImessageMessageCursor(message);

  if (!messageCursor) {
    return 1;
  }

  return compareImessageCursor(messageCursor, cursor);
}

function compareImessageCursor(
  left: { occurredAt: string; externalId: string },
  right: { occurredAt: string; externalId: string },
): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt.localeCompare(right.occurredAt);
  }

  return left.externalId.localeCompare(right.externalId);
}

function createImessageMessageCursor(
  message: ImessageKitMessageLike,
): { occurredAt: string; externalId: string } | null {
  const externalId = message.guid ?? message.id;

  if (!externalId || message.date === null || message.date === undefined) {
    return null;
  }

  try {
    return {
      occurredAt: normalizeImessageCursorTimestamp(message.date),
      externalId,
    };
  } catch {
    return null;
  }
}

function normalizeImessageCursorTimestamp(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new TypeError("Invalid iMessage cursor timestamp.");
  }

  return date.toISOString();
}

function readImessageMessageCursor(
  cursor: Record<string, unknown> | null | undefined,
): { occurredAt: string; externalId: string } | null {
  const occurredAt =
    typeof cursor?.occurredAt === "string" && cursor.occurredAt.length > 0
      ? cursor.occurredAt
      : null;
  const externalId =
    typeof cursor?.externalId === "string" && cursor.externalId.length > 0
      ? cursor.externalId
      : null;

  if (!occurredAt || !externalId) {
    return null;
  }

  return { occurredAt, externalId };
}

function normalizeImessageAccountId(
  accountId: string | null | undefined,
): string | null {
  if (accountId === undefined) {
    return "self";
  }

  if (accountId === null) {
    return null;
  }

  const normalized = accountId.trim();
  return normalized.length > 0 ? normalized : null;
}

async function loadChats(
  driver: ImessagePollDriver,
): Promise<Map<string, ImessageKitChatLike>> {
  if (!driver.listChats) {
    return new Map();
  }

  return indexChats(await driver.listChats());
}

function resolveChat(
  chats: Map<string, ImessageKitChatLike>,
  message: ImessageKitMessageLike,
): ImessageKitChatLike | null {
  const key = message.chatGuid ?? message.chatId ?? null;
  return key ? (chats.get(key) ?? null) : null;
}

async function hydrateEphemeralImessageAttachments(
  message: ImessageKitMessageLike,
): Promise<ImessageKitMessageLike> {
  const attachments = message.attachments;

  if (!attachments || attachments.length === 0) {
    return message;
  }

  let changed = false;
  const hydrated = await Promise.all(
    attachments.map(async (attachment) => {
      const nextAttachment = await snapshotEphemeralImessageAttachment(attachment);
      if (nextAttachment !== attachment) {
        changed = true;
      }
      return nextAttachment;
    }),
  );

  return changed
    ? {
        ...message,
        attachments: hydrated,
      }
    : message;
}

async function snapshotEphemeralImessageAttachment(
  attachment: NonNullable<ImessageKitMessageLike["attachments"]>[number],
): Promise<NonNullable<ImessageKitMessageLike["attachments"]>[number]> {
  const attachmentPath = resolveEphemeralAttachmentPath(attachment.path);
  if (!attachmentPath || hasAttachmentData(attachment)) {
    return attachment;
  }

  const byteSize = normalizeAttachmentByteSize(attachment);
  if (byteSize !== null && byteSize > MAX_EAGER_IMESSAGE_ATTACHMENT_BYTES) {
    return attachment;
  }

  try {
    const data = await readFile(attachmentPath);
    return {
      ...attachment,
      data: new Uint8Array(data),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        ...attachment,
        path: null,
      };
    }

    throw error;
  }
}

function resolveEphemeralAttachmentPath(candidate: string | null | undefined): string | null {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return null;
  }

  const resolved = path.resolve(candidate);
  const normalized = resolved.replaceAll("\\", "/");
  return normalized.includes("/TemporaryItems/") || normalized.includes("/com.apple.imagent/")
    ? resolved
    : null;
}

function hasAttachmentData(
  attachment: NonNullable<ImessageKitMessageLike["attachments"]>[number],
): boolean {
  return attachment.data instanceof Uint8Array;
}

function normalizeAttachmentByteSize(
  attachment: NonNullable<ImessageKitMessageLike["attachments"]>[number],
): number | null {
  const byteSize = attachment.byteSize ?? attachment.size ?? null;
  return typeof byteSize === "number" && Number.isFinite(byteSize) && byteSize >= 0
    ? Math.trunc(byteSize)
    : null;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function indexChats(chats: ImessageKitChatLike[]): Map<string, ImessageKitChatLike> {
  return new Map(
    chats.flatMap((chat) => {
      const keys = [chat.guid, chat.chatGuid, chat.id].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      return keys.map((key) => [key, chat] as const);
    }),
  );
}
