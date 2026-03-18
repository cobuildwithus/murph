import {
  IMessageSDK,
  type ChatSummary as PhotonImessageChatSummary,
  type Message as PhotonImessageMessage,
} from "@photon-ai/imessage-kit";
import { createNormalizedChatPollConnector, type ChatPollDriver } from "../chat/poll.js";
import {
  type ImessageKitChatLike,
  type ImessageKitMessageLike,
  normalizeImessageMessage,
} from "./normalize.js";

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

export interface ImessagePollDriver extends ChatPollDriver<ImessageKitMessageLike> {
  getMessages(input: ImessageGetMessagesInput): Promise<ImessageKitMessageLike[]>;
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
    refreshContext: async ({ driver, context, message }) => {
      const existing = context ? resolveChat(context, message) : null;

      if (existing || !driver.listChats) {
        return context;
      }

      return loadChats(driver);
    },
    normalize: async ({ message, source, accountId, context }) =>
      normalizeImessageMessage({
        message,
        source,
        accountId,
        chat: resolveChat(context ?? new Map(), message),
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

        return result.messages.map(toImessageKitMessageLike);
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

      const sdk = new IMessageSDK();
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
          onMessage: async (message) => {
            if (options.signal.aborted) {
              return;
            }

            if (options.includeOwnMessages === false && message.isFromMe) {
              return;
            }

            await options.onMessage(toImessageKitMessageLike(message));
          },
          onError(error) {
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
  run: (sdk: IMessageSDK) => Promise<TResult>,
): Promise<TResult> {
  const sdk = new IMessageSDK();

  try {
    return await run(sdk);
  } finally {
    await closeIMessageSdk(sdk);
  }
}

async function closeIMessageSdk(sdk: IMessageSDK): Promise<void> {
  try {
    await sdk.close();
  } catch {}
}

function toImessageKitMessageLike(
  message: PhotonImessageMessage,
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
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      path: attachment.path,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
  };
}

function toImessageKitChatLike(
  chat: PhotonImessageChatSummary,
): ImessageKitChatLike {
  return {
    id: chat.chatId,
    displayName: chat.displayName,
    title: chat.displayName,
    isGroup: chat.isGroup,
    participantCount: chat.isGroup ? 3 : 1,
  };
}

function resolveChat(
  chats: Map<string, ImessageKitChatLike>,
  message: ImessageKitMessageLike,
): ImessageKitChatLike | null {
  const key = message.chatGuid ?? message.chatId ?? null;
  return key ? (chats.get(key) ?? null) : null;
}

async function loadChats(driver: ImessagePollDriver): Promise<Map<string, ImessageKitChatLike>> {
  if (!driver.listChats) {
    return new Map();
  }

  return indexChats(await driver.listChats());
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

function normalizeImessageAccountId(accountId: string | null | undefined): string | null {
  if (accountId === undefined) {
    return "self";
  }

  if (accountId === null) {
    return null;
  }

  const normalized = accountId.trim();
  return normalized.length > 0 ? normalized : null;
}
