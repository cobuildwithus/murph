import assert from 'node:assert/strict'

import { beforeAll, beforeEach, test as baseTest, vi } from 'vitest'

import type {
  AssistantCronJob,
  AssistantCronRunRecord,
  AssistantCronTargetSnapshot,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  maybeGetAssistantCronStatusViaDaemon,
  maybeGetAssistantSessionViaDaemon,
  maybeDrainAssistantOutboxViaDaemon,
  maybeListAssistantSessionsViaDaemon,
  maybeListAssistantCronJobsViaDaemon,
  maybeListAssistantCronRunsViaDaemon,
  maybeOpenAssistantConversationViaDaemon,
  maybeProcessDueAssistantCronViaDaemon,
  maybeSetAssistantCronTargetViaDaemon,
  maybeUpdateAssistantSessionOptionsViaDaemon,
} from '../src/assistant-daemon-client.js'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

const test = baseTest.sequential

const fetchMock = vi.fn<typeof fetch>()

const TEST_ENV = {
  MURPH_ASSISTANTD_BASE_URL: 'http://127.0.0.1:50242',
  MURPH_ASSISTANTD_CONTROL_TOKEN: 'assistant-test-token',
} satisfies NodeJS.ProcessEnv

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
} satisfies AssistantCronJob

const TEST_CRON_TARGET = {
  jobId: TEST_CRON_JOB.jobId,
  jobName: TEST_CRON_JOB.name,
  target: TEST_CRON_JOB.target,
  bindingDelivery: {
    kind: 'thread',
    target: 'telegram:thread_123',
  },
} satisfies AssistantCronTargetSnapshot

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
} satisfies AssistantCronRunRecord

const TEST_SESSION = {
  schema: 'murph.assistant-session.v1',
  sessionId: 'session-daemon-more',
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
    continuityFingerprint: 'fingerprint-daemon-more',
    model: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
    executionDriver: 'codex-cli',
    resumeKind: 'codex-session',
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
} satisfies AssistantSession

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock)
})

beforeEach(() => {
  fetchMock.mockReset()
})

test('maybeListAssistantCronRunsViaDaemon truncates query params and parses the payload', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        jobId: TEST_CRON_JOB.jobId,
        runs: [TEST_CRON_RUN],
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      },
    ),
  )

  const result = await maybeListAssistantCronRunsViaDaemon(
    {
      job: TEST_CRON_JOB.jobId,
      limit: 2.9,
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )

  assert.deepEqual(result, {
    jobId: TEST_CRON_JOB.jobId,
    runs: [TEST_CRON_RUN],
  })

  assert.equal(fetchMock.mock.calls.length, 1)
  const [input, init] = fetchMock.mock.calls[0] ?? []
  const url = new URL(String(input))
  assert.equal(url.pathname, '/cron/runs')
  assert.equal(url.searchParams.get('job'), TEST_CRON_JOB.jobId)
  assert.equal(url.searchParams.get('limit'), '2')
  assert.equal(url.searchParams.get('vault'), '/tmp/vault')
  assert.equal(init?.method, 'GET')
  assert.equal(
    new Headers(init?.headers).get('authorization'),
    'Bearer assistant-test-token',
  )
})

test('maybeSetAssistantCronTargetViaDaemon encodes the job id and serializes optional continuity reset', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        job: TEST_CRON_JOB,
        beforeTarget: TEST_CRON_TARGET,
        afterTarget: {
          ...TEST_CRON_TARGET,
          target: {
            ...TEST_CRON_TARGET.target,
            deliveryTarget: '@murph-backup',
          },
        },
        changed: true,
        continuityReset: true,
        dryRun: false,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      },
    ),
  )

  const result = await maybeSetAssistantCronTargetViaDaemon(
    {
      job: 'daily/check-in',
      vault: '/tmp/vault',
      channel: 'telegram',
      deliveryTarget: '@murph-backup',
      identityId: 'identity_123',
      participantId: 'participant_123',
      sourceThreadId: 'thread_123',
      dryRun: false,
      resetContinuity: true,
    },
    TEST_ENV,
  )

  assert.equal(result?.changed, true)
  assert.equal(result?.continuityReset, true)
  assert.equal(result?.afterTarget.target.deliveryTarget, '@murph-backup')

  assert.equal(fetchMock.mock.calls.length, 1)
  const [input, init] = fetchMock.mock.calls[0] ?? []
  const url = new URL(String(input))
  assert.equal(url.pathname, '/cron/jobs/daily%2Fcheck-in/target')
  assert.equal(url.searchParams.get('vault'), '/tmp/vault')
  assert.deepEqual(JSON.parse(String(init?.body)), {
    channel: 'telegram',
    deliveryTarget: '@murph-backup',
    dryRun: false,
    identityId: 'identity_123',
    participantId: 'participant_123',
    resetContinuity: true,
    sourceThreadId: 'thread_123',
    vault: '/tmp/vault',
  })
})

