import assert from 'node:assert/strict'

import { beforeAll, beforeEach, test as baseTest, vi } from 'vitest'

const assistantdClientMocks = vi.hoisted(() => ({
  resolveAssistantDaemonClientConfig: vi.fn(),
}))

const assistantRuntimeMocks = vi.hoisted(() => ({
  normalizeNullableString: vi.fn((value: string | null | undefined) => {
    if (typeof value !== 'string') {
      return null
    }
    const normalized = value.trim()
    return normalized.length > 0 ? normalized : null
  }),
}))

vi.mock('@murphai/assistantd/client', () => ({
  resolveAssistantDaemonClientConfig:
    assistantdClientMocks.resolveAssistantDaemonClientConfig,
}))

vi.mock('@murphai/assistant-engine/assistant-runtime', () => ({
  normalizeNullableString: assistantRuntimeMocks.normalizeNullableString,
}))

import {
  canUseAssistantDaemonForMessage,
  maybeDrainAssistantOutboxViaDaemon,
  maybeGetAssistantCronJobViaDaemon,
  maybeGetAssistantCronStatusViaDaemon,
  maybeGetAssistantCronTargetViaDaemon,
  maybeGetAssistantOutboxIntentViaDaemon,
  maybeGetAssistantSessionViaDaemon,
  maybeGetAssistantStatusViaDaemon,
  maybeListAssistantCronJobsViaDaemon,
  maybeListAssistantCronRunsViaDaemon,
  maybeListAssistantOutboxIntentsViaDaemon,
  maybeListAssistantSessionsViaDaemon,
  maybeOpenAssistantConversationViaDaemon,
  maybeProcessDueAssistantCronViaDaemon,
  maybeRunAssistantAutomationViaDaemon,
  maybeSendAssistantMessageViaDaemon,
  maybeSetAssistantCronTargetViaDaemon,
  maybeUpdateAssistantSessionOptionsViaDaemon,
} from '../src/assistant-daemon-client.js'

const test = baseTest.sequential

const fetchMock = vi.fn<typeof fetch>()

const TEST_ENV = {
  MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50242',
  MURPH_ASSISTANTD_CONTROL_TOKEN: 'assistant-test-token',
} satisfies NodeJS.ProcessEnv

const TEST_MESSAGE_INPUT = {
  prompt: 'Summarize the latest inbox changes.',
  sessionId: 'session_123',
  vault: '/tmp/vault',
}

const TEST_SESSION = {
  schema: 'murph.assistant-session.v1',
  sessionId: 'session_123',
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
  alias: 'chat:daemon',
  binding: {
    conversationKey: 'chat:daemon',
    channel: 'local',
    identityId: null,
    actorId: null,
    threadId: null,
    threadIsDirect: true,
    delivery: null,
  },
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  lastTurnAt: null,
  turnCount: 1,
}

const TEST_OUTBOX_INTENT = {
  schema: 'murph.assistant-outbox-intent.v1',
  intentId: 'intent_123',
  sessionId: TEST_SESSION.sessionId,
  turnId: 'turn_123',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  lastAttemptAt: null,
  nextAttemptAt: null,
  sentAt: null,
  attemptCount: 0,
  status: 'pending',
  message: 'hello',
  dedupeKey: 'dedupe_123',
  targetFingerprint: 'target_123',
  channel: 'local',
  identityId: null,
  actorId: null,
  threadId: null,
  threadIsDirect: true,
  replyToMessageId: null,
  bindingDelivery: null,
  explicitTarget: null,
  delivery: null,
  deliveryConfirmationPending: false,
  deliveryIdempotencyKey: null,
  deliveryTransportIdempotent: false,
  lastError: null,
}

const TEST_CRON_JOB = {
  schema: 'murph.assistant-cron-job.v1',
  jobId: 'job_daily_checkin',
  name: 'Daily check-in',
  enabled: true,
  keepAfterRun: false,
  prompt: 'Summarize today',
  schedule: {
    kind: 'every',
    everyMs: 3_600_000,
  },
  target: {
    sessionId: null,
    alias: null,
    channel: 'telegram',
    identityId: 'identity_123',
    participantId: 'participant_123',
    sourceThreadId: 'thread_123',
    deliveryTarget: '@murph',
    deliverResponse: true,
  },
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
  state: {
    nextRunAt: null,
    lastRunAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    consecutiveFailures: 0,
    lastError: null,
    runningAt: null,
    runningPid: null,
  },
}

