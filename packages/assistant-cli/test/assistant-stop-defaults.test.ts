import assert from 'node:assert/strict'

import { afterEach, beforeEach, test as baseTest, vi } from 'vitest'

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

const TEST_VAULT = '/tmp/assistant-stop-defaults'
const TEST_PATHS = {
  absoluteVaultRoot: TEST_VAULT,
  assistantStateRoot: `${TEST_VAULT}/.runtime/operations/assistant`,
}

beforeEach(() => {
  vi.useFakeTimers()
  processKillMocks.tryKillProcess.mockReset()
  storeMocks.resolveAssistantStatePaths.mockReset()
  storeMocks.redactAssistantDisplayPath.mockClear()
  automationMocks.clearAssistantAutomationRunLock.mockReset()
  automationMocks.inspectAssistantAutomationRunLock.mockReset()

  storeMocks.resolveAssistantStatePaths.mockReturnValue(TEST_PATHS)
  processKillMocks.tryKillProcess.mockImplementation(
    (
      killProcess: (pid: number, signal?: NodeJS.Signals | number) => boolean,
      pid: number,
      signal: NodeJS.Signals | number,
    ) => {
      killProcess(pid, signal)
    },
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('stopAssistantAutomation uses default sleep and killProcess helpers with normalized minimum polling values', async () => {
  const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true)

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

  const stopPromise = stopAssistantAutomation({
    pollIntervalMs: 0.4,
    timeoutMs: 0.8,
    vault: TEST_VAULT,
  })

  await vi.advanceTimersByTimeAsync(1)
  const result = await stopPromise

  assert.equal(result.stopMethod, 'signal')
  assert.deepEqual(killSpy.mock.calls, [
    [42, 'SIGCONT'],
    [42, 'SIGTERM'],
  ])
})
