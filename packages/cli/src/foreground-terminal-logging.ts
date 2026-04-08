import type { AssistantRunEvent } from '@murphai/assistant-engine/assistant-automation'
import type {
  InboxRunEvent,
  RuntimeCaptureRecordInput,
} from '@murphai/inbox-services'
import { normalizeNullableString as normalizeLabel } from '@murphai/operator-config/text/shared'

export type ForegroundLogScope = 'assistant' | 'inbox'

export const UNSAFE_FOREGROUND_LOG_DETAILS_ENV =
  'UNSAFE_FOREGROUND_LOG_DETAILS'

export interface ForegroundTerminalLogOptions {
  unsafeDetails?: boolean
}

export function resolveForegroundTerminalLogOptions(
  env: NodeJS.ProcessEnv = process.env,
): ForegroundTerminalLogOptions {
  return {
    unsafeDetails: parseBooleanEnvFlag(env[UNSAFE_FOREGROUND_LOG_DETAILS_ENV]),
  }
}

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
  options: ForegroundTerminalLogOptions = {},
): string | null {
  if (event.type === 'scan.started') {
    return formatAssistantScanStartedMessage(
      'scanning inbox decisions',
      event.details,
    )
  }

  if (event.type === 'reply.scan.started') {
    return formatAssistantScanStartedMessage(
      'scanning channel auto-reply',
      event.details,
    )
  }

  if (event.type === 'reply.scan.primed') {
    const details = formatAssistantReplyScanPrimedDetails(
      event.details,
      options,
    )
    return details ? `primed channel auto-reply: ${details}` : 'primed channel auto-reply'
  }

  if (event.type === 'capture.routed') {
    const tools = (event.tools ?? []).join(', ')
    return `routed ${event.captureId ?? 'capture'}${tools ? `: ${tools}` : ''}`
  }

  if (event.type === 'capture.reply-started') {
    return formatAssistantEventLine(
      'reply-started',
      event.captureId,
      options.unsafeDetails ? event.details : 'assistant provider turn started',
    )
  }

  if (event.type === 'capture.reply-progress') {
    const details = formatAssistantReplyProgressDetails(event, options)
    return formatAssistantEventLine('reply-progress', event.captureId, details)
  }

  if (event.type === 'capture.replied') {
    return formatAssistantEventLine('replied', event.captureId, options.unsafeDetails ? event.details : null)
  }

  if (event.type === 'daemon.failed') {
    return formatAssistantEventLine(
      'inbox daemon failed',
      undefined,
      event.details ?? null,
    )
  }

  const label = event.type.replace(/^(capture|reply\.scan)\./u, '')
  const details = formatAssistantEventDetails(event, options)
  return formatAssistantEventLine(label, event.captureId, details)
}

export function formatInboxRunEventForTerminal(
  event: InboxRunEvent,
  options: ForegroundTerminalLogOptions = {},
): string | null {
  switch (event.type) {
    case 'connector.backfill.started':
      return `${formatConnectorLabel(event, options)} backfill starting`
    case 'connector.backfill.finished': {
      const imported = event.counts?.imported ?? 0
      const deduped = event.counts?.deduped ?? 0
      return `${formatConnectorLabel(event, options)} backfill finished: ${imported} imported, ${deduped} deduped`
    }
    case 'connector.watch.started':
      return `${formatConnectorLabel(event, options)} watching for new messages`
    case 'connector.failed':
      return formatConnectorEventLine(
        `${formatConnectorLabel(event, options)} ${formatConnectorPhase(event.phase)} failed`,
        options.unsafeDetails ? event.details : null,
      )
    case 'connector.skipped':
      return formatConnectorEventLine(
        `${formatConnectorLabel(event, options)} skipped on this host`,
        options.unsafeDetails ? event.details : null,
      )
    case 'capture.imported':
      return formatImportedCaptureEvent(event, options)
    default:
      return null
  }
}

function formatAssistantScanStartedMessage(
  label: string,
  details: string | null | undefined,
): string | null {
  return captureCountFromDetails(details) === 0
    ? null
    : `${label}: ${details ?? ''}`.trim()
}

