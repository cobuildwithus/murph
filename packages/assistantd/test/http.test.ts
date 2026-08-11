import assert from 'node:assert/strict'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, test, vi } from 'vitest'
import { createAssistantdVaultMismatchError } from '../src/errors.js'
import { AssistantHttpRequestError } from '../src/http-protocol.js'
import {
  assertAssistantControlRequest,
  createAssistantHttpRequestHandler,
  startAssistantHttpServer,
  type AssistantHttpRequestHandler,
} from '../src/http.js'
import type { AssistantLocalService } from '../src/service.js'
import { createUnusedAssistantService } from './service-test-helpers.js'

type AssistantSession = Awaited<ReturnType<AssistantLocalService['getSession']>>
type AssistantOutboxIntent = NonNullable<
  Awaited<ReturnType<AssistantLocalService['getOutboxIntent']>>
>
type AssistantCronJob = Awaited<ReturnType<AssistantLocalService['getCronJob']>>
type AssistantCronTarget = Awaited<ReturnType<AssistantLocalService['getCronTarget']>>
type AssistantCronStatus = Awaited<ReturnType<AssistantLocalService['getCronStatus']>>
type AssistantCronRuns = Awaited<ReturnType<AssistantLocalService['listCronRuns']>>
type AssistantStatus = Awaited<ReturnType<AssistantLocalService['getStatus']>>
type AssistantProcessDueCronResult = Awaited<
  ReturnType<AssistantLocalService['processDueCron']>
>
type AssistantOpenConversationResult = Awaited<
  ReturnType<AssistantLocalService['openConversation']>
>
type AssistantRunAutomationResult = Awaited<
  ReturnType<AssistantLocalService['runAutomationOnce']>
>
type AssistantSendMessageResult = Awaited<ReturnType<AssistantLocalService['sendMessage']>>
type AssistantSetCronTargetResult = Awaited<
  ReturnType<AssistantLocalService['setCronTarget']>
>
type AssistantSessionOptionsResult = Awaited<
  ReturnType<AssistantLocalService['updateSessionOptions']>
>

const TEST_PROVIDER_OPTIONS = {
  continuityFingerprint: 'fingerprint-http-test',
  executionDriver: 'codex-app-server',
  approvalPolicy: null,
  model: null,
  oss: false,
  profile: null,
  provider: 'codex-cli',
  reasoningEffort: null,
  resumeKind: 'codex-thread',
  sandbox: null,
} satisfies AssistantSession['providerOptions']

const TEST_SESSION: AssistantSession = {
  schema: 'murph.assistant-conversation.v2',
  conversationId: 'session_http_test',
  sessionId: 'session_http_test',
  codexTarget: {
    adapter: 'codex-cli',
    approvalPolicy: null,
    codexCommand: null,
    model: null,
    oss: false,
    profile: null,
    reasoningEffort: null,
    sandbox: null,
  },
  target: {
    adapter: 'codex-cli',
    approvalPolicy: null,
    codexCommand: null,
    model: null,
    oss: false,
    profile: null,
    reasoningEffort: null,
    sandbox: null,
  },
  codexResume: null,
  resumeState: null,
  provider: 'codex-cli',
  providerOptions: { ...TEST_PROVIDER_OPTIONS },
  alias: 'chat:test',
  binding: {
    conversationKey: 'chat:test',
    channel: 'local',
    identityId: null,
    actorId: null,
    threadId: null,
    threadIsDirect: true,
    delivery: null,
  },
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
  lastTurnAt: null,
  turnCount: 0,
}

const TEST_OUTBOX_INTENT: AssistantOutboxIntent = {
  schema: 'murph.assistant-outbox-intent.v1',
  intentId: 'outbox_http_test',
  sessionId: TEST_SESSION.sessionId,
  turnId: 'turn_http_test',
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
  lastAttemptAt: null,
  nextAttemptAt: '2026-03-28T00:00:00.000Z',
  sentAt: null,
  attemptCount: 0,
  status: 'pending',
  message: 'queued hello',
  media: [],
  card: null,
  operation: null,
  subject: null,
  dedupeKey: 'dedupe-key',
  targetFingerprint: 'target-fingerprint',
  channel: 'telegram',
  identityId: null,
  actorId: 'chat-123',
  answeredMailboxItemIds: [],
  threadId: 'chat-123',
  threadIsDirect: true,
  replyToMessageId: null,
  bindingDelivery: {
    kind: 'participant',
    target: 'chat-123',
  },
  deliverySource: null,
  explicitTarget: null,
  delivery: null,
  deliveryConfirmationPending: false,
  deliveryIdempotencyKey: null,
  deliveryTransportIdempotent: false,
  preparedDispatchToken: null,
  lastError: null,
}

type LegacyMessageOutboxIntentWire = {
  intentId: string
  schema: 'murph.assistant-outbox-intent.v1'
}

const LEGACY_MESSAGE_OUTBOX_INTENT_KEYS = [
  'actorId',
  'answeredMailboxItemIds',
  'attemptCount',
  'bindingDelivery',
  'card',
  'channel',
  'createdAt',
  'dedupeKey',
  'delivery',
  'deliveryConfirmationPending',
  'deliveryIdempotencyKey',
  'deliverySource',
  'deliveryTransportIdempotent',
  'explicitTarget',
  'identityId',
  'intentId',
  'lastAttemptAt',
  'lastError',
  'media',
  'message',
  'nextAttemptAt',
  'operation',
  'preparedDispatchToken',
  'replyToMessageId',
  'schema',
  'sentAt',
  'sessionId',
  'status',
  'subject',
  'targetFingerprint',
  'threadId',
  'threadIsDirect',
  'turnId',
  'updatedAt',
]

function assertLegacyMessageOutboxIntentWire(
  value: unknown,
): asserts value is LegacyMessageOutboxIntentWire {
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
  const record = value as Record<string, unknown>
  assert.deepEqual(
    Object.keys(record).sort(),
    [...LEGACY_MESSAGE_OUTBOX_INTENT_KEYS].sort(),
  )
  assert.equal(record.schema, 'murph.assistant-outbox-intent.v1')
  assert.equal(typeof record.intentId, 'string')
  assert.equal(typeof record.message, 'string')
  assert.equal(Array.isArray(record.media), true)
  assert.equal(record.subject === null || typeof record.subject === 'string', true)
}

const TEST_THREAD_BINDING_DELIVERY = {
  kind: 'thread',
  target: 'chat-123',
} satisfies NonNullable<AssistantCronTarget['bindingDelivery']>

