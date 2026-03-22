import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantRunResultSchema,
  type AssistantAutomationCursor,
  type AssistantRunResult,
} from '../assistant-cli-contracts.js'
import type { InboxListResult, InboxShowResult } from '../inbox-cli-contracts.js'
import type { InboxCliServices } from '../inbox-services.js'
import { routeInboxCaptureWithModel } from '../inbox-model-harness.js'
import { shouldBypassParserWaitForRouting } from '../inbox-routing-vision.js'
import type { AssistantModelSpec } from '../model-harness.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import { sendAssistantMessage } from './service.js'
import {
  listAssistantTranscriptEntries,
  readAssistantAutomationState,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantAutomationState,
} from './store.js'
import {
  errorMessage,
  normalizeNullableString,
  writeJsonFileAtomic,
} from './shared.js'
import { isAssistantProviderConnectionLostError } from './provider-turn-recovery.js'

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

      const waitingForParser = shown.capture.attachments.some((attachment) => {
        if (
          attachment.parseState !== 'pending' &&
          attachment.parseState !== 'running'
        ) {
          return false
        }

        return !shouldBypassParserWaitForRouting(attachment)
      })
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
  allowSelfAuthored?: boolean
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
  sessionMaxAgeMs?: number | null
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
    considered: 0,
    failed: 0,
    replied: 0,
    skipped: 0,
  }
  let cursor = input.afterCursor ?? null

  for (let index = 0; index < captures.length; index += 1) {
    if (input.signal?.aborted) {
      break
    }

    const group = await collectAssistantAutoReplyGroup({
      captures,
      startIndex: index,
      vault: input.vault,
    })
    index = group.endIndex
    summary.considered += group.items.length

    const firstItem = group.items[0]
    const lastItem = group.items[group.items.length - 1]
    if (!firstItem || !lastItem) {
      continue
    }

    try {
      if (!enabledChannels.includes(firstItem.summary.source)) {
        summary.skipped += group.items.length
        cursor = cursorFromCapture(lastItem.summary)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: firstItem.summary.captureId,
          details: 'channel not enabled for assistant auto-reply',
        })
        continue
      }

      if (firstItem.summary.actorIsSelf && !(input.allowSelfAuthored ?? false)) {
        summary.skipped += group.items.length
        cursor = cursorFromCapture(lastItem.summary)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: firstItem.summary.captureId,
          details: 'capture is self-authored',
        })
        continue
      }

      const existingArtifact = await Promise.all(
        group.items.map((item) =>
          assistantChatReplyArtifactExists(input.vault, item.summary.captureId),
        ),
      )
      if (existingArtifact.some(Boolean)) {
        summary.skipped += group.items.length
        cursor = cursorFromCapture(lastItem.summary)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: firstItem.summary.captureId,
          details: 'assistant reply already exists',
        })
        continue
      }

      const shownGroup = await Promise.all(
        group.items.map(async (item) => ({
          capture: (
            await input.inboxServices.show({
              vault: input.vault,
              requestId: input.requestId ?? null,
              captureId: item.summary.captureId,
            })
          ).capture,
          telegramMetadata: item.telegramMetadata,
        })),
      )
      const primaryCapture = shownGroup[0]?.capture
      if (!primaryCapture) {
        continue
      }

      const telegramSkipReason = resolveTelegramAutoReplySkipReason(
        primaryCapture,
      )
      if (telegramSkipReason) {
        summary.skipped += group.items.length
        cursor = cursorFromCapture(lastItem.summary)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: firstItem.summary.captureId,
          details: telegramSkipReason,
        })
        continue
      }

      const prompt = buildAssistantAutoReplyPrompt(shownGroup)
      if (prompt.kind === 'defer') {
        summary.skipped += group.items.length
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: firstItem.summary.captureId,
          details: prompt.reason,
        })
        break
      }
      if (prompt.kind === 'skip') {
        summary.skipped += group.items.length
        cursor = cursorFromCapture(lastItem.summary)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: firstItem.summary.captureId,
          details: prompt.reason,
        })
        continue
      }
      if (
        firstItem.summary.actorIsSelf &&
        (await isRecentSelfAuthoredAssistantEcho({
          vault: input.vault,
          capture: primaryCapture,
        }))
      ) {
        summary.skipped += group.items.length
        cursor = cursorFromCapture(lastItem.summary)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: firstItem.summary.captureId,
          details: 'capture matches a recent assistant delivery',
        })
        continue
      }
      const result = await sendAssistantMessage({
        vault: input.vault,
        channel: primaryCapture.source,
        participantId: primaryCapture.actorId ?? undefined,
        persistUserPromptOnFailure: false,
        sourceThreadId: primaryCapture.threadId,
        threadIsDirect: primaryCapture.threadIsDirect,
        prompt: prompt.prompt,
        deliverResponse: true,
        maxSessionAgeMs: input.sessionMaxAgeMs ?? null,
      })

      if (result.deliveryError || result.delivery === null) {
        throw new Error(
          result.deliveryError?.message ??
            'assistant generated a response, but the outbound delivery channel did not confirm the send',
        )
      }

      await writeAssistantChatResultArtifacts({
        captureIds: group.items.map((item) => item.summary.captureId),
        respondedAt: result.delivery.sentAt,
        result,
        vault: input.vault,
      })
      summary.replied += 1
      cursor = cursorFromCapture(lastItem.summary)
      input.onEvent?.({
        type: 'capture.replied',
        captureId: firstItem.summary.captureId,
        details: `${result.delivery.channel} -> ${result.delivery.target}`,
      })
    } catch (error) {
      const detail = errorMessage(error)
      if (isAssistantProviderConnectionLostError(error)) {
        summary.skipped += group.items.length
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: firstItem.summary.captureId,
          details: `${detail} Will retry this capture after the provider reconnects.`,
        })
        break
      }

      summary.failed += 1
      cursor = cursorFromCapture(lastItem.summary)
      await writeAssistantChatErrorArtifacts({
        captureIds: group.items.map((item) => item.summary.captureId),
        error,
        vault: input.vault,
      }).catch(() => {})
      input.onEvent?.({
        type: 'capture.reply-failed',
        captureId: firstItem.summary.captureId,
        details: detail,
      })
      continue
    }
  }

  await input.onStateProgress?.({
    cursor,
    primed: true,
  })

  return summary
}

