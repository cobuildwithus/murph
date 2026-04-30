import { createHash } from "node:crypto";

import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  type AssistantInputAttachmentDescriptor,
  type AssistantInputProjectionStatus,
  type UpsertAssistantInputEventInput,
} from "@murphai/assistant-engine";

import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  HostedConversationInboxProjectionError,
  importHostedConversationMessageWakeIntoLocalInbox,
} from "./events/conversation.ts";
import {
  prepareHostedLocalRuntimeForConversationImport,
  requireHostedBootstrapForWake,
} from "./context.ts";
import {
  HostedRawEmailMessageMissingError,
} from "./events/email.ts";

const CONVERSATION_CAPTURE_PERSIST_FAILED_REASON =
  "conversation-import.capture-persist-failed";
const CONVERSATION_PROJECTION_FAILED_REASON =
  "conversation-import.projection-failed";
const CONVERSATION_RAW_EMAIL_MISSING_REASON =
  "conversation-import.raw-email-missing";

export type HostedConversationMailboxPayloadDecodeResult =
  | {
      status: "decoded";
      wake: HostedExecutionConversationMessageWake;
    }
  | {
      reasonCode: string;
      retryable: boolean;
      status: "blocked";
    };

export interface HostedConversationMailboxPayloadDecoder {
  decode(
    input: HostedConversationMailboxPayloadDecodeInput,
  ): Promise<HostedConversationMailboxPayloadDecodeResult>;
}

export interface HostedConversationMailboxPayloadDecodeInput {
  itemRef: {
    id: string;
    laneSeq: string;
    userId: string;
  };
  payloadCiphertext: string;
  payloadRequestId: string | null;
  payloadSchema: string;
  payloadSource: "inline" | "sidecar";
}

export interface HostedConversationMailboxLocalImportResult {
  captureId: string | null;
  deduped: boolean;
  durable?: boolean;
  metrics: HostedConversationWakeMetrics;
}

export type HostedConversationMailboxLocalImporter = (input: {
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}) => Promise<HostedConversationMailboxLocalImportResult>;

export interface HostedConversationMailboxAssistantInputProjectionUpdate {
  captureId: string | null;
  reasonCode: string | null;
  status: Extract<AssistantInputProjectionStatus, "failed" | "succeeded">;
}

export interface HostedConversationMailboxAssistantInputStageResult {
  inputId: string;
  recordProjection(
    input: HostedConversationMailboxAssistantInputProjectionUpdate,
  ): Promise<void>;
}

export type HostedConversationMailboxAssistantInputStager = (input: {
  item: HostedMailboxResolvedImportItem;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}) => Promise<HostedConversationMailboxAssistantInputStageResult>;

export type HostedConversationMailboxWakeContextPreparer = (input: {
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}) => Promise<void>;

export type HostedConversationMailboxImportOutcome =
  | {
      afterCheckpoint?: (() => Promise<void>) | null;
      captureId: string | null;
      metrics: HostedConversationWakeMetrics;
      reasonCode?: string | null;
      status: "imported";
    }
  | {
      afterCheckpoint?: (() => Promise<void>) | null;
      captureId: string | null;
      metrics: HostedConversationWakeMetrics;
      reasonCode: "capture.deduped";
      status: "skipped";
    }
  | {
      reasonCode: string;
      retryable: boolean;
      status: "blocked";
    }
  | {
      reasonCode: string;
      status: "deferred";
    };

export function createHostedConversationMailboxImportItem(input: {
  decodePayload: HostedConversationMailboxPayloadDecoder;
  importConversationWake?: HostedConversationMailboxLocalImporter;
  prepareWakeContext?: HostedConversationMailboxWakeContextPreparer;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  stageAssistantInputEvent?: HostedConversationMailboxAssistantInputStager;
  vaultRoot: string;
}): (item: HostedMailboxResolvedImportItem) => Promise<HostedMailboxItemImportOutcome> {
  return (item) =>
    importHostedConversationMailboxItem({
      ...input,
      item,
    });
}

