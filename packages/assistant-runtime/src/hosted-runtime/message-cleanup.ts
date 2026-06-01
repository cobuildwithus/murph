import {
  deleteLinqMessage,
  type LinqFetch,
} from "@murphai/operator-config/linq-runtime";
import {
  deleteTelegramMessages,
  type TelegramFetchImplementation,
} from "@murphai/operator-config/telegram-runtime";

export async function deleteHostedLinqMessages(input: {
  env?: NodeJS.ProcessEnv;
  fetchImplementation: LinqFetch;
  messageIds: readonly string[];
  signal?: AbortSignal;
}): Promise<void> {
  const messageIds = normalizeHostedProviderMessageIds(input.messageIds);
  if (messageIds.length === 0) {
    return;
  }

  for (const messageId of messageIds) {
    await deleteLinqMessage({
      messageId,
    }, {
      env: input.env,
      fetchImplementation: input.fetchImplementation,
      signal: input.signal,
    });
  }
}

export async function deleteHostedTelegramMessages(input: {
  env?: NodeJS.ProcessEnv;
  fetchImplementation: TelegramFetchImplementation;
  messageIds: readonly string[];
  signal?: AbortSignal;
  target: string;
}): Promise<void> {
  const messageIds = normalizeHostedProviderMessageIds(input.messageIds);
  if (messageIds.length === 0) {
    return;
  }

  await deleteTelegramMessages({
    messageIds,
    target: input.target,
  }, {
    env: input.env,
    fetchImplementation: input.fetchImplementation,
    signal: input.signal,
  });
}

function normalizeHostedProviderMessageIds(
  messageIds: readonly string[],
): string[] {
  return [...new Set(messageIds.filter((messageId) => messageId.trim().length > 0))];
}
