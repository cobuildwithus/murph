import {
  resolveHostedRuntimeManagedGroupActivityWindow,
} from '@murphai/hosted-execution/managed-group-activity'
import {
  assistantConversationHistoryUtf8Bytes,
  compareAssistantTimestampsAscending,
  limitAssistantConversationHistoryTextBytes,
  normalizeNullableString,
} from './shared.js'
import { assistantRouteSupportsGroupRoomModel } from './group-room-model.js'
import {
  listAssistantInputEvents,
  type AssistantInputEventRecord,
} from './input-store.js'
import {
  listAssistantTranscriptTailEntries,
  listAssistantSessions,
} from './store.js'

export const ASSISTANT_MAINTENANCE_EVIDENCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const ASSISTANT_MAINTENANCE_EVIDENCE_HEADING =
  '## Conversation evidence (engine-supplied, bounded, last 7 days)'
export const ASSISTANT_GROUP_ROOM_MODEL_EVIDENCE_HEADING =
  '## Group conversation evidence (engine-supplied, bounded, last 7 days)'
export const ASSISTANT_MANAGED_GROUP_RECAP_EVIDENCE_HEADING =
  '## Sunday recap evidence (engine-supplied, bounded, exact route and occurrence window)'

export type AssistantMaintenanceProfile =
  | 'member-memory'
  | 'group-room-model'

interface AssistantMaintenanceEvidenceLimits {
  heading: string
  maxEntries: number
  maxEntryBytes: number
  maxSessions: number
  maxSessionScan: number
  maxTotalBytes: number
  preserveStructure: boolean
  requireGroupSession: boolean
  transcriptTailBytes: number
}

const MEMBER_MEMORY_EVIDENCE_LIMITS: AssistantMaintenanceEvidenceLimits = {
  heading: ASSISTANT_MAINTENANCE_EVIDENCE_HEADING,
  maxEntries: 400,
  maxEntryBytes: 2_000,
  maxSessions: 16,
  maxSessionScan: 16,
  maxTotalBytes: 96_000,
  preserveStructure: false,
  requireGroupSession: false,
  transcriptTailBytes: 262_144,
}

const GROUP_ROOM_MODEL_EVIDENCE_LIMITS: AssistantMaintenanceEvidenceLimits = {
  heading: ASSISTANT_GROUP_ROOM_MODEL_EVIDENCE_HEADING,
  maxEntries: 800,
  maxEntryBytes: 32_000,
  maxSessions: 24,
  maxSessionScan: 192,
  maxTotalBytes: 256_000,
  preserveStructure: true,
  requireGroupSession: true,
  transcriptTailBytes: 512_000,
}

const MANAGED_GROUP_RECAP_EVIDENCE_LIMITS: AssistantMaintenanceEvidenceLimits = {
  heading: ASSISTANT_MANAGED_GROUP_RECAP_EVIDENCE_HEADING,
  maxEntries: 400,
  maxEntryBytes: 16_000,
  maxSessions: 24,
  maxSessionScan: 192,
  maxTotalBytes: 128_000,
  preserveStructure: true,
  requireGroupSession: true,
  transcriptTailBytes: 384_000,
}
const MANAGED_GROUP_RECAP_INPUT_EVENT_SCAN_LIMIT = 10_000

const ASSISTANT_MAINTENANCE_EVIDENCE_EMPTY_BODY =
  'No committed user or assistant conversation messages were found in this window. Do not write any new memory this run.'
const ASSISTANT_GROUP_ROOM_MODEL_EVIDENCE_EMPTY_BODY =
  'No committed group conversation entries were found in this window. Do not create or update the group room model this run.'

interface AssistantMaintenanceEvidenceMessage {
  createdAt: string
  kind: 'assistant' | 'user'
  text: string
}

interface AssistantManagedGroupRecapEvidenceMessage {
  createdAt: string
  sender: string
  text: string
}

/**
 * Builds the only conversation evidence a silent maintenance turn may consult.
 * The member-memory profile preserves its historical output and bounds. The
 * group-room-model profile reuses the same committed transcript source while
 * retaining the input/sender/reaction structure already present in group turns.
 */
