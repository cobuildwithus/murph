import {
  assistantConversationHistoryUtf8Bytes,
  limitAssistantConversationHistoryTextBytes,
} from './codex-turn/planning.js'
import { compareAssistantTimestampsAscending } from './shared.js'
import {
  listAssistantTranscriptTailEntries,
  listRecentAssistantSessions,
} from './store.js'

export const ASSISTANT_MAINTENANCE_EVIDENCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const ASSISTANT_MAINTENANCE_EVIDENCE_HEADING =
  '## Conversation evidence (engine-supplied, bounded, last 7 days)'

const ASSISTANT_MAINTENANCE_EVIDENCE_MAX_MESSAGES = 400
const ASSISTANT_MAINTENANCE_EVIDENCE_MESSAGE_BYTES = 2_000
const ASSISTANT_MAINTENANCE_EVIDENCE_TOTAL_BYTES = 96_000
// Read bounds, distinct from the prompt-size caps above: at most this many
// session records are parsed (newest by mtime) and at most this many bytes
// are read from the end of each committed transcript.
const ASSISTANT_MAINTENANCE_EVIDENCE_MAX_SESSIONS = 16
const ASSISTANT_MAINTENANCE_EVIDENCE_TRANSCRIPT_TAIL_BYTES = 262_144

const ASSISTANT_MAINTENANCE_EVIDENCE_EMPTY_BODY =
  'No committed user or assistant conversation messages were found in this window. Do not write any new memory this run.'

interface AssistantMaintenanceEvidenceMessage {
  createdAt: string
  kind: 'assistant' | 'user'
  text: string
}

// Builds the only conversation evidence a maintenance turn may consult:
// committed user/assistant transcript messages from the trailing window,
// bounded by explicit message and byte caps (newest kept when over budget).
// The prompt-side contract in the overnight memory consolidation seed
// requires the model to use exactly this section instead of discovering
// transcript storage itself.
export async function buildAssistantMaintenanceConversationEvidence(input: {
  now: Date
  vault: string
}): Promise<string> {
  const since = input.now.getTime() - ASSISTANT_MAINTENANCE_EVIDENCE_WINDOW_MS
  let candidates: AssistantMaintenanceEvidenceMessage[]
  try {
    candidates = await collectAssistantMaintenanceEvidenceMessages({
      since,
      until: input.now.getTime(),
      vault: input.vault,
    })
  } catch {
    candidates = []
  }

  const selected = selectNewestAssistantMaintenanceEvidenceMessages(candidates)
  const body = selected.length === 0
    ? ASSISTANT_MAINTENANCE_EVIDENCE_EMPTY_BODY
    : [
        `Engine-selected committed conversation messages (newest kept, up to ${ASSISTANT_MAINTENANCE_EVIDENCE_MAX_MESSAGES} messages / ${ASSISTANT_MAINTENANCE_EVIDENCE_TOTAL_BYTES} bytes).`,
        '',
        ...selected.map(
          (message) => `- [${message.createdAt}] ${message.kind}: ${message.text}`,
        ),
      ].join('\n')

  return `${ASSISTANT_MAINTENANCE_EVIDENCE_HEADING}\n\n${body}`
}

async function collectAssistantMaintenanceEvidenceMessages(input: {
  since: number
  until: number
  vault: string
}): Promise<AssistantMaintenanceEvidenceMessage[]> {
  const sessions = await listRecentAssistantSessions(input.vault, {
    limit: ASSISTANT_MAINTENANCE_EVIDENCE_MAX_SESSIONS,
  })
  const messages: AssistantMaintenanceEvidenceMessage[] = []

  for (const session of sessions) {
    const lastActivityAt = Date.parse(
      session.lastTurnAt ?? session.updatedAt ?? '',
    )
    if (Number.isNaN(lastActivityAt) || lastActivityAt < input.since) {
      continue
    }

    let entries: Awaited<ReturnType<typeof listAssistantTranscriptTailEntries>>
    try {
      entries = await listAssistantTranscriptTailEntries(
        input.vault,
        session.sessionId,
        { maxBytes: ASSISTANT_MAINTENANCE_EVIDENCE_TRANSCRIPT_TAIL_BYTES },
      )
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.kind !== 'assistant' && entry.kind !== 'user') {
        continue
      }
      const createdAt = Date.parse(entry.createdAt)
      if (
        Number.isNaN(createdAt) ||
        createdAt < input.since ||
        createdAt > input.until
      ) {
        continue
      }
      const text = limitAssistantConversationHistoryTextBytes(
        entry.text.replace(/\s+/gu, ' ').trim(),
        ASSISTANT_MAINTENANCE_EVIDENCE_MESSAGE_BYTES,
      )
      if (!text) {
        continue
      }
      messages.push({
        createdAt: entry.createdAt,
        kind: entry.kind,
        text,
      })
    }
  }

  return messages.sort((left, right) =>
    compareAssistantTimestampsAscending(left.createdAt, right.createdAt),
  )
}

function selectNewestAssistantMaintenanceEvidenceMessages(
  candidates: readonly AssistantMaintenanceEvidenceMessage[],
): AssistantMaintenanceEvidenceMessage[] {
  const selected: AssistantMaintenanceEvidenceMessage[] = []
  let totalBytes = 0

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (!candidate || selected.length >= ASSISTANT_MAINTENANCE_EVIDENCE_MAX_MESSAGES) {
      break
    }
    const candidateBytes = assistantConversationHistoryUtf8Bytes(candidate.text)
    if (totalBytes + candidateBytes > ASSISTANT_MAINTENANCE_EVIDENCE_TOTAL_BYTES) {
      break
    }
    totalBytes += candidateBytes
    selected.push(candidate)
  }

  return selected.reverse()
}
