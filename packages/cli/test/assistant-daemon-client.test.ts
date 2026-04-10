import assert from 'node:assert/strict'
import { afterAll, beforeAll, test as baseTest, vi } from 'vitest'
import {
  canUseAssistantDaemonForMessage,
  maybeDrainAssistantOutboxViaDaemon,
  maybeGetAssistantCronJobViaDaemon,
  maybeGetAssistantCronTargetViaDaemon,
  maybeGetAssistantCronStatusViaDaemon,
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
  resolveAssistantDaemonClientConfig,
} from '@murphai/assistant-cli/assistant/daemon-client'

const test = baseTest.sequential

type AssistantdFetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> | Response

const assistantdFetchHandlers = new Map<string, AssistantdFetchHandler>()
const assistantdFetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = new Headers(init?.headers)
      .get('authorization')
      ?.replace(/^Bearer\s+/u, '')
    if (!token) {
      throw new Error('Expected a bearer token on assistant daemon fetch calls.')
    }
    const handler = assistantdFetchHandlers.get(token)
    if (!handler) {
      throw new Error(`No assistant daemon fetch handler was registered for token ${token}.`)
    }
    return await handler(input, init)
  },
)

let nextAssistantdFetchId = 1

const TEST_SESSION = {
  schema: 'murph.assistant-session.v4',
  sessionId: 'session_daemon_test',
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
  intentId: 'outbox_daemon_test',
  sessionId: TEST_SESSION.sessionId,
  turnId: 'turn_daemon_test',
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
  jobId: 'cron_daemon_test',
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
  runId: 'cronrun_daemon_test',
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

beforeAll(() => {
  vi.stubGlobal('fetch', assistantdFetchMock as unknown as typeof fetch)
})

afterAll(() => {
  assistantdFetchHandlers.clear()
  vi.unstubAllGlobals()
})

function registerAssistantdFetchHandler(handler: AssistantdFetchHandler) {
  const id = nextAssistantdFetchId++
  const env = {
    MURPH_ASSISTANTD_BASE_URL: `http://127.0.0.1:${50241 + id}`,
    MURPH_ASSISTANTD_CONTROL_TOKEN: `assistantd-test-token-${id}`,
  } as const

  assistantdFetchHandlers.set(env.MURPH_ASSISTANTD_CONTROL_TOKEN, handler)

  return {
    env,
    release() {
      assistantdFetchHandlers.delete(env.MURPH_ASSISTANTD_CONTROL_TOKEN)
    },
  }
}

test('resolveAssistantDaemonClientConfig trims loopback URLs, honors disable flags, and rejects remote hosts', () => {
  assert.deepEqual(
    resolveAssistantDaemonClientConfig({
      MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241/',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
    }),
    {
      baseUrl: 'http://127.0.0.1:50241',
      token: 'secret-token',
    },
  )

  assert.equal(
    resolveAssistantDaemonClientConfig({
      MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241/',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      MURPH_ASSISTANTD_DISABLE_CLIENT: '1',
    }),
    null,
  )

  assert.deepEqual(
    resolveAssistantDaemonClientConfig({
      MURPH_ASSISTANTD_BASE_URL: ' http://localhost:50241/ ',
      MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
    }),
    {
      baseUrl: 'http://localhost:50241',
      token: 'secret-token',
    },
  )
  assert.throws(
    () =>
      resolveAssistantDaemonClientConfig({
        MURPH_ASSISTANTD_BASE_URL: 'http://example.com:50241/',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      }),
    /loopback-only http:\/\//u,
  )
  assert.throws(
    () =>
      resolveAssistantDaemonClientConfig({
        MURPH_ASSISTANTD_BASE_URL: 'http://127.example.com:50241/',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      }),
    /loopback-only http:\/\//u,
  )
})

test('canUseAssistantDaemonForMessage declines turns that rely on local progress or snapshots', () => {
  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        vault: '/tmp/vault',
        prompt: 'hello',
      },
      {
        MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      },
    ),
    true,
  )

  assert.equal(
    canUseAssistantDaemonForMessage(
      {
        vault: '/tmp/vault',
        prompt: 'hello',
        onProviderEvent: () => undefined,
      },
      {
        MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241',
        MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
      },
    ),
    false,
  )
})

