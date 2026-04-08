import assert from 'node:assert/strict'
import { setTimeout as realSleep } from 'node:timers/promises'

import { afterEach, describe, test, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { createDeferred } from './test-helpers.js'

type TurnLockHandle = {
  release: () => Promise<void>
}

type AcquireWriteLock = () => Promise<TurnLockHandle>

const defaultAcquireWriteLock: AcquireWriteLock = async () => ({
  release: async () => undefined,
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.doUnmock('@murphai/operator-config/vault-cli-errors')
  vi.doUnmock('../src/assistant/state-write-lock.ts')
  vi.doUnmock('../src/assistant/store/paths.ts')
  vi.resetModules()
})

describe('assistant turn lock', () => {
  test('queues same-process turns for the same vault until the current turn releases', async () => {
    const events: string[] = []
    const firstHolding = createDeferred<void>()
    const releaseFirst = createDeferred<void>()

    const { acquireWriteLockMock, withAssistantTurnLock } = await loadTurnLockModule({
      acquireWriteLock: async () => ({
        release: async () => {
          events.push('release')
        },
      }),
    })

    const first = withAssistantTurnLock({
      run: async () => {
        events.push('first:start')
        firstHolding.resolve()
        await releaseFirst.promise
        events.push('first:end')
        return 'first-result'
      },
      vault: 'vault-queue',
    })

    await firstHolding.promise

    const second = withAssistantTurnLock({
      run: async () => {
        events.push('second:start')
        events.push('second:end')
        return 'second-result'
      },
      vault: 'vault-queue',
    })

    await flushMicrotasks()
    assert.equal(acquireWriteLockMock.mock.calls.length, 1)
    assert.deepEqual(events, ['first:start'])

    releaseFirst.resolve()

    assert.deepEqual(await Promise.all([first, second]), [
      'first-result',
      'second-result',
    ])
    assert.equal(acquireWriteLockMock.mock.calls.length, 2)
    assert.deepEqual(events, [
      'first:start',
      'first:end',
      'release',
      'second:start',
      'second:end',
      'release',
    ])
  })

  test('retries after a held lock error before entering the turn body', async () => {
    vi.useFakeTimers()

    const events: string[] = []
    const firstAttempt = createDeferred<void>()
    let attempts = 0
    const { acquireWriteLockMock, withAssistantTurnLock } = await loadTurnLockModule({
      acquireWriteLock: async () => {
        attempts += 1
        if (attempts === 1) {
          firstAttempt.resolve()
          throw new VaultCliError(
            'ASSISTANT_TURN_LOCKED',
            'Assistant turn is already in progress for this vault.',
          )
        }

        return {
          release: async () => {
            events.push('release')
          },
        }
      },
    })

    const promise = withAssistantTurnLock({
      run: async () => {
        events.push('run')
        return 'retried-result'
      },
      vault: 'vault-held-lock',
    })

    await firstAttempt.promise
    assert.equal(acquireWriteLockMock.mock.calls.length, 1)
    assert.deepEqual(events, [])

    await vi.advanceTimersByTimeAsync(49)
    assert.equal(acquireWriteLockMock.mock.calls.length, 1)
    assert.deepEqual(events, [])

    await vi.advanceTimersByTimeAsync(1)

    assert.equal(await promise, 'retried-result')
    assert.equal(acquireWriteLockMock.mock.calls.length, 2)
    assert.deepEqual(events, ['run', 'release'])
  })

  test('rejects already-aborted callers before trying to acquire the turn lock', async () => {
    const controller = new AbortController()
    controller.abort()

    let ran = false
    const { acquireWriteLockMock, withAssistantTurnLock } = await loadTurnLockModule()

    await assert.rejects(
      () =>
        withAssistantTurnLock({
          abortSignal: controller.signal,
          run: async () => {
            ran = true
            return 'unexpected'
          },
          vault: 'vault-abort-before-wait',
        }),
      (error) => {
        assert.ok(error instanceof VaultCliError)
        assert.equal(error.code, 'ASSISTANT_TURN_ABORTED')
        assert.equal(
          error.message,
          'Assistant turn was aborted while waiting for the vault turn lock.',
        )
        return true
      },
    )

    assert.equal(ran, false)
    assert.equal(acquireWriteLockMock.mock.calls.length, 0)
  })

  test('aborts while sleeping between held-lock retries', async () => {
    vi.useFakeTimers()

    const controller = new AbortController()
    const firstAttempt = createDeferred<void>()
    let ran = false
    const { acquireWriteLockMock, withAssistantTurnLock } = await loadTurnLockModule({
      acquireWriteLock: async () => {
        firstAttempt.resolve()
        throw new VaultCliError(
          'ASSISTANT_TURN_LOCKED',
          'Assistant turn is already in progress for this vault.',
        )
      },
    })

    const promise = withAssistantTurnLock({
      abortSignal: controller.signal,
      run: async () => {
        ran = true
        return 'unexpected'
      },
      vault: 'vault-abort-held-wait',
    })

    await firstAttempt.promise
    assert.equal(acquireWriteLockMock.mock.calls.length, 1)

    controller.abort()

    await assert.rejects(promise, (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_TURN_ABORTED')
      return true
    })

    assert.equal(ran, false)
    assert.equal(acquireWriteLockMock.mock.calls.length, 1)
  })

  test('observes an abort that arrives after the queue wait but before lock acquisition', async () => {
    const controller = new AbortController()
    const firstHolding = createDeferred<void>()
    const releaseFirst = createDeferred<void>()
    const { acquireWriteLockMock, withAssistantTurnLock } = await loadTurnLockModule({
      acquireWriteLock: async () => ({
        release: async () => undefined,
      }),
    })

    const first = withAssistantTurnLock({
      run: async () => {
        firstHolding.resolve()
        await releaseFirst.promise
        return 'first-result'
      },
      vault: 'vault-abort-between-queue-and-lock',
    })

    await firstHolding.promise

    const second = withAssistantTurnLock({
      abortSignal: controller.signal,
      run: async () => 'unexpected',
      vault: 'vault-abort-between-queue-and-lock',
    })

    await flushMicrotasks()
    queueMicrotask(() => controller.abort())
    releaseFirst.resolve()

    await assert.rejects(
      second,
      (error) => {
        assert.ok(error instanceof VaultCliError)
        assert.equal(error.code, 'ASSISTANT_TURN_ABORTED')
        return true
      },
    )
    await assert.doesNotReject(first)
    assert.equal(acquireWriteLockMock.mock.calls.length, 1)
  })

  test('rethrows non-held lock acquisition errors immediately', async () => {
    const failure = new Error('lock backend exploded')
    const { acquireWriteLockMock, withAssistantTurnLock } = await loadTurnLockModule({
      acquireWriteLock: async () => {
        throw failure
      },
    })

    await assert.rejects(
      () =>
        withAssistantTurnLock({
          run: async () => 'unexpected',
          vault: 'vault-non-held-error',
        }),
      failure,
    )

    assert.equal(acquireWriteLockMock.mock.calls.length, 1)
  })

  test('rethrows non-abort wait failures between held-lock retries', async () => {
    const timerFailure = new Error('sleep exploded')
    const { withAssistantTurnLock } = await loadTurnLockModule({
      acquireWriteLock: async () => {
        throw new VaultCliError(
          'ASSISTANT_TURN_LOCKED',
          'Assistant turn is already in progress for this vault.',
        )
      },
      sleep: async () => {
        throw timerFailure
      },
    })

    await assert.rejects(
      () =>
        withAssistantTurnLock({
          run: async () => 'unexpected',
          vault: 'vault-sleep-error',
        }),
      timerFailure,
    )
  })

  test('releases aborted queue slots so later queued turns can still run', async () => {
    const events: string[] = []
    const firstHolding = createDeferred<void>()
    const releaseFirst = createDeferred<void>()
    const secondController = new AbortController()

    const { acquireWriteLockMock, withAssistantTurnLock } = await loadTurnLockModule({
      acquireWriteLock: async () => ({
        release: async () => {
          events.push('release')
        },
      }),
    })

    const first = withAssistantTurnLock({
      run: async () => {
        events.push('first:start')
        firstHolding.resolve()
        await releaseFirst.promise
        events.push('first:end')
        return 'first-result'
      },
      vault: 'vault-queue-abort',
    })

    await firstHolding.promise

    const second = withAssistantTurnLock({
      abortSignal: secondController.signal,
      run: async () => {
        events.push('second:start')
        return 'second-result'
      },
      vault: 'vault-queue-abort',
    })

    const third = withAssistantTurnLock({
      run: async () => {
        events.push('third:start')
        events.push('third:end')
        return 'third-result'
      },
      vault: 'vault-queue-abort',
    })

    await flushMicrotasks()
    assert.equal(acquireWriteLockMock.mock.calls.length, 1)
    assert.deepEqual(events, ['first:start'])

    secondController.abort()

    await assert.rejects(second, (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_TURN_ABORTED')
      return true
    })

    assert.equal(acquireWriteLockMock.mock.calls.length, 1)
    assert.deepEqual(events, ['first:start'])

    releaseFirst.resolve()

    assert.deepEqual(await Promise.all([first, third]), [
      'first-result',
      'third-result',
    ])
    assert.equal(acquireWriteLockMock.mock.calls.length, 2)
    assert.deepEqual(events, [
      'first:start',
      'first:end',
      'release',
      'third:start',
      'third:end',
      'release',
    ])
  })

  test('lets later queued turns proceed even when the prior turn rejects', async () => {
    const events: string[] = []
    const firstHolding = createDeferred<void>()
    const releaseFirst = createDeferred<void>()

    const { acquireWriteLockMock, withAssistantTurnLock } = await loadTurnLockModule({
      acquireWriteLock: async () => ({
        release: async () => {
          events.push('release')
        },
      }),
    })

    const first = withAssistantTurnLock({
      run: async () => {
        events.push('first:start')
        firstHolding.resolve()
        await releaseFirst.promise
        events.push('first:throw')
        throw new Error('first failed')
      },
      vault: 'vault-queue-rejection',
    })

    await firstHolding.promise

    const second = withAssistantTurnLock({
      run: async () => {
        events.push('second:start')
        events.push('second:end')
        return 'second-result'
      },
      vault: 'vault-queue-rejection',
    })

    await flushMicrotasks()
    releaseFirst.resolve()

    await assert.rejects(first, /first failed/u)
    await assert.doesNotReject(second)
    assert.equal(await second, 'second-result')
    assert.equal(acquireWriteLockMock.mock.calls.length, 2)
    assert.deepEqual(events, [
      'first:start',
      'first:throw',
      'release',
      'second:start',
      'second:end',
      'release',
    ])
  })

  test('waits behind a prior turn with an abort signal and removes the abort listener after success', async () => {
    const firstHolding = createDeferred<void>()
    const releaseFirst = createDeferred<void>()
    const controller = new AbortController()
    const addEventListenerSpy = vi.spyOn(controller.signal, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(controller.signal, 'removeEventListener')

    const { withAssistantTurnLock } = await loadTurnLockModule()

    const first = withAssistantTurnLock({
      run: async () => {
        firstHolding.resolve()
        await releaseFirst.promise
        return 'first-result'
      },
      vault: 'vault-queue-abort-success',
    })

    await firstHolding.promise

    const second = withAssistantTurnLock({
      abortSignal: controller.signal,
      run: async () => 'second-result',
      vault: 'vault-queue-abort-success',
    })

    releaseFirst.resolve()

    assert.deepEqual(await Promise.all([first, second]), [
      'first-result',
      'second-result',
    ])
    assert.equal(addEventListenerSpy.mock.calls.length, 1)
    assert.equal(removeEventListenerSpy.mock.calls.length, 1)
  })
})

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function loadTurnLockModule(input?: {
  acquireWriteLock?: AcquireWriteLock
  assistantStateRoot?(vault: string): string
  sleep?: (
    delay: number,
    value: undefined,
    options?: { signal?: AbortSignal },
  ) => Promise<void>
}): Promise<
  typeof import('../src/assistant/turn-lock.ts') & {
    acquireWriteLockMock: ReturnType<typeof vi.fn<AcquireWriteLock>>
    resolveAssistantStatePathsMock: ReturnType<typeof vi.fn<(vault: string) => { assistantStateRoot: string }>>
  }
> {
  const acquireWriteLockMock = vi.fn(
    input?.acquireWriteLock ?? defaultAcquireWriteLock,
  )
  const resolveAssistantStatePathsMock = vi.fn((vault: string) => ({
    assistantStateRoot:
      input?.assistantStateRoot?.(vault) ?? `assistant-state:${vault}`,
  }))

  vi.doMock('@murphai/operator-config/vault-cli-errors', () => ({
    VaultCliError,
  }))
  vi.doMock('node:timers/promises', () => ({
    setTimeout: input?.sleep ?? realSleep,
  }))
  vi.doMock('../src/assistant/state-write-lock.ts', () => ({
    createAssistantStateWriteLock: () => ({
      acquireWriteLock: acquireWriteLockMock,
    }),
  }))
  vi.doMock('../src/assistant/store/paths.ts', () => ({
    resolveAssistantStatePaths: resolveAssistantStatePathsMock,
  }))

  const turnLock = await import('../src/assistant/turn-lock.ts')
  return {
    ...turnLock,
    acquireWriteLockMock,
    resolveAssistantStatePathsMock,
  }
}
