import {
  reactToLinqMessage,
  sendLinqMessage,
  sendTelegramMessage,
  sendWhatsAppMessage,
  startTelegramTypingIndicator,
} from "@murphai/assistant-engine/assistant-channel-runtime";
import {
  isLinqChatNotFoundSendMessageError,
  markLinqChatRead,
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
} from "@murphai/operator-config/linq-runtime";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import {
  createHostedTelegramAttachmentDownloadDriver,
} from "./hosted-runtime/events/telegram.ts";
import {
  deleteHostedLinqMessages,
} from "./hosted-runtime/message-cleanup.ts";
import {
  requireHostedProviderFetchDependencies,
} from "./hosted-runtime/provider-fetch.ts";
import type {
  HostedRuntimeLinqChatActionRequest,
  HostedRuntimeLinqDeleteMessagesRequest,
  HostedRuntimeLinqMarkReadRequest,
  HostedRuntimeLinqReactionRequest,
  HostedRuntimeLinqReactionResponse,
  HostedRuntimeLinqSendRequest,
  HostedRuntimeLinqSendResponse,
  HostedRuntimeTelegramChatActionRequest,
  HostedRuntimeTelegramDownloadFileRequest,
  HostedRuntimeTelegramFile,
  HostedRuntimeTelegramGetFileRequest,
  HostedRuntimeTelegramSendRequest,
  HostedRuntimeTelegramSendResponse,
  HostedRuntimeWhatsAppSendRequest,
  HostedRuntimeWhatsAppSendResponse,
} from "./hosted-runtime/platform.ts";

export interface HostedProviderEffectDependencies {
  env: NodeJS.ProcessEnv;
  fetchImplementation: typeof fetch | null;
  signal?: AbortSignal;
}

interface HostedProviderEffectContext {
  env: NodeJS.ProcessEnv;
  fetchImplementation: typeof fetch;
  signal?: AbortSignal;
}

export async function sendHostedProviderTelegramMessage(
  request: HostedRuntimeTelegramSendRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeTelegramSendResponse> {
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted Telegram message delivery",
  );
  return await sendTelegramMessage(request, {
    env: context.env,
    fetchImplementation: context.fetchImplementation,
    signal: context.signal,
  });
}

export async function sendHostedProviderTelegramChatAction(
  request: HostedRuntimeTelegramChatActionRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  assertTypingAction(request.action);
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted Telegram chat action",
  );
  const handle = await startTelegramTypingIndicator({
    target: request.target,
  }, {
    env: context.env,
    fetchImplementation: context.fetchImplementation,
    signal: context.signal,
  });
  await handle.stop();
}

export async function getHostedProviderTelegramFile(
  request: HostedRuntimeTelegramGetFileRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeTelegramFile | null> {
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted Telegram file lookup",
  );
  const driver = createHostedTelegramAttachmentDownloadDriver({
    env: context.env,
    fetchImplementation: context.fetchImplementation,
  });
  if (!driver) {
    return null;
  }

  return await driver.getFile(request.fileId, context.signal);
}

export async function downloadHostedProviderTelegramFile(
  request: HostedRuntimeTelegramDownloadFileRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<Uint8Array | null> {
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted Telegram file download",
  );
  const driver = createHostedTelegramAttachmentDownloadDriver({
    env: context.env,
    fetchImplementation: context.fetchImplementation,
  });
  if (!driver) {
    return null;
  }

  return await driver.downloadFile(request.filePath, context.signal);
}

export async function sendHostedProviderLinqMessage(
  request: HostedRuntimeLinqSendRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeLinqSendResponse> {
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted Linq message delivery",
  );
  if (shouldMaterializeHostedProviderLinqDirectThreadFirst(request)) {
    const recovered = await materializeHostedProviderLinqDirectThread({
      context,
      request,
    });
    if (recovered) {
      return recovered;
    }
    throw createHostedProviderLinqRecoverySenderRequiredError();
  }

  try {
    return await sendHostedProviderLinqMessageDirect(request, context);
  } catch (error) {
    const recovered = await maybeRecoverHostedProviderMissingLinqThread({
      context,
      error,
      request,
    });
    if (recovered) {
      return recovered;
    }
    throw error;
  }
}

export async function sendHostedProviderLinqReaction(
  request: HostedRuntimeLinqReactionRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeLinqReactionResponse> {
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted Linq reaction delivery",
  );
  const { targetKind, ...reactionRequest } = request;
  return await reactToLinqMessage({
    ...reactionRequest,
    ...(targetKind ? { targetKind } : {}),
  }, {
    env: context.env,
    fetchImplementation: context.fetchImplementation,
    signal: context.signal,
  });
}

export async function sendHostedProviderWhatsAppMessage(
  request: HostedRuntimeWhatsAppSendRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeWhatsAppSendResponse> {
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted WhatsApp message delivery",
  );
  return await sendWhatsAppMessage(request, {
    env: context.env,
    fetchImplementation: context.fetchImplementation,
    signal: context.signal,
  });
}

export async function sendHostedProviderLinqChatAction(
  request: HostedRuntimeLinqChatActionRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted Linq chat action",
  );
  if (request.action === "typing") {
    await startLinqChatTypingIndicator({
      chatId: request.target,
    }, {
      env: context.env,
      fetchImplementation: context.fetchImplementation,
      signal: context.signal,
    });
    return;
  }

  if (request.action === "typing_stop") {
    await stopLinqChatTypingIndicator({
      chatId: request.target,
    }, {
      env: context.env,
      fetchImplementation: context.fetchImplementation,
      signal: context.signal,
    });
    return;
  }

  throw new TypeError("Hosted provider Linq chat action must be typing or typing_stop.");
}

