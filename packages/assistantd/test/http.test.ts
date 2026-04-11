import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { afterEach, test, vi } from 'vitest'
import { AssistantHttpRequestError } from '../src/http-protocol.js'
import {
  assertAssistantControlRequest,
  createAssistantHttpRequestHandler,
  startAssistantHttpServer,
  type AssistantHttpRequestHandler,
} from '../src/http.js'
import type { AssistantLocalService } from '../src/service.js'

const TEST_SESSION = {
  schema: 'murph.assistant-session.v4',
  sessionId: 'session_http_test',
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
  resumeState: null,
  provider: 'codex-cli',
  providerOptions: {
    model: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
  },
  providerBinding: null,
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
} as const

const TEST_OUTBOX_INTENT = {
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
  dedupeKey: 'dedupe-key',
  targetFingerprint: 'target-fingerprint',
  channel: 'telegram',
  identityId: null,
  actorId: 'chat-123',
  threadId: 'chat-123',
  threadIsDirect: true,
  replyToMessageId: null,
  bindingDelivery: {
    kind: 'participant',
    target: 'chat-123',
  },
  explicitTarget: null,
  delivery: null,
  deliveryConfirmationPending: false,
  deliveryIdempotencyKey: null,
  deliveryTransportIdempotent: false,
  lastError: null,
} as const

const TEST_CRON_JOB = {
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
    sourceThreadId: 'chat-123',
    deliveryTarget: null,
    deliverResponse: true,
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
} as const

const TEST_CRON_RUN = {
  schema: 'murph.assistant-cron-run.v1',
  runId: 'cronrun_http_test',
  jobId: TEST_CRON_JOB.jobId,
  trigger: 'scheduled',
  status: 'succeeded',
  startedAt: '2026-03-28T00:00:00.000Z',
  finishedAt: '2026-03-28T00:00:10.000Z',
  sessionId: TEST_SESSION.sessionId,
  response: 'done',
  responseLength: 4,
  error: null,
} as const

const TEST_GATEWAY_CONVERSATION = {
  schema: 'murph.gateway-conversation.v1',
  sessionKey: 'gwcs_http_test',
  title: 'Lab thread',
  lastMessagePreview: 'Please send the latest PDF.',
  lastActivityAt: '2026-03-28T00:00:00.000Z',
  messageCount: 2,
  canSend: true,
  route: {
    channel: 'email',
    identityId: 'murph@example.com',
    participantId: 'contact:alex',
    threadId: 'thread-labs',
    directness: 'group',
    reply: {
      kind: 'thread',
      target: 'thread-labs',
    },
  },
} as const

const TEST_GATEWAY_ATTACHMENT = {
  schema: 'murph.gateway-attachment.v1',
  attachmentId: 'gwca_http_test',
  messageId: 'gwcm_http_test',
  kind: 'document',
  mime: 'application/pdf',
  fileName: 'labs.pdf',
  byteSize: 3,
  parseState: 'pending',
  extractedText: null,
  transcriptText: null,
} as const

const TEST_GATEWAY_MESSAGE = {
  schema: 'murph.gateway-message.v1',
  messageId: TEST_GATEWAY_ATTACHMENT.messageId,
  sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
  direction: 'inbound',
  createdAt: '2026-03-28T00:00:00.000Z',
  actorDisplayName: 'Alex',
  text: 'Here is the latest lab PDF.',
  attachments: [TEST_GATEWAY_ATTACHMENT],
} as const

