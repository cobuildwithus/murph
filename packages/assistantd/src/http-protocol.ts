import { URL } from 'node:url'
import {
  assertAssistantCronJobId,
  assertAssistantOutboxIntentId,
  assertAssistantSessionId,
  isAssistantSessionNotFoundError,
} from '@murphai/assistant-engine'
import {
  assistantDaemonMessageWireFields,
  assistantDaemonSessionResolutionWireFields,
} from './client.js'
import { ASSISTANTD_VAULT_MISMATCH_CODE } from './errors.js'
import type { AssistantLocalService } from './service.js'

const assistantConversationDirectnessValues = new Set([
  'direct',
  'group',
  'unknown',
])
const assistantOperatorAuthorityValues = new Set([
  'direct-operator',
])
const assistantChatProviderValues = ['codex-cli'] as const
const assistantChatProviderValueSet = new Set(assistantChatProviderValues)
const assistantCanonicalConversationFields = new Set([
  'alias',
  'channel',
  'directness',
  'identityId',
  'participantId',
  'sessionId',
  'threadId',
])
const assistantLegacyRejectedSessionResolutionFields = [
  'codexProfile',
  'modelSpec',
  'oss',
  'provider',
  'sourceThreadId',
] as const
const assistantOpenConversationRequestFields = new Set([
  ...assistantDaemonSessionResolutionWireFields,
  ...assistantLegacyRejectedSessionResolutionFields,
])
const assistantMessageRequestFields = new Set([
  ...assistantDaemonMessageWireFields,
  ...assistantLegacyRejectedSessionResolutionFields,
])

type AssistantOpenConversationRequest = Parameters<AssistantLocalService['openConversation']>[0]
type AssistantMessageRequest = Parameters<AssistantLocalService['sendMessage']>[0]
type AssistantSessionOptionsRequest = Parameters<AssistantLocalService['updateSessionOptions']>[0]
type AssistantStatusRequest = Parameters<AssistantLocalService['getStatus']>[0]
type AssistantSessionLookupRequest = Parameters<AssistantLocalService['getSession']>[0]
type AssistantSessionListRequest = Parameters<AssistantLocalService['listSessions']>[0]
type AssistantOutboxDrainRequest = Parameters<AssistantLocalService['drainOutbox']>[0]
type AssistantAutomationRunRequest = Parameters<AssistantLocalService['runAutomationOnce']>[0]
type AssistantCronProcessRequest = Parameters<AssistantLocalService['processDueCron']>[0]
type AssistantCronTargetSetRequest = Parameters<AssistantLocalService['setCronTarget']>[0]

function parseOpenConversationRequestBody(payload: unknown): AssistantOpenConversationRequest {
  const record = asAssistantRequestRecord(payload, 'open-conversation')
  assertSupportedAssistantRequestFields(
    record,
    assistantOpenConversationRequestFields,
    'open-conversation',
  )
  validateAssistantSessionResolutionRecord(record, 'open-conversation')
  return record as AssistantOpenConversationRequest
}

function parseAssistantMessageRequestBody(payload: unknown): AssistantMessageRequest {
  const record = asAssistantRequestRecord(payload, 'message')
  assertSupportedAssistantRequestFields(
    record,
    assistantMessageRequestFields,
    'message',
  )
  validateAssistantSessionResolutionRecord(record, 'message')
  const prompt = record.prompt
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new AssistantHttpRequestError('Assistant message requests require a non-empty prompt.', 400)
  }
  assertOptionalNullableStringField(record, 'deliveryTarget', 'message')
  assertOptionalNullableStringField(record, 'deliveryReplyToMessageId', 'message')
  assertOptionalNullableStringField(record, 'deliverySubject', 'message')
  assertOptionalNullableStringField(record, 'operatorAuthority', 'message')
  assertOptionalNullableStringField(record, 'turnTrigger', 'message')
  assertOptionalBooleanField(record, 'deliverResponse', 'message')
  assertOptionalBooleanField(record, 'includeEarlySessionOnboarding', 'message')
  assertOptionalBooleanField(record, 'persistUserPromptOnFailure', 'message')
  assertUnsupportedAssistantModelSpecField(record, 'message')
  if (
    typeof record.operatorAuthority === 'string' &&
    !assistantOperatorAuthorityValues.has(record.operatorAuthority)
  ) {
    throw new AssistantHttpRequestError(
      `Assistant message operatorAuthority must be one of ${Array.from(assistantOperatorAuthorityValues).join(', ')}.`,
      400,
    )
  }
  return record as AssistantMessageRequest
}