const SELF_AUTHORED_ECHO_WINDOW_MS = 10 * 60 * 1000

interface TelegramAutoReplyMetadata {
  mediaGroupId: string | null
  replyContext: string | null
}

interface AssistantAutoReplyGroupItem {
  summary: InboxListResult['items'][number]
  telegramMetadata: TelegramAutoReplyMetadata | null
}

interface AssistantAutoReplyPromptCapture {
  capture: InboxShowResult['capture']
  telegramMetadata: TelegramAutoReplyMetadata | null
}

type AssistantAutoReplyPrompt =
  | { kind: 'defer'; reason: string }
  | { kind: 'ready'; prompt: string }
  | { kind: 'skip'; reason: string }

async function collectAssistantAutoReplyGroup(input: {
  captures: InboxListResult['items']
  startIndex: number
  vault: string
}): Promise<{
  endIndex: number
  items: AssistantAutoReplyGroupItem[]
}> {
  const first = input.captures[input.startIndex]
  if (!first) {
    return {
      endIndex: input.startIndex,
      items: [],
    }
  }

  const firstMetadata = await loadTelegramAutoReplyMetadata(
    input.vault,
    first.source === 'telegram' ? first.envelopePath : null,
  )
  if (
    first.source !== 'telegram' ||
    firstMetadata === null ||
    firstMetadata?.mediaGroupId === null
  ) {
    return {
      endIndex: input.startIndex,
      items: [
        {
          summary: first,
          telegramMetadata: firstMetadata,
        },
      ],
    }
  }

  const items: AssistantAutoReplyGroupItem[] = [
    {
      summary: first,
      telegramMetadata: firstMetadata,
    },
  ]
  let endIndex = input.startIndex

  for (let index = input.startIndex + 1; index < input.captures.length; index += 1) {
    const candidate = input.captures[index]
    if (
      !candidate ||
      candidate.source !== first.source ||
      candidate.threadId !== first.threadId ||
      candidate.actorId !== first.actorId
    ) {
      break
    }

    const candidateMetadata = await loadTelegramAutoReplyMetadata(
      input.vault,
      candidate.envelopePath,
    )
    if (candidateMetadata?.mediaGroupId !== firstMetadata.mediaGroupId) {
      break
    }

    items.push({
      summary: candidate,
      telegramMetadata: candidateMetadata,
    })
    endIndex = index
  }

  return {
    endIndex,
    items,
  }
}

