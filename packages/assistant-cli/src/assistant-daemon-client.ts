import {
  assistantDaemonMessageWireFields,
  assistantDaemonSessionResolutionWireFields,
  resolveAssistantDaemonClientConfig,
  type AssistantDaemonClientConfig,
} from '@murphai/assistantd/client'
import {
  assistantAskResultSchema,
  assistantCronJobSchema,
  assistantCronRunRecordSchema,
  assistantCronTargetSnapshotSchema,
  assistantOutboxIntentSchema,
  assistantRunResultSchema,
  assistantSessionShowResultSchema,
  assistantStatusResultSchema,
  type AssistantAskResult,
  type AssistantCronJob,
  type AssistantCronRunRecord,
  type AssistantCronTargetSnapshot,
  type AssistantOutboxIntent,
  type AssistantRunResult,
  type AssistantSession,
  type AssistantStatusResult,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from '@murphai/assistant-engine/assistant-service'
import type { RunAssistantAutomationInput } from './assistant/automation.js'
import type {
  AssistantCronTargetMutationResult,
  AssistantCronProcessDueResult,
  AssistantCronStatusSnapshot,
  SetAssistantCronJobTargetInput,
} from './assistant/cron.js'
import type { AssistantOutboxDispatchMode } from './assistant/outbox.js'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export {
  resolveAssistantDaemonClientConfig,
  type AssistantDaemonClientConfig,
} from '@murphai/assistantd/client'

export interface AssistantDaemonOpenConversationResult {
  created: boolean
  session: AssistantSession
}

type AssistantSessionOptionsPatch = Pick<
  AssistantSession['providerOptions'],
  'provider'
> &
  Partial<Omit<AssistantSession['providerOptions'], 'provider'>>

export type AssistantDaemonAutomationInput = Omit<
  RunAssistantAutomationInput,
  'inboxServices' | 'inputSource' | 'onEvent' | 'onInboxEvent' | 'signal' | 'vaultServices'
>

export function canUseAssistantDaemonForMessage(
  input: AssistantMessageInput,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return false
  }

  return hasOnlyAssistantDaemonWireFields(
    input,
    assistantDaemonMessageWireFields,
  )
}

export async function maybeSendAssistantMessageViaDaemon(
  input: AssistantMessageInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantAskResult | null> {
  if (!canUseAssistantDaemonForMessage(input, env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/message', {
    env,
    method: 'POST',
    body: serializeAssistantMessageInput(input),
  })
  return parseAssistantDaemonSchema(assistantAskResultSchema, payload)
}

export async function maybeOpenAssistantConversationViaDaemon(
  input: AssistantSessionResolutionFields,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantDaemonOpenConversationResult | null> {
  if (
    !resolveAssistantDaemonClientConfig(env) ||
    !hasOnlyAssistantDaemonWireFields(
      input,
      assistantDaemonSessionResolutionWireFields,
    )
  ) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/open-conversation', {
    env,
    method: 'POST',
    body: serializeAssistantSessionResolutionFields(input),
  })
  return parseAssistantDaemonOpenConversationPayload(payload)
}

export async function maybeUpdateAssistantSessionOptionsViaDaemon(
  input: {
    providerOptions: AssistantSessionOptionsPatch
    sessionId: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantSession | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/session-options', {
    env,
    method: 'POST',
    body: input,
  })
  return parseAssistantSessionOutputPayload(payload)
}

