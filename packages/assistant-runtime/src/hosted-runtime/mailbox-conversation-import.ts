import { createHash } from "node:crypto";

import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  isHostedWhatsAppConversationMessageWake,
  readHostedLinqConversationMessageContact,
} from "@murphai/hosted-execution";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
  hashNullableHostedAssistantConversationIdentifier,
  type HostedAssistantConversationIdentifierBlind,
} from "@murphai/hosted-execution/assistant-identifiers";
import {
  createAssistantInputAttachmentEvidenceFromInboxCapture,
  materializeAssistantInputAttachmentRawArtifactRefs,
  readAssistantInputEvent,
  updateAssistantInputAttachmentEvidence,
  type AssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  type AssistantInputAttachmentDescriptor,
  type AssistantInputProjectionStatus,
  type InboxCaptureAttachmentLike,
  normalizeAssistantInputFileName,
  type UpsertAssistantInputEventInput,
} from "@murphai/assistant-engine";
import { createIntegratedInboxServices } from "@murphai/inbox-services";

import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxPostCheckpointEffectResult,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  importHostedConversationMessageWakeIntoLocalInbox,
} from "./events/conversation.ts";
import {
  prepareHostedInboxProjectionRuntime,
  prepareHostedAssistantAutoReplyForWake,
  requireHostedBootstrapForWake,
} from "./context.ts";
import {
  HostedRawEmailMessageMissingError,
} from "./events/email.ts";

const CONVERSATION_PROJECTION_FAILED_REASON =
  "conversation-import.projection-failed";
const CONVERSATION_ATTACHMENT_EVIDENCE_FAILED_REASON =
  "conversation-import.attachment-evidence-failed";
const CONVERSATION_PROJECTION_UPDATE_FAILED_REASON =
  "conversation-import.projection-update-failed";
const CONVERSATION_ATTACHMENT_EVIDENCE_UPDATE_FAILED_REASON =
  "conversation-import.attachment-evidence-update-failed";
const CONVERSATION_INBOX_RUNTIME_UNAVAILABLE_REASON =
  "conversation-import.inbox-runtime-unavailable";
const CONVERSATION_RAW_EMAIL_MISSING_REASON =
  "conversation-import.raw-email-missing";
const ATTACHMENT_EVIDENCE_PARTIAL_REASON =
  "attachment.evidence_partial";
const ASSISTANT_INPUT_SOURCE_METADATA_TEXT_MAX_LENGTH = 512;

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
    dedupeKey: string;
    id: string;
    kind: string;
    lane: string;
    laneSeq: string;
    occurredAt: string;
    userId: string;
  };
  payloadCiphertext: string;
  payloadRequestId: string | null;
  payloadSchema: string;
  payloadSource: "inline" | "sidecar";
}

export interface HostedConversationMailboxLocalImportResult {
  captureId: string | null;
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
  attachmentDescriptorCount?: number;
  inputId: string;
  recordAttachmentEvidence?(
    attachmentEvidence: AssistantInputAttachmentEvidence,
  ): Promise<boolean>;
  recordProjection(
    input: HostedConversationMailboxAssistantInputProjectionUpdate,
  ): Promise<void>;
}

export type HostedConversationMailboxAssistantInputStager = (input: {
  item: HostedMailboxResolvedImportItem;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}) => Promise<HostedConversationMailboxAssistantInputStageResult>;

export interface HostedConversationMailboxAttachmentEvidenceCapture {
  attachments: readonly InboxCaptureAttachmentLike[];
  captureId: string;
}

interface HostedConversationAttachmentEvidenceUpdateResult {
  reasonCode: string | null;
  updated: boolean | null;
}