function formatConnectorPhase(phase: InboxRunEvent['phase']): string {
  if (phase === 'backfill' || phase === 'startup') {
    return phase
  }

  return 'watch'
}

function formatImportedCapturePhase(
  phase: InboxRunEvent['phase'],
): 'backfill' | 'new' {
  return phase === 'backfill' ? 'backfill' : 'new'
}

function formatConnectorLabel(
  event: Pick<InboxRunEvent, 'connectorId' | 'source'>,
  options: ForegroundTerminalLogOptions,
): string {
  return options.unsafeDetails
    ? `${humanizeSource(event.source)} connector ${event.connectorId}`
    : `${humanizeSource(event.source)} connector`
}

function formatImportedCaptureEvent(
  event: InboxRunEvent,
  options: ForegroundTerminalLogOptions,
): string {
  if (options.unsafeDetails) {
    return formatUnsafeImportedCaptureEvent(event)
  }

  const phase = formatImportedCapturePhase(event.phase)
  const source = humanizeSource(event.source)
  return `${phase} ${source} capture imported: ${summarizeCapturePayload(event.capture)}`
}

function formatUnsafeImportedCaptureEvent(event: InboxRunEvent): string {
  const phase = formatImportedCapturePhase(event.phase)
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

function summarizeCapturePayload(
  capture?: RuntimeCaptureRecordInput,
): string {
  const parts: string[] = []

  if (normalizePreviewText(capture?.text)) {
    parts.push('text')
  }

  const attachmentCount = capture?.attachments?.length ?? 0
  if (attachmentCount > 0) {
    parts.push(
      `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`,
    )
  }

  return parts.length > 0 ? parts.join(' + ') : 'no text or attachments'
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

function normalizePreviewText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function clipTerminalText(
  value: string | null,
  maxLength: number,
): string | null {
  if (!value) {
    return null
  }

  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function humanizeSource(source: string | null | undefined): string {
  switch (source) {
    case 'imessage':
      return 'iMessage'
    case 'telegram':
      return 'Telegram'
    case 'linq':
      return 'Linq'
    case 'agentmail':
      return 'AgentMail'
    default:
      return 'Inbox'
  }
}

function formatConnectorEventLine(
  label: string,
  details: string | null | undefined,
): string {
  const normalizedDetails = normalizePreviewText(details)
  return normalizedDetails ? `${label}: ${normalizedDetails}` : label
}

function formatAssistantEventLine(
  label: string,
  captureId: string | null | undefined,
  details: string | null | undefined,
): string {
  const prefix = captureId ? `${label} ${captureId}` : label
  const normalizedDetails = normalizePreviewText(details)
  return normalizedDetails ? `${prefix}: ${normalizedDetails}` : prefix
}

function formatAssistantEventDetails(
  event: AssistantRunEvent,
  options: ForegroundTerminalLogOptions,
): string | null {
  if (options.unsafeDetails) {
    return normalizePreviewText(event.details)
  }

  if (event.type === 'capture.failed') {
    return 'assistant processing failed'
  }

  if (event.type === 'capture.skipped') {
    return 'assistant processing skipped'
  }

  return null
}

function formatAssistantReplyProgressDetails(
  event: Pick<AssistantRunEvent, 'details'>,
  options: ForegroundTerminalLogOptions,
): string | null {
  if (options.unsafeDetails) {
    return normalizePreviewText(event.details)
  }

  return event.details?.includes('tool')
    ? 'assistant provider turn is using tools'
    : 'assistant provider turn is still running'
}

function formatAssistantReplyScanPrimedDetails(
  details: string | null | undefined,
  options: ForegroundTerminalLogOptions,
): string | null {
  if (!options.unsafeDetails) {
    return null
  }

  return normalizePreviewText(details)
}

function captureCountFromDetails(details: string | null | undefined): number {
  const match = details?.match(/\b(\d+)\s+capture/u)
  return match ? Number.parseInt(match[1] ?? '0', 10) || 0 : 0
}

function parseBooleanEnvFlag(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}