const TEST_CRON_JOB: AssistantCronJob = {
  schema: 'murph.assistant-cron-job.v1',
  jobId: 'cron_http_test',
  name: 'daily-checkin',
  enabled: true,
  keepAfterRun: true,
  prompt: 'Send a quick check-in.',
  schedule: {
    kind: 'every',
    everyMs: 86_400_000,
  },
  target: {
    sessionId: TEST_SESSION.sessionId,
    alias: null,
    channel: 'telegram',
    identityId: null,
    participantId: 'chat-123',
    threadId: 'chat-123',
    deliveryTarget: null,
    deliverySource: null,
  },
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
  state: {
    nextRunAt: '2026-03-29T00:00:00.000Z',
    lastRunAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    consecutiveFailures: 0,
    lastError: null,
    runningAt: null,
    runningPid: null,
  },
}

const TEST_CRON_RUN = {
  schema: 'murph.assistant-cron-run.v1',
  runId: 'cronrun_http_test',
  jobId: TEST_CRON_JOB.jobId,
  trigger: 'scheduled',
  status: 'succeeded',
  outcome: 'delivered',
  reason: 'sent',
  startedAt: '2026-03-28T00:00:00.000Z',
  finishedAt: '2026-03-28T00:00:10.000Z',
  sessionId: TEST_SESSION.sessionId,
  response: 'done',
  responseLength: 4,
  error: null,
} satisfies AssistantCronRuns['runs'][number]

const TEST_CRON_STATUS: AssistantCronStatus = {
  totalJobs: 1,
  enabledJobs: 1,
  dueJobs: 0,
  runningJobs: 0,
  nextRunAt: TEST_CRON_JOB.state.nextRunAt,
}

const EMPTY_CRON_STATUS: AssistantCronStatus = {
  totalJobs: 0,
  enabledJobs: 0,
  dueJobs: 0,
  runningJobs: 0,
  nextRunAt: null,
}

const TEST_ASSISTANT_STATUS: AssistantStatus = {
  vault: '/tmp/vault',
  stateRoot: '/tmp/vault/.runtime/operations/assistant',
  statusPath: '/tmp/vault/.runtime/operations/assistant/status.json',
  outboxRoot: '/tmp/vault/.runtime/operations/assistant/outbox',
  diagnosticsPath: '/tmp/vault/.runtime/operations/assistant/diagnostics.snapshot.json',
  turnsRoot: '/tmp/vault/.runtime/operations/assistant/turns',
  generatedAt: '2026-03-28T00:00:00.000Z',
  runLock: {
    state: 'unlocked',
    pid: null,
    startedAt: null,
    mode: null,
    command: null,
    reason: null,
  },
  automation: {
    autoReply: [],
    updatedAt: '2026-03-28T00:00:00.000Z',
  },
  outbox: {
    total: 0,
    pending: 0,
    sending: 0,
    retryable: 0,
    sent: 0,
    failed: 0,
    abandoned: 0,
    oldestPendingAt: null,
    nextAttemptAt: null,
  },
  diagnostics: {
    schema: 'murph.assistant-diagnostics.v1',
    updatedAt: '2026-03-28T00:00:00.000Z',
    lastEventAt: null,
    lastErrorAt: null,
    counters: {
      turnsStarted: 0,
      turnsCompleted: 0,
      turnsDeferred: 0,
      turnsFailed: 0,
      providerAttempts: 0,
      providerFailures: 0,
      deliveriesQueued: 0,
      deliveriesSent: 0,
      deliveriesFailed: 0,
      deliveriesRetryable: 0,
      outboxDrains: 0,
      outboxRetries: 0,
      automationScans: 0,
    },
    recentWarnings: [],
  },
  quarantine: {
    total: 0,
    byKind: {},
    recent: [],
  },
  runtimeBudget: {
    schema: 'murph.assistant-runtime-budget.v1',
    updatedAt: '2026-03-28T00:00:00.000Z',
    caches: [],
    maintenance: {
      lastRunAt: null,
      staleQuarantinePruned: 0,
      staleLocksCleared: 0,
      notes: [],
    },
  },
  recentTurns: [],
  warnings: [],
}

const EMPTY_PROCESS_DUE_CRON_RESULT: AssistantProcessDueCronResult = {
  failed: 0,
  processed: 0,
  succeeded: 0,
}

function createAssistantCronTarget(
  jobId: string,
  bindingDelivery: AssistantCronTarget['bindingDelivery'],
  target: AssistantCronTarget['target'] = TEST_CRON_JOB.target,
): AssistantCronTarget {
  return {
    jobId,
    jobName: TEST_CRON_JOB.name,
    target,
    bindingDelivery,
  }
}

function createAssistantOpenConversationResult(
  created: boolean,
  session: AssistantSession = TEST_SESSION,
): AssistantOpenConversationResult {
  return {
    created,
    session,
  }
}

function createAssistantRunAutomationResult(
  scans: number,
): AssistantRunAutomationResult {
  return {
    vault: '/tmp/vault',
    startedAt: '2026-03-28T00:00:00.000Z',
    stoppedAt: '2026-03-28T00:00:00.000Z',
    reason: 'completed',
    daemonStarted: false,
    scans,
    considered: 0,
    routed: 0,
    noAction: 0,
    skipped: 0,
    failed: 0,
    replyConsidered: 0,
    replied: 0,
    replySkipped: 0,
    replyFailed: 0,
    lastError: null,
  }
}

function createAssistantSendMessageResult(
  prompt: string,
  response: string,
): AssistantSendMessageResult {
  return {
    vault: '/tmp/vault',
    status: 'completed',
    prompt,
    response,
    media: [],
    session: TEST_SESSION,
    delivery: null,
    deliveryDeferred: false,
    deliveryIntentId: null,
    deliveryError: null,
  }
}

function createSetCronTargetResult(input: {
  bindingDelivery?: AssistantSetCronTargetResult['beforeTarget']['bindingDelivery']
  changed?: boolean
  continuityReset?: boolean
  deliveryTarget?: string | null
  dryRun?: boolean
  identityId?: string | null
  jobId?: string
  resetContinuity?: boolean
  channel?: AssistantSetCronTargetResult['afterTarget']['target']['channel']
} = {}): AssistantSetCronTargetResult {
  const jobId = input.jobId ?? TEST_CRON_JOB.jobId
  const target = {
    ...TEST_CRON_JOB.target,
    sessionId: input.resetContinuity ? null : TEST_CRON_JOB.target.sessionId,
    alias: input.resetContinuity ? null : TEST_CRON_JOB.target.alias,
    channel: input.channel ?? TEST_CRON_JOB.target.channel,
    identityId: input.identityId ?? null,
    participantId: null,
    threadId: null,
    deliveryTarget: input.deliveryTarget ?? null,
  }

  return {
    job: {
      ...TEST_CRON_JOB,
      jobId,
      target,
    },
    beforeTarget: createAssistantCronTarget(
      jobId,
      input.bindingDelivery ?? TEST_THREAD_BINDING_DELIVERY,
    ),
    afterTarget: createAssistantCronTarget(jobId, null, target),
    changed: input.changed ?? true,
    continuityReset: input.continuityReset ?? false,
    dryRun: input.dryRun ?? false,
  }
}

