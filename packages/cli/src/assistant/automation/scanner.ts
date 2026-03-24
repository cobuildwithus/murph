import type { AssistantAutomationCursor } from '../../assistant-cli-contracts.js'
import type { InboxShowResult } from '../../inbox-cli-contracts.js'
import type { InboxCliServices } from '../../inbox-services.js'
import { routeInboxCaptureWithModel } from '../../inbox-model-harness.js'
import { shouldBypassParserWaitForRouting } from '../../inbox-routing-vision.js'
import type { AssistantModelSpec } from '../../model-harness.js'
import type { VaultCliServices } from '../../vault-cli-services.js'
import { getAssistantChannelAdapter } from '../channel-adapters.js'
import {
  conversationRefFromCapture,
} from '../conversation-ref.js'
import { sendAssistantMessage } from '../service.js'
import {
  listAssistantTranscriptEntries,
  resolveAssistantSession,
} from '../store.js'
import { errorMessage, normalizeNullableString } from '../shared.js'
import { isAssistantProviderConnectionLostError } from '../provider-turn-recovery.js'
import {
  assistantChatReplyArtifactExists,
  assistantResultArtifactExists,
  writeAssistantChatErrorArtifacts,
  writeAssistantChatResultArtifacts,
} from './artifacts.js'
import { collectAssistantAutoReplyGroup } from './grouping.js'
import {
  buildAssistantAutoReplyPrompt,
} from './prompt-builder.js'
import {
  createEmptyAutoReplyScanResult,
  cursorFromCapture,
  normalizeEnabledChannels,
  normalizeScanLimit,
  type AssistantAutoReplyScanResult,
  type AssistantAutomationStateProgress,
  type AssistantInboxScanResult,
  type AssistantRunEvent,
} from './shared.js'

const SELF_AUTHORED_ECHO_WINDOW_MS = 10 * 60 * 1000

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
  backlogChannels?: readonly string[]
  enabledChannels: readonly string[]
  inboxServices: InboxCliServices
  maxPerScan?: number
  onEvent?: (event: AssistantRunEvent) => void
  onStateProgress?: (state: AssistantAutomationStateProgress) => Promise<void> | void
  requestId?: string | null
  signal?: AbortSignal
  sessionMaxAgeMs?: number | null
  vault: string
}): Promise<AssistantAutoReplyScanResult> {
  const enabledChannels = normalizeEnabledChannels(input.enabledChannels)
  const backlogChannels = normalizeEnabledChannels(input.backlogChannels ?? [])
  const backlogActive = backlogChannels.length > 0
  if (enabledChannels.length === 0) {
    return createEmptyAutoReplyScanResult()
  }

  if (!(input.autoReplyPrimed ?? true) && !backlogActive) {
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

    return createEmptyAutoReplyScanResult()
  }

  if (backlogActive) {
    input.onEvent?.({
      type: 'reply.scan.primed',
      details: `processing existing ${backlogChannels.join(', ')} backlog before switching to new inbound messages`,
    })
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

  if (backlogActive && captures.length === 0) {
    await input.onStateProgress?.({
      cursor: input.afterCursor ?? null,
      backlogChannels: [],
      primed: true,
    })
    return createEmptyAutoReplyScanResult()
  }

  const summary = createEmptyAutoReplyScanResult()
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

      const channelAdapter = getAssistantChannelAdapter(primaryCapture.source)
      const autoReplySkipReason = channelAdapter?.canAutoReply(primaryCapture) ?? null
      if (autoReplySkipReason) {
        summary.skipped += group.items.length
        cursor = cursorFromCapture(lastItem.summary)
        input.onEvent?.({
          type: 'capture.reply-skipped',
          captureId: firstItem.summary.captureId,
          details: autoReplySkipReason,
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
        conversation: conversationRefFromCapture(primaryCapture),
        persistUserPromptOnFailure: false,
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
      conversation: conversationRefFromCapture(input.capture),
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