export type HostedConversationMailboxAttachmentEvidenceCaptureLoader = (input: {
  captureId: string;
  requestId: string | null;
  vaultRoot: string;
}) => Promise<HostedConversationMailboxAttachmentEvidenceCapture>;

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
      afterCheckpoint?: (() => Promise<HostedMailboxPostCheckpointEffectResult>) | null;
      assistantInputId?: string | null;
      captureId: string | null;
      metrics: HostedConversationWakeMetrics;
      reasonCode?: string | null;
      status: "imported";
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
  loadAttachmentEvidenceCapture?: HostedConversationMailboxAttachmentEvidenceCaptureLoader;
  onDecodedConversationWake?(wake: HostedExecutionConversationMessageWake): void;
  prepareWakeContext?: HostedConversationMailboxWakeContextPreparer;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  stageAssistantInputEvent?: HostedConversationMailboxAssistantInputStager;
  vaultRoot: string;
}): (
  item: HostedMailboxResolvedImportItem,
  context?: { runtimeAttemptId?: string | null },
) => Promise<HostedMailboxItemImportOutcome> {
  return (item, context) =>
    importHostedConversationMailboxItem({
      ...input,
      item,
      runtimeAttemptId: context?.runtimeAttemptId ?? null,
    });
}

export async function importHostedConversationMailboxItem(input: {
  decodePayload: HostedConversationMailboxPayloadDecoder;
  importConversationWake?: HostedConversationMailboxLocalImporter;
  loadAttachmentEvidenceCapture?: HostedConversationMailboxAttachmentEvidenceCaptureLoader;
  prepareWakeContext?: HostedConversationMailboxWakeContextPreparer;
  item: HostedMailboxResolvedImportItem;
  onDecodedConversationWake?(wake: HostedExecutionConversationMessageWake): void;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeAttemptId?: string | null;
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
      dedupeKey: input.item.item.dedupeKey,
      id: input.item.item.id,
      kind: input.item.item.kind,
      lane: input.item.item.lane,
      laneSeq: input.item.item.laneSeq,
      occurredAt: input.item.item.occurredAt,
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

  input.onDecodedConversationWake?.(decoded.wake);

  const stageAssistantInputEvent =
    input.stageAssistantInputEvent ?? stageHostedConversationAssistantInputEvent;

  const importConversationWake =
    input.importConversationWake ?? importHostedConversationWakeWithLocalInbox;
  const loadAttachmentEvidenceCapture =
    input.loadAttachmentEvidenceCapture
    ?? loadHostedConversationAttachmentEvidenceCapture;
  const prepareWakeContext =
    input.prepareWakeContext ?? prepareHostedConversationMailboxWakeContext;
  if (!input.prepareWakeContext) {
    await requireHostedBootstrapForWake(input.vaultRoot, decoded.wake);
    if (decoded.wake.message.channel === "linq") {
      await prepareHostedAssistantAutoReplyForWake(
        input.vaultRoot,
        decoded.wake,
        {
          ...input.runtime.forwardedEnv,
          ...input.runtime.userEnv,
        },
        input.runtime.resolvedConfig,
      );
    }
  }

  const stagedInput = await stageAssistantInputEvent({
    item: input.item,
    vaultRoot: input.vaultRoot,
    wake: decoded.wake,
  });
  recordHostedConversationLatencyTraceAssistantInputStagedBestEffort({
    inputId: stagedInput.inputId,
    item: input.item,
    runtime: input.runtime,
    runtimeAttemptId: input.runtimeAttemptId ?? null,
    wake: decoded.wake,
  });

  return {
    afterCheckpoint: async () => {
      return await projectHostedConversationAssistantInputBestEffort({
        importConversationWake,
        loadAttachmentEvidenceCapture,
        prepareWakeContext,
        runtime: input.runtime,
        stagedInput,
        vaultRoot: input.vaultRoot,
        wake: decoded.wake,
      });
    },
    assistantInputId: stagedInput.inputId,
    captureId: null,
    metrics: createEmptyHostedConversationWakeMetrics(),
    status: "imported",
  };
}

function recordHostedConversationLatencyTraceAssistantInputStagedBestEffort(input: {
  inputId: string;
  item: HostedMailboxResolvedImportItem;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "platform">;
  runtimeAttemptId?: string | null;
  wake: HostedExecutionConversationMessageWake;
}): void {
  if (input.wake.message.channel !== "linq") {
    return;
  }
  const latencyTracePort = input.runtime.platform.latencyTracePort ?? null;
  if (!latencyTracePort) {
    return;
  }

  try {
    void latencyTracePort.record({
      event: {
        assistantInputId: input.inputId,
        at: new Date().toISOString(),
        mailboxItemId: input.item.item.id,
        runtimeAttemptId: input.runtimeAttemptId ?? null,
        source: "linq",
        type: "assistant_input_staged",
      },
    }).catch(() => {
      // Latency traces are diagnostic-only and must not affect runtime progress.
    });
  } catch {
    // Latency traces are diagnostic-only and must not affect runtime progress.
  }
}

async function projectHostedConversationAssistantInputBestEffort(input: {
  importConversationWake: HostedConversationMailboxLocalImporter;
  loadAttachmentEvidenceCapture: HostedConversationMailboxAttachmentEvidenceCaptureLoader;
  prepareWakeContext: HostedConversationMailboxWakeContextPreparer;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  stagedInput: HostedConversationMailboxAssistantInputStageResult;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}): Promise<HostedMailboxPostCheckpointEffectResult> {
  let imported: HostedConversationMailboxLocalImportResult;
  try {
    await input.prepareWakeContext({
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
    imported = await input.importConversationWake({
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
  } catch (error) {
    const reasonCode = readHostedConversationProjectionFailureReason(error);
    const projectionUpdated = await recordHostedConversationProjectionBestEffort(input.stagedInput, {
      captureId: null,
      reasonCode,
      status: "failed",
    });
    const attachmentEvidenceUpdated = await recordHostedConversationAttachmentEvidenceFailureBestEffort({
      optionalInboxCaptureId: null,
      reasonCode: readHostedConversationAttachmentEvidenceFailureReason(error),
      stagedInput: input.stagedInput,
    });
    return {
      attachmentEvidenceUpdated,
      kind: "inbox_projection",
      projectionUpdated,
      reasonCode,
      status: "failed",
    };
  }

  if (!imported.captureId) {
    return {
      attachmentEvidenceUpdated: null,
      kind: "inbox_projection",
      projectionUpdated: null,
      reasonCode: null,
      status: "succeeded",
    };
  }

  const projectionUpdated = await recordHostedConversationProjectionBestEffort(input.stagedInput, {
    captureId: imported.captureId,
    reasonCode: null,
    status: "succeeded",
  });
  const attachmentEvidenceResult = await recordHostedConversationAttachmentEvidenceFromProjectionBestEffort({
    captureId: imported.captureId,
    loadAttachmentEvidenceCapture: input.loadAttachmentEvidenceCapture,
    requestId: input.wake.eventId,
    stagedInput: input.stagedInput,
    vaultRoot: input.vaultRoot,
  });
  return buildHostedConversationProjectionEffectResult({
    attachmentEvidenceResult,
    projectionUpdated,
  });
}

function buildHostedConversationProjectionEffectResult(input: {
  attachmentEvidenceResult: HostedConversationAttachmentEvidenceUpdateResult;
  projectionUpdated: boolean;
}): HostedMailboxPostCheckpointEffectResult {
  const reasonCode = input.projectionUpdated
    ? input.attachmentEvidenceResult.reasonCode
    : CONVERSATION_PROJECTION_UPDATE_FAILED_REASON;
  const status =
    input.projectionUpdated
    && input.attachmentEvidenceResult.updated !== false
    && !input.attachmentEvidenceResult.reasonCode
      ? "succeeded"
      : "partial";

  return {
    attachmentEvidenceUpdated: input.attachmentEvidenceResult.updated,
    kind: "inbox_projection",
    projectionUpdated: input.projectionUpdated,
    reasonCode,
    status,
  };
}

async function recordHostedConversationAttachmentEvidenceFromProjectionBestEffort(input: {
  captureId: string;
  loadAttachmentEvidenceCapture: HostedConversationMailboxAttachmentEvidenceCaptureLoader;
  requestId: string | null;
  stagedInput: HostedConversationMailboxAssistantInputStageResult;
  vaultRoot: string;
}): Promise<HostedConversationAttachmentEvidenceUpdateResult> {
  if (!shouldRecordHostedConversationAttachmentEvidence(input.stagedInput)) {
    return {
      reasonCode: null,
      updated: null,
    };
  }

  try {
    const capture = await input.loadAttachmentEvidenceCapture({
      captureId: input.captureId,
      requestId: input.requestId,
      vaultRoot: input.vaultRoot,
    });
    const updated = await recordHostedConversationAttachmentEvidenceBestEffort({
      attachmentEvidence:
        await createHostedConversationAttachmentEvidenceFromCaptureWithRawRefs({
          capture,
          inputId: input.stagedInput.inputId,
          source: "hosted-inbox-projection",
          vaultRoot: input.vaultRoot,
        }),
      stagedInput: input.stagedInput,
    });
    return {
      reasonCode: updated ? null : CONVERSATION_ATTACHMENT_EVIDENCE_UPDATE_FAILED_REASON,
      updated,
    };
  } catch (error) {
    const reasonCode = readHostedConversationAttachmentEvidenceFailureReason(error);
    const updated = await recordHostedConversationAttachmentEvidenceFailureBestEffort({
      optionalInboxCaptureId: input.captureId,
      reasonCode,
      stagedInput: input.stagedInput,
    });
    return {
      reasonCode,
      updated,
    };
  }
}

async function loadHostedConversationAttachmentEvidenceCapture(input: {
  captureId: string;
  requestId: string | null;
  vaultRoot: string;
}): Promise<HostedConversationMailboxAttachmentEvidenceCapture> {
  const inboxServices = createIntegratedInboxServices();
  const result = await inboxServices.show({
    captureId: input.captureId,
    requestId: input.requestId,
    vault: input.vaultRoot,
  });
  return {
    attachments: result.capture.attachments,
    captureId: result.capture.captureId,
  };
}

async function createHostedConversationAttachmentEvidenceFromCaptureWithRawRefs(input: {
  capture: HostedConversationMailboxAttachmentEvidenceCapture;
  inputId: string;
  source: NonNullable<AssistantInputAttachmentEvidence["source"]>;
  vaultRoot: string;
}): Promise<AssistantInputAttachmentEvidence> {
  const rawArtifactRefs = await materializeAssistantInputAttachmentRawArtifactRefs({
    attachments: input.capture.attachments,
    inputId: input.inputId,
    vaultRoot: input.vaultRoot,
  });
  return createAssistantInputAttachmentEvidenceFromInboxCapture({
    capture: input.capture,
    rawArtifactPathForAttachment: ({ index }) => rawArtifactRefs.get(index) ?? null,
    source: input.source,
  });
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
  if (event.projection.status === "not_attempted") {
    await updateAssistantInputProjection({
      inputId: event.inputId,
      projection: {
        status: "pending",
      },
      vault: input.vaultRoot,
    });
  }

  return {
    attachmentDescriptorCount: event.content.attachmentDescriptors.length,
    inputId: event.inputId,
    async recordAttachmentEvidence(attachmentEvidence) {
      if (attachmentEvidence.status === "failed") {
        const latestEvent = await readAssistantInputEvent({
          inputId: event.inputId,
          vault: input.vaultRoot,
        });
        if (
          isUsefulHostedAttachmentEvidence(
            latestEvent?.attachmentEvidence ?? event.attachmentEvidence,
          )
        ) {
          return false;
        }
      }

      const updated = await updateAssistantInputAttachmentEvidence({
        attachmentEvidence: {
          ...attachmentEvidence,
          updatedAt: new Date().toISOString(),
        },
        inputId: event.inputId,
        preserveUsefulEvidenceOnFailure: true,
        vault: input.vaultRoot,
      });
      return !(
        attachmentEvidence.status === "failed" &&
        isUsefulHostedAttachmentEvidence(updated.attachmentEvidence)
      );
    },
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
): string {
  if (error instanceof HostedRawEmailMessageMissingError) {
    return CONVERSATION_RAW_EMAIL_MISSING_REASON;
  }

  const errorCode = readHostedConversationFailureCode(error);
  if (errorCode === "inbox-not-initialized") {
    return CONVERSATION_INBOX_RUNTIME_UNAVAILABLE_REASON;
  }
  if (isRawAttachmentMaterializationFailureCode(errorCode)) {
    return ATTACHMENT_EVIDENCE_PARTIAL_REASON;
  }

  return CONVERSATION_PROJECTION_FAILED_REASON;
}

function readHostedConversationAttachmentEvidenceFailureReason(
  error: unknown,
): string {
  if (error instanceof HostedRawEmailMessageMissingError) {
    return CONVERSATION_RAW_EMAIL_MISSING_REASON;
  }

  const errorCode = readHostedConversationFailureCode(error);
  if (errorCode === "inbox-not-initialized") {
    return CONVERSATION_INBOX_RUNTIME_UNAVAILABLE_REASON;
  }
  if (isRawAttachmentMaterializationFailureCode(errorCode)) {
    return ATTACHMENT_EVIDENCE_PARTIAL_REASON;
  }

  return CONVERSATION_ATTACHMENT_EVIDENCE_FAILED_REASON;
}

function readHostedConversationFailureCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const code = readSafeHostedConversationFailureCode(current);
    if (code) {
      return code;
    }
    current = readHostedConversationFailureCause(current);
    if (!current) {
      return null;
    }
  }
  return null;
}

function readSafeHostedConversationFailureCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") {
    return null;
  }
  const normalized = code.trim().toLowerCase().replace(/_/gu, "-");
  return /^[a-z][a-z0-9-]{0,63}$/u.test(normalized) ? normalized : null;
}

function readHostedConversationFailureCause(error: unknown): unknown {
  return error && typeof error === "object" && "cause" in error
    ? (error as { cause?: unknown }).cause
    : null;
}

function isRawAttachmentMaterializationFailureCode(code: string | null): boolean {
  return code === "enoent" ||
    code === "raw-copy-failed" ||
    code === "raw-materialization-failed" ||
    code === "attachment-materialization-failed";
}

function isUsefulHostedAttachmentEvidence(
  evidence: AssistantInputAttachmentEvidence,
): boolean {
  return evidence.status === "available" || evidence.status === "partial";
}

function createHostedConversationAssistantInputEvent(input: {
  item: HostedMailboxResolvedImportItem;
  wake: HostedExecutionConversationMessageWake;
}): UpsertAssistantInputEventInput {
  const identifierBlind = createHostedAssistantConversationIdentifierBlind({
    secret: readHostedConversationAssistantIdentifierSecret(input.wake),
    userId: input.item.item.userId,
  });
  const content = createHostedConversationAssistantInputContent(
    input.wake,
    identifierBlind,
  );

  return {
    content,
    conversation: createHostedConversationAssistantInputConversation(
      input.wake,
      identifierBlind,
    ),
    occurredAt: input.wake.occurredAt,
    receivedAt: input.item.item.createdAt,
    replyTarget: createHostedConversationAssistantInputReplyTarget(
      input.wake,
    ),
    sourceMetadata: createHostedConversationAssistantInputSourceMetadata(
      input.wake,
      identifierBlind,
    ),
    sourceRef: {
      dedupeKey: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        input.item.item.dedupeKey,
      ),
      eventId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        input.wake.eventId,
      ),
      itemId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        input.item.item.id,
      ),
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
  identifierBlind: HostedAssistantConversationIdentifierBlind,
): UpsertAssistantInputEventInput["content"] {
  const text = createHostedConversationAssistantInputText(wake);
  return {
    attachmentDescriptors: createHostedConversationAssistantInputAttachmentDescriptors(
      wake,
      identifierBlind,
    ),
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

  if (isHostedWhatsAppConversationMessageWake(wake)) {
    return sanitizeHostedAssistantInputText(
      wake.message.whatsappMessage.text,
    ) ?? "Received a WhatsApp message.";
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    return createHostedEmailConversationAssistantInputText(wake);
  }

  return "Received a hosted conversation message.";
}

function createHostedEmailConversationAssistantInputText(
  wake: HostedExecutionConversationMessageWake & {
    message: Extract<
      HostedExecutionConversationMessageWake["message"],
      { channel: "email" }
    >;
  },
): string {
  const bodyPreview = sanitizeHostedAssistantInputText(
    wake.message.textPreview ?? "",
  );
  if (!bodyPreview) {
    const lines = [
      "Received an email message.",
      renderHostedEmailPromptLine("Sender summary", wake.message.from),
      renderHostedEmailPromptListLine("Recipient summary", wake.message.to),
      renderHostedEmailPromptListLine("Cc summary", wake.message.cc),
      renderHostedEmailPromptLine("Email subject", wake.message.subject),
      "Email body unavailable.",
    ];
    return sanitizeHostedAssistantInputText(
      lines.filter((line): line is string => line !== null).join("\n"),
    ) ?? "Received an email message.\nEmail body unavailable.";
  }

  const lines = [
    "Received an email message.",
    renderHostedEmailPromptLine("Sender summary", wake.message.from),
    renderHostedEmailPromptListLine("Recipient summary", wake.message.to),
    renderHostedEmailPromptListLine("Cc summary", wake.message.cc),
    renderHostedEmailPromptLine("Email subject", wake.message.subject),
    `Email body preview - ${bodyPreview}`,
  ];
  return sanitizeHostedAssistantInputText(
    lines.filter((line): line is string => line !== null).join("\n"),
  ) ?? "Received an email message.";
}

function renderHostedEmailPromptLine(
  label: string,
  value: string | null | undefined,
): string | null {
  const sanitized = sanitizeHostedAssistantInputText(value ?? "");
  return sanitized ? `${label} - ${sanitized}` : null;
}

function renderHostedEmailPromptListLine(
  label: string,
  values: readonly string[] | null | undefined,
): string | null {
  const sanitizedValues = (values ?? [])
    .map((value) => sanitizeHostedAssistantInputText(value))
    .filter((value): value is string => value !== null);
  if (sanitizedValues.length === 0) {
    return null;
  }
  return `${label} - ${sanitizedValues.join(", ")}`;
}

function createHostedConversationAssistantInputConversation(
  wake: HostedExecutionConversationMessageWake,
  identifierBlind: HostedAssistantConversationIdentifierBlind,
): UpsertAssistantInputEventInput["conversation"] {
  if (isHostedLinqConversationMessageWake(wake)) {
    const contact = readHostedLinqConversationMessageContact(wake.message);
    return {
      accountId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        contact.lookupKey,
      ),
      actorId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        wake.message.linqMessage.from,
      ),
      actorIsSelf: wake.message.linqMessage.isFromMe,
      source: "linq",
      threadId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        wake.message.linqMessage.chatId,
      ),
      threadIsDirect: true,
    };
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return {
      accountId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        "telegram:bot",
      ),
      actorId: null,
      actorIsSelf: false,
      source: "telegram",
      threadId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        wake.message.telegramMessage.threadId,
      ),
      threadIsDirect: true,
    };
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    const threadIdentity =
      wake.message.threadKey ?? wake.message.threadTarget ?? wake.message.rawMessageKey;
    return {
      accountId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        wake.message.identityId ?? "email",
      ),
      actorId: null,
      actorIsSelf: false,
      source: "email",
      threadId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        threadIdentity,
      ),
      threadIsDirect: true,
    };
  }

  if (isHostedWhatsAppConversationMessageWake(wake)) {
    return {
      accountId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        wake.message.whatsappMessage.phoneNumberId ?? "whatsapp",
      ),
      actorId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        wake.message.whatsappMessage.fromWaId,
      ),
      actorIsSelf: false,
      source: "whatsapp",
      threadId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        wake.message.whatsappMessage.threadId,
      ),
      threadIsDirect: true,
    };
  }

  return null;
}