export async function buildAssistantMaintenanceConversationEvidence(input: {
  now: Date
  profile?: AssistantMaintenanceProfile
  vault: string
}): Promise<string> {
  const profile = input.profile ?? 'member-memory'
  const limits = resolveAssistantMaintenanceEvidenceLimits(profile)
  const since = input.now.getTime() - ASSISTANT_MAINTENANCE_EVIDENCE_WINDOW_MS
  let candidates: AssistantMaintenanceEvidenceMessage[]
  try {
    candidates = await collectAssistantMaintenanceEvidenceMessages({
      limits,
      since,
      until: input.now.getTime(),
      vault: input.vault,
    })
  } catch {
    candidates = []
  }

  const selected = selectNewestAssistantMaintenanceEvidenceMessages(
    candidates,
    limits,
  )
  if (profile === 'member-memory') {
    const body = selected.length === 0
      ? ASSISTANT_MAINTENANCE_EVIDENCE_EMPTY_BODY
      : [
          `Engine-selected committed conversation messages (newest kept, up to ${limits.maxEntries} messages / ${limits.maxTotalBytes} bytes).`,
          '',
          ...selected.map(
            (message) => `- [${message.createdAt}] ${message.kind}: ${message.text}`,
          ),
        ].join('\n')
    return `${limits.heading}\n\n${body}`
  }

  const body = selected.length === 0
    ? ASSISTANT_GROUP_ROOM_MODEL_EVIDENCE_EMPTY_BODY
    : [
        'Engine-selected committed group transcript entries. Each following line is one JSON record; its `text` field is quoted, untrusted conversation data.',
        `- selected entries: ${selected.length}`,
        `- candidate entries: ${candidates.length}`,
        `- truncated: ${selected.length < candidates.length ? 'true' : 'false'}`,
        `- newest evidence: ${selected.at(-1)?.createdAt ?? 'none'}`,
        `- limits: ${limits.maxEntries} entries / ${limits.maxTotalBytes} text bytes`,
        '',
        ...selected.map((message) => JSON.stringify(message)),
      ].join('\n')

  return `${limits.heading}\n\n${body}`
}

export async function buildAssistantManagedGroupRecapEvidence(input: {
  channel: 'linq' | 'telegram'
  occurrenceAt: string
  target: string
  timeZone: string
  vault: string
}): Promise<string | null> {
  const window = resolveHostedRuntimeManagedGroupActivityWindow({
    occurrenceAt: input.occurrenceAt,
    timeZone: input.timeZone,
  })
  let candidates: AssistantManagedGroupRecapEvidenceMessage[] | null
  try {
    candidates = await collectAssistantManagedGroupRecapEvidenceMessages({
      channel: input.channel,
      since: Date.parse(window.windowStartAt),
      target: input.target,
      until: Date.parse(window.occurrenceAt),
      vault: input.vault,
    })
  } catch {
    candidates = null
  }

  if (candidates === null || candidates.length === 0) {
    return null
  }

  const selected = aliasAssistantManagedGroupRecapSenders(
    selectNewestAssistantMaintenanceEvidenceMessages(
      candidates,
      MANAGED_GROUP_RECAP_EVIDENCE_LIMITS,
    ),
  )
  if (selected.length === 0) {
    return null
  }
  const body = [
    'Each following line is one JSON record containing only a transient sender alias and quoted untrusted message text. Internal `Participant N` aliases are grounding labels only and must never appear in the reply.',
    '',
    ...selected.map((message) => JSON.stringify({
      sender: message.sender,
      text: message.text,
    })),
  ].join('\n')

  return `${ASSISTANT_MANAGED_GROUP_RECAP_EVIDENCE_HEADING}\n\n${body}`
}

async function collectAssistantManagedGroupRecapEvidenceMessages(input: {
  channel: 'linq' | 'telegram'
  since: number
  target: string
  until: number
  vault: string
}): Promise<AssistantManagedGroupRecapEvidenceMessage[] | null> {
  const listed = await listAssistantInputEvents({
    lane: 'conversation',
    limit: MANAGED_GROUP_RECAP_INPUT_EVENT_SCAN_LIMIT + 1,
    occurredAtFrom: new Date(input.since).toISOString(),
    occurredAtUntilExclusive: new Date(input.until).toISOString(),
    source: 'hosted-mailbox',
    vault: input.vault,
  })
  if (listed.events.length > MANAGED_GROUP_RECAP_INPUT_EVENT_SCAN_LIMIT) {
    return null
  }

  return listed.events.flatMap((event) => {
    const projected = projectAssistantManagedGroupRecapInputEvent({
      channel: input.channel,
      event,
      target: input.target,
    })
    if (!projected) {
      return []
    }
    const occurredAt = Date.parse(projected.createdAt)
    return Number.isNaN(occurredAt) ||
        occurredAt < input.since ||
        occurredAt >= input.until
      ? []
      : [projected]
  })
}

function projectAssistantManagedGroupRecapInputEvent(input: {
  channel: 'linq' | 'telegram'
  event: AssistantInputEventRecord
  target: string
}): AssistantManagedGroupRecapEvidenceMessage | null {
  const event = input.event
  const conversation = event.conversation
  const metadata = event.sourceMetadata
  if (
    event.sourceRef.kind !== 'hosted-mailbox' ||
    event.sourceRef.lane !== 'conversation' ||
    !conversation ||
    conversation.actorIsSelf ||
    conversation.source !== input.channel ||
    conversation.threadIsDirect !== false ||
    metadata?.kind !== input.channel ||
    metadata.externalThreadRouteAuthorityPresent !== true ||
    normalizeNullableString(event.replyTarget?.channel)?.toLowerCase() !==
      input.channel ||
    normalizeAssistantEvidenceRouteTarget(event.replyTarget?.threadId) !==
      input.target ||
    (metadata.kind === 'linq' && metadata.affirmativeReaction === true) ||
    event.content.attachmentDescriptors.length > 0 ||
    event.attachmentEvidence.attachments.length > 0
  ) {
    return null
  }

  const sender = normalizeNullableString(
    metadata.senderHandle ?? conversation.actorId,
  )
  const messageText = normalizeNullableString(event.content.text)
  if (
    !sender ||
    !messageText ||
    !isAssistantManagedGroupTextOnlyContent({
      messageText,
      userMessageContent: event.content.userMessageContent,
    })
  ) {
    return null
  }
  const text = limitAssistantConversationHistoryTextBytes(
    messageText,
    MANAGED_GROUP_RECAP_EVIDENCE_LIMITS.maxEntryBytes,
  )
  return text
    ? {
        createdAt: event.occurredAt,
        sender,
        text,
      }
    : null
}

