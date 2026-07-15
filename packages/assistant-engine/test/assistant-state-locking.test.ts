import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, test, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { withAssistantCronWriteLock } from '../src/assistant/cron/locking.ts'
import {
  createAssistantStateWriteLock,
} from '../src/assistant/state-write-lock.ts'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from '../src/assistant/store/paths.ts'
import { createDeferred, createTempVaultContext } from './test-helpers.js'

type AssistantStateWriteLockFormatter = (
  metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null,
) => string

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
})

test('assistant state write locks allow nested reentry while serializing concurrent same-root callers', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-state-write-lock-',
  )
  cleanupPaths.push(parentRoot)

  const paths = resolveAssistantStatePaths(vaultRoot)
  const lock = createAssistantStateWriteLock<AssistantStatePaths>({
    ownerKeyPrefix: 'assistant-engine-test',
    lockDirectory: '.locks/assistant-engine-test',
    lockMetadataPath: '.locks/assistant-engine-test/owner.json',
    invalidMetadataReason: 'Assistant-engine test lock metadata is malformed.',
    heldLockErrorCode: 'ASSISTANT_ENGINE_TEST_LOCKED',
    formatHeldLockMessage() {
      return 'Assistant-engine test lock is already held.'
    },
  })

  const events: string[] = []
  const firstHolding = createDeferred<void>()
  const releaseFirst = createDeferred<void>()

  const first = lock.withWriteLock(paths, async () => {
    events.push('first:start')

    await lock.withWriteLock(paths, async () => {
      events.push('nested:start')
      events.push('nested:end')
    })

    events.push('first:after-nested')
    firstHolding.resolve()
    await releaseFirst.promise
    events.push('first:end')
  })

  await firstHolding.promise

  const second = lock.withWriteLock(paths, async () => {
    events.push('second:start')
    events.push('second:end')
  })

  await Promise.resolve()
  assert.deepEqual(events, [
    'first:start',
    'nested:start',
    'nested:end',
    'first:after-nested',
  ])

  releaseFirst.resolve()
  await Promise.all([first, second])

  assert.deepEqual(events, [
    'first:start',
    'nested:start',
    'nested:end',
    'first:after-nested',
    'first:end',
    'second:start',
    'second:end',
  ])
})

test('assistant state write locks remove aborted waiters without bypassing the active writer', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-state-aborted-waiter-',
  )
  cleanupPaths.push(parentRoot)

  const paths = resolveAssistantStatePaths(vaultRoot)
  const lock = createAssistantStateWriteLock<AssistantStatePaths>({
    ownerKeyPrefix: 'assistant-engine-abort-test',
    lockDirectory: '.locks/assistant-engine-abort-test',
    lockMetadataPath: '.locks/assistant-engine-abort-test/owner.json',
    invalidMetadataReason: 'Assistant-engine abort test lock metadata is malformed.',
    heldLockErrorCode: 'ASSISTANT_ENGINE_ABORT_TEST_LOCKED',
    formatHeldLockMessage() {
      return 'Assistant-engine abort test lock is already held.'
    },
  })
  const firstHolding = createDeferred<void>()
  const releaseFirst = createDeferred<void>()
  const events: string[] = []

  const first = lock.withWriteLock(paths, async () => {
    events.push('first:start')
    firstHolding.resolve()
    await releaseFirst.promise
    events.push('first:end')
  })
  await firstHolding.promise

  const controller = new AbortController()
  const abortReason = new Error('foreground work interrupted maintenance')
  let abortedCallbackRan = false
  const aborted = lock.withWriteLock(
    paths,
    async () => {
      abortedCallbackRan = true
    },
    controller.signal,
  )
  controller.abort(abortReason)

  let receivedReason: unknown
  try {
    await aborted
    assert.fail('Expected the queued writer to abort.')
  } catch (error) {
    receivedReason = error
  }
  assert.equal(receivedReason, abortReason)
  assert.equal(abortedCallbackRan, false)

  const later = lock.withWriteLock(paths, async () => {
    events.push('later:start')
  })
  await Promise.resolve()
  assert.deepEqual(events, ['first:start'])

  releaseFirst.resolve()
  await Promise.all([first, later])
  assert.equal(abortedCallbackRan, false)
  assert.deepEqual(events, ['first:start', 'first:end', 'later:start'])
})

