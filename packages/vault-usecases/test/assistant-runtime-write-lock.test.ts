import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

type CapturedLockOptions = {
  formatHeldLockMessage(metadata: {
    command: string
    pid: number
    startedAt: string
  } | null): string
  heldLockErrorCode: string
}

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../src/assistant-state-write-lock.js')
  vi.doUnmock('../src/assistant-state-write-lock.ts')
})

test('assistant runtime write lock defines a generic fallback held-lock message', async () => {
  let capturedOptions: CapturedLockOptions | null = null

  vi.doMock('../src/assistant-state-write-lock.js', () => ({
    createAssistantStateWriteLock(options: CapturedLockOptions) {
      capturedOptions = options
      return {
        clearWriteLock: vi.fn(),
        inspectWriteLock: vi.fn(),
        withWriteLock: vi.fn(),
      }
    },
  }))

  await import('../src/assistant-runtime-write-lock.ts')

  const options = requireCapturedLockOptions(capturedOptions)
  assert.equal(
    options.formatHeldLockMessage(null),
    'Assistant runtime state is already being updated for this vault: another assistant runtime writer.',
  )
})

function requireCapturedLockOptions(
  options: CapturedLockOptions | null,
): CapturedLockOptions {
  assert.ok(options)
  return options
}

test('assistant runtime write lock preserves its generic held-lock error', async () => {
  vi.doMock('../src/assistant-state-write-lock.js', () => ({
    createAssistantStateWriteLock(options: CapturedLockOptions) {
      return {
        clearWriteLock: vi.fn(),
        inspectWriteLock: vi.fn(),
        withWriteLock: vi.fn(async () => {
          throw new VaultCliError(
            options.heldLockErrorCode,
            options.formatHeldLockMessage(null),
          )
        }),
      }
    },
  }))

  const { withAssistantRuntimeWriteLock } = await import(
    '../src/assistant-runtime-write-lock.ts'
  )

  await assert.rejects(
    () => withAssistantRuntimeWriteLock(
      '/tmp/runtime-write-lock-generic',
      async () => undefined,
    ),
    {
      code: 'ASSISTANT_RUNTIME_WRITE_LOCKED',
      message:
        'Assistant runtime state is already being updated for this vault: another assistant runtime writer.',
      name: 'VaultCliError',
    },
  )
})