const TEST_CRON_TARGET = {
  jobId: TEST_CRON_JOB.jobId,
  jobName: TEST_CRON_JOB.name,
  target: TEST_CRON_JOB.target,
  bindingDelivery: {
    kind: 'thread',
    target: 'telegram:thread_123',
  },
}

const TEST_CRON_RUN = {
  schema: 'murph.assistant-cron-run.v1',
  runId: 'run_123',
  jobId: TEST_CRON_JOB.jobId,
  trigger: 'scheduled',
  status: 'succeeded',
  startedAt: '2026-04-01T01:00:00.000Z',
  finishedAt: '2026-04-01T01:00:05.000Z',
  sessionId: null,
  response: 'done',
  responseLength: 4,
  error: null,
}

const TEST_STATUS_RESULT = {
  vault: '/tmp/vault',
  stateRoot: '/tmp/vault/.runtime/operations/assistant',
  statusPath: '/tmp/vault/.runtime/operations/assistant/status.json',
  outboxRoot: '/tmp/vault/.runtime/operations/assistant/outbox',
  diagnosticsPath: '/tmp/vault/.runtime/operations/assistant/diagnostics.json',
  failoverStatePath: '/tmp/vault/.runtime/operations/assistant/failover-state.json',
  turnsRoot: '/tmp/vault/.runtime/operations/assistant/turns',
  generatedAt: '2026-04-08T00:00:00.000Z',
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
    updatedAt: null,
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
    updatedAt: '2026-04-08T00:00:00.000Z',
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
    updatedAt: '2026-04-08T00:00:00.000Z',
    routes: [],
  },
  quarantine: {
    total: 0,
    byKind: {},
    recent: [],
  },
  runtimeBudget: {
    schema: 'murph.assistant-runtime-budget.v1',
    updatedAt: '2026-04-08T00:00:00.000Z',
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

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock)
})

beforeEach(() => {
  fetchMock.mockReset()
  assistantdClientMocks.resolveAssistantDaemonClientConfig.mockReset()
  assistantdClientMocks.resolveAssistantDaemonClientConfig.mockImplementation(
    (env?: NodeJS.ProcessEnv) => {
      const baseUrl = env?.MURPH_ASSISTANTD_BASE_URL?.trim()
      const token = env?.MURPH_ASSISTANTD_CONTROL_TOKEN?.trim()
      if (!baseUrl || !token || env?.MURPH_ASSISTANTD_DISABLE_CLIENT === '1') {
        return null
      }
      return {
        baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
        token,
      }
    },
  )
})

test('canUseAssistantDaemonForMessage rejects local-only hooks and missing daemon config', () => {
  assert.equal(canUseAssistantDaemonForMessage(TEST_MESSAGE_INPUT, {}), false)
  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        ...TEST_MESSAGE_INPUT,
        abortSignal: new AbortController().signal,
      },
      TEST_ENV,
    ),
    false,
  )
  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        ...TEST_MESSAGE_INPUT,
        executionContext: {
          hosted: null,
        },
      },
      TEST_ENV,
    ),
    false,
  )
  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        ...TEST_MESSAGE_INPUT,
        onProviderEvent: () => undefined,
      },
      TEST_ENV,
    ),
    false,
  )
  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        ...TEST_MESSAGE_INPUT,
        onTraceEvent: () => undefined,
      },
      TEST_ENV,
    ),
    false,
  )
  assert.equal(canUseAssistantDaemonForMessage(TEST_MESSAGE_INPUT, TEST_ENV), true)
})

