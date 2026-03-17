import { access } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantRunResultSchema,
  type AssistantAutomationCursor,
  type AssistantRunResult,
} from '../assistant-cli-contracts.js'
import type { AssistantModelSpec } from '../model-harness.js'
import type { InboxCliServices } from '../inbox-services.js'
import { routeInboxCaptureWithModel } from '../inbox-model-harness.js'
import {
  readAssistantAutomationState,
  redactAssistantDisplayPath,
  saveAssistantAutomationState,
} from './store.js'
import { errorMessage } from './shared.js'
import type { VaultCliServices } from '../vault-cli-services.js'

export interface AssistantRunEvent {
  captureId?: string
  details?: string
  tools?: string[]
  type:
    | 'capture.failed'
    | 'capture.noop'
    | 'capture.routed'
    | 'capture.skipped'
    | 'scan.started'
}

export interface AssistantInboxScanResult {
  considered: number
  failed: number
  noAction: number
  routed: number
  skipped: number
}

export interface RunAssistantAutomationInput {
  inboxServices: InboxCliServices
  maxPerScan?: number
  modelSpec: AssistantModelSpec
  onEvent?: (event: AssistantRunEvent) => void
  once?: boolean
  requestId?: string | null
  scanIntervalMs?: number
  signal?: AbortSignal
  startDaemon?: boolean
  vault: string
  vaultServices?: VaultCliServices
}

export async function runAssistantAutomation(
  input: RunAssistantAutomationInput,
): Promise<AssistantRunResult> {
  const startedAt = new Date().toISOString()
  const controller = new AbortController()
  const cleanup = bridgeAbortSignals(controller, input.signal)
  const aggregate: AssistantInboxScanResult = {
    considered: 0,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 0,
  }
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
      const state = await readAssistantAutomationState(input.vault)
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
          await saveAssistantAutomationState(input.vault, {
            ...state,
            inboxScanCursor: cursor,
            updatedAt: new Date().toISOString(),
          })
        },
      })
      aggregate.considered += scanResult.considered
      aggregate.failed += scanResult.failed
      aggregate.noAction += scanResult.noAction
      aggregate.routed += scanResult.routed
      aggregate.skipped += scanResult.skipped

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
      considered: aggregate.considered,
      routed: aggregate.routed,
      noAction: aggregate.noAction,
      skipped: aggregate.skipped,
      failed: aggregate.failed,
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

export async function scanAssistantInboxOnce(input: {
  afterCursor?: AssistantAutomationCursor | null
  inboxServices: InboxCliServices
  maxPerScan?: number
  modelSpec: AssistantModelSpec
  oldestFirst?: boolean
  onCursorProgress?: (cursor: AssistantAutomationCursor | null) => Promise<void> | void
  onEvent?: (event: AssistantRunEvent) => void
  requestId?: string | null
  signal?: AbortSignal
  vault: string
  vaultServices?: VaultCliServices
}): Promise<AssistantInboxScanResult> {
  const listed = await input.inboxServices.list({
    vault: input.vault,
    requestId: input.requestId ?? null,
    limit: normalizeScanLimit(input.maxPerScan),
    sourceId: null,
    afterOccurredAt: input.afterCursor?.occurredAt ?? null,
    afterCaptureId: input.afterCursor?.captureId ?? null,
    oldestFirst: input.oldestFirst ?? false,
  })
  const captures = [...listed.items].sort((left, right) =>
    left.occurredAt === right.occurredAt
      ? left.captureId.localeCompare(right.captureId)
      : left.occurredAt.localeCompare(right.occurredAt),
  )
  input.onEvent?.({
    type: 'scan.started',
    details: `${captures.length} capture(s)`,
  })

  const summary: AssistantInboxScanResult = {
    considered: captures.length,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 0,
  }

  for (const capture of captures) {
    if (input.signal?.aborted) {
      break
    }

    try {
      const existingArtifact = await assistantResultArtifactExists(
        input.vault,
        capture.captureId,
      )
      if (existingArtifact) {
        summary.skipped += 1
        input.onEvent?.({
          type: 'capture.skipped',
          captureId: capture.captureId,
          details: 'assistant result already exists',
        })
        continue
      }

      if (capture.promotions.length > 0) {
        summary.skipped += 1
        input.onEvent?.({
          type: 'capture.skipped',
          captureId: capture.captureId,
          details: 'capture already promoted',
        })
        continue
      }

      const shown = await input.inboxServices.show({
        vault: input.vault,
        requestId: input.requestId ?? null,
        captureId: capture.captureId,
      })

      const waitingForParser = shown.capture.attachments.some(
        (attachment) =>
          attachment.parseState === 'pending' ||
          attachment.parseState === 'running',
      )
      if (waitingForParser) {
        summary.skipped += 1
        input.onEvent?.({
          type: 'capture.skipped',
          captureId: capture.captureId,
          details: 'waiting for parser completion',
        })
        continue
      }

      const result = await routeInboxCaptureWithModel({
        inboxServices: input.inboxServices,
        requestId: input.requestId ?? undefined,
        captureId: capture.captureId,
        vault: input.vault,
        vaultServices: input.vaultServices,
        apply: true,
        modelSpec: input.modelSpec,
      })

      if (result.plan.actions.length === 0) {
        summary.noAction += 1
        input.onEvent?.({
          type: 'capture.noop',
          captureId: capture.captureId,
          details: 'model chose no canonical writes',
        })
        continue
      }

      summary.routed += 1
      input.onEvent?.({
        type: 'capture.routed',
        captureId: capture.captureId,
        tools: result.plan.actions.map((action) => action.tool),
      })
    } catch (error) {
      summary.failed += 1
      input.onEvent?.({
        type: 'capture.failed',
        captureId: capture.captureId,
        details: errorMessage(error),
      })
    }
  }

  await input.onCursorProgress?.(
    captures.length > 0
      ? {
          occurredAt: captures[captures.length - 1]!.occurredAt,
          captureId: captures[captures.length - 1]!.captureId,
        }
      : input.afterCursor ?? null,
  )

  return summary
}

async function assistantResultArtifactExists(
  vaultRoot: string,
  captureId: string,
): Promise<boolean> {
  try {
    await access(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        captureId,
        'assistant',
        'result.json',
      ),
    )
    return true
  } catch {
    return false
  }
}

function bridgeAbortSignals(
  controller: AbortController,
  upstream?: AbortSignal,
): () => void {
  const abort = () => controller.abort()
  const onSigint = () => controller.abort()
  const onSigterm = () => controller.abort()

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  if (upstream) {
    if (upstream.aborted) {
      controller.abort()
    } else {
      upstream.addEventListener('abort', abort, { once: true })
    }
  }

  return () => {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    upstream?.removeEventListener('abort', abort)
  }
}

async function waitForAbortOrTimeout(
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  if (signal.aborted) {
    return
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, timeoutMs)

    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function normalizeScanInterval(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return 5000
  }

  return Math.min(Math.max(Math.trunc(value), 250), 60000)
}

function normalizeScanLimit(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return 50
  }

  return Math.min(Math.max(Math.trunc(value), 1), 200)
}
