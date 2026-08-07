import assert from 'node:assert/strict'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  setImmediate as waitForImmediate,
  setTimeout as waitForTimeout,
} from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, test, vi } from 'vitest'
import { withAssistantRuntimeWriteLock } from '@murphai/vault-usecases/assistant-runtime-write-lock'

import {
  createAssistantQuiescentMaintenanceOwner,
} from '../src/quiescent-maintenance.js'

const childProcesses: ChildProcessWithoutNullStreams[] = []
const tempRoots: string[] = []

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
  }
  await Promise.all(tempRoots.splice(0).map(async (root) => {
    await rm(root, { force: true, recursive: true })
  }))
})

test('quiescent maintenance coalesces, yields, resumes, and stops', async () => {
  const signals: AbortSignal[] = []
  const resolutions: Array<() => void> = []
  const run = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal)
    await new Promise<void>((resolve) => resolutions.push(resolve))
  })
  const owner = createAssistantQuiescentMaintenanceOwner({ run })

  owner.start()
  owner.start()
  await waitForImmediate()
  assert.equal(run.mock.calls.length, 1)
  assert.equal(signals[0]?.aborted, false)

  owner.foregroundStarted()
  assert.equal(signals[0]?.aborted, true)
  assert.equal(signals[0]?.reason?.name, 'AbortError')
  owner.foregroundCompleted()
  resolutions[0]?.()
  await waitForImmediate()
  await waitForImmediate()
  assert.equal(run.mock.calls.length, 2)
  assert.equal(signals[1]?.aborted, false)

  owner.foregroundStarted()
  owner.foregroundStarted()
  assert.equal(signals[1]?.aborted, true)
  owner.foregroundCompleted()
  resolutions[1]?.()
  await waitForImmediate()
  assert.equal(run.mock.calls.length, 2)
  owner.foregroundCompleted()
  await waitForImmediate()
  assert.equal(run.mock.calls.length, 3)

  owner.stop()
  assert.equal(signals[2]?.aborted, true)
  resolutions[2]?.()
})

test('a completed idle sweep does not spin or rerun without a trigger', async () => {
  const run = vi.fn(async () => undefined)
  const owner = createAssistantQuiescentMaintenanceOwner({ run })

  owner.start()
  await waitForImmediate()
  await waitForImmediate()

  assert.equal(run.mock.calls.length, 1)
})

test('quiescent maintenance retries after a real cross-process writer releases', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'assistantd-lock-retry-'))
  tempRoots.push(vaultRoot)
  const holder = await startRuntimeLockHolder(vaultRoot)
  assert.equal(holder.exitCode, null)
  let completed = false
  const run = vi.fn(async (signal: AbortSignal) => {
    await withAssistantRuntimeWriteLock(vaultRoot, async () => {
      completed = true
    }, signal)
  })
  const owner = createAssistantQuiescentMaintenanceOwner({ run })

  owner.start()
  await waitForTimeout(100)
  assert.equal(holder.exitCode, null)
  assert.equal(run.mock.calls.length, 1)
  assert.equal(completed, false)

  holder.stdin.end()
  await once(holder, 'exit')
  await waitForCondition(() => completed)

  assert.ok(run.mock.calls.length >= 2)
  owner.stop()
})

test('foreground work preempts a lock retry and renews cleanup afterward', async () => {
  const signals: AbortSignal[] = []
  const lockError = Object.assign(new Error('runtime lock busy'), {
    code: 'ASSISTANT_RUNTIME_WRITE_LOCKED',
  })
  const run = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal)
    if (run.mock.calls.length === 1) {
      throw lockError
    }
  })
  const owner = createAssistantQuiescentMaintenanceOwner({ run })

  owner.start()
  await waitForCondition(() => run.mock.calls.length === 1)
  owner.foregroundStarted()
  owner.foregroundCompleted()
  await waitForCondition(() => run.mock.calls.length === 2)

  assert.equal(signals[0]?.aborted, true)
  assert.equal(signals[0]?.reason?.name, 'AbortError')
  assert.equal(signals[1]?.aborted, false)
  owner.stop()
})

async function startRuntimeLockHolder(
  vaultRoot: string,
): Promise<ChildProcessWithoutNullStreams> {
  const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
  const child = spawn(process.execPath, [
    fileURLToPath(import.meta.resolve('tsx/cli')),
    '--tsconfig',
    path.join(repositoryRoot, 'tsconfig.base.json'),
    fileURLToPath(new URL('./fixtures/runtime-lock-holder.ts', import.meta.url)),
    vaultRoot,
  ], {
    cwd: repositoryRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  childProcesses.push(child)
  const ready = once(child.stdout, 'data').then(([chunk]) => String(chunk))
  const exited = once(child, 'exit').then(() => {
    throw new Error('Runtime lock holder exited before acquiring the lock.')
  })
  const timedOut = waitForTimeout(5_000).then(() => {
    throw new Error('Timed out waiting for the runtime lock holder.')
  })
  assert.match(await Promise.race([ready, exited, timedOut]), /^locked/u)
  return child
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return
    await waitForTimeout(20)
  }
  assert.fail('Timed out waiting for quiescent maintenance to finish.')
}