test('message, conversation, session, and status helpers serialize remote-safe payloads', async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          vault: '/tmp/vault',
          status: 'completed',
          prompt: TEST_MESSAGE_INPUT.prompt,
          response: 'Done.',
          session: TEST_SESSION,
          delivery: null,
          deliveryDeferred: false,
          deliveryIntentId: null,
          deliveryError: null,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: true,
          session: TEST_SESSION,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(TEST_SESSION), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify([TEST_SESSION]), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(TEST_STATUS_RESULT), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )

  const sent = await maybeSendAssistantMessageViaDaemon(TEST_MESSAGE_INPUT, TEST_ENV)
  const opened = await maybeOpenAssistantConversationViaDaemon(
    {
      alias: 'chat:daemon',
      channel: 'telegram',
      identityId: 'identity_123',
      participantId: 'participant_123',
      sourceThreadId: 'thread_123',
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )
  const updated = await maybeUpdateAssistantSessionOptionsViaDaemon(
    {
      providerOptions: {
        model: 'gpt-5.4',
      },
      sessionId: TEST_SESSION.sessionId,
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )
  const sessions = await maybeListAssistantSessionsViaDaemon(
    { vault: '/tmp/vault' },
    TEST_ENV,
  )
  const status = await maybeGetAssistantStatusViaDaemon(
    {
      limit: Number.POSITIVE_INFINITY,
      sessionId: '   ',
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )

  assert.equal(sent?.response, 'Done.')
  assert.equal(opened?.created, true)
  assert.equal(updated?.sessionId, TEST_SESSION.sessionId)
  assert.deepEqual(sessions, [TEST_SESSION])
  assert.equal(status?.vault, '/tmp/vault')

  assert.equal(String(fetchMock.mock.calls[0]?.[0]), 'http://127.0.0.1:50242/message')
  assert.deepEqual(
    JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    TEST_MESSAGE_INPUT,
  )
  assert.equal(
    String(fetchMock.mock.calls[1]?.[0]),
    'http://127.0.0.1:50242/open-conversation',
  )
  assert.equal(
    String(fetchMock.mock.calls[2]?.[0]),
    'http://127.0.0.1:50242/session-options',
  )
  assert.equal(
    String(fetchMock.mock.calls[3]?.[0]),
    'http://127.0.0.1:50242/sessions?vault=%2Ftmp%2Fvault',
  )
  assert.equal(
    String(fetchMock.mock.calls[4]?.[0]),
    'http://127.0.0.1:50242/status?vault=%2Ftmp%2Fvault',
  )
})

test('session and outbox helpers parse item, list, and null payloads', async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify(TEST_SESSION), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify([TEST_OUTBOX_INTENT]), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(TEST_OUTBOX_INTENT), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response('   ', {
        status: 200,
      }),
    )

  const session = await maybeGetAssistantSessionViaDaemon(
    {
      sessionId: 'session/slash',
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )
  const list = await maybeListAssistantOutboxIntentsViaDaemon(
    { vault: '/tmp/vault' },
    TEST_ENV,
  )
  const intent = await maybeGetAssistantOutboxIntentViaDaemon(
    {
      intentId: 'intent/slash',
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )
  const emptyIntent = await maybeGetAssistantOutboxIntentViaDaemon(
    {
      intentId: 'intent-empty',
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )

  assert.equal(session?.sessionId, TEST_SESSION.sessionId)
  assert.deepEqual(list, [TEST_OUTBOX_INTENT])
  assert.equal(intent?.intentId, TEST_OUTBOX_INTENT.intentId)
  assert.equal(emptyIntent, null)
  assert.equal(
    String(fetchMock.mock.calls[0]?.[0]),
    'http://127.0.0.1:50242/sessions/session%2Fslash?vault=%2Ftmp%2Fvault',
  )
  assert.equal(
    String(fetchMock.mock.calls[2]?.[0]),
    'http://127.0.0.1:50242/outbox/intent%2Fslash?vault=%2Ftmp%2Fvault',
  )
})

test('cron and outbox mutation helpers serialize payloads and parse counts', async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          dueJobs: 1,
          enabledJobs: 2,
          nextRunAt: null,
          runningJobs: 0,
          totalJobs: 3,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify([TEST_CRON_JOB]), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(TEST_CRON_JOB), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(TEST_CRON_TARGET), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          job: TEST_CRON_JOB,
          beforeTarget: TEST_CRON_TARGET,
          afterTarget: {
            ...TEST_CRON_TARGET,
            target: {
              ...TEST_CRON_TARGET.target,
              deliveryTarget: '@backup',
            },
          },
          changed: true,
          continuityReset: false,
          dryRun: true,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jobId: TEST_CRON_JOB.jobId,
          runs: [TEST_CRON_RUN],
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          attempted: 2,
          failed: 0,
          queued: 1,
          sent: 1,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          considered: 1,
          daemonStarted: false,
          failed: 0,
          lastError: null,
          noAction: 0,
          reason: 'completed',
          replied: 0,
          replyConsidered: 0,
          replyFailed: 0,
          replySkipped: 0,
          routed: 1,
          scans: 2,
          skipped: 0,
          vault: '/tmp/vault',
          startedAt: '2026-04-08T00:00:00.000Z',
          stoppedAt: '2026-04-08T00:00:05.000Z',
          once: true,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          failed: 0,
          processed: 1,
          succeeded: 1,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      ),
    )

  assert.deepEqual(
    await maybeGetAssistantCronStatusViaDaemon({ vault: '/tmp/vault' }, TEST_ENV),
    {
      dueJobs: 1,
      enabledJobs: 2,
      nextRunAt: null,
      runningJobs: 0,
      totalJobs: 3,
    },
  )
  assert.deepEqual(
    await maybeListAssistantCronJobsViaDaemon({ vault: '/tmp/vault' }, TEST_ENV),
    [TEST_CRON_JOB],
  )
  assert.equal(
    (
      await maybeGetAssistantCronJobViaDaemon(
        { job: TEST_CRON_JOB.jobId, vault: '/tmp/vault' },
        TEST_ENV,
      )
    )?.jobId,
    TEST_CRON_JOB.jobId,
  )
  assert.equal(
    (
      await maybeGetAssistantCronTargetViaDaemon(
        { job: TEST_CRON_JOB.jobId, vault: '/tmp/vault' },
        TEST_ENV,
      )
    )?.jobId,
    TEST_CRON_TARGET.jobId,
  )
  assert.equal(
    (
      await maybeSetAssistantCronTargetViaDaemon(
        {
          channel: 'telegram',
          deliveryTarget: '@backup',
          dryRun: true,
          identityId: 'identity_123',
          job: 'daily/check-in',
          participantId: 'participant_123',
          sourceThreadId: 'thread_123',
          vault: '/tmp/vault',
        },
        TEST_ENV,
      )
    )?.changed,
    true,
  )
  assert.deepEqual(
    await maybeListAssistantCronRunsViaDaemon(
      {
        job: TEST_CRON_JOB.jobId,
        limit: 2.9,
        vault: '/tmp/vault',
      },
      TEST_ENV,
    ),
    {
      jobId: TEST_CRON_JOB.jobId,
      runs: [TEST_CRON_RUN],
    },
  )
  assert.deepEqual(
    await maybeDrainAssistantOutboxViaDaemon(
      {
        limit: 2.8,
        now: new Date('2026-04-08T00:00:00.000Z'),
        vault: '/tmp/vault',
      },
      TEST_ENV,
    ),
    {
      attempted: 2,
      failed: 0,
      queued: 1,
      sent: 1,
    },
  )
  assert.equal(
    (
      await maybeRunAssistantAutomationViaDaemon(
        {
          once: true,
          requestId: undefined,
          vault: '/tmp/vault',
        },
        TEST_ENV,
      )
    )?.reason,
    'completed',
  )
  assert.deepEqual(
    await maybeProcessDueAssistantCronViaDaemon(
      {
        limit: 1.9,
        vault: '/tmp/vault',
      },
      TEST_ENV,
    ),
    {
      failed: 0,
      processed: 1,
      succeeded: 1,
    },
  )

  assert.equal(
    String(fetchMock.mock.calls[4]?.[0]),
    'http://127.0.0.1:50242/cron/jobs/daily%2Fcheck-in/target?vault=%2Ftmp%2Fvault',
  )
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body)), {
    channel: 'telegram',
    deliveryTarget: '@backup',
    dryRun: true,
    identityId: 'identity_123',
    participantId: 'participant_123',
    sourceThreadId: 'thread_123',
    vault: '/tmp/vault',
  })
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[6]?.[1]?.body)), {
    limit: 2,
    now: '2026-04-08T00:00:00.000Z',
    vault: '/tmp/vault',
  })
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[7]?.[1]?.body)), {
    once: true,
    requestId: null,
    sessionMaxAgeMs: null,
    vault: '/tmp/vault',
  })
})

