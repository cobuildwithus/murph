import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import {
  appendAssistantTranscriptEntries,
  deleteAssistantStateDocument,
  getAssistantStateDocument,
  getAssistantSession,
  listAssistantStateDocuments,
  listAssistantTranscriptEntries,
  listAssistantSessions,
  patchAssistantStateDocument,
  putAssistantStateDocument,
  readAssistantAutomationState,
  redactAssistantDisplayPath,
  resolveAssistantAliasKey,
  resolveAssistantSession,
  resolveAssistantStatePaths,
  saveAssistantSession,
} from '@murphai/assistant-core/assistant-state'
import {
  createAssistantMemoryTurnContextEnv,
  extractAssistantMemory,
  forgetAssistantMemory,
  getAssistantMemory,
  loadAssistantMemoryPromptBlock,
  resolveAssistantMemoryTurnContext,
  resolveAssistantDailyMemoryPath,
  resolveAssistantMemoryStoragePaths,
  searchAssistantMemory,
  upsertAssistantMemory,
} from '@murphai/assistant-core/assistant/memory'
import {
  getAssistantStatus,
} from '../src/assistant-runtime.js'
import {
  readAssistantRuntimeBudgetStatus,
  runAssistantRuntimeMaintenance,
} from '@murphai/assistant-core/assistant/runtime-budgets'
import { readAssistantCronRuns } from '@murphai/assistant-core/assistant/cron/store'
import { withAssistantMemoryWriteLock } from '@murphai/assistant-core/assistant/memory/locking'
import { readAssistantOutboxIntent } from '../src/assistant/outbox.js'
import { summarizeAssistantQuarantines } from '@murphai/assistant-core/assistant/quarantine'
import { withAssistantRuntimeWriteLock } from '@murphai/assistant-core/assistant/runtime-write-lock'
import { readAssistantSession } from '@murphai/assistant-core/assistant/store/persistence'
import { listAssistantTranscriptDistillations } from '@murphai/assistant-core/assistant/transcript-distillation'
import { readAssistantTurnReceipt } from '@murphai/assistant-core/assistant/turns'
import {
  assistantSessionSchema,
  parseAssistantSessionRecord,
} from '@murphai/assistant-core/assistant-cli-contracts'
import { redactAssistantSessionForDisplay } from '@murphai/assistant-core/assistant/redaction'

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

test('resolveAssistantAliasKey prefers explicit alias and otherwise derives a stable conversation key', () => {
  assert.equal(
    resolveAssistantAliasKey({
      alias: 'chat:bob',
      channel: 'imessage',
      participantId: 'contact:bob',
    }),
    'chat:bob',
  )
  assert.equal(
    resolveAssistantAliasKey({
      channel: 'imessage',
      identityId: 'assistant:primary',
      participantId: 'contact:bob',
      sourceThreadId: 'thread/1',
    }),
    'channel:imessage|identity:assistant%3Aprimary|thread:thread%2F1',
  )
  assert.equal(resolveAssistantAliasKey({}), null)
})

test('resolveAssistantAliasKey only derives actor-scoped fallback keys when the conversation is not explicitly group-scoped', () => {
  assert.equal(
    resolveAssistantAliasKey({
      conversation: {
        channel: 'telegram',
        identityId: 'assistant:primary',
        participantId: 'contact:base',
        directness: 'group',
      },
      actorId: 'contact:override',
    }),
    null,
  )
  assert.equal(
    resolveAssistantAliasKey({
      conversation: {
        channel: 'telegram',
        identityId: 'assistant:primary',
        participantId: 'contact:base',
        threadId: 'chat-base',
        directness: 'group',
      },
      sourceThreadId: 'chat-override',
      threadIsDirect: true,
    }),
    'channel:telegram|identity:assistant%3Aprimary|thread:chat-override',
  )
})

test('resolveAssistantSession does not auto-reuse actor-scoped conversation keys for explicit group conversations without thread ids', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-group-routing-scope-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const first = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'contact:group-member',
    threadIsDirect: false,
  })
  const second = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'contact:group-member',
    threadIsDirect: false,
  })

  assert.equal(first.session.binding.conversationKey, null)
  assert.equal(second.session.binding.conversationKey, null)
  assert.equal(second.created, true)
  assert.notEqual(second.session.sessionId, first.session.sessionId)
})

test('assistant sessions live outside the vault, omit redundant path metadata, and reuse alias mappings', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-state-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  assert.equal(statePaths.absoluteVaultRoot, path.resolve(vaultRoot))
  assert.equal(statePaths.assistantStateRoot.includes(path.join(parent, 'assistant-state')), true)
  assert.equal(statePaths.assistantStateRoot.startsWith(path.resolve(vaultRoot)), false)
  assert.equal(
    statePaths.transcriptsDirectory.includes(path.join(parent, 'assistant-state')),
    true,
  )
  assert.equal(statePaths.longTermMemoryPath, path.join(statePaths.assistantStateRoot, 'MEMORY.md'))
  assert.equal(statePaths.dailyMemoryDirectory, path.join(statePaths.assistantStateRoot, 'memory'))
  assert.equal(statePaths.cronDirectory, path.join(statePaths.assistantStateRoot, 'cron'))
  assert.equal(statePaths.cronJobsPath, path.join(statePaths.cronDirectory, 'jobs.json'))
  assert.equal(statePaths.cronRunsDirectory, path.join(statePaths.cronDirectory, 'runs'))
  assert.equal(statePaths.stateDirectory, path.join(statePaths.assistantStateRoot, 'state'))
  assert.equal(statePaths.turnsDirectory, path.join(statePaths.assistantStateRoot, 'receipts'))
  assert.equal(statePaths.outboxDirectory, path.join(statePaths.assistantStateRoot, 'outbox'))
  assert.equal(statePaths.distillationsDirectory, path.join(statePaths.assistantStateRoot, 'distillations'))

  const first = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-1',
    model: 'gpt-oss:20b',
    reasoningEffort: 'high',
    sandbox: 'read-only',
    approvalPolicy: 'never',
    oss: true,
  })

  assert.equal(first.created, true)
  assert.equal(first.session.alias, 'imessage:bob')
  assert.equal(first.session.provider, 'codex-cli')
  assert.equal(first.session.providerOptions.model, 'gpt-oss:20b')
  assert.equal(first.session.providerOptions.reasoningEffort, 'high')
  assert.equal(first.session.providerOptions.oss, true)
  assert.equal(first.session.binding.channel, 'imessage')
  assert.equal(first.session.binding.identityId, 'assistant:primary')
  assert.equal(first.session.binding.actorId, 'contact:bob')
  assert.equal(first.session.binding.threadId, 'chat-1')
  assert.equal(
    first.session.binding.conversationKey,
    'channel:imessage|identity:assistant%3Aprimary|thread:chat-1',
  )

  const persisted = JSON.parse(
    await readFile(
      path.join(statePaths.sessionsDirectory, `${first.session.sessionId}.json`),
      'utf8',
    ),
  ) as Record<string, unknown>
  assert.equal('vault' in persisted, false)
  assert.equal('stateRoot' in persisted, false)
  assert.equal('lastUserMessage' in persisted, false)
  assert.equal('lastAssistantMessage' in persisted, false)

  const second = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'imessage:bob',
    createIfMissing: false,
  })

  assert.equal(second.created, false)
  assert.equal(second.session.sessionId, first.session.sessionId)

  const stateDirectoryStats = await stat(statePaths.stateDirectory)
  assert.equal(stateDirectoryStats.isDirectory(), true)

  const saved = await saveAssistantSession(vaultRoot, {
    ...first.session,
    updatedAt: new Date('2026-03-16T17:00:00.000Z').toISOString(),
    lastTurnAt: new Date('2026-03-16T17:00:00.000Z').toISOString(),
    turnCount: 1,
  })
  assert.equal(saved.turnCount, 1)

  const listed = await listAssistantSessions(vaultRoot)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.sessionId, first.session.sessionId)

  const fetched = await getAssistantSession(vaultRoot, first.session.sessionId)
  assert.equal(fetched.turnCount, 1)
  assert.equal('lastAssistantMessage' in fetched, false)
})

