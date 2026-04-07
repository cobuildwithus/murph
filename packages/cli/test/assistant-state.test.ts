import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import { createTempVaultContext } from './cli-test-helpers.js'
import {
  appendAssistantTranscriptEntries,
  getAssistantSession,
  listAssistantTranscriptEntries,
  listAssistantSessions,
  readAssistantAutomationState,
  redactAssistantDisplayPath,
  resolveAssistantAliasKey,
  resolveAssistantSession,
  resolveAssistantStatePaths,
  saveAssistantSession,
} from '@murphai/assistant-engine/assistant-state'
import {
  getAssistantStatus,
} from '@murphai/assistant-cli/assistant/status'
import { createAssistantBackendTarget } from '@murphai/operator-config/assistant-backend'
import {
  readAssistantRuntimeBudgetStatus,
  runAssistantRuntimeMaintenance,
} from '@murphai/assistant-engine/assistant/runtime-budgets'
import { readAssistantCronRuns } from '@murphai/assistant-engine/assistant/cron/store'
import { readAssistantOutboxIntent } from '@murphai/assistant-cli/assistant/outbox'
import { summarizeAssistantQuarantines } from '@murphai/assistant-engine/assistant/quarantine'
import { withAssistantRuntimeWriteLock } from '@murphai/assistant-engine/assistant/runtime-write-lock'
import { readAssistantSession } from '@murphai/assistant-engine/assistant/store/persistence'
import { readAssistantTurnReceipt } from '@murphai/assistant-engine/assistant/turns'
import {
  assistantSessionSchema,
  parseAssistantSessionRecord,
} from '@murphai/operator-config/assistant-cli-contracts'
import { redactAssistantSessionForDisplay } from '@murphai/assistant-engine/assistant/redaction'

const cleanupPaths: string[] = []

async function createAssistantStateVault(prefix: string): Promise<{
  parentRoot: string
  vaultRoot: string
}> {
  const context = await createTempVaultContext(prefix)
  cleanupPaths.push(context.parentRoot)
  return context
}

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-group-routing-scope-')

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

