import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test, vi } from 'vitest'

const robustnessMocks = vi.hoisted(() => ({
  deliverAssistantMessageOverBinding: vi.fn(),
  executeAssistantProviderTurn: vi.fn(),
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

vi.mock('../src/chat-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../src/chat-provider.js')>(
    '../src/chat-provider.js',
  )

  return {
    ...actual,
    executeAssistantProviderTurn: robustnessMocks.executeAssistantProviderTurn,
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
import { readAssistantFailoverState } from '../src/assistant/failover.js'
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
  resetInjectedAssistantFaults()
})

afterEach(async () => {
  delete process.env.HEALTHYBOB_ASSISTANT_FAULTS
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-robustness-outbox-'))
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

test('sendAssistantMessage fails over across provider routes and records cooldown and receipt state', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-robustness-failover-'))
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
          maxAttempts: null,
        },
      ],
    })

    assert.equal(result.response, 'backup reply')
    assert.equal(robustnessMocks.executeAssistantProviderTurn.mock.calls.length, 2)
    assert.equal(
      robustnessMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]?.provider,
      'codex-cli',
    )
    assert.equal(
      robustnessMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.provider,
      'openai-compatible',
    )
    assert.equal(
      robustnessMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.model,
      'backup-model',
    )

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
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('runAssistantAutomation exposes active run-lock status and rejects concurrent vault automation loops', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-robustness-runlock-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-stop-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-stop-force-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-stop-stale-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-robustness-faults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot
  process.env.HEALTHYBOB_ASSISTANT_FAULTS = 'delivery'

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