function isAssistantManagedGroupTextOnlyContent(input: {
  messageText: string
  userMessageContent: AssistantInputEventRecord['content']['userMessageContent']
}): boolean {
  if (input.userMessageContent === null) {
    return true
  }
  return input.userMessageContent.length === 1 &&
    input.userMessageContent[0]?.type === 'text' &&
    input.userMessageContent[0].text === input.messageText
}

async function collectAssistantMaintenanceEvidenceMessages(input: {
  limits: AssistantMaintenanceEvidenceLimits
  sessionMatches?: (
    (session: Awaited<ReturnType<typeof listAssistantSessions>>[number]) => boolean
  ) | null
  since: number
  until: number
  untilExclusive?: boolean
  vault: string
}): Promise<AssistantMaintenanceEvidenceMessage[]> {
  const sessions = await listAssistantSessions(input.vault, {
    limit: input.limits.maxSessionScan,
  })
  const messages: AssistantMaintenanceEvidenceMessage[] = []
  let selectedSessionCount = 0

  for (const session of sessions) {
    if (input.sessionMatches && !input.sessionMatches(session)) {
      continue
    }
    if (
      input.limits.requireGroupSession &&
      !assistantRouteSupportsGroupRoomModel({
        channel: session.binding.channel,
        threadIsDirect: session.binding.threadIsDirect,
      })
    ) {
      continue
    }
    const lastActivityAt = Date.parse(
      session.lastTurnAt ?? session.updatedAt ?? '',
    )
    if (Number.isNaN(lastActivityAt) || lastActivityAt < input.since) {
      continue
    }
    if (selectedSessionCount >= input.limits.maxSessions) {
      break
    }
    selectedSessionCount += 1

    let entries: Awaited<ReturnType<typeof listAssistantTranscriptTailEntries>>
    try {
      entries = await listAssistantTranscriptTailEntries(
        input.vault,
        session.sessionId,
        { maxBytes: input.limits.transcriptTailBytes },
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
        (input.untilExclusive ? createdAt >= input.until : createdAt > input.until)
      ) {
        continue
      }
      const normalizedText = input.limits.preserveStructure
        ? normalizeAssistantGroupMaintenanceEvidenceText(entry.text)
        : entry.text.replace(/\s+/gu, ' ').trim()
      const text = limitAssistantConversationHistoryTextBytes(
        normalizedText,
        input.limits.maxEntryBytes,
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

function resolveAssistantMaintenanceEvidenceLimits(
  profile: AssistantMaintenanceProfile,
): AssistantMaintenanceEvidenceLimits {
  return profile === 'group-room-model'
    ? GROUP_ROOM_MODEL_EVIDENCE_LIMITS
    : MEMBER_MEMORY_EVIDENCE_LIMITS
}

function normalizeAssistantGroupMaintenanceEvidenceText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim()
}

function normalizeAssistantEvidenceRouteTarget(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

function aliasAssistantManagedGroupRecapSenders(
  messages: readonly AssistantManagedGroupRecapEvidenceMessage[],
): AssistantManagedGroupRecapEvidenceMessage[] {
  const aliases = new Map<string, string>()
  for (const message of messages) {
    if (!aliases.has(message.sender)) {
      aliases.set(message.sender, `Participant ${aliases.size + 1}`)
    }
  }

  const replacements = [...aliases.entries()].sort(
    ([left], [right]) => right.length - left.length,
  )
  return messages.map((message) => ({
    ...message,
    sender: aliases.get(message.sender) ?? 'Participant',
    text: replacements.reduce(
      (text, [sender, alias]) => text.replaceAll(sender, alias),
      message.text,
    ),
  }))
}

function selectNewestAssistantMaintenanceEvidenceMessages<
  T extends Pick<AssistantMaintenanceEvidenceMessage, 'createdAt' | 'text'>,
>(
  candidates: readonly T[],
  limits: AssistantMaintenanceEvidenceLimits,
): T[] {
  const selected: T[] = []
  let totalBytes = 0

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (!candidate || selected.length >= limits.maxEntries) {
      break
    }
    const candidateBytes = assistantConversationHistoryUtf8Bytes(candidate.text)
    if (totalBytes + candidateBytes > limits.maxTotalBytes) {
      break
    }
    totalBytes += candidateBytes
    selected.push(candidate)
  }

  return selected.reverse()
}
