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

test('assistantd http server enforces bearer auth and routes requests to the local assistant service', async () => {
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
  const getSession = vi.fn(async (sessionId: string) => ({
    ...TEST_SESSION,
    sessionId,
  }))
  const service = {
    drainOutbox: async () => ({ sent: 0, failed: 0, queued: 0 }),
    getSession,
    health: async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      ok: true,
      pid: 1234,
      vaultBound: true,
    }),
    getStatus: async () => ({
      vault: '/tmp/vault',
      stateRoot: '/tmp/assistant-state',
      runLock: { state: 'unlocked', holderPid: null, acquiredAt: null, staleAfter: null },
      sessions: [],
      activeSessionCount: 0,
      outbox: { pending: 0, retryable: 0 },
      diagnostics: { generatedAt: '2026-03-28T00:00:00.000Z', events: [], counters: { turnsAccepted: 0, turnsCompleted: 0, turnsFailed: 0, turnsDeferred: 0 } },
      cron: { jobs: 0, due: 0, running: 0 },
      automation: { pendingInboxDeliveries: 0, pendingAutoReplies: 0 },
      generatedAt: '2026-03-28T00:00:00.000Z',
    } as any),
    listSessions: async () => [TEST_SESSION as any],
    openConversation: async () => ({
      created: true,
      paths: { assistantStateRoot: '/tmp/assistant-state' },
      session: TEST_SESSION as any,
    }),
    processDueCron: async () => ({ runs: [] } as any),
    runAutomationOnce: async () => ({ scannedInbox: 0, scannedAutoReply: 0, triggered: 0 } as any),
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

    const session = await fetch(`${handle.address.baseUrl}/sessions/${encodeURIComponent('session_http_route')}`, {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    })
    assert.equal(session.status, 200)
    const sessionPayload = await session.json() as { sessionId: string }
    assert.equal(sessionPayload.sessionId, 'session_http_route')
    assert.equal(getSession.mock.calls[0]?.[0], 'session_http_route')
  } finally {
    await handle.close()
  }
})
