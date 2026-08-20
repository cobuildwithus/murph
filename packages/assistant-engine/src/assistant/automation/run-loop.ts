import { createHash } from 'node:crypto'
import { assistantRunResultSchema, type AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices, InboxRunEvent } from '@murphai/inbox-services'
import { createIntegratedInboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import {
  getAssistantCronStatus,
  processDueAssistantCronJobsLocal as processDueAssistantCronJobs,
} from '../cron.js'
import {
  appendAssistantHostedDynamicContextPrompt,
  normalizeAssistantExecutionContext,
  type AssistantExecutionContext,
} from '../execution-context.js'
import { conversationRefFromCapture } from '../conversation-ref.js'
import { maybeThrowInjectedAssistantFault } from '../fault-injection.js'
import {
  drainAssistantOutboxLocal as drainAssistantOutbox,
  type AssistantOutboxDispatchMode,
} from '../outbox.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import type { AssistantProviderProgressEvent } from '../provider-progress.js'
import type {
  AssistantTurnEnvironment,
} from '../service-contracts.js'
import { buildAssistantOutboxSummary } from '../outbox/summary.js'
import { maybeRunAssistantRuntimeMaintenance } from '../runtime-budgets.js'
import {
  maintainAssistantAutoReplyRouteState,
} from '../runtime-residue.js'
import { refreshAssistantStatusSnapshot } from '../status.js'
import {
  readAssistantAutomationState,
  redactAssistantDisplayPath,
  resolveAssistantStatePaths,
  saveAssistantAutomationState,
} from '../store.js'
import { sameAssistantAutoReplyState } from '../automation-state.js'
import {
  createStoreBackedAssistantInputSource,
  type AssistantInputSource,
} from '../input-source.js'
import {
  listAssistantInputEvents,
  ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  type AssistantInputAttachmentEvidence,
  type UpsertAssistantInputEventInput,
} from '../input-store.js'
import {
  createAssistantInputAttachmentEvidenceFromInboxCapture,
  type InboxCaptureAttachmentLike,
} from '../inbox-attachment-evidence.js'
import { normalizeAssistantInputFileName } from '../attachment-file-name.js'
import { notifyAssistantActiveTurnInputAvailable } from '../active-turn-input-controller.js'
import {
  errorMessage,
  formatStructuredErrorMessage,
  warnAssistantBestEffortFailure,
} from '../shared.js'
import {
  bridgeAbortSignals,
  computeAssistantAutomationRetryAt,
  createAssistantAutomationWakeController,
  createEmptyAutoReplyScanResult,
  createEmptyInboxScanResult,
  earliestAssistantAutomationWakeAt,
  type AssistantAutomationPassResult,
  type AssistantAutoReplyTerminalNonReplyHook,
  type AssistantRunEvent,
} from './shared.js'
import { scanAssistantAutomationOnce } from './scanner.js'
import { acquireAssistantAutomationRunLock } from './runtime-lock.js'
import type { AssistantAutoReplyProviderRequestStartHook } from './reply.js'
import type { AssistantBeforeProviderAcceptedInputsHook } from '../service-contracts.js'
import type { AssistantAutomationOperationScope } from './operation-scope.js'
import {
  stampAssistantProviderStartCriticalPath,
  type AssistantProviderStartCriticalPathContext,
} from '../provider-start-critical-path.js'

type AssistantAutomationLoopStateSnapshot = Pick<
  AssistantAutomationState,
  'autoReply'
>

type AssistantDynamicContextPromptBuilder = (input: {
  signal?: AbortSignal
}) => Promise<string | null>

const SAFE_ATTACHMENT_EVIDENCE_ERROR_CODE_PATTERN =
  /^[A-Za-z0-9_.:-]{1,96}$/u
const HOSTED_DEFERRED_CRON_CATCHUP_WAKE_DELAY_MS = 10_000
export interface RunAssistantAutomationInput {
  applyCanonicalWrites?: boolean
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  drainOutbox?: boolean
  executionContext?: AssistantExecutionContext | null
  operationScope?: AssistantAutomationOperationScope | null
  buildDynamicContextPrompt?: AssistantDynamicContextPromptBuilder
  beforeProviderAcceptedInputs?: AssistantBeforeProviderAcceptedInputsHook | null
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null
  inboxServices?: InboxServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onProviderRequestStarted?: AssistantAutoReplyProviderRequestStartHook | null
  onTerminalNonReplyCommitted?: AssistantAutoReplyTerminalNonReplyHook | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  onInboxEvent?: (event: InboxRunEvent) => void
  once?: boolean
  requestId?: string | null
  shouldYieldBackgroundMaintenance?: (() => boolean) | null
  shouldDeferCron?: (() => boolean) | null
  signal?: AbortSignal
  startDaemon?: boolean
  sessionMaxAgeMs?: number | null
  inputSource?: AssistantInputSource
  turnEnvironment?: AssistantTurnEnvironment | null
  vault: string
  vaultServices?: VaultServices | null
}

export interface RunAssistantAutomationPassInput
  extends Omit<RunAssistantAutomationInput, 'once' | 'onInboxEvent' | 'startDaemon'> {
  maxInputPerScan?: number
  scanNumber?: number
}

export async function runAssistantAutomation(
  input: RunAssistantAutomationInput,
) {
  const startedAt = new Date().toISOString()
  const controller = new AbortController()
  const cleanup = bridgeAbortSignals(controller, input.signal)
  const paths = resolveAssistantStatePaths(input.vault)
  const inboxServices = input.inboxServices ?? createIntegratedInboxServices()
  const aggregateRouting = createEmptyInboxScanResult()
  const aggregateReplies = createEmptyAutoReplyScanResult()
  const wakeController = createAssistantAutomationWakeController()
  let scans = 0
  let lastError: string | null = null
  const daemonStarted = input.startDaemon ?? true

  if (!daemonStarted && !input.once) {
    cleanup()
    throw new Error(
      'Continuous assistant automation now requires the inbox daemon. Rerun in continuous mode with the daemon enabled, or use once=true for a one-shot pass.',
    )
  }

  let runLock: Awaited<
    ReturnType<typeof acquireAssistantAutomationRunLock>
  > | null = null

  try {
    runLock = await acquireAssistantAutomationRunLock({
      once: input.once,
      paths,
    })
  } catch (error) {
    cleanup()
    throw error
  }

  let daemonPromise: Promise<unknown> | null = null
  if (daemonStarted) {
    daemonPromise = inboxServices
      .run(
        {
          vault: input.vault,
          requestId: input.requestId ?? null,
        },
        {
          onEvent: (event) => {
            if (
              event.type === 'capture.imported' &&
              event.capture &&
              event.persisted &&
              (input.allowSelfAuthored || event.capture.actor.isSelf !== true)
            ) {
              wakeController.requestWake()
              stageImportedCaptureAssistantInputEvent({
                capture: event.capture,
                executionContext: input.executionContext,
                onEvent: input.onEvent,
                persisted: event.persisted,
                vault: input.vault,
              }).then(() => {
                // Re-arm after persistence in case the pre-staging wake was
                // consumed while the writer waited for route maintenance.
                wakeController.requestWake()
                notifyImportedCaptureInputAvailable({
                  event,
                  signal: controller.signal,
                  vault: input.vault,
                })
              }).catch((error) => {
                const detail = formatStructuredErrorMessage(error)
                lastError = detail
                input.onEvent?.({
                  type: 'daemon.failed',
                  details: detail,
                })
                controller.abort()
              })
            } else if (
              event.type === 'capture.imported' &&
              (input.allowSelfAuthored || event.capture?.actor?.isSelf !== true)
            ) {
              wakeController.requestWake()
              notifyImportedCaptureInputAvailable({
                event,
                signal: controller.signal,
                vault: input.vault,
              })
            } else if (event.type === 'parser.jobs.drained') {
              refreshAssistantInputAttachmentEvidenceForParserDrain({
                captureIds: event.parser?.captureIds ?? [],
                executionContext: input.executionContext,
                inboxServices,
                onEvent: input.onEvent,
                requestId: input.requestId ?? null,
                vault: input.vault,
              }).catch((error) => {
                input.onEvent?.({
                  type: 'input.reply-progress',
                  details: 'nonblocking attachment evidence refresh failed',
                  errorCode: readSafeAttachmentEvidenceErrorCode(error),
                  safeDetails: 'attachment_evidence_refresh_failed_nonblocking',
                  providerKind: 'status',
                  providerState: 'completed',
                })
              }).finally(() => {
                wakeController.requestWake()
              })
            }
            input.onInboxEvent?.(event)
          },
          signal: controller.signal,
        },
      )
      .catch((error) => {
        const detail = formatStructuredErrorMessage(error)
        lastError = detail
        input.onEvent?.({
          type: 'daemon.failed',
          details: detail,
        })
        controller.abort()
      })
  }

  await refreshAssistantStatusSnapshot(input.vault).catch((error) => {
    warnAssistantBestEffortFailure({
      error,
      operation: 'status snapshot refresh',
    })
  })

  try {
    while (!controller.signal.aborted) {
      wakeController.consumePendingWake()
      scans += 1

      const passResult = await runAssistantAutomationPass({
        ...input,
        inboxServices,
        scanNumber: scans,
        signal: controller.signal,
      })

      aggregateRouting.considered += passResult.routing.considered
      aggregateRouting.failed += passResult.routing.failed
      aggregateRouting.noAction += passResult.routing.noAction
      aggregateRouting.routed += passResult.routing.routed
      aggregateRouting.skipped += passResult.routing.skipped
      aggregateReplies.considered += passResult.replies.considered
      aggregateReplies.failed += passResult.replies.failed
      aggregateReplies.replied += passResult.replies.replied
      aggregateReplies.skipped += passResult.replies.skipped

      const shouldYieldRouteMaintenance = () =>
        controller.signal.aborted
        || input.shouldYieldBackgroundMaintenance?.() === true
        || (input.once !== true && wakeController.hasPendingWake())
      if (
        (input.applyCanonicalWrites ?? true)
        && !controller.signal.aborted
        && !shouldYieldRouteMaintenance()
      ) {
        await maintainAssistantAutoReplyRouteState({
          shouldYield: shouldYieldRouteMaintenance,
          signal: controller.signal,
          vault: input.vault,
        }).catch((error) => {
          warnAssistantBestEffortFailure({
            error,
            operation: 'auto-reply route maintenance',
          })
        })
      }

      if (input.once) {
        break
      }

      const wakeRequested = wakeController.consumePendingWake()
      if (passResult.progressed || wakeRequested) {
        continue
      }

      await wakeController.waitForWakeOrDeadline(
        controller.signal,
        passResult.nextWakeAt,
      )
    }

    const finalReason =
      lastError !== null
        ? 'error'
        : controller.signal.aborted
          ? 'signal'
          : 'completed'

    return assistantRunResultSchema.parse({
      vault: redactAssistantDisplayPath(input.vault),
      startedAt,
      stoppedAt: new Date().toISOString(),
      reason: finalReason,
      daemonStarted,
      scans,
      considered: aggregateRouting.considered,
      routed: aggregateRouting.routed,
      noAction: aggregateRouting.noAction,
      skipped: aggregateRouting.skipped,
      failed: aggregateRouting.failed,
      replyConsidered: aggregateReplies.considered,
      replied: aggregateReplies.replied,
      replySkipped: aggregateReplies.skipped,
      replyFailed: aggregateReplies.failed,
      lastError,
    })
  } catch (error) {
    lastError = errorMessage(error)
    throw error
  } finally {
    controller.abort()
    cleanup()

    if (daemonPromise) {
      try {
        await daemonPromise
      } catch (error) {
        warnAssistantBestEffortFailure({
          error,
          operation: 'daemon shutdown wait',
        })
      }
    }

    await runLock?.release().catch((error) => {
      warnAssistantBestEffortFailure({
        error,
        operation: 'automation run-lock release',
      })
    })
    await refreshAssistantStatusSnapshot(input.vault).catch((error) => {
      warnAssistantBestEffortFailure({
        error,
        operation: 'status snapshot refresh',
      })
    })
  }
}

async function stageImportedCaptureAssistantInputEvent(input: {
  capture: NonNullable<InboxRunEvent['capture']>
  executionContext?: AssistantExecutionContext | null
  onEvent?: (event: AssistantRunEvent) => void
  persisted: NonNullable<InboxRunEvent['persisted']>
  vault: string
}): Promise<void> {
  const text = typeof input.capture.text === 'string'
    ? clampImportedCaptureText(input.capture.text)
    : null
  const stored = await upsertAssistantInputEvent({
    vault: input.vault,
    event: {
      content: {
        attachmentDescriptors: (input.capture.attachments ?? []).map(
          (attachment, index) => ({
            attachmentId: hashLocalAssistantInputIdentifier(
              input.vault,
              input.capture.source,
              attachment.externalId,
              `attachment_${index}`,
            ),
            contentType: normalizeLocalAssistantInputContentType(
              attachment.mime,
            ),
            fileName: normalizeLocalAssistantInputFileName(attachment.fileName),
            kind: normalizeLocalAssistantInputToken(attachment.kind, 'attachment'),
            sizeBytes: normalizeLocalAssistantInputSize(
              attachment.byteSize,
            ),
          }),
        ),
        text,
        transcriptText: text,
        userMessageContent: text
          ? [
              {
                text,
                type: 'text',
              },
            ]
          : null,
      },
      conversation: {
        accountId: hashNullableLocalAssistantInputIdentifier(
          input.vault,
          input.capture.source,
          input.capture.accountId,
        ),
        actorId: hashNullableLocalAssistantInputIdentifier(
          input.vault,
          input.capture.source,
          input.capture.actor.id,
        ),
        actorIsSelf: input.capture.actor.isSelf,
        source: input.capture.source,
        threadId: hashNullableLocalAssistantInputIdentifier(
          input.vault,
          input.capture.source,
          input.capture.thread?.id,
        ),
        threadIsDirect: input.capture.thread?.isDirect ?? null,
      },
      occurredAt: input.capture.occurredAt,
      receivedAt: input.persisted.createdAt,
      replyTarget: createLocalCaptureAssistantInputReplyTarget(input.capture),
      sourceMetadata: createLocalCaptureAssistantInputSourceMetadata(
        input.vault,
        input.capture,
      ),
      sourceRef: {
        captureId: input.persisted.captureId,
        kind: 'inbox-capture',
        source: input.capture.source,
        version: null,
      },
    },
  })
  await updateAssistantInputProjection({
    inputId: stored.inputId,
    projection: {
      captureId: input.persisted.captureId,
      status: 'succeeded',
    },
    vault: input.vault,
  })
  await updateAssistantInputAttachmentEvidence({
    inputId: stored.inputId,
    vault: input.vault,
    attachmentEvidence: createAssistantInputAttachmentEvidenceFromInboxCaptureWithStoredPaths({
      attachments: input.capture.attachments,
      captureId: input.persisted.captureId,
      descriptorAttachmentIdForAttachment: (attachment, index) =>
        hashLocalAssistantInputIdentifier(
          input.vault,
          input.capture.source,
          attachment.externalId,
          `attachment_${index}`,
      ),
      source: 'local-inbox-import',
    }),
  }).then((updated) => {
    emitAttachmentEvidenceUpdateProgress({
      attachmentCount: updated.attachmentEvidence.attachments.length,
      inputId: stored.inputId,
      onEvent: input.onEvent,
      safeDetails: 'attachment_evidence_updated',
      status: updated.attachmentEvidence.status,
    })
  }).catch((error) => {
    input.onEvent?.({
      type: 'input.reply-progress',
      inputId: stored.inputId,
      details: 'nonblocking attachment evidence update failed',
      errorCode: readSafeAttachmentEvidenceErrorCode(error),
      safeDetails: 'attachment_evidence_update_failed_nonblocking',
      providerKind: 'status',
      providerState: 'completed',
    })
  })
}

function clampImportedCaptureText(value: string): string {
  if (value.length <= ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH) {
    return value
  }

  const omittedChars = value.length - ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH
  const suffix = `\n\n[truncated ${omittedChars} characters before assistant input staging]`
  return `${value.slice(0, Math.max(0, ASSISTANT_INPUT_EVENT_TEXT_MAX_LENGTH - suffix.length))}${suffix}`
}

async function refreshAssistantInputAttachmentEvidenceForParserDrain(input: {
  captureIds: readonly string[]
  executionContext?: AssistantExecutionContext | null
  inboxServices: InboxServices
  onEvent?: (event: AssistantRunEvent) => void
  requestId: string | null
  vault: string
}): Promise<void> {
  const captureIds = [...new Set(input.captureIds.filter((captureId) =>
    typeof captureId === 'string' && captureId.trim().length > 0
  ))]
  if (captureIds.length === 0) {
    return
  }

  const listed = await listAssistantInputEvents({
    limit: Number.MAX_SAFE_INTEGER,
    skipInvalidRecords: true,
    vault: input.vault,
  })
  const eventsByCaptureId = new Map<string, typeof listed.events>()
  for (const event of listed.events) {
    const captureId =
      event.projection.captureId ??
      (event.sourceRef.kind === 'inbox-capture'
        ? event.sourceRef.captureId
        : null)
    if (!captureId) {
      continue
    }
    const existing = eventsByCaptureId.get(captureId) ?? []
    existing.push(event)
    eventsByCaptureId.set(captureId, existing)
  }

  for (const captureId of captureIds) {
    const events = eventsByCaptureId.get(captureId) ?? []
    if (events.length === 0) {
      continue
    }

    try {
      const result = await input.inboxServices.show({
        captureId,
        requestId: input.requestId,
        vault: input.vault,
      })
      await Promise.all(
        events.map(async (event) => {
          const attachmentEvidence =
            createAssistantInputAttachmentEvidenceFromInboxCaptureWithStoredPaths({
              attachments: result.capture.attachments,
              captureId,
              descriptorAttachmentIdForAttachment: (_attachment, index) =>
                event.content.attachmentDescriptors[index]?.attachmentId ?? null,
              source: 'local-parser-drain',
            })
          const updated = await updateAssistantInputAttachmentEvidence({
            attachmentEvidence,
            inputId: event.inputId,
            vault: input.vault,
          })
          emitAttachmentEvidenceUpdateProgress({
            attachmentCount: updated.attachmentEvidence.attachments.length,
            inputId: event.inputId,
            onEvent: input.onEvent,
            safeDetails: 'attachment_evidence_refreshed',
            status: updated.attachmentEvidence.status,
          })
        }),
      )
    } catch (error) {
      for (const event of events) {
        input.onEvent?.({
          type: 'input.reply-progress',
          captureId,
          inputId: event.inputId,
          details: 'nonblocking attachment evidence refresh failed',
          errorCode: readSafeAttachmentEvidenceErrorCode(error),
          safeDetails: 'attachment_evidence_refresh_failed_nonblocking',
          providerKind: 'status',
          providerState: 'completed',
        })
      }
    }
  }
}

function createAssistantInputAttachmentEvidenceFromInboxCaptureWithStoredPaths(input: {
  attachments: readonly InboxCaptureAttachmentLike[]
  captureId: string
  descriptorAttachmentIdForAttachment?: (
    attachment: InboxCaptureAttachmentLike,
    index: number,
  ) => string | null
  source: NonNullable<AssistantInputAttachmentEvidence['source']>
}): AssistantInputAttachmentEvidence {
  return createAssistantInputAttachmentEvidenceFromInboxCapture({
    capture: {
      attachments: input.attachments,
      captureId: input.captureId,
    },
    descriptorAttachmentIdForAttachment: input.descriptorAttachmentIdForAttachment,
    source: input.source,
  })
}

function emitAttachmentEvidenceUpdateProgress(input: {
  attachmentCount: number
  inputId: string
  onEvent?: (event: AssistantRunEvent) => void
  safeDetails: string
  status: string
}): void {
  input.onEvent?.({
    type: 'input.reply-progress',
    inputId: input.inputId,
    details: 'attachment evidence updated',
    failureContext: {
      attachmentCount: input.attachmentCount,
      status: input.status,
    },
    safeDetails: input.safeDetails,
    providerKind: 'status',
    providerState: 'completed',
  })
}

function readSafeAttachmentEvidenceErrorCode(error: unknown): string {
  const record = asRecord(error)
  const code = typeof record?.code === 'string' ? record.code.trim() : ''
  return code && SAFE_ATTACHMENT_EVIDENCE_ERROR_CODE_PATTERN.test(code)
    ? code
    : 'attachment_evidence_update_failed'
}

function createLocalCaptureAssistantInputReplyTarget(
  capture: NonNullable<InboxRunEvent['capture']>,
) {
  const channel = normalizeLocalAssistantInputToken(capture.source, 'capture')
  const threadId = normalizeLocalAssistantInputReplyTargetIdentifier(
    capture.thread?.id ?? capture.actor.id,
  )
  const messageId = normalizeLocalAssistantInputReplyTargetIdentifier(
    readLocalCaptureReplyToMessageId(capture),
  )

  if (!threadId && !messageId) {
    return {
      channel,
      messageId: null,
      threadId: null,
    }
  }

  return {
    channel,
    messageId,
    threadId,
  }
}

function readLocalCaptureReplyToMessageId(
  capture: NonNullable<InboxRunEvent['capture']>,
): string | null {
  if (capture.source === 'telegram') {
    const raw = asRecord(capture.raw)
    if (raw?.schema === 'murph.telegram-capture.v1') {
      return normalizeLocalAssistantInputReplyTargetIdentifier(raw.message_id)
    }
  }

  const externalId = normalizeLocalAssistantInputReplyTargetIdentifier(
    capture.externalId,
  )
  if (capture.source !== 'linq' || !externalId?.startsWith('linq:')) {
    return null
  }
  const messageId = normalizeLocalAssistantInputReplyTargetIdentifier(
    externalId.slice('linq:'.length),
  )
  if (!messageId || messageId.startsWith('hbid:linq.message:')) {
    return null
  }
  return messageId
}

function createLocalCaptureAssistantInputSourceMetadata(
  vault: string,
  capture: NonNullable<InboxRunEvent['capture']>,
): UpsertAssistantInputEventInput['sourceMetadata'] {
  if (capture.source === 'linq') {
    const raw = asRecord(capture.raw)
    if (raw?.schema !== 'murph.linq-capture.v1') {
      return null
    }
    return {
      kind: 'linq',
      partCount: readLocalLinqCapturePartCount(raw),
      reactionEligible: raw.reaction_eligible === true,
      replyToMessageId: readLocalLinqCaptureReplyToMessageId(raw),
      service: normalizeLocalAssistantInputToken(raw.service, 'linq-service'),
    }
  }

  if (capture.source !== 'telegram') {
    return null
  }

  const raw = asRecord(capture.raw)
  if (raw?.schema !== 'murph.telegram-capture.v1') {
    return null
  }

  const mediaGroupId = hashNullableLocalAssistantInputIdentifier(
    vault,
    'telegram-media-group',
    raw.media_group_id,
  )
  const replyContext = sanitizeLocalAssistantInputMetadataText(
    raw.reply_context_preview,
  )
  const replyToMessageId = readLocalTelegramCaptureReplyToMessageId(raw)
  if (!mediaGroupId && !replyContext && !replyToMessageId) {
    return null
  }

  return {
    kind: 'telegram',
    mediaGroupId,
    replyContext,
    ...(replyToMessageId ? { replyToMessageId } : {}),
  }
}

function readLocalTelegramCaptureReplyToMessageId(
  raw: Record<string, unknown>,
): string | null {
  const value = raw.reply_to_message_id
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return /^\d+$/u.test(normalized) ? normalized : null
}

function readLocalLinqCaptureReplyToMessageId(
  raw: Record<string, unknown>,
): string | null {
  const value = raw.reply_to_message_id
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readLocalLinqCapturePartCount(raw: Record<string, unknown>): number {
  const counts = [
    raw.text_part_count,
    raw.link_part_count,
    raw.media_part_count,
    raw.voice_memo_part_count,
  ]
  let total = 0
  for (const count of counts) {
    if (typeof count === 'number' && Number.isSafeInteger(count) && count > 0) {
      total += count
    }
  }
  return Math.min(total, 64)
}

function normalizeLocalAssistantInputReplyTargetIdentifier(
  value: unknown,
): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }

  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

function notifyImportedCaptureInputAvailable(input: {
  event: InboxRunEvent
  signal: AbortSignal
  vault: string
}): void {
  if (
    input.event.type !== 'capture.imported' ||
    !input.event.capture ||
    !input.event.capture.thread
  ) {
    return
  }
  notifyAssistantActiveTurnInputAvailable({
    conversation: conversationRefFromCapture({
      accountId: input.event.capture.accountId,
      actorId: input.event.capture.actor.id,
      source: input.event.capture.source,
      threadId: input.event.capture.thread.id,
      threadIsDirect: input.event.capture.thread.isDirect ?? null,
    }),
    signal: input.signal,
    vault: input.vault,
  }).catch((error) => {
    warnAssistantBestEffortFailure({
      error,
      operation: 'active turn input notification',
    })
  })
}

function normalizeLocalAssistantInputToken(
  value: unknown,
  fallback: string,
): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (
    normalized.length > 0 &&
    normalized.length <= 192 &&
    /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,191}$/u.test(normalized)
  ) {
    return normalized
  }
  return fallback
}

