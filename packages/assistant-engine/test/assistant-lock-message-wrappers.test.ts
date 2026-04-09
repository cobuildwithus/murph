import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'

type CapturedLockOptions = {
  formatHeldLockMessage(metadata: {
    command: string
    pid: number
    startedAt: string
  } | null): string
}

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../src/assistant/state-write-lock.ts')
})

test('assistant runtime write lock defines a generic fallback held-lock message', async () => {
  let capturedOptions: CapturedLockOptions | null = null

  vi.doMock('../src/assistant/state-write-lock.ts', () => ({
    createAssistantStateWriteLock(options: CapturedLockOptions) {
      capturedOptions = options
      return {
        clearWriteLock: vi.fn(),
        inspectWriteLock: vi.fn(),
        withWriteLock: vi.fn(),
      }
    },
  }))

  await import('../src/assistant/runtime-write-lock.ts')

  const options = requireCapturedLockOptions(capturedOptions)
  assert.equal(
    options.formatHeldLockMessage(null),
    'Assistant runtime state is already being updated for this vault: another assistant runtime writer.',
  )
})

test('assistant cron write lock defines a generic fallback held-lock message', async () => {
  let capturedOptions: CapturedLockOptions | null = null

  vi.doMock('../src/assistant/state-write-lock.ts', () => ({
    createAssistantStateWriteLock(options: CapturedLockOptions) {
      capturedOptions = options
      return {
        withWriteLock: vi.fn(),
      }
    },
  }))

  await import('../src/assistant/cron/locking.ts')

  const options = requireCapturedLockOptions(capturedOptions)
  assert.equal(
    options.formatHeldLockMessage(null),
    'Assistant cron writes are already in progress.',
  )
})

test('assistant state document write lock defines a generic fallback held-lock message', async () => {
  let capturedOptions: CapturedLockOptions | null = null

  vi.doMock('../src/assistant/state-write-lock.ts', () => ({
    createAssistantStateWriteLock(options: CapturedLockOptions) {
      capturedOptions = options
      return {
        withWriteLock: vi.fn(),
      }
    },
  }))

  await import('../src/assistant/state/locking.ts')

  const options = requireCapturedLockOptions(capturedOptions)
  assert.equal(
    options.formatHeldLockMessage(null),
    'Assistant state document writes are already in progress.',
  )
})

function requireCapturedLockOptions(
  options: CapturedLockOptions | null,
): CapturedLockOptions {
  assert.ok(options)
  return options
}
