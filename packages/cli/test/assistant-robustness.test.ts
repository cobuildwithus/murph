import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test, vi } from 'vitest'

const robustnessMocks = vi.hoisted(() => ({
  deliverAssistantMessageOverBinding: vi.fn(),
  executeAssistantProviderTurn: vi.fn(),
  resolveAssistantProviderTraits: vi.fn((provider: string) =>
    provider === 'openai-compatible'
      ? {
          resumeKeyMode: 'none' as const,
          sessionMode: 'stateless' as const,
          transcriptContextMode: 'local-transcript' as const,
          workspaceMode: 'none' as const,
        }
      : {
          resumeKeyMode: 'provider-session-id' as const,
          sessionMode: 'stateful' as const,
          transcriptContextMode: 'provider-session' as const,
          workspaceMode: 'direct-cli' as const,
        }),
}))

vi.mock('../src/outbound-channel.js', async () => {
  const actual = await vi.importActual<typeof import('../src/outbound-channel.js')>(
    '../src/outbound-channel.js',
  )

  return {
    ...actual,
    deliverAssistantMessageOverBinding:
      robustnessMocks.deliverAssistantMessageOverBinding,
  }
})

vi.mock('../src/assistant-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant-provider.js')>(
    '../src/assistant-provider.js',
  )

  return {
    ...actual,
    executeAssistantProviderTurn: robustnessMocks.executeAssistantProviderTurn,
    resolveAssistantProviderTraits: robustnessMocks.resolveAssistantProviderTraits,
  }
})

import {
  getAssistantStatus,
  readAssistantStatusSnapshot,
  runAssistantAutomation,
  sendAssistantMessage,
  stopAssistantAutomation,
} from '../src/assistant-runtime.js'
import { resolveAssistantStatePaths } from '../src/assistant-state.js'
import { readAssistantDiagnosticsSnapshot } from '../src/assistant/diagnostics.js'
import {
  buildAssistantFailoverRoutes,
  readAssistantFailoverState,
  recordAssistantFailoverRouteFailure,
} from '../src/assistant/failover.js'
import { resetInjectedAssistantFaults } from '../src/assistant/fault-injection.js'
import {
  drainAssistantOutbox,
  listAssistantOutboxIntents,
} from '../src/assistant/outbox.js'
import { listRecentAssistantTurnReceipts } from '../src/assistant/turns.js'
import { VaultCliError } from '../src/vault-cli-errors.js'

const cleanupPaths: string[] = []

beforeEach(() => {
  robustnessMocks.deliverAssistantMessageOverBinding.mockReset()
  robustnessMocks.executeAssistantProviderTurn.mockReset()
  robustnessMocks.resolveAssistantProviderTraits.mockReset()
  robustnessMocks.resolveAssistantProviderTraits.mockImplementation((provider: string) =>
    provider === 'openai-compatible'
      ? {
          resumeKeyMode: 'none',
          sessionMode: 'stateless',
          transcriptContextMode: 'local-transcript',
          workspaceMode: 'none',
        }
      : {
          resumeKeyMode: 'provider-session-id',
          sessionMode: 'stateful',
          transcriptContextMode: 'provider-session',
          workspaceMode: 'direct-cli',
        })
  resetInjectedAssistantFaults()
})

afterEach(async () => {
  delete process.env.ASSISTANT_FAULTS
  resetInjectedAssistantFaults()
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
  vi.restoreAllMocks()
})