test('assistant state documents support show put patch list and delete with JSON merge patch semantics', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-doc-state-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const missing = await getAssistantStateDocument({
    vault: vaultRoot,
    docId: 'cron/job_123',
  })
  assert.equal(missing.exists, false)
  assert.equal(missing.updatedAt, null)
  assert.equal(missing.value, null)
  assert.equal(
    missing.documentPath,
    path.join(resolveAssistantStatePaths(vaultRoot).stateDirectory, 'cron', 'job_123.json'),
  )

  const created = await putAssistantStateDocument({
    vault: vaultRoot,
    docId: 'cron/job_123',
    value: {
      pending: {
        signal: 'sleep_drop',
      },
      status: 'awaiting_user_context',
      stale: true,
    },
  })
  assert.equal(created.exists, true)
  assert.equal(created.value?.status, 'awaiting_user_context')
  assert.deepEqual(created.value?.pending, {
    signal: 'sleep_drop',
  })

  const patched = await patchAssistantStateDocument({
    vault: vaultRoot,
    docId: 'cron/job_123',
    patch: {
      pending: {
        cooldownUntil: '2026-03-29T10:00:00.000Z',
      },
      stale: null,
    },
  })
  assert.equal(patched.exists, true)
  assert.deepEqual(patched.value, {
    pending: {
      signal: 'sleep_drop',
      cooldownUntil: '2026-03-29T10:00:00.000Z',
    },
    status: 'awaiting_user_context',
  })

  const listed = await listAssistantStateDocuments({
    vault: vaultRoot,
    prefix: 'cron',
  })
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.docId, 'cron/job_123')

  const deleted = await deleteAssistantStateDocument({
    vault: vaultRoot,
    docId: 'cron/job_123',
  })
  assert.equal(deleted.existed, true)

  const afterDelete = await getAssistantStateDocument({
    vault: vaultRoot,
    docId: 'cron/job_123',
  })
  assert.equal(afterDelete.exists, false)
  assert.equal(afterDelete.value, null)
})

test('assistant state patch creates missing documents and replaces arrays', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-doc-patch-create-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await patchAssistantStateDocument({
    vault: vaultRoot,
    docId: 'cron/job_456',
    patch: {
      arr: [1, 2],
      obj: {
        a: 1,
      },
    },
  })
  assert.equal(created.exists, true)
  assert.deepEqual(created.value, {
    arr: [1, 2],
    obj: {
      a: 1,
    },
  })

  const updated = await patchAssistantStateDocument({
    vault: vaultRoot,
    docId: 'cron/job_456',
    patch: {
      arr: [3],
      obj: {
        b: 2,
      },
    },
  })
  assert.deepEqual(updated.value, {
    arr: [3],
    obj: {
      a: 1,
      b: 2,
    },
  })

  const listed = await listAssistantStateDocuments({
    vault: vaultRoot,
    prefix: 'cron',
  })
  assert.deepEqual(
    listed.map((entry) => entry.docId),
    ['cron/job_456'],
  )
})

test('assistant state documents reject invalid document ids', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-doc-invalid-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  await assert.rejects(
    () =>
      getAssistantStateDocument({
        vault: vaultRoot,
        docId: '../escape',
      }),
    /slash-delimited segments/u,
  )
})

test('assistant state document listing ignores invalid on-disk filenames', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-doc-invalid-list-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(path.join(statePaths.stateDirectory, 'cron'), {
    recursive: true,
  })
  await writeFile(
    path.join(statePaths.stateDirectory, 'cron', 'bad name.json'),
    JSON.stringify({
      ignored: true,
    }),
    'utf8',
  )

  await putAssistantStateDocument({
    vault: vaultRoot,
    docId: 'cron/job_123',
    value: {
      kept: true,
    },
  })

  const listed = await listAssistantStateDocuments({
    vault: vaultRoot,
    prefix: 'cron',
  })

  assert.deepEqual(
    listed.map((entry) => entry.docId),
    ['cron/job_123'],
  )
})

test('resolveAssistantSession prefers explicit sessionId over conversation-key matches', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-id-precedence-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sessionIdMatch = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:session-id',
  })
  const conversationMatch = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:conversation',
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:conversation',
    sourceThreadId: 'thread-conversation',
  })

  assert.notEqual(
    sessionIdMatch.session.sessionId,
    conversationMatch.session.sessionId,
  )

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    sessionId: sessionIdMatch.session.sessionId,
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:conversation',
    sourceThreadId: 'thread-conversation',
    createIfMissing: false,
  })

  assert.equal(resolved.created, false)
  assert.equal(resolved.session.sessionId, sessionIdMatch.session.sessionId)
  assert.equal(resolved.session.binding.channel, 'imessage')
  assert.equal(resolved.session.binding.actorId, 'contact:conversation')
  assert.equal(resolved.session.binding.threadId, 'thread-conversation')

  const persisted = await getAssistantSession(vaultRoot, sessionIdMatch.session.sessionId)
  assert.equal(persisted.binding.threadId, 'thread-conversation')
})

test('resolveAssistantSession does not clear bindings when conversation only carries lookup metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-lookup-conversation-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'telegram',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-1',
    threadIsDirect: true,
  })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    sessionId: created.session.sessionId,
    conversation: {
      sessionId: created.session.sessionId,
    },
    createIfMissing: false,
  })

  assert.equal(resolved.created, false)
  assert.equal(resolved.session.binding.channel, 'telegram')
  assert.equal(resolved.session.binding.identityId, 'assistant:primary')
  assert.equal(resolved.session.binding.actorId, 'contact:bob')
  assert.equal(resolved.session.binding.threadId, 'chat-1')
  assert.equal(resolved.session.binding.threadIsDirect, true)

  const persisted = await getAssistantSession(vaultRoot, created.session.sessionId)
  assert.equal(persisted.binding.channel, 'telegram')
  assert.equal(persisted.binding.identityId, 'assistant:primary')
  assert.equal(persisted.binding.actorId, 'contact:bob')
  assert.equal(persisted.binding.threadId, 'chat-1')
  assert.equal(persisted.binding.threadIsDirect, true)
})

test('resolveAssistantSession ignores primitive conversation payloads when patching bindings', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-primitive-conversation-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'telegram',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-1',
    threadIsDirect: true,
  })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    sessionId: created.session.sessionId,
    conversation: 'lookup-only' as any,
    createIfMissing: false,
  })

  assert.equal(resolved.created, false)
  assert.equal(resolved.session.binding.channel, 'telegram')
  assert.equal(resolved.session.binding.identityId, 'assistant:primary')
  assert.equal(resolved.session.binding.actorId, 'contact:bob')
  assert.equal(resolved.session.binding.threadId, 'chat-1')
  assert.equal(resolved.session.binding.threadIsDirect, true)
})

