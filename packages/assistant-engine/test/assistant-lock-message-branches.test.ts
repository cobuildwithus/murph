import { afterEach, describe, expect, it, vi } from 'vitest'

type CapturedLockOptions = {
  formatHeldLockMessage(metadata: {
    command: string
    pid: number
    startedAt: string
  } | null): string
  ownerKeyPrefix: string
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('../src/assistant/state-write-lock.js')
  vi.doUnmock('../src/assistant/state-write-lock.ts')
  vi.doUnmock('../src/assistant/store/paths.js')
  vi.doUnmock('../src/assistant/store/paths.ts')
})

describe('assistant lock message branches', () => {
  it('renders fallback held-lock messages when metadata is unavailable', async () => {
    const optionsByPrefix = new Map<string, CapturedLockOptions>()

    const createAssistantStateWriteLock = vi.fn((options: CapturedLockOptions) => {
      optionsByPrefix.set(options.ownerKeyPrefix, options)
      return {
        acquireWriteLock: vi.fn(async () => ({
          release: async () => undefined,
        })),
        clearWriteLock: vi.fn(async () => undefined),
        inspectWriteLock: vi.fn(async () => ({
          state: 'unlocked',
        })),
        withWriteLock: vi.fn(async (_paths: unknown, run: () => Promise<unknown>) => await run()),
      }
    })
    const resolveAssistantStatePaths = vi.fn((vault: string) => ({
      assistantStateRoot: `state-root:${vault}`,
    }))

    vi.doMock('../src/assistant/state-write-lock.js', () => ({
      createAssistantStateWriteLock,
    }))
    vi.doMock('../src/assistant/store/paths.js', () => ({
      resolveAssistantStatePaths,
    }))

    const runtimeLock = await import('../src/assistant/runtime-write-lock.ts')
    const cronLock = await import('../src/assistant/cron/locking.ts')
    const stateLock = await import('../src/assistant/state/locking.ts')
    const turnLock = await import('../src/assistant/turn-lock.ts')

    expect(
      optionsByPrefix.get('assistant-runtime-write')?.formatHeldLockMessage(null),
    ).toBe(
      'Assistant runtime state is already being updated for this vault: another assistant runtime writer.',
    )
    expect(
      optionsByPrefix.get('assistant-cron')?.formatHeldLockMessage(null),
    ).toBe('Assistant cron writes are already in progress.')
    expect(
      optionsByPrefix.get('assistant-state-doc')?.formatHeldLockMessage(null),
    ).toBe('Assistant state document writes are already in progress.')
    expect(
      optionsByPrefix.get('assistant-turn')?.formatHeldLockMessage(null),
    ).toBe('Assistant turn is already in progress for this vault.')

    await runtimeLock.withAssistantRuntimeWriteLock('vault-a', async () => 'ok')
    await runtimeLock.inspectAssistantRuntimeWriteLock('vault-b')
    await runtimeLock.clearAssistantRuntimeWriteLock('vault-c')
    await cronLock.withAssistantCronWriteLock(
      {
        assistantStateRoot: 'state-root:cron',
      } as never,
      async () => 'ok',
    )
    await stateLock.withAssistantStateDocumentWriteLock(
      {
        assistantStateRoot: 'state-root:doc',
      } as never,
      async () => 'ok',
    )
    await turnLock.withAssistantTurnLock({
      run: async () => 'ok',
      vault: 'vault-turn',
    })

    expect(resolveAssistantStatePaths).toHaveBeenCalledWith('vault-a')
    expect(resolveAssistantStatePaths).toHaveBeenCalledWith('vault-b')
    expect(resolveAssistantStatePaths).toHaveBeenCalledWith('vault-c')
    expect(resolveAssistantStatePaths).toHaveBeenCalledWith('vault-turn')
  })
})