test('sendAssistantMessage defers retryable delivery failures into the durable outbox and refreshes assistant status snapshots', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-robustness-outbox-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  robustnessMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-outbox',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  robustnessMocks.deliverAssistantMessageOverBinding.mockRejectedValueOnce(
    new VaultCliError(
      'ASSISTANT_DELIVERY_FAILED',
      'Temporary network interruption while delivering the reply.',
      {
        retryable: true,
      },
    ),
  )

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      channel: 'telegram',
      participantId: 'contact:alice',
      sourceThreadId: 'chat-1',
      threadIsDirect: true,
      prompt: 'hello there',
      deliverResponse: true,
    })

    assert.equal(result.deliveryDeferred, true)
    assert.equal(typeof result.deliveryIntentId, 'string')
    assert.equal(result.delivery?.channel ?? null, null)
    assert.equal(result.deliveryError?.code, 'ASSISTANT_DELIVERY_FAILED')

    const snapshot = await readAssistantStatusSnapshot(vaultRoot)
    assert.equal(snapshot?.outbox.retryable, 1)
    assert.equal(snapshot?.outbox.sent, 0)
    assert.equal(snapshot?.recentTurns[0]?.status, 'deferred')
    assert.equal(snapshot?.recentTurns[0]?.deliveryDisposition, 'retryable')

    const diagnostics = await readAssistantDiagnosticsSnapshot(vaultRoot)
    assert.equal(diagnostics.counters.deliveriesQueued, 1)
    assert.equal(diagnostics.counters.deliveriesRetryable, 1)
    assert.equal(diagnostics.counters.outboxRetries, 1)

    const intents = await listAssistantOutboxIntents(vaultRoot)
    assert.equal(intents.length, 1)
    assert.equal(intents[0]?.status, 'retryable')
    assert.equal(intents[0]?.intentId, result.deliveryIntentId)

    robustnessMocks.deliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: {
        channel: 'telegram',
        sentAt: new Date().toISOString(),
        target: 'chat-1',
        targetKind: 'thread',
        messageLength: 'assistant reply'.length,
      },
      deliveryDeduplicated: false,
      outboxIntentId: result.deliveryIntentId,
      session: null,
    })

    const drained = await drainAssistantOutbox({
      now: new Date(Date.now() + 60_000),
      vault: vaultRoot,
    })
    assert.equal(drained.attempted, 1)
    assert.equal(drained.sent, 1)
    assert.equal(drained.failed, 0)

    const status = await getAssistantStatus(vaultRoot)
    assert.equal(status.outbox.retryable, 0)
    assert.equal(status.outbox.sent, 1)
    assert.equal(status.recentTurns[0]?.status, 'completed')
    assert.equal(status.recentTurns[0]?.deliveryDisposition, 'sent')
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage can queue outbound delivery without attempting a pre-commit send', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-queue-only-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  robustnessMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-queue-only',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      channel: 'telegram',
      participantId: 'contact:alice',
      sourceThreadId: 'chat-1',
      threadIsDirect: true,
      prompt: 'hello there',
      deliverResponse: true,
      deliveryDispatchMode: 'queue-only',
    })

    assert.equal(result.deliveryDeferred, true)
    assert.equal(result.delivery?.channel ?? null, null)
    assert.equal(result.deliveryError, null)
    assert.equal(typeof result.deliveryIntentId, 'string')
    assert.equal(
      robustnessMocks.deliverAssistantMessageOverBinding.mock.calls.length,
      0,
    )

    const snapshot = await readAssistantStatusSnapshot(vaultRoot)
    assert.equal(snapshot?.outbox.pending, 1)
    assert.equal(snapshot?.outbox.sent, 0)
    assert.equal(snapshot?.recentTurns[0]?.status, 'deferred')
    assert.equal(snapshot?.recentTurns[0]?.deliveryDisposition, 'queued')

    const intents = await listAssistantOutboxIntents(vaultRoot)
    assert.equal(intents.length, 1)
    assert.equal(intents[0]?.status, 'pending')
    assert.equal(intents[0]?.intentId, result.deliveryIntentId)
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('drainAssistantOutbox reconciles a journaled delivery without re-sending it', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-outbox-reconcile-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  robustnessMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-outbox-reconcile',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      channel: 'telegram',
      participantId: 'contact:alice',
      sourceThreadId: 'chat-1',
      threadIsDirect: true,
      prompt: 'hello there',
      deliverResponse: true,
      deliveryDispatchMode: 'queue-only',
    })

    const drained = await drainAssistantOutbox({
      dispatchHooks: {
        async resolveDeliveredIntent({ intent }) {
          assert.equal(intent.intentId, result.deliveryIntentId)
          return {
            channel: 'telegram',
            idempotencyKey: null,
            providerMessageId: null,
            providerThreadId: null,
            sentAt: new Date().toISOString(),
            target: 'chat-1',
            targetKind: 'thread',
            messageLength: 'assistant reply'.length,
          }
        },
      },
      vault: vaultRoot,
    })

    assert.equal(drained.attempted, 1)
    assert.equal(drained.sent, 1)
    assert.equal(drained.failed, 0)
    assert.equal(
      robustnessMocks.deliverAssistantMessageOverBinding.mock.calls.length,
      0,
    )

    const status = await getAssistantStatus(vaultRoot)
    assert.equal(status.outbox.pending, 0)
    assert.equal(status.outbox.sent, 1)
    assert.equal(status.recentTurns[0]?.status, 'completed')
    assert.equal(status.recentTurns[0]?.deliveryDisposition, 'sent')

    const intents = await listAssistantOutboxIntents(vaultRoot)
    assert.equal(intents[0]?.attemptCount, 0)
    assert.equal(intents[0]?.lastAttemptAt, null)
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('drainAssistantOutbox keeps hosted journal failures retryable', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-outbox-retryable-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  robustnessMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-outbox-retryable',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      channel: 'telegram',
      participantId: 'contact:alice',
      sourceThreadId: 'chat-1',
      threadIsDirect: true,
      prompt: 'hello there',
      deliverResponse: true,
      deliveryDispatchMode: 'queue-only',
    })

    const drained = await drainAssistantOutbox({
      dispatchHooks: {
        async resolveDeliveredIntent({ intent }) {
          assert.equal(intent.intentId, result.deliveryIntentId)
          throw Object.assign(
            new Error('Hosted runner outbox journal GET failed with HTTP 503.'),
            {
              code: 'HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED',
              context: {
                retryable: true,
                status: 503,
              },
              retryable: true,
            },
          )
        },
      },
      vault: vaultRoot,
    })

    assert.equal(drained.attempted, 1)
    assert.equal(drained.sent, 0)
    assert.equal(drained.failed, 0)
    assert.equal(drained.queued, 1)
    assert.equal(
      robustnessMocks.deliverAssistantMessageOverBinding.mock.calls.length,
      0,
    )

    const intents = await listAssistantOutboxIntents(vaultRoot)
    assert.equal(intents[0]?.status, 'retryable')

    const status = await getAssistantStatus(vaultRoot)
    assert.equal(status.outbox.retryable, 1)
    assert.equal(status.outbox.failed, 0)
    assert.equal(status.recentTurns[0]?.deliveryDisposition, 'retryable')
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('drainAssistantOutbox keeps post-send hosted journal persistence failures retryable', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-outbox-persist-retryable-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  robustnessMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-outbox-persist-retryable',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  robustnessMocks.deliverAssistantMessageOverBinding.mockResolvedValueOnce({
    delivery: {
      channel: 'telegram',
      sentAt: new Date().toISOString(),
      target: 'chat-1',
      targetKind: 'thread',
      messageLength: 'assistant reply'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: null,
    session: null,
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      channel: 'telegram',
      participantId: 'contact:alice',
      sourceThreadId: 'chat-1',
      threadIsDirect: true,
      prompt: 'hello there',
      deliverResponse: true,
      deliveryDispatchMode: 'queue-only',
    })

    const drained = await drainAssistantOutbox({
      dispatchHooks: {
        async persistDeliveredIntent({ intent }) {
          assert.equal(intent.intentId, result.deliveryIntentId)
          throw Object.assign(
            new Error('Hosted runner outbox journal PUT failed with HTTP 503.'),
            {
              code: 'HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED',
              context: {
                retryable: true,
                status: 503,
              },
              retryable: true,
            },
          )
        },
      },
      vault: vaultRoot,
    })

    assert.equal(drained.attempted, 1)
    assert.equal(drained.sent, 0)
    assert.equal(drained.failed, 0)
    assert.equal(drained.queued, 1)
    assert.equal(
      robustnessMocks.deliverAssistantMessageOverBinding.mock.calls.length,
      1,
    )

    const intents = await listAssistantOutboxIntents(vaultRoot)
    assert.equal(intents[0]?.status, 'retryable')
    assert.equal(intents[0]?.delivery, null)
    assert.equal(intents[0]?.attemptCount, 1)
    const firstAttemptAt = intents[0]?.lastAttemptAt

    const status = await getAssistantStatus(vaultRoot)
    assert.equal(status.outbox.retryable, 1)
    assert.equal(status.outbox.sent, 0)
    assert.equal(status.outbox.failed, 0)
    assert.equal(status.recentTurns[0]?.deliveryDisposition, 'retryable')

    const secondDrain = await drainAssistantOutbox({
      now: new Date(Date.now() + 60_000),
      vault: vaultRoot,
    })
    assert.equal(secondDrain.attempted, 1)
    assert.equal(secondDrain.sent, 0)
    assert.equal(secondDrain.failed, 0)
    assert.equal(secondDrain.queued, 1)
    assert.equal(
      robustnessMocks.deliverAssistantMessageOverBinding.mock.calls.length,
      1,
    )

    const retriedIntents = await listAssistantOutboxIntents(vaultRoot)
    assert.equal(retriedIntents[0]?.attemptCount, 1)
    assert.equal(retriedIntents[0]?.lastAttemptAt, firstAttemptAt)

    const reconciled = await drainAssistantOutbox({
      dispatchHooks: {
        async resolveDeliveredIntent({ intent }) {
          assert.equal(intent.intentId, result.deliveryIntentId)
          return {
            channel: 'telegram',
            idempotencyKey: intent.deliveryIdempotencyKey,
            providerMessageId: null,
            providerThreadId: null,
            sentAt: new Date().toISOString(),
            target: 'chat-1',
            targetKind: 'thread',
            messageLength: 'assistant reply'.length,
          }
        },
      },
      now: new Date(Date.now() + 180_000),
      vault: vaultRoot,
    })
    assert.equal(reconciled.attempted, 1)
    assert.equal(reconciled.sent, 1)
    assert.equal(
      robustnessMocks.deliverAssistantMessageOverBinding.mock.calls.length,
      1,
    )
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('buildAssistantFailoverRoutes dedupes routes that only differ by null versus undefined provider-option storage', () => {
  const routes = buildAssistantFailoverRoutes({
    provider: 'codex-cli',
    providerOptions: {
      model: 'gpt-oss:20b',
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
    },
    backups: [
      {
        name: null,
        provider: 'openai-compatible',
        codexCommand: null,
        model: 'gpt-oss:20b',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
        cooldownMs: null,
      },
      {
        name: null,
        provider: 'openai-compatible',
        codexCommand: null,
        model: 'gpt-oss:20b',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        cooldownMs: null,
      },
    ],
  })

  assert.equal(routes.length, 2)
  assert.equal(routes[1]?.provider, 'openai-compatible')
  assert.equal(routes[1]?.providerOptions.baseUrl, undefined)
  assert.equal(routes[1]?.providerOptions.apiKeyEnv, undefined)
  assert.equal(routes[1]?.providerOptions.providerName, undefined)
})

