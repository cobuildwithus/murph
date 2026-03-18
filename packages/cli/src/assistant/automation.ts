import { access } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantRunResultSchema,
  type AssistantAutomationCursor,
  type AssistantRunResult,
} from '../assistant-cli-contracts.js'
import type { InboxCliServices } from '../inbox-services.js'
import { routeInboxCaptureWithModel } from '../inbox-model-harness.js'
import type { AssistantModelSpec } from '../model-harness.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import { sendAssistantMessage } from './service.js'
import {
  readAssistantAutomationState,
  redactAssistantDisplayPath,
  saveAssistantAutomationState,
} from './store.js'
import { errorMessage, writeJsonFileAtomic } from './shared.js'

export interface AssistantRunEvent {
  captureId?: string
  details?: string
  tools?: string[]
  type:
    | 'capture.failed'
    | 'capture.noop'
    | 'capture.replied'
    | 'capture.reply-failed'
    | 'capture.reply-skipped'
    | 'capture.routed'
    | 'capture.skipped'
    | 'reply.scan.primed'
    | 'reply.scan.started'
    | 'scan.started'
}

export interface AssistantInboxScanResult {
  considered: number
  failed: number
  noAction: number
  routed: number
  skipped: number
}

export interface AssistantAutoReplyScanResult {
  considered: number
  failed: number
  replied: number
  skipped: number
}

export interface RunAssistantAutomationInput {
  inboxServices: InboxCliServices
  maxPerScan?: number
  modelSpec?: AssistantModelSpec
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
  const aggregateRouting: AssistantInboxScanResult = {
    considered: 0,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 0,
  }
  const aggregateReplies: AssistantAutoReplyScanResult = {
    considered: 0,
    failed: 0,
    replied: 0,
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

export async function scanAssistantAutoReplyOnce(input: {
  afterCursor?: AssistantAutomationCursor | null
  autoReplyPrimed?: boolean
  enabledChannels: readonly string[]
  inboxServices: InboxCliServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onStateProgress?: (state: {
    cursor: AssistantAutomationCursor | null
    primed: boolean
  }) => Promise<void> | void
  requestId?: string | null
  signal?: AbortSignal
  vault: string
}): Promise<AssistantAutoReplyScanResult> {
  const enabledChannels = normalizeEnabledChannels(input.enabledChannels)
  if (enabledChannels.length === 0) {
    return {
      considered: 0,
      failed: 0,
      replied: 0,
      skipped: 0,
    }
  }

  if (!(input.autoReplyPrimed ?? true)) {
    const latest = await input.inboxServices.list({
      vault: input.vault,
      requestId: input.requestId ?? null,
      limit: 1,
      sourceId: null,
      afterOccurredAt: null,
      afterCaptureId: null,
      oldestFirst: false,
    })
    const latestCapture = [...latest.items].sort((left, right) =>
      left.occurredAt === right.occurredAt
        ? right.captureId.localeCompare(left.captureId)
        : right.occurredAt.localeCompare(left.occurredAt),
    )[0]
    const nextCursor = latestCapture
      ? {
          occurredAt: latestCapture.occurredAt,
          captureId: latestCapture.captureId,
        }
      : input.afterCursor ?? null

    await input.onStateProgress?.({
      cursor: nextCursor,
      primed: true,
    })
    input.onEvent?.({
      type: 'reply.scan.primed',
      details:
        nextCursor === null
          ? 'no existing captures yet; auto-reply will start with the next inbound message'
          : `starting after ${nextCursor.captureId}`,
    })

    return {
      considered: 0,
      failed: 0,
      replied: 0,
      skipped: 0,
    }
  }

  const listed = await input.inboxServices.list({
    vault: input.vault,
    requestId: input.requestId ?? null,
    limit: normalizeScanLimit(input.maxPerScan),
    sourceId: null,
    afterOccurredAt: input.afterCursor?.occurredAt ?? null,
    afterCaptureId: input.afterCursor?.captureId ?? null,
    oldestFirst: true,
  })
  const captures = [...listed.items].sort((left, right) =>
    left.occurredAt === right.occurredAt
      ? left.captureId.localeCompare(right.captureId)
      : left.occurredAt.localeCompare(right.occurredAt),
  )
  input.onEvent?.({
    type: 'reply.scan.started',
    details: `${captures.length} capture(s)`,
  })

  const summary: AssistantAutoReplyScanResult = {
    considered: captures.length,
    failed: 0,
    replied: 0,
    skipped: 0,
  }
  let cursor = input.afterCursor ?? null

  for (const capture of captures) {
    if (input.signal?.aborted) {
      break
    }

    try {
      if (!enabledChannels.includes(capture.source)) {
        summary.skipped += 1
        cursor = cursorFromCapture(capture)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: capture.captureId,
          details: 'channel not enabled for assistant auto-reply',
        })
        continue
      }

      if (capture.actorIsSelf) {
        summary.skipped += 1
        cursor = cursorFromCapture(capture)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: capture.captureId,
          details: 'capture is self-authored',
        })
        continue
      }