function readHostedConversationAssistantIdentifierSecret(
  wake: HostedExecutionConversationMessageWake,
): string {
  if (isHostedLinqConversationMessageWake(wake)) {
    return readHostedLinqConversationMessageContact(wake.message).lookupKey;
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return wake.message.telegramMessage.threadId;
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    return (
      wake.message.identityId
      ?? wake.message.selfAddress
      ?? wake.message.threadKey
      ?? wake.message.threadTarget
      ?? wake.message.rawMessageKey
    );
  }

  if (isHostedWhatsAppConversationMessageWake(wake)) {
    return wake.message.whatsappMessage.threadId || wake.message.whatsappMessage.fromWaId;
  }

  return wake.eventId;
}

function createHostedConversationAssistantInputReplyTarget(
  wake: HostedExecutionConversationMessageWake,
): UpsertAssistantInputEventInput["replyTarget"] {
  if (isHostedLinqConversationMessageWake(wake)) {
    return {
      channel: "linq",
      messageId: normalizeHostedAssistantInputReplyTargetIdentifier(
        wake.message.linqMessage.messageId,
      ),
      threadId: normalizeHostedAssistantInputReplyTargetIdentifier(
        wake.message.linqMessage.chatId,
      ),
    };
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return {
      channel: "telegram",
      messageId: normalizeHostedAssistantInputReplyTargetIdentifier(
        wake.message.telegramMessage.messageId,
      ),
      threadId: normalizeHostedAssistantInputReplyTargetIdentifier(
        wake.message.telegramMessage.threadId,
      ),
    };
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    return {
      channel: "email",
      messageId: normalizeHostedAssistantInputReplyTargetIdentifier(
        wake.message.messageId,
      ),
      threadId: normalizeHostedAssistantInputReplyTargetIdentifier(
        wake.message.threadTarget,
      ),
    };
  }

  if (isHostedWhatsAppConversationMessageWake(wake)) {
    return {
      channel: "whatsapp",
      messageId: normalizeHostedAssistantInputReplyTargetIdentifier(
        wake.message.whatsappMessage.messageId,
      ),
      threadId: normalizeHostedAssistantInputReplyTargetIdentifier(
        wake.message.whatsappMessage.threadId,
      ),
    };
  }

  return null;
}