function parseAssistantSessionOptionsRequestBody(payload: unknown): AssistantSessionOptionsRequest {
  const record = asAssistantRequestRecord(payload, 'session-options')
  const providerOptions = readRequiredRecordField(record, 'providerOptions', 'session-options')
  const provider = readOptionalNullableStringField(
    providerOptions,
    'provider',
    'session-options.providerOptions',
  )
  if (
    !provider ||
    !assistantChatProviderValueSet.has(
      provider as (typeof assistantChatProviderValues)[number],
    )
  ) {
    throw new AssistantHttpRequestError(
      `Assistant session-options provider must be one of ${assistantChatProviderValues.join(', ')}.`,
      400,
    )
  }
  return {
    providerOptions: {
      ...providerOptions,
      provider,
    } as AssistantSessionOptionsRequest['providerOptions'],
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
  return {
    sessionId: parseRequiredOpaqueRouteSegment(
      url.pathname,
      '/sessions/',
      'session route',
      parseAssistantSessionIdField,
    ),
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

function parseAssistantOutboxRoute(url: URL): {
  intentId: string
  vault?: string | null
} {
  return {
    intentId: parseRequiredOpaqueRouteSegment(
      url.pathname,
      '/outbox/',
      'outbox route',
      parseAssistantOutboxIntentIdField,
    ),
    vault: readOptionalNullableQuery(url, 'vault'),
  }
}

function parseAssistantAutomationRunRequestBody(payload: unknown): AssistantAutomationRunRequest {
  const record = asAssistantRequestRecord(payload, 'automation/run-once')
  assertOptionalNullableStringField(record, 'vault', 'automation/run-once')
  assertOptionalNullableStringField(record, 'requestId', 'automation/run-once')
  assertOptionalBooleanField(record, 'allowSelfAuthored', 'automation/run-once')
  assertOptionalBooleanField(record, 'allowCanonicalWrites', 'automation/run-once')
  assertOptionalBooleanField(record, 'drainOutbox', 'automation/run-once')
  assertOptionalBooleanField(record, 'once', 'automation/run-once')
  assertOptionalBooleanField(record, 'startDaemon', 'automation/run-once')
  assertOptionalFiniteNumberField(record, 'maxPerScan', 'automation/run-once')
  assertOptionalFiniteNumberField(record, 'sessionMaxAgeMs', 'automation/run-once')
  const deliveryDispatchMode = readOptionalNullableStringField(
    record,
    'deliveryDispatchMode',
    'automation/run-once',
  )
  if (
    deliveryDispatchMode !== null &&
    deliveryDispatchMode !== undefined &&
    deliveryDispatchMode !== 'immediate' &&
    deliveryDispatchMode !== 'queue-only'
  ) {
    throw new AssistantHttpRequestError(
      'Assistant automation run requests must use a valid deliveryDispatchMode.',
      400,
    )
  }
  if ('modelSpec' in record) {
    throw new AssistantHttpRequestError(
      'Assistant automation run requests no longer support modelSpec.',
      400,
    )
  }
  return {
    ...record,
    deliveryDispatchMode: deliveryDispatchMode ?? undefined,
  } as AssistantAutomationRunRequest
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

function parseAssistantCronTargetSetRequestBody(
  url: URL,
  payload: unknown,
): AssistantCronTargetSetRequest {
  const record = asAssistantRequestRecord(payload, 'cron target')
  assertOptionalNullableStringField(record, 'vault', 'cron target')
  assertOptionalNullableStringField(record, 'channel', 'cron target')
  assertOptionalNullableStringField(record, 'identityId', 'cron target')
  assertOptionalNullableStringField(record, 'participantId', 'cron target')
  assertUnsupportedAssistantLegacyThreadField(record, 'cron target')
  assertOptionalNullableStringField(record, 'threadId', 'cron target')
  assertOptionalNullableStringField(record, 'deliveryTarget', 'cron target')
  assertOptionalBooleanField(record, 'dryRun', 'cron target')
  assertOptionalBooleanField(record, 'resetContinuity', 'cron target')

  return {
    job: parseAssistantCronTargetJobIdFromPath(url.pathname),
    vault: readOptionalNullableStringField(record, 'vault', 'cron target'),
    channel: readOptionalNullableStringField(record, 'channel', 'cron target'),
    identityId: readOptionalNullableStringField(record, 'identityId', 'cron target'),
    participantId: readOptionalNullableStringField(
      record,
      'participantId',
      'cron target',
    ),
    threadId: readOptionalNullableStringField(record, 'threadId', 'cron target'),
    deliveryTarget: readOptionalNullableStringField(
      record,
      'deliveryTarget',
      'cron target',
    ),
    dryRun: readOptionalBooleanField(record, 'dryRun', 'cron target'),
    resetContinuity: readOptionalBooleanField(
      record,
      'resetContinuity',
      'cron target',
    ),
  }
}

function parseAssistantCronJobRoute(url: URL): {
  job: string
  vault?: string | null
} {
  return {
    job: parseRequiredOpaqueRouteSegment(
      url.pathname,
      '/cron/jobs/',
      'cron job route',
      parseAssistantCronJobIdField,
    ),
    vault: readOptionalNullableQuery(url, 'vault'),
  }
}

function parseAssistantCronTargetRoute(url: URL): {
  job: string
  vault?: string | null
} {
  return {
    job: parseAssistantCronTargetJobIdFromPath(url.pathname),
    vault: readOptionalNullableQuery(url, 'vault'),
  }
}

function parseAssistantCronTargetJobIdFromPath(pathname: string): string {
  if (!pathname.startsWith('/cron/jobs/') || !pathname.endsWith('/target')) {
    throw new AssistantHttpRequestError(
      'Assistant cron target route requires a cron job id.',
      400,
    )
  }

  try {
    return parseAssistantCronJobIdField(
      decodeURIComponent(pathname.slice('/cron/jobs/'.length, -'/target'.length)),
      'cron target route',
    )
  } catch (error) {
    if (error instanceof AssistantHttpRequestError) {
      throw error
    }
    throw new AssistantHttpRequestError(
      'Assistant cron target route contained an invalid encoding.',
      400,
    )
  }
}

function parseAssistantCronRunsQuery(url: URL): {
  job: string
  limit?: number
  vault?: string | null
} {
  const job = readOptionalNullableQuery(url, 'job')
  if (typeof job !== 'string' || job.length === 0) {
    throw new AssistantHttpRequestError('Assistant cron runs requests require a job query parameter.', 400)
  }

  return {
    job: parseAssistantCronJobIdField(job, 'cron runs query'),
    limit: readOptionalIntegerQuery(url, 'limit'),
    vault: readOptionalNullableQuery(url, 'vault'),
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
  assertUnsupportedAssistantLegacyThreadField(record, context)
  assertOptionalNullableStringField(record, 'threadId', context)
  assertUnsupportedAssistantModelSpecField(record, context)
  assertUnsupportedAssistantProviderOverrideField(record, 'provider', context)
  assertOptionalNullableStringField(record, 'model', context)
  assertOptionalNullableStringField(record, 'modelProvider', context)
  assertOptionalNullableStringField(record, 'reasoningEffort', context)
  assertOptionalNullableStringField(record, 'sandbox', context)
  assertOptionalNullableStringField(record, 'approvalPolicy', context)
  assertUnsupportedAssistantProviderOverrideField(record, 'codexProfile', context)
  assertOptionalNullableStringField(record, 'profile', context)
  assertOptionalNullableStringField(record, 'codexCommand', context)
  assertOptionalNullableStringField(record, 'codexHome', context)
  assertOptionalNullableStringField(record, 'workingDirectory', context)
  assertOptionalBooleanField(record, 'threadIsDirect', context)
  assertUnsupportedAssistantProviderOverrideField(record, 'oss', context)
  assertOptionalFiniteNumberField(record, 'maxSessionAgeMs', context)

  const conversation = record.conversation
  if (conversation !== undefined) {
    const conversationRecord = readRequiredRecordField(record, 'conversation', context)
    validateAssistantConversationRecord(conversationRecord, context)
  }
}

function assertSupportedAssistantRequestFields(
  record: Record<string, unknown>,
  supportedFields: ReadonlySet<string>,
  context: string,
): void {
  for (const key of Object.keys(record)) {
    if (!supportedFields.has(key)) {
      throw new AssistantHttpRequestError(
        `Assistant ${context} field ${key} is not supported.`,
        400,
      )
    }
  }
}

function assertUnsupportedAssistantLegacyThreadField(
  record: Record<string, unknown>,
  context: string,
): void {
  if (!('sourceThreadId' in record)) {
    return
  }

  throw new AssistantHttpRequestError(
    `Assistant ${context} field sourceThreadId is no longer supported. Use threadId or the canonical conversation field instead.`,
    400,
  )
}

function assertUnsupportedAssistantModelSpecField(
  record: Record<string, unknown>,
  context: string,
): void {
  if (!('modelSpec' in record)) {
    return
  }

  throw new AssistantHttpRequestError(
    `Assistant ${context} field modelSpec is no longer supported. Use the flat model and reasoningEffort fields instead.`,
    400,
  )
}

function assertUnsupportedAssistantProviderOverrideField(
  record: Record<string, unknown>,
  key: 'codexProfile' | 'oss' | 'provider',
  context: string,
): void {
  if (!(key in record)) {
    return
  }

  throw new AssistantHttpRequestError(
    `Assistant ${context} field ${key} is no longer supported for per-turn daemon requests.`,
    400,
  )
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

function readOptionalBooleanField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): boolean | undefined {
  const value = record[key]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new AssistantHttpRequestError(
      `Assistant ${context} request field ${key} must be a boolean when present.`,
      400,
    )
  }
  return value
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
  /* v8 ignore next -- route/query readers only surface string or null values here */
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
      readAssistantErrorCode(error),
    )
  }
}

function parseAssistantOutboxIntentIdField(value: unknown, context: string): string {
  /* v8 ignore next -- opaque route parsing always decodes to a string before validation */
  if (typeof value !== 'string') {
    throw new AssistantHttpRequestError(
      `Assistant ${context} outbox intent id must be a string.`,
      400,
    )
  }

  try {
    return assertAssistantOutboxIntentId(value)
  } catch (error) {
    throw new AssistantHttpRequestError(
      error instanceof Error ? error.message : 'Assistant outbox intent id was invalid.',
      400,
      readAssistantErrorCode(error),
    )
  }
}

function parseAssistantCronJobIdField(value: unknown, context: string): string {
  /* v8 ignore next -- opaque route/query parsing always decodes to a string before validation */
  if (typeof value !== 'string') {
    throw new AssistantHttpRequestError(
      `Assistant ${context} cron job id must be a string.`,
      400,
    )
  }

  try {
    return assertAssistantCronJobId(value)
  } catch (error) {
    throw new AssistantHttpRequestError(
      error instanceof Error ? error.message : 'Assistant cron job id was invalid.',
      400,
      readAssistantErrorCode(error),
    )
  }
}

function parseRequiredOpaqueRouteSegment(
  pathname: string,
  prefix: string,
  context: string,
  parseValue: (value: unknown, context: string) => string,
): string {
  return parseValue(parseRequiredRouteSegment(pathname, prefix, context), context)
}

function parseRequiredRouteSegment(
  pathname: string,
  prefix: string,
  context: string,
): string {
  const encoded = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
  if (!encoded) {
    throw new AssistantHttpRequestError(`Assistant ${context} requires an identifier.`, 400)
  }

  try {
    return decodeURIComponent(encoded)
  } catch {
    throw new AssistantHttpRequestError(`Assistant ${context} contained an invalid encoding.`, 400)
  }
}

function resolveAssistantHttpErrorStatus(error: unknown): number {
  if (error instanceof AssistantHttpRequestError) {
    return error.statusCode
  }
  if (error instanceof SyntaxError) {
    return 400
  }

  const code = readAssistantErrorCode(error)
  if (
    code === ASSISTANTD_VAULT_MISMATCH_CODE ||
    code === 'ASSISTANT_INVALID_RUNTIME_ID' ||
    code === 'ASSISTANT_STATE_INVALID_DOC_ID'
  ) {
    return 400
  }
  if (
    code === 'ASSISTANT_SESSION_NOT_FOUND' ||
    code === 'ASSISTANT_CRON_JOB_NOT_FOUND'
  ) {
    return 404
  }
  /* v8 ignore next -- retained as a defensive seam; matching code-based errors return above */
  if (isAssistantSessionNotFoundError(error)) {
    return 404
  }

  return 500
}

function buildAssistantHttpErrorPayload(
  error: unknown,
  statusCode: number,
): {
  code?: string
  error: string
} {
  const code = statusCode < 500 ? readAssistantErrorCode(error) : null
  return {
    ...(code ? { code } : {}),
    error:
      statusCode >= 500
        ? 'Assistant daemon request failed.'
        : error instanceof Error
          ? error.message
          : 'Assistant daemon request failed.',
  }
}

function readAssistantErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }
  const value = (error as { code?: unknown }).code
  return typeof value === 'string' && value.length > 0 ? value : null
}


class AssistantHttpRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code?: string | null,
  ) {
    super(message)
    this.name = 'AssistantHttpRequestError'
  }
}

export {
  AssistantHttpRequestError,
  buildAssistantHttpErrorPayload,
  parseAssistantAutomationRunRequestBody,
  parseAssistantCronJobRoute,
  parseAssistantCronProcessRequestBody,
  parseAssistantCronRunsQuery,
  parseAssistantCronTargetRoute,
  parseAssistantCronTargetSetRequestBody,
  parseAssistantMessageRequestBody,
  parseAssistantOutboxDrainRequestBody,
  parseAssistantOutboxRoute,
  parseAssistantSessionOptionsRequestBody,
  parseAssistantSessionRoute,
  parseAssistantStatusQuery,
  parseAssistantVaultQuery,
  parseOpenConversationRequestBody,
  resolveAssistantHttpErrorStatus,
}
