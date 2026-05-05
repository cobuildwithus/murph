import {
  sendLinqMessage,
  sendTelegramMessage,
  startTelegramTypingIndicator,
} from "@murphai/assistant-engine";
import {
  markLinqChatRead,
  probeLinqApi,
  startLinqChatTypingIndicator,
} from "@murphai/operator-config/linq-runtime";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

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
  try {
    return await sendHostedProviderLinqMessageDirect(request, dependencies);
  } catch (error) {
    const recovered = await maybeRecoverHostedProviderMissingLinqThread({
      dependencies,
      error,
      request,
    });
    if (recovered) {
      return recovered;
    }
    throw error;
  }
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

async function sendHostedProviderLinqMessageDirect(
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

async function maybeRecoverHostedProviderMissingLinqThread(input: {
  dependencies: HostedProviderEffectDependencies;
  error: unknown;
  request: HostedRuntimeLinqSendRequest;
}): Promise<HostedRuntimeLinqSendResponse | null> {
  if (
    !looksLikeMissingLinqChatError(input.error)
    || (input.request.targetKind !== "thread" && input.request.targetKind !== "explicit")
  ) {
    return null;
  }

  const recipient = normalizeDirectLinqRecipient(input.request.directRecipientPhoneNumber);
  if (!recipient) {
    return null;
  }

  let senders: string[];
  try {
    const probed = await probeLinqApi({
      env: input.dependencies.env,
      signal: input.dependencies.signal,
    });
    senders = normalizeLinqSenderPhoneNumbers(probed.phoneNumbers);
  } catch {
    return null;
  }

  for (const sender of senders) {
    try {
      const delivered = await sendHostedProviderLinqMessageDirect({
        fromPhoneNumber: sender,
        idempotencyKey: input.request.idempotencyKey ?? null,
        message: input.request.message,
        replyToMessageId: input.request.replyToMessageId ?? null,
        target: recipient,
        targetKind: "participant",
      }, input.dependencies);
      const target =
        normalizeHostedProviderText(delivered.target) ??
        normalizeHostedProviderText(delivered.providerThreadId);
      if (!target) {
        throw createHostedProviderDeliveryConfirmationPendingError(
          "Recovered iMessage direct delivery did not return a chat id.",
        );
      }
      return {
        ...delivered,
        providerThreadId: normalizeHostedProviderText(delivered.providerThreadId) ?? target,
        target,
      };
    } catch (error) {
      if (isHostedProviderDeliveryConfirmationPendingError(error)) {
        throw error;
      }
    }
  }

  return null;
}

function looksLikeMissingLinqChatError(error: unknown): error is VaultCliError {
  return error instanceof VaultCliError
    && error.code === "LINQ_API_REQUEST_FAILED"
    && error.context?.provider === "linq"
    && error.context?.status === 404
    && typeof error.message === "string"
    && error.message.includes("Chat not found");
}

function normalizeDirectLinqRecipient(value: string | null | undefined): string | null {
  const recipient = value?.trim() ?? "";
  return recipient.startsWith("+") ? recipient : null;
}

function normalizeLinqSenderPhoneNumbers(phoneNumbers: readonly unknown[]): string[] {
  return phoneNumbers
    .map((phoneNumber) => typeof phoneNumber === "string" ? phoneNumber.trim() : "")
    .filter((phoneNumber) => phoneNumber.startsWith("+"));
}

function normalizeHostedProviderText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
}

function createHostedProviderDeliveryConfirmationPendingError(detail: string): {
  code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING";
  message: string;
} {
  return {
    code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
    message:
      "Assistant outbound delivery may have succeeded already and must be reconciled before resend. "
      + detail,
  };
}

function isHostedProviderDeliveryConfirmationPendingError(error: unknown): error is {
  code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING";
} {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ASSISTANT_DELIVERY_CONFIRMATION_PENDING";
}