test('assistant daemon client surfaces invalid non-JSON daemon responses clearly', async () => {
  const { env, release } = registerAssistantdFetchHandler(
    async () => new Response('<html>not json</html>', { status: 200 }),
  )

  try {
    await assert.rejects(
      () =>
        maybeGetAssistantStatusViaDaemon(
          {
            vault: '/tmp/vault',
          },
          env,
        ),
      /invalid JSON response/u,
    )
  } finally {
    release()
  }
})

test('assistant daemon client surfaces pre-response fetch failures clearly', async () => {
  const { env, release } = registerAssistantdFetchHandler(async () => {
    throw new TypeError('network unreachable')
  })

  try {
    await assert.rejects(
      () =>
        maybeGetAssistantStatusViaDaemon(
          {
            vault: '/tmp/vault',
          },
          env,
        ),
      /failed before receiving a response/u,
    )
  } finally {
    release()
  }
})

test('assistant daemon client routes serializable assistant operations through the loopback control plane', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        `Bearer ${env.MURPH_ASSISTANTD_CONTROL_TOKEN}`,
      )

      if (url.pathname === '/message') {
        assert.equal(init?.method, 'POST')
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        assert.equal(body.prompt, 'hello from daemon')
        assert.equal('abortSignal' in body, false)
        return new Response(
          JSON.stringify({
            vault: '/tmp/vault',
            status: 'completed',
            prompt: 'hello from daemon',
            response: 'daemon response',
            session: TEST_SESSION,
            delivery: null,
            deliveryDeferred: false,
            deliveryIntentId: null,
            deliveryError: null,
          }),
          { status: 200 },
        )
      }

      if (url.pathname === '/open-conversation') {
        return new Response(
          JSON.stringify({
            created: true,
            session: TEST_SESSION,
          }),
          { status: 200 },
        )
      }

      if (url.pathname === '/session-options') {
        return new Response(JSON.stringify(TEST_SESSION), { status: 200 })
      }

      if (url.pathname === '/status') {
        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        assert.equal(url.searchParams.get('limit'), '7')
        assert.equal(url.searchParams.get('sessionId'), TEST_SESSION.sessionId)
        return new Response(
          JSON.stringify({
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
                staleQuarantinePruned: 0,
                staleLocksCleared: 0,
                notes: [],
              },
            },
            recentTurns: [],
            warnings: [],
          }),
          { status: 200 },
        )
      }

      if (url.pathname === '/sessions') {
        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        return new Response(JSON.stringify([TEST_SESSION]), { status: 200 })
      }

      if (url.pathname === `/sessions/${encodeURIComponent(TEST_SESSION.sessionId)}`) {
        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        return new Response(JSON.stringify(TEST_SESSION), { status: 200 })
      }

      if (url.pathname === '/outbox/drain') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        assert.equal(body.vault, '/tmp/vault')
        assert.equal(body.limit, 2)
        return new Response(
          JSON.stringify({
            attempted: 1,
            failed: 0,
            queued: 0,
            sent: 1,
          }),
          { status: 200 },
        )
      }

      if (url.pathname === '/outbox') {
        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        return new Response(JSON.stringify([TEST_OUTBOX_INTENT]), { status: 200 })
      }

      if (url.pathname === `/outbox/${encodeURIComponent(TEST_OUTBOX_INTENT.intentId)}`) {
        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        return new Response(JSON.stringify(TEST_OUTBOX_INTENT), { status: 200 })
      }

      if (url.pathname === '/cron/status') {
        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        return new Response(
          JSON.stringify({
            totalJobs: 1,
            enabledJobs: 1,
            dueJobs: 0,
            runningJobs: 0,
            nextRunAt: TEST_CRON_JOB.state.nextRunAt,
          }),
          { status: 200 },
        )
      }

      if (url.pathname === '/cron/jobs') {
        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        return new Response(JSON.stringify([TEST_CRON_JOB]), { status: 200 })
      }

      if (url.pathname === `/cron/jobs/${encodeURIComponent(TEST_CRON_JOB.jobId)}`) {
        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        return new Response(JSON.stringify(TEST_CRON_JOB), { status: 200 })
      }

      if (url.pathname === `/cron/jobs/${encodeURIComponent(TEST_CRON_JOB.jobId)}/target`) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body ?? '{}')) as {
            channel?: string | null
            deliveryTarget?: string | null
            dryRun?: boolean
            identityId?: string | null
            resetContinuity?: boolean
            vault?: string | null
          }
          assert.equal(url.searchParams.get('vault'), '/tmp/vault')
          assert.equal(body.vault, '/tmp/vault')
          if (body.dryRun === true) {
            assert.equal('resetContinuity' in body, false)
          } else {
            assert.equal(body.resetContinuity, true)
          }
          return new Response(
            JSON.stringify({
              job: {
                ...TEST_CRON_JOB,
                target: {
                  ...TEST_CRON_JOB.target,
                  sessionId: body.resetContinuity ? null : TEST_CRON_JOB.target.sessionId,
                  alias: body.resetContinuity ? null : TEST_CRON_JOB.target.alias,
                  channel: body.channel ?? TEST_CRON_JOB.target.channel,
                  identityId: body.identityId ?? null,
                  participantId: null,
                  sourceThreadId: null,
                  deliveryTarget: body.deliveryTarget ?? null,
                },
              },
              beforeTarget: {
                jobId: TEST_CRON_JOB.jobId,
                jobName: TEST_CRON_JOB.name,
                target: TEST_CRON_JOB.target,
                bindingDelivery: {
                  kind: 'thread',
                  target: 'chat-123',
                },
              },
              afterTarget: {
                jobId: TEST_CRON_JOB.jobId,
                jobName: TEST_CRON_JOB.name,
                target: {
                  ...TEST_CRON_JOB.target,
                  sessionId: body.resetContinuity ? null : TEST_CRON_JOB.target.sessionId,
                  alias: body.resetContinuity ? null : TEST_CRON_JOB.target.alias,
                  channel: body.channel ?? TEST_CRON_JOB.target.channel,
                  identityId: body.identityId ?? null,
                  participantId: null,
                  sourceThreadId: null,
                  deliveryTarget: body.deliveryTarget ?? null,
                },
                bindingDelivery: null,
              },
              changed: true,
              continuityReset: body.resetContinuity ?? false,
              dryRun: body.dryRun ?? false,
            }),
            { status: 200 },
          )
        }

        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        return new Response(
          JSON.stringify({
            jobId: TEST_CRON_JOB.jobId,
            jobName: TEST_CRON_JOB.name,
            target: TEST_CRON_JOB.target,
            bindingDelivery: {
              kind: 'thread',
              target: 'chat-123',
            },
          }),
          { status: 200 },
        )
      }

      if (url.pathname === '/cron/runs') {
        assert.equal(url.searchParams.get('vault'), '/tmp/vault')
        assert.equal(url.searchParams.get('job'), TEST_CRON_JOB.jobId)
        assert.equal(url.searchParams.get('limit'), '3')
        return new Response(
          JSON.stringify({
            jobId: TEST_CRON_JOB.jobId,
            runs: [TEST_CRON_RUN],
          }),
          { status: 200 },
        )
      }

      if (url.pathname === '/cron/process-due') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        assert.equal(body.vault, '/tmp/vault')
        assert.equal(body.limit, 2)
        assert.equal(body.deliveryDispatchMode, 'queue-only')
        return new Response(
          JSON.stringify({
            failed: 0,
            processed: 2,
            succeeded: 2,
          }),
          { status: 200 },
        )
      }

      if (url.pathname === '/automation/run-once') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        assert.equal(body.vault, '/tmp/vault')
        assert.equal(body.once, true)
        assert.equal(body.startDaemon, false)
        return new Response(
          JSON.stringify({
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
          }),
          { status: 200 },
        )
      }

      throw new Error(`unexpected assistant daemon route: ${url}`)
    })
  const { env, release } = registerAssistantdFetchHandler(fetchMock)

  try {
    const messageResult = await maybeSendAssistantMessageViaDaemon(
      {
        vault: '/tmp/vault',
        prompt: 'hello from daemon',
      },
      env,
    )
    assert.ok(messageResult)
    assert.equal(messageResult?.response, 'daemon response')
    assert.equal(messageResult?.session.sessionId, TEST_SESSION.sessionId)

    const conversation = await maybeOpenAssistantConversationViaDaemon(
      {
        vault: '/tmp/vault',
        alias: 'chat:test',
      },
      env,
    )
    assert.equal(conversation?.created, true)
    assert.equal(conversation?.session.sessionId, TEST_SESSION.sessionId)
    assert.equal(conversation?.session.providerBinding?.providerSessionId ?? null, null)
    assert.equal(conversation?.session.providerBinding?.providerState ?? null, null)

    const updated = await maybeUpdateAssistantSessionOptionsViaDaemon(
      {
        vault: '/tmp/vault',
        sessionId: TEST_SESSION.sessionId,
        providerOptions: {
          model: 'gpt-5.4-mini',
        },
      },
      env,
    )
    assert.equal(updated?.sessionId, TEST_SESSION.sessionId)

    const status = await maybeGetAssistantStatusViaDaemon(
      {
        vault: '/tmp/vault',
        limit: 7,
        sessionId: TEST_SESSION.sessionId,
      },
      env,
    )
    assert.equal(status?.vault, '/tmp/vault')

    const sessions = await maybeListAssistantSessionsViaDaemon(
      {
        vault: '/tmp/vault',
      },
      env,
    )
    assert.equal(sessions?.[0]?.sessionId, TEST_SESSION.sessionId)

    const session = await maybeGetAssistantSessionViaDaemon(
      {
        vault: '/tmp/vault',
        sessionId: TEST_SESSION.sessionId,
      },
      env,
    )
    assert.equal(session?.sessionId, TEST_SESSION.sessionId)

    const intents = await maybeListAssistantOutboxIntentsViaDaemon(
      {
        vault: '/tmp/vault',
      },
      env,
    )
    assert.equal(intents?.[0]?.intentId, TEST_OUTBOX_INTENT.intentId)

    const intent = await maybeGetAssistantOutboxIntentViaDaemon(
      {
        vault: '/tmp/vault',
        intentId: TEST_OUTBOX_INTENT.intentId,
      },
      env,
    )
    assert.equal(intent?.intentId, TEST_OUTBOX_INTENT.intentId)

    const cronStatus = await maybeGetAssistantCronStatusViaDaemon(
      {
        vault: '/tmp/vault',
      },
      env,
    )
    assert.equal(cronStatus?.totalJobs, 1)

    const cronJobs = await maybeListAssistantCronJobsViaDaemon(
      {
        vault: '/tmp/vault',
      },
      env,
    )
    assert.equal(cronJobs?.[0]?.jobId, TEST_CRON_JOB.jobId)

    const cronJob = await maybeGetAssistantCronJobViaDaemon(
      {
        vault: '/tmp/vault',
        job: TEST_CRON_JOB.jobId,
      },
      env,
    )
    assert.equal(cronJob?.jobId, TEST_CRON_JOB.jobId)

    const cronTarget = await maybeGetAssistantCronTargetViaDaemon(
      {
        vault: '/tmp/vault',
        job: TEST_CRON_JOB.jobId,
      },
      env,
    )
    assert.equal(cronTarget?.jobId, TEST_CRON_JOB.jobId)
    assert.equal(cronTarget?.bindingDelivery?.kind, 'thread')

    const retargeted = await maybeSetAssistantCronTargetViaDaemon(
      {
        vault: '/tmp/vault',
        job: TEST_CRON_JOB.jobId,
        channel: 'email',
        identityId: 'sender@example.com',
        deliveryTarget: 'me@example.com',
        dryRun: true,
      },
      env,
    )
    assert.equal(retargeted?.changed, true)
    assert.equal(retargeted?.continuityReset, false)
    assert.equal(retargeted?.dryRun, true)
    assert.equal(retargeted?.afterTarget.target.channel, 'email')
    assert.equal(
      retargeted?.afterTarget.target.sessionId,
      TEST_CRON_JOB.target.sessionId,
    )

    const resetRetargeted = await maybeSetAssistantCronTargetViaDaemon(
      {
        vault: '/tmp/vault',
        job: TEST_CRON_JOB.jobId,
        channel: 'email',
        identityId: 'sender@example.com',
        deliveryTarget: 'me@example.com',
        resetContinuity: true,
      },
      env,
    )
    assert.equal(resetRetargeted?.changed, true)
    assert.equal(resetRetargeted?.continuityReset, true)
    assert.equal(resetRetargeted?.afterTarget.target.sessionId, null)

    const cronRuns = await maybeListAssistantCronRunsViaDaemon(
      {
        vault: '/tmp/vault',
        job: TEST_CRON_JOB.jobId,
        limit: 3,
      },
      env,
    )
    assert.equal(cronRuns?.jobId, TEST_CRON_JOB.jobId)
    assert.equal(cronRuns?.runs[0]?.runId, TEST_CRON_RUN.runId)

    const drained = await maybeDrainAssistantOutboxViaDaemon(
      {
        vault: '/tmp/vault',
        limit: 2,
        now: new Date('2026-03-28T00:00:00.000Z'),
      },
      env,
    )
    assert.deepEqual(drained, {
      attempted: 1,
      failed: 0,
      queued: 0,
      sent: 1,
    })

    const cron = await maybeProcessDueAssistantCronViaDaemon(
      {
        vault: '/tmp/vault',
        limit: 2,
        deliveryDispatchMode: 'queue-only',
      },
      env,
    )
    assert.deepEqual(cron, {
      failed: 0,
      processed: 2,
      succeeded: 2,
    })

    const automation = await maybeRunAssistantAutomationViaDaemon(
      {
        vault: '/tmp/vault',
        once: true,
        startDaemon: false,
      },
      env,
    )
    assert.equal(automation?.scans, 1)

    assert.equal(fetchMock.mock.calls.length, 18)
  } finally {
    release()
  }
})

