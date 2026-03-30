import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { URL } from 'node:url'
import {
  assertAssistantSessionId,
  isAssistantSessionNotFoundError,
} from '@murph/assistant-services/runtime'
import { isLoopbackRemoteAddress } from '@murph/runtime-state'
import type { AssistantLocalService } from './service.js'

const MAX_ASSISTANT_HTTP_BODY_BYTES = 256 * 1024
const assistantConversationDirectnessValues = new Set([
  'direct',
  'group',
  'unknown',
])
const assistantCanonicalConversationFields = new Set([
  'alias',
  'channel',
  'directness',
  'identityId',
  'participantId',
  'sessionId',
  'threadId',
])

export interface CreateAssistantHttpServerInput {
  controlToken: string
  host: string
  port: number
  service: AssistantLocalService
}

export interface AssistantHttpServerHandle {
  address: {
    baseUrl: string
    host: string
    port: number
  }
  close(): Promise<void>
  server: Server
}

type AssistantOpenConversationRequest = Parameters<AssistantLocalService['openConversation']>[0]
type AssistantMessageRequest = Parameters<AssistantLocalService['sendMessage']>[0]
type AssistantSessionOptionsRequest = Parameters<AssistantLocalService['updateSessionOptions']>[0]
type AssistantStatusRequest = Parameters<AssistantLocalService['getStatus']>[0]
type AssistantSessionLookupRequest = Parameters<AssistantLocalService['getSession']>[0]
type AssistantSessionListRequest = Parameters<AssistantLocalService['listSessions']>[0]
type AssistantOutboxDrainRequest = Parameters<AssistantLocalService['drainOutbox']>[0]
type AssistantAutomationRunRequest = Parameters<AssistantLocalService['runAutomationOnce']>[0]
type AssistantCronProcessRequest = Parameters<AssistantLocalService['processDueCron']>[0]

export async function startAssistantHttpServer(
  input: CreateAssistantHttpServerInput,
): Promise<AssistantHttpServerHandle> {
  const server = createServer(async (request, response) => {
    await handleAssistantRequest(request, response, input)
  })
  const address = await listenAssistantServer(server, input.host, input.port)

  return {
    address: {
      baseUrl: buildAssistantServerBaseUrl(address),
      host: address.address,
      port: address.port,
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
    server,
  }
}

async function handleAssistantRequest(
  request: IncomingMessage,
  response: ServerResponse,
  input: CreateAssistantHttpServerInput,
): Promise<void> {
  try {
    if (!isLoopbackRemoteAddress(request.socket.remoteAddress)) {
      sendJson(response, 403, { error: 'Forbidden.' })
      return
    }

    if (!isAuthorizedAssistantRequest(request, input.controlToken)) {
      sendJson(response, 401, { error: 'Unauthorized.' })
      return
    }

    const method = request.method?.toUpperCase() ?? 'GET'
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    if (method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, await input.service.health())
      return
    }
    if (method === 'POST' && url.pathname === '/open-conversation') {
      const body = parseOpenConversationRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.openConversation(body))
      return
    }
    if (method === 'POST' && url.pathname === '/message') {
      const body = parseAssistantMessageRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.sendMessage(body))
      return
    }
    if (method === 'POST' && url.pathname === '/session-options') {
      const body = parseAssistantSessionOptionsRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.updateSessionOptions(body))
      return
    }
    if (method === 'GET' && url.pathname === '/status') {
      sendJson(response, 200, await input.service.getStatus(parseAssistantStatusQuery(url)))
      return
    }
    if (method === 'GET' && url.pathname === '/sessions') {
      sendJson(response, 200, await input.service.listSessions(parseAssistantVaultQuery(url)))
      return
    }
    if (method === 'GET' && url.pathname.startsWith('/sessions/')) {
      sendJson(response, 200, await input.service.getSession(parseAssistantSessionRoute(url)))
      return
    }
    if (method === 'POST' && url.pathname === '/outbox/drain') {
      const body = parseAssistantOutboxDrainRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.drainOutbox(body))
      return
    }
    if (method === 'POST' && url.pathname === '/automation/run-once') {
      const body = parseAssistantAutomationRunRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.runAutomationOnce(body))
      return
    }
    if (method === 'POST' && url.pathname === '/cron/process-due') {
      const body = parseAssistantCronProcessRequestBody(await readJsonBody(request))
      sendJson(response, 200, await input.service.processDueCron(body))
      return
    }

    sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    const statusCode =
      error instanceof AssistantHttpRequestError
        ? error.statusCode
        : error instanceof SyntaxError
          ? 400
          : isAssistantSessionNotFoundError(error)
            ? 404
            : 500
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : 'Assistant daemon request failed.',
    })
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > MAX_ASSISTANT_HTTP_BODY_BYTES) {
      throw new AssistantHttpRequestError('Assistant daemon request body was too large.', 413)
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  return raw.length === 0 ? {} : JSON.parse(raw)
}

