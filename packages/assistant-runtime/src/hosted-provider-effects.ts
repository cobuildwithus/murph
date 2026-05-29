import {
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
  type LinqFetch,
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
  HostedRuntimeWhatsAppSendRequest,
  HostedRuntimeWhatsAppSendResponse,
} from "./hosted-runtime/platform.ts";

export interface HostedProviderEffectDependencies {
  env: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  signal?: AbortSignal;
}

export async function sendHostedProviderTelegramMessage(
  request: HostedRuntimeTelegramSendRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeTelegramSendResponse> {
  return await sendTelegramMessage(request, {
    env: dependencies.env,
    fetchImplementation: dependencies.fetchImplementation,
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
    fetchImplementation: dependencies.fetchImplementation,
    signal: dependencies.signal,
  });
  await handle.stop();
}

export async function getHostedProviderTelegramFile(
  request: HostedRuntimeTelegramGetFileRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeTelegramFile | null> {
  const driver = createHostedTelegramAttachmentDownloadDriver({
    env: dependencies.env,
    fetchImplementation: dependencies.fetchImplementation,
  });
  if (!driver) {
    return null;
  }

  return await driver.getFile(request.fileId, dependencies.signal);
}

export async function downloadHostedProviderTelegramFile(
  request: HostedRuntimeTelegramDownloadFileRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<Uint8Array | null> {
  const driver = createHostedTelegramAttachmentDownloadDriver({
    env: dependencies.env,
    fetchImplementation: dependencies.fetchImplementation,
  });
  if (!driver) {
    return null;
  }

  return await driver.downloadFile(request.filePath, dependencies.signal);
}

export async function sendHostedProviderLinqMessage(
  request: HostedRuntimeLinqSendRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeLinqSendResponse> {
  if (shouldMaterializeHostedProviderLinqDirectThreadFirst(request)) {
    const recovered = await materializeHostedProviderLinqDirectThread({
      dependencies,
      request,
    });
    if (recovered) {
      return recovered;
    }
    throw createHostedProviderLinqRecoverySenderRequiredError();
  }

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

export async function sendHostedProviderWhatsAppMessage(
  request: HostedRuntimeWhatsAppSendRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<HostedRuntimeWhatsAppSendResponse> {
  return await sendWhatsAppMessage(request, {
    env: dependencies.env,
    fetchImplementation: dependencies.fetchImplementation,
    signal: dependencies.signal,
  });
}

export async function sendHostedProviderLinqChatAction(
  request: HostedRuntimeLinqChatActionRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  const fetchImplementation = adaptHostedProviderFetchForLinq(
    dependencies.fetchImplementation,
  );
  if (request.action === "typing") {
    await startLinqChatTypingIndicator({
      chatId: request.target,
    }, {
      env: dependencies.env,
      fetchImplementation,
      signal: dependencies.signal,
    });
    return;
  }

  if (request.action === "typing_stop") {
    await stopLinqChatTypingIndicator({
      chatId: request.target,
    }, {
      env: dependencies.env,
      fetchImplementation,
      signal: dependencies.signal,
    });
    return;
  }

  throw new TypeError("Hosted provider Linq chat action must be typing or typing_stop.");
}

export async function markHostedProviderLinqRead(
  request: HostedRuntimeLinqMarkReadRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  await markLinqChatRead({
    chatId: request.chatId,
  }, {
    env: dependencies.env,
    fetchImplementation: adaptHostedProviderFetchForLinq(
      dependencies.fetchImplementation,
    ),
    signal: dependencies.signal,
  });
}

export async function deleteHostedProviderLinqMessages(
  request: HostedRuntimeLinqDeleteMessagesRequest,
  dependencies: HostedProviderEffectDependencies,
): Promise<void> {
  await deleteHostedLinqMessages({
    env: dependencies.env,
    fetchImplementation: adaptHostedProviderFetchForLinq(
      dependencies.fetchImplementation,
    ),
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
    fetchImplementation: adaptHostedProviderFetchForLinq(dependencies.fetchImplementation),
    signal: dependencies.signal,
  });
}

function adaptHostedProviderFetchForLinq(
  fetchImplementation: typeof fetch | undefined,
): LinqFetch | undefined {
  if (!fetchImplementation) {
    return undefined;
  }

  return async (input, init) => fetchImplementation(input, init);
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

  return await materializeHostedProviderLinqDirectThread(input);
}

async function materializeHostedProviderLinqDirectThread(input: {
  dependencies: HostedProviderEffectDependencies;
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