function createGatewayServiceMock(
  overrides: Partial<AssistantLocalService['gateway']> = {},
): AssistantLocalService['gateway'] {
  return {
    fetchAttachments: async () => [TEST_GATEWAY_ATTACHMENT as any],
    getConversation: async () => TEST_GATEWAY_CONVERSATION as any,
    listConversations: async () => ({
      conversations: [TEST_GATEWAY_CONVERSATION as any],
      nextCursor: null,
    }),
    listOpenPermissions: async () => [],
    pollEvents: async (input?: any) => ({
      events: [],
      nextCursor: input?.cursor ?? 0,
      live: true,
    }),
    readMessages: async () => ({
      messages: [TEST_GATEWAY_MESSAGE as any],
      nextCursor: null,
    }),
    respondToPermission: async () => null,
    sendMessage: async (input: any) => ({
      sessionKey: input.sessionKey,
      messageId: 'gwcm_sent_http_test',
      queued: false,
      delivery: null,
    }),
    waitForEvents: async (input?: any) => ({
      events: [],
      nextCursor: input?.cursor ?? 0,
      live: true,
    }),
    ...overrides,
  } as AssistantLocalService['gateway']
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
      calls: ReadonlyArray<readonly unknown[]>
    }
  },
  label: string,
): T {
  const firstArg = mock.mock.calls[0]?.[0]
  assert.notEqual(firstArg, undefined, `${label} should be called with an argument`)
  return firstArg as T
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

test('assertAssistantControlRequest accepts loopback requests with a loopback host header', () => {
  assert.doesNotThrow(() =>
    assertAssistantControlRequest({
      headers: {
        authorization: 'Bearer control-secret',
        host: 'localhost:50241',
      },
      remoteAddress: '127.0.0.1',
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
        service: {} as AssistantLocalService,
      }),
    /Assistant daemon listener host must be a loopback hostname or address\./u,
  )
})

test('assistantd http server enforces bearer auth, validates requests, and routes calls to the local assistant service', async () => {
  const sendMessage = vi.fn(async (input: any) => ({
    vault: input.vault ?? '/tmp/vault',
    status: 'completed',
    prompt: input.prompt,
    response: 'daemon response',
    session: TEST_SESSION,
    delivery: null,
    deliveryDeferred: false,
    deliveryIntentId: null,
    deliveryError: null,
    blocked: null,
  }))
  const getSession = vi.fn(async (input: { sessionId: string }) => ({
    ...TEST_SESSION,
    sessionId: input.sessionId,
  }))
  const getCronJob = vi.fn(async (input: { job: string }) => ({
    ...TEST_CRON_JOB,
    jobId: input.job,
  }))
  const getCronTarget = vi.fn(async (input: { job: string }) => ({
    jobId: input.job,
    jobName: TEST_CRON_JOB.name,
    target: TEST_CRON_JOB.target,
    bindingDelivery: {
      kind: 'thread',
      target: 'chat-123',
    },
  }))
  const setCronTarget = vi.fn(async (input: {
    channel?: string | null
    deliveryTarget?: string | null
    dryRun?: boolean
    identityId?: string | null
    job: string
    resetContinuity?: boolean
  }) => ({
    job: {
      ...TEST_CRON_JOB,
      jobId: input.job,
      target: {
        ...TEST_CRON_JOB.target,
        sessionId: input.resetContinuity ? null : TEST_CRON_JOB.target.sessionId,
        alias: input.resetContinuity ? null : TEST_CRON_JOB.target.alias,
        channel: input.channel ?? TEST_CRON_JOB.target.channel,
        identityId: input.identityId ?? null,
        participantId: null,
        sourceThreadId: null,
        deliveryTarget: input.deliveryTarget ?? null,
      },
    },
    beforeTarget: {
      jobId: input.job,
      jobName: TEST_CRON_JOB.name,
      target: TEST_CRON_JOB.target,
      bindingDelivery: {
        kind: 'thread',
        target: 'chat-123',
      },
    },
    afterTarget: {
      jobId: input.job,
      jobName: TEST_CRON_JOB.name,
      target: {
        ...TEST_CRON_JOB.target,
        sessionId: input.resetContinuity ? null : TEST_CRON_JOB.target.sessionId,
        alias: input.resetContinuity ? null : TEST_CRON_JOB.target.alias,
        channel: input.channel ?? TEST_CRON_JOB.target.channel,
        identityId: input.identityId ?? null,
        participantId: null,
        sourceThreadId: null,
        deliveryTarget: input.deliveryTarget ?? null,
      },
      bindingDelivery: null,
    },
    changed: true,
    continuityReset: input.resetContinuity ?? false,
    dryRun: input.dryRun ?? false,
  }))
  const getOutboxIntent = vi.fn(async (input: { intentId: string }) => ({
    ...TEST_OUTBOX_INTENT,
    intentId: input.intentId,
  }))
  const getStatus = vi.fn(async () => ({
    vault: '/tmp/vault',
    stateRoot: '/tmp/vault/.runtime/operations/assistant',
    statusPath: '/tmp/vault/.runtime/operations/assistant/status.json',
    outboxRoot: '/tmp/vault/.runtime/operations/assistant/outbox',
    diagnosticsPath: '/tmp/vault/.runtime/operations/assistant/diagnostics.snapshot.json',
    failoverStatePath: '/tmp/vault/.runtime/operations/assistant/failover.json',
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
      inboxScanCursor: null,
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
        providerFailovers: 0,
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
    failover: {
      schema: 'murph.assistant-failover-state.v1',
      updatedAt: '2026-03-28T00:00:00.000Z',
      routes: [],
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
        staleProviderRecoveryPruned: 0,
        staleQuarantinePruned: 0,
        staleLocksCleared: 0,
        notes: [],
      },
    },
    recentTurns: [],
    warnings: [],
  } as any))
  const listGatewayConversations = vi.fn(async () => ({
    conversations: [TEST_GATEWAY_CONVERSATION as any],
    nextCursor: null,
  }))
  const getGatewayConversation = vi.fn(async () => TEST_GATEWAY_CONVERSATION as any)
  const readGatewayMessages = vi.fn(async () => ({
    messages: [TEST_GATEWAY_MESSAGE as any],
    nextCursor: null,
  }))
  const fetchGatewayAttachments = vi.fn(async () => [TEST_GATEWAY_ATTACHMENT as any])
  const gatewaySendMessage = vi.fn(async (input: any) => ({
    sessionKey: input.sessionKey,
    messageId: 'gwcm_sent_http_test',
    queued: true,
    delivery: null,
  }))
  const gatewayPollEvents = vi.fn(async (input?: any) => ({
    events: [],
    nextCursor: input?.cursor ?? 0,
    live: true,
  }))
  const gatewayWaitForEvents = vi.fn(async (input?: any) => ({
    events: [],
    nextCursor: input?.cursor ?? 0,
    live: true,
  }))
  const gatewayListOpenPermissions = vi.fn(async () => [])
  const gatewayRespondToPermission = vi.fn(async () => null)
  const gateway = createGatewayServiceMock({
    fetchAttachments: fetchGatewayAttachments,
    getConversation: getGatewayConversation,
    listConversations: listGatewayConversations,
    listOpenPermissions: gatewayListOpenPermissions,
    pollEvents: gatewayPollEvents,
    readMessages: readGatewayMessages,
    respondToPermission: gatewayRespondToPermission,
    sendMessage: gatewaySendMessage,
    waitForEvents: gatewayWaitForEvents,
  })
  const drainOutbox = vi.fn(async () => ({ attempted: 0, sent: 0, failed: 0, queued: 0 }))
  const processDueCron = vi.fn(async () => ({ failed: 0, processed: 0, succeeded: 0 } as any))
  const updateSessionOptions = vi.fn(async () => TEST_SESSION as any)
  const service = {
    drainOutbox,
    getCronJob,
    getCronTarget,
    getCronStatus: async () => ({
      totalJobs: 1,
      enabledJobs: 1,
      dueJobs: 0,
      runningJobs: 0,
      nextRunAt: TEST_CRON_JOB.state.nextRunAt,
    } as any),
    getOutboxIntent,
    getSession,
    health: async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    getStatus,
    gateway,
    listCronJobs: async () => [TEST_CRON_JOB as any],
    listCronRuns: async () => ({
      jobId: TEST_CRON_JOB.jobId,
      runs: [TEST_CRON_RUN],
    }),
    listOutbox: async () => [TEST_OUTBOX_INTENT as any],
    listSessions: async () => [TEST_SESSION as any],
    openConversation: async () => ({
      created: true,
      session: TEST_SESSION as any,
    }),
    processDueCron,
    setCronTarget,
    runAutomationOnce: async () => ({
      vault: '/tmp/vault',
      startedAt: '2026-03-28T00:00:00.000Z',
      stoppedAt: '2026-03-28T00:00:00.000Z',
      reason: 'completed',
      daemonStarted: false,
      scans: 1,
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
    } as any),
    sendMessage,
    updateSessionOptions,
    vault: '/tmp/vault',
  } as AssistantLocalService

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
        operatorAuthority: 'accepted-inbound-message',
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
      'accepted-inbound-message',
    )

    const sessionOptions = await fetch(`${handle.address.baseUrl}/session-options`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        providerOptions: {
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
        prompt: 'start over assistantd',
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
    const outboxPayload = await outbox.json() as Array<{ intentId: string }>
    assert.equal(outboxPayload[0]?.intentId, TEST_OUTBOX_INTENT.intentId)

    const outboxIntent = await fetch(
      `${handle.address.baseUrl}/outbox/${encodeURIComponent('outbox_http_route')}?vault=${encodeURIComponent('/tmp/vault')}`,
      {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      },
    )
    assert.equal(outboxIntent.status, 200)
    const outboxIntentPayload = await outboxIntent.json() as { intentId: string }
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

    const gatewayList = await fetch(`${handle.address.baseUrl}/gateway/conversations/list`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        includeLastMessage: true,
        limit: 5,
        search: 'lab',
      }),
    })
    assert.equal(gatewayList.status, 200)
    const gatewayListPayload = await gatewayList.json() as {
      conversations: Array<{ sessionKey: string }>
    }
    assert.equal(
      gatewayListPayload.conversations[0]?.sessionKey,
      TEST_GATEWAY_CONVERSATION.sessionKey,
    )
    const listGatewayConversationsInput = requireFirstCallArg<{
      limit?: number
      search?: string | null
    }>(listGatewayConversations, 'listGatewayConversations')
    assert.equal(listGatewayConversationsInput.limit, 5)
    assert.equal(listGatewayConversationsInput.search, 'lab')

    const gatewayConversation = await fetch(`${handle.address.baseUrl}/gateway/conversations/get`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
      }),
    })
    assert.equal(gatewayConversation.status, 200)
    const gatewayConversationPayload = await gatewayConversation.json() as {
      sessionKey: string
    }
    assert.equal(
      gatewayConversationPayload.sessionKey,
      TEST_GATEWAY_CONVERSATION.sessionKey,
    )
    assert.equal(
      requireFirstCallArg<{ sessionKey: string }>(
        getGatewayConversation,
        'getGatewayConversation',
      ).sessionKey,
      TEST_GATEWAY_CONVERSATION.sessionKey,
    )

    const gatewayMessages = await fetch(`${handle.address.baseUrl}/gateway/messages/read`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        oldestFirst: true,
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
      }),
    })
    assert.equal(gatewayMessages.status, 200)
    const gatewayMessagesPayload = await gatewayMessages.json() as {
      messages: Array<{ messageId: string }>
    }
    assert.equal(
      gatewayMessagesPayload.messages[0]?.messageId,
      TEST_GATEWAY_MESSAGE.messageId,
    )
    assert.equal(
      requireFirstCallArg<{ oldestFirst?: boolean }>(
        readGatewayMessages,
        'readGatewayMessages',
      ).oldestFirst,
      true,
    )

    const gatewayAttachments = await fetch(`${handle.address.baseUrl}/gateway/attachments/fetch`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        messageId: TEST_GATEWAY_MESSAGE.messageId,
      }),
    })
    assert.equal(gatewayAttachments.status, 200)
    const gatewayAttachmentsPayload = await gatewayAttachments.json() as Array<{
      attachmentId: string
    }>
    assert.equal(
      gatewayAttachmentsPayload[0]?.attachmentId,
      TEST_GATEWAY_ATTACHMENT.attachmentId,
    )
    assert.equal(
      requireFirstCallArg<{ messageId: string }>(
        fetchGatewayAttachments,
        'fetchGatewayAttachments',
      ).messageId,
      TEST_GATEWAY_MESSAGE.messageId,
    )

    const gatewaySend = await fetch(`${handle.address.baseUrl}/gateway/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        text: 'please follow up',
      }),
    })
    assert.equal(gatewaySend.status, 200)
    const gatewaySendPayload = await gatewaySend.json() as {
      queued: boolean
      sessionKey: string
    }
    assert.equal(gatewaySendPayload.sessionKey, TEST_GATEWAY_CONVERSATION.sessionKey)
    assert.equal(gatewaySendPayload.queued, true)
    assert.equal(gatewaySendMessage.mock.calls[0]?.[0]?.text, 'please follow up')

    const gatewayPoll = await fetch(`${handle.address.baseUrl}/gateway/events/poll`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        cursor: 7,
      }),
    })
    assert.equal(gatewayPoll.status, 200)
    assert.equal(
      requireFirstCallArg<{ cursor?: number }>(
        gatewayPollEvents,
        'gatewayPollEvents',
      ).cursor,
      7,
    )

    const gatewayWait = await fetch(`${handle.address.baseUrl}/gateway/events/wait`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        vault: '/tmp/vault',
        cursor: 8,
        timeoutMs: 100,
      }),
    })
    assert.equal(gatewayWait.status, 200)
    assert.equal(
      requireFirstCallArg<{ timeoutMs?: number }>(
        gatewayWaitForEvents,
        'gatewayWaitForEvents',
      ).timeoutMs,
      100,
    )

    const gatewayPermissions = await fetch(
      `${handle.address.baseUrl}/gateway/permissions/list-open`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vault: '/tmp/vault',
          sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        }),
      },
    )
    assert.equal(gatewayPermissions.status, 200)
    assert.equal(
      requireFirstCallArg<{ sessionKey: string }>(
        gatewayListOpenPermissions,
        'gatewayListOpenPermissions',
      ).sessionKey,
      TEST_GATEWAY_CONVERSATION.sessionKey,
    )

    const gatewayPermissionResponse = await fetch(
      `${handle.address.baseUrl}/gateway/permissions/respond`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vault: '/tmp/vault',
          decision: 'approve',
          requestId: 'perm_http_test',
        }),
      },
    )
    assert.equal(gatewayPermissionResponse.status, 200)
    assert.equal(
      requireFirstCallArg<{ requestId: string }>(
        gatewayRespondToPermission,
        'gatewayRespondToPermission',
      ).requestId,
      'perm_http_test',
    )

    const invalidGatewayList = await fetch(`${handle.address.baseUrl}/gateway/conversations/list`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 'bad',
      }),
    })
    assert.equal(invalidGatewayList.status, 400)

    const invalidGatewayConversation = await fetch(`${handle.address.baseUrl}/gateway/conversations/get`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionKey: '',
      }),
    })
    assert.equal(invalidGatewayConversation.status, 400)

    const invalidGatewayMessages = await fetch(`${handle.address.baseUrl}/gateway/messages/read`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionKey: 123,
      }),
    })
    assert.equal(invalidGatewayMessages.status, 400)

    const invalidGatewayAttachments = await fetch(`${handle.address.baseUrl}/gateway/attachments/fetch`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messageId: 123,
      }),
    })
    assert.equal(invalidGatewayAttachments.status, 400)

    const invalidGatewaySend = await fetch(`${handle.address.baseUrl}/gateway/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionKey: TEST_GATEWAY_CONVERSATION.sessionKey,
        text: '',
      }),
    })
    assert.equal(invalidGatewaySend.status, 400)

    const invalidGatewayPoll = await fetch(`${handle.address.baseUrl}/gateway/events/poll`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cursor: 'bad',
      }),
    })
    assert.equal(invalidGatewayPoll.status, 400)

    const invalidGatewayWait = await fetch(`${handle.address.baseUrl}/gateway/events/wait`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeoutMs: 'bad',
      }),
    })
    assert.equal(invalidGatewayWait.status, 400)

    const invalidGatewayPermissions = await fetch(
      `${handle.address.baseUrl}/gateway/permissions/list-open`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionKey: 123,
        }),
      },
    )
    assert.equal(invalidGatewayPermissions.status, 400)

    const invalidGatewayPermissionResponse = await fetch(
      `${handle.address.baseUrl}/gateway/permissions/respond`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          decision: 'approve',
        }),
      },
    )
    assert.equal(invalidGatewayPermissionResponse.status, 400)

    const mismatchedGatewayVault = await fetch(
      `${handle.address.baseUrl}/gateway/conversations/list`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vault: '/tmp/other-vault',
        }),
      },
    )
    assert.equal(mismatchedGatewayVault.status, 400)
    assert.match(await mismatchedGatewayVault.text(), /bound to \/tmp\/vault/u)

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
      /operatorAuthority must be one of direct-operator, accepted-inbound-message/u,
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