function parseOpenConversationRequestBody(payload: unknown): AssistantOpenConversationRequest {
  const record = asAssistantRequestRecord(payload, 'open-conversation')
  validateAssistantSessionResolutionRecord(record, 'open-conversation')
  return record as AssistantOpenConversationRequest
}

function parseAssistantMessageRequestBody(payload: unknown): AssistantMessageRequest {
  const record = asAssistantRequestRecord(payload, 'message')
  validateAssistantSessionResolutionRecord(record, 'message')
  const prompt = record.prompt
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new AssistantHttpRequestError('Assistant message requests require a non-empty prompt.', 400)
  }
  assertOptionalNullableStringField(record, 'deliveryTarget', 'message')
  assertOptionalNullableStringField(record, 'deliveryReplyToMessageId', 'message')
  assertOptionalNullableStringField(record, 'turnTrigger', 'message')
  assertOptionalBooleanField(record, 'deliverResponse', 'message')
  assertOptionalBooleanField(record, 'enableFirstTurnOnboarding', 'message')
  assertOptionalBooleanField(record, 'persistUserPromptOnFailure', 'message')
  assertOptionalObjectField(record, 'modelSpec', 'message')
  return record as AssistantMessageRequest
}

function parseAssistantSessionOptionsRequestBody(payload: unknown): AssistantSessionOptionsRequest {
  const record = asAssistantRequestRecord(payload, 'session-options')
  const providerOptions = readRequiredRecordField(record, 'providerOptions', 'session-options')
  return {
    providerOptions,
    sessionId: parseAssistantSessionIdField(record.sessionId, 'session-options'),
    vault: readOptionalNullableStringField(record, 'vault', 'session-options'),
  }
}

function parseAssistantStatusQuery(url: URL): NonNullable<AssistantStatusRequest> {
  return {
    limit: readOptionalIntegerQuery(url, 'limit'),
    sessionId: readOptionalSessionIdQuery(url, 'sessionId'),
    vault: readOptionalNullableQuery(url, 'vault'),
  }
}

function parseAssistantVaultQuery(url: URL): AssistantSessionListRequest {
  return {
    vault: readOptionalNullableQuery(url, 'vault'),
  }
}

