import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, test, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  parseAssistantSessionRecord,
  type AssistantAutomationState,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

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
import {
  appendAssistantTranscriptEntries,
  getAssistantSession,
  listAssistantTranscriptEntries,
  listAssistantSessions,
  readAssistantAutomationState,
  saveAssistantAutomationState,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  createAssistantTurnReceipt,
  listRecentAssistantTurnReceipts,
  listRecentAssistantTurnReceiptsForSession,
  readAssistantTurnReceipt,
} from '../src/assistant/turns.ts'
import { createDeferred, createTempVaultContext } from './test-helpers.js'

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
    path.join(expectedPaths.assistantStateRoot, '.runtime-write.lock', 'owner.json'),
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

test('assistant transcript appends wait behind the shared runtime write lock', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-transcript-append-lock-',
  )
  cleanupPaths.push(parentRoot)

  const held = createDeferred<void>()
  const release = createDeferred<void>()
  const events: string[] = []

  const writer = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    events.push('lock:start')
    held.resolve()
    await release.promise
    events.push('lock:end')
  })

  await held.promise
  let appendCompleted = false
  const append = appendAssistantTranscriptEntries(vaultRoot, 'session-lock-test', [
    {
      kind: 'user',
      text: 'hello after lock',
    },
  ]).then((entries) => {
    appendCompleted = true
    events.push(`append:${entries.length}`)
  })

  await Promise.resolve()
  assert.equal(appendCompleted, false)
  release.resolve()
  await Promise.all([writer, append])

  assert.deepEqual(events, ['lock:start', 'lock:end', 'append:1'])
  assert.equal(
    (await listAssistantTranscriptEntries(vaultRoot, 'session-lock-test'))[0]?.text,
    'hello after lock',
  )
})

test('assistant automation state writes wait behind the shared runtime write lock', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-automation-state-write-lock-',
  )
  cleanupPaths.push(parentRoot)

  const held = createDeferred<void>()
  const release = createDeferred<void>()
  const events: string[] = []
  const state: AssistantAutomationState = {
    autoReply: [
      {
        channel: 'telegram',
        enabledAt: '2026-04-08T00:11:00.000Z',
        eligibleAfter: {
          createdAt: null,
          inputId: 'capture-auto-reply',
          occurredAt: '2026-04-08T00:11:00.000Z',
          sourceKind: 'inbox-capture',
        },
      },
    ],
    updatedAt: '2026-04-08T00:11:00.000Z',
    version: 1,
  }

  const writer = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    events.push('lock:start')
    held.resolve()
    await release.promise
    events.push('lock:end')
  })

  await held.promise
  let saveCompleted = false
  const save = saveAssistantAutomationState(vaultRoot, state).then((saved) => {
    saveCompleted = true
    events.push(`save:${saved.autoReply.length}`)
  })

  await Promise.resolve()
  assert.equal(saveCompleted, false)
  release.resolve()
  await Promise.all([writer, save])

  assert.deepEqual(events, ['lock:start', 'lock:end', 'save:1'])
  assert.deepEqual(await readAssistantAutomationState(vaultRoot), state)
})

test('assistant session reads wait behind the shared runtime write lock', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-session-read-lock-',
  )
  cleanupPaths.push(parentRoot)

  const session = await saveAssistantSession(
    vaultRoot,
    createLockTestSession('session-read-lock'),
  )
  const held = createDeferred<void>()
  const release = createDeferred<void>()
  const events: string[] = []

  const writer = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    events.push('lock:start')
    held.resolve()
    await release.promise
    events.push('lock:end')
  })

  await held.promise
  let listCompleted = false
  const list = listAssistantSessions(vaultRoot).then((sessions) => {
    listCompleted = true
    events.push(`list:${sessions.length}`)
  })

  await Promise.resolve()
  assert.equal(listCompleted, false)
  release.resolve()
  await Promise.all([writer, list])
  assert.deepEqual(events, ['lock:start', 'lock:end', 'list:1'])

  const heldAgain = createDeferred<void>()
  const releaseAgain = createDeferred<void>()
  const getEvents: string[] = []
  const secondWriter = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    getEvents.push('lock:start')
    heldAgain.resolve()
    await releaseAgain.promise
    getEvents.push('lock:end')
  })

  await heldAgain.promise
  let getCompleted = false
  const get = getAssistantSession(vaultRoot, session.sessionId).then((resolved) => {
    getCompleted = true
    getEvents.push(`get:${resolved.sessionId}`)
  })

  await Promise.resolve()
  assert.equal(getCompleted, false)
  releaseAgain.resolve()
  await Promise.all([secondWriter, get])
  assert.deepEqual(getEvents, ['lock:start', 'lock:end', 'get:session-read-lock'])
})

