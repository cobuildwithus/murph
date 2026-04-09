import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, test, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  acquireAssistantAutomationRunLock,
  clearAssistantAutomationRunLock,
  inspectAssistantAutomationRunLock,
} from '../src/assistant/automation/runtime-lock.ts'
import {
  clearAssistantRuntimeWriteLock,
  inspectAssistantRuntimeWriteLock,
  withAssistantRuntimeWriteLock,
} from '../src/assistant/runtime-write-lock.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
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

test('assistant runtime write lock reports active state while held and clears stale artifacts by vault path', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-runtime-write-lock-',
  )
  cleanupPaths.push(parentRoot)

  const held = createDeferred<void>()
  const release = createDeferred<void>()
  const expectedPaths = resolveAssistantStatePaths(vaultRoot)

  const writer = withAssistantRuntimeWriteLock(vaultRoot, async (paths) => {
    assert.deepEqual(paths, expectedPaths)

    const active = await inspectAssistantRuntimeWriteLock(vaultRoot)
    assert.equal(active.state, 'active')
    assert.equal(active.metadata.pid, process.pid)
    assert.notEqual(active.metadata.command.length, 0)

    held.resolve()
    await release.promise
  })

  await held.promise
  release.resolve()
  await writer

  assert.equal((await inspectAssistantRuntimeWriteLock(vaultRoot)).state, 'unlocked')

  await mkdir(path.join(expectedPaths.assistantStateRoot, '.runtime-write.lock'), {
    recursive: true,
  })
  await writeFile(
    path.join(expectedPaths.assistantStateRoot, '.runtime-write-lock.json'),
    JSON.stringify({
      command: 'stale-runtime-writer',
      pid: 999_999,
      startedAt: '2026-04-08T00:00:00.000Z',
    }),
    'utf8',
  )

  const stale = await inspectAssistantRuntimeWriteLock(vaultRoot)
  assert.equal(stale.state, 'stale')
  assert.equal(stale.reason, 'Process 999999 is no longer running.')

  await clearAssistantRuntimeWriteLock(vaultRoot)
  assert.equal((await inspectAssistantRuntimeWriteLock(vaultRoot)).state, 'unlocked')
})

test('assistant runtime write lock surfaces held external metadata as a VaultCliError', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-runtime-write-held-',
  )
  cleanupPaths.push(parentRoot)

  const paths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(path.join(paths.assistantStateRoot, '.runtime-write.lock'), {
    recursive: true,
  })
  await writeFile(
    path.join(paths.assistantStateRoot, '.runtime-write-lock.json'),
    JSON.stringify({
      command: 'existing-runtime-writer',
      pid: process.pid,
      startedAt: '2026-04-08T12:34:56.000Z',
    }),
    'utf8',
  )

  await assert.rejects(
    () => withAssistantRuntimeWriteLock(vaultRoot, async () => undefined),
    (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_RUNTIME_WRITE_LOCKED')
      assert.match(error.message, /existing-runtime-writer/u)
      assert.match(error.message, /pid \d+/u)
      assert.match(error.message, /2026-04-08T12:34:56.000Z/u)
      return true
    },
  )
})

test('assistant runtime write lock falls back to a generic held-lock detail when metadata is unavailable', async () => {
  vi.resetModules()

  let capturedFormatHeldLockMessage: AssistantStateWriteLockFormatter | null = null

  vi.doMock('../src/assistant/state-write-lock.js', () => ({
    createAssistantStateWriteLock: (options: {
      formatHeldLockMessage(metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null): string
    }) => {
      capturedFormatHeldLockMessage = options.formatHeldLockMessage
      return {
        clearWriteLock: async () => undefined,
        inspectWriteLock: async () => ({ state: 'unlocked' }),
        withWriteLock: async <TResult>(_paths: unknown, run: () => Promise<TResult>) =>
          await run(),
      }
    },
  }))

  await import('../src/assistant/runtime-write-lock.ts')

  const formatHeldLockMessage: (
    metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null,
  ) => string =
    capturedFormatHeldLockMessage ??
    ((_metadata: import('../src/assistant/state-write-lock.ts').AssistantStateWriteLockMetadata | null) => {
      throw new Error(
        'Expected runtime write-lock mock to capture formatHeldLockMessage.',
      )
    })
  assert.equal(
    formatHeldLockMessage(null),
    'Assistant runtime state is already being updated for this vault: another assistant runtime writer.',
  )
})

