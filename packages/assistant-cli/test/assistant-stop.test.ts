import assert from 'node:assert/strict'

import { beforeEach, test as baseTest, vi } from 'vitest'

const test = baseTest.sequential

const processKillMocks = vi.hoisted(() => ({
  tryKillProcess: vi.fn(),
}))

const storeMocks = vi.hoisted(() => ({
  redactAssistantDisplayPath: vi.fn((value: string) => value),
  resolveAssistantStatePaths: vi.fn(),
}))

const automationMocks = vi.hoisted(() => ({
  clearAssistantAutomationRunLock: vi.fn(),
  inspectAssistantAutomationRunLock: vi.fn(),
}))

vi.mock('@murphai/assistant-engine/process-kill', () => ({
  tryKillProcess: processKillMocks.tryKillProcess,
}))

vi.mock('../src/assistant/store.ts', () => ({
  redactAssistantDisplayPath: storeMocks.redactAssistantDisplayPath,
  resolveAssistantStatePaths: storeMocks.resolveAssistantStatePaths,
}))

vi.mock('@murphai/assistant-engine/assistant-automation', () => ({
  clearAssistantAutomationRunLock: automationMocks.clearAssistantAutomationRunLock,
  inspectAssistantAutomationRunLock: automationMocks.inspectAssistantAutomationRunLock,
}))

import { stopAssistantAutomation } from '../src/assistant/stop.ts'

const TEST_VAULT = '/tmp/assistant-stop'
const TEST_PATHS = {
  absoluteVaultRoot: TEST_VAULT,
  assistantStateRoot: `${TEST_VAULT}/.runtime/operations/assistant`,
}

beforeEach(() => {
  processKillMocks.tryKillProcess.mockReset()
  storeMocks.resolveAssistantStatePaths.mockReset()
  storeMocks.redactAssistantDisplayPath.mockClear()
  automationMocks.clearAssistantAutomationRunLock.mockReset()
  automationMocks.inspectAssistantAutomationRunLock.mockReset()

  storeMocks.resolveAssistantStatePaths.mockReturnValue(TEST_PATHS)
  processKillMocks.tryKillProcess.mockImplementation(
    (
      killProcess: (pid: number, signal?: NodeJS.Signals | number) => void,
      pid: number,
      signal: NodeJS.Signals | number,
    ) => {
      killProcess(pid, signal)
    },
  )
})

test('stopAssistantAutomation rejects unlocked state before sending signals', async () => {
  automationMocks.inspectAssistantAutomationRunLock.mockResolvedValueOnce({
    state: 'unlocked',
    pid: null,
    startedAt: null,
    mode: null,
    command: null,
    reason: null,
  })

  await assert.rejects(
    () => stopAssistantAutomation({ vault: TEST_VAULT }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(
        'code' in error ? error.code : undefined,
        'ASSISTANT_AUTOMATION_NOT_RUNNING',
      )
      return true
    },
  )
  assert.equal(processKillMocks.tryKillProcess.mock.calls.length, 0)
})

test('stopAssistantAutomation clears stale locks without signaling a process', async () => {
  automationMocks.inspectAssistantAutomationRunLock.mockResolvedValueOnce({
    state: 'stale',
    pid: 42,
    startedAt: '2026-04-08T00:00:00.000Z',
    mode: 'continuous',
    command: 'murph automation',
    reason: 'process exited',
  })

  const result = await stopAssistantAutomation({
    now: () => new Date('2026-04-08T01:00:00.000Z'),
    vault: TEST_VAULT,
  })

  assert.equal(result.stopMethod, 'stale-lock-cleanup')
  assert.equal(result.stopped, true)
  assert.equal(result.pid, 42)
  assert.equal(automationMocks.clearAssistantAutomationRunLock.mock.calls.length, 1)
  assert.equal(processKillMocks.tryKillProcess.mock.calls.length, 0)
})

test('stopAssistantAutomation fails fast when the active lock has no pid', async () => {
  automationMocks.inspectAssistantAutomationRunLock.mockResolvedValueOnce({
    state: 'active',
    pid: null,
    startedAt: '2026-04-08T00:00:00.000Z',
    mode: 'continuous',
    command: 'murph automation',
    reason: null,
  })

  await assert.rejects(
    () => stopAssistantAutomation({ vault: TEST_VAULT }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(
        'code' in error ? error.code : undefined,
        'ASSISTANT_AUTOMATION_STOP_FAILED',
      )
      return true
    },
  )
})

