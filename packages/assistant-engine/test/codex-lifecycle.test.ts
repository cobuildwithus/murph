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
    const { stopWarmCodexAppServer } = await import('../src/codex-lifecycle.ts')

    await expect(stopWarmCodexAppServer('cli-exit')).resolves.toBeUndefined()
  })

  it('delegates shutdown after an implementation registers', async () => {
    const {
      registerStopWarmCodexAppServer,
      stopWarmCodexAppServer,
    } = await import('../src/codex-lifecycle.ts')
    const stopImplementation = vi.fn(async () => undefined)

    registerStopWarmCodexAppServer(stopImplementation)
    await stopWarmCodexAppServer('cli-exit')
    await stopWarmCodexAppServer()

    expect(stopImplementation.mock.calls).toEqual([
      ['cli-exit'],
      ['external-stop'],
    ])
  })

  it('registers the existing implementation when assistant Codex loads', async () => {
    const registerStopWarmCodexAppServer = vi.fn()
    vi.doMock('../src/codex-lifecycle.ts', () => ({
      registerStopWarmCodexAppServer,
    }))

    const { stopWarmCodexAppServer } = await import('../src/assistant-codex.ts')

    expect(registerStopWarmCodexAppServer)
      .toHaveBeenCalledExactlyOnceWith(stopWarmCodexAppServer)
  })
})
