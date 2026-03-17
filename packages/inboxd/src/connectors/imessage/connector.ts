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
  const specifier = "@photon-ai/imessage-kit";
  const module = (await import(specifier)) as Record<string, unknown>;
  const getMessages = module.getMessages;
  const listChats = module.listChats;
  const startWatching = module.startWatching;

  if (typeof getMessages !== "function" || typeof startWatching !== "function") {
    throw new TypeError(
      "@photon-ai/imessage-kit did not expose the expected getMessages/startWatching functions.",
    );
  }

  return {
    getMessages(input) {
      return (getMessages as ImessagePollDriver["getMessages"])(input);
    },
    listChats:
      typeof listChats === "function"
        ? () => (listChats as NonNullable<ImessagePollDriver["listChats"]>)()
        : undefined,
    startWatching(options) {
      return (startWatching as ImessagePollDriver["startWatching"])(options);
    },
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