test('buildAssistantFailoverRoutes dedupes identical routes even when their names differ', () => {
  const routes = buildAssistantFailoverRoutes({
    provider: 'openai-compatible',
    providerOptions: {
      model: 'gpt-oss:20b',
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
    backups: [
      {
        name: 'backup-ollama',
        provider: 'openai-compatible',
        codexCommand: null,
        model: 'gpt-oss:20b',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKeyEnv: null,
        providerName: null,
        cooldownMs: null,
      },
    ],
  })

  assert.equal(routes.length, 1)
  assert.equal(routes[0]?.provider, 'openai-compatible')
  assert.equal(routes[0]?.providerOptions.baseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(routes[0]?.providerOptions.apiKeyEnv, undefined)
  assert.equal(routes[0]?.providerOptions.providerName, undefined)
  assert.match(routes[0]?.label ?? '', /127\.0\.0\.1:11434/u)
})

test('sendAssistantMessage fails over across provider routes and records cooldown and receipt state', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-robustness-failover-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  robustnessMocks.executeAssistantProviderTurn.mockImplementation(async (input: any) => {
    if (input.provider === 'codex-cli') {
      throw new VaultCliError(
        'ASSISTANT_PROVIDER_TIMEOUT',
        'Primary provider timed out before it produced a response.',
      )
    }

    return {
      provider: 'openai-compatible',
      providerSessionId: null,
      response: 'backup reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:failover',
      prompt: 'summarize the latest updates',
      provider: 'codex-cli',
      model: 'gpt-oss:20b',
      failoverRoutes: [
        {
          name: 'backup-ollama',
          provider: 'openai-compatible',
          codexCommand: null,
          model: 'backup-model',
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          baseUrl: 'http://127.0.0.1:11434/v1',
          providerName: 'ollama',
          apiKeyEnv: 'OLLAMA_API_KEY',
          cooldownMs: null,
        },
      ],
    })

    assert.equal(result.response, 'backup reply')
    assert.equal(robustnessMocks.executeAssistantProviderTurn.mock.calls.length, 2)
    const primaryCall = robustnessMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    const backupCall = robustnessMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
    assert.equal(
      primaryCall?.provider,
      'codex-cli',
    )
    assert.equal(
      backupCall?.provider,
      'openai-compatible',
    )
    assert.equal(backupCall?.model, 'backup-model')
    assert.equal(primaryCall?.conversationMessages, undefined)
    assert.equal(Array.isArray(primaryCall?.configOverrides), true)
    assert.equal(backupCall?.configOverrides, undefined)
    assert.equal(backupCall?.conversationMessages?.length ?? 0, 0)
    assert.equal(backupCall?.userPrompt, 'summarize the latest updates')

    const failoverState = await readAssistantFailoverState(vaultRoot)
    assert.equal(failoverState.routes.length, 2)
    const primaryRoute = failoverState.routes.find(
      (route) => route.provider === 'codex-cli',
    )
    const backupRoute = failoverState.routes.find(
      (route) => route.provider === 'openai-compatible',
    )
    assert.equal(primaryRoute?.failureCount, 1)
    assert.equal(primaryRoute?.consecutiveFailures, 1)
    assert.equal(typeof primaryRoute?.cooldownUntil, 'string')
    assert.equal(backupRoute?.successCount, 1)

    const status = await getAssistantStatus(vaultRoot)
    assert.equal(status.failover.routes.length, 2)
    assert.equal(
      status.warnings.some((warning) =>
        warning.includes('provider failover route(s) are cooling down'),
      ),
      true,
    )
    assert.equal(
      status.recentTurns[0]?.timeline.some(
        (entry) => entry.kind === 'provider.failover.applied',
      ),
      true,
    )
    const failoverReceipts = await listRecentAssistantTurnReceipts(vaultRoot, 1)
    assert.deepEqual(
      failoverReceipts[0]?.timeline.map((entry) => entry.kind),
      [
        'turn.started',
        'user.persisted',
        'provider.attempt.started',
        'provider.attempt.failed',
        'provider.cooldown.started',
        'provider.failover.applied',
        'provider.attempt.started',
        'provider.attempt.succeeded',
        'turn.completed',
      ],
    )
    assert.deepEqual(failoverReceipts[0]?.timeline[2]?.metadata, {
      attempt: '1',
      provider: 'codex-cli',
      model: 'gpt-oss:20b',
      routeId: primaryRoute?.routeId ?? '',
    })
    assert.deepEqual(failoverReceipts[0]?.timeline[3]?.metadata, {
      attempt: '1',
      provider: 'codex-cli',
      model: 'gpt-oss:20b',
      routeId: primaryRoute?.routeId ?? '',
      code: 'ASSISTANT_PROVIDER_TIMEOUT',
    })
    assert.deepEqual(failoverReceipts[0]?.timeline[4]?.metadata, {
      routeId: primaryRoute?.routeId ?? '',
      cooldownUntil: primaryRoute?.cooldownUntil ?? '',
    })
    assert.deepEqual(failoverReceipts[0]?.timeline[5]?.metadata, {
      from: primaryRoute?.label ?? '',
      to: backupRoute?.label ?? '',
      fromRouteId: primaryRoute?.routeId ?? '',
      toRouteId: backupRoute?.routeId ?? '',
    })
    assert.deepEqual(failoverReceipts[0]?.timeline[6]?.metadata, {
      attempt: '2',
      provider: 'openai-compatible',
      model: 'backup-model',
      routeId: backupRoute?.routeId ?? '',
    })
    assert.deepEqual(failoverReceipts[0]?.timeline[7]?.metadata, {
      attempt: '2',
      provider: 'openai-compatible',
      model: 'backup-model',
      routeId: backupRoute?.routeId ?? '',
    })
    const cooldownRoutes = buildAssistantFailoverRoutes({
      provider: 'codex-cli',
      providerOptions: {
        model: 'gpt-oss:20b',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
      },
      backups: [
        {
          name: 'backup-ollama',
          provider: 'openai-compatible',
          codexCommand: null,
          model: 'backup-model',
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          baseUrl: 'http://127.0.0.1:11434/v1',
          providerName: 'ollama',
          apiKeyEnv: 'OLLAMA_API_KEY',
          cooldownMs: null,
        },
      ],
    })
    const cooldownPrimaryRoute = cooldownRoutes.find(
      (route) => route.provider === 'codex-cli',
    )
    assert.ok(cooldownPrimaryRoute)
    await recordAssistantFailoverRouteFailure({
      vault: vaultRoot,
      route: cooldownPrimaryRoute,
      error: new VaultCliError(
        'ASSISTANT_PROVIDER_TIMEOUT',
        'Primary provider timed out before it produced a response.',
      ),
      at: '2026-03-26T22:00:00.000Z',
    })

    const cooldownResult = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:cooldown',
      prompt: 'send the cooled-over route',
      provider: 'codex-cli',
      model: 'gpt-oss:20b',
      failoverRoutes: [
        {
          name: 'backup-ollama',
          provider: 'openai-compatible',
          codexCommand: null,
          model: 'backup-model',
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          baseUrl: 'http://127.0.0.1:11434/v1',
          providerName: 'ollama',
          apiKeyEnv: 'OLLAMA_API_KEY',
          cooldownMs: null,
        },
      ],
    })

    assert.equal(cooldownResult.response, 'backup reply')
    const cooldownStatus = await getAssistantStatus(vaultRoot)
    const cooldownFailoverEntry = cooldownStatus.recentTurns
      .flatMap((turn) => turn.timeline)
      .find(
        (entry) =>
          entry.kind === 'provider.failover.applied' &&
          entry.metadata?.reason === 'cooldown',
      )
    assert.equal(cooldownFailoverEntry?.metadata?.reason, 'cooldown')
    assert.equal(typeof cooldownFailoverEntry?.metadata?.fromRouteId, 'string')
    assert.equal(typeof cooldownFailoverEntry?.metadata?.toRouteId, 'string')
    const updatedFailoverState = await readAssistantFailoverState(vaultRoot)
    const updatedPrimaryRoute = updatedFailoverState.routes.find(
      (route) => route.provider === 'codex-cli',
    )
    const updatedBackupRoute = updatedFailoverState.routes.find(
      (route) => route.provider === 'openai-compatible',
    )
    const latestReceipts = await listRecentAssistantTurnReceipts(vaultRoot, 2)
    assert.deepEqual(
      latestReceipts[0]?.timeline.map((entry) => entry.kind),
      [
        'turn.started',
        'user.persisted',
        'provider.failover.applied',
        'provider.attempt.started',
        'provider.attempt.succeeded',
        'turn.completed',
      ],
    )
    assert.deepEqual(latestReceipts[0]?.timeline[2]?.metadata, {
      from: updatedPrimaryRoute?.label ?? '',
      to: updatedBackupRoute?.label ?? '',
      fromRouteId: updatedPrimaryRoute?.routeId ?? '',
      toRouteId: updatedBackupRoute?.routeId ?? '',
      reason: 'cooldown',
    })
    assert.deepEqual(latestReceipts[0]?.timeline[3]?.metadata, {
      attempt: '1',
      provider: 'openai-compatible',
      model: 'backup-model',
      routeId: updatedBackupRoute?.routeId ?? '',
    })
    assert.deepEqual(latestReceipts[0]?.timeline[4]?.metadata, {
      attempt: '1',
      provider: 'openai-compatible',
      model: 'backup-model',
      routeId: updatedBackupRoute?.routeId ?? '',
    })
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage does not fail over a tool-bound OpenAI-compatible turn after a retryable error', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-robustness-tool-failover-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  robustnessMocks.executeAssistantProviderTurn.mockImplementation(async (input: any) => {
    if (input.provider === 'openai-compatible') {
      throw new VaultCliError(
        'ASSISTANT_PROVIDER_TIMEOUT',
        'Primary provider timed out after a tool-enabled attempt.',
        {
          retryable: true,
        },
      )
    }

    return {
      provider: 'codex-cli',
      providerSessionId: 'backup-thread',
      response: 'backup reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  try {
    await assert.rejects(
      sendAssistantMessage({
        vault: vaultRoot,
        alias: 'chat:tool-failover',
        prompt: 'set up a weekly check-in',
        provider: 'openai-compatible',
        model: 'gpt-oss:20b',
        baseUrl: 'http://127.0.0.1:11434/v1',
        failoverRoutes: [
          {
            name: 'backup-codex',
            provider: 'codex-cli',
            codexCommand: null,
            model: 'gpt-5.4',
            reasoningEffort: 'high',
            sandbox: 'workspace-write',
            approvalPolicy: 'never',
            profile: 'default',
            oss: false,
            baseUrl: null,
            providerName: null,
            apiKeyEnv: null,
            cooldownMs: null,
          },
        ],
      }),
      (error) =>
        error instanceof VaultCliError &&
        error.code === 'ASSISTANT_PROVIDER_TIMEOUT',
    )

    assert.equal(robustnessMocks.executeAssistantProviderTurn.mock.calls.length, 1)
    const primaryCall = robustnessMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    assert.equal(primaryCall?.provider, 'openai-compatible')
    assert.equal(primaryCall?.toolRuntime?.vault, vaultRoot)
    assert.equal(typeof primaryCall?.toolRuntime?.requestId, 'string')

    const failoverState = await readAssistantFailoverState(vaultRoot)
    assert.equal(failoverState.routes.length, 1)
    assert.equal(failoverState.routes[0]?.provider, 'openai-compatible')
    assert.equal(failoverState.routes[0]?.failureCount, 1)
    assert.equal(failoverState.routes[0]?.successCount, 0)

    const receipts = await listRecentAssistantTurnReceipts(vaultRoot, 1)
    assert.deepEqual(
      receipts[0]?.timeline.map((entry) => entry.kind),
      [
        'turn.started',
        'user.persisted',
        'provider.attempt.started',
        'provider.attempt.failed',
        'provider.cooldown.started',
        'turn.completed',
      ],
    )
    assert.equal(receipts[0]?.status, 'failed')
    assert.equal(
      receipts[0]?.timeline.some((entry) => entry.kind === 'provider.failover.applied'),
      false,
    )
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('recordAssistantFailoverRouteFailure honors longer route cooldowns over the derived default', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-failover-cooldown-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)
  await mkdir(vaultRoot, { recursive: true })

  const routes = buildAssistantFailoverRoutes({
    provider: 'codex-cli',
    providerOptions: {
      model: 'gpt-oss:20b',
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
    },
    backups: [
      {
        name: 'backup-ollama',
        provider: 'openai-compatible',
        codexCommand: null,
        model: 'backup-model',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        providerName: 'ollama',
        apiKeyEnv: null,
        cooldownMs: 300_000,
      },
    ],
  })
  const backupRoute = routes.find((route) => route.provider === 'openai-compatible')
  assert.ok(backupRoute)

  const nextState = await recordAssistantFailoverRouteFailure({
    vault: vaultRoot,
    at: '2026-03-26T12:00:00.000Z',
    route: backupRoute,
    error: new VaultCliError(
      'ASSISTANT_PROVIDER_TIMEOUT',
      'Backup provider timed out before it produced a response.',
    ),
  })
  const routeState = nextState.routes.find((route) => route.routeId === backupRoute.routeId)
  assert.equal(routeState?.cooldownUntil, '2026-03-26T12:05:00.000Z')
})

test('runAssistantAutomation exposes active run-lock status and rejects concurrent vault automation loops', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-robustness-runlock-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)
  await mkdir(vaultRoot, { recursive: true })

  const abortController = new AbortController()
  const firstRun = runAssistantAutomation({
    vault: vaultRoot,
    inboxServices: {} as never,
    startDaemon: false,
    scanIntervalMs: 1_000,
    signal: abortController.signal,
  })

  await new Promise((resolve) => setTimeout(resolve, 25))

  const during = await getAssistantStatus(vaultRoot)
  assert.equal(during.runLock.state, 'active')
  assert.equal(typeof during.runLock.startedAt, 'string')
  assert.equal(during.runLock.mode, 'continuous')
  assert.equal(typeof during.runLock.command, 'string')

  await assert.rejects(
    () =>
      runAssistantAutomation({
        vault: vaultRoot,
        inboxServices: {} as never,
        startDaemon: false,
        once: true,
      }),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      assert.equal(
        (error as VaultCliError).code,
        'ASSISTANT_AUTOMATION_ALREADY_RUNNING',
      )
      return true
    },
  )

  abortController.abort()
  const result = await firstRun
  assert.equal(result.reason, 'signal')

  const after = await getAssistantStatus(vaultRoot)
  assert.equal(after.runLock.state, 'unlocked')
})