test('assistant runtime write lock falls back to the generic held-lock message when metadata is missing', async () => {
  vi.resetModules()
  vi.doMock('../src/assistant/state-write-lock.ts', () => ({
    createAssistantStateWriteLock: (options: {
      formatHeldLockMessage(metadata: null): string
      heldLockErrorCode: string
    }) => ({
      clearWriteLock: vi.fn(async () => undefined),
      inspectWriteLock: vi.fn(async () => ({
        state: 'unlocked' as const,
      })),
      withWriteLock: vi.fn(async () => {
        throw new VaultCliError(
          options.heldLockErrorCode,
          options.formatHeldLockMessage(null),
        )
      }),
    }),
  }))

  const runtimeWriteLock = await import('../src/assistant/runtime-write-lock.ts')

  await assert.rejects(
    () =>
      runtimeWriteLock.withAssistantRuntimeWriteLock(
        '/tmp/runtime-write-lock-generic',
        async () => undefined,
      ),
    (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_RUNTIME_WRITE_LOCKED')
      assert.equal(
        error.message,
        'Assistant runtime state is already being updated for this vault: another assistant runtime writer.',
      )
      return true
    },
  )
})

test('assistant automation run lock reports same-process activity and blocks reentry with context', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-automation-lock-',
  )
  cleanupPaths.push(parentRoot)

  const paths = resolveAssistantStatePaths(vaultRoot)
  const lock = await acquireAssistantAutomationRunLock({
    once: true,
    paths,
  })

  const active = await inspectAssistantAutomationRunLock(paths)
  assert.equal(active.state, 'active')
  assert.equal(active.pid, process.pid)
  assert.equal(active.mode, 'once')
  assert.notEqual(active.command, null)
  assert.equal(
    active.reason,
    'assistant automation already active in this process',
  )

  await assert.rejects(
    () => acquireAssistantAutomationRunLock({ paths }),
    (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_AUTOMATION_ALREADY_RUNNING')
      assert.equal(error.context?.sameProcess, true)
      assert.equal(error.context?.mode, 'once')
      return true
    },
  )

  await lock.release()

  assert.deepEqual(await inspectAssistantAutomationRunLock(paths), {
    state: 'unlocked',
    pid: null,
    startedAt: null,
    mode: null,
    command: null,
    reason: null,
  })
})

test('assistant automation run lock distinguishes external active and stale holders', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-automation-external-lock-',
  )
  cleanupPaths.push(parentRoot)

  const paths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(path.join(paths.assistantStateRoot, '.automation-run.lock'), {
    recursive: true,
  })
  await writeFile(
    path.join(paths.assistantStateRoot, '.automation-run-lock.json'),
    JSON.stringify({
      command: 'existing-automation-runner',
      mode: 'continuous',
      pid: process.pid,
      startedAt: '2026-04-08T12:34:56.000Z',
    }),
    'utf8',
  )

  const active = await inspectAssistantAutomationRunLock(paths)
  assert.deepEqual(active, {
    state: 'active',
    pid: process.pid,
    startedAt: '2026-04-08T12:34:56.000Z',
    mode: 'continuous',
    command: 'existing-automation-runner',
    reason: null,
  })

  await assert.rejects(
    () => acquireAssistantAutomationRunLock({ paths }),
    (error) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'ASSISTANT_AUTOMATION_ALREADY_RUNNING')
      assert.equal(error.context?.sameProcess, false)
      assert.equal(error.context?.mode, 'continuous')
      assert.match(error.message, /existing-automation-runner/u)
      return true
    },
  )

  await writeFile(
    path.join(paths.assistantStateRoot, '.automation-run-lock.json'),
    JSON.stringify({
      command: 'stale-automation-runner',
      mode: 'once',
      pid: 999_999,
      startedAt: '2026-04-08T13:00:00.000Z',
    }),
    'utf8',
  )

  const stale = await inspectAssistantAutomationRunLock(paths)
  assert.deepEqual(stale, {
    state: 'stale',
    pid: 999_999,
    startedAt: '2026-04-08T13:00:00.000Z',
    mode: 'once',
    command: 'stale-automation-runner',
    reason: 'Process 999999 is no longer running.',
  })

  await clearAssistantAutomationRunLock(paths)

  assert.deepEqual(await inspectAssistantAutomationRunLock(paths), {
    state: 'unlocked',
    pid: null,
    startedAt: null,
    mode: null,
    command: null,
    reason: null,
  })
})