function createBearerAuthorization(token: string): string {
  return ['Bearer', token].join(' ')
}

function createAssistantdTestFetch(
  handler: AssistantHttpRequestHandler,
  baseUrl: string,
) {
  return async (
    input: string,
    init?: RequestInit & { remoteAddress?: string },
  ): Promise<Response> => {
    const url = new URL(input, baseUrl)
    const requestHeaders = new Headers(init?.headers)
    if (!requestHeaders.has('host')) {
      requestHeaders.set('host', url.host)
    }

    const requestBody = readAssistantdTestRequestBody(init?.body)
    const request = Object.assign(
      Readable.from(requestBody === undefined ? [] : [requestBody]),
      {
        headers: Object.fromEntries(requestHeaders.entries()),
        method: init?.method ?? 'GET',
        socket: {
          remoteAddress: init?.remoteAddress ?? '127.0.0.1',
        },
        url: `${url.pathname}${url.search}`,
      },
    ) as IncomingMessage

    let statusCode = 200
    const responseHeaders = new Headers()
    const responseChunks: Uint8Array[] = []
    let responseLike!: Pick<ServerResponse, 'end' | 'setHeader'> & {
      statusCode: number
    }
    responseLike = {
      end(
        chunk?: string | Uint8Array | (() => void),
        encodingOrCb?: BufferEncoding | (() => void),
        cb?: () => void,
      ) {
        const resolvedChunk = typeof chunk === 'function' ? undefined : chunk
        if (typeof resolvedChunk === 'string') {
          responseChunks.push(Buffer.from(resolvedChunk, 'utf8'))
        } else if (resolvedChunk) {
          responseChunks.push(Buffer.from(resolvedChunk))
        }
        return responseLike as ServerResponse
      },
      setHeader(name: string, value: number | string | readonly string[]) {
        responseHeaders.set(
          name,
          Array.isArray(value) ? value.join(', ') : String(value),
        )
        return responseLike as ServerResponse
      },
      get statusCode() {
        return statusCode
      },
      set statusCode(value: number) {
        statusCode = value
      },
    }

    await handler(request, responseLike as ServerResponse)

    return new Response(Buffer.concat(responseChunks), {
      headers: responseHeaders,
      status: statusCode,
    })
  }
}

function readAssistantdTestRequestBody(body: RequestInit['body']): string | undefined {
  if (body === undefined || body === null) {
    return undefined
  }
  if (typeof body === 'string') {
    return body
  }
  if (body instanceof URLSearchParams) {
    return body.toString()
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf8')
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(body)).toString('utf8')
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString(
      'utf8',
    )
  }
  throw new Error('Unsupported assistantd test request body.')
}

function requireFirstCallArg<T>(
  mock: {
    mock: {
      calls: ReadonlyArray<readonly [T?, ...unknown[]]>
    }
  },
  label: string,
): T {
  const firstArg = mock.mock.calls[0]?.[0]
  if (firstArg === undefined) {
    throw new Error(`${label} should be called with an argument`)
  }
  return firstArg
}

function withIncomingHeader(name: string, value: string | string[]): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {}
  Reflect.set(headers, name, value)
  return headers
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('assertAssistantControlRequest rejects forwarded proxy headers on control routes', () => {
  assert.throws(
    () =>
      assertAssistantControlRequest({
        headers: {
          authorization: 'Bearer control-secret',
          host: 'localhost:50241',
          forwarded: 'for=203.0.113.7;proto=https;host=murph.example',
        },
        remoteAddress: '127.0.0.1',
        controlToken: 'control-secret',
      }),
    (error: unknown) =>
      error instanceof AssistantHttpRequestError &&
      error.code === 'ASSISTANT_CONTROL_PROXY_HEADERS_REJECTED' &&
      error.statusCode === 403,
  )
})

test('assertAssistantControlRequest rejects repeated forwarded proxy headers on control routes', () => {
  assert.throws(
    () =>
      assertAssistantControlRequest({
        headers: {
          authorization: 'Bearer control-secret',
          host: 'localhost:50241',
          'x-forwarded-for': ['203.0.113.7', '203.0.113.8'],
        },
        remoteAddress: '127.0.0.1',
        controlToken: 'control-secret',
      }),
    (error: unknown) =>
      error instanceof AssistantHttpRequestError &&
      error.code === 'ASSISTANT_CONTROL_PROXY_HEADERS_REJECTED' &&
      error.statusCode === 403,
  )
})

test('assertAssistantControlRequest rejects non-loopback host headers on control routes', () => {
  assert.throws(
    () =>
      assertAssistantControlRequest({
        headers: {
          authorization: 'Bearer control-secret',
          host: 'murph.example',
        },
        remoteAddress: '127.0.0.1',
        controlToken: 'control-secret',
      }),
    (error: unknown) =>
      error instanceof AssistantHttpRequestError &&
      error.code === 'ASSISTANT_CONTROL_LOOPBACK_HOST_REQUIRED' &&
      error.statusCode === 403,
  )
})

test('assertAssistantControlRequest rejects malformed loopback-like host headers', () => {
  assert.throws(
    () =>
      assertAssistantControlRequest({
        headers: {
          authorization: 'Bearer control-secret',
          host: 'foo@localhost:50241',
        },
        remoteAddress: '127.0.0.1',
        controlToken: 'control-secret',
      }),
    (error: unknown) =>
      error instanceof AssistantHttpRequestError &&
      error.code === 'ASSISTANT_CONTROL_LOOPBACK_HOST_REQUIRED' &&
      error.statusCode === 403,
  )
})

test('assertAssistantControlRequest rejects duplicate authorization headers instead of guessing', () => {
  assert.throws(
    () =>
      assertAssistantControlRequest({
        headers: {
          host: 'localhost:50241',
          ...withIncomingHeader('authorization', [
            'Bearer control-secret',
            'Bearer shadow-secret',
          ]),
        },
        remoteAddress: '127.0.0.1',
        controlToken: 'control-secret',
      }),
    (error: unknown) =>
      error instanceof AssistantHttpRequestError && error.statusCode === 401,
  )
})

