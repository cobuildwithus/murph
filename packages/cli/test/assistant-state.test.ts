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
  redactAssistantDisplayPath,
  resolveAssistantAliasKey,
  resolveAssistantSession,
  resolveAssistantStatePaths,
  saveAssistantSession,
} from '../src/assistant-state.js'
import {
  recordAssistantMemoryTurn,
  resolveAssistantDailyMemoryPath,
} from '../src/assistant/memory.js'

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

test('getAssistantSession migrates legacy excerpt fields out of persisted assistant state', async () => {
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

  const migrated = await getAssistantSession(vaultRoot, sessionId)
  assert.equal(migrated.sessionId, sessionId)
  assert.equal(migrated.providerSessionId, 'thread-legacy')
  assert.equal(migrated.turnCount, 2)
  assert.equal('lastUserMessage' in migrated, false)
  assert.equal('lastAssistantMessage' in migrated, false)

  const rewritten = JSON.parse(
    await readFile(
      path.join(statePaths.sessionsDirectory, `${sessionId}.json`),
      'utf8',
    ),
  ) as Record<string, unknown>
  assert.equal('lastUserMessage' in rewritten, false)
  assert.equal('lastAssistantMessage' in rewritten, false)

  const transcript = await listAssistantTranscriptEntries(vaultRoot, sessionId)
  assert.deepEqual(
    transcript.map((entry) => ({
      kind: entry.kind,
      text: entry.text,
    })),
    [
      {
        kind: 'user',
        text: 'sensitive prompt excerpt',
      },
      {
        kind: 'assistant',
        text: 'sensitive response excerpt',
      },
    ],
  )
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

test('recordAssistantMemoryTurn writes vault-scoped Markdown memory without using the canonical vault', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const now = new Date('2026-03-17T09:15:00.000Z')
  const result = await recordAssistantMemoryTurn({
    vault: vaultRoot,
    now,
    prompt: 'Call me Chris. Going forward, keep answers concise. We are working on the assistant memory implementation.',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const dailyPath = resolveAssistantDailyMemoryPath(statePaths, now)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const dailyMemory = await readFile(dailyPath, 'utf8')

  assert.equal(result.longTermAdded, 2)
  assert.equal(result.dailyAdded, 3)
  assert.match(longTermMemory, /Call the user Chris\./u)
  assert.match(longTermMemory, /keep answers concise\./iu)
  assert.match(dailyMemory, /assistant memory implementation\./iu)
  assert.equal(longTermMemory.includes(vaultRoot), false)
  assert.equal(dailyMemory.includes(vaultRoot), false)
})

test('recordAssistantMemoryTurn can persist selected health context into out-of-vault memory', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-health-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const now = new Date('2026-03-17T10:30:00.000Z')
  const result = await recordAssistantMemoryTurn({
    vault: vaultRoot,
    now,
    prompt: 'Remember that my blood pressure is 120 over 80.',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const dailyPath = resolveAssistantDailyMemoryPath(statePaths, now)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const dailyMemory = await readFile(dailyPath, 'utf8')

  assert.equal(result.longTermAdded, 1)
  assert.equal(result.dailyAdded, 1)
  assert.match(longTermMemory, /## Health context/u)
  assert.match(longTermMemory, /User's blood pressure is 120 over 80\./u)
  assert.match(dailyMemory, /User's blood pressure is 120 over 80\./u)
})