test('stopAssistantAutomation returns a signal stop result once the lock clears', async () => {
  const killProcess = vi.fn()
  const sleep = vi.fn(async () => undefined)

  automationMocks.inspectAssistantAutomationRunLock
    .mockResolvedValueOnce({
      state: 'active',
      pid: 42,
      startedAt: '2026-04-08T00:00:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: null,
    })
    .mockResolvedValueOnce({
      state: 'unlocked',
      pid: null,
      startedAt: null,
      mode: null,
      command: null,
      reason: null,
    })

  const result = await stopAssistantAutomation({
    killProcess,
    now: () => new Date('2026-04-08T01:00:00.000Z'),
    pollIntervalMs: 5,
    sleep,
    timeoutMs: 15,
    vault: TEST_VAULT,
  })

  assert.equal(result.stopMethod, 'signal')
  assert.deepEqual(killProcess.mock.calls, [
    [42, 'SIGCONT'],
    [42, 'SIGTERM'],
  ])
  assert.deepEqual(sleep.mock.calls, [[5]])
})

test('stopAssistantAutomation clears stale locks discovered after SIGTERM', async () => {
  const killProcess = vi.fn()

  automationMocks.inspectAssistantAutomationRunLock
    .mockResolvedValueOnce({
      state: 'active',
      pid: 42,
      startedAt: '2026-04-08T00:00:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: null,
    })
    .mockResolvedValueOnce({
      state: 'stale',
      pid: 42,
      startedAt: '2026-04-08T00:00:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: 'process exited',
    })

  const result = await stopAssistantAutomation({
    killProcess,
    now: () => new Date('2026-04-08T01:00:00.000Z'),
    pollIntervalMs: 5,
    sleep: async () => undefined,
    timeoutMs: 15,
    vault: TEST_VAULT,
  })

  assert.equal(result.stopMethod, 'signal')
  assert.match(result.message, /stale run lock/u)
  assert.equal(automationMocks.clearAssistantAutomationRunLock.mock.calls.length, 1)
})

test('stopAssistantAutomation detects restart races before attempting a force kill', async () => {
  const killProcess = vi.fn()

  automationMocks.inspectAssistantAutomationRunLock
    .mockResolvedValueOnce({
      state: 'active',
      pid: 42,
      startedAt: '2026-04-08T00:00:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: null,
    })
    .mockResolvedValueOnce({
      state: 'active',
      pid: 99,
      startedAt: '2026-04-08T00:10:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: null,
    })

  await assert.rejects(
    () =>
      stopAssistantAutomation({
        killProcess,
        pollIntervalMs: 5,
        sleep: async () => undefined,
        timeoutMs: 15,
        vault: TEST_VAULT,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(
        'code' in error ? error.code : undefined,
        'ASSISTANT_AUTOMATION_RESTARTED',
      )
      return true
    },
  )

  assert.deepEqual(killProcess.mock.calls, [
    [42, 'SIGCONT'],
    [42, 'SIGTERM'],
  ])
})

test('stopAssistantAutomation force-kills stubborn processes when SIGTERM does not clear the lock', async () => {
  const killProcess = vi.fn()

  automationMocks.inspectAssistantAutomationRunLock
    .mockResolvedValueOnce({
      state: 'active',
      pid: 42,
      startedAt: '2026-04-08T00:00:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: null,
    })
    .mockResolvedValueOnce({
      state: 'active',
      pid: 42,
      startedAt: '2026-04-08T00:00:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: null,
    })
    .mockResolvedValueOnce({
      state: 'active',
      pid: 42,
      startedAt: '2026-04-08T00:00:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: null,
    })
    .mockResolvedValueOnce({
      state: 'unlocked',
      pid: null,
      startedAt: null,
      mode: null,
      command: null,
      reason: null,
    })

  const result = await stopAssistantAutomation({
    forceKillTimeoutMs: 10,
    killProcess,
    pollIntervalMs: 5,
    sleep: async () => undefined,
    timeoutMs: 5,
    vault: TEST_VAULT,
  })

  assert.equal(result.stopMethod, 'force-kill')
  assert.deepEqual(killProcess.mock.calls, [
    [42, 'SIGCONT'],
    [42, 'SIGTERM'],
    [42, 'SIGKILL'],
  ])
})

test('stopAssistantAutomation times out when the lock never changes', async () => {
  const killProcess = vi.fn()

  automationMocks.inspectAssistantAutomationRunLock
    .mockResolvedValueOnce({
      state: 'active',
      pid: 42,
      startedAt: '2026-04-08T00:00:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: null,
    })
    .mockResolvedValue({
      state: 'active',
      pid: 42,
      startedAt: '2026-04-08T00:00:00.000Z',
      mode: 'continuous',
      command: 'murph automation',
      reason: null,
    })

  await assert.rejects(
    () =>
      stopAssistantAutomation({
        forceKillTimeoutMs: 5,
        killProcess,
        pollIntervalMs: 5,
        sleep: async () => undefined,
        timeoutMs: 5,
        vault: TEST_VAULT,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(
        'code' in error ? error.code : undefined,
        'ASSISTANT_AUTOMATION_STOP_TIMEOUT',
      )
      return true
    },
  )

  assert.deepEqual(killProcess.mock.calls, [
    [42, 'SIGCONT'],
    [42, 'SIGTERM'],
    [42, 'SIGKILL'],
  ])
})