export async function importHostedConversationMailboxItem(input: {
  decodePayload: HostedConversationMailboxPayloadDecoder;
  importConversationWake?: HostedConversationMailboxLocalImporter;
  prepareWakeContext?: HostedConversationMailboxWakeContextPreparer;
  item: HostedMailboxResolvedImportItem;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  stageAssistantInputEvent?: HostedConversationMailboxAssistantInputStager;
  vaultRoot: string;
}): Promise<HostedConversationMailboxImportOutcome> {
  if (
    input.item.route.action !== "import-conversation-message"
    || input.item.item.kind !== "conversation.message"
  ) {
    return {
      reasonCode: "conversation_import.unexpected_route",
      status: "deferred",
    };
  }

  const decoded = await input.decodePayload.decode({
    itemRef: {
      id: input.item.item.id,
      laneSeq: input.item.item.laneSeq,
      userId: input.item.item.userId,
    },
    payloadCiphertext: input.item.payload.payloadCiphertext,
    payloadRequestId: input.item.payload.requestId,
    payloadSchema: input.item.payload.payloadSchema,
    payloadSource: input.item.payload.source,
  });

  if (decoded.status === "blocked") {
    return {
      reasonCode: normalizeConversationMailboxReasonCode(
        decoded.reasonCode,
        "payload.decode_unavailable",
      ),
      retryable: decoded.retryable,
      status: "blocked",
    };
  }

  if (!decodedWakeMatchesMailboxItem(decoded.wake, input.item.item)) {
    return {
      reasonCode: "payload.decode_mismatch",
      retryable: false,
      status: "blocked",
    };
  }

  const stageAssistantInputEvent =
    input.stageAssistantInputEvent ?? stageHostedConversationAssistantInputEvent;

  const importConversationWake =
    input.importConversationWake ?? importHostedConversationWakeWithLocalInbox;
  const prepareWakeContext =
    input.prepareWakeContext ?? prepareHostedConversationMailboxWakeContext;
  if (!input.prepareWakeContext) {
    await requireHostedBootstrapForWake(input.vaultRoot, decoded.wake);
  }

  const stagedInput = await stageAssistantInputEvent({
    item: input.item,
    vaultRoot: input.vaultRoot,
    wake: decoded.wake,
  });

  await prepareWakeContext({
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
    wake: decoded.wake,
  });

  let imported: HostedConversationMailboxLocalImportResult;
  try {
    imported = await importConversationWake({
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
      wake: decoded.wake,
    });
  } catch (error) {
    const projectionFailureReason =
      readHostedConversationProjectionFailureReason(error);
    if (!projectionFailureReason) {
      throw error;
    }

    await recordHostedConversationProjectionBestEffort(stagedInput, {
      captureId: null,
      reasonCode: projectionFailureReason,
      status: "failed",
    });

    return {
      captureId: null,
      metrics: createEmptyHostedConversationWakeMetrics(),
      reasonCode: projectionFailureReason,
      status: "imported",
    };
  }
  if (imported.durable === false) {
    await recordHostedConversationProjectionBestEffort(stagedInput, {
      captureId: null,
      reasonCode: CONVERSATION_CAPTURE_PERSIST_FAILED_REASON,
      status: "failed",
    });
    return {
      captureId: imported.captureId,
      metrics: imported.metrics,
      reasonCode: CONVERSATION_CAPTURE_PERSIST_FAILED_REASON,
      status: "imported",
    };
  }
  if (imported.captureId) {
    await recordHostedConversationProjectionBestEffort(stagedInput, {
      captureId: imported.captureId,
      reasonCode: null,
      status: "succeeded",
    });
  }
  if (imported.deduped) {
    return {
      captureId: imported.captureId,
      metrics: imported.metrics,
      reasonCode: "capture.deduped",
      status: "skipped",
    };
  }

  return {
    captureId: imported.captureId,
    metrics: imported.metrics,
    status: "imported",
  };
}

async function importHostedConversationWakeWithLocalInbox(input: {
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}): Promise<HostedConversationMailboxLocalImportResult> {
  const result = await importHostedConversationMessageWakeIntoLocalInbox(input);
  return {
    captureId: result.capture.captureId,
    deduped: result.capture.deduped,
    durable: result.capturePersistence === "canonical",
    metrics: result.metrics,
  };
}

async function stageHostedConversationAssistantInputEvent(input: {
  item: HostedMailboxResolvedImportItem;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}): Promise<HostedConversationMailboxAssistantInputStageResult> {
  const event = await upsertAssistantInputEvent({
    event: createHostedConversationAssistantInputEvent({
      item: input.item,
      wake: input.wake,
    }),
    vault: input.vaultRoot,
  });

  return {
    inputId: event.inputId,
    async recordProjection(projection) {
      await updateAssistantInputProjection({
        inputId: event.inputId,
        projection: {
          captureId: projection.captureId,
          lastAttemptedAt: new Date().toISOString(),
          reasonCode: projection.reasonCode,
          status: projection.status,
        },
        vault: input.vaultRoot,
      });
    },
  };
}

function readHostedConversationProjectionFailureReason(
  error: unknown,
): string | null {
  if (error instanceof HostedRawEmailMessageMissingError) {
    return CONVERSATION_RAW_EMAIL_MISSING_REASON;
  }

  if (error instanceof HostedConversationInboxProjectionError) {
    return CONVERSATION_PROJECTION_FAILED_REASON;
  }

  return null;
}

