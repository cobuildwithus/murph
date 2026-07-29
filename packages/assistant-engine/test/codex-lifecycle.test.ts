import { readFile } from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('../src/codex-lifecycle.ts')
})

describe('Codex lifecycle facade', () => {
  it('does not import the Codex implementation', async () => {
    const source = await readFile(
      new URL('../src/codex-lifecycle.ts', import.meta.url),
      'utf8',
    )

    expect(source).not.toContain('./assistant-codex.js')
  })

  it('stops without loading or registering the Codex implementation', async () => {
    const {
      cancelPendingWarmCodexPreinitialization,
      stopWarmCodexAppServer,
      waitForWarmCodexBackgroundWork,
    } = await import('../src/codex-lifecycle.ts')

    await expect(cancelPendingWarmCodexPreinitialization())
      .resolves.toBeUndefined()
    await expect(stopWarmCodexAppServer('cli-exit')).resolves.toBeUndefined()
    await expect(waitForWarmCodexBackgroundWork()).resolves.toBeUndefined()
  })

  it('delegates lifecycle boundaries after implementations register', async () => {
    const {
      cancelPendingWarmCodexPreinitialization,
      registerCancelPendingWarmCodexPreinitialization,
      registerStopWarmCodexAppServer,
      registerWaitForWarmCodexBackgroundWork,
      stopWarmCodexAppServer,
      waitForWarmCodexBackgroundWork,
    } = await import('../src/codex-lifecycle.ts')
    const cancelImplementation = vi.fn(async () => undefined)
    const stopImplementation = vi.fn(async () => undefined)
    const waitImplementation = vi.fn(async () => undefined)
    const abortController = new AbortController()

    registerCancelPendingWarmCodexPreinitialization(cancelImplementation)
    registerStopWarmCodexAppServer(stopImplementation)
    registerWaitForWarmCodexBackgroundWork(waitImplementation)
    await cancelPendingWarmCodexPreinitialization()
    await stopWarmCodexAppServer('cli-exit')
    await stopWarmCodexAppServer()
    await waitForWarmCodexBackgroundWork({ signal: abortController.signal })

    expect(cancelImplementation).toHaveBeenCalledExactlyOnceWith()
    expect(stopImplementation.mock.calls).toEqual([
      ['cli-exit'],
      ['external-stop'],
    ])
    expect(waitImplementation).toHaveBeenCalledExactlyOnceWith({
      signal: abortController.signal,
    })
  })

  it(
    'registers the existing implementation when assistant Codex loads',
    async () => {
      const registerCancelPendingWarmCodexPreinitialization = vi.fn()
      const registerStopWarmCodexAppServer = vi.fn()
      const registerWaitForWarmCodexBackgroundWork = vi.fn()
      vi.doMock('../src/codex-lifecycle.ts', () => ({
        registerCancelPendingWarmCodexPreinitialization,
        registerStopWarmCodexAppServer,
        registerWaitForWarmCodexBackgroundWork,
      }))

      const {
        cancelPendingWarmCodexPreinitialization,
        stopWarmCodexAppServer,
        waitForWarmCodexBackgroundWork,
      } = await import('../src/assistant-codex.ts')

      expect(registerCancelPendingWarmCodexPreinitialization)
        .toHaveBeenCalledExactlyOnceWith(
          cancelPendingWarmCodexPreinitialization,
        )
      expect(registerStopWarmCodexAppServer)
        .toHaveBeenCalledExactlyOnceWith(stopWarmCodexAppServer)
      expect(registerWaitForWarmCodexBackgroundWork)
        .toHaveBeenCalledExactlyOnceWith(waitForWarmCodexBackgroundWork)
    },
    120_000,
  )
})
