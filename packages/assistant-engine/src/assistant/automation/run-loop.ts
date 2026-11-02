import { type AssistantAutomationState } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
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
import { maybeThrowInjectedAssistantFault } from '../fault-injection.js'
import {
  drainAssistantOutboxLocal as drainAssistantOutbox,
  type AssistantOutboxDispatchMode,
} from '../outbox.js'
import type { AssistantProviderTraceEvent } from '../provider-traces.js'
import type { AssistantProviderProgressEvent } from '../provider-progress.js'
import type { AssistantTurnEnvironment } from '../service-contracts.js'
import { buildAssistantOutboxSummary } from '../outbox/summary.js'
import { maybeRunAssistantRuntimeMaintenance } from '../runtime-budgets.js'
import { refreshAssistantStatusSnapshot } from '../status.js'
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '../store.js'
import { sameAssistantAutoReplyState } from '../automation-state.js'
import {
  createStoreBackedAssistantInputSource,
  type AssistantInputSource,
} from '../input-source.js'
import {
  warnAssistantBestEffortFailure,
} from '../shared.js'
import {
  computeAssistantAutomationRetryAt,
  earliestAssistantAutomationWakeAt,
  type AssistantAutomationPassResult,
  type AssistantAutoReplyTerminalNonReplyHook,
  type AssistantRunEvent,
} from './shared.js'
import { scanAssistantAutomationOnce } from './scanner.js'
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

const HOSTED_DEFERRED_CRON_CATCHUP_WAKE_DELAY_MS = 10_000
export interface RunAssistantAutomationPassInput {
  maxInputPerScan?: number
  scanNumber?: number
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
  requestId?: string | null
  shouldYieldBackgroundMaintenance?: (() => boolean) | null
  shouldDeferCron?: (() => boolean) | null
  signal?: AbortSignal
  sessionMaxAgeMs?: number | null
  inputSource?: AssistantInputSource
  turnEnvironment?: AssistantTurnEnvironment | null
  vault: string
  vaultServices?: VaultServices | null
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
        dispatchHooks: { onEvent: input.onEvent },
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
        dispatchHooks: { onEvent: input.onEvent },
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