test('daemon helpers return early without fetch when remote execution is unsafe or unconfigured', async () => {
  assert.equal(
    await maybeGetAssistantOutboxIntentViaDaemon(
      {
        intentId: 'intent_123',
        vault: '/tmp/vault',
      },
      {},
    ),
    undefined,
  )
  assert.equal(
    await maybeDrainAssistantOutboxViaDaemon(
      {
        dependencies: { unexpected: true },
        vault: '/tmp/vault',
      },
      TEST_ENV,
    ),
    null,
  )
  assert.equal(
    await maybeProcessDueAssistantCronViaDaemon(
      {
        signal: new AbortController().signal,
        vault: '/tmp/vault',
      },
      TEST_ENV,
    ),
    null,
  )
  assert.equal(fetchMock.mock.calls.length, 0)
})

test('daemon helpers surface invalid JSON, invalid payload fields, and plain-text HTTP errors', async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response('not-json', {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          failed: -1,
          processed: 1,
          succeeded: 1,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        },
      ),
    )
    .mockResolvedValueOnce(
      new Response('temporary daemon outage', {
        status: 502,
      }),
    )

  await assert.rejects(
    () => maybeListAssistantCronJobsViaDaemon({ vault: '/tmp/vault' }, TEST_ENV),
    /invalid JSON response for \/cron\/jobs/u,
  )
  await assert.rejects(
    () => maybeProcessDueAssistantCronViaDaemon({ vault: '/tmp/vault' }, TEST_ENV),
    /payload field failed was invalid/u,
  )
  await assert.rejects(
    () =>
      maybeRunAssistantAutomationViaDaemon(
        {
          once: true,
          requestId: 'request_123',
          vault: '/tmp/vault',
        },
        TEST_ENV,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'temporary daemon outage')
      assert.equal('status' in error ? error.status : undefined, 502)
      return true
    },
  )
})

