import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  deliverAssistantProgressUpdate,
} from './delivery-service.js'
import {
  normalizeNullableString,
  warnAssistantBestEffortFailure,
} from './shared.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from './service-contracts.js'

export interface AssistantTurnProgress {
  send(text: string): Promise<void>
}

export const MAX_PROGRESS_UPDATES_PER_TURN = 2
export const MIN_PROGRESS_UPDATE_INTERVAL_MS = 30_000
export const MAX_PROGRESS_CHARS = 240

type DeliverAssistantProgressUpdate = typeof deliverAssistantProgressUpdate

export function createHostedAssistantTurnProgress(input: {
  deliver?: DeliverAssistantProgressUpdate
  messageInput: AssistantMessageInput
  now?: () => number
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): AssistantTurnProgress {
  const deliver = input.deliver ?? deliverAssistantProgressUpdate
  const now = input.now ?? (() => Date.now())
  const sentTexts = new Set<string>()
  let lastSentAt: number | null = null
  let sentCount = 0

  return {
    async send(rawText: string) {
      const text = normalizeAssistantProgressText(rawText)
      if (!text || sentTexts.has(text)) {
        return
      }
      if (sentCount >= MAX_PROGRESS_UPDATES_PER_TURN) {
        return
      }

      const sentAt = now()
      if (
        lastSentAt !== null &&
        sentAt - lastSentAt < MIN_PROGRESS_UPDATE_INTERVAL_MS
      ) {
        return
      }

      const ordinal = sentCount
      sentCount += 1
      lastSentAt = sentAt
      sentTexts.add(text)

      try {
        await deliver({
          input: input.messageInput,
          ordinal,
          session: input.session,
          sharedPlan: input.sharedPlan,
          text,
          turnId: input.turnId,
        })
      } catch (error) {
        warnAssistantBestEffortFailure({
          error,
          operation: 'progress update delivery',
        })
      }
    },
  }
}

export function createNoopAssistantTurnProgress(): AssistantTurnProgress {
  return {
    async send() {},
  }
}

export function normalizeAssistantProgressText(rawText: string): string | null {
  const withoutMarkdownLinks = rawText.replace(/\[([^\]\n]+)\]\([^)]+\)/gu, '$1')
  const normalized = normalizeNullableString(
    withoutMarkdownLinks.replace(/\s+/gu, ' '),
  )
  if (!normalized) {
    return null
  }
  if (normalized.length <= MAX_PROGRESS_CHARS) {
    return normalized
  }

  return `${normalized.slice(0, MAX_PROGRESS_CHARS - 3).trimEnd()}...`
}