test('assertAssistantControlRequest accepts loopback requests with a loopback host header', () => {
  assert.doesNotThrow(() =>
    assertAssistantControlRequest({
      headers: {
        authorization: 'Bearer control-secret',
        host: '[::1]:50241',
      },
      remoteAddress: '::ffff:127.0.0.1',
      controlToken: 'control-secret',
    }),
  )
})

test('assistantd http server rejects non-loopback listener hosts', async () => {
  await assert.rejects(
    () =>
      startAssistantHttpServer({
        controlToken: 'control-secret',
        host: '0.0.0.0',
        port: 0,
        service: createUnusedAssistantService(),
      }),
    /Assistant daemon listener host must be a loopback hostname or address\./u,
  )
})

test('assistantd http server enforces bearer auth, validates requests, and routes calls to the local assistant service', async () => {
  const sendMessage = vi.fn(
    async (
      input: Parameters<AssistantLocalService['sendMessage']>[0],
    ): Promise<AssistantSendMessageResult> => ({
      ...createAssistantSendMessageResult(input.prompt, 'daemon response'),
      vault: input.vault ?? '/tmp/vault',
    }),
  )
  const getSession = vi.fn(async (input: { sessionId: string }): Promise<AssistantSession> => ({
    ...TEST_SESSION,
    sessionId: input.sessionId,
  }))
  const getCronJob = vi.fn(async (input: { job: string }): Promise<AssistantCronJob> => ({
    ...TEST_CRON_JOB,
    jobId: input.job,
  }))
  const getCronTarget = vi.fn(
    async (input: { job: string }): Promise<AssistantCronTarget> =>
      createAssistantCronTarget(input.job, TEST_THREAD_BINDING_DELIVERY),
  )
  const setCronTarget = vi.fn(
    async (
      input: Parameters<AssistantLocalService['setCronTarget']>[0],
    ): Promise<AssistantSetCronTargetResult> =>
      createSetCronTargetResult({
        channel: input.channel,
        deliveryTarget: input.deliveryTarget,
        dryRun: input.dryRun,
        identityId: input.identityId,
        jobId: input.job,
        resetContinuity: input.resetContinuity,
        continuityReset: input.resetContinuity ?? false,
      }),
  )
  const getOutboxIntent = vi.fn(async (input: { intentId: string }): Promise<AssistantOutboxIntent> => ({
    ...TEST_OUTBOX_INTENT,
    intentId: input.intentId,
  }))
  const getStatus = vi.fn(
    async (
      _input?: Parameters<AssistantLocalService['getStatus']>[0],
    ): Promise<AssistantStatus> => TEST_ASSISTANT_STATUS,
  )
  const drainOutbox = vi.fn(
    async (
      _input?: Parameters<AssistantLocalService['drainOutbox']>[0],
    ) => ({ attempted: 0, sent: 0, failed: 0, queued: 0 }),
  )
  const processDueCron = vi.fn(
    async (
      _input?: Parameters<AssistantLocalService['processDueCron']>[0],
    ): Promise<AssistantProcessDueCronResult> => EMPTY_PROCESS_DUE_CRON_RESULT,
  )
  const updateSessionOptions = vi.fn(
    async (
      _input: Parameters<AssistantLocalService['updateSessionOptions']>[0],
    ): Promise<AssistantSessionOptionsResult> => TEST_SESSION,
  )
  const service: AssistantLocalService = {
    drainOutbox,
    getCronJob,
    getCronTarget,
    getCronStatus: async () => TEST_CRON_STATUS,
    getOutboxIntent,
    getSession,
    health: async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    getStatus,
    listCronJobs: async () => [TEST_CRON_JOB],
    listCronRuns: async () => ({
      jobId: TEST_CRON_JOB.jobId,
      runs: [TEST_CRON_RUN],
    }),
    listOutbox: async () => [TEST_OUTBOX_INTENT],
    listSessions: async () => [TEST_SESSION],
    openConversation: async () => createAssistantOpenConversationResult(true),
    processDueCron,
    setCronTarget,
    runAutomationOnce: async () => createAssistantRunAutomationResult(1),
    sendMessage,
    updateSessionOptions,
    vault: '/tmp/vault',
  }

  const baseUrl = 'http://127.0.0.1:50241'
  const controlToken = 'secret-token'
  const fetch = createAssistantdTestFetch(
    createAssistantHttpRequestHandler({
      controlToken,
      host: '127.0.0.1',
      port: 0,
      service,
    }),
    baseUrl,
  )
  const handle = {
    address: {
      baseUrl,
    },
    close: async () => undefined,
  }

  try {
    const unauthorized = await fetch(`${handle.address.baseUrl}/healthz`)
    assert.equal(unauthorized.status, 401)

    const forbidden = await fetch(`${handle.address.baseUrl}/healthz`, {
      headers: {
        Authorization: 'Bearer secret-token',
      },
      remoteAddress: '8.8.8.8',
    })
    assert.equal(forbidden.status, 403)

    const health = await fetch(`${handle.address.baseUrl}/healthz`, {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    })
    assert.equal(health.status, 200)
    const healthPayload = await health.json() as {
      ok: boolean
      vault?: unknown
      vaultBound: boolean
    }
    assert.equal(healthPayload.ok, true)
    assert.equal(healthPayload.vaultBound, true)
    assert.equal('vault' in healthPayload, false)

    const message = await fetch(`${handle.address.baseUrl}/message`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operatorAuthority: 'direct-operator',
        vault: '/tmp/vault',
        prompt: 'hello over assistantd',
      }),
    })
    assert.equal(message.status, 200)
    const messagePayload = await message.json() as { response: string }
    assert.equal(messagePayload.response, 'daemon response')
    assert.equal(sendMessage.mock.calls[0]?.[0]?.prompt, 'hello over assistantd')
    assert.equal(
      sendMessage.mock.calls[0]?.[0]?.operatorAuthority,
      'direct-operator',
    )

    const sessionOptions = await fetch(`${handle.address.baseUrl}/session-options`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        providerOptions: {
          provider: 'codex-cli',
          model: 'gpt-5.4',
        },
        sessionId: TEST_SESSION.sessionId,
        vault: '/tmp/vault',
      }),
    })
    assert.equal(sessionOptions.status, 200)
    assert.equal(
      requireFirstCallArg<{ sessionId: string }>(
        updateSessionOptions,
        'updateSessionOptions',
      ).sessionId,
      TEST_SESSION.sessionId,
    )

    const openConversation = await fetch(`${handle.address.baseUrl}/open-conversation`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
      }),
    })
    assert.equal(openConversation.status, 200)
    const openConversationPayload = await openConversation.json() as {
      created: boolean
      paths?: unknown
      session: { sessionId: string }
    }
    assert.equal(openConversationPayload.created, true)
    assert.equal(openConversationPayload.session.sessionId, TEST_SESSION.sessionId)
    assert.equal('paths' in openConversationPayload, false)

    const status = await fetch(
      `${handle.address.baseUrl}/status?limit=7&sessionId=${encodeURIComponent(TEST_SESSION.sessionId)}&vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(status.status, 200)
    const getStatusInput = requireFirstCallArg<{
      limit?: number
      sessionId?: string | null
    }>(getStatus, 'getStatus')
    assert.equal(getStatusInput.limit, 7)
    assert.equal(getStatusInput.sessionId, TEST_SESSION.sessionId)

    const sessions = await fetch(
      `${handle.address.baseUrl}/sessions?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(sessions.status, 200)

    const session = await fetch(
      `${handle.address.baseUrl}/sessions/${encodeURIComponent('session_http_route')}?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(session.status, 200)
    const sessionPayload = await session.json() as { sessionId: string }
    assert.equal(sessionPayload.sessionId, 'session_http_route')
    assert.equal(getSession.mock.calls[0]?.[0]?.sessionId, 'session_http_route')

    const outbox = await fetch(
      `${handle.address.baseUrl}/outbox?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(outbox.status, 200)
    const outboxPayload = await outbox.json() as unknown[]
    const firstOutboxPayload = outboxPayload[0]
    assertLegacyMessageOutboxIntentWire(firstOutboxPayload)
    assert.equal(firstOutboxPayload.intentId, TEST_OUTBOX_INTENT.intentId)

    const outboxIntent = await fetch(
      `${handle.address.baseUrl}/outbox/${encodeURIComponent('outbox_http_route')}?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(outboxIntent.status, 200)
    const outboxIntentPayload = await outboxIntent.json() as unknown
    assertLegacyMessageOutboxIntentWire(outboxIntentPayload)
    assert.equal(outboxIntentPayload.intentId, 'outbox_http_route')
    assert.equal(getOutboxIntent.mock.calls[0]?.[0]?.intentId, 'outbox_http_route')

    const outboxDrain = await fetch(`${handle.address.baseUrl}/outbox/drain`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 3.8,
        now: '2026-03-28T00:00:00.000Z',
        vault: '/tmp/vault',
      }),
    })
    assert.equal(outboxDrain.status, 200)
    assert.equal(
      requireFirstCallArg<{ limit?: number }>(drainOutbox, 'drainOutbox').limit,
      3,
    )

    const cronStatus = await fetch(
      `${handle.address.baseUrl}/cron/status?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(cronStatus.status, 200)

    const cronJobs = await fetch(
      `${handle.address.baseUrl}/cron/jobs?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(cronJobs.status, 200)
    const cronJobsPayload = await cronJobs.json() as Array<{ jobId: string }>
    assert.equal(cronJobsPayload[0]?.jobId, TEST_CRON_JOB.jobId)

    const cronJob = await fetch(
      `${handle.address.baseUrl}/cron/jobs/${encodeURIComponent('cron_http_route')}?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(cronJob.status, 200)
    const cronJobPayload = await cronJob.json() as { jobId: string }
    assert.equal(cronJobPayload.jobId, 'cron_http_route')
    assert.equal(getCronJob.mock.calls[0]?.[0]?.job, 'cron_http_route')

    const cronTarget = await fetch(
      `${handle.address.baseUrl}/cron/jobs/${encodeURIComponent('cron_http_route')}/target?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(cronTarget.status, 200)
    const cronTargetPayload = await cronTarget.json() as {
      jobId: string
      bindingDelivery: {
        kind: string
      } | null
    }
    assert.equal(cronTargetPayload.jobId, 'cron_http_route')
    assert.equal(cronTargetPayload.bindingDelivery?.kind, 'thread')
    assert.equal(getCronTarget.mock.calls[0]?.[0]?.job, 'cron_http_route')

    const cronTargetUpdate = await fetch(
      `${handle.address.baseUrl}/cron/jobs/${encodeURIComponent('cron_http_route')}/target?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'email',
          identityId: 'sender@example.com',
          deliveryTarget: 'me@example.com',
          dryRun: true,
          vault: '/tmp/vault',
        }),
      },
    )
    assert.equal(cronTargetUpdate.status, 200)
    const cronTargetUpdatePayload = await cronTargetUpdate.json() as {
      changed: boolean
      dryRun: boolean
      afterTarget: {
        target: {
          channel: string | null
          identityId: string | null
        }
      }
    }
    assert.equal(cronTargetUpdatePayload.changed, true)
    assert.equal(cronTargetUpdatePayload.dryRun, true)
    assert.equal(cronTargetUpdatePayload.afterTarget.target.channel, 'email')
    assert.equal(
      cronTargetUpdatePayload.afterTarget.target.identityId,
      'sender@example.com',
    )
    assert.equal(setCronTarget.mock.calls[0]?.[0]?.job, 'cron_http_route')
    assert.equal(setCronTarget.mock.calls[0]?.[0]?.resetContinuity, undefined)

    const cronRuns = await fetch(
      `${handle.address.baseUrl}/cron/runs?job=${encodeURIComponent(TEST_CRON_JOB.jobId)}&limit=3&vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(cronRuns.status, 200)
    const cronRunsPayload = await cronRuns.json() as {
      jobId: string
      runs: Array<{ runId: string }>
    }
    assert.equal(cronRunsPayload.jobId, TEST_CRON_JOB.jobId)
    assert.equal(cronRunsPayload.runs[0]?.runId, TEST_CRON_RUN.runId)

    const automation = await fetch(`${handle.address.baseUrl}/automation/run-once`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        once: true,
        startDaemon: false,
      }),
    })
    assert.equal(automation.status, 200)
    const automationPayload = await automation.json() as { scans: number }
    assert.equal(automationPayload.scans, 1)

    const processCron = await fetch(`${handle.address.baseUrl}/cron/process-due`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deliveryDispatchMode: 'queue-only',
        limit: 9.7,
        vault: '/tmp/vault',
      }),
    })
    assert.equal(processCron.status, 200)
    const processDueCronInput = requireFirstCallArg<{
      deliveryDispatchMode?: string
      limit?: number
    }>(processDueCron, 'processDueCron')
    assert.equal(processDueCronInput.deliveryDispatchMode, 'queue-only')
    assert.equal(processDueCronInput.limit, 9)

    const invalidAutomationDispatchMode = await fetch(`${handle.address.baseUrl}/automation/run-once`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deliveryDispatchMode: 'later',
      }),
    })
    assert.equal(invalidAutomationDispatchMode.status, 400)
    assert.match(await invalidAutomationDispatchMode.text(), /deliveryDispatchMode/u)

    const invalidCronDispatchMode = await fetch(`${handle.address.baseUrl}/cron/process-due`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deliveryDispatchMode: 'later',
      }),
    })
    assert.equal(invalidCronDispatchMode.status, 400)
    assert.match(await invalidCronDispatchMode.text(), /deliveryDispatchMode/u)

    const invalidPrompt = await fetch(`${handle.address.baseUrl}/message`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: '   ',
      }),
    })
    assert.equal(invalidPrompt.status, 400)
    assert.match(await invalidPrompt.text(), /non-empty prompt/u)

    const invalidSessionOptions = await fetch(`${handle.address.baseUrl}/session-options`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: TEST_SESSION.sessionId,
      }),
    })
    assert.equal(invalidSessionOptions.status, 400)
    assert.match(await invalidSessionOptions.text(), /providerOptions/u)

    const malformedJson = await fetch(`${handle.address.baseUrl}/message`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: '{',
    })
    assert.equal(malformedJson.status, 400)

    const invalidStatusLimit = await fetch(`${handle.address.baseUrl}/status?limit=oops`, {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    })
    assert.equal(invalidStatusLimit.status, 400)
    assert.match(await invalidStatusLimit.text(), /query parameter limit/u)

    const missingCronRunsJob = await fetch(`${handle.address.baseUrl}/cron/runs`, {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    })
    assert.equal(missingCronRunsJob.status, 400)
    assert.match(await missingCronRunsJob.text(), /require a job query parameter/u)

    const notFound = await fetch(`${handle.address.baseUrl}/nope`, {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    })
    assert.equal(notFound.status, 404)

    const invalidSession = await fetch(
      `${handle.address.baseUrl}/sessions/${encodeURIComponent('../outside')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(invalidSession.status, 400)
    assert.match(await invalidSession.text(), /session id/u)

    const missingSessionId = await fetch(`${handle.address.baseUrl}/sessions/`, {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    })
    assert.equal(missingSessionId.status, 400)
    assert.match(await missingSessionId.text(), /requires an identifier/u)

    const invalidOutboxIntent = await fetch(
      `${handle.address.baseUrl}/outbox/${encodeURIComponent('../outside')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(invalidOutboxIntent.status, 400)
    assert.match(await invalidOutboxIntent.text(), /outbox intent/u)

    const invalidCronJob = await fetch(
      `${handle.address.baseUrl}/cron/jobs/${encodeURIComponent('../outside')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(invalidCronJob.status, 400)
    assert.match(await invalidCronJob.text(), /cron job id/u)

    const invalidCronRunsJob = await fetch(
      `${handle.address.baseUrl}/cron/runs?job=${encodeURIComponent('../outside')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(invalidCronRunsJob.status, 400)
    assert.match(await invalidCronRunsJob.text(), /cron job id/u)

    for (const engineOwnedField of [
      { actorId: 'stale-actor' },
      { allowBindingRebind: true },
    ]) {
      const invalidEngineOwnedField = await fetch(
        `${handle.address.baseUrl}/message`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${controlToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...engineOwnedField,
            participantId: 'intended-participant',
            prompt: 'hello over assistantd',
            sessionId: TEST_SESSION.sessionId,
            vault: '/tmp/vault',
          }),
        },
      )
      assert.equal(invalidEngineOwnedField.status, 400)
      assert.match(
        await invalidEngineOwnedField.text(),
        /field .* is not supported/u,
      )
    }
    assert.equal(sendMessage.mock.calls.length, 1)

    const invalidConversationField = await fetch(`${handle.address.baseUrl}/message`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        prompt: 'hello over assistantd',
        conversation: {
          actorId: 'legacy-contact',
        },
      }),
    })
    assert.equal(invalidConversationField.status, 400)
    assert.match(
      await invalidConversationField.text(),
      /canonical nested conversation-ref shape/u,
    )

    const invalidConversationDirectness = await fetch(`${handle.address.baseUrl}/message`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        prompt: 'hello over assistantd',
        conversation: {
          channel: 'telegram',
          directness: 'private-thread',
        },
      }),
    })
    assert.equal(invalidConversationDirectness.status, 400)
    assert.match(
      await invalidConversationDirectness.text(),
      /directness must be one of direct, group, or unknown/u,
    )

    const invalidOperatorAuthority = await fetch(`${handle.address.baseUrl}/message`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        prompt: 'hello over assistantd',
        operatorAuthority: 'bogus-authority',
      }),
    })
    assert.equal(invalidOperatorAuthority.status, 400)
    assert.match(
      await invalidOperatorAuthority.text(),
      /operatorAuthority must be one of direct-operator/u,
    )

    const oversizedBody = await fetch(`${handle.address.baseUrl}/message`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'x'.repeat(300_000),
      }),
    })
    assert.equal(oversizedBody.status, 413)
  } finally {
    await handle.close()
  }
})

test('assistantd http server does not expose local gateway routes', async () => {
  const baseUrl = 'http://127.0.0.1:50241'
  const controlToken = 'secret-token'
  const fetch = createAssistantdTestFetch(
    createAssistantHttpRequestHandler({
      controlToken,
      host: '127.0.0.1',
      port: 0,
      service: createUnusedAssistantService(),
    }),
    baseUrl,
  )

  for (const route of [
    '/gateway/conversations/list',
    '/gateway/conversations/get',
    '/gateway/messages/read',
    '/gateway/attachments/fetch',
    '/gateway/messages/send',
    '/gateway/events/poll',
    '/gateway/events/wait',
    '/gateway/permissions/list-open',
    '/gateway/permissions/respond',
  ]) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: 'POST',
      headers: {
        Authorization: createBearerAuthorization(controlToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        decision: 'approve',
        messageId: 'gwcm_removed',
        requestId: 'gwpr_removed',
        sessionKey: 'gwcs_removed',
        text: 'removed route',
        vault: '/tmp/vault',
      }),
    })

    assert.equal(response.status, 404, `${route} should stay removed`)
  }
})

test('assistantd http server maps bound-vault mismatches on assistant control routes to typed 400 responses', async () => {
  const configuredVault = '/tmp/vault'
  const otherVault = '/tmp/other-vault'
  const rejectMismatchedVault = (vault: string | null | undefined): void => {
    if (vault !== otherVault) {
      throw new Error(`Expected the test request to target ${otherVault}.`)
    }
    throw createAssistantdVaultMismatchError({
      configuredVault,
      requestedVault: otherVault,
    })
  }
  const service: AssistantLocalService = {
    ...createUnusedAssistantService(),
    drainOutbox: async (input) => {
      rejectMismatchedVault(input?.vault)
      return { attempted: 0, sent: 0, failed: 0, queued: 0 }
    },
    getCronJob: async (input) => {
      rejectMismatchedVault(input.vault)
      return TEST_CRON_JOB
    },
    getCronTarget: async (input) => {
      rejectMismatchedVault(input.vault)
      return createAssistantCronTarget(input.job, TEST_THREAD_BINDING_DELIVERY)
    },
    getCronStatus: async (input) => {
      rejectMismatchedVault(input?.vault)
      return TEST_CRON_STATUS
    },
    getOutboxIntent: async (input) => {
      rejectMismatchedVault(input.vault)
      return TEST_OUTBOX_INTENT
    },
    getSession: async (input) => {
      rejectMismatchedVault(input.vault)
      return TEST_SESSION
    },
    getStatus: async (input) => {
      rejectMismatchedVault(input?.vault)
      return TEST_ASSISTANT_STATUS
    },
    listCronJobs: async (input) => {
      rejectMismatchedVault(input?.vault)
      return [TEST_CRON_JOB]
    },
    listCronRuns: async (input) => {
      rejectMismatchedVault(input.vault)
      return { jobId: input.job, runs: [TEST_CRON_RUN] }
    },
    listOutbox: async (input) => {
      rejectMismatchedVault(input?.vault)
      return [TEST_OUTBOX_INTENT]
    },
    listSessions: async (input) => {
      rejectMismatchedVault(input?.vault)
      return [TEST_SESSION]
    },
    processDueCron: async (input) => {
      rejectMismatchedVault(input?.vault)
      return EMPTY_PROCESS_DUE_CRON_RESULT
    },
    runAutomationOnce: async (input) => {
      rejectMismatchedVault(input?.vault)
      return createAssistantRunAutomationResult(0)
    },
    sendMessage: async (input) => {
      rejectMismatchedVault(input.vault)
      return createAssistantSendMessageResult(input.prompt, 'daemon response')
    },
    setCronTarget: async (input) => {
      rejectMismatchedVault(input.vault)
      return createSetCronTargetResult({ jobId: input.job })
    },
    updateSessionOptions: async (input) => {
      rejectMismatchedVault(input.vault)
      return TEST_SESSION
    },
    vault: configuredVault,
  }
  const baseUrl = 'http://127.0.0.1:50241'
  const controlToken = 'secret-token'
  const fetch = createAssistantdTestFetch(
    createAssistantHttpRequestHandler({
      controlToken,
      host: '127.0.0.1',
      port: 0,
      service,
    }),
    baseUrl,
  )
  const encodedVault = encodeURIComponent(otherVault)
  const authenticatedJsonHeaders = {
    Authorization: createBearerAuthorization(controlToken),
    'Content-Type': 'application/json',
  }
  const authenticatedHeaders = {
    Authorization: createBearerAuthorization(controlToken),
  }
  const cases: Array<{
    init?: RequestInit
    path: string
  }> = [
    { path: `/status?vault=${encodedVault}` },
    { path: `/sessions?vault=${encodedVault}` },
    { path: `/sessions/${encodeURIComponent(TEST_SESSION.sessionId)}?vault=${encodedVault}` },
    { path: `/outbox?vault=${encodedVault}` },
    { path: `/outbox/${encodeURIComponent(TEST_OUTBOX_INTENT.intentId)}?vault=${encodedVault}` },
    { path: `/cron/status?vault=${encodedVault}` },
    { path: `/cron/jobs?vault=${encodedVault}` },
    { path: `/cron/jobs/${encodeURIComponent(TEST_CRON_JOB.jobId)}?vault=${encodedVault}` },
    { path: `/cron/jobs/${encodeURIComponent(TEST_CRON_JOB.jobId)}/target?vault=${encodedVault}` },
    { path: `/cron/runs?job=${encodeURIComponent(TEST_CRON_JOB.jobId)}&vault=${encodedVault}` },
    {
      path: '/message',
      init: {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          vault: otherVault,
          prompt: 'hello',
        }),
      },
    },
    {
      path: '/session-options',
      init: {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          vault: otherVault,
          sessionId: TEST_SESSION.sessionId,
          providerOptions: {
            provider: 'codex-cli',
          },
        }),
      },
    },
    {
      path: '/outbox/drain',
      init: {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          vault: otherVault,
        }),
      },
    },
    {
      path: '/automation/run-once',
      init: {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          vault: otherVault,
        }),
      },
    },
    {
      path: '/cron/process-due',
      init: {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          vault: otherVault,
        }),
      },
    },
    {
      path: `/cron/jobs/${encodeURIComponent(TEST_CRON_JOB.jobId)}/target`,
      init: {
        method: 'POST',
        headers: authenticatedJsonHeaders,
        body: JSON.stringify({
          vault: otherVault,
          channel: 'email',
          deliveryTarget: 'person@example.com',
        }),
      },
    },
  ]

  for (const entry of cases) {
    const response = await fetch(`${baseUrl}${entry.path}`, {
      headers: authenticatedHeaders,
      ...entry.init,
    })
    assert.equal(response.status, 400, entry.path)
    const payload = await response.json() as { code?: string; error?: string }
    assert.equal(payload.code, 'ASSISTANTD_VAULT_MISMATCH', entry.path)
    assert.equal(
      payload.error,
      'Request vault does not match the daemon-bound vault.',
      entry.path,
    )
    assert.doesNotMatch(payload.error ?? '', /\/tmp/u, entry.path)
  }
})

test('assistant http handler rejects continuous automation without the inbox daemon', async () => {
  const service: AssistantLocalService = {
    drainOutbox: async () => ({ attempted: 0, sent: 0, failed: 0, queued: 0 }),
    getSession: async () => TEST_SESSION,
    health: async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    getStatus: async () => TEST_ASSISTANT_STATUS,
    listSessions: async () => [],
    listCronJobs: async () => [],
    listCronRuns: async (): Promise<AssistantCronRuns> => ({ jobId: TEST_CRON_JOB.jobId, runs: [] }),
    listOutbox: async () => [],
    getOutboxIntent: async () => null,
    getCronJob: async () => TEST_CRON_JOB,
    getCronTarget: async () => createAssistantCronTarget(TEST_CRON_JOB.jobId, null),
    getCronStatus: async () => EMPTY_CRON_STATUS,
    openConversation: async () => createAssistantOpenConversationResult(true),
    processDueCron: async () => EMPTY_PROCESS_DUE_CRON_RESULT,
    setCronTarget: async () => createSetCronTargetResult({ changed: false, jobId: TEST_CRON_JOB.jobId }),
    runAutomationOnce: async () => {
      throw new Error(
        'Continuous assistant automation now requires the inbox daemon. Rerun in continuous mode with the daemon enabled, or use once=true for a one-shot pass.',
      )
    },
    sendMessage: async () => createAssistantSendMessageResult('hello', 'daemon response'),
    updateSessionOptions: async () => TEST_SESSION,
    vault: '/tmp/vault',
  }

  const baseUrl = 'http://127.0.0.1:50241'
  const fetch = createAssistantdTestFetch(
    createAssistantHttpRequestHandler({
      controlToken: 'secret-token',
      host: '127.0.0.1',
      port: 0,
      service,
    }),
    baseUrl,
  )
  const handle = {
    address: {
      baseUrl,
    },
    close: async () => undefined,
  }

  try {
    const response = await fetch(`${handle.address.baseUrl}/automation/run-once`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        once: false,
        startDaemon: false,
        vault: '/tmp/vault',
      }),
    })
    assert.equal(response.status, 500)
    const payload = await response.json() as { error: string }
    assert.equal(payload.error, 'Assistant daemon request failed.')
  } finally {
    await handle.close()
  }
})

test('assistantd http server preserves typed assistant error codes for invalid ids and missing cron jobs', async () => {
  const getOutboxIntent = vi.fn(async (): Promise<AssistantOutboxIntent> => TEST_OUTBOX_INTENT)
  const service: AssistantLocalService = {
    drainOutbox: async () => ({ attempted: 0, sent: 0, failed: 0, queued: 0 }),
    getCronJob: async () => {
      throw Object.assign(new Error('Assistant cron job "missing-job" was not found.'), {
        code: 'ASSISTANT_CRON_JOB_NOT_FOUND',
      })
    },
    getCronTarget: async () =>
      createAssistantCronTarget(TEST_CRON_JOB.jobId, TEST_THREAD_BINDING_DELIVERY),
    getCronStatus: async () => EMPTY_CRON_STATUS,
    getOutboxIntent,
    getSession: async () => TEST_SESSION,
    health: async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    getStatus: async () => TEST_ASSISTANT_STATUS,
    listCronJobs: async () => [],
    listCronRuns: async () => ({ jobId: TEST_CRON_JOB.jobId, runs: [] }),
    listOutbox: async () => [],
    listSessions: async () => [TEST_SESSION],
    openConversation: async () => createAssistantOpenConversationResult(true),
    processDueCron: async () => EMPTY_PROCESS_DUE_CRON_RESULT,
    setCronTarget: async () => createSetCronTargetResult({ changed: false, jobId: TEST_CRON_JOB.jobId }),
    runAutomationOnce: async () => createAssistantRunAutomationResult(0),
    sendMessage: async () => createAssistantSendMessageResult('noop', 'noop'),
    updateSessionOptions: async () => TEST_SESSION,
    vault: '/tmp/vault',
  }

  const baseUrl = 'http://127.0.0.1:50241'
  const fetch = createAssistantdTestFetch(
    createAssistantHttpRequestHandler({
      controlToken: 'secret-token',
      host: '127.0.0.1',
      port: 0,
      service,
    }),
    baseUrl,
  )
  const handle = {
    address: {
      baseUrl,
    },
    close: async () => undefined,
  }

  try {
    const invalidOutbox = await fetch(
      `${handle.address.baseUrl}/outbox/${encodeURIComponent('../escape')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(invalidOutbox.status, 400)
    const invalidOutboxPayload = await invalidOutbox.json() as { code?: string }
    assert.equal(invalidOutboxPayload.code, 'ASSISTANT_INVALID_RUNTIME_ID')
    assert.equal(getOutboxIntent.mock.calls.length, 0)

    const missingCron = await fetch(
      `${handle.address.baseUrl}/cron/jobs/${encodeURIComponent('missing-job')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(missingCron.status, 404)
    const missingCronPayload = await missingCron.json() as { code?: string }
    assert.equal(missingCronPayload.code, 'ASSISTANT_CRON_JOB_NOT_FOUND')
  } finally {
    await handle.close()
  }
})

test('assistantd http server does not reflect raw internal errors back to the client', async () => {
  const service: AssistantLocalService = {
    drainOutbox: async () => ({ attempted: 0, sent: 0, failed: 0, queued: 0 }),
    getSession: async () => TEST_SESSION,
    health: async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    getStatus: async () => {
      throw new Error('database credentials leaked')
    },
    listSessions: async () => [],
    listCronJobs: async () => [],
    listCronRuns: async () => ({
      jobId: TEST_CRON_JOB.jobId,
      runs: [],
    }),
    listOutbox: async () => [],
    getOutboxIntent: async () => null,
    getCronJob: async () => TEST_CRON_JOB,
    getCronTarget: async () => createAssistantCronTarget(TEST_CRON_JOB.jobId, null),
    getCronStatus: async () => EMPTY_CRON_STATUS,
    openConversation: async () => createAssistantOpenConversationResult(true),
    processDueCron: async () => EMPTY_PROCESS_DUE_CRON_RESULT,
    setCronTarget: async () => createSetCronTargetResult({ changed: false, jobId: TEST_CRON_JOB.jobId }),
    runAutomationOnce: async () => createAssistantRunAutomationResult(0),
    sendMessage: async () => createAssistantSendMessageResult('hello', 'daemon response'),
    updateSessionOptions: async () => TEST_SESSION,
    vault: '/tmp/vault',
  }

  const baseUrl = 'http://127.0.0.1:50241'
  const fetch = createAssistantdTestFetch(
    createAssistantHttpRequestHandler({
      controlToken: 'secret-token',
      host: '127.0.0.1',
      port: 0,
      service,
    }),
    baseUrl,
  )
  const handle = {
    address: {
      baseUrl,
    },
    close: async () => undefined,
  }

  try {
    const response = await fetch(`${handle.address.baseUrl}/status`, {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    })
    assert.equal(response.status, 500)
    const payload = await response.json() as { error: string }
    assert.equal(payload.error, 'Assistant daemon request failed.')
  } finally {
    await handle.close()
  }
})