test('assistant sessions live under the vault runtime area, omit redundant path metadata, and reuse alias mappings', async () => {
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-state-')

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  assert.equal(statePaths.absoluteVaultRoot, path.resolve(vaultRoot))
  assert.equal(
    statePaths.assistantStateRoot,
    path.join(path.resolve(vaultRoot), '.runtime', 'operations', 'assistant'),
  )
  assert.equal(statePaths.assistantStateRoot.startsWith(path.resolve(vaultRoot)), true)
  assert.equal(
    statePaths.transcriptsDirectory,
    path.join(statePaths.assistantStateRoot, 'transcripts'),
  )
  assert.equal(statePaths.cronDirectory, path.join(statePaths.assistantStateRoot, 'cron'))
  assert.equal(statePaths.cronJobsPath, path.join(statePaths.cronDirectory, 'jobs.json'))
  assert.equal(statePaths.cronRunsDirectory, path.join(statePaths.cronDirectory, 'runs'))
  assert.equal(statePaths.stateDirectory, path.join(statePaths.assistantStateRoot, 'state'))
  assert.equal(statePaths.turnsDirectory, path.join(statePaths.assistantStateRoot, 'receipts'))
  assert.equal(statePaths.outboxDirectory, path.join(statePaths.assistantStateRoot, 'outbox'))

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

test('resolveAssistantSession prefers explicit sessionId over conversation-key matches', async () => {
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-id-precedence-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-lookup-conversation-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-primitive-conversation-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-partial-conversation-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-alias-only-conversation-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-participant-conflict-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-clear-thread-conflict-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-clear-participant-conflict-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-rebind-channel-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-alias-routing-conflict-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-rotate-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-conversation-ref-')

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

test('assistant runtime write locks allow nested reentry while serializing concurrent same-root callers', async () => {
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-runtime-lock-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-save-lock-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-resolve-lock-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-transcript-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-index-rebuild-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-missing-session-')

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
        error.context?.stateRoot,
        path.join(path.resolve(vaultRoot), '.runtime', 'operations', 'assistant'),
      )
      return true
    },
  )
})

test('getAssistantSession rejects non-canonical assistant state payloads with excerpt fields', async () => {
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-state-migrate-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-state-provider-hard-cut-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-alias-hard-cut-')

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(statePaths.sessionsDirectory, {
    recursive: true,
  })
  await writeFile(
    path.join(statePaths.sessionsDirectory, 'asst_existing.json'),
    `${JSON.stringify(
      {
        schema: 'murph.assistant-session.v4',
        sessionId: 'asst_existing',
        target: {
          adapter: 'codex-cli',
          approvalPolicy: 'on-request',
          codexCommand: null,
          model: null,
          oss: false,
          profile: null,
          reasoningEffort: null,
          sandbox: 'workspace-write',
        },
        resumeState: null,
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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-automation-hard-cut-')

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(statePaths.sessionsDirectory, {
    recursive: true,
  })
  await writeFile(
    statePaths.automationStatePath,
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
  const { parentRoot } = await createAssistantStateVault('murph-assistant-redact-')
  const homeRoot = path.join(parentRoot, 'home')
  const nestedPath = path.join(homeRoot, 'vault', 'sessions')
  const outsidePath = path.join(parentRoot, 'outside')
  await mkdir(nestedPath, {
    recursive: true,
  })
  await mkdir(outsidePath, {
    recursive: true,
  })

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

test('assistant session schema rejects path-like session identifiers before persistence', () => {
  const valid = {
    schema: 'murph.assistant-session.v4',
    sessionId: 'session_safe_123',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: null,
      codexCommand: null,
      model: null,
      oss: false,
      profile: null,
      reasoningEffort: null,
      sandbox: null,
    },
    resumeState: null,
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
        resumeState: undefined,
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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-storage-ids-')

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
  await expectInvalidRuntimeId(() => readAssistantOutboxIntent(vaultRoot, invalidId))
  await expectInvalidRuntimeId(() => readAssistantTurnReceipt(vaultRoot, invalidId))
  await expectInvalidRuntimeId(() => readAssistantCronRuns(paths, invalidId))
})

test('assistant runtime budget snapshots are quarantined, recreated, and fully pruned with orphan payload cleanup', async () => {
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-runtime-budget-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-status-runtime-budget-')

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
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-session-secrets-')

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'assistant:secret-session',
    channel: 'imessage',
    participantId: 'contact:secret-user',
  })
  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const target = createAssistantBackendTarget({
    provider: 'openai-compatible',
    model: 'gpt-4.1-mini',
    reasoningEffort: null,
    baseUrl: 'https://api.example.test/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'example',
    headers: {
      Authorization: 'Bearer session-secret-token',
      'X-Visible': 'public-header',
    },
  })
  assert.ok(target)
  const updatedSession = await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    target,
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
    target?: {
      headers?: Record<string, string> | null
    } | null
    resumeState?: {
      providerSessionId?: string | null
    } | null
  }
  const secretSidecar = JSON.parse(
    await readFile(sessionSecretsPath, 'utf8'),
  ) as {
    providerBindingHeaders?: Record<string, string> | null
    providerHeaders?: Record<string, string> | null
  }

  assert.deepEqual(persisted.target?.headers, {
    'X-Visible': 'public-header',
  })
  assert.equal(persisted.resumeState?.providerSessionId, 'provider-session-1')
  assert.equal(/session-secret-token|binding-secret-token/u.test(persistedRaw), false)
  assert.deepEqual(secretSidecar.providerHeaders, {
    Authorization: 'Bearer session-secret-token',
  })
  assert.equal(secretSidecar.providerBindingHeaders ?? null, null)

  const reloaded = await readAssistantSession({
    paths: statePaths,
    sessionId: updatedSession.sessionId,
  })
  assert.equal(
    reloaded?.providerOptions.headers?.Authorization,
    'Bearer session-secret-token',
  )

  const redacted = redactAssistantSessionForDisplay(reloaded!)
  assert.equal(redacted.providerOptions.headers?.Authorization, '[REDACTED]')
  assert.equal(redacted.providerOptions.headers?.['X-Visible'], 'public-header')

  assert.equal((await stat(statePaths.assistantStateRoot)).mode & 0o777, 0o700)
  assert.equal((await stat(statePaths.sessionsDirectory)).mode & 0o777, 0o700)
  assert.equal((await stat(statePaths.sessionSecretsDirectory)).mode & 0o777, 0o700)
  assert.equal((await stat(sessionPath)).mode & 0o777, 0o600)
  assert.equal((await stat(sessionSecretsPath)).mode & 0o777, 0o600)
})

test('malformed session secret sidecars are quarantined instead of being treated as cleanly missing', async () => {
  const { vaultRoot } = await createAssistantStateVault('murph-assistant-sidecar-corruption-')

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
