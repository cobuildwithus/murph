import {
  assistantRunResultSchema,
} from '../../assistant-cli-contracts.js'
import type { InboxCliServices } from '../../inbox-services.js'
import type { AssistantModelSpec } from '../../model-harness.js'
import type { VaultCliServices } from '../../vault-cli-services.js'
import { processDueAssistantCronJobs } from '../cron.js'
import {
  readAssistantAutomationState,
  redactAssistantDisplayPath,
  saveAssistantAutomationState,
} from '../store.js'
import { errorMessage } from '../shared.js'
import {
  bridgeAbortSignals,
  createEmptyAutoReplyScanResult,
  createEmptyInboxScanResult,
  normalizeScanInterval,
  type AssistantRunEvent,
  waitForAbortOrTimeout,
} from './shared.js'
import {
  scanAssistantAutoReplyOnce,
  scanAssistantInboxOnce,
} from './scanner.js'

export interface RunAssistantAutomationInput {
  allowSelfAuthored?: boolean
  inboxServices: InboxCliServices
  maxPerScan?: number
  modelSpec?: AssistantModelSpec
  onEvent?: (event: AssistantRunEvent) => void
  once?: boolean
  requestId?: string | null
  scanIntervalMs?: number
  signal?: AbortSignal
  startDaemon?: boolean
  sessionMaxAgeMs?: number | null
  vault: string
  vaultServices?: VaultCliServices
}

export async function runAssistantAutomation(
  input: RunAssistantAutomationInput,
) {
  const startedAt = new Date().toISOString()
  const controller = new AbortController()
  const cleanup = bridgeAbortSignals(controller, input.signal)
  const aggregateRouting = createEmptyInboxScanResult()
  const aggregateReplies = createEmptyAutoReplyScanResult()
  let scans = 0
  let lastError: string | null = null
  const daemonStarted = input.startDaemon ?? true

  let daemonPromise: Promise<unknown> | null = null
  if (daemonStarted) {
    daemonPromise = input.inboxServices
      .run(
        {
          vault: input.vault,
          requestId: input.requestId ?? null,
        },
        {
          signal: controller.signal,
        },
      )
      .catch((error) => {
        lastError = errorMessage(error)
        controller.abort()
      })
  }

  try {
    while (!controller.signal.aborted) {
      scans += 1
      await processDueAssistantCronJobs({
        vault: input.vault,
        signal: controller.signal,
        limit: input.maxPerScan,
      })
      let state = await readAssistantAutomationState(input.vault)

      if (input.modelSpec?.model) {
        const scanResult = await scanAssistantInboxOnce({
          inboxServices: input.inboxServices,
          requestId: input.requestId,
          vault: input.vault,
          vaultServices: input.vaultServices,
          modelSpec: input.modelSpec,
          maxPerScan: input.maxPerScan,
          signal: controller.signal,
          onEvent: input.onEvent,
          afterCursor: state.inboxScanCursor,
          oldestFirst: true,
          async onCursorProgress(cursor) {
            state = await saveAssistantAutomationState(input.vault, {
              ...state,
              inboxScanCursor: cursor,
              updatedAt: new Date().toISOString(),
            })
          },
        })
        aggregateRouting.considered += scanResult.considered
        aggregateRouting.failed += scanResult.failed
        aggregateRouting.noAction += scanResult.noAction
        aggregateRouting.routed += scanResult.routed
        aggregateRouting.skipped += scanResult.skipped
      }

      if (state.autoReplyChannels.length > 0) {
        const replyResult = await scanAssistantAutoReplyOnce({
          afterCursor: state.autoReplyScanCursor,
          autoReplyPrimed: state.autoReplyPrimed,
          enabledChannels: state.autoReplyChannels,
          inboxServices: input.inboxServices,
          maxPerScan: input.maxPerScan,
          onEvent: input.onEvent,
          requestId: input.requestId,
          signal: controller.signal,
          allowSelfAuthored: input.allowSelfAuthored ?? false,
          sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
          vault: input.vault,
          async onStateProgress(next) {
            state = await saveAssistantAutomationState(input.vault, {
              ...state,
              autoReplyScanCursor: next.cursor,
              autoReplyPrimed: next.primed,
              updatedAt: new Date().toISOString(),
            })
          },
        })
        aggregateReplies.considered += replyResult.considered
        aggregateReplies.failed += replyResult.failed
        aggregateReplies.replied += replyResult.replied
        aggregateReplies.skipped += replyResult.skipped
      }

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
      } catch {
        // surfaced through lastError/reason when relevant
      }
    }
  }
}