test('daemon helpers surface structured HTTP errors, request transport failures, and invalid conversation payloads', async () => {
  fetchMock
    .mockRejectedValueOnce(new Error('socket hang up'))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'assistantd_conflict',
          error: 'daemon rejected the request',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 409,
        },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 'yes',
          session: TEST_SESSION,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          dueJobs: 1,
          enabledJobs: 2,
          nextRunAt: 42,
          runningJobs: 0,
          totalJobs: 3,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        },
      ),
    )

  await assert.rejects(
    () => maybeListAssistantSessionsViaDaemon({ vault: '/tmp/vault' }, TEST_ENV),
    /request failed before receiving a response for \/sessions/u,
  )
  await assert.rejects(
    () =>
      maybeRunAssistantAutomationViaDaemon(
        {
          once: true,
          requestId: 'request_456',
          vault: '/tmp/vault',
        },
        TEST_ENV,
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'daemon rejected the request')
      assert.equal('code' in error ? error.code : undefined, 'assistantd_conflict')
      assert.equal('status' in error ? error.status : undefined, 409)
      return true
    },
  )
  await assert.rejects(
    () =>
      maybeOpenAssistantConversationViaDaemon(
        {
          alias: 'chat:daemon',
          channel: 'telegram',
          identityId: 'identity_123',
          participantId: 'participant_123',
          sourceThreadId: 'thread_123',
          vault: '/tmp/vault',
        },
        TEST_ENV,
      ),
    /missing the created flag/u,
  )
  await assert.rejects(
    () => maybeGetAssistantCronStatusViaDaemon({ vault: '/tmp/vault' }, TEST_ENV),
    /field nextRunAt was invalid/u,
  )
})

test('daemon helpers reject malformed cron list and mutation payload shapes', async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jobId: TEST_CRON_JOB.jobId,
          runs: 'not-an-array',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        },
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          job: TEST_CRON_JOB,
          beforeTarget: TEST_CRON_TARGET,
          afterTarget: TEST_CRON_TARGET,
          changed: 'yes',
          continuityReset: false,
          dryRun: true,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        },
      ),
    )

  await assert.rejects(
    () =>
      maybeListAssistantCronRunsViaDaemon(
        {
          job: TEST_CRON_JOB.jobId,
          vault: '/tmp/vault',
        },
        TEST_ENV,
      ),
    /field runs was invalid/u,
  )
  await assert.rejects(
    () =>
      maybeSetAssistantCronTargetViaDaemon(
        {
          job: TEST_CRON_JOB.jobId,
          vault: '/tmp/vault',
        },
        TEST_ENV,
      ),
    /invalid cron target payload/u,
  )
  await assert.rejects(
    () => maybeProcessDueAssistantCronViaDaemon({ vault: '/tmp/vault' }, TEST_ENV),
    /invalid cron process payload/u,
  )
  await assert.rejects(
    () =>
      maybeSetAssistantCronTargetViaDaemon(
        {
          job: TEST_CRON_JOB.jobId,
          vault: '/tmp/vault',
        },
        TEST_ENV,
      ),
    /field changed was invalid/u,
  )
})