function normalizeHostedAssistantInputReplyTargetIdentifier(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function createHostedConversationAssistantInputSourceMetadata(
  wake: HostedExecutionConversationMessageWake,
  identifierBlind: HostedAssistantConversationIdentifierBlind,
): UpsertAssistantInputEventInput["sourceMetadata"] {
  if (isHostedEmailConversationMessageWake(wake)) {
    const promptReady = Boolean(
      sanitizeHostedAssistantInputText(wake.message.textPreview ?? ""),
    );
    return {
      kind: "email",
      promptReady,
      promptUnavailableReason: promptReady ? null : "email.body_unavailable",
    };
  }

  if (!isHostedTelegramConversationMessageWake(wake)) {
    return null;
  }

  const mediaGroupId = hashHostedAssistantInputTelegramMediaGroupId(
    identifierBlind,
    wake.message.telegramMessage.mediaGroupId,
  );
  const replyContext = sanitizeHostedAssistantInputMetadataText(
    wake.message.telegramMessage.replyContextPreview ?? "",
  );
  if (!mediaGroupId && !replyContext) {
    return null;
  }

  return {
    kind: "telegram",
    mediaGroupId,
    replyContext,
  };
}

function hashHostedAssistantInputTelegramMediaGroupId(
  identifierBlind: HostedAssistantConversationIdentifierBlind,
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized
    ? hashHostedAssistantConversationIdentifier(
        identifierBlind,
        `telegram-media-group:${normalized}`,
      )
    : null;
}

function createHostedConversationAssistantInputAttachmentDescriptors(
  wake: HostedExecutionConversationMessageWake,
  identifierBlind: HostedAssistantConversationIdentifierBlind,
): AssistantInputAttachmentDescriptor[] {
  if (isHostedLinqConversationMessageWake(wake)) {
    return wake.message.linqMessage.parts.flatMap((part, index) => {
      if (part.type !== "media" && part.type !== "voice_memo") {
        return [];
      }
      return [{
        attachmentId: hashHostedAssistantConversationIdentifier(
          identifierBlind,
          part.attachmentId ?? `part_${index}`,
        ),
        contentType: normalizeHostedAssistantInputMimeType(part.mimeType),
        fileName: normalizeAssistantInputFileName(part.fileName),
        kind: part.type,
        sizeBytes: normalizeHostedAssistantInputSize(part.size),
      }];
    });
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return (wake.message.telegramMessage.attachments ?? []).map((attachment) => ({
      attachmentId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        attachment.fileId,
      ),
      contentType: normalizeHostedAssistantInputMimeType(attachment.mimeType),
      fileName: normalizeAssistantInputFileName(attachment.fileName),
      kind: safeHostedAssistantInputTokenOrHash(attachment.kind),
      sizeBytes: normalizeHostedAssistantInputSize(attachment.fileSize),
    }));
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    return (wake.message.attachmentSummaries ?? []).map((attachment, index) => ({
      attachmentId: hashHostedAssistantConversationIdentifier(
        identifierBlind,
        [
          "email",
          String(index),
          attachment.contentType ?? "",
          String(attachment.sizeBytes ?? ""),
        ].join(":"),
      ),
      contentType: normalizeHostedAssistantInputMimeType(attachment.contentType),
      fileName: normalizeAssistantInputFileName(attachment.fileName),
      kind: "email_attachment",
      sizeBytes: normalizeHostedAssistantInputSize(attachment.sizeBytes),
    }));
  }

  return [];
}