function buildAssistantAutoReplyPrompt(
  captures: readonly AssistantAutoReplyPromptCapture[],
): AssistantAutoReplyPrompt {
  if (
    captures.some(({ capture }) =>
      capture.attachments.some(
      (attachment) =>
        attachment.parseState === 'pending' ||
        attachment.parseState === 'running',
      ),
    )
  ) {
    return {
      kind: 'defer',
      reason: 'waiting for parser completion',
    }
  }

  const sections = captures
    .map((entry, index) =>
      renderAssistantAutoReplyCaptureSection(entry, index, captures.length),
    )
    .filter((section): section is string => section !== null)

  if (sections.length === 0) {
    return {
      kind: 'skip',
      reason: 'capture has no text or parsed attachment content',
    }
  }

  const firstCapture = captures[0]?.capture
  const lastCapture = captures[captures.length - 1]?.capture
  if (!firstCapture || !lastCapture) {
    return {
      kind: 'skip',
      reason: 'capture has no text or parsed attachment content',
    }
  }

  const mediaGroupId = captures[0]?.telegramMetadata?.mediaGroupId ?? null

  const contextLines = [
    `Source: ${firstCapture.source}`,
    `Occurred at: ${
      firstCapture.occurredAt === lastCapture.occurredAt
        ? firstCapture.occurredAt
        : `${firstCapture.occurredAt} -> ${lastCapture.occurredAt}`
    }`,
    `Thread: ${firstCapture.threadId}${firstCapture.threadTitle ? ` (${firstCapture.threadTitle})` : ''}`,
    `Actor: ${firstCapture.actorName ?? firstCapture.actorId ?? 'unknown'} | self=${String(firstCapture.actorIsSelf)}`,
    captures.length > 1 ? `Grouped captures: ${captures.length}` : null,
    mediaGroupId ? `Telegram media group: ${mediaGroupId}` : null,
  ]

  return {
    kind: 'ready',
    prompt: [...contextLines.filter((line): line is string => line !== null), '', ...sections].join('\n'),
  }
}

function renderAssistantAutoReplyCaptureSection(
  entry: AssistantAutoReplyPromptCapture,
  index: number,
  totalCaptures: number,
): string | null {
  const sections: string[] = []
  const captureText = normalizeNullableString(entry.capture.text)
  if (entry.telegramMetadata?.replyContext) {
    sections.push(`Reply context:
${entry.telegramMetadata.replyContext}`)
  }
  if (captureText) {
    sections.push(`Message text:
${captureText}`)
  }

  const attachmentSections = entry.capture.attachments
    .map((attachment) => renderAttachmentPromptSection(attachment))
    .filter((section): section is string => section !== null)

  if (attachmentSections.length > 0) {
    sections.push(`Attachment context:
${attachmentSections.join('\n\n')}`)
  }

  if (sections.length === 0) {
    return null
  }

  if (totalCaptures === 1) {
    return sections.join('\n\n')
  }

  return `Capture ${index + 1}:
${sections.join('\n\n')}`
}

function renderAttachmentPromptSection(
  attachment: InboxShowResult['capture']['attachments'][number],
): string | null {
  const transcript = normalizeNullableString(attachment.transcriptText)
  const extractedText = normalizeNullableString(attachment.extractedText)
  const chunks: string[] = []

  if (transcript) {
    chunks.push(`Transcript:
${transcript}`)
  }
  if (extractedText) {
    chunks.push(`Extracted text:
${extractedText}`)
  }

  if (chunks.length === 0) {
    return null
  }

  const label = `Attachment ${attachment.ordinal} (${attachment.kind}${attachment.fileName ? `, ${attachment.fileName}` : ''})`
  return `${label}\n${chunks.join('\n\n')}`
}

function resolveTelegramAutoReplySkipReason(
  capture: InboxShowResult['capture'],
): string | null {
  if (capture.source !== 'telegram') {
    return null
  }

  if (capture.threadIsDirect !== true) {
    return 'Telegram auto-reply only runs for direct chats'
  }

  return null
}

async function loadTelegramAutoReplyMetadata(
  vaultRoot: string,
  envelopePath: string | null,
): Promise<TelegramAutoReplyMetadata | null> {
  const normalizedEnvelopePath = normalizeNullableString(envelopePath)
  if (!normalizedEnvelopePath) {
    return null
  }

  try {
    const absoluteEnvelopePath = path.isAbsolute(normalizedEnvelopePath)
      ? normalizedEnvelopePath
      : path.join(vaultRoot, normalizedEnvelopePath)
    const parsed = JSON.parse(
      await readFile(absoluteEnvelopePath, 'utf8'),
    ) as unknown
    const envelope = asRecord(parsed)
    const input = asRecord(envelope?.input)
    const raw = asRecord(input?.raw)
    const message = extractTelegramRawMessage(raw)

    return {
      mediaGroupId: normalizeNullableString(
        typeof message?.media_group_id === 'string'
          ? message.media_group_id
          : null,
      ),
      replyContext: buildTelegramReplyContext(message),
    }
  } catch {
    return null
  }
}

