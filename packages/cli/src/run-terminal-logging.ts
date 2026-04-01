import type { AssistantRunEvent } from '@murphai/assistant-core/assistant-automation'
import type {
  InboxRunEvent,
  RuntimeCaptureRecordInput,
} from '@murphai/assistant-core/inbox-services'
import { normalizeNullableString as normalizeLabel } from '@murphai/assistant-core/text/shared'

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
    return captureCountFromDetails(event.details) === 0
      ? null
      : `scanning inbox decisions: ${event.details ?? ''}`.trim()
  }

  if (event.type === 'reply.scan.started') {
    return captureCountFromDetails(event.details) === 0
      ? null
      : `scanning channel auto-reply: ${event.details ?? ''}`.trim()
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
        `${formatConnectorLabel(event, options)} ${
          event.phase === 'backfill'
            ? 'backfill'
            : event.phase === 'startup'
              ? 'startup'
              : 'watch'
        } failed`,
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

  const phase = event.phase === 'backfill' ? 'backfill' : 'new'
  const source = humanizeSource(event.source)
  return `${phase} ${source} capture imported: ${summarizeCapturePayload(event.capture)}`
}

function formatUnsafeImportedCaptureEvent(event: InboxRunEvent): string {
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

function clipTerminalText(value: string | null, maxLength: number): string | null {
  if (value === null || value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`
}

function formatAssistantEventLine(
  label: string,
  captureId?: string,
  details?: string | null,
): string {
  const suffix = [captureId, normalizeLabel(details)].filter(Boolean).join(': ')
  return `${label}${suffix ? ` ${suffix}` : ''}`.trim()
}

function formatAssistantEventDetails(
  event: AssistantRunEvent,
  options: ForegroundTerminalLogOptions,
): string | null {
  const details = normalizeLabel(event.details)
  const safeDetails = normalizeLabel(event.safeDetails)
  if (!details) {
    if (event.type === 'capture.reply-failed') {
      return safeDetails ?? fallbackAssistantReplyFailureDetails(event)
    }
    return null
  }

  if (options.unsafeDetails) {
    return details
  }

  switch (event.type) {
    case 'capture.noop':
    case 'capture.skipped':
      return isSafeAssistantDetail(details) ? details : null
    case 'capture.reply-skipped':
      if (isSafeAssistantDetail(details)) {
        return details
      }

      return details.endsWith(
        'Will retry this capture after the provider reconnects.',
      )
        ? 'waiting for provider reconnect'
        : null
    case 'capture.reply-failed':
      return safeDetails ?? fallbackAssistantReplyFailureDetails(event)
    default:
      return null
  }
}

function formatAssistantReplyProgressDetails(
  event: AssistantRunEvent,
  options: ForegroundTerminalLogOptions,
): string | null {
  const details = normalizeLabel(event.details)
  if (options.unsafeDetails && details) {
    return details
  }

  switch (event.providerKind) {
    case 'command':
      return event.providerState === 'completed'
        ? 'assistant command finished'
        : 'running assistant command'
    case 'file':
      return event.providerState === 'completed'
        ? 'file update finished'
        : 'updating files'
    case 'plan':
      return event.providerState === 'completed'
        ? 'plan updated'
        : 'updating plan'
    case 'reasoning':
      return event.providerState === 'completed'
        ? 'thinking step completed'
        : 'thinking'
    case 'search':
      return event.providerState === 'completed'
        ? 'web search finished'
        : 'searching the web'
    case 'status':
      if (details && isSafeAssistantReplyStatusDetail(details)) {
        return details
      }
      return event.providerState === 'completed'
        ? 'assistant status updated'
        : 'waiting on assistant provider'
    case 'tool':
      return event.providerState === 'completed'
        ? 'assistant tool finished'
        : 'using assistant tool'
    default:
      return details
  }
}

function formatAssistantReplyScanPrimedDetails(
  details: string | undefined,
  options: ForegroundTerminalLogOptions,
): string | null {
  const normalized = normalizeLabel(details)
  if (!normalized) {
    return null
  }

  if (options.unsafeDetails) {
    return normalized
  }

  if (
    normalized ===
    'no existing captures yet; auto-reply will start with the next inbound message'
  ) {
    return normalized
  }

  if (
    normalized.startsWith('processing existing ') &&
    normalized.endsWith(
      ' backlog before switching to new inbound messages',
    )
  ) {
    return normalized
  }

  if (normalized.startsWith('starting after ')) {
    return 'starting after latest existing capture'
  }

  return null
}

function formatConnectorEventLine(
  message: string,
  details?: string | null,
): string {
  const suffix = normalizeLabel(details)
  return suffix ? `${message}: ${suffix}` : message
}

function isSafeAssistantDetail(details: string): boolean {
  return SAFE_ASSISTANT_DETAILS.has(details)
}

function isSafeAssistantReplyStatusDetail(details: string): boolean {
  return (
    details.startsWith('assistant still running after ') ||
    details.startsWith('assistant provider stalled after ')
  )
}

function fallbackAssistantReplyFailureDetails(
  event: Pick<AssistantRunEvent, 'errorCode'>,
): string | null {
  return event.errorCode ? `assistant reply failed (${event.errorCode})` : null
}

const SAFE_ASSISTANT_DETAILS = new Set([
  'assistant result already exists',
  'assistant reply already exists',
  'assistant provider stalled without progress; will retry this capture.',
  'capture already promoted',
  'capture has no text or parsed attachment content',
  'capture is self-authored',
  'capture matches a recent assistant delivery',
  'channel not enabled for assistant auto-reply',
  'Email auto-reply only runs for direct threads',
  'Linq auto-reply only runs for direct chats',
  'model chose no canonical writes',
  'Telegram auto-reply only runs for direct chats',
  'waiting for parser completion',
])

function parseBooleanEnvFlag(value: string | undefined): boolean {
  if (typeof value !== 'string') {
    return false
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'on':
    case 'true':
    case 'yes':
      return true
    default:
      return false
  }
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
