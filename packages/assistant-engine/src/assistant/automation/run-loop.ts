import { assistantRunResultSchema, type AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices, InboxRunEvent } from '@murphai/inbox-services'
import { createIntegratedInboxServices } from '@murphai/inbox-services'
import type { AssistantModelSpec } from '../../model-harness.js'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import { createAssistantFoodAutoLogHooks } from '../food-auto-log-hooks.js'
import {
  getAssistantCronStatus,
  processDueAssistantCronJobsLocal as processDueAssistantCronJobs,
} from '../cron.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import type { AssistantExecutionContext } from '../execution-context.js'
import { maybeThrowInjectedAssistantFault } from '../fault-injection.js'
import {
  drainAssistantOutboxLocal as drainAssistantOutbox,
  type AssistantOutboxDispatchMode,
} from '../outbox.js'
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
  allowSelfAuthored?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  drainOutbox?: boolean
  executionContext?: AssistantExecutionContext | null
  inboxServices?: InboxServices
  maxPerScan?: number
  modelSpec?: AssistantModelSpec
  onEvent?: (event: AssistantRunEvent) => void
  onInboxEvent?: (event: InboxRunEvent) => void
  once?: boolean
  requestId?: string | null
  signal?: AbortSignal
  startDaemon?: boolean
  sessionMaxAgeMs?: number | null
  vault: string
  vaultServices?: VaultServices
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
              (event.type === 'capture.imported' &&
                (input.allowSelfAuthored || event.capture?.actor?.isSelf !== true)) ||
              event.type === 'parser.jobs.drained'
            ) {
              wakeController.requestWake()
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

export async function runAssistantAutomationPass(
  input: RunAssistantAutomationPassInput,
): Promise<AssistantAutomationPassResult> {
  const inboxServices = input.inboxServices ?? createIntegratedInboxServices()
  const vaultServices = input.vaultServices ?? createIntegratedVaultServices({
    foodAutoLogHooks: createAssistantFoodAutoLogHooks(),
  })

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
  const cronResult = await processDueAssistantCronJobs({
    deliveryDispatchMode: input.deliveryDispatchMode,
    executionContext: input.executionContext,
    vault: input.vault,
    signal: input.signal,
    limit: input.maxPerScan,
  })
  let state = await readAssistantAutomationState(input.vault)
  const stateBeforeScan = snapshotAssistantAutomationLoopState(state)

  const recovery = await recoverAssistantAutoReplies({
    allowSelfAuthored: input.allowSelfAuthored ?? false,
    deliveryDispatchMode: input.deliveryDispatchMode,
    autoReply: state.autoReply,
    executionContext: input.executionContext,
    inboxServices,
    maxPerScan: input.maxPerScan,
    onEvent: input.onEvent,
    requestId: input.requestId,
    signal: input.signal,
    sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
    vault: input.vault,
  })

  const scanResult = await scanAssistantAutomationOnce({
    allowSelfAuthored: input.allowSelfAuthored ?? false,
    deliveryDispatchMode: input.deliveryDispatchMode,
    executionContext: input.executionContext,
    inboxServices,
    maxPerScan: input.maxPerScan,
    modelSpec: input.modelSpec,
    onEvent: input.onEvent,
    requestId: input.requestId,
    signal: input.signal,
    sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
    state,
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
      cronStatus.nextRunAt,
      outboxNextAttemptAt,
    ),
    outboxAttempted: outboxResult.attempted,
    progressed:
      stateProgressed ||
      outboxResult.attempted > 0 ||
      cronResult.processed > 0 ||
      recovery.progressed,
    replies,
    routing: scanResult.routing,
  }
}

function mergeAssistantAutoReplyScanResults(
  left: AssistantAutoReplyScanResult,
  right: AssistantAutoReplyScanResult,
): AssistantAutoReplyScanResult {
  return {
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
      cursor: entry.cursor,
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
    left?.occurredAt === right?.occurredAt
  )
}