function extractTelegramRawMessage(
  raw: Record<string, unknown> | null,
): Record<string, unknown> | null {
  return asRecord(raw?.business_message) ?? asRecord(raw?.message)
}

function buildTelegramReplyContext(
  message: Record<string, unknown> | null,
): string | null {
  if (!message) {
    return null
  }

  const replyToMessage = asRecord(message.reply_to_message)
  const quote = asRecord(message.quote)
  const lines: string[] = []

  if (replyToMessage) {
    const actor = buildTelegramRawActorDisplayName(replyToMessage)
    const text = summarizeTelegramRawMessageText(replyToMessage)
    if (actor && text) {
      lines.push(`Replying to ${actor}: ${text}`)
    } else if (text) {
      lines.push(`Replying to: ${text}`)
    } else if (actor) {
      lines.push(`Replying to ${actor}`)
    } else {
      lines.push('Replying to an earlier Telegram message')
    }
  }

  const quoteText =
    typeof quote?.text === 'string' ? normalizeNullableString(quote.text) : null
  if (quoteText) {
    lines.push(`Quoted text: ${summarizeTelegramText(quoteText)}`)
  }

  return lines.length > 0 ? lines.join('\n') : null
}

function summarizeTelegramRawMessageText(
  message: Record<string, unknown>,
): string | null {
  const text =
    stringFromRecord(message, 'text') ??
    stringFromRecord(message, 'caption') ??
    buildTelegramRawContactText(asRecord(message.contact)) ??
    buildTelegramRawVenueText(asRecord(message.venue)) ??
    buildTelegramRawLocationText(asRecord(message.location)) ??
    buildTelegramRawPollText(asRecord(message.poll)) ??
    null

  return text ? summarizeTelegramText(text) : null
}

function buildTelegramRawActorDisplayName(
  message: Record<string, unknown>,
): string | null {
  return (
    buildTelegramRawDisplayName(asRecord(message.from)) ??
    buildTelegramRawDisplayName(asRecord(message.sender_chat)) ??
    buildTelegramRawDisplayName(asRecord(message.chat)) ??
    null
  )
}

function buildTelegramRawDisplayName(
  record: Record<string, unknown> | null,
): string | null {
  if (!record) {
    return null
  }

  const parts = [
    stringFromRecord(record, 'first_name'),
    stringFromRecord(record, 'last_name'),
  ].filter((value): value is string => value !== null)

  if (parts.length > 0) {
    return parts.join(' ')
  }

  const username = stringFromRecord(record, 'username')
  if (username) {
    return username.startsWith('@') ? username : `@${username}`
  }

  return stringFromRecord(record, 'title')
}

function buildTelegramRawContactText(
  contact: Record<string, unknown> | null,
): string | null {
  if (!contact) {
    return null
  }

  const name = [
    stringFromRecord(contact, 'first_name'),
    stringFromRecord(contact, 'last_name'),
  ]
    .filter((value): value is string => value !== null)
    .join(' ')
  const phoneNumber = stringFromRecord(contact, 'phone_number')

  if (!name && !phoneNumber) {
    return null
  }

  return phoneNumber ? `Shared contact ${name || 'unknown'} (${phoneNumber})` : `Shared contact ${name}`
}

function buildTelegramRawLocationText(
  location: Record<string, unknown> | null,
): string | null {
  if (!location) {
    return null
  }

  const latitude =
    typeof location.latitude === 'number' ? location.latitude : null
  const longitude =
    typeof location.longitude === 'number' ? location.longitude : null
  if (latitude === null || longitude === null) {
    return null
  }

  return `Shared location ${latitude}, ${longitude}`
}

function buildTelegramRawVenueText(
  venue: Record<string, unknown> | null,
): string | null {
  if (!venue) {
    return null
  }

  const parts = [
    stringFromRecord(venue, 'title'),
    stringFromRecord(venue, 'address'),
    buildTelegramRawLocationText(asRecord(venue.location)),
  ].filter((value): value is string => value !== null)

  return parts.length > 0 ? `Shared venue ${parts.join(' | ')}` : null
}

function buildTelegramRawPollText(
  poll: Record<string, unknown> | null,
): string | null {
  if (!poll) {
    return null
  }

  const question = stringFromRecord(poll, 'question')
  const options = Array.isArray(poll.options)
    ? poll.options
        .map((option) => stringFromRecord(asRecord(option), 'text'))
        .filter((value): value is string => value !== null)
    : []

  if (!question && options.length === 0) {
    return null
  }

  return `Shared poll ${question ?? 'untitled poll'}${options.length > 0 ? ` [${options.join(' | ')}]` : ''}`
}