test('daemon-only helpers decline local-only inputs before hitting fetch', async () => {
  assert.equal(
    await maybeDrainAssistantOutboxViaDaemon(
      {
        vault: '/tmp/vault',
        dependencies: { unexpected: true },
      },
      TEST_ENV,
    ),
    null,
  )

  assert.equal(
    await maybeProcessDueAssistantCronViaDaemon(
      {
        vault: '/tmp/vault',
        signal: new AbortController().signal,
      },
      TEST_ENV,
    ),
    null,
  )

  assert.equal(fetchMock.mock.calls.length, 0)
})

test('daemon client surfaces HTTP error payload codes and statuses', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        code: 'daemon_unavailable',
        error: 'Assistant daemon is unavailable.',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 503,
      },
    ),
  )

  await assert.rejects(
    () => maybeListAssistantCronJobsViaDaemon({ vault: '/tmp/vault' }, TEST_ENV),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Assistant daemon is unavailable.')
      assert.equal(
        'code' in error ? error.code : undefined,
        'daemon_unavailable',
      )
      assert.equal('status' in error ? error.status : undefined, 503)
      return true
    },
  )
})

test('daemon client rejects invalid JSON success payloads with route-specific context', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response('not-json', {
      status: 200,
    }),
  )

  await assert.rejects(
    () => maybeListAssistantCronJobsViaDaemon({ vault: '/tmp/vault' }, TEST_ENV),
    /invalid JSON response for \/cron\/jobs/u,
  )
})

test('daemon client serializes open-conversation, session-options, and session listing helpers', async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: true,
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
      new Response(JSON.stringify(TEST_SESSION), {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify([TEST_SESSION]), {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      }),
    )

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
  const updatedSession = await maybeUpdateAssistantSessionOptionsViaDaemon(
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
    {
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )

  assert.deepEqual(opened, {
    created: true,
    session: TEST_SESSION,
  })
  assert.deepEqual(updatedSession, TEST_SESSION)
  assert.deepEqual(sessions, [TEST_SESSION])

  assert.equal(fetchMock.mock.calls.length, 3)
  assert.equal(String(fetchMock.mock.calls[0]?.[0]), 'http://127.0.0.1:50242/open-conversation')
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), {
    alias: 'chat:daemon',
    channel: 'telegram',
    identityId: 'identity_123',
    participantId: 'participant_123',
    sourceThreadId: 'thread_123',
    vault: '/tmp/vault',
  })
  assert.equal(String(fetchMock.mock.calls[1]?.[0]), 'http://127.0.0.1:50242/session-options')
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)), {
    providerOptions: {
      model: 'gpt-5.4',
    },
    sessionId: TEST_SESSION.sessionId,
    vault: '/tmp/vault',
  })
  assert.equal(
    String(fetchMock.mock.calls[2]?.[0]),
    'http://127.0.0.1:50242/sessions?vault=%2Ftmp%2Fvault',
  )
})

test('daemon client session and cron status helpers omit null query params and normalize counts', async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify(TEST_SESSION), {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          dueJobs: 1,
          enabledJobs: 2,
          nextRunAt: null,
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

  const session = await maybeGetAssistantSessionViaDaemon(
    {
      sessionId: 'session/slash',
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )
  const cronStatus = await maybeGetAssistantCronStatusViaDaemon(
    {
      vault: '/tmp/vault',
    },
    TEST_ENV,
  )

  assert.deepEqual(session, TEST_SESSION)
  assert.deepEqual(cronStatus, {
    dueJobs: 1,
    enabledJobs: 2,
    nextRunAt: null,
    runningJobs: 0,
    totalJobs: 3,
  })

  assert.equal(
    String(fetchMock.mock.calls[0]?.[0]),
    'http://127.0.0.1:50242/sessions/session%2Fslash?vault=%2Ftmp%2Fvault',
  )
  assert.equal(
    String(fetchMock.mock.calls[1]?.[0]),
    'http://127.0.0.1:50242/cron/status?vault=%2Ftmp%2Fvault',
  )
})

test('daemon client converts pre-response fetch failures into route-specific errors', async () => {
  fetchMock.mockRejectedValueOnce(new Error('socket closed'))

  await assert.rejects(
    () =>
      maybeGetAssistantCronStatusViaDaemon(
        {
          vault: '/tmp/vault',
        },
        TEST_ENV,
      ),
    /request failed before receiving a response for \/cron\/status/u,
  )
})
