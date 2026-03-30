import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import { startAssistantHttpServer } from '../src/http.js'
import type { AssistantLocalService } from '../src/service.js'

const TEST_SESSION = {
  schema: 'murph.assistant-session.v3',
  sessionId: 'session_http_test',
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

afterEach(() => {
  vi.restoreAllMocks()
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
  const getStatus = vi.fn(async () => ({
    vault: '/tmp/vault',
    stateRoot: '/tmp/assistant-state',
    statusPath: '/tmp/assistant-state/status.json',
    outboxRoot: '/tmp/assistant-state/outbox',
    diagnosticsPath: '/tmp/assistant-state/diagnostics.snapshot.json',
    failoverStatePath: '/tmp/assistant-state/failover.json',
    turnsRoot: '/tmp/assistant-state/turns',
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
      autoReplyScanCursor: null,
      autoReplyChannels: [],
      preferredChannels: [],
      autoReplyBacklogChannels: [],
      autoReplyPrimed: false,
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
  const service = {
    drainOutbox: async () => ({ attempted: 0, sent: 0, failed: 0, queued: 0 }),
    getSession,
    health: async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    getStatus,
    listSessions: async () => [TEST_SESSION as any],
    openConversation: async () => ({
      created: true,
      session: TEST_SESSION as any,
    }),
    processDueCron: async () => ({ failed: 0, processed: 0, succeeded: 0 } as any),
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
    updateSessionOptions: async () => TEST_SESSION as any,
    vault: '/tmp/vault',
  } as AssistantLocalService

  const handle = await startAssistantHttpServer({
    controlToken: 'secret-token',
    host: '127.0.0.1',
    port: 0,
    service,
  })

  try {
    const unauthorized = await fetch(`${handle.address.baseUrl}/healthz`)
    assert.equal(unauthorized.status, 401)

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
        vault: '/tmp/vault',
        prompt: 'hello over assistantd',
      }),
    })
    assert.equal(message.status, 200)
    const messagePayload = await message.json() as { response: string }
    assert.equal(messagePayload.response, 'daemon response')
    assert.equal(sendMessage.mock.calls[0]?.[0]?.prompt, 'hello over assistantd')

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
    assert.equal(getStatus.mock.calls[0]?.[0]?.limit, 7)
    assert.equal(getStatus.mock.calls[0]?.[0]?.sessionId, TEST_SESSION.sessionId)

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
