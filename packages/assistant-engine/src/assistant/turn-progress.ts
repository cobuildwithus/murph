import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  deliverAssistantProgressUpdate,
} from './delivery-service.js'
import {
  MAX_PROGRESS_CHARS,
  MAX_PROGRESS_UPDATES_PER_TURN,
} from './progress-constants.js'
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

type DeliverAssistantProgressUpdate = typeof deliverAssistantProgressUpdate

export function createHostedAssistantTurnProgress(input: {
  deliver?: DeliverAssistantProgressUpdate
  messageInput: AssistantMessageInput
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): AssistantTurnProgress {
  const deliver = input.deliver ?? deliverAssistantProgressUpdate
  const sentTexts = new Set<string>()
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

      const ordinal = sentCount
      sentCount += 1
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