      const prompt = capture.text?.trim() ?? ''
      if (prompt.length === 0) {
        summary.skipped += 1
        cursor = cursorFromCapture(capture)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: capture.captureId,
          details: 'capture has no text payload',
        })
        continue
      }

      const existingArtifact = await assistantChatResultArtifactExists(
        input.vault,
        capture.captureId,
      )
      if (existingArtifact) {
        summary.skipped += 1
        cursor = cursorFromCapture(capture)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: capture.captureId,
          details: 'assistant reply already exists',
        })
        continue
      }

      const shown = await input.inboxServices.show({
        vault: input.vault,
        requestId: input.requestId ?? null,
        captureId: capture.captureId,
      })
      const result = await sendAssistantMessage({
        vault: input.vault,
        channel: shown.capture.source,
        participantId: shown.capture.actorId ?? undefined,
        sourceThreadId: shown.capture.threadId,
        threadIsDirect: shown.capture.threadIsDirect,
        prompt,
        deliverResponse: true,
      })

      if (result.deliveryError || result.delivery === null) {
        throw new Error(
          result.deliveryError?.message ??
            'assistant generated a response, but the outbound delivery channel did not confirm the send',
        )
      }

      await writeAssistantChatResultArtifact({
        captureId: capture.captureId,
        respondedAt: result.delivery.sentAt,
        result,
        vault: input.vault,
      })
      summary.replied += 1
      cursor = cursorFromCapture(capture)
      input.onEvent?.({
        type: 'capture.replied',
        captureId: capture.captureId,
        details: `${result.delivery.channel} -> ${result.delivery.target}`,
      })
    } catch (error) {
      summary.failed += 1
      input.onEvent?.({
        type: 'capture.reply-failed',
        captureId: capture.captureId,
        details: errorMessage(error),
      })
      break
    }
  }

  await input.onStateProgress?.({
    cursor,
    primed: true,
  })

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

async function assistantChatResultArtifactExists(
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
        'chat-result.json',
      ),
    )
    return true
  } catch {
    return false
  }
}

async function writeAssistantChatResultArtifact(input: {
  captureId: string
  respondedAt: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
  vault: string
}): Promise<void> {
  await writeJsonFileAtomic(
    path.join(
      input.vault,
      'derived',
      'inbox',
      input.captureId,
      'assistant',
      'chat-result.json',
    ),
    {
      schema: 'healthybob.assistant-chat-result.v1',
      captureId: input.captureId,
      sessionId: input.result.session.sessionId,
      channel: input.result.delivery?.channel ?? null,
      target: input.result.delivery?.target ?? null,
      respondedAt: input.respondedAt,
      response: input.result.response,
    },
  )
}

function cursorFromCapture(capture: {
  captureId: string
  occurredAt: string
}): AssistantAutomationCursor {
  return {
    occurredAt: capture.occurredAt,
    captureId: capture.captureId,
  }
}

function normalizeEnabledChannels(channels: readonly string[]): string[] {
  return [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))]
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