test('stopAssistantAutomation gracefully stops an active run lock', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-stop-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)
  await mkdir(vaultRoot, { recursive: true })

  const paths = resolveAssistantStatePaths(vaultRoot)
  const lockPath = path.join(paths.assistantStateRoot, '.automation-run.lock')
  const metadataPath = path.join(paths.assistantStateRoot, '.automation-run-lock.json')
  await mkdir(lockPath, { recursive: true })
  await writeFile(
    metadataPath,
    JSON.stringify({
      command: 'node bin.js',
      mode: 'continuous',
      pid: process.pid,
      startedAt: '2026-03-26T02:40:28.900Z',
    }),
    'utf8',
  )

  const signals: Array<NodeJS.Signals | number | undefined> = []
  const result = await stopAssistantAutomation({
    vault: vaultRoot,
    pollIntervalMs: 10,
    timeoutMs: 100,
    killProcess(_pid, signal) {
      signals.push(signal)
      if (signal === 'SIGTERM') {
        setTimeout(() => {
          rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
        }, 20)
      }
    },
  })

  assert.deepEqual(signals, ['SIGCONT', 'SIGTERM'])
  assert.equal(result.stopMethod, 'signal')
  assert.equal(result.pid, process.pid)
  assert.equal((await getAssistantStatus(vaultRoot)).runLock.state, 'unlocked')
})