test('assistant http handler rejects continuous automation without the inbox daemon', async () => {
  const service = {
    drainOutbox: async () => ({ attempted: 0, sent: 0, failed: 0, queued: 0 }),
    getSession: async () => TEST_SESSION as any,
    health: async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    getStatus: async () => ({
      vault: '/tmp/vault',
      stateRoot: '/tmp/vault/.runtime/operations/assistant',
      statusPath: '/tmp/vault/.runtime/operations/assistant/status.json',
      outboxRoot: '/tmp/vault/.runtime/operations/assistant/outbox',
      diagnosticsPath: '/tmp/vault/.runtime/operations/assistant/diagnostics.snapshot.json',
      failoverStatePath: '/tmp/vault/.runtime/operations/assistant/failover.json',
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
        inboxScanCursor: null,
        autoReply: [],
        updatedAt: '2026-03-28T00:00:00.000Z',
      },
      sessions: [],
      diagnostics: {
        automationScans: 0,
        automationFailures: 0,
      },
      outbox: {
        queued: 0,
        sent: 0,
        failed: 0,
      },
    } as any),
    listSessions: async () => [],
    listCronJobs: async () => [],
    listCronRuns: async () => ({
      jobId: TEST_CRON_JOB.jobId,
      runs: [],
    }),
    listOutbox: async () => [],
    getOutboxIntent: async () => null,
    getCronJob: async () => TEST_CRON_JOB as any,
    getCronTarget: async () => ({
      jobId: TEST_CRON_JOB.jobId,
      jobName: TEST_CRON_JOB.name,
      target: TEST_CRON_JOB.target,
      bindingDelivery: null,
    }),
    getCronStatus: async () => ({
      totalJobs: 0,
      enabledJobs: 0,
      dueJobs: 0,
      runningJobs: 0,
      nextRunAt: null,
    }),
    openConversation: async () => ({ created: true, session: TEST_SESSION as any }),
    processDueCron: async () => ({ failed: 0, processed: 0, succeeded: 0 } as any),
    setCronTarget: async () => ({
      job: TEST_CRON_JOB as any,
      beforeTarget: {
        jobId: TEST_CRON_JOB.jobId,
        jobName: TEST_CRON_JOB.name,
        target: TEST_CRON_JOB.target,
        bindingDelivery: null,
      },
      afterTarget: {
        jobId: TEST_CRON_JOB.jobId,
        jobName: TEST_CRON_JOB.name,
        target: TEST_CRON_JOB.target,
        bindingDelivery: null,
      },
      changed: false,
      continuityReset: false,
      dryRun: false,
    }),
    runAutomationOnce: async () => {
      throw new Error(
        'Continuous assistant automation now requires the inbox daemon. Rerun in continuous mode with the daemon enabled, or use once=true for a one-shot pass.',
      )
    },
    sendMessage: async () => ({
      vault: '/tmp/vault',
      status: 'completed',
      prompt: 'hello',
      response: 'daemon response',
      session: TEST_SESSION,
      delivery: null,
      deliveryDeferred: false,
      deliveryIntentId: null,
      deliveryError: null,
      blocked: null,
    }),
    gateway: createGatewayServiceMock(),
    updateSessionOptions: async () => TEST_SESSION as any,
    vault: '/tmp/vault',
  } as AssistantLocalService

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
  const getOutboxIntent = vi.fn(async () => TEST_OUTBOX_INTENT as any)
  const service = {
    drainOutbox: async () => ({ attempted: 0, sent: 0, failed: 0, queued: 0 }),
    getCronJob: async () => {
      throw Object.assign(new Error('Assistant cron job "missing-job" was not found.'), {
        code: 'ASSISTANT_CRON_JOB_NOT_FOUND',
      })
    },
    getCronTarget: async () => ({
      jobId: TEST_CRON_JOB.jobId,
      jobName: TEST_CRON_JOB.name,
      target: TEST_CRON_JOB.target,
      bindingDelivery: {
        kind: 'thread',
        target: 'chat-123',
      },
    }),
    getCronStatus: async () => ({
      totalJobs: 0,
      enabledJobs: 0,
      dueJobs: 0,
      runningJobs: 0,
      nextRunAt: null,
    } as any),
    getOutboxIntent,
    getSession: async () => TEST_SESSION as any,
    health: async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    getStatus: async () => ({
      vault: '/tmp/vault',
      stateRoot: '/tmp/vault/.runtime/operations/assistant',
      statusPath: '/tmp/vault/.runtime/operations/assistant/status.json',
      outboxRoot: '/tmp/vault/.runtime/operations/assistant/outbox',
      diagnosticsPath: '/tmp/vault/.runtime/operations/assistant/diagnostics.snapshot.json',
      failoverStatePath: '/tmp/vault/.runtime/operations/assistant/failover.json',
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
        inboxScanCursor: null,
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
          providerFailovers: 0,
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
      failover: {
        schema: 'murph.assistant-failover-state.v1',
        updatedAt: '2026-03-28T00:00:00.000Z',
        routes: [],
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
          staleProviderRecoveryPruned: 0,
          staleQuarantinePruned: 0,
          staleLocksCleared: 0,
          notes: [],
        },
      },
      recentTurns: [],
      warnings: [],
    } as any),
    listCronJobs: async () => [],
    listCronRuns: async () => ({ jobId: TEST_CRON_JOB.jobId, runs: [] }),
    listOutbox: async () => [],
    listSessions: async () => [TEST_SESSION as any],
    openConversation: async () => ({ created: true, session: TEST_SESSION as any }),
    processDueCron: async () => ({ failed: 0, processed: 0, succeeded: 0 } as any),
    setCronTarget: async () => ({
      job: TEST_CRON_JOB as any,
      beforeTarget: {
        jobId: TEST_CRON_JOB.jobId,
        jobName: TEST_CRON_JOB.name,
        target: TEST_CRON_JOB.target,
        bindingDelivery: null,
      },
      afterTarget: {
        jobId: TEST_CRON_JOB.jobId,
        jobName: TEST_CRON_JOB.name,
        target: TEST_CRON_JOB.target,
        bindingDelivery: null,
      },
      changed: false,
      continuityReset: false,
      dryRun: false,
    }),
    runAutomationOnce: async () => ({
      vault: '/tmp/vault',
      startedAt: '2026-03-28T00:00:00.000Z',
      stoppedAt: '2026-03-28T00:00:00.000Z',
      reason: 'completed',
      daemonStarted: false,
      scans: 0,
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
    } as any),
    sendMessage: async () => ({
      vault: '/tmp/vault',
      status: 'completed',
      prompt: 'noop',
      response: 'noop',
      session: TEST_SESSION,
      delivery: null,
      deliveryDeferred: false,
      deliveryIntentId: null,
      deliveryError: null,
      blocked: null,
    } as any),
    gateway: createGatewayServiceMock(),
    updateSessionOptions: async () => TEST_SESSION as any,
    vault: '/tmp/vault',
  } as AssistantLocalService

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
  const service = {
    drainOutbox: async () => ({ attempted: 0, sent: 0, failed: 0, queued: 0 }),
    getSession: async () => TEST_SESSION as any,
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
    getCronJob: async () => TEST_CRON_JOB as any,
    getCronTarget: async () => ({
      jobId: TEST_CRON_JOB.jobId,
      jobName: TEST_CRON_JOB.name,
      target: TEST_CRON_JOB.target,
      bindingDelivery: null,
    }),
    getCronStatus: async () => ({
      totalJobs: 0,
      enabledJobs: 0,
      dueJobs: 0,
      runningJobs: 0,
      nextRunAt: null,
    }),
    openConversation: async () => ({ created: true, session: TEST_SESSION as any }),
    processDueCron: async () => ({ failed: 0, processed: 0, succeeded: 0 } as any),
    setCronTarget: async () => ({
      job: TEST_CRON_JOB as any,
      beforeTarget: {
        jobId: TEST_CRON_JOB.jobId,
        jobName: TEST_CRON_JOB.name,
        target: TEST_CRON_JOB.target,
        bindingDelivery: null,
      },
      afterTarget: {
        jobId: TEST_CRON_JOB.jobId,
        jobName: TEST_CRON_JOB.name,
        target: TEST_CRON_JOB.target,
        bindingDelivery: null,
      },
      changed: false,
      continuityReset: false,
      dryRun: false,
    }),
    runAutomationOnce: async () => ({
      vault: '/tmp/vault',
      startedAt: '2026-03-28T00:00:00.000Z',
      stoppedAt: '2026-03-28T00:00:00.000Z',
      reason: 'completed',
      daemonStarted: false,
      scans: 0,
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
    } as any),
    sendMessage: async () => ({
      vault: '/tmp/vault',
      status: 'completed',
      prompt: 'hello',
      response: 'daemon response',
      session: TEST_SESSION,
      delivery: null,
      deliveryDeferred: false,
      deliveryIntentId: null,
      deliveryError: null,
      blocked: null,
    }),
    gateway: createGatewayServiceMock(),
    updateSessionOptions: async () => TEST_SESSION as any,
    vault: '/tmp/vault',
  } as AssistantLocalService

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
