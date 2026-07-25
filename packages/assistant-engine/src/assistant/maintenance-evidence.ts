import {
  assistantConversationHistoryUtf8Bytes,
  compareAssistantTimestampsAscending,
  limitAssistantConversationHistoryTextBytes,
} from './shared.js'
import {
  listAssistantTranscriptTailEntries,
  listAssistantSessions,
} from './store.js'
import {
  ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX,
} from './turn-finalizer.js'

export const ASSISTANT_MAINTENANCE_EVIDENCE_WINDOW_MS =
  7 * 24 * 60 * 60 * 1000
export const ASSISTANT_MAINTENANCE_EVIDENCE_HEADING =
  '## Conversation evidence (engine-supplied, bounded, last 7 days)'
export const ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_HEADING =
  '## Group conversation evidence (engine-supplied, bounded, last 7 days)'

const ASSISTANT_MAINTENANCE_EVIDENCE_MAX_MESSAGES = 400
const ASSISTANT_MAINTENANCE_EVIDENCE_MESSAGE_BYTES = 2_000
const ASSISTANT_MAINTENANCE_EVIDENCE_TOTAL_BYTES = 96_000
const ASSISTANT_MAINTENANCE_EVIDENCE_MAX_SESSIONS = 16
const ASSISTANT_MAINTENANCE_EVIDENCE_TRANSCRIPT_TAIL_BYTES = 262_144

const ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_MAX_MESSAGES = 400
const ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_MESSAGE_BYTES = 32_000
const ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_TOTAL_BYTES = 256_000
const ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_TRANSCRIPT_TAIL_BYTES = 512_000

const ASSISTANT_MAINTENANCE_EVIDENCE_EMPTY_BODY =
  'No committed user or assistant conversation messages were found in this window. Do not write any new memory this run.'
const ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_EMPTY_BODY =
  'No committed group conversation messages were found in this window. Do not create or update the group room model this run.'

interface AssistantMaintenanceEvidenceMessage {
  createdAt: string
  kind: 'assistant' | 'user'
  text: string
}

interface AssistantMaintenanceEvidenceProfile {
  heading: string
  maxMessages: number
  messageBytes: number
  mode: 'group' | 'personal'
  totalBytes: number
  transcriptTailBytes: number
}

const PERSONAL_MAINTENANCE_EVIDENCE_PROFILE = {
  heading: ASSISTANT_MAINTENANCE_EVIDENCE_HEADING,
  maxMessages: ASSISTANT_MAINTENANCE_EVIDENCE_MAX_MESSAGES,
  messageBytes: ASSISTANT_MAINTENANCE_EVIDENCE_MESSAGE_BYTES,
  mode: 'personal',
  totalBytes: ASSISTANT_MAINTENANCE_EVIDENCE_TOTAL_BYTES,
  transcriptTailBytes: ASSISTANT_MAINTENANCE_EVIDENCE_TRANSCRIPT_TAIL_BYTES,
} as const satisfies AssistantMaintenanceEvidenceProfile

const GROUP_MAINTENANCE_EVIDENCE_PROFILE = {
  heading: ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_HEADING,
  maxMessages: ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_MAX_MESSAGES,
  messageBytes: ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_MESSAGE_BYTES,
  mode: 'group',
  totalBytes: ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_TOTAL_BYTES,
  transcriptTailBytes:
    ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_TRANSCRIPT_TAIL_BYTES,
} as const satisfies AssistantMaintenanceEvidenceProfile

// Builds the only conversation evidence a maintenance turn may consult. Hosted
// group runtimes own separate vaults, so an exact non-direct session binding
// selects the group profile without adding a second persisted runtime marker.
export async function buildAssistantMaintenanceConversationEvidence(input: {
  now: Date
  vault: string
}): Promise<string> {
  const since = input.now.getTime() - ASSISTANT_MAINTENANCE_EVIDENCE_WINDOW_MS
  let sessions: Awaited<ReturnType<typeof listAssistantSessions>> = []
  try {
    sessions = await listAssistantSessions(input.vault, {
      limit: ASSISTANT_MAINTENANCE_EVIDENCE_MAX_SESSIONS,
    })
  } catch {
    // Evidence is best-effort. An unreadable session index must produce a safe
    // empty maintenance turn, never broaden the source set.
  }

  const profile = sessions.some(
    (session) => session.binding.threadIsDirect === false,
  )
    ? GROUP_MAINTENANCE_EVIDENCE_PROFILE
    : PERSONAL_MAINTENANCE_EVIDENCE_PROFILE

  let candidates: AssistantMaintenanceEvidenceMessage[]
  try {
    candidates = await collectAssistantMaintenanceEvidenceMessages({
      profile,
      sessions,
      since,
      until: input.now.getTime(),
      vault: input.vault,
    })
  } catch {
    candidates = []
  }

  const selected = selectNewestAssistantMaintenanceEvidenceMessages(
    candidates,
    profile,
  )
  const body = profile.mode === 'group'
    ? renderGroupMaintenanceEvidenceBody({ candidates, profile, selected })
    : renderPersonalMaintenanceEvidenceBody({ profile, selected })

  return `${profile.heading}\n\n${body}`
}