test('assistant turn receipt reads wait behind the shared runtime write lock', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-receipt-read-lock-',
  )
  cleanupPaths.push(parentRoot)

  const receipt = await createAssistantTurnReceipt({
    deliveryRequested: false,
    prompt: 'read lock test',
    provider: 'codex-cli',
    providerModel: 'gpt-5.6-terra',
    sessionId: 'session-receipt-lock',
    turnId: 'turn-receipt-lock',
    vault: vaultRoot,
  })
  const held = createDeferred<void>()
  const release = createDeferred<void>()
  const events: string[] = []

  const writer = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    events.push('lock:start')
    held.resolve()
    await release.promise
    events.push('lock:end')
  })

  await held.promise
  let readCompleted = false
  const read = readAssistantTurnReceipt(vaultRoot, receipt.turnId).then((resolved) => {
    readCompleted = true
    events.push(`read:${resolved?.turnId}`)
  })

  await Promise.resolve()
  assert.equal(readCompleted, false)
  release.resolve()
  await Promise.all([writer, read])
  assert.deepEqual(events, ['lock:start', 'lock:end', 'read:turn-receipt-lock'])

  const heldAgain = createDeferred<void>()
  const releaseAgain = createDeferred<void>()
  const listEvents: string[] = []
  const secondWriter = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    listEvents.push('lock:start')
    heldAgain.resolve()
    await releaseAgain.promise
    listEvents.push('lock:end')
  })

  await heldAgain.promise
  let listCompleted = false
  const list = listRecentAssistantTurnReceipts(vaultRoot, 10).then((receipts) => {
    listCompleted = true
    listEvents.push(`list:${receipts.length}`)
  })

  await Promise.resolve()
  assert.equal(listCompleted, false)
  releaseAgain.resolve()
  await Promise.all([secondWriter, list])
  assert.deepEqual(listEvents, ['lock:start', 'lock:end', 'list:1'])

  const heldThird = createDeferred<void>()
  const releaseThird = createDeferred<void>()
  const sessionListEvents: string[] = []
  const thirdWriter = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    sessionListEvents.push('lock:start')
    heldThird.resolve()
    await releaseThird.promise
    sessionListEvents.push('lock:end')
  })

  await heldThird.promise
  let sessionListCompleted = false
  const sessionList = listRecentAssistantTurnReceiptsForSession(
    vaultRoot,
    receipt.sessionId,
    10,
  ).then((receipts) => {
    sessionListCompleted = true
    sessionListEvents.push(`list:${receipts.length}`)
  })

  await Promise.resolve()
  assert.equal(sessionListCompleted, false)
  releaseThird.resolve()
  await Promise.all([thirdWriter, sessionList])
  assert.deepEqual(sessionListEvents, ['lock:start', 'lock:end', 'list:1'])
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
    path.join(paths.assistantStateRoot, '.runtime-write.lock', 'owner.json'),
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
    path.join(paths.assistantStateRoot, '.automation-run.lock', 'owner.json'),
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
    path.join(paths.assistantStateRoot, '.automation-run.lock', 'owner.json'),
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

function createLockTestSession(sessionId: string): AssistantSession {
  return parseAssistantSessionRecord({
    schema: 'murph.assistant-session.v1',
    sessionId,
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    resumeState: null,
    alias: null,
    binding: {
      conversationKey: null,
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:01:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
  })
}