function summarizeTelegramText(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized
}

function stringFromRecord(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!record) {
    return null
  }

  return typeof record[key] === 'string'
    ? normalizeNullableString(record[key] as string)
    : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

async function isRecentSelfAuthoredAssistantEcho(input: {
  capture: InboxShowResult['capture']
  vault: string
}): Promise<boolean> {
  const captureText = normalizeNullableString(input.capture.text)
  if (!captureText) {
    return false
  }

  let resolved: Awaited<ReturnType<typeof resolveAssistantSession>>
  try {
    resolved = await resolveAssistantSession({
      vault: input.vault,
      createIfMissing: false,
      channel: input.capture.source,
      participantId: input.capture.actorId ?? undefined,
      sourceThreadId: input.capture.threadId,
      threadIsDirect: input.capture.threadIsDirect,
    })
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null
    if (code === 'ASSISTANT_SESSION_NOT_FOUND') {
      return false
    }
    throw error
  }

  const referenceTimestamp =
    normalizeNullableString(resolved.session.lastTurnAt) ??
    normalizeNullableString(resolved.session.updatedAt) ??
    normalizeNullableString(resolved.session.createdAt)
  if (!referenceTimestamp) {
    return false
  }

  const referenceTime = Date.parse(referenceTimestamp)
  const captureTime = Date.parse(input.capture.occurredAt)
  if (!Number.isFinite(referenceTime) || !Number.isFinite(captureTime)) {
    return false
  }

  if (
    captureTime < referenceTime ||
    captureTime - referenceTime > SELF_AUTHORED_ECHO_WINDOW_MS
  ) {
    return false
  }

  const transcript = await listAssistantTranscriptEntries(
    input.vault,
    resolved.session.sessionId,
  )
  const lastAssistantEntry = [...transcript]
    .reverse()
    .find((entry) => entry.kind === 'assistant')
  if (!lastAssistantEntry) {
    return false
  }

  return (
    normalizeComparableText(lastAssistantEntry.text) ===
    normalizeComparableText(captureText)
  )
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
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

async function assistantChatReplyArtifactExists(
  vaultRoot: string,
  captureId: string,
): Promise<boolean> {
  return (
    await assistantArtifactExists(
      vaultRoot,
      captureId,
      'chat-result.json',
    )
  ) || (
    await assistantArtifactExists(
      vaultRoot,
      captureId,
      'chat-error.json',
    )
  )
}

async function assistantArtifactExists(
  vaultRoot: string,
  captureId: string,
  fileName: string,
): Promise<boolean> {
  try {
    await access(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        captureId,
        'assistant',
        fileName,
      ),
    )
    return true
  } catch {
    return false
  }
}

async function writeAssistantChatResultArtifacts(input: {
  captureIds: readonly string[]
  respondedAt: string
  result: Awaited<ReturnType<typeof sendAssistantMessage>>
  vault: string
}): Promise<void> {
  await Promise.all(
    input.captureIds.map((captureId) =>
      writeJsonFileAtomic(
        path.join(
          input.vault,
          'derived',
          'inbox',
          captureId,
          'assistant',
          'chat-result.json',
        ),
        {
          schema: 'healthybob.assistant-chat-result.v1',
          captureId,
          groupCaptureIds: [...input.captureIds],
          sessionId: input.result.session.sessionId,
          channel: input.result.delivery?.channel ?? null,
          target: input.result.delivery?.target ?? null,
          respondedAt: input.respondedAt,
          response: input.result.response,
        },
      ),
    ),
  )
}

async function writeAssistantChatErrorArtifacts(input: {
  captureIds: readonly string[]
  error: unknown
  vault: string
}): Promise<void> {
  const message = errorMessage(input.error)
  const code =
    typeof input.error === 'object' &&
    input.error !== null &&
    'code' in input.error &&
    typeof (input.error as { code?: unknown }).code === 'string'
      ? (input.error as { code: string }).code
      : null

  await Promise.all(
    input.captureIds.map((captureId) =>
      writeJsonFileAtomic(
        path.join(
          input.vault,
          'derived',
          'inbox',
          captureId,
          'assistant',
          'chat-error.json',
        ),
        {
          schema: 'healthybob.assistant-chat-error.v1',
          captureId,
          groupCaptureIds: [...input.captureIds],
          code,
          failedAt: new Date().toISOString(),
          message,
        },
      ),
    ),
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