function sanitizeLocalAssistantInputMetadataText(value: unknown): string | null {
  const text = typeof value === 'string' ? value : ''
  const sanitized = text
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[link omitted]')
    .replace(/file:\/\/[^\s"'<>]+/giu, '[path omitted]')
    .replace(/(^|[\s("'=])(?:[A-Za-z]:[\\/]|\/[^\s"'<>]+|~\/|\.\.\/|\.\.\\)[^\s"'<>]*/gu, '$1[path omitted]')
    .replace(/^\s*(authorization|cookie|set-cookie|x-api-key)\s*:.*$/gimu, '[secret omitted]')
    .trim()
  if (!sanitized) {
    return null
  }
  return sanitized.length > 512 ? sanitized.slice(0, 512) : sanitized
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function hashLocalAssistantInputIdentifier(
  vault: string,
  source: string,
  value: unknown,
  fallback: string,
): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  const material = normalized || fallback
  return `lid_${createHash('sha256')
    .update('murph.local-assistant-input.identifier.v1')
    .update('\0')
    .update(vault)
    .update('\0')
    .update(source)
    .update('\0')
    .update(material)
    .digest('hex')
    .slice(0, 32)}`
}

function hashNullableLocalAssistantInputIdentifier(
  vault: string,
  source: string,
  value: unknown,
): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized
    ? hashLocalAssistantInputIdentifier(vault, source, normalized, 'empty')
    : null
}

function normalizeLocalAssistantInputContentType(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9][A-Za-z0-9.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9.+-]{0,126}$/u
      .test(normalized)
    ? normalized
    : null
}

function normalizeLocalAssistantInputFileName(value: unknown): string | null {
  return normalizeAssistantInputFileName(value)
}

function normalizeLocalAssistantInputSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

export async function runAssistantAutomationPass(
  input: RunAssistantAutomationPassInput,
): Promise<AssistantAutomationPassResult> {
  const inboxServices = input.inboxServices ?? createIntegratedInboxServices()
  const applyCanonicalWrites = input.applyCanonicalWrites ?? true
  let executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const inputSource =
    input.inputSource ??
    createStoreBackedAssistantInputSource({
      vault: input.vault,
    })
  const vaultServices = applyCanonicalWrites
    ? input.vaultServices ?? createIntegratedVaultServices()
    : undefined

  maybeThrowInjectedAssistantFault({
    component: 'automation',
    fault: 'automation',
    message: 'Injected assistant automation failure.',
  })
  const passTiming = {
    cronStatusDeferred: false,
    cronStatusElapsedMs: null as number | null,
    postScanTailElapsedMs: 0,
    scanElapsedMs: 0,
  }
  const outboxResult = input.drainOutbox ?? true
    ? await drainAssistantOutbox({
        vault: input.vault,
        limit: input.maxPerScan,
        ...(input.signal ? { signal: input.signal } : {}),
      })
    : {
        attempted: 0,
        failed: 0,
        queued: 0,
        sent: 0,
      }
  if (applyCanonicalWrites) {
    const inputRefreshResult = await inputSource.refresh({
      signal: input.signal,
    })
    if (
      inputRefreshResult.reason !== 'ingested_input' &&
      executionContext.hosted &&
      input.buildDynamicContextPrompt
    ) {
      const dynamicContextPrompt = await input.buildDynamicContextPrompt({
        signal: input.signal,
      })
      const finalInputRefreshResult = await inputSource.refresh({
        signal: input.signal,
      })
      if (finalInputRefreshResult.reason !== 'ingested_input') {
        executionContext = appendAssistantHostedDynamicContextPrompt({
          executionContext,
          prompt: dynamicContextPrompt,
        })
      }
    }
  }
  let state = await readAssistantAutomationState(input.vault)
  const providerStartCriticalPath = stampAssistantProviderStartCriticalPath(
    input.providerStartCriticalPath,
    'automationPassSetupDoneAtMonotonicMs',
  )
  const stateBeforeScan = snapshotAssistantAutomationLoopState(state)

  const scanStartedAt = Date.now()
  const scanResult = await scanAssistantAutomationOnce({
    applyCanonicalWrites,
    allowSelfAuthored: input.allowSelfAuthored ?? false,
    ...(input.beforeProviderAcceptedInputs
      ? { beforeProviderAcceptedInputs: input.beforeProviderAcceptedInputs }
      : {}),
    ...(providerStartCriticalPath
      ? { providerStartCriticalPath }
      : {}),
    deliveryDispatchMode: input.deliveryDispatchMode,
    executionContext,
    ...(input.operationScope ? { operationScope: input.operationScope } : {}),
    inboxServices,
    maxPerScan: input.maxInputPerScan ?? input.maxPerScan,
    onEvent: input.onEvent,
    onProviderEvent: input.onProviderEvent ?? null,
    onProviderRequestStarted: input.onProviderRequestStarted ?? null,
    onTerminalNonReplyCommitted: input.onTerminalNonReplyCommitted ?? null,
    onTraceEvent: input.onTraceEvent,
    requestId: input.requestId,
    signal: input.signal,
    sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
    state,
    turnEnvironment: input.turnEnvironment ?? null,
    inputSource,
    vault: input.vault,
    vaultServices,
    async onStateProgress(next) {
      state = await saveAssistantAutomationState(input.vault, {
        ...state,
        autoReply: [...next.autoReply],
        updatedAt: new Date().toISOString(),
      })
    },
  })
  passTiming.scanElapsedMs = Date.now() - scanStartedAt
  if (
    scanResult.replies.considered === 0
    && input.signal?.aborted !== true
    && input.shouldYieldBackgroundMaintenance?.() !== true
  ) {
    await maybeRunAssistantRuntimeMaintenance({
      shouldYield: input.shouldYieldBackgroundMaintenance ?? null,
      signal: input.signal ?? null,
      vault: input.vault,
    }).catch((error) => {
      warnAssistantBestEffortFailure({
        error,
        operation: 'runtime maintenance',
      })
    })
  }
  const postScanTailStartedAt = Date.now()
  const shouldDrainOutboxAfterScan =
    applyCanonicalWrites
    && (input.drainOutbox ?? true)
    && input.deliveryDispatchMode === 'queue-only'
    && scanResult.replies.replied > 0
  const postScanOutboxResult = shouldDrainOutboxAfterScan
    ? await drainAssistantOutbox({
        vault: input.vault,
        limit: input.maxPerScan,
        ...(input.signal ? { signal: input.signal } : {}),
      })
    : {
        attempted: 0,
        failed: 0,
        queued: 0,
        sent: 0,
      }
  const shouldDeferCronAfterHostedReply =
    executionContext?.hosted != null &&
    input.deliveryDispatchMode === 'queue-only' &&
    scanResult.replies.replied > 0
  const shouldDeferCronByCaller =
    executionContext?.hosted != null &&
    input.deliveryDispatchMode === 'queue-only' &&
    input.shouldDeferCron?.() === true
  const shouldDeferCron =
    shouldDeferCronAfterHostedReply || shouldDeferCronByCaller
  const cronResult = applyCanonicalWrites && !shouldDeferCron
    ? await processDueAssistantCronJobs({
        deliveryDispatchMode: input.deliveryDispatchMode,
        executionContext,
        onEvent: input.onEvent,
        onTraceEvent: input.onTraceEvent,
        shouldYield: input.shouldDeferCron ?? null,
        vault: input.vault,
        signal: input.signal,
        shouldYieldBackgroundMaintenance:
          input.shouldYieldBackgroundMaintenance ?? null,
        turnEnvironment: input.turnEnvironment ?? null,
        limit: input.maxPerScan,
      })
    : {
        failed: 0,
        processed: 0,
        succeeded: 0,
      }

  const skipStatusRefresh =
    executionContext?.hosted != null
    && input.deliveryDispatchMode === 'queue-only'
  if (!skipStatusRefresh) {
    await refreshAssistantStatusSnapshot(input.vault).catch((error) => {
      warnAssistantBestEffortFailure({
        error,
        operation: 'status snapshot refresh',
      })
    })
  }

  const stateProgressed = didAssistantAutomationStateProgress(
    stateBeforeScan,
    state,
  )
  const shouldDeferCronStatus =
    shouldDeferCronAfterHostedReply &&
    scanResult.currentTurnDeliveryIntentIds.length > 0
  passTiming.cronStatusDeferred = shouldDeferCronStatus
  const cronStatusStartedAt = Date.now()
  const cronStatus = shouldDeferCronStatus
    ? null
    : await getAssistantCronStatus(input.vault, {
        executionContext,
        shouldYieldBackgroundMaintenance:
          input.shouldYieldBackgroundMaintenance ?? null,
        turnEnvironment: input.turnEnvironment ?? null,
      })
  passTiming.cronStatusElapsedMs = shouldDeferCronStatus
    ? null
    : Date.now() - cronStatusStartedAt
  const cronNextRunAt = resolveAssistantCronNextWakeAt({
    applyCanonicalWrites,
    cronStatus,
    shouldDeferCron,
  })
  const outboxNextAttemptAt = input.drainOutbox ?? true
    ? (await buildAssistantOutboxSummary(input.vault)).nextAttemptAt
    : null
  const replies = scanResult.replies
  const modelCapableNextWakeAt = earliestAssistantAutomationWakeAt(
    replies.nextWakeAt,
    scanResult.routing.nextWakeAt,
    cronNextRunAt,
  )
  const nextWakeAt = earliestAssistantAutomationWakeAt(
    modelCapableNextWakeAt,
    outboxNextAttemptAt,
  )
  const outboxOnlyNextWakeAt =
    nextWakeAt !== null
    && nextWakeAt === earliestAssistantAutomationWakeAt(outboxNextAttemptAt)
    && nextWakeAt !== modelCapableNextWakeAt
      ? nextWakeAt
      : null
  const progressed =
    stateProgressed ||
    outboxResult.attempted > 0 ||
    cronResult.processed > 0 ||
    replies.checkpointRequired === true
  passTiming.postScanTailElapsedMs = Date.now() - postScanTailStartedAt

  return {
    cronProcessed: cronResult.processed,
    currentTurnDeliveryIntentIds:
      scanResult.currentTurnDeliveryIntentIds,
    nextWakeAt,
    ...(outboxOnlyNextWakeAt ? { outboxOnlyNextWakeAt } : {}),
    outboxAttempted: outboxResult.attempted,
    passTiming,
    progressed,
    replies,
    routing: scanResult.routing,
  }
}

function resolveAssistantCronNextWakeAt(input: {
  applyCanonicalWrites: boolean
  cronStatus: Awaited<ReturnType<typeof getAssistantCronStatus>> | null
  shouldDeferCron: boolean
}): string | null {
  if (!input.applyCanonicalWrites || !input.cronStatus) {
    return null
  }

  if (
    input.shouldDeferCron &&
    (input.cronStatus.dueJobs ?? 0) > 0
  ) {
    return computeAssistantAutomationRetryAt(
      HOSTED_DEFERRED_CRON_CATCHUP_WAKE_DELAY_MS,
    )
  }

  return input.cronStatus.nextRunAt
}

function snapshotAssistantAutomationLoopState(
  state: AssistantAutomationLoopStateSnapshot,
): AssistantAutomationLoopStateSnapshot {
  return {
    autoReply: state.autoReply.map((entry) => ({
      channel: entry.channel,
      eligibleAfter: entry.eligibleAfter,
      enabledAt: entry.enabledAt,
    })),
  }
}

function didAssistantAutomationStateProgress(
  before: AssistantAutomationLoopStateSnapshot,
  after: AssistantAutomationLoopStateSnapshot,
): boolean {
  return !sameAssistantAutoReplyState(before.autoReply, after.autoReply)
}