async function recordHostedConversationProjectionBestEffort(
  stagedInput: HostedConversationMailboxAssistantInputStageResult,
  projection: HostedConversationMailboxAssistantInputProjectionUpdate,
): Promise<boolean> {
  try {
    await stagedInput.recordProjection(projection);
    return true;
  } catch {
    // Projection status is diagnostic/enrichment state; staged input remains durable.
    return false;
  }
}

async function recordHostedConversationAttachmentEvidenceBestEffort(input: {
  attachmentEvidence: AssistantInputAttachmentEvidence;
  stagedInput: HostedConversationMailboxAssistantInputStageResult;
}): Promise<boolean | null> {
  if (!input.stagedInput.recordAttachmentEvidence) {
    return null;
  }

  try {
    return await input.stagedInput.recordAttachmentEvidence(input.attachmentEvidence);
  } catch {
    // Attachment evidence is prompt materialization state. Staged input remains durable.
    return false;
  }
}

async function recordHostedConversationAttachmentEvidenceFailureBestEffort(input: {
  optionalInboxCaptureId: string | null;
  reasonCode: string;
  stagedInput: HostedConversationMailboxAssistantInputStageResult;
}): Promise<boolean | null> {
  if (!shouldRecordHostedConversationAttachmentEvidence(input.stagedInput)) {
    return null;
  }

  return await recordHostedConversationAttachmentEvidenceBestEffort({
    attachmentEvidence: {
      attachments: [],
      optionalInboxCaptureId: input.optionalInboxCaptureId,
      reasonCode: input.reasonCode,
      source: "hosted-inbox-projection",
      status: "failed",
      updatedAt: null,
    },
    stagedInput: input.stagedInput,
  });
}