test('assistant daemon client refuses daemon routes that require local hooks or bespoke dependencies', async () => {
  const env = {
    MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50241/',
    MURPH_ASSISTANTD_CONTROL_TOKEN: 'secret-token',
  }

  assert.equal(
    await maybeDrainAssistantOutboxViaDaemon(
      {
        vault: '/tmp/vault',
        dependencies: {},
      },
      env,
    ),
    null,
  )

  assert.equal(
    await maybeProcessDueAssistantCronViaDaemon(
      {
        vault: '/tmp/vault',
        signal: new AbortController().signal,
      },
      env,
    ),
    null,
  )
})

test('assistant daemon client preserves typed error codes from the control plane', async () => {
  const { env, release } = registerAssistantdFetchHandler(async () =>
    new Response(
      JSON.stringify({
        code: 'ASSISTANT_SESSION_NOT_FOUND',
        error: 'Assistant session "missing" was not found.',
      }),
      { status: 404 },
    ),
  )

  try {
    await assert.rejects(
      () =>
        maybeGetAssistantSessionViaDaemon(
          {
            sessionId: 'missing',
            vault: '/tmp/vault',
          },
          env,
        ),
      (error) => {
        assert.equal(error instanceof Error, true)
        assert.equal(
          (error as { code?: string; cause?: { code?: string } }).code ??
            (error as { cause?: { code?: string } }).cause?.code,
          'ASSISTANT_SESSION_NOT_FOUND',
        )
        assert.equal((error as Error).message, 'Assistant session "missing" was not found.')
        assert.equal((error as { status?: number }).status, 404)
        return true
      },
    )
  } finally {
    release()
  }
})