test('assistant state write locks recover stale external locks before continuing', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-state-stale-lock-',
  )
  cleanupPaths.push(parentRoot)

  const paths = resolveAssistantStatePaths(vaultRoot)
  const lock = createAssistantStateWriteLock<AssistantStatePaths>({
    ownerKeyPrefix: 'assistant-engine-stale-test',
    lockDirectory: '.locks/assistant-engine-stale-test',
    lockMetadataPath: '.locks/assistant-engine-stale-test/owner.json',
    invalidMetadataReason: 'Assistant-engine stale test lock metadata is malformed.',
    heldLockErrorCode: 'ASSISTANT_ENGINE_STALE_LOCKED',
    formatHeldLockMessage() {
      return 'Assistant-engine stale test lock is already held.'
    },
  })

  const lockPath = path.join(
    paths.assistantStateRoot,
    '.locks',
    'assistant-engine-stale-test',
  )
  const metadataPath = path.join(lockPath, 'owner.json')
  await mkdir(lockPath, {
    recursive: true,
  })
  await writeFile(
    metadataPath,
    JSON.stringify({
      command: 'stale-test',
      pid: 999_999,
      startedAt: '2026-04-08T00:00:00.000Z',
    }),
    'utf8',
  )

  const before = await lock.inspectWriteLock(paths)
  assert.equal(before.state, 'stale')
  assert.equal(before.reason, 'Process 999999 is no longer running.')

  await lock.withWriteLock(paths, async () => {
    const active = await lock.inspectWriteLock(paths)
    assert.equal(active.state, 'active')
    assert.notEqual(active.metadata.command.length, 0)
    assert.equal(active.metadata.pid, process.pid)
  })

  const after = await lock.inspectWriteLock(paths)
  assert.equal(after.state, 'unlocked')
})

test('assistant state write locks expose metadata guards and clear explicit lock artifacts', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-state-clear-lock-',
  )
  cleanupPaths.push(parentRoot)

  const paths = resolveAssistantStatePaths(vaultRoot)
  const lock = createAssistantStateWriteLock<AssistantStatePaths>({
    ownerKeyPrefix: 'assistant-engine-clear-test',
    lockDirectory: '.locks/assistant-engine-clear-test',
    lockMetadataPath: '.locks/assistant-engine-clear-test/owner.json',
    invalidMetadataReason: 'Assistant-engine clear test lock metadata is malformed.',
    heldLockErrorCode: 'ASSISTANT_ENGINE_CLEAR_LOCKED',
    formatHeldLockMessage() {
      return 'Assistant-engine clear test lock is already held.'
    },
  })

  assert.equal(
    lock.isWriteLockMetadata({
      command: 'assistant-engine',
      pid: process.pid,
      startedAt: '2026-04-08T00:00:00.000Z',
    }),
    true,
  )
  assert.equal(lock.isWriteLockMetadata({ command: 'assistant-engine' }), false)

  const heldLock = await lock.acquireWriteLock(paths)
  const during = await lock.inspectWriteLock(paths)
  assert.equal(during.state, 'active')
  await heldLock.release()

  const secondHeldLock = await lock.acquireWriteLock(paths)
  await lock.clearWriteLock(paths)
  await secondHeldLock.release()

  const after = await lock.inspectWriteLock(paths)
  assert.equal(after.state, 'unlocked')
})

test('assistant cron locks fall back to generic held-lock details without metadata', async () => {
  vi.resetModules()

  let capturedCronMessage: AssistantStateWriteLockFormatter | null = null

  vi.doMock('../src/assistant/state-write-lock.js', () => ({
    createAssistantStateWriteLock: (options: {
      heldLockErrorCode: string
      formatHeldLockMessage(metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null): string
    }) => {
      if (options.heldLockErrorCode === 'ASSISTANT_CRON_LOCKED') {
        capturedCronMessage = options.formatHeldLockMessage
      }
      return {
        withWriteLock: async <TResult>(_: unknown, run: () => Promise<TResult>) =>
          await run(),
      }
    },
  }))

  await import('../src/assistant/cron/locking.ts')

  const cronMessage: (
    metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null,
  ) => string =
    capturedCronMessage ??
    ((_metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null) => {
      throw new Error('Expected cron lock mock to capture formatHeldLockMessage.')
    })
  assert.equal(
    cronMessage(null),
    'Assistant cron writes are already in progress.',
  )
  assert.equal(
    cronMessage({
      command: 'assistant-cron',
      pid: 123,
      startedAt: '2026-04-08T12:34:56.000Z',
    }),
    'Assistant cron writes are already in progress (pid=123, startedAt=2026-04-08T12:34:56.000Z, command=assistant-cron).',
  )
})

test('assistant cron locks fall back to generic held-lock messages when metadata is missing', async () => {
  vi.resetModules()
  vi.doMock('../src/assistant/state-write-lock.ts', () => ({
    createAssistantStateWriteLock: (options: {
      formatHeldLockMessage(metadata: null): string
      heldLockErrorCode: string
      withWriteLock?: unknown
    }) => ({
      withWriteLock: vi.fn(async (_paths: unknown, _run: () => Promise<unknown>) => {
        throw new VaultCliError(
          options.heldLockErrorCode,
          options.formatHeldLockMessage(null),
        )
      }),
    }),
  }))

  const { withAssistantCronWriteLock: withMockedAssistantCronWriteLock } = await import(
    '../src/assistant/cron/locking.ts'
  )
  const paths = resolveAssistantStatePaths('/tmp/assistant-cron-generic-lock')

  await assert.rejects(
    () => withMockedAssistantCronWriteLock(paths, async () => undefined),
    (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_CRON_LOCKED')
      assert.equal(
        error.message,
        'Assistant cron writes are already in progress.',
      )
      return true
    },
  )
})
