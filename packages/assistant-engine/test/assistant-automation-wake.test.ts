import { describe, expect, test } from 'vitest'

import {
  createAssistantAutomationWakeController,
} from '../src/assistant/automation/shared.js'

describe('assistant automation wake controller', () => {
  test('wakes an in-flight waiter and consumes the pending wake once', async () => {
    const wakeController = createAssistantAutomationWakeController()
    const abortController = new AbortController()
    let resolved = false

    const waitPromise = wakeController
      .waitForWakeOrTimeout(abortController.signal, 1000)
      .then(() => {
        resolved = true
      })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(resolved).toBe(false)

    wakeController.requestWake()
    await waitPromise

    expect(resolved).toBe(true)
    expect(wakeController.consumePendingWake()).toBe(true)
    expect(wakeController.consumePendingWake()).toBe(false)
  })

  test('returns immediately when a wake is already pending', async () => {
    const wakeController = createAssistantAutomationWakeController()
    const abortController = new AbortController()
    wakeController.requestWake()

    const outcome = await Promise.race([
      wakeController
        .waitForWakeOrTimeout(abortController.signal, 1000)
        .then(() => 'woke' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ])

    expect(outcome).toBe('woke')
    expect(wakeController.consumePendingWake()).toBe(true)
  })
})