function createHostedConversationAssistantInputEvent(input: {
  item: HostedMailboxResolvedImportItem;
  wake: HostedExecutionConversationMessageWake;
}): UpsertAssistantInputEventInput {
  const content = createHostedConversationAssistantInputContent(input.wake);

  return {
    content,
    conversation: createHostedConversationAssistantInputConversation(input.wake),
    occurredAt: input.wake.occurredAt,
    receivedAt: input.item.item.createdAt,
    replyTarget: createHostedConversationAssistantInputReplyTarget(input.wake),
    sourceRef: {
      dedupeKey: safeHostedAssistantInputTokenOrHash(input.item.item.dedupeKey),
      eventId: safeHostedAssistantInputTokenOrHash(input.wake.eventId),
      itemId: safeHostedAssistantInputTokenOrHash(input.item.item.id),
      kind: "hosted-mailbox",
      lane: input.item.item.lane,
      laneSeq: safeHostedAssistantInputTokenOrHash(input.item.item.laneSeq),
      payloadSchema: safeHostedAssistantInputTokenOrHash(input.item.payload.payloadSchema),
      payloadSource: input.item.payload.source,
      source: "hosted-mailbox",
      wakeSchema: "murph.hosted-execution-wake.v1",
    },
  };
}

function createHostedConversationAssistantInputContent(
  wake: HostedExecutionConversationMessageWake,
): UpsertAssistantInputEventInput["content"] {
  const text = createHostedConversationAssistantInputText(wake);
  return {
    attachmentDescriptors: createHostedConversationAssistantInputAttachmentDescriptors(wake),
    text,
    transcriptText: text,
    userMessageContent: text
      ? [
          {
            text,
            type: "text",
          },
        ]
      : null,
  };
}

function createHostedConversationAssistantInputText(
  wake: HostedExecutionConversationMessageWake,
): string {
  if (isHostedLinqConversationMessageWake(wake)) {
    const textParts = wake.message.linqMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => part.value);
    const sanitized = sanitizeHostedAssistantInputText(textParts.join("\n"));
    if (sanitized) {
      return sanitized;
    }
    const attachmentCount = wake.message.linqMessage.parts.filter((part) =>
      part.type === "media" || part.type === "voice_memo"
    ).length;
    return attachmentCount > 0
      ? `Received a Linq message with ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}.`
      : "Received a Linq message.";
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    const sanitized = sanitizeHostedAssistantInputText(
      wake.message.telegramMessage.text ?? "",
    );
    if (sanitized) {
      return sanitized;
    }
    const attachmentCount = wake.message.telegramMessage.attachments?.length ?? 0;
    return attachmentCount > 0
      ? `Received a Telegram message with ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}.`
      : "Received a Telegram message.";
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    return "Received an email message.";
  }

  return "Received a hosted conversation message.";
}

function createHostedConversationAssistantInputConversation(
  wake: HostedExecutionConversationMessageWake,
): UpsertAssistantInputEventInput["conversation"] {
  if (isHostedLinqConversationMessageWake(wake)) {
    return {
      accountId: safeHostedAssistantInputTokenOrHash(wake.message.phoneLookupKey),
      actorId: safeHostedAssistantInputTokenOrHash(wake.message.linqMessage.from),
      actorIsSelf: wake.message.linqMessage.isFromMe,
      source: "linq",
      threadId: safeHostedAssistantInputTokenOrHash(wake.message.linqMessage.chatId),
      threadIsDirect: true,
    };
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return {
      accountId: "bot",
      actorId: null,
      actorIsSelf: false,
      source: "telegram",
      threadId: safeHostedAssistantInputTokenOrHash(wake.message.telegramMessage.threadId),
      threadIsDirect: null,
    };
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    return {
      accountId: safeHostedAssistantInputTokenOrHash(
        wake.message.identityId ?? "email",
      ),
      actorId: null,
      actorIsSelf: false,
      source: "email",
      threadId: safeHostedAssistantInputTokenOrHash(wake.message.rawMessageKey),
      threadIsDirect: true,
    };
  }

  return null;
}

function createHostedConversationAssistantInputReplyTarget(
  wake: HostedExecutionConversationMessageWake,
): UpsertAssistantInputEventInput["replyTarget"] {
  if (isHostedLinqConversationMessageWake(wake)) {
    return {
      channel: "linq",
      messageId: safeHostedAssistantInputTokenOrHash(
        wake.message.linqMessage.messageId,
      ),
      threadId: safeHostedAssistantInputTokenOrHash(wake.message.linqMessage.chatId),
    };
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return {
      channel: "telegram",
      messageId: safeHostedAssistantInputTokenOrHash(
        wake.message.telegramMessage.messageId,
      ),
      threadId: safeHostedAssistantInputTokenOrHash(
        wake.message.telegramMessage.threadId,
      ),
    };
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    return {
      channel: "email",
      messageId: safeHostedAssistantInputTokenOrHash(wake.eventId),
      threadId: safeHostedAssistantInputTokenOrHash(wake.message.rawMessageKey),
    };
  }

  return null;
}

