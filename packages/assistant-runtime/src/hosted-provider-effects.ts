import {
  sendLinqMessage,
  sendTelegramMessage,
  startTelegramTypingIndicator,
} from "@murphai/assistant-engine";
import {
  markLinqChatRead,
  startLinqChatTypingIndicator,
} from "@murphai/operator-config/linq-runtime";

import {
  createHostedTelegramAttachmentDownloadDriver,
} from "./hosted-runtime/events/telegram.ts";
import {
  deleteHostedLinqMessages,
} from "./hosted-runtime/message-cleanup.ts";
import type {
  HostedRuntimeLinqChatActionRequest,
  HostedRuntimeLinqDeleteMessagesRequest,
  HostedRuntimeLinqMarkReadRequest,
  HostedRuntimeLinqSendRequest,
  HostedRuntimeLinqSendResponse,
  HostedRuntimeTelegramChatActionRequest,
  HostedRuntimeTelegramDownloadFileRequest,
  HostedRuntimeTelegramFile,
  HostedRuntimeTelegramGetFileRequest,
  HostedRuntimeTelegramSendRequest,
  HostedRuntimeTelegramSendResponse,
} from "./hosted-runtime/platform.ts";

export interface HostedProviderEffectDependencies {
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function sendHostedProviderTelegramMessage(
  request: HostedRuntimeTelegramSendRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeTelegramSendResponse> {
  return await sendTelegramMessage(request, {
    env: dependencies.env,
    signal: dependencies.signal,
  });
}

export async function sendHostedProviderTelegramChatAction(
  request: HostedRuntimeTelegramChatActionRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  assertTypingAction(request.action);
  const handle = await startTelegramTypingIndicator({
    target: request.target,
  }, {
    env: dependencies.env,
    signal: dependencies.signal,
  });
  await handle.stop();
}

export async function getHostedProviderTelegramFile(
  request: HostedRuntimeTelegramGetFileRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeTelegramFile | null> {
  const driver = createHostedTelegramAttachmentDownloadDriver(dependencies.env);
  if (!driver) {
    return null;
  }

  return await driver.getFile(request.fileId, dependencies.signal);
}

export async function downloadHostedProviderTelegramFile(
  request: HostedRuntimeTelegramDownloadFileRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<Uint8Array | null> {
  const driver = createHostedTelegramAttachmentDownloadDriver(dependencies.env);
  if (!driver) {
    return null;
  }

  return await driver.downloadFile(request.filePath, dependencies.signal);
}

export async function sendHostedProviderLinqMessage(
  request: HostedRuntimeLinqSendRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeLinqSendResponse> {
  return await sendLinqMessage({
    fromPhoneNumber: request.fromPhoneNumber ?? null,
    idempotencyKey: request.idempotencyKey ?? null,
    message: request.message,
    replyToMessageId: request.replyToMessageId ?? null,
    target: request.target,
    ...(request.targetKind === null || request.targetKind === undefined
      ? {}
      : { targetKind: request.targetKind }),
  }, {
    env: dependencies.env,
    signal: dependencies.signal,
  });
}

export async function sendHostedProviderLinqChatAction(
  request: HostedRuntimeLinqChatActionRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  assertTypingAction(request.action);
  await startLinqChatTypingIndicator({
    chatId: request.target,
  }, {
    env: dependencies.env,
    signal: dependencies.signal,
  });
}

export async function markHostedProviderLinqRead(
  request: HostedRuntimeLinqMarkReadRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  await markLinqChatRead({
    chatId: request.chatId,
  }, {
    env: dependencies.env,
    signal: dependencies.signal,
  });
}

export async function deleteHostedProviderLinqMessages(
  request: HostedRuntimeLinqDeleteMessagesRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  await deleteHostedLinqMessages({
    env: dependencies.env,
    messageIds: request.messageIds,
    signal: dependencies.signal,
  });
}

function assertTypingAction(action: string): asserts action is "typing" {
  if (action !== "typing") {
    throw new TypeError("Hosted provider chat action must be typing.");
  }
}
