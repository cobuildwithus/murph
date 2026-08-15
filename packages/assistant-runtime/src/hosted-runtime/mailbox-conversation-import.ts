import { createHash } from "node:crypto";
import path from "node:path";

import type {
  HostedExecutionConversationMessageChannel,
  HostedExecutionConversationMessageWake,
  HostedExecutionEmailConversationMessagePayload,
} from "@murphai/hosted-execution";
import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  readHostedExecutionConversationMessageText,
  readHostedLinqConversationMessageAccountLookupKey,
} from "@murphai/hosted-execution";
import {
  parseHostedEmailThreadTarget,
  redactHostedGroupEmailPromptText,
} from "@murphai/runtime-state";
import type {
  HostedRuntimeLatencyTraceStagedMilestones,
} from "@murphai/hosted-execution/runtime-control";
import {
  readHostedIngressLatencySource,
} from "@murphai/hosted-execution/runtime-control";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
  hashNullableHostedAssistantConversationIdentifier,
  readHostedConversationAssistantIdentifierSecret,
  resolveHostedEmailConversationThreadIdentity,
  type HostedAssistantConversationIdentifierBlind,
} from "@murphai/hosted-execution/assistant-identifiers";
import {
  createAssistantInputAttachmentEvidenceFromInboxCapture,
  recordHostedMailboxAssistantInputItem,
  readAssistantInputEvent,
  updateAssistantInputAttachmentEvidence,
  type AssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  type AssistantInputAttachmentDescriptor,
  type AssistantInputProjectionStatus,
  type InboxCaptureAttachmentLike,
  normalizeAssistantInputFileName,
  notifyAssistantActiveTurnInputAvailableForInputIds,
  type UpsertAssistantInputEventInput,
} from "@murphai/assistant-engine";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import {
  inferDirectEmailThreadFromParticipants,
} from "@murphai/inboxd/connectors/email/directness";

