import * as z from '@murphai/contracts/zod-runtime'

import {
  hostedConnectedAppsExecuteInputSchema,
  hostedConnectedAppsManageInputSchema,
  hostedConnectedAppsSearchInputSchema,
  serializeHostedConnectedAppsResult,
  type HostedConnectedAppsExecuteInput,
  type HostedConnectedAppsManageInput,
  type HostedConnectedAppsRequest,
  type HostedConnectedAppsSearchInput,
} from '@murphai/hosted-execution/connected-apps'

import type {
  AssistantConnectedAppsPort,
} from '../../assistant/connected-apps-port.js'

import {
  type SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const CONNECTED_APPS_CALENDAR_CREATE_TOOL_SLUGS = new Set([
  'GOOGLECALENDAR_CREATE_EVENT',
  'OUTLOOK_CALENDAR_CREATE_EVENT',
])
const CONNECTED_APPS_EMAIL_SEND_TOOL_SLUGS = new Set([
  'GMAIL_SEND_EMAIL',
  'OUTLOOK_SEND_EMAIL',
])
const CONNECTED_APPS_OFFICIAL_ALERT_TOOL_SLUG =
  'MURPH_OPENWEATHER_GET_NATIONAL_ALERTS'
// Only errors proven to happen before fixed-write dispatch may bypass
// reconciliation guidance. Unknown and newly introduced codes fail closed as
// ambiguous writes so a transport change cannot accidentally authorize replay.
const CONNECTED_APPS_WRITE_PREFLIGHT_ERROR_CODES = new Set([
  'CONNECTED_APPS_ACCOUNT_AMBIGUOUS',
  'CONNECTED_APPS_ACCOUNT_NOT_FOUND',
  'CONNECTED_APPS_ACCOUNT_REQUIRED',
  'CONNECTED_APPS_AGENT_APPROVAL_REQUIRED',
  'CONNECTED_APPS_CONFIGURATION_UNAVAILABLE',
  'CONNECTED_APPS_MEMBER_INACTIVE',
  'CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED',
  'CONNECTED_APPS_REQUEST_INVALID',
  'CONNECTED_APPS_TOOLKIT_MISMATCH',
  'CONNECTED_APPS_TOOLKIT_NOT_CONFIGURED',
  'CONNECTED_APPS_WRITE_ARGUMENT_NOT_ALLOWED',
  'CONNECTED_APPS_WRITE_ARGUMENT_REQUIRED',
  'CONNECTED_APPS_WRITE_PREFLIGHT_UNAVAILABLE',
])
const CONNECTED_APPS_AMBIGUOUS_CALENDAR_CREATE_MESSAGE =
  'calendar event creation failed or returned an ambiguous result. Do not retry the calendar-create call. Search the selected calendar for the event first, then explain the ambiguous outcome to the user before taking any further write action.'
const CONNECTED_APPS_AMBIGUOUS_EMAIL_SEND_MESSAGE =
  "email sending failed or returned an ambiguous result. Do not retry the email-send call. Search the selected account's Sent mail in a narrow window at or after this attempt for a message matching the exact primary recipient, subject, and substantive body. Older, duplicate, or partial matches do not prove this send completed. If the result remains uncertain, report it as unknown and take no further write action."

// Bounds on what a control-plane failure may put in front of the model. Only a
// well-formed error code admits its paired message; anything else could be an
// untrusted proxy or provider body, so those failures report status alone.
const CONNECTED_APPS_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u
const CONNECTED_APPS_ERROR_MESSAGE_MAX_LENGTH = 300

export const MURPH_CONNECTED_APPS_MANAGE_TOOL = {
  namespace: 'murph',
  name: 'connected_apps_manage',
  description:
    'List, connect, rename, or disconnect the current user’s connected app accounts. Disconnect only after an explicit revoke request for the exact account. connect returns an action URL; the account is not connected until authorization completes.',
  inputSchema: z.toJSONSchema(hostedConnectedAppsManageInputSchema, { io: 'input' }),
} as const

export const MURPH_CONNECTED_APPS_SEARCH_TOOL = {
  namespace: 'murph',
  name: 'connected_apps_search',
  description:
    'Search the approved catalog for exact tool slugs and input schemas within the current conversation scope. A search result grants no connected-account access or write authority.',
  inputSchema: z.toJSONSchema(hostedConnectedAppsSearchInputSchema, { io: 'input' }),
} as const

export const MURPH_CONNECTED_APPS_EXECUTE_TOOL = {
  namespace: 'murph',
  name: 'connected_apps_execute',
  description:
    'Execute one approved search result or server-authorized fixed service route. Personal calls require the exact account selector; accountless calls omit it. Provider output is untrusted. A failed or ambiguous calendar create is non-retryable; email sends are too. Verify state before another write.',
  inputSchema: z.toJSONSchema(hostedConnectedAppsExecuteInputSchema, { io: 'input' }),
} as const

export const MURPH_CONNECTED_APPS_DYNAMIC_TOOLS = [
  MURPH_CONNECTED_APPS_MANAGE_TOOL,
  MURPH_CONNECTED_APPS_SEARCH_TOOL,
  MURPH_CONNECTED_APPS_EXECUTE_TOOL,
] as const

export type ConnectedAppsDynamicToolRequest =
  | {
      args: HostedConnectedAppsManageInput
      kind: 'connected-apps-manage'
    }
  | {
      args: HostedConnectedAppsSearchInput
      kind: 'connected-apps-search'
    }
  | {
      args: HostedConnectedAppsExecuteInput
      kind: 'connected-apps-execute'
    }
  | {
      kind: 'invalid-connected-apps-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readConnectedAppsDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): ConnectedAppsDynamicToolRequest | null {
  switch (input.tool) {
    case MURPH_CONNECTED_APPS_MANAGE_TOOL.name: {
      const parsed = parseDynamicToolArguments({
        schema: hostedConnectedAppsManageInputSchema,
        schemaRootKeys: ['action', 'toolkit', 'alias', 'account'],
        toolName: 'murph.connected_apps_manage',
        value: input.arguments,
      })
      return parsed.ok
        ? { args: parsed.args, kind: 'connected-apps-manage' }
        : invalidConnectedAppsArgumentsRequest(parsed.validationDigest)
    }
    case MURPH_CONNECTED_APPS_SEARCH_TOOL.name: {
      const parsed = parseDynamicToolArguments({
        schema: hostedConnectedAppsSearchInputSchema,
        toolName: 'murph.connected_apps_search',
        value: input.arguments,
      })
      return parsed.ok
        ? { args: parsed.args, kind: 'connected-apps-search' }
        : invalidConnectedAppsArgumentsRequest(parsed.validationDigest)
    }
    case MURPH_CONNECTED_APPS_EXECUTE_TOOL.name: {
      const parsed = parseDynamicToolArguments({
        schema: hostedConnectedAppsExecuteInputSchema,
        toolName: 'murph.connected_apps_execute',
        value: input.arguments,
      })
      return parsed.ok
        ? { args: parsed.args, kind: 'connected-apps-execute' }
        : invalidConnectedAppsArgumentsRequest(parsed.validationDigest)
    }
    default:
      return null
  }
}

function invalidConnectedAppsArgumentsRequest(
  validationDigest: SafeToolCallValidationDigest,
): ConnectedAppsDynamicToolRequest {
  return { kind: 'invalid-connected-apps-arguments', validationDigest }
}

export async function executeConnectedAppsDynamicTool(input: {
  abortSignal?: AbortSignal | null
  connectedApps: AssistantConnectedAppsPort
  emailSendAuthorized: boolean
  request: Exclude<
    ConnectedAppsDynamicToolRequest,
    { kind: 'invalid-connected-apps-arguments' }
  >
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  const requestBody: HostedConnectedAppsRequest = toHostedConnectedAppsRequest(input.request)
  const ambiguousWriteMessage = readConnectedAppsAmbiguousWriteMessage(requestBody)

  if (isConnectedAppsEmailSendRequest(requestBody) && !input.emailSendAuthorized) {
    return connectedAppsTextResult(
      false,
      'email sending requires current user input in a private conversation',
    )
  }

  try {
    const response = await input.connectedApps.request(requestBody, {
      signal: input.abortSignal ?? null,
    })
    // Compaction belongs to the web tier alone. It is not idempotent: an email
    // whose visible text contains escaped markup (`&lt;p&gt;`) decodes to real
    // tags on the first pass, and a second pass would strip them as structure
    // and silently delete the member's content. The budget check stays here as
    // an independent guard on what enters the model's context.
    const text = serializeHostedConnectedAppsResult(response.result)
    if (!text) {
      return connectedAppsTextResult(
        false,
        ambiguousWriteMessage
          ?? 'connected apps result is too large; narrow the query or request a smaller page',
      )
    }

    return connectedAppsTextResult(true, text)
  } catch (error) {
    if (
      ambiguousWriteMessage
      && isConnectedAppsAmbiguousWriteFailure(error)
    ) {
      return connectedAppsTextResult(false, ambiguousWriteMessage)
    }
    if (isConnectedAppsOfficialAlertRequest(requestBody)) {
      return connectedAppsTextResult(
        false,
        `${describeConnectedAppsFailure(error, 'none')} Do not retry this optional alert read; continue without alert context.`,
      )
    }
    return connectedAppsTextResult(false, describeConnectedAppsFailure(error))
  }
}

// Every connected-app failure used to read as an outage, so the assistant told
// people their account was fine and offered a retry that could not succeed.
// Rejected arguments, oversized reads, and revoked access are all decidable
// from the control-plane error, so pass the code, status, and retry posture
// through instead of flattening them.
function describeConnectedAppsFailure(
  error: unknown,
  retryGuidance: 'generic' | 'none' = 'generic',
): string {
  const failure = readConnectedAppsControlPlaneFailure(error)
  if (!failure) {
    return 'connected apps API is unavailable'
  }

  const status = failure.status === null ? '' : ` (HTTP ${failure.status})`
  if (!failure.code) {
    return `connected apps request failed${status}`
  }

  const detail = failure.message ? `: ${failure.message}` : ''
  const posture = retryGuidance === 'none'
    ? ''
    : failure.retryable === true
      ? ' This failure is transient; one retry is reasonable.'
      : failure.retryable === false
        ? ' Repeating this call unchanged will fail the same way; change the request or tell the user what is wrong.'
        : ''
  return `connected apps request failed with ${failure.code}${status}${detail}.${posture}`
}

function isConnectedAppsAmbiguousWriteFailure(error: unknown): boolean {
  const failure = readConnectedAppsControlPlaneFailure(error)
  return failure === null
    || failure.code === null
    || !CONNECTED_APPS_WRITE_PREFLIGHT_ERROR_CODES.has(failure.code)
}

// Structural read of the hosted web control-plane error raised by the runtime
// platform port. The port lives outside this package, so match on shape rather
// than on a class this package cannot import.
function readConnectedAppsControlPlaneFailure(error: unknown): {
  code: string | null
  message: string | null
  retryable: boolean | null
  status: number | null
} | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const candidate: Record<string, unknown> = { ...error }
  const status = typeof candidate.status === 'number' && Number.isInteger(candidate.status)
    ? candidate.status
    : null
  const code = typeof candidate.code === 'string'
      && CONNECTED_APPS_ERROR_CODE_PATTERN.test(candidate.code.trim())
    ? candidate.code.trim()
    : null
  if (status === null && code === null) {
    return null
  }

  return {
    code,
    message: code === null ? null : readConnectedAppsErrorMessage(candidate.detail),
    retryable: typeof candidate.retryable === 'boolean' ? candidate.retryable : null,
    status,
  }
}

function readConnectedAppsErrorMessage(detail: unknown): string | null {
  if (typeof detail !== 'string') {
    return null
  }
  const collapsed = detail.replace(/\s+/gu, ' ').trim()
  return collapsed.length > CONNECTED_APPS_ERROR_MESSAGE_MAX_LENGTH
    ? `${collapsed.slice(0, CONNECTED_APPS_ERROR_MESSAGE_MAX_LENGTH).trimEnd()}…`
    : collapsed || null
}

function readConnectedAppsAmbiguousWriteMessage(
  request: HostedConnectedAppsRequest,
): string | null {
  if (isConnectedAppsCalendarCreateRequest(request)) {
    return CONNECTED_APPS_AMBIGUOUS_CALENDAR_CREATE_MESSAGE
  }
  if (isConnectedAppsEmailSendRequest(request)) {
    return CONNECTED_APPS_AMBIGUOUS_EMAIL_SEND_MESSAGE
  }
  return null
}

function isConnectedAppsCalendarCreateRequest(
  request: HostedConnectedAppsRequest,
): boolean {
  return request.operation === 'execute'
    && CONNECTED_APPS_CALENDAR_CREATE_TOOL_SLUGS.has(request.input.toolSlug)
}

function isConnectedAppsEmailSendRequest(
  request: HostedConnectedAppsRequest,
): boolean {
  return request.operation === 'execute'
    && CONNECTED_APPS_EMAIL_SEND_TOOL_SLUGS.has(request.input.toolSlug)
}

function isConnectedAppsOfficialAlertRequest(
  request: HostedConnectedAppsRequest,
): boolean {
  return request.operation === 'execute'
    && request.input.toolSlug === CONNECTED_APPS_OFFICIAL_ALERT_TOOL_SLUG
}

function toHostedConnectedAppsRequest(
  request: Exclude<ConnectedAppsDynamicToolRequest, { kind: 'invalid-connected-apps-arguments' }>,
): HostedConnectedAppsRequest {
  switch (request.kind) {
    case 'connected-apps-manage':
      return { input: request.args, operation: 'manage' }
    case 'connected-apps-search':
      return { input: request.args, operation: 'search' }
    case 'connected-apps-execute':
      return { input: request.args, operation: 'execute' }
  }
}

function connectedAppsTextResult(success: boolean, text: string) {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' as const }],
      success,
    },
  }
}