function parseAssistantSessionRoute(url: URL): AssistantSessionLookupRequest {
  const encodedSessionId = url.pathname.replace(/^\/sessions\//u, '')
  if (!encodedSessionId) {
    throw new AssistantHttpRequestError('Assistant session routes require a session id.', 400)
  }

  let sessionId: string
  try {
    sessionId = decodeURIComponent(encodedSessionId)
  } catch {
    throw new AssistantHttpRequestError('Assistant session route contained an invalid encoding.', 400)
  }

  return {
    sessionId: parseAssistantSessionIdField(sessionId, 'session route'),
    vault: readOptionalNullableQuery(url, 'vault'),
  }
}

function parseAssistantOutboxDrainRequestBody(payload: unknown): AssistantOutboxDrainRequest {
  const record = asAssistantRequestRecord(payload, 'outbox/drain')
  return {
    limit: readOptionalIntegerField(record, 'limit', 'outbox/drain'),
    now: readOptionalNullableStringField(record, 'now', 'outbox/drain'),
    vault: readOptionalNullableStringField(record, 'vault', 'outbox/drain'),
  }
}

function parseAssistantAutomationRunRequestBody(payload: unknown): AssistantAutomationRunRequest {
  const record = asAssistantRequestRecord(payload, 'automation/run-once')
  assertOptionalNullableStringField(record, 'vault', 'automation/run-once')
  assertOptionalNullableStringField(record, 'requestId', 'automation/run-once')
  assertOptionalBooleanField(record, 'allowSelfAuthored', 'automation/run-once')
  assertOptionalBooleanField(record, 'drainOutbox', 'automation/run-once')
  assertOptionalBooleanField(record, 'once', 'automation/run-once')
  assertOptionalBooleanField(record, 'startDaemon', 'automation/run-once')
  assertOptionalFiniteNumberField(record, 'maxPerScan', 'automation/run-once')
  assertOptionalFiniteNumberField(record, 'scanIntervalMs', 'automation/run-once')
  assertOptionalFiniteNumberField(record, 'sessionMaxAgeMs', 'automation/run-once')
  assertOptionalNullableStringField(record, 'deliveryDispatchMode', 'automation/run-once')
  assertOptionalObjectField(record, 'modelSpec', 'automation/run-once')
  return record as AssistantAutomationRunRequest
}

function parseAssistantCronProcessRequestBody(payload: unknown): AssistantCronProcessRequest {
  const record = asAssistantRequestRecord(payload, 'cron/process-due')
  const deliveryDispatchMode = readOptionalNullableStringField(
    record,
    'deliveryDispatchMode',
    'cron/process-due',
  )
  if (
    deliveryDispatchMode !== null &&
    deliveryDispatchMode !== undefined &&
    deliveryDispatchMode !== 'immediate' &&
    deliveryDispatchMode !== 'queue-only'
  ) {
    throw new AssistantHttpRequestError(
      'Assistant cron process requests must use a valid deliveryDispatchMode.',
      400,
    )
  }

  return {
    deliveryDispatchMode: deliveryDispatchMode ?? undefined,
    limit: readOptionalIntegerField(record, 'limit', 'cron/process-due'),
    vault: readOptionalNullableStringField(record, 'vault', 'cron/process-due'),
  }
}

function validateAssistantSessionResolutionRecord(
  record: Record<string, unknown>,
  context: string,
): void {
  assertOptionalNullableStringField(record, 'vault', context)
  assertOptionalNullableStringField(record, 'alias', context)
  assertOptionalNullableStringField(record, 'sessionId', context)
  if (typeof record.sessionId === 'string') {
    parseAssistantSessionIdField(record.sessionId, context)
  }
  assertOptionalNullableStringField(record, 'channel', context)
  assertOptionalNullableStringField(record, 'identityId', context)
  assertOptionalNullableStringField(record, 'participantId', context)
  assertOptionalNullableStringField(record, 'sourceThreadId', context)
  assertOptionalNullableStringField(record, 'threadId', context)
  assertOptionalNullableStringField(record, 'provider', context)
  assertOptionalNullableStringField(record, 'model', context)
  assertOptionalNullableStringField(record, 'reasoningEffort', context)
  assertOptionalNullableStringField(record, 'sandbox', context)
  assertOptionalNullableStringField(record, 'approvalPolicy', context)
  assertOptionalNullableStringField(record, 'codexProfile', context)
  assertOptionalNullableStringField(record, 'codexCommand', context)
  assertOptionalNullableStringField(record, 'workingDirectory', context)
  assertOptionalNullableStringField(record, 'now', context)
  assertOptionalBooleanField(record, 'threadIsDirect', context)
  assertOptionalBooleanField(record, 'oss', context)
  assertOptionalFiniteNumberField(record, 'maxSessionAgeMs', context)

  const conversation = record.conversation
  if (conversation !== undefined) {
    const conversationRecord = readRequiredRecordField(record, 'conversation', context)
    validateAssistantConversationRecord(conversationRecord, context)
  }
}

function validateAssistantConversationRecord(
  record: Record<string, unknown>,
  context: string,
): void {
  for (const key of Object.keys(record)) {
    if (!assistantCanonicalConversationFields.has(key)) {
      throw new AssistantHttpRequestError(
        `Assistant ${context} conversation field ${key} is not supported. Use the canonical nested conversation-ref shape instead.`,
        400,
      )
    }
  }

  const nestedContext = `${context} conversation`
  const nestedSessionId = record.sessionId
  if (typeof nestedSessionId === 'string') {
    parseAssistantSessionIdField(nestedSessionId, nestedContext)
  } else if (nestedSessionId !== undefined && nestedSessionId !== null) {
    throw new AssistantHttpRequestError(
      `Assistant ${nestedContext} sessionId must be a string when present.`,
      400,
    )
  }

  assertOptionalNullableStringField(record, 'alias', nestedContext)
  assertOptionalNullableStringField(record, 'channel', nestedContext)
  assertOptionalNullableStringField(record, 'identityId', nestedContext)
  assertOptionalNullableStringField(record, 'participantId', nestedContext)
  assertOptionalNullableStringField(record, 'threadId', nestedContext)

  const directness = readOptionalNullableStringField(record, 'directness', nestedContext)
  if (
    directness !== undefined &&
    directness !== null &&
    !assistantConversationDirectnessValues.has(directness)
  ) {
    throw new AssistantHttpRequestError(
      `Assistant ${nestedContext} directness must be one of direct, group, or unknown when present.`,
      400,
    )
  }
}

function asAssistantRequestRecord(
  payload: unknown,
  context: string,
): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AssistantHttpRequestError(
      `Assistant ${context} requests must use a JSON object body.`,
      400,
    )
  }
  return payload as Record<string, unknown>
}

