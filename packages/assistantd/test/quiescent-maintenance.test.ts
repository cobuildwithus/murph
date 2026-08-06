import assert from 'node:assert/strict'
import { setImmediate as waitForImmediate } from 'node:timers/promises'
import { test, vi } from 'vitest'

import {
  createAssistantQuiescentMaintenanceOwner,
} from '../src/quiescent-maintenance.js'

test('quiescent maintenance coalesces, yields, resumes, and stops', async () => {
  const signals: AbortSignal[] = []
  const resolutions: Array<() => void> = []
  const run = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal)
    await new Promise<void>((resolve) => resolutions.push(resolve))
  })
  const owner = createAssistantQuiescentMaintenanceOwner({ run })

  owner.start()
  owner.start()
  await waitForImmediate()
  assert.equal(run.mock.calls.length, 1)
  assert.equal(signals[0]?.aborted, false)

  owner.foregroundStarted()
  assert.equal(signals[0]?.aborted, true)
  assert.equal(signals[0]?.reason?.name, 'AbortError')
  owner.foregroundCompleted()
  resolutions[0]?.()
  await waitForImmediate()
  await waitForImmediate()
  assert.equal(run.mock.calls.length, 2)
  assert.equal(signals[1]?.aborted, false)

  owner.foregroundStarted()
  owner.foregroundStarted()
  assert.equal(signals[1]?.aborted, true)
  owner.foregroundCompleted()
  resolutions[1]?.()
  await waitForImmediate()
  assert.equal(run.mock.calls.length, 2)
  owner.foregroundCompleted()
  await waitForImmediate()
  assert.equal(run.mock.calls.length, 3)

  owner.stop()
  assert.equal(signals[2]?.aborted, true)
  resolutions[2]?.()
})

test('a completed idle sweep does not spin or rerun without a trigger', async () => {
  const run = vi.fn(async () => undefined)
  const owner = createAssistantQuiescentMaintenanceOwner({ run })

  owner.start()
  await waitForImmediate()
  await waitForImmediate()

  assert.equal(run.mock.calls.length, 1)
})
