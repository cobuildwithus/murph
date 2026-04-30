import { assistantRunResultSchema, type AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices, InboxRunEvent } from '@murphai/inbox-services'
import { createIntegratedInboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import {
  getAssistantCronStatus,
  processDueAssistantCronJobsLocal as processDueAssistantCronJobs,
} from '../cron.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import {
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
import { buildAssistantOutboxSummary } from '../outbox/summary.js'
import { maybeRunAssistantRuntimeMaintenance } from '../runtime-budgets.js'
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
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from '../input-store.js'
import { notifyAssistantActiveTurnInputAvailable } from '../active-turn-input-controller.js'
import {
  errorMessage,
  formatStructuredErrorMessage,
  warnAssistantBestEffortFailure,
} from '../shared.js'
import {
  bridgeAbortSignals,
  createAssistantAutomationWakeController,
  createEmptyAutoReplyScanResult,
  createEmptyInboxScanResult,
  earliestAssistantAutomationWakeAt,
  type AssistantAutomationPassResult,
  type AssistantAutoReplyScanResult,
  type AssistantRunEvent,
} from './shared.js'
import { scanAssistantAutomationOnce } from './scanner.js'
import { acquireAssistantAutomationRunLock } from './runtime-lock.js'
import { recoverAssistantAutoReplies } from './startup-recovery.js'

type AssistantAutomationLoopStateSnapshot = Pick<
  AssistantAutomationState,
  | 'autoReply'
  | 'inboxScanCursor'
>

export interface RunAssistantAutomationInput {
  applyCanonicalWrites?: boolean
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  drainOutbox?: boolean
  executionContext?: AssistantExecutionContext | null
  inboxServices?: InboxServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  onInboxEvent?: (event: InboxRunEvent) => void
  once?: boolean
  requestId?: string | null
  signal?: AbortSignal
  startDaemon?: boolean
  sessionMaxAgeMs?: number | null
  inputSource?: AssistantInputSource
  vault: string
  vaultServices?: VaultServices | null
}

export interface RunAssistantAutomationPassInput
  extends Omit<RunAssistantAutomationInput, 'once' | 'onInboxEvent' | 'startDaemon'> {
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
              stageImportedCaptureAssistantInputEvent({
                capture: event.capture,
                persisted: event.persisted,
                vault: input.vault,
              }).catch((error) => {
                warnAssistantBestEffortFailure({
                  error,
                  operation: 'assistant input event staging',
                })
              }).finally(() => {
                wakeController.requestWake()
                notifyImportedCaptureInputAvailable({
                  event,
                  signal: controller.signal,
                  vault: input.vault,
                })
              })
            } else if (
              (event.type === 'capture.imported' &&
                (input.allowSelfAuthored || event.capture?.actor?.isSelf !== true)) ||
              event.type === 'parser.jobs.drained'
            ) {
              wakeController.requestWake()
              notifyImportedCaptureInputAvailable({
                event,
                signal: controller.signal,
                vault: input.vault,
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
  persisted: NonNullable<InboxRunEvent['persisted']>
  vault: string
}): Promise<void> {
  const text = typeof input.capture.text === 'string'
    ? input.capture.text
    : null
  const stored = await upsertAssistantInputEvent({
    vault: input.vault,
    event: {
      content: {
        attachmentDescriptors: (input.capture.attachments ?? []).map(
          (attachment, index) => ({
            attachmentId: normalizeLocalAssistantInputToken(
              attachment.externalId,
              `attachment_${index}`,
            ),
            contentType: normalizeLocalAssistantInputContentType(
              attachment.mime,
            ),
            fileName: null,
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
        accountId: input.capture.accountId ?? null,
        actorId: input.capture.actor.id ?? null,
        actorIsSelf: input.capture.actor.isSelf,
        source: input.capture.source,
        threadId: input.capture.thread?.id ?? null,
        threadIsDirect: input.capture.thread?.isDirect ?? null,
      },
      occurredAt: input.capture.occurredAt,
      receivedAt: input.persisted.createdAt,
      replyTarget: createLocalCaptureAssistantInputReplyTarget(input.capture),
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

function normalizeLocalAssistantInputReplyTargetIdentifier(
  value: unknown,
): string | null {
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

function normalizeLocalAssistantInputContentType(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9][A-Za-z0-9.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9.+-]{0,126}$/u
      .test(normalized)
    ? normalized
    : null
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
  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
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
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'automation',
    kind: 'automation.scan.started',
    message: `Assistant automation scan ${input.scanNumber ?? 1} started.`,
    counterDeltas: {
      automationScans: 1,
    },
  })
  await maybeRunAssistantRuntimeMaintenance({
    vault: input.vault,
  }).catch((error) => {
    warnAssistantBestEffortFailure({
      error,
      operation: 'runtime maintenance',
    })
  })

  const outboxResult = input.drainOutbox ?? true
    ? await drainAssistantOutbox({
        vault: input.vault,
        limit: input.maxPerScan,
      })
    : {
        attempted: 0,
        failed: 0,
        queued: 0,
        sent: 0,
      }
  let state = await readAssistantAutomationState(input.vault)
  const stateBeforeScan = snapshotAssistantAutomationLoopState(state)

  const recovery = applyCanonicalWrites
    ? await recoverAssistantAutoReplies({
        allowSelfAuthored: input.allowSelfAuthored ?? false,
        deliveryDispatchMode: input.deliveryDispatchMode,
        autoReply: state.autoReply,
        executionContext,
        inboxServices,
        maxPerScan: input.maxPerScan,
        onEvent: input.onEvent,
        onTraceEvent: input.onTraceEvent,
        requestId: input.requestId,
        signal: input.signal,
        sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
        inputSource,
        vault: input.vault,
      })
    : {
        ...createEmptyAutoReplyScanResult(),
        progressed: false,
      }

  const scanResult = await scanAssistantAutomationOnce({
    applyCanonicalWrites,
    allowSelfAuthored: input.allowSelfAuthored ?? false,
    deliveryDispatchMode: input.deliveryDispatchMode,
    executionContext,
    inboxServices,
    maxPerScan: input.maxPerScan,
    onEvent: input.onEvent,
    onTraceEvent: input.onTraceEvent,
    requestId: input.requestId,
    signal: input.signal,
    sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
    state,
    inputSource,
    vault: input.vault,
    vaultServices,
    async onStateProgress(next) {
      state = await saveAssistantAutomationState(input.vault, {
        ...state,
        inboxScanCursor: next.inboxScanCursor,
        autoReply: [...next.autoReply],
        updatedAt: new Date().toISOString(),
      })
    },
  })
  const cronResult = applyCanonicalWrites
    ? await processDueAssistantCronJobs({
        deliveryDispatchMode: input.deliveryDispatchMode,
        executionContext,
        vault: input.vault,
        signal: input.signal,
        limit: input.maxPerScan,
      })
    : {
        failed: 0,
        processed: 0,
        succeeded: 0,
      }

  await refreshAssistantStatusSnapshot(input.vault).catch((error) => {
    warnAssistantBestEffortFailure({
      error,
      operation: 'status snapshot refresh',
    })
  })

  const stateProgressed = didAssistantAutomationStateProgress(
    stateBeforeScan,
    state,
  )
  const cronStatus = await getAssistantCronStatus(input.vault)
  const cronNextRunAt = applyCanonicalWrites ? cronStatus.nextRunAt : null
  const outboxNextAttemptAt = input.drainOutbox ?? true
    ? (await buildAssistantOutboxSummary(input.vault)).nextAttemptAt
    : null
  const replies = mergeAssistantAutoReplyScanResults(
    recovery,
    scanResult.replies,
  )

  return {
    cronProcessed: cronResult.processed,
    nextWakeAt: earliestAssistantAutomationWakeAt(
      replies.nextWakeAt,
      scanResult.routing.nextWakeAt,
      cronNextRunAt,
      outboxNextAttemptAt,
    ),
    outboxAttempted: outboxResult.attempted,
    progressed:
      stateProgressed ||
      outboxResult.attempted > 0 ||
      cronResult.processed > 0 ||
      recovery.progressed ||
      replies.checkpointRequired === true,
    replies,
    routing: scanResult.routing,
  }
}

function mergeAssistantAutoReplyScanResults(
  left: AssistantAutoReplyScanResult,
  right: AssistantAutoReplyScanResult,
): AssistantAutoReplyScanResult {
  return {
    ...(left.checkpointRequired || right.checkpointRequired
      ? { checkpointRequired: true }
      : {}),
    considered: left.considered + right.considered,
    failed: left.failed + right.failed,
    nextWakeAt: earliestAssistantAutomationWakeAt(
      left.nextWakeAt,
      right.nextWakeAt,
    ),
    replied: left.replied + right.replied,
    skipped: left.skipped + right.skipped,
  }
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
    inboxScanCursor: state.inboxScanCursor,
  }
}

function didAssistantAutomationStateProgress(
  before: AssistantAutomationLoopStateSnapshot,
  after: AssistantAutomationLoopStateSnapshot,
): boolean {
  return (
    !sameAssistantAutoReplyState(before.autoReply, after.autoReply) ||
    !sameAssistantAutomationCursor(
      before.inboxScanCursor,
      after.inboxScanCursor,
    )
  )
}

function sameAssistantAutomationCursor(
  left: AssistantAutomationLoopStateSnapshot['inboxScanCursor'],
  right: AssistantAutomationLoopStateSnapshot['inboxScanCursor'],
): boolean {
  return (
    left?.captureId === right?.captureId &&
    (left?.createdAt ?? null) === (right?.createdAt ?? null) &&
    left?.occurredAt === right?.occurredAt
  )
}