test('resolveAssistantSession only enriches missing nested conversation fields that were explicitly provided', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-partial-conversation-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:partial-conversation',
  })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    sessionId: created.session.sessionId,
    conversation: {
      channel: 'linq',
    },
    createIfMissing: false,
  })

  assert.equal(resolved.created, false)
  assert.equal(resolved.session.binding.channel, 'linq')
  assert.equal(resolved.session.binding.identityId, null)
  assert.equal(resolved.session.binding.actorId, null)
  assert.equal(resolved.session.binding.threadId, null)
  assert.equal(resolved.session.binding.threadIsDirect, null)

  const persisted = await getAssistantSession(vaultRoot, created.session.sessionId)
  assert.equal(persisted.binding.channel, 'linq')
  assert.equal(persisted.binding.identityId, null)
  assert.equal(persisted.binding.actorId, null)
  assert.equal(persisted.binding.threadId, null)
  assert.equal(persisted.binding.threadIsDirect, null)
})

test('resolveAssistantSession ignores alias-only nested conversation payloads when patching bindings', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-alias-only-conversation-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:seed',
    channel: 'telegram',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-1',
    threadIsDirect: true,
  })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    sessionId: created.session.sessionId,
    conversation: {
      alias: 'chat:lookup',
    },
    createIfMissing: false,
  })

  assert.equal(resolved.created, false)
  assert.equal(resolved.session.binding.channel, 'telegram')
  assert.equal(resolved.session.binding.identityId, 'assistant:primary')
  assert.equal(resolved.session.binding.actorId, 'contact:bob')
  assert.equal(resolved.session.binding.threadId, 'chat-1')
  assert.equal(resolved.session.binding.threadIsDirect, true)

  const persisted = await getAssistantSession(vaultRoot, created.session.sessionId)
  assert.equal(persisted.binding.channel, 'telegram')
  assert.equal(persisted.binding.identityId, 'assistant:primary')
  assert.equal(persisted.binding.actorId, 'contact:bob')
  assert.equal(persisted.binding.threadId, 'chat-1')
  assert.equal(persisted.binding.threadIsDirect, true)
})

test('resolveAssistantSession rejects participant retargeting when a saved session is already bound to a different actor', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-participant-conflict-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'imessage',
    participantId: '+15551234567',
  })

  await assert.rejects(
    () =>
      resolveAssistantSession({
        vault: vaultRoot,
        sessionId: created.session.sessionId,
        actorId: '+15557654321',
        createIfMissing: false,
      }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: unknown })?.code,
        'ASSISTANT_SESSION_ROUTING_CONFLICT',
      )
      return true
    },
  )

  const persisted = await getAssistantSession(vaultRoot, created.session.sessionId)
  assert.equal(persisted.binding.actorId, '+15551234567')
  assert.equal(persisted.binding.delivery?.kind, 'participant')
  assert.equal(persisted.binding.delivery?.target, '+15551234567')
})

test('resolveAssistantSession rejects clearing a saved thread binding because that would broaden the routed audience', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-clear-thread-conflict-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    conversation: {
      channel: 'telegram',
      threadId: 'chat-1',
      directness: 'group',
    },
  })

  await assert.rejects(
    () =>
      resolveAssistantSession({
        vault: vaultRoot,
        sessionId: created.session.sessionId,
        conversation: {
          threadId: null,
        },
        createIfMissing: false,
      }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: unknown })?.code,
        'ASSISTANT_SESSION_ROUTING_CONFLICT',
      )
      return true
    },
  )

  const persisted = await getAssistantSession(vaultRoot, created.session.sessionId)
  assert.equal(persisted.binding.threadId, 'chat-1')
  assert.equal(persisted.binding.delivery?.kind, 'thread')
  assert.equal(persisted.binding.delivery?.target, 'chat-1')
})

test('resolveAssistantSession rejects clearing a saved participant binding because that would broaden the routed audience', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-clear-participant-conflict-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'imessage',
    participantId: '+15551234567',
  })

  await assert.rejects(
    () =>
      resolveAssistantSession({
        vault: vaultRoot,
        sessionId: created.session.sessionId,
        conversation: {
          participantId: null,
        },
        createIfMissing: false,
      }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: unknown })?.code,
        'ASSISTANT_SESSION_ROUTING_CONFLICT',
      )
      return true
    },
  )

  const persisted = await getAssistantSession(vaultRoot, created.session.sessionId)
  assert.equal(persisted.binding.actorId, '+15551234567')
  assert.equal(persisted.binding.delivery?.kind, 'participant')
  assert.equal(persisted.binding.delivery?.target, '+15551234567')
})

test('resolveAssistantSession can explicitly rebind a saved session to a new delivery channel when allowed', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-rebind-channel-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'cron:weekly-health-snapshot',
    channel: 'telegram',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-1',
    threadIsDirect: false,
  })

  await assert.rejects(
    () =>
      resolveAssistantSession({
        vault: vaultRoot,
        sessionId: created.session.sessionId,
        channel: 'email',
        identityId: 'sender@example.com',
        participantId: null,
        sourceThreadId: null,
        threadIsDirect: null,
        createIfMissing: false,
      }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: unknown })?.code,
        'ASSISTANT_SESSION_ROUTING_CONFLICT',
      )
      return true
    },
  )

  const rebound = await resolveAssistantSession({
    vault: vaultRoot,
    sessionId: created.session.sessionId,
    allowBindingRebind: true,
    channel: 'email',
    identityId: 'sender@example.com',
    participantId: null,
    sourceThreadId: null,
    threadIsDirect: null,
    createIfMissing: false,
  })

  assert.equal(rebound.session.sessionId, created.session.sessionId)
  assert.equal(rebound.session.alias, 'cron:weekly-health-snapshot')
  assert.equal(rebound.session.binding.channel, 'email')
  assert.equal(rebound.session.binding.identityId, 'sender@example.com')
  assert.equal(rebound.session.binding.actorId, null)
  assert.equal(rebound.session.binding.threadId, null)
  assert.equal(rebound.session.binding.threadIsDirect, null)
  assert.equal(rebound.session.binding.conversationKey, null)
  assert.equal(rebound.session.binding.delivery, null)

  const persisted = await getAssistantSession(vaultRoot, created.session.sessionId)
  assert.equal(persisted.binding.channel, 'email')
  assert.equal(persisted.binding.identityId, 'sender@example.com')
  assert.equal(persisted.binding.actorId, null)
  assert.equal(persisted.binding.threadId, null)
  assert.equal(persisted.binding.threadIsDirect, null)
  assert.equal(persisted.binding.conversationKey, null)
  assert.equal(persisted.binding.delivery, null)
})

test('resolveAssistantSession rejects alias reuse when the supplied routing metadata points at a different conversation', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-alias-routing-conflict-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const aliasMatch = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:alias',
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:alias',
    sourceThreadId: 'thread-alias',
  })
  const conversationMatch = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:conversation',
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:conversation',
    sourceThreadId: 'thread-conversation',
  })

  assert.notEqual(
    aliasMatch.session.sessionId,
    conversationMatch.session.sessionId,
  )

  await assert.rejects(
    () =>
      resolveAssistantSession({
        vault: vaultRoot,
        alias: 'chat:alias',
        channel: 'imessage',
        identityId: 'assistant:primary',
        participantId: 'contact:conversation',
        sourceThreadId: 'thread-conversation',
        createIfMissing: false,
      }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: unknown })?.code,
        'ASSISTANT_SESSION_ROUTING_CONFLICT',
      )
      return true
    },
  )

  const persisted = await getAssistantSession(vaultRoot, aliasMatch.session.sessionId)
  assert.equal(persisted.alias, 'chat:alias')
  assert.equal(persisted.binding.threadId, 'thread-alias')
})