import type {
  HostedMailboxConversationImportTiming,
  HostedMailboxItemImportOutcome,
  HostedMailboxPostCheckpointEffectResult,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import {
  buildHostedAssistantLinqDeliveryContextFromWake,
  type HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";
import {
  buildHostedAssistantEmailDeliveryContextFromWake,
  type HostedAssistantEmailDeliveryContext,
} from "./email-delivery-context.ts";
import type {
  HostedConversationWakeMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  ensureHostedPendingAssistantInputIndex,
  enqueueHostedPendingAssistantInputId,
} from "./pending-input-index.ts";
import {
  prepareHostedAssistantAutoReplyForWake,
  requireHostedBootstrapForWake,
  type HostedAssistantAutoReplyReadinessState,
} from "./context.ts";
import {
  HostedRawEmailMessageMissingError,
} from "./events/email.ts";

const CONVERSATION_PROJECTION_FAILED_REASON =
  "conversation-import.projection-failed";
const CONVERSATION_MODULE_LOAD_FAILED_REASON =
  "conversation-import.module-load-failed";
const CONVERSATION_ATTACHMENT_EVIDENCE_FAILED_REASON =
  "conversation-import.attachment-evidence-failed";
const CONVERSATION_PROJECTION_UPDATE_FAILED_REASON =
  "conversation-import.projection-update-failed";
const CONVERSATION_ATTACHMENT_EVIDENCE_UPDATE_FAILED_REASON =
  "conversation-import.attachment-evidence-update-failed";
const CONVERSATION_INBOX_RUNTIME_UNAVAILABLE_REASON =
  "conversation-import.inbox-runtime-unavailable";
const CONVERSATION_PARSER_RETRY_REASON =
  "conversation-import.parser-retry";
const CONVERSATION_RAW_EMAIL_MISSING_REASON =
  "conversation-import.raw-email-missing";
const ATTACHMENT_EVIDENCE_PARTIAL_REASON =
  "attachment.evidence_partial";
const ASSISTANT_INPUT_SOURCE_METADATA_TEXT_MAX_LENGTH = 512;
const RUNTIME_WAKE_NOTIFY_STALE_SKEW_TOLERANCE_MS = 5_000;
const CONVERSATION_MODULE_LOAD_FAILED_CODE =
  "conversation-module-load-failed";

type HostedConversationEventsModule = typeof import("./events/conversation.ts");

let hostedConversationEventsModulePromise:
  Promise<HostedConversationEventsModule> | null = null;

class HostedConversationEventsModuleLoadError extends Error {
  readonly code = CONVERSATION_MODULE_LOAD_FAILED_CODE;

  constructor(cause: unknown) {
    super("Failed to load hosted conversation events module.", { cause });
    this.name = "HostedConversationEventsModuleLoadError";
  }
}

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

type HostedConversationMailboxRuntime = Pick<
  NormalizedHostedAssistantRuntimeConfig,
  | "forwardedEnv"
  | "parserToolchain"
  | "platform"
  | "platformEnv"
  | "resolvedConfig"
  | "userEnv"
>;

export type HostedConversationMailboxLocalImporter = (input: {
  runtime: HostedConversationMailboxRuntime;
  signal?: AbortSignal | null;
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
  pendingReplyEligible: boolean;
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
  runtime: HostedConversationMailboxRuntime;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}) => Promise<void>;

export type HostedConversationMailboxImportOutcome =
  | {
      assistantInputId?: string | null;
      captureId: string | null;
      conversationImportTiming?: HostedMailboxConversationImportTiming | null;
      emailDeliveryContext?: HostedAssistantEmailDeliveryContext | null;
      linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
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
  runtime: HostedConversationMailboxRuntime;
  stageAssistantInputEvent?: HostedConversationMailboxAssistantInputStager;
  vaultRoot: string;
}): (
  item: HostedMailboxResolvedImportItem,
  context?: {
    latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
    onConversationActivityObserved?: (() => void) | null;
    onConversationInputStaged?: ((
      channel: HostedExecutionConversationMessageChannel,
    ) => void) | null;
    runtimeAttemptId?: string | null;
    signal?: AbortSignal | null;
  },
) => Promise<HostedMailboxItemImportOutcome> {
  return (item, context) =>
    importHostedConversationMailboxItem({
      ...input,
      item,
      latencyMilestones: context?.latencyMilestones ?? null,
      onConversationActivityObserved: context?.onConversationActivityObserved ?? null,
      onConversationInputStaged: context?.onConversationInputStaged ?? null,
      runtimeAttemptId: context?.runtimeAttemptId ?? null,
      signal: context?.signal ?? null,
    });
}

export async function importHostedConversationMailboxItem(input: {
  decodePayload: HostedConversationMailboxPayloadDecoder;
  importConversationWake?: HostedConversationMailboxLocalImporter;
  loadAttachmentEvidenceCapture?: HostedConversationMailboxAttachmentEvidenceCaptureLoader;
  prepareWakeContext?: HostedConversationMailboxWakeContextPreparer;
  item: HostedMailboxResolvedImportItem;
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  onDecodedConversationWake?(wake: HostedExecutionConversationMessageWake): void;
  onConversationActivityObserved?: (() => void) | null;
  onConversationInputStaged?: ((
    channel: HostedExecutionConversationMessageChannel,
  ) => void) | null;
  runtime: HostedConversationMailboxRuntime;
  runtimeAttemptId?: string | null;
  signal?: AbortSignal | null;
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

  const decodeStartedAtEpochMs = Date.now();
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
  const decodeDoneAtEpochMs = Date.now();

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
  let pendingReplyEligible = true;
  let autoReplyPreparedAtEpochMs: number | null = null;
  let pendingIndexEnsuredAtEpochMs: number | null = null;
  assertHostedConversationMailboxImportLive(input.signal ?? null);
  if (!input.prepareWakeContext) {
    await requireHostedBootstrapForWake(input.vaultRoot, decoded.wake);
    const assistantRuntimeState = await prepareHostedAssistantAutoReplyForWake(
      input.vaultRoot,
      decoded.wake,
      {
        ...input.runtime.forwardedEnv,
        ...input.runtime.userEnv,
      },
      input.runtime.resolvedConfig,
    );
    autoReplyPreparedAtEpochMs = Date.now();
    pendingReplyEligible = isHostedConversationMailboxPendingReplyEligible({
      assistantRuntimeState,
      wake: decoded.wake,
    });
  }

  assertHostedConversationMailboxImportLive(input.signal ?? null);
  if (!pendingReplyEligible) {
    await ensureHostedPendingAssistantInputIndex({
      vaultRoot: input.vaultRoot,
    });
    pendingIndexEnsuredAtEpochMs = Date.now();
  }

  assertHostedConversationMailboxImportLive(input.signal ?? null);
  const stagedInput = await stageAssistantInputEvent({
    item: input.item,
    pendingReplyEligible,
    vaultRoot: input.vaultRoot,
    wake: decoded.wake,
  });
  const foregroundAssistantInputId =
    pendingReplyEligible && input.item.durablyConsumed !== true
      ? stagedInput.inputId
      : null;
  if (input.item.durablyConsumed !== true) {
    const latencyMilestones = withHostedConversationImportLatencyMilestones({
      autoReplyPreparedAtEpochMs,
      decodeDoneAtEpochMs,
      decodeStartedAtEpochMs,
      latencyMilestones: input.latencyMilestones ?? null,
      pendingIndexEnsuredAtEpochMs,
      stagedAtEpochMs: Date.now(),
    });
    notifyConversationInputStagedBestEffort(
      input.onConversationActivityObserved ?? null,
    );
    if (
      foregroundAssistantInputId
      && (
        !isHostedLinqConversationMessageWake(decoded.wake)
        || decoded.wake.message.linqMessage.isFromMe !== true
      )
    ) {
      notifyForegroundConversationInputStagedBestEffort(
        input.onConversationInputStaged ?? null,
        decoded.wake.message.channel,
      );
    }
    recordHostedConversationLatencyTraceAssistantInputStagedBestEffort({
      inputId: stagedInput.inputId,
      item: input.item,
      latencyMilestones,
      runtime: input.runtime,
      runtimeAttemptId: input.runtimeAttemptId ?? null,
      wake: decoded.wake,
    });
    if (foregroundAssistantInputId) {
      await notifyAssistantActiveTurnInputAvailableForInputIds({
        inputIds: [foregroundAssistantInputId],
        ...(input.signal ? { signal: input.signal } : {}),
        vault: input.vaultRoot,
      });
    }
  }

  const linqDeliveryContext = buildHostedAssistantLinqDeliveryContextFromWake(decoded.wake);
  const emailDeliveryContext = buildHostedAssistantEmailDeliveryContextFromWake(decoded.wake);
  if (!requiresHostedConversationInboxProjection({
    attachmentDescriptorCount: stagedInput.attachmentDescriptorCount,
    wake: decoded.wake,
  })) {
    return {
      ...(foregroundAssistantInputId ? { assistantInputId: foregroundAssistantInputId } : {}),
      captureId: null,
      ...(emailDeliveryContext ? { emailDeliveryContext } : {}),
      ...(linqDeliveryContext ? { linqDeliveryContext } : {}),
      metrics: createEmptyHostedConversationWakeMetrics(),
      status: "imported",
    };
  }
  const projectionEffect = await projectHostedConversationAssistantInputBestEffort({
    importConversationWake,
    loadAttachmentEvidenceCapture,
    prepareWakeContext,
    runtime: input.runtime,
    signal: input.signal ?? null,
    stagedInput,
    vaultRoot: input.vaultRoot,
    wake: decoded.wake,
  });
  if (projectionEffect.parserRetry) {
    return {
      reasonCode: CONVERSATION_PARSER_RETRY_REASON,
      retryable: true,
      status: "blocked",
    };
  }
  return {
    ...(foregroundAssistantInputId ? { assistantInputId: foregroundAssistantInputId } : {}),
    captureId: null,
    ...(emailDeliveryContext ? { emailDeliveryContext } : {}),
    ...(linqDeliveryContext ? { linqDeliveryContext } : {}),
    conversationImportTiming: projectionEffect.timing,
    metrics: createEmptyHostedConversationWakeMetrics(),
    ...(projectionEffect.effect.reasonCode ? { reasonCode: projectionEffect.effect.reasonCode } : {}),
    status: "imported",
  };
}

function withHostedConversationImportLatencyMilestones(input: {
  autoReplyPreparedAtEpochMs: number | null;
  decodeDoneAtEpochMs: number;
  decodeStartedAtEpochMs: number;
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  pendingIndexEnsuredAtEpochMs: number | null;
  stagedAtEpochMs: number;
}): HostedRuntimeLatencyTraceStagedMilestones {
  const latencyMilestones = input.latencyMilestones ?? {};
  const phaseBreakdown = latencyMilestones.phaseBreakdown ?? { schemaVersion: 1 };
  return {
    ...latencyMilestones,
    phaseBreakdown: {
      ...phaseBreakdown,
      schemaVersion: phaseBreakdown.schemaVersion ?? 1,
      import: {
        ...(phaseBreakdown.import ?? {}),
        decodeStartedAtEpochMs: input.decodeStartedAtEpochMs,
        decodeDoneAtEpochMs: input.decodeDoneAtEpochMs,
        ...(input.autoReplyPreparedAtEpochMs === null
          ? {}
          : { autoReplyPreparedAtEpochMs: input.autoReplyPreparedAtEpochMs }),
        ...(input.pendingIndexEnsuredAtEpochMs === null
          ? {}
          : { pendingIndexEnsuredAtEpochMs: input.pendingIndexEnsuredAtEpochMs }),
        stagedAtEpochMs: input.stagedAtEpochMs,
      },
    },
  };
}

function notifyConversationInputStagedBestEffort(
  notify: (() => void) | null,
): void {
  if (!notify) {
    return;
  }
  try {
    notify();
  } catch {
    // Staging observation is a foreground-yield hint only.
  }
}

function notifyForegroundConversationInputStagedBestEffort(
  notify: ((
    channel: HostedExecutionConversationMessageChannel,
  ) => void) | null,
  channel: HostedExecutionConversationMessageChannel,
): void {
  if (!notify) {
    return;
  }
  try {
    notify(channel);
  } catch {
    // Process preparation and foreground yielding are best-effort hints.
  }
}

function recordHostedConversationLatencyTraceAssistantInputStagedBestEffort(input: {
  inputId: string;
  item: HostedMailboxResolvedImportItem;
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "platform">;
  runtimeAttemptId?: string | null;
  wake: HostedExecutionConversationMessageWake;
}): void {
  const source = readHostedIngressLatencySource(input.wake.message.channel);
  if (!source) {
    return;
  }
  const latencyTracePort = input.runtime.platform.latencyTracePort ?? null;
  if (!latencyTracePort) {
    return;
  }

  const latencyMilestones = sanitizeHostedConversationWakeLatencyMilestones({
    latencyMilestones: input.latencyMilestones ?? null,
    wake: input.wake,
  });

  try {
    void latencyTracePort.record({
      event: {
        assistantInputId: input.inputId,
        at: new Date().toISOString(),
        mailboxItemId: input.item.item.id,
        ...(latencyMilestones?.runnerJobAcceptedAt === undefined
          ? {}
          : { runnerJobAcceptedAt: latencyMilestones.runnerJobAcceptedAt }),
        runtimeAttemptId: input.runtimeAttemptId ?? null,
        ...(latencyMilestones?.runtimePhaseStartedAt === undefined
          ? {}
          : { runtimePhaseStartedAt: latencyMilestones.runtimePhaseStartedAt }),
        ...(latencyMilestones?.phaseBreakdown === undefined
          ? {}
          : { phaseBreakdown: latencyMilestones.phaseBreakdown }),
        source,
        type: "assistant_input_staged",
        ...(latencyMilestones?.workspaceRestoreDoneAt === undefined
          ? {}
          : { workspaceRestoreDoneAt: latencyMilestones.workspaceRestoreDoneAt }),
      },
    }).catch(() => {
      // Latency traces are diagnostic-only and must not affect runtime progress.
    });
  } catch {
    // Latency traces are diagnostic-only and must not affect runtime progress.
  }
}

function sanitizeHostedConversationWakeLatencyMilestones(input: {
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  wake: HostedExecutionConversationMessageWake;
}): HostedRuntimeLatencyTraceStagedMilestones | null {
  const latencyMilestones = input.latencyMilestones ?? null;
  const phaseBreakdown = latencyMilestones?.phaseBreakdown;
  const wakeBreakdown = phaseBreakdown?.wake;
  if (!phaseBreakdown || !wakeBreakdown) {
    return latencyMilestones;
  }

  const runtimeWakeNotifiedAtEpochMs = wakeBreakdown.runtimeWakeNotifiedAtEpochMs;
  if (typeof runtimeWakeNotifiedAtEpochMs !== "number") {
    return latencyMilestones;
  }

  const mailboxOccurredAtEpochMs = Date.parse(input.wake.occurredAt);
  if (
    !Number.isFinite(mailboxOccurredAtEpochMs)
    || mailboxOccurredAtEpochMs <= runtimeWakeNotifiedAtEpochMs + RUNTIME_WAKE_NOTIFY_STALE_SKEW_TOLERANCE_MS
  ) {
    return latencyMilestones;
  }

  const {
    runtimeWakeNotifiedAtEpochMs: _staleRuntimeWakeNotifiedAtEpochMs,
    ...wakeWithoutStaleNotify
  } = wakeBreakdown;
  // Only the runtime notify timestamp failed attribution. The foreground
  // wait/import timestamps are local observations for this import attempt; with
  // runtimeWakeNotifiedAtEpochMs absent, they are not treated as a causal wake.
  if (Object.keys(wakeWithoutStaleNotify).length === 0) {
    const { wake: _staleWake, ...phaseBreakdownWithoutStaleWake } = phaseBreakdown;
    return {
      ...latencyMilestones,
      phaseBreakdown: phaseBreakdownWithoutStaleWake,
    };
  }

  return {
    ...latencyMilestones,
    phaseBreakdown: {
      ...phaseBreakdown,
      wake: wakeWithoutStaleNotify,
    },
  };
}

async function projectHostedConversationAssistantInputBestEffort(input: {
  importConversationWake: HostedConversationMailboxLocalImporter;
  loadAttachmentEvidenceCapture: HostedConversationMailboxAttachmentEvidenceCaptureLoader;
  prepareWakeContext: HostedConversationMailboxWakeContextPreparer;
  runtime: HostedConversationMailboxRuntime;
  signal?: AbortSignal | null;
  stagedInput: HostedConversationMailboxAssistantInputStageResult;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}): Promise<{
  effect: HostedMailboxPostCheckpointEffectResult;
  parserRetry: boolean;
  timing: HostedMailboxConversationImportTiming;
}> {
  const projectionStartedAt = Date.now();
  const timing: HostedMailboxConversationImportTiming = {};
  let prepareStartedAt: number | null = null;
  let importStartedAt: number | null = null;
  let imported: HostedConversationMailboxLocalImportResult;
  try {
    prepareStartedAt = Date.now();
    await input.prepareWakeContext({
      runtime: input.runtime,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
    timing.projectionPrepareMs = elapsedHostedConversationImportMs(prepareStartedAt);
    assertHostedConversationMailboxImportLive(input.signal ?? null);
    importStartedAt = Date.now();
    imported = await input.importConversationWake({
      runtime: input.runtime,
      signal: input.signal ?? null,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
    timing.projectionImportMs = elapsedHostedConversationImportMs(importStartedAt);
  } catch (error) {
    // Staging is the durable mailbox-import boundary. Cancellation may stop
    // the optional inbox projection, but it must not replay already-staged
    // assistant input by withholding the mailbox watermark.
    if (timing.projectionPrepareMs === undefined && prepareStartedAt !== null) {
      timing.projectionPrepareMs = elapsedHostedConversationImportMs(prepareStartedAt);
    }
    if (timing.projectionImportMs === undefined && importStartedAt !== null) {
      timing.projectionImportMs = elapsedHostedConversationImportMs(importStartedAt);
    }

    const reasonCode = readHostedConversationProjectionFailureReason(error);
    const projectionUpdated = await recordHostedConversationProjectionBestEffort(input.stagedInput, {
      captureId: null,
      reasonCode,
      status: "failed",
    });
    const attachmentEvidenceStartedAt = Date.now();
    const attachmentEvidenceUpdated = await recordHostedConversationAttachmentEvidenceFailureBestEffort({
      optionalInboxCaptureId: null,
      reasonCode: readHostedConversationAttachmentEvidenceFailureReason(error),
      stagedInput: input.stagedInput,
    });
    timing.attachmentEvidenceMs = elapsedHostedConversationImportMs(attachmentEvidenceStartedAt);
    timing.projectionTotalMs = elapsedHostedConversationImportMs(projectionStartedAt);
    return {
      effect: {
        attachmentEvidenceUpdated,
        kind: "inbox_projection",
        projectionUpdated,
        reasonCode,
        status: "failed",
      },
      parserRetry: false,
      timing,
    };
  }

  if (!imported.captureId) {
    timing.projectionTotalMs = elapsedHostedConversationImportMs(projectionStartedAt);
    return {
      effect: {
        attachmentEvidenceUpdated: null,
        kind: "inbox_projection",
        projectionUpdated: null,
        reasonCode: null,
        status: "succeeded",
      },
      parserRetry: hasHostedConversationParserRetry(imported.metrics),
      timing,
    };
  }

  const projectionUpdated = await recordHostedConversationProjectionBestEffort(input.stagedInput, {
    captureId: imported.captureId,
    reasonCode: null,
    status: "succeeded",
  });
  const attachmentEvidenceStartedAt = Date.now();
  const attachmentEvidenceResult = await recordHostedConversationAttachmentEvidenceFromProjectionBestEffort({
    captureId: imported.captureId,
    loadAttachmentEvidenceCapture: input.loadAttachmentEvidenceCapture,
    requestId: input.wake.eventId,
    stagedInput: input.stagedInput,
    vaultRoot: input.vaultRoot,
  });
  timing.attachmentEvidenceMs = elapsedHostedConversationImportMs(attachmentEvidenceStartedAt);
  timing.projectionTotalMs = elapsedHostedConversationImportMs(projectionStartedAt);
  return {
    effect: buildHostedConversationProjectionEffectResult({
      attachmentEvidenceResult,
      projectionUpdated,
    }),
    parserRetry: hasHostedConversationParserRetry(imported.metrics),
    timing,
  };
}

function elapsedHostedConversationImportMs(startedAtEpochMs: number): number {
  return Math.max(0, Date.now() - startedAtEpochMs);
}

function hasHostedConversationParserRetry(metrics: HostedConversationWakeMetrics): boolean {
  return typeof metrics.nextWakeAt === "string" && metrics.nextWakeAt.trim().length > 0;
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
        createHostedConversationAttachmentEvidenceFromCapture({
          capture,
          source: "hosted-inbox-projection",
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

function assertHostedConversationMailboxImportLive(signal: AbortSignal | null): void {
  if (signal?.aborted) {
    throw readHostedConversationMailboxAbortReason(
      new DOMException("Aborted", "AbortError"),
      signal,
    );
  }
}

function readHostedConversationMailboxAbortReason(
  error: unknown,
  signal: AbortSignal | null,
): unknown {
  return signal?.reason ?? error;
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

function createHostedConversationAttachmentEvidenceFromCapture(input: {
  capture: HostedConversationMailboxAttachmentEvidenceCapture;
  source: NonNullable<AssistantInputAttachmentEvidence["source"]>;
}): AssistantInputAttachmentEvidence {
  return createAssistantInputAttachmentEvidenceFromInboxCapture({
    capture: input.capture,
    source: input.source,
  });
}

async function importHostedConversationWakeWithLocalInbox(input: {
  runtime: HostedConversationMailboxRuntime;
  signal?: AbortSignal | null;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}): Promise<HostedConversationMailboxLocalImportResult> {
  const {
    importHostedConversationMessageWakeIntoLocalInbox,
  } = await loadHostedConversationEventsModule();
  const result = await importHostedConversationMessageWakeIntoLocalInbox(input);
  return {
    captureId: result.capture?.captureId ?? null,
    metrics: result.metrics,
  };
}

function loadHostedConversationEventsModule(): Promise<HostedConversationEventsModule> {
  if (!hostedConversationEventsModulePromise) {
    const modulePromise = import("./events/conversation.ts").catch((error: unknown) => {
      if (hostedConversationEventsModulePromise === modulePromise) {
        hostedConversationEventsModulePromise = null;
      }
      throw new HostedConversationEventsModuleLoadError(error);
    });
    hostedConversationEventsModulePromise = modulePromise;
  }
  return hostedConversationEventsModulePromise;
}

async function stageHostedConversationAssistantInputEvent(input: {
  item: HostedMailboxResolvedImportItem;
  pendingReplyEligible: boolean;
  vaultRoot: string;
  wake: HostedExecutionConversationMessageWake;
}): Promise<HostedConversationMailboxAssistantInputStageResult> {
  const linqWake = isHostedLinqConversationMessageWake(input.wake)
    ? input.wake
    : null;
  const telegramWake = isHostedTelegramConversationMessageWake(input.wake)
    ? input.wake
    : null;
  const groupContextAuthorized = linqWake
    && linqWake.message.routeAuthority !== null
    && linqWake.message.routeAuthority !== undefined
    && linqWake.message.linqMessage.threadIsDirect === false;
  const groupParticipantAdded = groupContextAuthorized
    && linqWake?.message.groupParticipantAdded === true;
  const groupReactionContext = groupContextAuthorized
    ? linqWake?.message.groupReactionContext
    : undefined;
  const groupRunningBitAuthorized =
    groupContextAuthorized ||
    Boolean(
      telegramWake?.message.routeAuthority &&
      telegramWake.message.telegramMessage.threadIsDirect === false,
    );
  const event = await upsertAssistantInputEvent({
    event: createHostedConversationAssistantInputEvent({
      item: input.item,
      wake: input.wake,
    }),
    vault: input.vaultRoot,
  });
  await recordHostedMailboxAssistantInputItem({
    ...(groupParticipantAdded ? { groupParticipantAdded } : {}),
    ...(groupReactionContext ? { groupReactionContext } : {}),
    ...(groupRunningBitAuthorized && input.item.groupRunningBit
      ? { groupRunningBit: input.item.groupRunningBit }
      : {}),
    ...(input.item.usageRunningLow === true
      ? { usageRunningLow: true as const }
      : {}),
    inputId: event.inputId,
    mailboxItemId: input.item.item.id,
    vault: input.vaultRoot,
  });
  const projectionRequired = requiresHostedConversationInboxProjection({
    attachmentDescriptorCount: event.content.attachmentDescriptors.length,
    wake: input.wake,
  });
  if (
    projectionRequired
    && event.projection.status === "not_attempted"
  ) {
    await updateAssistantInputProjection({
      inputId: event.inputId,
      projection: {
        status: "pending",
      },
      vault: input.vaultRoot,
    });
  }
  if (!projectionRequired && event.projection.status === "pending") {
    await updateAssistantInputProjection({
      inputId: event.inputId,
      projection: {
        status: "not_attempted",
      },
      vault: input.vaultRoot,
    });
  }
  if (input.pendingReplyEligible && event.replyTarget) {
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot: input.vaultRoot,
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

function isHostedConversationMailboxPendingReplyEligible(input: {
  assistantRuntimeState: HostedAssistantAutoReplyReadinessState;
  wake: HostedExecutionConversationMessageWake;
}): boolean {
  if (!input.assistantRuntimeState.assistantConfigured) {
    return false;
  }

  switch (input.wake.message.channel) {
    case "email":
      return input.assistantRuntimeState.emailAutoReplyEnabled;
    case "linq":
      return input.assistantRuntimeState.linqAutoReplyEnabled;
    case "telegram":
      return input.assistantRuntimeState.telegramAutoReplyEnabled;
    default:
      return false;
  }
}

function readHostedConversationProjectionFailureReason(
  error: unknown,
): string {
  if (error instanceof HostedRawEmailMessageMissingError) {
    return CONVERSATION_RAW_EMAIL_MISSING_REASON;
  }

  const errorCode = readHostedConversationFailureCode(error);
  if (errorCode === CONVERSATION_MODULE_LOAD_FAILED_CODE) {
    return CONVERSATION_MODULE_LOAD_FAILED_REASON;
  }
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
  if (errorCode === CONVERSATION_MODULE_LOAD_FAILED_CODE) {
    return CONVERSATION_MODULE_LOAD_FAILED_REASON;
  }
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
    // A durably-consumed item is a replay of an already-handled message: it
    // must stay in conversation context but never become a reply candidate
    // again. assistant-engine automation/reply.ts gates reply eligibility on a
    // replyTarget channel match (reply.ts:1600, 2073), so staging a null
    // replyTarget keeps the event context-only.
    replyTarget: input.item.durablyConsumed === true
      ? null
      : createHostedConversationAssistantInputReplyTarget(
          input.wake,
        ),
    sourceMetadata: createHostedConversationAssistantInputSourceMetadata(
      input.wake,
      identifierBlind,
    ),
    sourceRef: {
      causalSeq: input.item.item.causalSeq ?? null,
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
  const authoredText = normalizeHostedAssistantInputText(
    readHostedExecutionConversationMessageText(wake.message) ?? "",
  );
  if (isHostedLinqConversationMessageWake(wake)) {
    if (authoredText) {
      return authoredText;
    }
    const attachmentCount = wake.message.linqMessage.parts.filter((part) =>
      part.type === "media" || part.type === "voice_memo"
    ).length;
    return attachmentCount > 0
      ? `Received a Linq message with ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}.`
      : "Received a Linq message.";
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    if (authoredText) {
      return authoredText;
    }
    const attachmentCount = wake.message.telegramMessage.attachments?.length ?? 0;
    return attachmentCount > 0
      ? `Received a Telegram message with ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}.`
      : "Received a Telegram message.";
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
  const promptFields = buildHostedEmailConversationPromptFields(wake.message);
  const bodyPreview = normalizeHostedAssistantInputText(
    promptFields.textPreview ?? "",
  );
  if (!bodyPreview) {
    const lines = [
      "Received an email message.",
      renderHostedEmailPromptLine("Sender summary", promptFields.from),
      renderHostedEmailPromptListLine("Recipient summary", promptFields.to),
      renderHostedEmailPromptListLine("Cc summary", promptFields.cc),
      renderHostedEmailPromptLine("Email subject", promptFields.subject),
      "Email body unavailable.",
    ];
    return normalizeHostedAssistantInputText(
      lines.filter((line): line is string => line !== null).join("\n"),
    ) ?? "Received an email message.\nEmail body unavailable.";
  }

  const lines = [
    "Received an email message.",
    renderHostedEmailPromptLine("Sender summary", promptFields.from),
    renderHostedEmailPromptListLine("Recipient summary", promptFields.to),
    renderHostedEmailPromptListLine("Cc summary", promptFields.cc),
    renderHostedEmailPromptLine("Email subject", promptFields.subject),
    `Email body preview - ${bodyPreview}`,
  ];
  return normalizeHostedAssistantInputText(
    lines.filter((line): line is string => line !== null).join("\n"),
  ) ?? "Received an email message.";
}

function buildHostedEmailConversationPromptFields(
  message: Extract<HostedExecutionConversationMessageWake["message"], { channel: "email" }>,
): {
  cc?: string[];
  from?: string | null;
  subject?: string | null;
  textPreview?: string | null;
  to?: string[];
} {
  if (isHostedEmailGroupThreadTarget(message.threadTarget)) {
    return {
      from: buildHostedGroupEmailSenderSummary(message.from),
      subject: redactHostedGroupEmailPromptText(message.subject),
      textPreview: redactHostedGroupEmailPromptText(message.textPreview),
    };
  }

  return {
    cc: message.cc,
    from: message.from,
    subject: message.subject,
    textPreview: message.textPreview,
    to: message.to,
  };
}

function isHostedEmailGroupThreadTarget(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0
    && parseHostedEmailThreadTarget(normalized)?.targetKind === "group";
}

function buildHostedGroupEmailSenderSummary(value: string | null | undefined): string {
  const normalized = normalizeHostedAssistantInputText(value ?? "");
  if (
    normalized
    && normalized.startsWith(HOSTED_EMAIL_GROUP_PARTICIPANT_SUMMARY)
    && !HOSTED_EMAIL_ADDRESS_PATTERN.test(normalized)
  ) {
    return normalized;
  }

  const displayName = normalizeHostedAssistantInputText(
    extractHostedEmailDisplayName(value) ?? "",
  );
  if (displayName && !HOSTED_EMAIL_ADDRESS_PATTERN.test(displayName)) {
    return `${HOSTED_EMAIL_GROUP_PARTICIPANT_SUMMARY}: ${displayName}`;
  }

  return HOSTED_EMAIL_GROUP_PARTICIPANT_SUMMARY;
}

function extractHostedEmailDisplayName(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
  const angleIndex = normalized.indexOf("<");
  if (angleIndex <= 0) {
    return null;
  }

  const candidate = normalized.slice(0, angleIndex).trim().replace(/^"|"$/gu, "");
  return candidate.length > 0 ? candidate : null;
}

const HOSTED_EMAIL_GROUP_PARTICIPANT_SUMMARY = "Email reply from group participant";
const HOSTED_EMAIL_ADDRESS_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;

function renderHostedEmailPromptLine(
  label: string,
  value: string | null | undefined,
): string | null {
  const text = normalizeHostedAssistantInputText(value ?? "");
  return text ? `${label} - ${text}` : null;
}

function renderHostedEmailPromptListLine(
  label: string,
  values: readonly string[] | null | undefined,
): string | null {
  const textValues = (values ?? [])
    .map((value) => normalizeHostedAssistantInputText(value))
    .filter((value): value is string => value !== null);
  if (textValues.length === 0) {
    return null;
  }
  return `${label} - ${textValues.join(", ")}`;
}

/**
 * Single source of truth for the Telegram group participant. Attribution is
 * valid only on route-authorized non-direct inbound, so the prompt sender and
 * the blinded actor can never disagree about who spoke.
 */
function readHostedTelegramGroupSenderHandle(
  wake: HostedExecutionConversationMessageWake,
): string | null {
  if (!isHostedTelegramConversationMessageWake(wake)) {
    return null;
  }
  if (
    wake.message.routeAuthority === undefined
    || wake.message.routeAuthority === null
    || wake.message.telegramMessage.threadIsDirect !== false
  ) {
    return null;
  }
  return normalizeHostedAssistantInputSourceMetadataToken(
    wake.message.telegramMessage.from ?? null,
  );
}

function createHostedConversationAssistantInputConversation(
  wake: HostedExecutionConversationMessageWake,
  identifierBlind: HostedAssistantConversationIdentifierBlind,
): UpsertAssistantInputEventInput["conversation"] {
  if (isHostedLinqConversationMessageWake(wake)) {
    const accountLookupKey = readHostedLinqConversationMessageAccountLookupKey(wake.message);
    return {
      accountId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        accountLookupKey,
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
      threadIsDirect: wake.message.linqMessage.threadIsDirect === undefined
        ? true
        : wake.message.linqMessage.threadIsDirect,
    };
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    return {
      accountId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        "telegram:bot",
      ),
      // Blind the same sender value stored for per-message prompt attribution
      // and direct-conversation identity. Authenticated group-room batching may
      // span actor changes; participant effects re-resolve the exact accepted
      // message instead of treating this turn-wide actor as authority.
      actorId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        readHostedTelegramGroupSenderHandle(wake),
      ),
      actorIsSelf: false,
      source: "telegram",
      threadId: hashNullableHostedAssistantConversationIdentifier(
        identifierBlind,
        wake.message.telegramMessage.threadId,
      ),
      threadIsDirect: wake.message.telegramMessage.threadIsDirect ?? true,
    };
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    const emailThreadTarget = parseHostedEmailThreadTarget(wake.message.threadTarget);
    const threadIdentity = resolveHostedEmailConversationThreadIdentity({
      message: wake.message,
      threadTarget: emailThreadTarget,
    });
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
      threadIsDirect: resolveHostedEmailConversationDirectness({
        message: wake.message,
        threadTarget: emailThreadTarget,
      }),
    };
  }

  return null;
}

function resolveHostedEmailConversationDirectness(input: {
  message: HostedExecutionEmailConversationMessagePayload;
  threadTarget: ReturnType<typeof parseHostedEmailThreadTarget>;
}): boolean | null {
  const { message, threadTarget } = input;
  if (threadTarget?.targetKind === "group") {
    return false;
  }

  if (typeof message.threadIsDirect === "boolean") {
    return message.threadIsDirect;
  }
  if (message.threadIsDirect === null) {
    return null;
  }

  const from = message.from?.trim() ?? "";
  const selfAddress = message.selfAddress?.trim() ?? "";
  if (!from || !selfAddress || !Array.isArray(message.to) || !Array.isArray(message.cc)) {
    return null;
  }

  return inferDirectEmailThreadFromParticipants({
    accountAddress: message.identityId,
    cc: message.cc,
    from,
    selfAddresses: [selfAddress],
    to: message.to,
  });
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
    const groupThreadTarget = isHostedEmailGroupThreadTarget(wake.message.threadTarget);
    return {
      channel: "email",
      // Group reply threading uses the threadTarget References payload. Keep the
      // separate Message-ID off the runtime projection because providers can put
      // address-like tokens in that header.
      messageId: normalizeHostedAssistantInputReplyTargetIdentifier(
        groupThreadTarget ? null : wake.message.messageId,
      ),
      threadId: normalizeHostedAssistantInputReplyTargetIdentifier(
        wake.message.threadTarget,
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
  if (isHostedLinqConversationMessageWake(wake)) {
    const externalThreadRouteAuthorityPresent = wake.message.routeAuthority !== undefined
      && wake.message.routeAuthority !== null;
    return {
      ...(wake.message.linqMessage.affirmativeReaction === true
        ? { affirmativeReaction: true }
        : {}),
      ...(wake.message.linqMessage.editedTextPartIndex === undefined
        ? {}
        : {
            editedTextPartIndex:
              wake.message.linqMessage.editedTextPartIndex,
          }),
      ...(wake.message.linqMessage.editedSourceInputId === undefined
        ? {}
        : {
            editedSourceInputId:
              wake.message.linqMessage.editedSourceInputId,
          }),
      externalThreadRouteAuthorityPresent,
      kind: "linq",
      partCount: wake.message.linqMessage.parts.length,
      reactionEligible: wake.message.linqMessage.reactionEligible === true,
      replyToMessageId: normalizeHostedAssistantInputSourceMetadataToken(
        wake.message.linqMessage.replyToMessageId ?? null,
      ),
      // Thread-container (group) inbound carries the sending participant's
      // handle so the assistant can attribute messages; 1:1 home threads have
      // a single known sender and stay handle-free.
      ...(externalThreadRouteAuthorityPresent
        ? {
            senderHandle: normalizeHostedAssistantInputSourceMetadataToken(
              wake.message.linqMessage.from ?? null,
            ),
          }
        : {}),
      service: normalizeHostedAssistantInputSourceMetadataToken(
        wake.message.linqMessage.service ?? null,
      ),
    };
  }

  if (isHostedEmailConversationMessageWake(wake)) {
    const promptReady = Boolean(
      normalizeHostedAssistantInputText(wake.message.textPreview ?? ""),
    );
    return {
      ...(wake.message.assistantStyleSettingsAuthorized === true
        ? { assistantStyleSettingsAuthorized: true }
        : {}),
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
  const replyContext = normalizeHostedAssistantInputMetadataText(
    wake.message.telegramMessage.replyContextPreview ?? "",
  );
  const externalThreadRouteAuthorityPresent = wake.message.routeAuthority !== undefined
    && wake.message.routeAuthority !== null;
  if (
    !mediaGroupId
    && !replyContext
    && !externalThreadRouteAuthorityPresent
  ) {
    return null;
  }
  // Thread-container (group) inbound carries the sending participant so the
  // assistant can attribute messages. Omit both keys entirely when there is no
  // authoritative sender so direct threads and unattributable group inbound
  // keep the exact record shape an older runner can still read.
  const senderHandle = readHostedTelegramGroupSenderHandle(wake);
  const senderDisplayName = readHostedTelegramGroupSenderDisplayName(wake);

  return {
    ...(externalThreadRouteAuthorityPresent
      ? { externalThreadRouteAuthorityPresent: true }
      : {}),
    kind: "telegram",
    mediaGroupId,
    replyContext,
    ...(senderHandle
      ? {
          ...(senderDisplayName ? { senderDisplayName } : {}),
          senderHandle,
          senderUsername: readHostedTelegramGroupSenderUsername(wake),
        }
      : {}),
  };
}

/**
 * Display-only Telegram name. Bound to the same route-authorized group gate as
 * the sender handle and never used for matching or participant authority.
 */
function readHostedTelegramGroupSenderDisplayName(
  wake: HostedExecutionConversationMessageWake,
): string | null {
  if (
    !isHostedTelegramConversationMessageWake(wake)
    || !readHostedTelegramGroupSenderHandle(wake)
  ) {
    return null;
  }
  const normalized = normalizeHostedAssistantInputMetadataText(
    wake.message.telegramMessage.senderDisplayName ?? "",
  )
    ?.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized
    ? Array.from(normalized).slice(0, 120).join("")
    : null;
}

/**
 * Display-only Telegram `@username`. Bound to the same route-authorized group
 * gate as the sender handle so it can never appear without its authority, and
 * never used for matching.
 */
function readHostedTelegramGroupSenderUsername(
  wake: HostedExecutionConversationMessageWake,
): string | null {
  if (
    !isHostedTelegramConversationMessageWake(wake)
    || !readHostedTelegramGroupSenderHandle(wake)
  ) {
    return null;
  }
  return normalizeHostedAssistantInputTelegramUsername(
    wake.message.telegramMessage.senderUsername ?? null,
  );
}

/**
 * Telegram usernames are restricted to letters, digits, and underscores, so a
 * strict charset check keeps user-controlled text out of the prompt.
 */
const HOSTED_ASSISTANT_INPUT_TELEGRAM_USERNAME_PATTERN = /^[A-Za-z0-9_]{1,32}$/u;

function normalizeHostedAssistantInputTelegramUsername(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeHostedAssistantInputSourceMetadataToken(value);
  if (!normalized) {
    return null;
  }
  const bare = normalized.startsWith("@") ? normalized.slice(1) : normalized;
  return HOSTED_ASSISTANT_INPUT_TELEGRAM_USERNAME_PATTERN.test(bare)
    ? bare
    : null;
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

function normalizeHostedAssistantInputSourceMetadataToken(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
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
    const redactFileNameForGroup = isHostedEmailGroupThreadTarget(wake.message.threadTarget);
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
      // Worker ingress redacts group filenames before append; keep this
      // fallback for replayed or deploy-skewed wakes before model rendering.
      fileName: normalizeAssistantInputFileName(
        redactFileNameForGroup
          ? redactHostedGroupEmailPromptText(attachment.fileName)
          : attachment.fileName,
      ),
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

function normalizeHostedAssistantInputText(value: string): string | null {
  const text = value.trim();

  if (text.length === 0) {
    return null;
  }

  return text.length > 20_000 ? text.slice(0, 20_000) : text;
}

function normalizeHostedAssistantInputMetadataText(value: string): string | null {
  const text = normalizeHostedAssistantInputText(value);
  if (!text) {
    return null;
  }

  return text.length > ASSISTANT_INPUT_SOURCE_METADATA_TEXT_MAX_LENGTH
    ? text.slice(0, ASSISTANT_INPUT_SOURCE_METADATA_TEXT_MAX_LENGTH)
    : text;
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

function requiresHostedConversationInboxProjection(input: {
  attachmentDescriptorCount: number | undefined;
  wake: HostedExecutionConversationMessageWake;
}): boolean {
  if (
    isHostedEmailConversationMessageWake(input.wake)
    && parseHostedEmailThreadTarget(input.wake.message.threadTarget)?.targetKind
      === "group"
  ) {
    return false;
  }
  if (
    isHostedLinqConversationMessageWake(input.wake)
    && input.wake.message.linqMessage.parts.some((part) => part.type === "link")
  ) {
    return true;
  }
  if (input.attachmentDescriptorCount !== 0) {
    return true;
  }
  return isHostedEmailConversationMessageWake(input.wake);
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
  const inboxServices = createIntegratedInboxServices();
  await inboxServices.init({
    rebuild: false,
    rebuildParserJobs: false,
    requestId: input.wake.eventId,
    vault: path.resolve(input.vaultRoot),
  });
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