test('assistant daemon client surfaces continuous automation daemon requirements cleanly', async () => {
  const { env, release } = registerAssistantdFetchHandler(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    assert.equal(url.pathname, '/automation/run-once')
    assert.equal(init?.method, 'POST')

    const body = JSON.parse(String(init?.body)) as {
      once?: boolean
      startDaemon?: boolean
    }
    assert.equal(body.once, false)
    assert.equal(body.startDaemon, false)

    return new Response(
      JSON.stringify({
        error: 'Assistant daemon request failed.',
      }),
      { status: 500 },
    )
  })

  try {
    await assert.rejects(
      () =>
        maybeRunAssistantAutomationViaDaemon(
          {
            once: false,
            startDaemon: false,
            vault: '/tmp/vault',
          },
          env,
        ),
      (error) => {
        assert.equal(error instanceof Error, true)
        assert.equal((error as Error).message, 'Assistant daemon request failed.')
        assert.equal((error as { status?: number }).status, 500)
        return true
      },
    )
  } finally {
    release()
  }
})

test('assistant daemon client rejects legacy daemon session payloads', async () => {
  const { env, release } = registerAssistantdFetchHandler(async () =>
    new Response(
      JSON.stringify({
        ...TEST_SESSION,
        providerBinding: undefined,
        providerSessionId: 'legacy-provider-session',
        schema: undefined,
      }),
      { status: 200 },
    ),
  )

  try {
    await assert.rejects(
      () =>
        maybeGetAssistantSessionViaDaemon(
          {
            sessionId: TEST_SESSION.sessionId,
            vault: '/tmp/vault',
          },
          env,
        ),
      /schema/u,
    )
  } finally {
    release()
  }
})