test('resolveAssistantSession rotates conversation-key sessions after the max age threshold', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-rotate-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const first = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'imessage',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-1',
    now: new Date('2026-03-16T00:00:00.000Z'),
  })

  await saveAssistantSession(vaultRoot, {
    ...first.session,
    updatedAt: '2026-03-16T00:00:00.000Z',
    lastTurnAt: '2026-03-16T00:00:00.000Z',
    turnCount: 4,
  })

  const rotated = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'imessage',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-1',
    now: new Date('2026-03-19T00:00:00.000Z'),
    maxSessionAgeMs: 48 * 60 * 60 * 1000,
  })

  assert.equal(rotated.created, true)
  assert.notEqual(rotated.session.sessionId, first.session.sessionId)
  assert.equal(
    rotated.session.binding.conversationKey,
    first.session.binding.conversationKey,
  )

  const reused = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'imessage',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-1',
    now: new Date('2026-03-19T01:00:00.000Z'),
    maxSessionAgeMs: 48 * 60 * 60 * 1000,
  })

  assert.equal(reused.created, false)
  assert.equal(reused.session.sessionId, rotated.session.sessionId)

  const listed = await listAssistantSessions(vaultRoot)
  assert.equal(listed.length, 2)
})

test('resolveAssistantSession merges conversation refs with explicit locator overrides when creating bindings', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-conversation-ref-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    conversation: {
      channel: 'telegram',
      identityId: 'assistant:primary',
      participantId: 'contact:base',
      threadId: 'chat-base',
      directness: 'group',
    },
    actorId: 'contact:override',
    sourceThreadId: 'chat-override',
    threadIsDirect: true,
  })

  assert.equal(resolved.created, true)
  assert.equal(resolved.session.binding.channel, 'telegram')
  assert.equal(resolved.session.binding.identityId, 'assistant:primary')
  assert.equal(resolved.session.binding.actorId, 'contact:override')
  assert.equal(resolved.session.binding.threadId, 'chat-override')
  assert.equal(resolved.session.binding.threadIsDirect, true)
  assert.equal(
    resolved.session.binding.conversationKey,
    'channel:telegram|identity:assistant%3Aprimary|thread:chat-override',
  )
})

test('assistant memory write locks allow nested reentry while serializing concurrent same-root callers', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-memory-lock-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const paths = resolveAssistantMemoryStoragePaths(vaultRoot)
  const events: string[] = []
  const firstHolding = createDeferred<void>()
  const releaseFirst = createDeferred<void>()

  const first = withAssistantMemoryWriteLock(paths, async () => {
    events.push('first:start')

    await withAssistantMemoryWriteLock(paths, async () => {
      events.push('nested:start')
      events.push('nested:end')
    })

    events.push('first:after-nested')
    firstHolding.resolve()
    await releaseFirst.promise
    events.push('first:end')
  })

  await firstHolding.promise

  const second = withAssistantMemoryWriteLock(paths, async () => {
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

test('assistant runtime write locks allow nested reentry while serializing concurrent same-root callers', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-runtime-lock-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const events: string[] = []
  const firstHolding = createDeferred<void>()
  const releaseFirst = createDeferred<void>()

  const first = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    events.push('first:start')

    await withAssistantRuntimeWriteLock(vaultRoot, async () => {
      events.push('nested:start')
      events.push('nested:end')
    })

    events.push('first:after-nested')
    firstHolding.resolve()
    await releaseFirst.promise
    events.push('first:end')
  })

  await firstHolding.promise

  const second = withAssistantRuntimeWriteLock(vaultRoot, async () => {
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

test('saveAssistantSession waits for the assistant runtime write lock before mutating session state', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-save-lock-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:save-lock',
  })
  const lockHeld = createDeferred<void>()
  const releaseLock = createDeferred<void>()

  const holder = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    lockHeld.resolve()
    await releaseLock.promise
  })

  await lockHeld.promise

  let settled = false
  const savePromise = saveAssistantSession(vaultRoot, {
    ...resolved.session,
    updatedAt: '2026-03-28T10:00:00.000Z',
    lastTurnAt: '2026-03-28T10:00:00.000Z',
    turnCount: 1,
  }).then((value) => {
    settled = true
    return value
  })

  await Promise.resolve()
  assert.equal(settled, false)

  releaseLock.resolve()
  const saved = await savePromise
  await holder

  assert.equal(saved.turnCount, 1)
  assert.equal(saved.lastTurnAt, '2026-03-28T10:00:00.000Z')
})

test('resolveAssistantSession create-if-missing waits for the assistant runtime write lock before creating session indexes', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-resolve-lock-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const lockHeld = createDeferred<void>()
  const releaseLock = createDeferred<void>()

  const holder = withAssistantRuntimeWriteLock(vaultRoot, async () => {
    lockHeld.resolve()
    await releaseLock.promise
  })

  await lockHeld.promise

  let settled = false
  const resolvePromise = resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:resolve-lock',
  }).then((value) => {
    settled = true
    return value
  })

  await Promise.resolve()
  assert.equal(settled, false)

  releaseLock.resolve()
  const resolved = await resolvePromise
  await holder

  assert.equal(resolved.created, true)
  assert.equal(resolved.session.alias, 'chat:resolve-lock')
})

test('assistant transcripts are stored separately from session metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-transcript-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:bob',
  })

  const appended = await appendAssistantTranscriptEntries(
    vaultRoot,
    resolved.session.sessionId,
    [
      {
        kind: 'user',
        text: 'hello',
      },
      {
        kind: 'assistant',
        text: 'hi there',
      },
    ],
  )
  const transcript = await listAssistantTranscriptEntries(
    vaultRoot,
    resolved.session.sessionId,
  )

  assert.equal(appended.length, 2)
  assert.deepEqual(
    transcript.map((entry) => ({
      kind: entry.kind,
      text: entry.text,
    })),
    [
      {
        kind: 'user',
        text: 'hello',
      },
      {
        kind: 'assistant',
        text: 'hi there',
      },
    ],
  )

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const persistedSession = JSON.parse(
    await readFile(
      path.join(statePaths.sessionsDirectory, `${resolved.session.sessionId}.json`),
      'utf8',
    ),
  ) as Record<string, unknown>
  assert.equal('lastUserMessage' in persistedSession, false)
  assert.equal('lastAssistantMessage' in persistedSession, false)
})

test('resolveAssistantSession rebuilds torn indexes from session files and listAssistantSessions skips torn session JSON', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-index-rebuild-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:rebuild-index',
  })
  const statePaths = resolveAssistantStatePaths(vaultRoot)

  await writeFile(
    statePaths.indexesPath,
    '{"version":2,"aliases":{"chat:rebuild-index"',
    'utf8',
  )
  await writeFile(
    path.join(statePaths.sessionsDirectory, 'broken-session.json'),
    '{"schema":"murph.assistant-session.v3"',
    'utf8',
  )

  const rebound = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:rebuild-index',
    createIfMissing: false,
  })
  const sessions = await listAssistantSessions(vaultRoot)

  assert.equal(rebound.session.sessionId, resolved.session.sessionId)
  assert.deepEqual(
    sessions.map((session) => session.sessionId),
    [resolved.session.sessionId],
  )
})

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    reject,
    resolve,
  }
}

test('getAssistantSession explains vault-scoped session drift when only a transcript remains', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-missing-session-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sessionId = 'asst_orphaned'
  await appendAssistantTranscriptEntries(vaultRoot, sessionId, [
    {
      kind: 'error',
      text: 'Assistant session vanished.',
    },
  ])

  await assert.rejects(
    () => getAssistantSession(vaultRoot, sessionId),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_SESSION_NOT_FOUND')
      assert.match(String(error.message), /vault-scoped/u)
      assert.match(String(error.message), /local transcript exists/u)
      assert.equal(error.context?.sessionId, sessionId)
      assert.equal(error.context?.sessionExists, false)
      assert.equal(error.context?.transcriptExists, true)
      assert.equal(
        typeof error.context?.stateRoot === 'string' &&
          error.context.stateRoot.includes(path.join(parent, 'assistant-state')),
        true,
      )
      return true
    },
  )
})