test('stopAssistantAutomation force-kills a stubborn active run lock', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-stop-force-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)
  await mkdir(vaultRoot, { recursive: true })

  const paths = resolveAssistantStatePaths(vaultRoot)
  const lockPath = path.join(paths.assistantStateRoot, '.automation-run.lock')
  const metadataPath = path.join(paths.assistantStateRoot, '.automation-run-lock.json')
  await mkdir(lockPath, { recursive: true })
  await writeFile(
    metadataPath,
    JSON.stringify({
      command: 'node bin.js',
      mode: 'continuous',
      pid: process.pid,
      startedAt: '2026-03-26T02:40:28.900Z',
    }),
    'utf8',
  )

  const signals: Array<NodeJS.Signals | number | undefined> = []
  const result = await stopAssistantAutomation({
    vault: vaultRoot,
    pollIntervalMs: 10,
    timeoutMs: 20,
    forceKillTimeoutMs: 100,
    killProcess(_pid, signal) {
      signals.push(signal)
      if (signal === 'SIGKILL') {
        setTimeout(() => {
          rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
        }, 20)
      }
    },
  })

  assert.deepEqual(signals, ['SIGCONT', 'SIGTERM', 'SIGKILL'])
  assert.equal(result.stopMethod, 'force-kill')
  assert.equal((await getAssistantStatus(vaultRoot)).runLock.state, 'unlocked')
})