export async function maybeListAssistantOutboxIntentsViaDaemon(
  input: { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantOutboxIntent[] | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/outbox', {
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantOutboxIntentListPayload(payload)
}

export async function maybeGetAssistantOutboxIntentViaDaemon(
  input: {
    intentId: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantOutboxIntent | null | undefined> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return undefined
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/outbox/${encodeURIComponent(input.intentId)}`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantNullableOutboxIntentPayload(payload)
}

export async function maybeGetAssistantStatusViaDaemon(
  input: {
    limit?: number
    sessionId?: string | null
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantStatusResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/status', {
      limit:
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? String(Math.trunc(input.limit))
          : null,
      sessionId: normalizeNullableString(input.sessionId),
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantDaemonSchema(assistantStatusResultSchema, payload)
}

export async function maybeListAssistantSessionsViaDaemon(
  input: { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantSession[] | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/sessions', {
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantSessionListPayload(payload)
}

export async function maybeGetAssistantSessionViaDaemon(
  input: {
    sessionId: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantSession | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/sessions/${encodeURIComponent(input.sessionId)}`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantSessionOutputPayload(payload)
}

export async function maybeGetAssistantCronStatusViaDaemon(
  input: { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronStatusSnapshot | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/cron/status', {
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantCronStatusPayload(payload)
}

export async function maybeListAssistantCronJobsViaDaemon(
  input: { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronJob[] | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/cron/jobs', {
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantCronJobListPayload(payload)
}

export async function maybeGetAssistantCronJobViaDaemon(
  input: {
    job: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronJob | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/cron/jobs/${encodeURIComponent(input.job)}`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantDaemonSchema(assistantCronJobSchema, payload)
}

export async function maybeGetAssistantCronTargetViaDaemon(
  input: {
    job: string
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronTargetSnapshot | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/cron/jobs/${encodeURIComponent(input.job)}/target`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantDaemonSchema(assistantCronTargetSnapshotSchema, payload)
}

export async function maybeSetAssistantCronTargetViaDaemon(
  input: SetAssistantCronJobTargetInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronTargetMutationResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const body = {
    channel: input.channel ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
    dryRun: input.dryRun ?? false,
    identityId: input.identityId ?? null,
    participantId: input.participantId ?? null,
    threadId: input.threadId ?? null,
    vault: input.vault,
  } as {
    channel: string | null
    deliveryTarget: string | null
    dryRun: boolean
    identityId: string | null
    participantId: string | null
    resetContinuity?: boolean
    threadId: string | null
    vault: string
  }
  if (input.resetContinuity !== undefined) {
    body.resetContinuity = input.resetContinuity
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath(
      `/cron/jobs/${encodeURIComponent(input.job)}/target`,
      {
        vault: input.vault,
      },
    ),
    {
      env,
      method: 'POST',
      body,
    },
  )
  return parseAssistantCronTargetMutationPayload(payload)
}

export async function maybeListAssistantCronRunsViaDaemon(
  input: {
    job: string
    limit?: number
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ jobId: string; runs: AssistantCronRunRecord[] } | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson(
    buildAssistantDaemonRoutePath('/cron/runs', {
      job: input.job,
      limit:
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? String(Math.trunc(input.limit))
          : null,
      vault: input.vault,
    }),
    {
      env,
      method: 'GET',
    },
  )
  return parseAssistantCronRunsPayload(payload)
}

export async function maybeDrainAssistantOutboxViaDaemon(
  input: {
    dependencies?: unknown
    dispatchHooks?: unknown
    limit?: number
    now?: Date
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<
  | {
      attempted: number
      failed: number
      queued: number
      sent: number
    }
  | null
> {
  if (input.dependencies !== undefined || input.dispatchHooks !== undefined) {
    return null
  }
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/outbox/drain', {
    env,
    method: 'POST',
    body: {
      limit:
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? Math.trunc(input.limit)
          : undefined,
      now: input.now?.toISOString(),
      vault: input.vault,
    },
  })
  return parseAssistantOutboxDrainPayload(payload)
}

export async function maybeRunAssistantAutomationViaDaemon(
  input: AssistantDaemonAutomationInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantRunResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/automation/run-once', {
    env,
    method: 'POST',
    body: {
      allowSelfAuthored: input.allowSelfAuthored,
      deliveryDispatchMode: input.deliveryDispatchMode,
      drainOutbox: input.drainOutbox,
      executionContext: input.executionContext,
      maxPerScan: input.maxPerScan,
      once: input.once,
      requestId: input.requestId ?? null,
      sessionMaxAgeMs: input.sessionMaxAgeMs ?? null,
      startDaemon: input.startDaemon,
      vault: input.vault,
    },
  })
  return parseAssistantDaemonSchema(assistantRunResultSchema, payload)
}

export async function maybeProcessDueAssistantCronViaDaemon(
  input: {
    deliveryDispatchMode?: AssistantOutboxDispatchMode
    limit?: number
    signal?: AbortSignal
    vault: string
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantCronProcessDueResult | null> {
  if (input.signal !== undefined) {
    return null
  }
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/cron/process-due', {
    env,
    method: 'POST',
    body: {
      deliveryDispatchMode: input.deliveryDispatchMode,
      limit:
        typeof input.limit === 'number' && Number.isFinite(input.limit)
          ? Math.trunc(input.limit)
          : undefined,
      vault: input.vault,
    },
  })
  return parseAssistantCronProcessDuePayload(payload)
}

async function assistantDaemonFetchJson(
  routePath: string,
  input: {
    body?: unknown
    env?: NodeJS.ProcessEnv
    method: 'GET' | 'POST'
  },
): Promise<unknown> {
  const config = resolveAssistantDaemonClientConfig(input.env ?? process.env)
  if (!config) {
    throw new VaultCliError(
      'assistant_daemon_unavailable',
      'Assistant daemon client is not configured. Configure or start the local assistant daemon before retrying.',
      {
        retryable: false,
        stage: 'configuration',
      },
    )
  }

  const headers = new Headers({
    Authorization: `Bearer ${config.token}`,
  })
  if (input.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${routePath}`, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
  } catch {
    throw buildAssistantDaemonTransportError(routePath, input.method)
  }

  let text: string
  try {
    text = await response.text()
  } catch {
    throw buildAssistantDaemonTransportError(routePath, input.method)
  }
  if (!response.ok) {
    throw buildAssistantDaemonHttpError(
      response.status,
      readAssistantDaemonErrorCode(text),
      input.method,
    )
  }

  const parsedPayload = parseAssistantDaemonJsonPayload(text)
  if (!parsedPayload.ok) {
    throw buildAssistantDaemonResponseError()
  }

  return parsedPayload.value
}

function buildAssistantDaemonTransportError(
  routePath: string,
  method: 'GET' | 'POST',
): VaultCliError {
  const retryable = method === 'GET'
  return new VaultCliError(
    retryable
      ? 'assistant_daemon_unavailable'
      : 'assistant_daemon_completion_unknown',
    retryable
      ? `Assistant daemon request did not complete for ${assistantDaemonRouteLabel(routePath)}. Check that the local assistant daemon is running, then retry.`
      : `Assistant daemon ${assistantDaemonRouteLabel(routePath)} may have completed, but its response was not confirmed. Inspect daemon state before retrying.`,
    {
      retryable,
      stage: 'transport',
    },
  )
}

const ASSISTANT_DAEMON_OWNER_FAILURES = {
  '400:ASSISTANT_INVALID_RUNTIME_ID': {
    message: 'Assistant daemon rejected an invalid runtime identifier. Correct the identifier and retry.',
    stage: 'validation',
  },
  '400:ASSISTANT_STATE_INVALID_DOC_ID': {
    message: 'Assistant daemon rejected an invalid state document identifier. Correct the identifier and retry.',
    stage: 'validation',
  },
  '400:ASSISTANTD_VAULT_MISMATCH': {
    message: 'Assistant daemon is bound to a different vault. Use the configured vault or restart the daemon for the intended vault.',
    stage: 'conflict',
  },
  '404:ASSISTANT_SESSION_NOT_FOUND': {
    message: 'Assistant session was not found. List current sessions and retry with an existing session id.',
    stage: 'read',
  },
  '404:ASSISTANT_CRON_JOB_NOT_FOUND': {
    message: 'Assistant cron job was not found. List current cron jobs and retry with an existing job id.',
    stage: 'read',
  },
  '409:assistantd_conflict': {
    message: 'Assistant daemon rejected the request because local state changed. Refresh the affected resource, then retry the request.',
    stage: 'conflict',
  },
} as const

function buildAssistantDaemonHttpError(
  status: number,
  ownerCode: string | null,
  method: 'GET' | 'POST',
): VaultCliError {
  if (status === 401 || status === 403) {
    return new VaultCliError(
      'assistant_daemon_auth_failed',
      'Assistant daemon authentication was rejected. Restart the client and daemon with matching local credentials before retrying.',
      {
        retryable: false,
        stage: 'authorization',
      },
    )
  }

  const ownerFailure = ownerCode
    ? ASSISTANT_DAEMON_OWNER_FAILURES[
        `${status}:${ownerCode}` as keyof typeof ASSISTANT_DAEMON_OWNER_FAILURES
      ]
    : undefined
  if (ownerFailure && ownerCode) {
    return new VaultCliError(
      ownerCode,
      ownerFailure.message,
      {
        retryable: false,
        stage: ownerFailure.stage,
      },
    )
  }

  if (status === 400 || status === 413 || status === 422) {
    return new VaultCliError(
      status === 413
        ? 'assistant_daemon_request_too_large'
        : 'assistant_daemon_request_invalid',
      status === 413
        ? 'Assistant daemon request was too large. Reduce the submitted request and retry.'
        : 'Assistant daemon rejected invalid request input. Correct the command arguments and retry.',
      {
        retryable: false,
        stage: 'validation',
      },
    )
  }

  if (status === 404) {
    return new VaultCliError(
      'assistant_daemon_resource_not_found',
      'Assistant daemon could not find the requested resource. List current resources and retry with an existing identifier.',
      {
        retryable: false,
        stage: 'read',
      },
    )
  }

  if (status === 409) {
    return new VaultCliError(
      'assistant_daemon_conflict',
      'Assistant daemon rejected the request because local state changed. Refresh the affected resource, then retry the request.',
      {
        retryable: false,
        stage: 'conflict',
      },
    )
  }

  const transient = status === 408 || status === 425 || status === 429 || status >= 500
  const retryable = method === 'GET' && transient
  const completionUnknown = method === 'POST' && transient
  return new VaultCliError(
    completionUnknown
      ? 'assistant_daemon_completion_unknown'
      : 'assistant_daemon_http_failed',
    completionUnknown
      ? `Assistant daemon returned HTTP ${status} after an effectful request whose completion is unknown. Inspect daemon state before retrying.`
      : `Assistant daemon request failed with HTTP ${status}. ${retryable
        ? 'Retry after checking the local assistant daemon status.'
        : 'Check that the client and local assistant daemon versions match.'}`,
    {
      retryable,
      stage: 'response',
    },
  )
}

function readAssistantDaemonErrorCode(value: string): string | null {
  const parsed = parseAssistantDaemonJsonPayload(value)
  if (
    !parsed.ok ||
    typeof parsed.value !== 'object' ||
    parsed.value === null ||
    Array.isArray(parsed.value)
  ) {
    return null
  }

  const code = (parsed.value as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,96}$/u.test(code)
    ? code
    : null
}

function buildAssistantDaemonResponseError(): VaultCliError {
  return new VaultCliError(
    'assistant_daemon_response_invalid',
    'Assistant daemon returned an invalid response. Restart or update the local assistant daemon before retrying.',
    {
      retryable: false,
      stage: 'response',
    },
  )
}

interface AssistantDaemonSchema<T> {
  safeParse(value: unknown): { data: T; success: true } | { success: false }
}

function parseAssistantDaemonSchema<T>(
  schema: AssistantDaemonSchema<T>,
  payload: unknown,
): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw buildAssistantDaemonResponseError()
  }
  return parsed.data
}

function serializeAssistantMessageInput(
  input: AssistantMessageInput,
): Pick<
  AssistantMessageInput,
  (typeof assistantDaemonMessageWireFields)[number]
> {
  return pickAssistantDaemonWireFields(input, assistantDaemonMessageWireFields)
}

function serializeAssistantSessionResolutionFields(
  input: AssistantSessionResolutionFields,
): Pick<
  AssistantSessionResolutionFields,
  (typeof assistantDaemonSessionResolutionWireFields)[number]
> {
  return pickAssistantDaemonWireFields(
    input,
    assistantDaemonSessionResolutionWireFields,
  )
}

function hasOnlyAssistantDaemonWireFields(
  input: object,
  fields: readonly string[],
): boolean {
  const supportedFields = new Set(fields)
  return Object.entries(input).every(
    ([key, value]) => value === undefined || supportedFields.has(key),
  )
}

function pickAssistantDaemonWireFields<
  Input extends object,
  Key extends keyof Input,
>(
  input: Input,
  fields: readonly Key[],
): Pick<Input, Key> {
  const result = {} as Pick<Input, Key>
  for (const field of fields) {
    if (Object.hasOwn(input, field)) {
      result[field] = input[field]
    }
  }
  return result
}

function parseAssistantDaemonOpenConversationPayload(
  payload: unknown,
): AssistantDaemonOpenConversationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw buildAssistantDaemonResponseError()
  }

  const record = payload as Record<string, unknown>
  if (typeof record.created !== 'boolean') {
    throw buildAssistantDaemonResponseError()
  }

  return {
    created: record.created,
    session: parseAssistantSessionOutputPayload(record.session),
  }
}

function parseAssistantSessionListPayload(payload: unknown): AssistantSession[] {
  if (!Array.isArray(payload)) {
    throw buildAssistantDaemonResponseError()
  }
  return parseAssistantDaemonSchema(
    assistantSessionShowResultSchema.shape.session.array(),
    payload,
  )
}

function parseAssistantSessionOutputPayload(payload: unknown): AssistantSession {
  return parseAssistantDaemonSchema(
    assistantSessionShowResultSchema.shape.session,
    payload,
  )
}

function parseAssistantOutboxIntentListPayload(
  payload: unknown,
): AssistantOutboxIntent[] {
  if (!Array.isArray(payload)) {
    throw buildAssistantDaemonResponseError()
  }
  return parseAssistantDaemonSchema(assistantOutboxIntentSchema.array(), payload)
}

function parseAssistantNullableOutboxIntentPayload(
  payload: unknown,
): AssistantOutboxIntent | null {
  if (payload === null) {
    return null
  }
  return parseAssistantDaemonSchema(assistantOutboxIntentSchema, payload)
}

function parseAssistantOutboxDrainPayload(payload: unknown): {
  attempted: number
  failed: number
  queued: number
  sent: number
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw buildAssistantDaemonResponseError()
  }

  const record = payload as Record<string, unknown>
  return {
    attempted: parseAssistantCountField(record.attempted, 'attempted'),
    failed: parseAssistantCountField(record.failed, 'failed'),
    queued: parseAssistantCountField(record.queued, 'queued'),
    sent: parseAssistantCountField(record.sent, 'sent'),
  }
}

function parseAssistantCronStatusPayload(
  payload: unknown,
): AssistantCronStatusSnapshot {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw buildAssistantDaemonResponseError()
  }

  const record = payload as Record<string, unknown>
  const nextRunAt = record.nextRunAt
  if (nextRunAt !== null && nextRunAt !== undefined && typeof nextRunAt !== 'string') {
    throw buildAssistantDaemonResponseError()
  }

  return {
    dueJobs: parseAssistantCountField(record.dueJobs, 'dueJobs'),
    enabledJobs: parseAssistantCountField(record.enabledJobs, 'enabledJobs'),
    nextRunAt: nextRunAt ?? null,
    runningJobs: parseAssistantCountField(record.runningJobs, 'runningJobs'),
    totalJobs: parseAssistantCountField(record.totalJobs, 'totalJobs'),
  }
}

function parseAssistantCronJobListPayload(
  payload: unknown,
): AssistantCronJob[] {
  if (!Array.isArray(payload)) {
    throw buildAssistantDaemonResponseError()
  }
  return parseAssistantDaemonSchema(assistantCronJobSchema.array(), payload)
}

function parseAssistantCronRunsPayload(
  payload: unknown,
): { jobId: string; runs: AssistantCronRunRecord[] } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw buildAssistantDaemonResponseError()
  }

  const record = payload as Record<string, unknown>
  if (typeof record.jobId !== 'string' || record.jobId.length === 0) {
    throw buildAssistantDaemonResponseError()
  }
  if (!Array.isArray(record.runs)) {
    throw buildAssistantDaemonResponseError()
  }

  return {
    jobId: record.jobId,
    runs: parseAssistantDaemonSchema(assistantCronRunRecordSchema.array(), record.runs),
  }
}

function parseAssistantCronTargetMutationPayload(
  payload: unknown,
): AssistantCronTargetMutationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw buildAssistantDaemonResponseError()
  }

  const record = payload as Record<string, unknown>
  return {
    job: parseAssistantDaemonSchema(assistantCronJobSchema, record.job),
    beforeTarget: parseAssistantDaemonSchema(assistantCronTargetSnapshotSchema, record.beforeTarget),
    afterTarget: parseAssistantDaemonSchema(assistantCronTargetSnapshotSchema, record.afterTarget),
    changed: parseAssistantBooleanField(record.changed, 'changed'),
    continuityReset: parseAssistantBooleanField(
      record.continuityReset,
      'continuityReset',
    ),
    dryRun: parseAssistantBooleanField(record.dryRun, 'dryRun'),
  }
}

function parseAssistantCronProcessDuePayload(
  payload: unknown,
): AssistantCronProcessDueResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw buildAssistantDaemonResponseError()
  }

  const record = payload as Record<string, unknown>
  return {
    failed: parseAssistantCountField(record.failed, 'failed'),
    processed: parseAssistantCountField(record.processed, 'processed'),
    succeeded: parseAssistantCountField(record.succeeded, 'succeeded'),
  }
}

function parseAssistantCountField(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    void field
    throw buildAssistantDaemonResponseError()
  }
  return value
}

function parseAssistantBooleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    void field
    throw buildAssistantDaemonResponseError()
  }
  return value
}

function parseAssistantDaemonJsonPayload(text: string):
  | { ok: true; value: unknown }
  | { error: unknown; ok: false } {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return {
      ok: true,
      value: null,
    }
  }

  try {
    return {
      ok: true,
      value: JSON.parse(trimmed),
    }
  } catch (error) {
    return {
      ok: false,
      error,
    }
  }
}

function buildAssistantDaemonRoutePath(
  routePath: string,
  query: Record<string, string | null | undefined>,
): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value.length > 0) {
      searchParams.set(key, value)
    }
  }
  const search = searchParams.toString()
  return search ? `${routePath}?${search}` : routePath
}

function assistantDaemonRouteLabel(routePath: string): string {
  const queryStart = routePath.indexOf('?')
  return queryStart === -1 ? routePath : routePath.slice(0, queryStart)
}