export async function markHostedProviderLinqRead(
  request: HostedRuntimeLinqMarkReadRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted Linq read receipt",
  );
  await markLinqChatRead({
    chatId: request.chatId,
  }, {
    env: context.env,
    fetchImplementation: context.fetchImplementation,
    signal: context.signal,
  });
}

export async function deleteHostedProviderLinqMessages(
  request: HostedRuntimeLinqDeleteMessagesRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  const context = createHostedProviderEffectContext(
    dependencies,
    "Hosted Linq message cleanup",
  );
  await deleteHostedLinqMessages({
    env: context.env,
    fetchImplementation: context.fetchImplementation,
    messageIds: request.messageIds,
    signal: context.signal,
  });
}

function assertTypingAction(action: string): asserts action is "typing" {
  if (action !== "typing") {
    throw new TypeError("Hosted provider chat action must be typing.");
  }
}

async function sendHostedProviderLinqMessageDirect(
  request: HostedRuntimeLinqSendRequest,
  context: HostedProviderEffectContext,
): Promise<HostedRuntimeLinqSendResponse> {
  return await sendLinqMessage({
    fromPhoneNumber: request.fromPhoneNumber ?? null,
    idempotencyKey: request.idempotencyKey ?? null,
    media: request.media ?? null,
    message: request.message,
    replyToMessageId: request.replyToMessageId ?? null,
    target: request.target,
    ...(request.targetKind === null || request.targetKind === undefined
      ? {}
      : { targetKind: request.targetKind }),
  }, {
    env: context.env,
    fetchImplementation: context.fetchImplementation,
    signal: context.signal,
  });
}

function createHostedProviderEffectContext(
  dependencies: HostedProviderEffectDependencies,
  operation: string,
): HostedProviderEffectContext {
  return requireHostedProviderFetchDependencies(dependencies, operation);
}

async function maybeRecoverHostedProviderMissingLinqThread(input: {
  context: HostedProviderEffectContext;
  error: unknown;
  request: HostedRuntimeLinqSendRequest;
}): Promise<HostedRuntimeLinqSendResponse | null> {
  if (
    !looksLikeMissingLinqChatError(input.error)
    || (input.request.targetKind !== "thread" && input.request.targetKind !== "explicit")
  ) {
    return null;
  }

  return await materializeHostedProviderLinqDirectThread(input);
}

async function materializeHostedProviderLinqDirectThread(input: {
  context: HostedProviderEffectContext;
  request: HostedRuntimeLinqSendRequest;
}): Promise<HostedRuntimeLinqSendResponse | null> {
  const recipient = normalizeDirectLinqRecipient(input.request.directRecipientPhoneNumber);
  if (!recipient) {
    return null;
  }

  const sender = normalizeDirectLinqRecipient(input.request.fromPhoneNumber);
  if (!sender) {
    return null;
  }

  try {
    const delivered = await sendHostedProviderLinqMessageDirect({
      fromPhoneNumber: sender,
      idempotencyKey: input.request.idempotencyKey ?? null,
      media: input.request.media ?? null,
      message: input.request.message,
      replyToMessageId: input.request.replyToMessageId ?? null,
      target: recipient,
      targetKind: "participant",
    }, input.context);
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
    if (isPotentiallyAcceptedLinqDirectThreadRecoveryError(error)) {
      throw createHostedProviderDeliveryConfirmationPendingError(
        "Recovered iMessage direct delivery could not be confirmed safely.",
      );
    }
    throw error;
  }
}

function shouldMaterializeHostedProviderLinqDirectThreadFirst(
  request: HostedRuntimeLinqSendRequest,
): boolean {
  return (
    (request.targetKind === "thread" || request.targetKind === "explicit")
    && normalizeDirectLinqRecipient(request.directRecipientPhoneNumber) !== null
    && looksLikeHostedProviderRedactedLinqTarget(request.target)
  );
}

function looksLikeHostedProviderRedactedLinqTarget(
  value: string | null | undefined,
): boolean {
  const target = value?.trim() ?? "";
  return (
    /^h1_[a-f0-9]{24}$/iu.test(target)
    || /(?:^|:)hid_[A-Za-z0-9_-]+/u.test(target)
    || /(?:^|:)ain_[A-Za-z0-9_-]+/u.test(target)
    || target.includes("hbid:")
    || target.includes("hbidx:")
    || target.startsWith("[redacted")
  );
}

function looksLikeMissingLinqChatError(error: unknown): error is VaultCliError {
  return isLinqChatNotFoundSendMessageError(error);
}

function isPotentiallyAcceptedLinqDirectThreadRecoveryError(
  error: unknown,
): boolean {
  if (!(error instanceof VaultCliError) || error.code !== "LINQ_API_REQUEST_FAILED") {
    return false;
  }

  if (error.context?.retryable === true || error.context?.failureStage === "transport") {
    return true;
  }

  const status = error.context?.status;
  return typeof status === "number" && (status === 408 || status >= 500);
}

function normalizeDirectLinqRecipient(value: string | null | undefined): string | null {
  const recipient = value?.trim() ?? "";
  return recipient.startsWith("+") ? recipient : null;
}

function normalizeHostedProviderText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
}

function createHostedProviderLinqRecoverySenderRequiredError(): VaultCliError {
  return new VaultCliError(
    "ASSISTANT_HOSTED_LINQ_RECOVERY_SENDER_REQUIRED",
    "Hosted Linq direct-thread materialization requires an explicit sender route.",
    {
      retryable: false,
    },
  );
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