function createHostedConversationAssistantInputAttachmentDescriptors(
  wake: HostedExecutionConversationMessageWake,
): AssistantInputAttachmentDescriptor[] {
  if (isHostedLinqConversationMessageWake(wake)) {
    return wake.message.linqMessage.parts.flatMap((part, index) => {
      if (part.type !== "media" && part.type !== "voice_memo") {
        return [];
      }
      return [{
        attachmentId: safeHostedAssistantInputTokenOrHash(
          part.attachmentId ?? `part_${index}`,
        ),
        contentType: normalizeHostedAssistantInputMimeType(part.mimeType),
        fileName: null,
        kind: part.type,
        sizeBytes: normalizeHostedAssistantInputSize(part.size),
      }];
    });
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return (wake.message.telegramMessage.attachments ?? []).map((attachment) => ({
      attachmentId: safeHostedAssistantInputTokenOrHash(attachment.fileId),
      contentType: normalizeHostedAssistantInputMimeType(attachment.mimeType),
      fileName: null,
      kind: safeHostedAssistantInputTokenOrHash(attachment.kind),
      sizeBytes: normalizeHostedAssistantInputSize(attachment.fileSize),
    }));
  }

  return [];
}

async function recordHostedConversationProjectionBestEffort(
  stagedInput: HostedConversationMailboxAssistantInputStageResult,
  projection: HostedConversationMailboxAssistantInputProjectionUpdate,
): Promise<void> {
  try {
    await stagedInput.recordProjection(projection);
  } catch {
    // Projection status is diagnostic/enrichment state; staged input remains durable.
  }
}

function createEmptyHostedConversationWakeMetrics(): HostedConversationWakeMetrics {
  return {
    nextWakeAt: null,
    parserProcessed: 0,
  };
}

function safeHostedAssistantInputTokenOrHash(value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized.length > 0
    && normalized.length <= 192
    && /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,191}$/u.test(normalized)
    && !isUnsafeHostedAssistantInputToken(normalized)
  ) {
    return normalized;
  }

  return `tok_${createHash("sha256").update(normalized || "empty").digest("hex").slice(0, 32)}`;
}

function isUnsafeHostedAssistantInputToken(value: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(value)
    || /^[A-Za-z]:[\\/]/u.test(value)
    || value.startsWith("/")
    || value.startsWith("~/")
    || value.includes("\\")
    || value.includes("../")
    || value.includes("/../")
    || value.includes("?")
    || value.includes("#")
    || value.includes("@")
    || value.includes("{")
    || value.includes("}")
    || value.includes("\"")
    || value.toLowerCase().includes("authorization")
  );
}

function sanitizeHostedAssistantInputText(value: string): string | null {
  const sanitized = value
    .replace(/https?:\/\/[^\s"'<>]+/giu, "[link omitted]")
    .replace(/file:\/\/[^\s"'<>]+/giu, "[path omitted]")
    .replace(/(^|[\s("'=])(?:[A-Za-z]:[\\/]|\/[^\s"'<>]+|~\/|\.\.\/|\.\.\\)[^\s"'<>]*/gu, "$1[path omitted]")
    .trim();

  if (sanitized.length === 0) {
    return null;
  }

  return sanitized.length > 20_000 ? sanitized.slice(0, 20_000) : sanitized;
}

function normalizeHostedAssistantInputMimeType(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9.+-]{0,126}$/u
      .test(normalized)
    ? normalized
    : null;
}

function normalizeHostedAssistantInputSize(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function decodedWakeMatchesMailboxItem(
  wake: HostedExecutionConversationMessageWake,
  item: HostedMailboxResolvedImportItem["item"],
): boolean {
  return wake.kind === "conversation.message"
    && wake.userId === item.userId
    && wake.occurredAt === item.occurredAt
    && wake.eventId === item.dedupeKey;
}

async function prepareHostedConversationMailboxWakeContext(input: {
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "resolvedConfig" | "userEnv"
  >;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}): Promise<void> {
  void input.runtime;
  await requireHostedBootstrapForWake(input.vaultRoot, input.wake);
  await prepareHostedLocalRuntimeForConversationImport(
    input.vaultRoot,
    input.wake.eventId,
  );
}

function normalizeConversationMailboxReasonCode(
  value: string,
  fallback: string,
): string {
  const normalized = value.trim();
  return /^[a-z][a-z0-9._-]{0,95}$/u.test(normalized)
    ? normalized
    : fallback;
}