async function collectAssistantMaintenanceEvidenceMessages(input: {
  profile: AssistantMaintenanceEvidenceProfile
  sessions: Awaited<ReturnType<typeof listAssistantSessions>>
  since: number
  until: number
  vault: string
}): Promise<AssistantMaintenanceEvidenceMessage[]> {
  const messages: AssistantMaintenanceEvidenceMessage[] = []

  for (const session of input.sessions) {
    const groupSession = session.binding.threadIsDirect === false
    if (
      (input.profile.mode === 'group' && !groupSession) ||
      (input.profile.mode === 'personal' && groupSession)
    ) {
      continue
    }

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
        { maxBytes: input.profile.transcriptTailBytes },
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
      if (
        input.profile.mode === 'group' &&
        entry.text.startsWith(ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX)
      ) {
        continue
      }

      const normalizedText = input.profile.mode === 'group'
        ? normalizeGroupMaintenanceEvidenceText(entry.text)
        : entry.text.replace(/\s+/gu, ' ').trim()
      const text = limitAssistantConversationHistoryTextBytes(
        normalizedText,
        input.profile.messageBytes,
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

function renderPersonalMaintenanceEvidenceBody(input: {
  profile: AssistantMaintenanceEvidenceProfile
  selected: readonly AssistantMaintenanceEvidenceMessage[]
}): string {
  if (input.selected.length === 0) {
    return ASSISTANT_MAINTENANCE_EVIDENCE_EMPTY_BODY
  }

  return [
    `Engine-selected committed conversation messages (newest kept, up to ${input.profile.maxMessages} messages / ${input.profile.totalBytes} bytes).`,
    '',
    ...input.selected.map(
      (message) => `- [${message.createdAt}] ${message.kind}: ${message.text}`,
    ),
  ].join('\n')
}

function renderGroupMaintenanceEvidenceBody(input: {
  candidates: readonly AssistantMaintenanceEvidenceMessage[]
  profile: AssistantMaintenanceEvidenceProfile
  selected: readonly AssistantMaintenanceEvidenceMessage[]
}): string {
  if (input.selected.length === 0) {
    return ASSISTANT_GROUP_MAINTENANCE_EVIDENCE_EMPTY_BODY
  }

  return [
    'Engine-selected committed group transcript entries:',
    `- selected entries: ${input.selected.length}`,
    `- candidate entries: ${input.candidates.length}`,
    `- truncated: ${input.selected.length < input.candidates.length ? 'true' : 'false'}`,
    `- bounds: newest ${input.profile.maxMessages} entries / ${input.profile.totalBytes} bytes`,
    '',
    ...input.selected.map(
      (message) =>
        `- [${message.createdAt}] ${message.kind}:\n  ${indentGroupMaintenanceEvidenceText(message.text)}`,
    ),
  ].join('\n')
}

function normalizeGroupMaintenanceEvidenceText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim()
}

function indentGroupMaintenanceEvidenceText(value: string): string {
  return value.replace(/\n/gu, '\n  ')
}

function selectNewestAssistantMaintenanceEvidenceMessages(
  candidates: readonly AssistantMaintenanceEvidenceMessage[],
  profile: AssistantMaintenanceEvidenceProfile,
): AssistantMaintenanceEvidenceMessage[] {
  const selected: AssistantMaintenanceEvidenceMessage[] = []
  let totalBytes = 0

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (!candidate || selected.length >= profile.maxMessages) {
      break
    }
    const candidateBytes = assistantConversationHistoryUtf8Bytes(candidate.text)
    if (totalBytes + candidateBytes > profile.totalBytes) {
      break
    }
    totalBytes += candidateBytes
    selected.push(candidate)
  }

  return selected.reverse()
}