function shouldRecordHostedConversationAttachmentEvidence(
  stagedInput: HostedConversationMailboxAssistantInputStageResult,
): boolean {
  return (stagedInput.attachmentDescriptorCount ?? 0) > 0;
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
    || isE164LikeHostedAssistantInputToken(value)
    || value.toLowerCase().includes("authorization")
  );
}

function isE164LikeHostedAssistantInputToken(value: string): boolean {
  return /^\+?[1-9]\d{7,14}$/u.test(value.replace(/[\s().-]/gu, ""));
}

function sanitizeHostedAssistantInputText(value: string): string | null {
  const sanitized = value
    .replace(/https?:\/\/[^\s"'<>]+/giu, "[link omitted]")
    .replace(/file:\/\/[^\s"'<>]+/giu, "[path omitted]")
    .replace(/(^|[\s("'=])(?:[A-Za-z]:[\\/]|\/[^\s"'<>]+|~\/|\.\.\/|\.\.\\)[^\s"'<>]*/gu, "$1[path omitted]")
    .replace(/^\s*(authorization|cookie|set-cookie|x-api-key)\s*:.*$/gimu, "[secret omitted]")
    .trim();

  if (sanitized.length === 0) {
    return null;
  }

  return sanitized.length > 20_000 ? sanitized.slice(0, 20_000) : sanitized;
}

function sanitizeHostedAssistantInputMetadataText(value: string): string | null {
  const sanitized = sanitizeHostedAssistantInputText(value);
  if (!sanitized) {
    return null;
  }

  return sanitized.length > ASSISTANT_INPUT_SOURCE_METADATA_TEXT_MAX_LENGTH
    ? sanitized.slice(0, ASSISTANT_INPUT_SOURCE_METADATA_TEXT_MAX_LENGTH)
    : sanitized;
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
  await prepareHostedInboxProjectionRuntime(
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