function readRequiredRecordField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const value = record[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AssistantHttpRequestError(
      `Assistant ${context} request field ${key} must be a JSON object.`,
      400,
    )
  }
  return value as Record<string, unknown>
}

function readOptionalNullableStringField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string | null | undefined {
  const value = record[key]
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new AssistantHttpRequestError(
      `Assistant ${context} request field ${key} must be a string when present.`,
      400,
    )
  }
  return value
}

function assertOptionalNullableStringField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  void readOptionalNullableStringField(record, key, context)
}

function assertOptionalBooleanField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key]
  if (value !== undefined && typeof value !== 'boolean') {
    throw new AssistantHttpRequestError(
      `Assistant ${context} request field ${key} must be a boolean when present.`,
      400,
    )
  }
}

function assertOptionalFiniteNumberField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key]
  if (
    value !== undefined &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new AssistantHttpRequestError(
      `Assistant ${context} request field ${key} must be a finite number when present.`,
      400,
    )
  }
}

function assertOptionalObjectField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key]
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new AssistantHttpRequestError(
      `Assistant ${context} request field ${key} must be a JSON object when present.`,
      400,
    )
  }
}

function readOptionalIntegerField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number | undefined {
  const value = record[key]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AssistantHttpRequestError(
      `Assistant ${context} request field ${key} must be a finite number when present.`,
      400,
    )
  }
  return Math.trunc(value)
}

function readOptionalIntegerQuery(url: URL, key: string): number | undefined {
  const raw = readOptionalNullableQuery(url, key)
  if (!raw) {
    return undefined
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new AssistantHttpRequestError(
      `Assistant query parameter ${key} must be a finite number when present.`,
      400,
    )
  }
  return Math.trunc(value)
}

function readOptionalNullableQuery(url: URL, key: string): string | null | undefined {
  const value = url.searchParams.get(key)
  return value === null ? undefined : value
}

function readOptionalSessionIdQuery(url: URL, key: string): string | null | undefined {
  const value = readOptionalNullableQuery(url, key)
  if (typeof value !== 'string' || value.length === 0) {
    return value
  }
  return parseAssistantSessionIdField(value, `query parameter ${key}`)
}

function parseAssistantSessionIdField(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw new AssistantHttpRequestError(
      `Assistant ${context} session id must be a string.`,
      400,
    )
  }

  try {
    return assertAssistantSessionId(value)
  } catch (error) {
    throw new AssistantHttpRequestError(
      error instanceof Error ? error.message : 'Assistant session id was invalid.',
      400,
    )
  }
}

function isAuthorizedAssistantRequest(
  request: IncomingMessage,
  expectedToken: string,
): boolean {
  const header = request.headers.authorization
  if (typeof header !== 'string') {
    return false
  }
  const matched = header.match(/^bearer\s+(.+)$/iu)
  if (!matched?.[1]) {
    return false
  }

  const provided = Buffer.from(matched[1], 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function buildAssistantServerBaseUrl(address: AddressInfo): string {
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address
  return `http://${host}:${address.port}`
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(payload)}\n`)
}

async function listenAssistantServer(
  server: Server,
  host: string,
  port: number,
): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('assistantd did not expose a TCP listener address.')
  }
  return address
}

class AssistantHttpRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'AssistantHttpRequestError'
  }
}