test('getAssistantSession rejects non-canonical assistant state payloads with excerpt fields', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-state-migrate-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(statePaths.sessionsDirectory, {
    recursive: true,
  })

  const sessionId = 'asst_legacy'
  await writeFile(
    path.join(statePaths.sessionsDirectory, `${sessionId}.json`),
    `${JSON.stringify(
      {
        schema: 'murph.assistant-session.v3',
        sessionId,
        provider: 'codex-cli',
        providerSessionId: 'thread-legacy',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: 'legacy:bob',
        binding: {
          conversationKey: 'channel:imessage|actor:contact%3Abob',
          channel: 'imessage',
          identityId: null,
          actorId: 'contact:bob',
          threadId: 'chat-123',
          threadIsDirect: null,
          delivery: {
            kind: 'participant',
            target: 'contact:bob',
          },
        },
        createdAt: '2026-03-16T10:00:00.000Z',
        updatedAt: '2026-03-16T10:05:00.000Z',
        lastTurnAt: '2026-03-16T10:05:00.000Z',
        turnCount: 2,
        lastUserMessage: 'sensitive prompt excerpt',
        lastAssistantMessage: 'sensitive response excerpt',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  await assert.rejects(() => getAssistantSession(vaultRoot, sessionId))
})

test('getAssistantSession rejects invalid provider payloads instead of coercing them', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-state-provider-hard-cut-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(statePaths.sessionsDirectory, {
    recursive: true,
  })

  const sessionId = 'asst_provider_legacy'
  await writeFile(
    path.join(statePaths.sessionsDirectory, `${sessionId}.json`),
    `${JSON.stringify(
      {
        schema: 'murph.assistant-session.v3',
        sessionId,
        provider: 'legacy-provider',
        providerSessionId: 'thread-legacy',
        providerOptions: {
          model: 'gpt-oss:20b',
        },
        alias: 'legacy:bob',
        binding: {
          conversationKey: null,
          channel: null,
          identityId: null,
          actorId: null,
          threadId: null,
          threadIsDirect: null,
          delivery: null,
        },
        createdAt: '2026-03-16T10:00:00.000Z',
        updatedAt: '2026-03-16T10:05:00.000Z',
        lastTurnAt: null,
        turnCount: 0,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  await assert.rejects(() => getAssistantSession(vaultRoot, sessionId))
})

test('resolveAssistantSession ignores legacy aliases.json fallback state', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-alias-hard-cut-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(statePaths.sessionsDirectory, {
    recursive: true,
  })
  await writeFile(
    path.join(statePaths.sessionsDirectory, 'asst_existing.json'),
    `${JSON.stringify(
      {
        schema: 'murph.assistant-session.v3',
        sessionId: 'asst_existing',
        provider: 'codex-cli',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
          profile: null,
          oss: false,
        },
        providerBinding: null,
        alias: 'chat:bob',
        binding: {
          conversationKey: null,
          channel: null,
          identityId: null,
          actorId: null,
          threadId: null,
          threadIsDirect: null,
          delivery: null,
        },
        createdAt: '2026-03-18T10:00:00.000Z',
        updatedAt: '2026-03-18T10:00:00.000Z',
        lastTurnAt: null,
        turnCount: 0,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  await writeFile(
    path.join(statePaths.assistantStateRoot, 'aliases.json'),
    `${JSON.stringify(
      {
        version: 1,
        aliases: {
          'chat:bob': 'asst_existing',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  await assert.rejects(() =>
    resolveAssistantSession({
      vault: vaultRoot,
      alias: 'chat:bob',
      createIfMissing: false,
    }),
  )
})

test('readAssistantAutomationState quarantines and rebuilds legacy automation v1 payloads', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-automation-hard-cut-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(statePaths.sessionsDirectory, {
    recursive: true,
  })
  await writeFile(
    statePaths.automationPath,
    `${JSON.stringify(
      {
        version: 1,
        inboxScanCursor: null,
        updatedAt: '2026-03-18T10:00:00.000Z',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const recovered = await readAssistantAutomationState(vaultRoot)
  assert.equal(recovered.autoReplyPrimed, true)
  assert.deepEqual(recovered.autoReplyChannels, [])

  const automationQuarantineDirectory = path.join(
    statePaths.quarantineDirectory,
    'automation',
  )
  const quarantineEntries = await readdir(automationQuarantineDirectory)
  assert.equal(quarantineEntries.some((entry) => entry.endsWith('.meta.json')), true)
  assert.equal(quarantineEntries.some((entry) => entry.includes('.invalid')), true)
})

test('redactAssistantDisplayPath hides HOME-prefixed paths and leaves external paths untouched', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-redact-'))
  const homeRoot = path.join(parent, 'home')
  const nestedPath = path.join(homeRoot, 'vault', 'sessions')
  const outsidePath = path.join(parent, 'outside')
  await mkdir(nestedPath, {
    recursive: true,
  })
  await mkdir(outsidePath, {
    recursive: true,
  })
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  try {
    assert.equal(redactAssistantDisplayPath(homeRoot), '~')
    assert.equal(
      redactAssistantDisplayPath(nestedPath),
      path.join('~', 'vault', 'sessions'),
    )
    assert.equal(redactAssistantDisplayPath(outsidePath), path.resolve(outsidePath))
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

function restoreEnvironmentVariable(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

test('upsertAssistantMemory writes vault-scoped Markdown memory with provenance metadata and forget removes targeted records', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const now = new Date('2026-03-17T09:15:00.000Z')
  const result = await upsertAssistantMemory({
    vault: vaultRoot,
    now,
    text: 'Call me Alex.',
    scope: 'both',
    section: 'Identity',
    sourcePrompt: 'Call me Alex from now on.',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const dailyPath = resolveAssistantDailyMemoryPath(statePaths, now)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const dailyMemory = await readFile(dailyPath, 'utf8')
  const longTermRecord = result.memories.find((memory) => memory.kind === 'long-term')
  const dailyRecord = result.memories.find((memory) => memory.kind === 'daily')

  assert.equal(result.longTermAdded, 1)
  assert.equal(result.dailyAdded, 1)
  assert.equal(longTermRecord?.provenance?.writtenBy, 'operator')
  assert.equal(dailyRecord?.provenance?.writtenBy, 'operator')
  assert.match(longTermMemory, /Call the user Alex\./u)
  assert.match(dailyMemory, /Call the user Alex\./u)
  assert.match(longTermMemory, /murph-assistant-memory:/u)
  assert.match(dailyMemory, /murph-assistant-memory:/u)
  assert.equal(longTermMemory.includes(vaultRoot), false)
  assert.equal(dailyMemory.includes(vaultRoot), false)

  const removedLongTerm = await forgetAssistantMemory({
    vault: vaultRoot,
    id: longTermRecord?.id ?? '',
  })
  const removedDaily = await forgetAssistantMemory({
    vault: vaultRoot,
    id: dailyRecord?.id ?? '',
  })
  const search = await searchAssistantMemory({
    vault: vaultRoot,
    scope: 'all',
    text: 'Alex',
  })

  assert.equal(removedLongTerm.removed.id, longTermRecord?.id)
  assert.equal(removedDaily.removed.id, dailyRecord?.id)
  assert.equal(search.results.some((memory) => memory.id === longTermRecord?.id), false)
  assert.equal(search.results.some((memory) => memory.id === dailyRecord?.id), false)
})

test('extractAssistantMemory strips identity tail text and ignores one-off formatting requests', () => {
  const extracted = extractAssistantMemory(
    'Actually, call me Alex from now on. Show me a table comparing these two meds.',
  )

  assert.deepEqual(extracted.longTerm, [
    {
      section: 'Identity',
      text: 'Call the user Alex.',
    },
  ])
  assert.equal(extracted.daily.length, 0)
})

test('extractAssistantMemory splits compound onboarding-style memory clauses', () => {
  const extracted = extractAssistantMemory(
    'hmm call me will, fine with ur default tone, and i wanna do more strength training and lower my cholesterol!',
  )

  assert.deepEqual(extracted.longTerm, [
    {
      section: 'Identity',
      text: 'Call the user will.',
    },
    {
      section: 'Preferences',
      text: 'User prefers the default assistant tone.',
    },
  ])
  assert.equal(extracted.daily.length, 0)
})

test('extractAssistantMemory only keeps durable health context by default', () => {
  const extracted = extractAssistantMemory(
    [
      'My blood pressure is 120 over 80.',
      "I'm concerned about my blood pressure lately.",
      'I track blood pressure and glucose.',
      "I'm allergic to penicillin.",
      'I have asthma.',
      'I have diabetes.',
      "I'm experiencing headaches today.",
    ].join(' '),
  )

  assert.deepEqual(
    extracted.longTerm.filter((entry) => entry.section === 'Health context'),
    [
      {
        section: 'Health context',
        text: 'User tracks blood pressure and glucose.',
      },
      {
        section: 'Health context',
        text: 'User is allergic to penicillin.',
      },
      {
        section: 'Health context',
        text: 'User has asthma.',
      },
      {
        section: 'Health context',
        text: 'User has diabetes.',
      },
    ],
  )
})

test('upsertAssistantMemory binds assistant writes to the active turn context', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-turn-context-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const turnContext = resolveAssistantMemoryTurnContext(
    createAssistantMemoryTurnContextEnv({
      allowSensitiveHealthContext: true,
      sessionId: 'asst_123',
      sourcePrompt: 'Remember that my blood pressure is 120 over 80.',
      turnId: 'turn_123',
      vault: vaultRoot,
    }),
  )
  assert.ok(turnContext)

  const result = await upsertAssistantMemory({
    vault: vaultRoot,
    now: new Date('2026-03-17T10:30:00.000Z'),
    text: "User's blood pressure is 120 over 80.",
    scope: 'both',
    section: 'Health context',
    sourcePrompt: 'Remember that I have diabetes.',
    turnContext,
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const dailyPath = resolveAssistantDailyMemoryPath(
    statePaths,
    new Date('2026-03-17T10:30:00.000Z'),
  )
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const dailyMemory = await readFile(dailyPath, 'utf8')

  assert.equal(result.memories[0]?.provenance?.writtenBy, 'assistant')
  assert.equal(result.memories[0]?.provenance?.sessionId, 'asst_123')
  assert.equal(result.memories[0]?.provenance?.turnId, 'turn_123')
  assert.match(longTermMemory, /User's blood pressure is 120 over 80\./u)
  assert.match(dailyMemory, /User's blood pressure is 120 over 80\./u)

  await assert.rejects(
    upsertAssistantMemory({
      vault: vaultRoot,
      text: 'Call the user Bob.',
      scope: 'long-term',
      section: 'Identity',
      turnContext: resolveAssistantMemoryTurnContext(
        createAssistantMemoryTurnContextEnv({
          allowSensitiveHealthContext: true,
          sessionId: 'asst_456',
          sourcePrompt: 'Keep answers concise.',
          turnId: 'turn_456',
          vault: vaultRoot,
        }),
      ),
    }),
    /grounded in the active user turn/u,
  )
})

test('upsertAssistantMemory accepts canonical identity and tone writes from a compound bound user turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-compound-turn-context-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const turnContext = resolveAssistantMemoryTurnContext(
    createAssistantMemoryTurnContextEnv({
      allowSensitiveHealthContext: true,
      sessionId: 'asst_789',
      sourcePrompt:
        'hmm call me will, fine with ur default tone, and i wanna do more strength training and lower my cholesterol!',
      turnId: 'turn_789',
      vault: vaultRoot,
    }),
  )
  assert.ok(turnContext)

  const identityResult = await upsertAssistantMemory({
    vault: vaultRoot,
    text: 'Call me Will.',
    scope: 'long-term',
    section: 'Identity',
    turnContext,
  })
  const preferenceResult = await upsertAssistantMemory({
    vault: vaultRoot,
    text: 'User prefers the default assistant tone.',
    scope: 'long-term',
    section: 'Preferences',
    turnContext,
  })

  assert.equal(identityResult.memories[0]?.text, 'Call the user Will.')
  assert.equal(
    preferenceResult.memories[0]?.text,
    'User prefers the default assistant tone.',
  )
})

test('upsertAssistantMemory replaces mutable long-term identity and response-style memory', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-memory-upsert-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const firstNow = new Date('2026-03-17T09:15:00.000Z')
  const secondNow = new Date('2026-03-17T11:45:00.000Z')

  await upsertAssistantMemory({
    vault: vaultRoot,
    now: firstNow,
    text: 'Call me Chris.',
    scope: 'both',
    section: 'Identity',
    sourcePrompt: 'Call me Chris from now on.',
  })
  await upsertAssistantMemory({
    vault: vaultRoot,
    now: firstNow,
    text: 'Keep answers concise.',
    scope: 'long-term',
    section: 'Standing instructions',
    sourcePrompt: 'Going forward, keep answers concise.',
  })
  await upsertAssistantMemory({
    vault: vaultRoot,
    now: firstNow,
    text: 'Use imperial units.',
    scope: 'long-term',
    section: 'Preferences',
    sourcePrompt: 'Use imperial units.',
  })

  await upsertAssistantMemory({
    vault: vaultRoot,
    now: secondNow,
    text: 'Call me Alex.',
    scope: 'both',
    section: 'Identity',
    sourcePrompt: 'Actually, call me Alex from now on.',
  })
  await upsertAssistantMemory({
    vault: vaultRoot,
    now: secondNow,
    text: 'Keep answers detailed.',
    scope: 'long-term',
    section: 'Standing instructions',
    sourcePrompt: 'From now on, keep answers detailed.',
  })
  await upsertAssistantMemory({
    vault: vaultRoot,
    now: secondNow,
    text: 'Use metric units.',
    scope: 'long-term',
    section: 'Preferences',
    sourcePrompt: 'Use metric units.',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const promptBlock = await loadAssistantMemoryPromptBlock({
    now: secondNow,
    vault: vaultRoot,
  })

  assert.match(longTermMemory, /Call the user Alex\./u)
  assert.doesNotMatch(longTermMemory, /Call the user Chris\./u)
  assert.match(longTermMemory, /keep answers detailed\./iu)
  assert.doesNotMatch(longTermMemory, /keep answers concise\./iu)
  assert.match(longTermMemory, /Use metric units\./u)
  assert.doesNotMatch(longTermMemory, /Use imperial units\./u)
  assert.match(promptBlock ?? '', /Call the user Alex\./u)
  assert.doesNotMatch(promptBlock ?? '', /Call the user Chris\./u)
  assert.match(promptBlock ?? '', /keep answers detailed\./iu)
  assert.doesNotMatch(promptBlock ?? '', /keep answers concise\./iu)
  assert.match(promptBlock ?? '', /Use metric units\./u)
  assert.doesNotMatch(promptBlock ?? '', /Use imperial units\./u)
})

test('upsertAssistantMemory exposes typed search/get results with cited file locations', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-memory-search-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const now = new Date('2026-03-18T09:45:00.000Z')
  const upserted = await upsertAssistantMemory({
    vault: vaultRoot,
    now,
    text: 'Call me Alex.',
    scope: 'both',
    section: 'Identity',
    sourcePrompt: 'Call me Alex from now on.',
  })

  const search = await searchAssistantMemory({
    vault: vaultRoot,
    scope: 'all',
    text: 'Alex',
  })
  const longTermMemory = upserted.memories.find((memory) => memory.kind === 'long-term')
  const dailyMemory = upserted.memories.find((memory) => memory.kind === 'daily')

  assert.equal(upserted.longTermAdded, 1)
  assert.equal(upserted.dailyAdded, 1)
  assert.equal(search.results.length >= 1, true)
  assert.equal(longTermMemory?.section, 'Identity')
  assert.equal(longTermMemory?.text, 'Call the user Alex.')
  assert.equal(longTermMemory?.sourceLine !== undefined, true)
  assert.equal(longTermMemory?.sourcePath.endsWith('MEMORY.md'), true)
  assert.equal(dailyMemory?.sourcePath.endsWith(path.join('memory', '2026-03-18.md')), true)

  const fetched = await getAssistantMemory({
    vault: vaultRoot,
    id: longTermMemory?.id ?? '',
  })
  assert.equal(fetched.id, longTermMemory?.id)
  assert.equal(fetched.text, 'Call the user Alex.')
})

test('loadAssistantMemoryPromptBlock keeps daily notes out of the core bootstrap prompt and gates health memory by privacy', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-memory-core-prompt-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  await upsertAssistantMemory({
    vault: vaultRoot,
    now: new Date('2026-03-18T09:00:00.000Z'),
    text: 'Keep answers concise.',
    scope: 'long-term',
    section: 'Standing instructions',
    sourcePrompt: 'Going forward, keep answers concise.',
  })
  await upsertAssistantMemory({
    vault: vaultRoot,
    now: new Date('2026-03-18T09:05:00.000Z'),
    text: 'We are working on assistant memory tools.',
    scope: 'daily',
  })
  await upsertAssistantMemory({
    vault: vaultRoot,
    now: new Date('2026-03-18T09:10:00.000Z'),
    text: 'User has asthma.',
    scope: 'long-term',
    section: 'Health context',
    allowSensitiveHealthContext: true,
    sourcePrompt: 'Remember that I have asthma.',
  })

  const privatePrompt = await loadAssistantMemoryPromptBlock({
    vault: vaultRoot,
    includeSensitiveHealthContext: true,
  })
  const sharedPrompt = await loadAssistantMemoryPromptBlock({
    vault: vaultRoot,
    includeSensitiveHealthContext: false,
  })

  assert.match(privatePrompt ?? '', /Core assistant memory:/u)
  assert.match(privatePrompt ?? '', /keep answers concise\./iu)
  assert.match(privatePrompt ?? '', /User has asthma\./u)
  assert.doesNotMatch(privatePrompt ?? '', /assistant memory tools/u)
  assert.match(sharedPrompt ?? '', /keep answers concise\./iu)
  assert.doesNotMatch(sharedPrompt ?? '', /User has asthma\./u)
})

test('upsertAssistantMemory accepts durable health context without explicit remember phrasing in private contexts', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-memory-health-policy-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const result = await upsertAssistantMemory({
    vault: vaultRoot,
    text: 'User has diabetes.',
    scope: 'both',
    section: 'Health context',
    allowSensitiveHealthContext: true,
    sourcePrompt: 'I have diabetes.',
  })

  assert.equal(result.longTermAdded, 1)
  assert.equal(result.dailyAdded, 1)
  assert.equal(result.memories.some((memory) => memory.text === 'User has diabetes.'), true)
})

test('upsertAssistantMemory still blocks health context outside private assistant contexts', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-memory-health-private-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  await assert.rejects(
    upsertAssistantMemory({
      vault: vaultRoot,
      text: 'User has diabetes.',
      scope: 'long-term',
      section: 'Health context',
      sourcePrompt: 'I have diabetes.',
    }),
    /private assistant contexts/u,
  )
})

test('assistant session schema rejects path-like session identifiers before persistence', () => {
  const valid = {
    schema: 'murph.assistant-session.v3',
    sessionId: 'session_safe_123',
    provider: 'codex-cli',
    providerOptions: {
      model: null,
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      headers: null,
    },
    providerBinding: null,
    alias: 'chat:test',
    binding: {
      conversationKey: 'chat:test',
      channel: 'local',
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: true,
      delivery: null,
    },
    createdAt: '2026-03-29T00:00:00.000Z',
    updatedAt: '2026-03-29T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
  } as const

  assert.equal(assistantSessionSchema.parse(valid).sessionId, 'session_safe_123')
  assert.equal(parseAssistantSessionRecord(valid).sessionId, 'session_safe_123')
  assert.throws(
    () =>
      parseAssistantSessionRecord({
        ...valid,
        providerBinding: undefined,
        providerSessionId: 'thread-legacy',
      }),
    /Unrecognized key/u,
  )
  assert.throws(
    () =>
      assistantSessionSchema.parse({
        ...valid,
        sessionId: '../escape',
      }),
    /opaque runtime ids/u,
  )
  assert.throws(
    () =>
      parseAssistantSessionRecord({
        ...valid,
        sessionId: 'nested/escape',
      }),
    /opaque runtime ids/u,
  )
})

test('assistant storage readers reject traversal-like opaque ids at the filesystem boundary', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-storage-ids-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const paths = resolveAssistantStatePaths(vaultRoot)
  const invalidId = '../escape'
  const expectInvalidRuntimeId = async (callback: () => Promise<unknown>) => {
    await assert.rejects(callback, (error) => {
      assert.equal(error instanceof Error, true)
      assert.equal(
        (error as { code?: unknown }).code,
        'ASSISTANT_INVALID_RUNTIME_ID',
      )
      return true
    })
  }

  await expectInvalidRuntimeId(() =>
    readAssistantSession({
      paths,
      sessionId: invalidId,
    }),
  )
  await expectInvalidRuntimeId(() =>
    listAssistantTranscriptDistillations(vaultRoot, invalidId),
  )
  await expectInvalidRuntimeId(() => readAssistantOutboxIntent(vaultRoot, invalidId))
  await expectInvalidRuntimeId(() => readAssistantTurnReceipt(vaultRoot, invalidId))
  await expectInvalidRuntimeId(() => readAssistantCronRuns(paths, invalidId))
})

test('assistant runtime budget snapshots are quarantined, recreated, and fully pruned with orphan payload cleanup', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-runtime-budget-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const paths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(path.dirname(paths.resourceBudgetPath), {
    recursive: true,
  })
  await writeFile(
    paths.resourceBudgetPath,
    JSON.stringify({
      schema: 'murph.assistant-runtime-budget.v1',
      updatedAt: 42,
    }),
    'utf8',
  )

  const recovered = await readAssistantRuntimeBudgetStatus(vaultRoot)
  assert.equal(recovered.schema, 'murph.assistant-runtime-budget.v1')
  assert.deepEqual(recovered.maintenance.notes, [])

  const runtimeBudgetQuarantineDirectory = path.join(
    paths.quarantineDirectory,
    'runtime-budget',
  )
  const quarantinedEntries = await readdir(runtimeBudgetQuarantineDirectory)
  const metadataName = quarantinedEntries.find((entry) => entry.endsWith('.meta.json'))
  assert.ok(metadataName)
  const payloadName = quarantinedEntries.find((entry) => !entry.endsWith('.meta.json'))
  assert.ok(payloadName)

  const metadataPath = path.join(runtimeBudgetQuarantineDirectory, metadataName!)
  const payloadPath = path.join(runtimeBudgetQuarantineDirectory, payloadName!)
  const metadataRecord = JSON.parse(
    await readFile(metadataPath, 'utf8'),
  ) as Record<string, unknown>
  metadataRecord.quarantinedAt = '2026-01-01T00:00:00.000Z'
  await writeFile(metadataPath, `${JSON.stringify(metadataRecord, null, 2)}\n`, 'utf8')

  const orphanPayloadPath = path.join(
    runtimeBudgetQuarantineDirectory,
    'orphan-runtime-budget.1700000000000.invalid.json',
  )
  await writeFile(orphanPayloadPath, '{"stale":true}\n', 'utf8')
  const staleDate = new Date('2026-01-01T00:00:00.000Z')
  await utimes(orphanPayloadPath, staleDate, staleDate)

  await runAssistantRuntimeMaintenance({
    now: new Date('2026-03-29T12:00:00.000Z'),
    vault: vaultRoot,
  })

  const remainingEntries: string[] = await readdir(
    runtimeBudgetQuarantineDirectory,
  ).catch(() => [])
  assert.equal(remainingEntries.includes(path.basename(metadataPath)), false)
  assert.equal(remainingEntries.includes(path.basename(payloadPath)), false)
  assert.equal(remainingEntries.includes(path.basename(orphanPayloadPath)), false)
})

test('assistant status includes runtime-budget quarantine details on the same recovery read', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-status-runtime-budget-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const paths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(path.dirname(paths.resourceBudgetPath), {
    recursive: true,
  })
  await writeFile(
    paths.resourceBudgetPath,
    JSON.stringify({
      schema: 'murph.assistant-runtime-budget.v1',
      updatedAt: 42,
    }),
    'utf8',
  )

  const status = await getAssistantStatus(vaultRoot)
  assert.equal(status.runtimeBudget.schema, 'murph.assistant-runtime-budget.v1')
  assert.equal(status.quarantine.byKind['runtime-budget'], 1)
  assert.equal(status.quarantine.total >= 1, true)
  assert.equal(
    status.warnings.some((warning) => warning.includes('quarantined for repair')),
    true,
  )
})

test('assistant session secrets persist in private sidecars with private permissions and redacted display output', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-session-secrets-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'assistant:secret-session',
    channel: 'imessage',
    participantId: 'contact:secret-user',
  })
  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const updatedSession = await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'openai-compatible',
    providerOptions: {
      model: 'gpt-4.1-mini',
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'https://api.example.test/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      providerName: 'example',
      headers: {
        Authorization: 'Bearer session-secret-token',
        'X-Visible': 'public-header',
      },
    },
    providerBinding: {
      provider: 'openai-compatible',
      providerSessionId: 'provider-session-1',
      providerState: null,
      providerOptions: {
        model: 'gpt-4.1-mini',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        baseUrl: 'https://api.example.test/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        providerName: 'example',
        headers: {
          Authorization: 'Bearer binding-secret-token',
          'X-Binding-Visible': 'binding-public',
        },
      },
    },
    updatedAt: '2026-03-29T12:00:00.000Z',
  })

  const sessionPath = path.join(
    statePaths.sessionsDirectory,
    `${updatedSession.sessionId}.json`,
  )
  const sessionSecretsPath = path.join(
    statePaths.sessionSecretsDirectory,
    `${updatedSession.sessionId}.json`,
  )

  const persistedRaw = await readFile(sessionPath, 'utf8')
  const persisted = JSON.parse(persistedRaw) as {
    providerBinding?: {
      providerOptions?: {
        headers?: Record<string, string> | null
      } | null
    } | null
    providerOptions?: {
      headers?: Record<string, string> | null
    } | null
  }
  const secretSidecar = JSON.parse(
    await readFile(sessionSecretsPath, 'utf8'),
  ) as {
    providerBindingHeaders?: Record<string, string> | null
    providerHeaders?: Record<string, string> | null
  }

  assert.deepEqual(persisted.providerOptions?.headers, {
    'X-Visible': 'public-header',
  })
  assert.deepEqual(persisted.providerBinding?.providerOptions?.headers, {
    'X-Binding-Visible': 'binding-public',
  })
  assert.equal(/session-secret-token|binding-secret-token/u.test(persistedRaw), false)
  assert.deepEqual(secretSidecar.providerHeaders, {
    Authorization: 'Bearer session-secret-token',
  })
  assert.deepEqual(secretSidecar.providerBindingHeaders, {
    Authorization: 'Bearer binding-secret-token',
  })

  const reloaded = await readAssistantSession({
    paths: statePaths,
    sessionId: updatedSession.sessionId,
  })
  assert.equal(
    reloaded?.providerOptions.headers?.Authorization,
    'Bearer session-secret-token',
  )
  assert.equal(
    reloaded?.providerBinding?.providerOptions.headers?.Authorization,
    'Bearer binding-secret-token',
  )

  const redacted = redactAssistantSessionForDisplay(reloaded!)
  assert.equal(redacted.providerOptions.headers?.Authorization, '[REDACTED]')
  assert.equal(redacted.providerOptions.headers?.['X-Visible'], 'public-header')
  assert.equal(
    redacted.providerBinding?.providerOptions.headers?.Authorization,
    '[REDACTED]',
  )
  assert.equal(
    redacted.providerBinding?.providerOptions.headers?.['X-Binding-Visible'],
    'binding-public',
  )

  assert.equal((await stat(statePaths.assistantStateRoot)).mode & 0o777, 0o700)
  assert.equal((await stat(statePaths.sessionsDirectory)).mode & 0o777, 0o700)
  assert.equal((await stat(statePaths.sessionSecretsDirectory)).mode & 0o777, 0o700)
  assert.equal((await stat(sessionPath)).mode & 0o777, 0o600)
  assert.equal((await stat(sessionSecretsPath)).mode & 0o777, 0o600)
})

test('malformed session secret sidecars are quarantined instead of being treated as cleanly missing', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-sidecar-corruption-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'assistant:corrupted-sidecar',
    channel: 'imessage',
    participantId: 'contact:corrupted-sidecar',
  })
  const updatedSession = await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'openai-compatible',
    providerOptions: {
      model: 'gpt-4.1-mini',
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'https://api.example.test/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      providerName: 'example',
      headers: {
        Authorization: 'Bearer session-secret-token',
      },
    },
    updatedAt: '2026-03-29T12:10:00.000Z',
  })
  const sessionSecretsPath = path.join(
    statePaths.sessionSecretsDirectory,
    `${updatedSession.sessionId}.json`,
  )
  await writeFile(sessionSecretsPath, '{"schema":"murph.assistant-session-secrets.v1"', 'utf8')

  await assert.rejects(
    () =>
      readAssistantSession({
        paths: statePaths,
        sessionId: updatedSession.sessionId,
      }),
    (error) => {
      assert.equal((error as { code?: unknown }).code, 'ASSISTANT_SESSION_CORRUPTED')
      assert.match(
        String((error as { context?: { reason?: unknown } }).context?.reason),
        /secret sidecar is corrupted and was quarantined/u,
      )
      return true
    },
  )
  await assert.rejects(() => stat(sessionSecretsPath))

  const quarantine = await summarizeAssistantQuarantines({
    paths: statePaths,
  })
  assert.equal(quarantine.total >= 1, true)
  assert.equal(quarantine.byKind.session >= 1, true)
})
