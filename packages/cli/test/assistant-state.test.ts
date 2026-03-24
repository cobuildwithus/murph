import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
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
} from '../src/assistant-state.js'
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
} from '../src/assistant/memory.js'
import { withAssistantMemoryWriteLock } from '../src/assistant/memory/locking.js'

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

test('assistant sessions live outside the vault, omit redundant path metadata, and reuse alias mappings', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-state-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-session-id-precedence-'))
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

test('resolveAssistantSession prefers alias matches over conversation-key matches', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-alias-precedence-'))
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

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:alias',
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:conversation',
    sourceThreadId: 'thread-conversation',
    createIfMissing: false,
  })

  assert.equal(resolved.created, false)
  assert.equal(resolved.session.sessionId, aliasMatch.session.sessionId)
  assert.equal(resolved.session.alias, 'chat:alias')
  assert.equal(resolved.session.binding.actorId, 'contact:conversation')
  assert.equal(resolved.session.binding.threadId, 'thread-conversation')

  const persisted = await getAssistantSession(vaultRoot, aliasMatch.session.sessionId)
  assert.equal(persisted.alias, 'chat:alias')
  assert.equal(persisted.binding.threadId, 'thread-conversation')
})

test('resolveAssistantSession rotates conversation-key sessions after the max age threshold', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-session-rotate-'))
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

test('assistant memory write locks allow nested reentry while serializing concurrent same-root callers', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-lock-'))
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

test('assistant transcripts are stored separately from session metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-transcript-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-missing-session-'))
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

test('getAssistantSession rejects non-canonical assistant state payloads with legacy excerpt fields', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-state-migrate-'))
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
        schema: 'healthybob.assistant-session.v2',
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

test('resolveAssistantSession ignores legacy aliases.json fallback state', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-alias-hard-cut-'))
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
        schema: 'healthybob.assistant-session.v2',
        sessionId: 'asst_existing',
        provider: 'codex-cli',
        providerSessionId: null,
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
          profile: null,
          oss: false,
        },
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

test('readAssistantAutomationState rejects legacy automation v1 payloads', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-automation-hard-cut-'))
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

  await assert.rejects(() => readAssistantAutomationState(vaultRoot))
})

test('redactAssistantDisplayPath hides HOME-prefixed paths and leaves external paths untouched', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-redact-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-'))
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
  assert.match(longTermMemory, /healthybob-assistant-memory:/u)
  assert.match(dailyMemory, /healthybob-assistant-memory:/u)
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-turn-context-'))
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

test('upsertAssistantMemory replaces mutable long-term identity and response-style memory', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-upsert-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-search-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-core-prompt-'))
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

test('upsertAssistantMemory requires explicit remember intent for health context', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-health-policy-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  await assert.rejects(
    upsertAssistantMemory({
      vault: vaultRoot,
      text: 'User has diabetes.',
      scope: 'long-term',
      section: 'Health context',
    }),
    /explicit remember request/u,
  )
})
