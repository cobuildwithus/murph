import type { InboundCapture } from "../../contracts/capture.js";
import { createCaptureCheckpoint } from "../../shared.js";
import type { Cursor, EmitCapture, PollConnector } from "../types.js";
import { compareInboundCaptures } from "./message.js";

export interface ChatPollWatcherHandle {
  close?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}

export interface ChatPollDriver<TMessage> {
  getMessages(input: {
    cursor?: Cursor | null;
    limit?: number;
    includeOwnMessages?: boolean;
    signal?: AbortSignal;
  }): Promise<TMessage[]>;
  startWatching(input: {
    cursor?: Cursor | null;
    includeOwnMessages?: boolean;
    signal: AbortSignal;
    onMessage(message: TMessage): Promise<void> | void;
  }): Promise<ChatPollWatcherHandle | (() => Promise<void> | void) | void>;
}

export interface CreateNormalizedChatPollConnectorInput<
  TMessage,
  TDriver extends ChatPollDriver<TMessage>,
  TContext = null,
> {
  driver: TDriver;
  id: string;
  source: string;
  accountId?: string | null;
  includeOwnMessages?: boolean;
  backfillLimit?: number;
  capabilities?: {
    attachments?: boolean;
    ownMessages?: boolean;
  };
  loadContext?: (driver: TDriver) => Promise<TContext | null>;
  refreshContext?: (input: {
    driver: TDriver;
    context: TContext | null;
    message: TMessage;
  }) => Promise<TContext | null>;
  normalize(input: {
    message: TMessage;
    source: string;
    accountId?: string | null;
    context: TContext | null;
  }): Promise<InboundCapture> | InboundCapture;
  checkpoint?: (input: {
    message: TMessage;
    capture: InboundCapture;
    context: TContext | null;
  }) => Cursor | null;
  compare?: (left: InboundCapture, right: InboundCapture) => number;
}

export function createNormalizedChatPollConnector<
  TMessage,
  TDriver extends ChatPollDriver<TMessage>,
  TContext = null,
>({
  driver,
  id,
  source,
  accountId = null,
  includeOwnMessages = true,
  backfillLimit = 500,
  capabilities,
  loadContext,
  refreshContext,
  normalize,
  checkpoint,
  compare = compareInboundCaptures,
}: CreateNormalizedChatPollConnectorInput<TMessage, TDriver, TContext>): PollConnector {
  let context: TContext | null = null;
  let activeWatcher: ChatPollWatcherHandle | (() => Promise<void> | void) | void;

  return {
    id,
    source,
    accountId,
    kind: "poll",
    capabilities: {
      backfill: true,
      watch: true,
      webhooks: false,
      attachments: capabilities?.attachments ?? true,
      ownMessages: capabilities?.ownMessages ?? includeOwnMessages,
    },
    async backfill(cursor, emit) {
      context = await ensureContext(driver, context, loadContext);
      const messages = await driver.getMessages({
        cursor,
        limit: backfillLimit,
        includeOwnMessages,
      });
      const captures: Array<{ capture: InboundCapture; message: TMessage; context: TContext | null }> = [];

      for (const message of messages) {
        context = await refreshMessageContext({
          driver,
          context,
          message,
          refreshContext,
        });
        const capture = await normalize({
          message,
          source,
          accountId,
          context,
        });
        captures.push({ capture, message, context });
      }

      captures.sort((left, right) => compare(left.capture, right.capture));

      let nextCursor = cursor;
      for (const entry of captures) {
        const nextCheckpoint = checkpoint?.({
          message: entry.message,
          capture: entry.capture,
          context: entry.context,
        }) ?? createCaptureCheckpoint(entry.capture);
        await emit(entry.capture, nextCheckpoint);
        nextCursor = nextCheckpoint;
      }

      return nextCursor;
    },
    async watch(cursor, emit, signal) {
      context = await ensureContext(driver, context, loadContext);
      activeWatcher = await driver.startWatching({
        cursor,
        includeOwnMessages,
        signal,
        onMessage: async (message) => {
          if (signal.aborted) {
            return;
          }

          context = await refreshMessageContext({
            driver,
            context,
            message,
            refreshContext,
          });
          const capture = await normalize({
            message,
            source,
            accountId,
            context,
          });
          const nextCheckpoint = checkpoint?.({
            message,
            capture,
            context,
          }) ?? createCaptureCheckpoint(capture);
          await emit(capture, nextCheckpoint);
        },
      });

      await waitForAbort(signal);
      await stopWatcher(activeWatcher);
      activeWatcher = undefined;
    },
    async close() {
      await stopWatcher(activeWatcher);
      activeWatcher = undefined;
    },
  };
}

async function ensureContext<TMessage, TDriver extends ChatPollDriver<TMessage>, TContext>(
  driver: TDriver,
  context: TContext | null,
  loadContext: ((driver: TDriver) => Promise<TContext | null>) | undefined,
): Promise<TContext | null> {
  if (context !== null || !loadContext) {
    return context;
  }

  return loadContext(driver);
}

async function refreshMessageContext<TMessage, TDriver extends ChatPollDriver<TMessage>, TContext>(input: {
  driver: TDriver;
  context: TContext | null;
  message: TMessage;
  refreshContext:
    | ((input: {
        driver: TDriver;
        context: TContext | null;
        message: TMessage;
      }) => Promise<TContext | null>)
    | undefined;
}): Promise<TContext | null> {
  if (!input.refreshContext) {
    return input.context;
  }

  return input.refreshContext({
    driver: input.driver,
    context: input.context,
    message: input.message,
  });
}

async function stopWatcher(
  watcher: ChatPollWatcherHandle | (() => Promise<void> | void) | void,
): Promise<void> {
  if (!watcher) {
    return;
  }

  if (typeof watcher === "function") {
    await watcher();
    return;
  }

  if (typeof watcher.close === "function") {
    await watcher.close();
    return;
  }

  if (typeof watcher.stop === "function") {
    await watcher.stop();
  }
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