test('stopAssistantAutomation clears a stale run lock without signalling a process', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-stop-stale-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)
  await mkdir(vaultRoot, { recursive: true })

  const paths = resolveAssistantStatePaths(vaultRoot)
  const lockPath = path.join(paths.assistantStateRoot, '.automation-run.lock')
  const metadataPath = path.join(paths.assistantStateRoot, '.automation-run-lock.json')
  await mkdir(lockPath, { recursive: true })
  await writeFile(
    metadataPath,
    JSON.stringify({
      command: 'node bin.js',
      mode: 'continuous',
      pid: 999_999,
      startedAt: '2026-03-26T02:40:28.900Z',
    }),
    'utf8',
  )

  const signals: Array<NodeJS.Signals | number | undefined> = []
  const result = await stopAssistantAutomation({
    vault: vaultRoot,
    killProcess(_pid, signal) {
      signals.push(signal)
    },
  })

  assert.deepEqual(signals, [])
  assert.equal(result.stopMethod, 'stale-lock-cleanup')
  assert.equal((await getAssistantStatus(vaultRoot)).runLock.state, 'unlocked')
})

test('delivery fault injection queues the outbox without performing a real outbound send', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-robustness-faults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot
  process.env.ASSISTANT_FAULTS = 'delivery'

  robustnessMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-fault',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      channel: 'telegram',
      participantId: 'contact:bob',
      sourceThreadId: 'chat-fault',
      threadIsDirect: true,
      prompt: 'check the injected delivery path',
      deliverResponse: true,
    })

    assert.equal(result.deliveryDeferred, true)
    assert.equal(
      robustnessMocks.deliverAssistantMessageOverBinding.mock.calls.length,
      0,
    )

    const diagnostics = await readAssistantDiagnosticsSnapshot(vaultRoot)
    assert.equal(
      diagnostics.recentWarnings.some((warning) =>
        warning.includes('Injected assistant delivery failure'),
      ),
      true,
    )

    const receipts = await listRecentAssistantTurnReceipts(vaultRoot, 1)
    assert.equal(receipts[0]?.status, 'deferred')
    assert.equal(
      receipts[0]?.timeline.some(
        (entry) => entry.kind === 'delivery.retry-scheduled',
      ),
      true,
    )
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

function restoreEnvironmentVariable(
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
