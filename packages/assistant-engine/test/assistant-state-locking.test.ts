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
  withAssistantStateDocumentWriteLock,
} from '../src/assistant/state/locking.ts'
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

test('assistant state document write locks surface held-lock metadata as a VaultCliError', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-state-doc-lock-',
  )
  cleanupPaths.push(parentRoot)

  const paths = resolveAssistantStatePaths(vaultRoot)
  const lockPath = path.join(
    paths.assistantStateRoot,
    '.locks',
    'assistant-state-doc-write',
  )
  const metadataPath = path.join(lockPath, 'owner.json')
  await mkdir(lockPath, {
    recursive: true,
  })
  await writeFile(
    metadataPath,
    JSON.stringify({
      command: 'existing-state-writer',
      pid: process.pid,
      startedAt: '2026-04-08T12:34:56.000Z',
    }),
    'utf8',
  )

  await assert.rejects(
    () => withAssistantStateDocumentWriteLock(paths, async () => undefined),
    (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_STATE_WRITE_LOCKED')
      assert.match(error.message, /pid=\d+/u)
      assert.match(error.message, /existing-state-writer/u)
      assert.match(error.message, /2026-04-08T12:34:56.000Z/u)
      return true
    },
  )
})

test('assistant cron and state document locks fall back to generic held-lock details without metadata', async () => {
  vi.resetModules()

  let capturedCronMessage: AssistantStateWriteLockFormatter | null = null
  let capturedStateMessage: AssistantStateWriteLockFormatter | null = null

  vi.doMock('../src/assistant/state-write-lock.js', () => ({
    createAssistantStateWriteLock: (options: {
      heldLockErrorCode: string
      formatHeldLockMessage(metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null): string
    }) => {
      if (options.heldLockErrorCode === 'ASSISTANT_CRON_LOCKED') {
        capturedCronMessage = options.formatHeldLockMessage
      }
      if (options.heldLockErrorCode === 'ASSISTANT_STATE_WRITE_LOCKED') {
        capturedStateMessage = options.formatHeldLockMessage
      }
      return {
        withWriteLock: async <TResult>(_: unknown, run: () => Promise<TResult>) =>
          await run(),
      }
    },
  }))

  await Promise.all([
    import('../src/assistant/cron/locking.ts'),
    import('../src/assistant/state/locking.ts'),
  ])

  const cronMessage: (
    metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null,
  ) => string =
    capturedCronMessage ??
    ((_metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null) => {
      throw new Error('Expected cron lock mock to capture formatHeldLockMessage.')
    })
  const stateMessage: (
    metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null,
  ) => string =
    capturedStateMessage ??
    ((_metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null) => {
      throw new Error('Expected state lock mock to capture formatHeldLockMessage.')
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
  assert.equal(
    stateMessage(null),
    'Assistant state document writes are already in progress.',
  )
})

test('assistant cron and state document locks fall back to generic held-lock messages when metadata is missing', async () => {
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
  const {
    withAssistantStateDocumentWriteLock: withMockedAssistantStateDocumentWriteLock,
  } = await import('../src/assistant/state/locking.ts')
  const paths = resolveAssistantStatePaths('/tmp/assistant-state-doc-generic-lock')

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

  await assert.rejects(
    () => withMockedAssistantStateDocumentWriteLock(paths, async () => undefined),
    (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_STATE_WRITE_LOCKED')
      assert.equal(
        error.message,
        'Assistant state document writes are already in progress.',
      )
      return true
    },
  )
})

test('assistant cron and state document locks do not block each other on the same state root', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-independent-locks-',
  )
  cleanupPaths.push(parentRoot)

  const paths = resolveAssistantStatePaths(vaultRoot)
  const stateHeld = createDeferred<void>()
  const releaseState = createDeferred<void>()
  const events: string[] = []

  const stateWriter = withAssistantStateDocumentWriteLock(paths, async () => {
    events.push('state:start')
    stateHeld.resolve()
    await releaseState.promise
    events.push('state:end')
  })

  await stateHeld.promise

  await withAssistantCronWriteLock(paths, async () => {
    events.push('cron:start')
    events.push('cron:end')
  })

  assert.deepEqual(events, [
    'state:start',
    'cron:start',
    'cron:end',
  ])

  releaseState.resolve()
  await stateWriter

  assert.deepEqual(events, [
    'state:start',
    'cron:start',
    'cron:end',
    'state:end',
  ])
})
