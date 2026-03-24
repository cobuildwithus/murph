import type { AssistantRunEvent } from './assistant/automation/shared.js'
import type {
  InboxRunEvent,
  RuntimeCaptureRecordInput,
} from './inbox-services.js'

export type ForegroundLogScope = 'assistant' | 'inbox'

export function formatForegroundLogLine(
  scope: ForegroundLogScope,
  message: string,
  now: Date = new Date(),
): string {
  const timestamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')

  return `[${scope} ${timestamp}] ${message}`
}

export function formatAssistantRunEventForTerminal(
  event: AssistantRunEvent,
): string | null {
  if (event.type === 'scan.started') {
    return captureCountFromDetails(event.details) === 0
      ? null
      : `scanning canonical inbox routing: ${event.details ?? ''}`.trim()
  }

  if (event.type === 'reply.scan.started') {
    return captureCountFromDetails(event.details) === 0
      ? null
      : `scanning channel auto-reply: ${event.details ?? ''}`.trim()
  }

  if (event.type === 'reply.scan.primed') {
    return `primed channel auto-reply: ${event.details ?? ''}`.trim()
  }

  if (event.type === 'capture.routed') {
    const tools = (event.tools ?? []).join(', ')
    return `routed ${event.captureId ?? 'capture'}${tools ? `: ${tools}` : ''}`
  }

  if (event.type === 'capture.replied') {
    return `replied ${event.captureId ?? 'capture'}${event.details ? `: ${event.details}` : ''}`
  }

  if (event.type === 'daemon.failed') {
    return `inbox daemon failed${event.details ? `: ${event.details}` : ''}`
  }

  const label = event.type.replace(/^(capture|reply\.scan)\./u, '')
  const suffix = [event.captureId, event.details].filter(Boolean).join(': ')
  return `${label}${suffix ? ` ${suffix}` : ''}`.trim()
}

export function formatInboxRunEventForTerminal(
  event: InboxRunEvent,
): string | null {
  switch (event.type) {
    case 'connector.backfill.started':
      return `${formatConnectorLabel(event)} backfill starting`
    case 'connector.backfill.finished': {
      const imported = event.counts?.imported ?? 0
      const deduped = event.counts?.deduped ?? 0
      return `${formatConnectorLabel(event)} backfill finished: ${imported} imported, ${deduped} deduped`
    }
    case 'connector.watch.started':
      return `${formatConnectorLabel(event)} watching for new messages`
    case 'connector.failed':
      return `${formatConnectorLabel(event)} ${event.phase === 'backfill' ? 'backfill' : 'watch'} failed${event.details ? `: ${event.details}` : ''}`
    case 'capture.imported':
      return formatImportedCaptureEvent(event)
    default:
      return null
  }
}

function formatConnectorLabel(
  event: Pick<InboxRunEvent, 'connectorId' | 'source'>,
): string {
  return `${humanizeSource(event.source)} connector ${event.connectorId}`
}

function formatImportedCaptureEvent(event: InboxRunEvent): string {
  const phase = event.phase === 'backfill' ? 'backfill' : 'new'
  const source = humanizeSource(event.source)
  const capture = event.capture
  const actor = resolveActorLabel(capture)
  const thread = resolveThreadLabel(capture)
  const preview = resolvePreviewLabel(capture)

  const parts = [`${phase} ${source}`]
  if (actor) {
    parts.push(`from ${actor}`)
  }
  if (thread) {
    parts.push(`in ${thread}`)
  }

  return `${parts.join(' ')}: ${preview}`
}

function resolveActorLabel(capture?: RuntimeCaptureRecordInput): string | null {
  const displayName = normalizeLabel(capture?.actor?.displayName)
  if (displayName) {
    return displayName
  }

  const actorId = normalizeLabel(capture?.actor?.id)
  if (actorId) {
    return actorId
  }

  return capture?.actor?.isSelf ? 'you' : null
}

function resolveThreadLabel(capture?: RuntimeCaptureRecordInput): string | null {
  const title = normalizeLabel(capture?.thread?.title)
  if (title) {
    return title
  }

  return normalizeLabel(capture?.thread?.id)
}

function resolvePreviewLabel(capture?: RuntimeCaptureRecordInput): string {
  const text = clipTerminalText(normalizePreviewText(capture?.text), 96)
  const attachmentCount = capture?.attachments?.length ?? 0

  if (text) {
    return attachmentCount > 0
      ? `${text} (+${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'})`
      : text
  }

  if (attachmentCount > 0) {
    return attachmentCount === 1
      ? 'attachment-only message'
      : `${attachmentCount} attachments`
  }

  return 'message with no text preview'
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizePreviewText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function clipTerminalText(value: string | null, maxLength: number): string | null {
  if (value === null || value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`
}

function captureCountFromDetails(details?: string): number | null {
  if (typeof details !== 'string') {
    return null
  }

  const match = details.match(/^(\d+) capture\(s\)$/u)
  if (!match) {
    return null
  }

  return Number.parseInt(match[1] ?? '', 10)
}

function humanizeSource(source: string): string {
  switch (source) {
    case 'imessage':
      return 'iMessage'
    case 'telegram':
      return 'Telegram'
    case 'linq':
      return 'Linq'
    case 'email':
      return 'email'
    default:
      return source
  }
}
