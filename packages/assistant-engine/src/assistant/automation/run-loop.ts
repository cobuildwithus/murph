import {
  assistantRunResultSchema,
} from '../../assistant-cli-contracts.js'
import type {
  InboxServices,
  InboxRunEvent,
} from '@murphai/inbox-services'
import { createIntegratedInboxServices } from '@murphai/inbox-services'
import type { AssistantModelSpec } from '../../model-harness.js'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import { createAssistantFoodAutoLogHooks } from '../food-auto-log-hooks.js'
import { processDueAssistantCronJobsLocal as processDueAssistantCronJobs } from '../cron.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import type { AssistantExecutionContext } from '../execution-context.js'
import { maybeThrowInjectedAssistantFault } from '../fault-injection.js'
import {
  drainAssistantOutboxLocal as drainAssistantOutbox,
  type AssistantOutboxDispatchMode,
} from '../outbox.js'
import { maybeRunAssistantRuntimeMaintenance } from '../runtime-budgets.js'
import { refreshAssistantStatusSnapshot } from '../status.js'
import {
  readAssistantAutomationState,
  redactAssistantDisplayPath,
  resolveAssistantStatePaths,
  saveAssistantAutomationState,
} from '../store.js'
import {
  errorMessage,
  formatStructuredErrorMessage,
  warnAssistantBestEffortFailure,
} from '../shared.js'
import {
  bridgeAbortSignals,
  createEmptyAutoReplyScanResult,
  createEmptyInboxScanResult,
  normalizeScanInterval,
  type AssistantRunEvent,
  waitForAbortOrTimeout,
} from './shared.js'
import { scanAssistantAutomationOnce } from './scanner.js'
import { acquireAssistantAutomationRunLock } from './runtime-lock.js'

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
  scanIntervalMs?: number
  signal?: AbortSignal
  startDaemon?: boolean
  sessionMaxAgeMs?: number | null
  vault: string
  vaultServices?: VaultServices
}

export async function runAssistantAutomation(
  input: RunAssistantAutomationInput,
) {
  const startedAt = new Date().toISOString()
  const controller = new AbortController()
  const cleanup = bridgeAbortSignals(controller, input.signal)
  const paths = resolveAssistantStatePaths(input.vault)
  const inboxServices = input.inboxServices ?? createIntegratedInboxServices()
  const vaultServices = input.vaultServices ?? createIntegratedVaultServices({
    foodAutoLogHooks: createAssistantFoodAutoLogHooks(),
  })
  const aggregateRouting = createEmptyInboxScanResult()
  const aggregateReplies = createEmptyAutoReplyScanResult()
  let scans = 0
  let lastError: string | null = null
  const daemonStarted = input.startDaemon ?? true
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
          onEvent: input.onInboxEvent,
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
      scans += 1
      maybeThrowInjectedAssistantFault({
        component: 'automation',
        fault: 'automation',
        message: 'Injected assistant automation failure.',
      })
      await recordAssistantDiagnosticEvent({
        vault: input.vault,
        component: 'automation',
        kind: 'automation.scan.started',
        message: `Assistant automation scan ${scans} started.`,
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
      if (input.drainOutbox ?? true) {
        await drainAssistantOutbox({
          vault: input.vault,
          limit: input.maxPerScan,
        })
      }
      await processDueAssistantCronJobs({
        deliveryDispatchMode: input.deliveryDispatchMode,
        executionContext: input.executionContext,
        vault: input.vault,
        signal: controller.signal,
        limit: input.maxPerScan,
      })
      let state = await readAssistantAutomationState(input.vault)

      const scanResult = await scanAssistantAutomationOnce({
        allowSelfAuthored: input.allowSelfAuthored ?? false,
        deliveryDispatchMode: input.deliveryDispatchMode,
        executionContext: input.executionContext,
        inboxServices,
        maxPerScan: input.maxPerScan,
        modelSpec: input.modelSpec,
        onEvent: input.onEvent,
        requestId: input.requestId,
        signal: controller.signal,
        sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
        state,
        vault: input.vault,
        vaultServices,
        async onStateProgress(next) {
          state = await saveAssistantAutomationState(input.vault, {
            ...state,
            inboxScanCursor: next.inboxScanCursor,
            autoReplyScanCursor: next.autoReplyScanCursor,
            autoReplyBacklogChannels: [...next.autoReplyBacklogChannels],
            autoReplyPrimed: next.autoReplyPrimed,
            updatedAt: new Date().toISOString(),
          })
        },
      })
      aggregateRouting.considered += scanResult.routing.considered
      aggregateRouting.failed += scanResult.routing.failed
      aggregateRouting.noAction += scanResult.routing.noAction
      aggregateRouting.routed += scanResult.routing.routed
      aggregateRouting.skipped += scanResult.routing.skipped
      aggregateReplies.considered += scanResult.replies.considered
      aggregateReplies.failed += scanResult.replies.failed
      aggregateReplies.replied += scanResult.replies.replied
      aggregateReplies.skipped += scanResult.replies.skipped

      await refreshAssistantStatusSnapshot(input.vault).catch((error) => {
        warnAssistantBestEffortFailure({
          error,
          operation: 'status snapshot refresh',
        })
      })

      if (input.once) {
        break
      }

      await waitForAbortOrTimeout(
        controller.signal,
        normalizeScanInterval(input.scanIntervalMs),
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
