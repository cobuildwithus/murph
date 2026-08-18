import { createHash } from 'node:crypto'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import {
  parseAssistantSessionRecord,
  type AssistantSession,
  type AssistantTranscriptEntry,
} from '@murphai/operator-config/assistant-cli-contracts'
import { openSqliteRuntimeDatabase } from '@murphai/runtime-state/node'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listAssistantQuarantineEntriesAtPaths,
  quarantineAssistantStateFile,
} from '../src/assistant/quarantine.ts'
import { listAssistantRuntimeEventsAtPath } from '../src/assistant/runtime-events.ts'
import {
  appendAssistantTranscriptEntriesWithRefs,
  listAssistantSessions,
  listAssistantSessionsLocal,
  updateAssistantAutomationState,
} from '../src/assistant/store.ts'
import {
  appendTranscriptEntries,
  ensureAssistantState,
  inspectAssistantSessionStorage,
  isAssistantSessionExpired,
  loadAndPersistResolvedSession,
  pruneAssistantTranscriptRetention,
  readAssistantRecentSessionIds,
  readAssistantSession,
  readAssistantSessionRouting,
  readAssistantTranscriptEntries,
  readAutomationState,
  replaceTranscriptEntries,
  resolveAssistantSessionPath,
  resolveAssistantSessionRoutingDatabasePath,
  resolveAssistantTranscriptPath,
  synchronizeAssistantIndexes,
  writeAssistantSession,
  writeAutomationState,
} from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { resolveAssistantSessionSecretsPath } from '../src/assistant/state-secrets.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.doUnmock('../src/assistant/quarantine.js')
  vi.doUnmock('../src/assistant/shared.ts')
  vi.resetModules()
  vi.restoreAllMocks()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant store persistence seams', () => {
  it('creates assistant state directories, persists Codex sessions, and appends or replaces transcripts', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-roundtrip-')
    const session = createSession()
    const transcriptPath = resolveAssistantTranscriptPath(paths, session.sessionId)
    const sessionPath = resolveAssistantSessionPath(paths, session.sessionId)
    const secretsPath = resolveAssistantSessionSecretsPath(paths, session.sessionId)

    await ensureAssistantState(paths)
    await assertDirectoryExists(paths.assistantStateRoot)
    await assertDirectoryExists(paths.sessionsDirectory)
    await assertDirectoryExists(paths.transcriptsDirectory)
    await assertDirectoryExists(paths.outboxDirectory)
    await assertDirectoryExists(paths.outboxQuarantineDirectory)
    await assertDirectoryExists(paths.turnsDirectory)
    await assertDirectoryExists(paths.diagnosticsDirectory)
    await assertDirectoryExists(paths.journalsDirectory)
    await assertDirectoryExists(paths.quarantineDirectory)
    await assertDirectoryExists(paths.stateDirectory)
    await assertDirectoryExists(paths.secretsDirectory)
    await assertDirectoryExists(paths.sessionSecretsDirectory)

    await expect(
      inspectAssistantSessionStorage({
        paths,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual({
      sessionExists: false,
      sessionPath,
      transcriptExists: false,
      transcriptPath,
    })

    await writeAssistantSession(paths, session)

    await expect(
      inspectAssistantSessionStorage({
        paths,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual({
      sessionExists: true,
      sessionPath,
      transcriptExists: false,
      transcriptPath,
    })

    expect(JSON.parse(await readFile(sessionPath, 'utf8'))).toMatchObject({
      alias: 'alpha',
      binding: {
        conversationKey: 'telegram:user-1:thread-1',
      },
      codexTarget: {
        adapter: 'codex-cli',
        modelProvider: 'vercel-ai-gateway',
      },
    })
    await expect(readFile(secretsPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const roundTrippedSession = await readAssistantSession({
      paths,
      sessionId: session.sessionId,
    })
    expect(roundTrippedSession).not.toBeNull()
    if (!roundTrippedSession) {
      throw new Error('Expected round-tripped assistant session.')
    }
    expect(roundTrippedSession).toMatchObject({
      alias: session.alias,
      binding: session.binding,
      createdAt: session.createdAt,
      lastTurnAt: session.lastTurnAt,
      provider: session.provider,
      resumeState: null,
      schema: 'murph.assistant-conversation.v2',
      sessionId: session.sessionId,
      target: session.target,
      turnCount: session.turnCount,
      updatedAt: session.updatedAt,
    })
    expect(roundTrippedSession.providerOptions).toMatchObject({
      executionDriver: 'codex-app-server',
      model: 'gpt-5.6-terra',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
      reasoningEffort: 'medium',
      resumeKind: 'codex-thread',
    })
    expect(roundTrippedSession.providerOptions.continuityFingerprint).toEqual(
      expect.any(String),
    )

    const initialEntries = [
      createTranscriptEntry('user', 'first question', '2026-04-08T00:01:00.000Z'),
      createTranscriptEntry('assistant', 'first answer', '2026-04-08T00:02:00.000Z'),
    ]
    await appendTranscriptEntries(paths, session.sessionId, initialEntries)
    expect(await readFile(transcriptPath, 'utf8')).toBe(
      `${initialEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    )
    await expect(readAssistantTranscriptEntries(paths, session.sessionId)).resolves.toEqual(
      initialEntries,
    )

    const replacementEntries = [
      createTranscriptEntry('assistant', 'replacement answer', '2026-04-08T00:03:00.000Z'),
    ]
    await replaceTranscriptEntries(paths, session.sessionId, replacementEntries)
    expect(await readFile(transcriptPath, 'utf8')).toBe(
      `${JSON.stringify(replacementEntries[0])}\n`,
    )
    await expect(readAssistantTranscriptEntries(paths, session.sessionId)).resolves.toEqual(
      replacementEntries,
    )

    await replaceTranscriptEntries(paths, session.sessionId, [])
    expect(await readFile(transcriptPath, 'utf8')).toBe('')
    await expect(readAssistantTranscriptEntries(paths, session.sessionId)).resolves.toEqual([])
    await expect(
      inspectAssistantSessionStorage({
        paths,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual({
      sessionExists: true,
      sessionPath,
      transcriptExists: true,
      transcriptPath,
    })

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)
    expect(runtimeEvents).toContainEqual(
      expect.objectContaining({
        component: 'state',
        entityId: session.sessionId,
        entityType: 'session',
        kind: 'session.upserted',
        level: 'info',
      }),
    )
  })

  it('returns durable transcript entry refs from the locked append helper', async () => {
    const context = await createTempVaultContext(
      'assistant-store-persistence-transcript-refs-',
    )
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    const session = createSession({
      sessionId: 'session-transcript-refs',
    })
    await ensureAssistantState(paths)
    await writeAssistantSession(paths, session)
    await appendTranscriptEntries(paths, session.sessionId, [
      createTranscriptEntry(
        'user',
        'first prompt',
        '2026-04-08T00:01:00.000Z',
      ),
    ])

    const appended = await appendAssistantTranscriptEntriesWithRefs(
      context.vaultRoot,
      session.sessionId,
      [
        {
          createdAt: '2026-04-08T00:02:00.000Z',
          kind: 'user',
          text: 'late follow up',
        },
        {
          createdAt: '2026-04-08T00:03:00.000Z',
          kind: 'assistant',
          text: 'draft answer',
        },
      ],
    )

    expect(appended.refs).toEqual([
      {
        entryCreatedAt: '2026-04-08T00:02:00.000Z',
        entryIndex: 1,
        entryKind: 'user',
        sessionId: session.sessionId,
      },
      {
        entryCreatedAt: '2026-04-08T00:03:00.000Z',
        entryIndex: 2,
        entryKind: 'assistant',
        sessionId: session.sessionId,
      },
    ])
    await expect(
      readAssistantTranscriptEntries(paths, session.sessionId),
    ).resolves.toEqual([
      createTranscriptEntry(
        'user',
        'first prompt',
        '2026-04-08T00:01:00.000Z',
      ),
      {
        contentReceivedAt: '2026-04-08T00:02:00.000Z',
        createdAt: '2026-04-08T00:02:00.000Z',
        kind: 'user',
        schema: 'murph.assistant-transcript-entry.v1',
        text: 'late follow up',
      },
      {
        createdAt: '2026-04-08T00:03:00.000Z',
        kind: 'assistant',
        schema: 'murph.assistant-transcript-entry.v1',
        text: 'draft answer',
      },
    ])
  })

  it('treats expired sessions according to last-turn precedence and ignores disabled age limits', () => {
    const session = createSession({
      createdAt: '2026-04-08T00:00:00.000Z',
      lastTurnAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:10:00.000Z',
    })

    expect(
      isAssistantSessionExpired(
        session,
        10 * 60 * 1000,
        new Date('2026-04-08T00:10:00.000Z'),
      ),
    ).toBe(true)
    expect(
      isAssistantSessionExpired(
        session,
        10 * 60 * 1000,
        new Date('2026-04-08T00:09:59.000Z'),
      ),
    ).toBe(false)
    expect(isAssistantSessionExpired(session, 0, new Date('2026-04-08T01:00:00.000Z'))).toBe(
      false,
    )
    expect(
      isAssistantSessionExpired(session, null, new Date('2026-04-08T01:00:00.000Z')),
    ).toBe(false)
  })

  it('leaves a stale legacy secret sidecar committed when a Codex session write fails', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-sidecar-stage-')
    const session = createSession({
      sessionId: 'session-sidecar-stage',
      updatedAt: '2026-04-08T00:05:00.000Z',
    })
    await writeAssistantSession(paths, session)
    const sessionPath = resolveAssistantSessionPath(paths, session.sessionId)
    const secretsPath = resolveAssistantSessionSecretsPath(paths, session.sessionId)
    await mkdir(path.dirname(secretsPath), {
      recursive: true,
    })
    await writeFile(
      secretsPath,
      JSON.stringify({
        schema: 'murph.assistant-session-secrets.v1',
        sessionId: session.sessionId,
        updatedAt: '2026-04-08T00:04:00.000Z',
        providerHeaders: {
          Authorization: 'Bearer stale-secret-token',
        },
      }),
      'utf8',
    )
    const originalSidecar = await readFile(secretsPath, 'utf8')

    vi.resetModules()
    vi.doMock('../src/assistant/shared.ts', async () => {
      const actual =
        await vi.importActual<typeof import('../src/assistant/shared.ts')>(
          '../src/assistant/shared.ts',
        )
      return {
        ...actual,
        writeJsonFileAtomic: vi.fn(async (filePath: string, value: unknown) => {
          if (filePath === sessionPath) {
            throw new Error('injected session write failure')
          }
          await actual.writeJsonFileAtomic(filePath, value)
        }),
      }
    })
    const { writeAssistantSession: writeAssistantSessionWithFailure } =
      await import('../src/assistant/store/persistence.ts')
    const rotatedSession = createSession({
      sessionId: session.sessionId,
      updatedAt: '2026-04-08T00:06:00.000Z',
    })

    await expect(
      writeAssistantSessionWithFailure(paths, rotatedSession),
    ).rejects.toThrow('injected session write failure')

    await expect(readFile(secretsPath, 'utf8')).resolves.toBe(originalSidecar)
  })

  it('ignores stale leftover secret sidecars for Codex sessions', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-codex-sidecar-')
    const session = createCodexSession({
      sessionId: 'session-codex-leftover-sidecar',
      updatedAt: '2026-04-08T00:10:00.000Z',
    })
    const secretsPath = resolveAssistantSessionSecretsPath(paths, session.sessionId)
    await ensureAssistantState(paths)
    await writeAssistantSession(paths, session)
    await writeFile(
      secretsPath,
      JSON.stringify({
        schema: 'murph.assistant-session-secrets.v1',
        sessionId: session.sessionId,
        updatedAt: '2026-04-08T00:05:00.000Z',
        providerHeaders: {
          Authorization: 'Bearer stale-secret-token',
        },
      }),
      'utf8',
    )

    await expect(
      readAssistantSession({
        paths,
        sessionId: session.sessionId,
      }),
    ).resolves.toMatchObject({
      sessionId: session.sessionId,
      target: {
        adapter: 'codex-cli',
      },
      updatedAt: session.updatedAt,
    })
    await expect(readFile(secretsPath, 'utf8')).resolves.toContain(
      'stale-secret-token',
    )
  })

  it('trims persisted transcripts down to the replay window while preserving trailing non-conversation entries', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-transcript-retention-')
    const session = createSession({
      sessionId: 'session-transcript-retention',
    })
    const transcriptEntries: AssistantTranscriptEntry[] = [
      createTranscriptEntry('error', 'old error', '2026-04-08T00:00:00.000Z'),
      ...Array.from({
        length: 105,
      }, (_, index) => {
        const kind = index % 2 === 0 ? 'user' : 'assistant'
        const createdAt =
          new Date(Date.UTC(2026, 3, 8, 0, index + 1, 0)).toISOString()
        const entry = createTranscriptEntry(
          kind,
          `entry-${index}`,
          createdAt,
        )
        return kind === 'user'
          ? { ...entry, contentReceivedAt: createdAt }
          : entry
      }),
      createTranscriptEntry('error', 'recent error', '2026-04-08T03:00:00.000Z'),
    ]

    await replaceTranscriptEntries(paths, session.sessionId, transcriptEntries)

    // Pin `now` inside the content-retention window so this case stays about
    // trimming; expiry of old inbound text is covered separately.
    await expect(pruneAssistantTranscriptRetention(paths, {
      now: new Date('2026-04-08T04:00:00.000Z'),
    })).resolves.toEqual({
      entriesRedacted: 0,
      entriesTrimmed: 6,
      nextEligibleAt: '2026-04-22T00:07:00.000Z',
      transcriptsTrimmed: 1,
    })

    const retained = await readAssistantTranscriptEntries(paths, session.sessionId)
    expect(retained).toHaveLength(101)
    expect(retained[0]).toMatchObject({
      kind: 'assistant',
      text: 'entry-5',
    })
    expect(retained.some((entry) => entry.text === 'old error')).toBe(false)
    expect(retained.at(-1)).toMatchObject({
      kind: 'error',
      text: 'recent error',
    })
  })

  it('preserves an abort reason before transcript retention scans files', async () => {
    const paths = await createAssistantPaths(
      'assistant-store-persistence-transcript-retention-abort-',
    )
    const controller = new AbortController()
    const reason = new Error('foreground work interrupted transcript retention')
    controller.abort(reason)

    await expect(pruneAssistantTranscriptRetention(paths, {
      signal: controller.signal,
    })).rejects.toBe(reason)
  })

  it('preserves unstamped legacy inbound text until the phase-two cutover', async () => {
    const paths = await createAssistantPaths(
      'assistant-store-persistence-transcript-legacy-phase-one-',
    )
    const sessionId = 'session-transcript-legacy-phase-one'
    const legacyEntries = [
      createTranscriptEntry(
        'user',
        'recent legacy input remains paired with its answer',
        '2026-07-24T00:00:00.000Z',
      ),
      createTranscriptEntry(
        'assistant',
        'assistant output remains available',
        '2026-07-24T00:01:00.000Z',
      ),
    ]
    await replaceTranscriptEntries(paths, sessionId, legacyEntries)

    const now = new Date('2026-07-25T00:00:00.000Z')
    await expect(pruneAssistantTranscriptRetention(paths, { now }))
      .resolves.toEqual({
        entriesRedacted: 0,
        entriesTrimmed: 0,
        nextEligibleAt: null,
        transcriptsTrimmed: 0,
      })
    await expect(readAssistantTranscriptEntries(paths, sessionId))
      .resolves.toEqual(legacyEntries)
  })

  it('initializes and synchronizes the transactional session routing projection', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-indexes-')
    await ensureAssistantState(paths)

    const initial = await readAssistantSessionRouting(paths, {
      alias: 'missing-alias',
      conversationKeys: ['missing-conversation'],
    })
    expect(initial.aliasSessionId).toBeNull()
    expect([...initial.conversationKeySessionIds]).toEqual([])
    await expect(access(paths.indexesPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
    await expect(access(databasePath)).resolves.toBeUndefined()
    expect((await stat(databasePath)).mode & 0o777).toBe(0o600)

    const previous = createSession({
      alias: 'alpha',
      conversationKey: 'telegram:user-1:thread-1',
      sessionId: 'session-index-shared',
      threadId: 'thread-1',
      updatedAt: '2026-04-08T00:05:00.000Z',
    })
    const current = createSession({
      alias: 'beta',
      conversationKey: 'telegram:user-1:thread-2',
      sessionId: 'session-index-shared',
      threadId: 'thread-2',
      updatedAt: '2026-04-08T00:06:00.000Z',
    })

    await synchronizeAssistantIndexes(paths, previous, null)
    await synchronizeAssistantIndexes(paths, current, previous)

    const routing = await readAssistantSessionRouting(paths, {
      alias: 'beta',
      conversationKeys: [
        'telegram:user-1:thread-1',
        'telegram:user-1:thread-2',
      ],
    })
    expect(routing.aliasSessionId).toBe('session-index-shared')
    expect([...routing.conversationKeySessionIds]).toEqual([
      ['telegram:user-1:thread-2', 'session-index-shared'],
    ])
    await expect(readAssistantSessionRouting(paths, {
      alias: 'alpha',
      conversationKeys: [],
    })).resolves.toMatchObject({ aliasSessionId: null })
    await expect(readAssistantRecentSessionIds(paths, { limit: 50 }))
      .resolves.toEqual(['session-index-shared'])
    await expect(access(paths.indexesPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('updates one route without deleting a foreign-owned route', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-indexes-fresh-')
    await ensureAssistantState(paths)
    await readAssistantSessionRouting(paths, {
      alias: null,
      conversationKeys: [],
    })

    const external = createSession({
      alias: 'external',
      conversationKey: null,
      sessionId: 'session-external',
      updatedAt: '2026-04-08T00:05:00.000Z',
    })
    await synchronizeAssistantIndexes(paths, external, null)

    const current = createSession({
      alias: 'local',
      conversationKey: null,
      sessionId: 'session-local',
      updatedAt: '2026-04-08T00:07:00.000Z',
    })
    const previous = createSession({
      alias: 'external',
      conversationKey: null,
      sessionId: current.sessionId,
      updatedAt: '2026-04-08T00:06:00.000Z',
    })
    await synchronizeAssistantIndexes(paths, current, previous)

    await expect(readAssistantSessionRouting(paths, {
      alias: 'external',
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: 'session-external',
    })
    await expect(readAssistantSessionRouting(paths, {
      alias: 'local',
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: 'session-local',
    })
    await expect(access(paths.indexesPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects stale exact routes before they can rebind a canonical session', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-index-stale-')
    await ensureAssistantState(paths)
    const staleSession = createSession({
      alias: 'stale-alias',
      conversationKey: 'telegram:user-1:thread-stale',
      sessionId: 'session-current',
      threadId: 'thread-stale',
    })
    const session = createSession({
      alias: 'current-alias',
      conversationKey: 'telegram:user-1:thread-current',
      sessionId: 'session-current',
      threadId: 'thread-current',
    })
    await writeAssistantSession(paths, staleSession)
    await synchronizeAssistantIndexes(paths, staleSession, null)
    // Simulate an interrupted session/index pair: the canonical session write
    // landed, but the derived routing transaction did not.
    await writeAssistantSession(paths, session)
    const stale = await readAssistantSessionRouting(paths, {
      alias: 'stale-alias',
      conversationKeys: ['telegram:user-1:thread-stale'],
    })

    const staleAliasSessionId = stale.aliasSessionId
    const staleConversationSessionId = stale.conversationKeySessionIds.get(
      'telegram:user-1:thread-stale',
    )
    expect(staleAliasSessionId).toBe(session.sessionId)
    expect(staleConversationSessionId).toBe(session.sessionId)
    if (!staleAliasSessionId || !staleConversationSessionId) {
      throw new Error('Expected stale routing records to resolve a session id.')
    }

    await expect(loadAndPersistResolvedSession({
      expectedAlias: 'stale-alias',
      paths,
      sessionId: staleAliasSessionId,
      persistenceInput: {
        alias: 'stale-alias',
        bindingPatch: {},
        lookupSource: 'alias',
      },
    })).resolves.toBeNull()
    await expect(loadAndPersistResolvedSession({
      expectedConversationKey: 'telegram:user-1:thread-stale',
      paths,
      sessionId: staleConversationSessionId,
      persistenceInput: {
        alias: null,
        bindingPatch: {
          actorId: 'stale-actor',
        },
        lookupSource: 'conversation-key',
      },
    })).resolves.toBeNull()
    await expect(readAssistantSession({
      paths,
      sessionId: session.sessionId,
    })).resolves.toMatchObject({
      alias: 'current-alias',
      binding: {
        actorId: null,
        conversationKey: 'telegram:user-1:thread-current',
      },
    })
  })

  it('rebuilds corrupted index metadata from durable sessions and skips corrupted sessions as missing', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-index-rebuild-')
    await ensureAssistantState(paths)

    const goodSession = createSession({
      alias: 'good-alias',
      conversationKey: 'telegram:user-1:thread-good',
      sessionId: 'session-good',
      threadId: 'thread-good',
    })
    await writeAssistantSession(paths, goodSession)

    const corruptedSessionId = 'session-corrupted'
    await writeFile(resolveAssistantSessionPath(paths, corruptedSessionId), '{bad-json', 'utf8')
    await writeFile(paths.indexesPath, '{bad-indexes', 'utf8')

    const rebuilt = await readAssistantSessionRouting(paths, {
      alias: 'good-alias',
      conversationKeys: ['telegram:user-1:thread-good'],
    })
    expect(rebuilt.aliasSessionId).toBe('session-good')
    expect(rebuilt.conversationKeySessionIds.get(
      'telegram:user-1:thread-good',
    )).toBe('session-good')
    await expect(access(paths.indexesPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const quarantines = await listAssistantQuarantineEntriesAtPaths(paths)
    expect(quarantines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: 'session',
          originalPath: resolveAssistantSessionPath(paths, corruptedSessionId),
        }),
      ]),
    )

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)
    expect(runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'indexes.rebuilt',
        }),
        expect.objectContaining({
          kind: 'session.quarantined',
        }),
      ]),
    )
  })

  it('quarantines and atomically rebuilds an incomplete routing database', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-route-rebuild-')
    await ensureAssistantState(paths)
    await readAssistantSessionRouting(paths, {
      alias: null,
      conversationKeys: [],
    })
    const session = createSession({
      alias: 'repair-alias',
      conversationKey: 'telegram:user-1:thread-repair',
      sessionId: 'session-repair',
      threadId: 'thread-repair',
    })
    await writeAssistantSession(paths, session)
    await synchronizeAssistantIndexes(paths, session, null)

    const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
    await writeFile(databasePath, 'not-a-complete-sqlite-projection', 'utf8')

    await expect(readAssistantSessionRouting(paths, {
      alias: 'repair-alias',
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: 'session-repair',
    })
    expect(await listAssistantQuarantineEntriesAtPaths(paths)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: 'indexes',
          originalPath: databasePath,
        }),
      ]),
    )
    expect(await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'indexes.rebuilt' }),
        expect.objectContaining({ kind: 'indexes.quarantined' }),
      ]),
    )
  })

  it('preserves exact route winners after a non-corruption synchronization failure', async () => {
    const paths = await createAssistantPaths(
      'assistant-store-persistence-route-write-failure-',
    )
    await ensureAssistantState(paths)
    const selected = createSession({
      alias: 'work',
      conversationKey: 'telegram:user-1:thread-shared',
      lastTurnAt: '2026-04-08T00:01:00.000Z',
      sessionId: 'session-selected',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:05:00.000Z',
    })
    const timestampWinner = createSession({
      alias: 'work',
      conversationKey: 'telegram:user-1:thread-shared',
      lastTurnAt: '2026-04-08T00:04:00.000Z',
      sessionId: 'session-timestamp-winner',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:04:00.000Z',
    })
    await writeAssistantSession(paths, selected)
    await writeAssistantSession(paths, timestampWinner)
    await writeFile(paths.indexesPath, JSON.stringify({
      version: 1,
      aliases: { work: selected.sessionId },
      conversationKeys: {
        'telegram:user-1:thread-shared': selected.sessionId,
      },
      recentSessions: {
        [selected.sessionId]: selected.updatedAt,
        [timestampWinner.sessionId]: timestampWinner.updatedAt,
      },
    }), 'utf8')
    await readAssistantSessionRouting(paths, {
      alias: 'work',
      conversationKeys: ['telegram:user-1:thread-shared'],
    })

    const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
    const database = openSqliteRuntimeDatabase(databasePath, {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    })
    database.exec(`
      CREATE TRIGGER reject_unrelated_route
      BEFORE INSERT ON assistant_session_routes
      WHEN NEW.session_id = 'session-unrelated'
      BEGIN
        SELECT RAISE(ABORT, 'injected non-corruption write failure');
      END;
    `)
    database.close()

    const unrelated = createSession({
      alias: 'unrelated',
      conversationKey: 'telegram:user-1:thread-unrelated',
      sessionId: 'session-unrelated',
      threadId: 'thread-unrelated',
    })
    await writeAssistantSession(paths, unrelated)
    await expect(
      synchronizeAssistantIndexes(paths, unrelated, null),
    ).rejects.toThrow('injected non-corruption write failure')

    await expect(access(databasePath)).resolves.toBeUndefined()
    await expect(listAssistantQuarantineEntriesAtPaths(paths)).resolves.toEqual([])
    const preserved = await readAssistantSessionRouting(paths, {
      alias: 'work',
      conversationKeys: ['telegram:user-1:thread-shared'],
    })
    expect(preserved.aliasSessionId).toBe(selected.sessionId)
    expect(preserved.conversationKeySessionIds.get(
      'telegram:user-1:thread-shared',
    )).toBe(selected.sessionId)
  })

  it('propagates a transient open failure without quarantining or rebuilding', async () => {
    const paths = await createAssistantPaths(
      'assistant-store-persistence-route-open-failure-',
    )
    await ensureAssistantState(paths)
    const session = createSession({
      alias: 'preserved',
      conversationKey: 'telegram:user-1:thread-preserved',
      sessionId: 'session-preserved',
      threadId: 'thread-preserved',
    })
    await writeAssistantSession(paths, session)
    await synchronizeAssistantIndexes(paths, session, null)

    const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
    await chmod(databasePath, 0o000)
    try {
      await expect(readAssistantSessionRouting(paths, {
        alias: 'preserved',
        conversationKeys: [],
      })).rejects.toMatchObject({
        code: 'ERR_SQLITE_ERROR',
        errcode: 14,
      })
    } finally {
      await chmod(databasePath, 0o600)
    }

    await expect(listAssistantQuarantineEntriesAtPaths(paths)).resolves.toEqual([])
    await expect(readAssistantSessionRouting(paths, {
      alias: 'preserved',
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: session.sessionId,
    })
  })

  it('quarantines operation-time corruption once and rebuilds on the next lookup', async () => {
    const paths = await createAssistantPaths(
      'assistant-store-persistence-route-operation-corruption-',
    )
    await ensureAssistantState(paths)
    await readAssistantSessionRouting(paths, {
      alias: null,
      conversationKeys: [],
    })

    const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
    const database = openSqliteRuntimeDatabase(databasePath, {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    })
    const insertRoute = database.prepare(`
      INSERT INTO assistant_session_routes (kind, key_digest, session_id)
      VALUES (?, ?, ?)
    `)
    const aliasesByDigest = new Map<string, string>()
    database.exec('BEGIN IMMEDIATE TRANSACTION;')
    for (let index = 0; index < 512; index += 1) {
      const alias = `operation-corruption-${String(index).padStart(4, '0')}`
      const keyDigest = createHash('sha256')
        .update('alias')
        .update('\0')
        .update(alias)
        .digest('hex')
      aliasesByDigest.set(keyDigest, alias)
      insertRoute.run('alias', keyDigest, `bulk-session-${index}`)
    }
    database.exec('COMMIT;')
    const target = database.prepare(`
      SELECT key_digest AS keyDigest, session_id AS sessionId
      FROM assistant_session_routes
      WHERE kind = 'alias'
      ORDER BY key_digest DESC
      LIMIT 1
    `).get() as { keyDigest: string; sessionId: string }
    database.close()

    const targetAlias = aliasesByDigest.get(target.keyDigest)
    if (!targetAlias) {
      throw new Error('Expected the damaged routing leaf to contain a known alias.')
    }
    await writeAssistantSession(paths, createSession({
      alias: targetAlias,
      sessionId: target.sessionId,
    }))

    await corruptRightmostAssistantRouteIndexLeaf(databasePath)

    const probe = openSqliteRuntimeDatabase(databasePath, {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    })
    expect(probe.prepare('PRAGMA user_version;').get()).toEqual({
      user_version: 1,
    })
    expect(probe.prepare(`
      SELECT kind, key_digest, session_id
      FROM assistant_session_routes
      LIMIT 0
    `).all()).toEqual([])
    expect(probe.prepare(`
      SELECT session_id, last_active_at_ms
      FROM assistant_recent_sessions
      LIMIT 0
    `).all()).toEqual([])
    probe.close()

    await expect(readAssistantSessionRouting(paths, {
      alias: targetAlias,
      conversationKeys: [],
    })).rejects.toMatchObject({
      code: 'ERR_SQLITE_ERROR',
      errcode: 11,
    })
    await expect(access(databasePath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect((await listAssistantQuarantineEntriesAtPaths(paths)).filter((entry) =>
      entry.artifactKind === 'indexes' && entry.originalPath === databasePath,
    )).toHaveLength(1)

    await expect(readAssistantSessionRouting(paths, {
      alias: targetAlias,
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: target.sessionId,
    })

    const writeSession = createSession({
      alias: 'operation-corruption-write',
      sessionId: 'session-operation-corruption-write',
    })
    await writeAssistantSession(paths, writeSession)
    await corruptRightmostAssistantRouteIndexLeaf(databasePath)

    await expect(
      synchronizeAssistantIndexes(paths, writeSession, null),
    ).rejects.toMatchObject({
      code: 'ERR_SQLITE_ERROR',
      errcode: 11,
    })
    await expect(access(databasePath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect((await listAssistantQuarantineEntriesAtPaths(paths)).filter((entry) =>
      entry.artifactKind === 'indexes' && entry.originalPath === databasePath,
    )).toHaveLength(2)

    await expect(
      synchronizeAssistantIndexes(paths, writeSession, null),
    ).resolves.toBeUndefined()
    await expect(readAssistantSessionRouting(paths, {
      alias: writeSession.alias,
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: writeSession.sessionId,
    })
  })

  it('quarantines and rebuilds unsupported or structurally invalid routing databases', async () => {
    const paths = await createAssistantPaths(
      'assistant-store-persistence-route-unsupported-version-',
    )
    await ensureAssistantState(paths)
    const session = createSession({
      alias: 'version-repair',
      sessionId: 'session-version-repair',
    })
    await writeAssistantSession(paths, session)
    await synchronizeAssistantIndexes(paths, session, null)

    const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
    const database = openSqliteRuntimeDatabase(databasePath, {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    })
    database.exec('PRAGMA user_version = 2;')
    database.close()

    await expect(readAssistantSessionRouting(paths, {
      alias: 'version-repair',
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: session.sessionId,
    })

    const structurallyInvalid = openSqliteRuntimeDatabase(databasePath, {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    })
    structurallyInvalid.exec('DROP TABLE assistant_recent_sessions;')
    structurallyInvalid.close()
    await expect(readAssistantSessionRouting(paths, {
      alias: 'version-repair',
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: session.sessionId,
    })

    const invalidRoute = openSqliteRuntimeDatabase(databasePath, {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    })
    invalidRoute.prepare(`
      UPDATE assistant_session_routes
      SET session_id = '../invalid'
      WHERE kind = 'alias'
    `).run()
    invalidRoute.close()
    await expect(readAssistantSessionRouting(paths, {
      alias: 'version-repair',
      conversationKeys: [],
    })).rejects.toThrow(
      'Assistant session routing database contains an invalid route session id.',
    )
    await expect(access(databasePath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readAssistantSessionRouting(paths, {
      alias: 'version-repair',
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: session.sessionId,
    })

    const invalidRecent = openSqliteRuntimeDatabase(databasePath, {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    })
    invalidRecent.prepare(`
      UPDATE assistant_recent_sessions
      SET session_id = '../invalid'
    `).run()
    invalidRecent.close()
    await expect(readAssistantRecentSessionIds(paths, {
      limit: 1,
    })).rejects.toThrow(
      'Assistant session routing database contains an invalid recent session row.',
    )
    await expect(access(databasePath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readAssistantRecentSessionIds(paths, {
      limit: 1,
    })).resolves.toEqual([session.sessionId])

    const quarantines = await listAssistantQuarantineEntriesAtPaths(paths)
    expect(quarantines.filter((entry) =>
      entry.artifactKind === 'indexes' && entry.originalPath === databasePath,
    )).toHaveLength(4)
  })

  it('rebuilds missing session indexes and prefers the newest duplicate conversation binding', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-missing-index-rebuild-')
    await ensureAssistantState(paths)

    const older = createSession({
      alias: 'older-alias',
      conversationKey: 'linq:user-1:thread-shared',
      sessionId: 'session-older',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:01:00.000Z',
    })
    const newer = createSession({
      alias: 'newer-alias',
      conversationKey: 'linq:user-1:thread-shared',
      sessionId: 'session-newer',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:02:00.000Z',
    })

    await writeAssistantSession(paths, older)
    await writeAssistantSession(paths, newer)
    await rm(paths.indexesPath, { force: true })

    const rebuilt = await readAssistantSessionRouting(paths, {
      alias: 'newer-alias',
      conversationKeys: ['linq:user-1:thread-shared'],
    })
    expect(rebuilt.aliasSessionId).toBe('session-newer')
    expect(rebuilt.conversationKeySessionIds.get(
      'linq:user-1:thread-shared',
    )).toBe('session-newer')
    await expect(readAssistantSessionRouting(paths, {
      alias: 'older-alias',
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: 'session-older',
    })
    await expect(access(paths.indexesPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(paths.runtimeEventsPath)
    expect(runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'indexes.rebuilt',
        }),
      ]),
    )
  })

  it('orders sessions and duplicate index rebuilds by instant when offsets differ', async () => {
    const context = await createTempVaultContext('assistant-store-persistence-offset-order-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    await ensureAssistantState(paths)

    const offsetOlder = createSession({
      alias: 'older-alias',
      conversationKey: 'linq:user-1:thread-shared',
      sessionId: 'session-older',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:30:00+01:00',
    })
    const utcNewer = createSession({
      alias: 'newer-alias',
      conversationKey: 'linq:user-1:thread-shared',
      sessionId: 'session-newer',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:00:00.000Z',
    })

    await writeAssistantSession(paths, offsetOlder)
    await writeAssistantSession(paths, utcNewer)

    await expect(listAssistantSessionsLocal(context.vaultRoot)).resolves.toMatchObject([
      { sessionId: 'session-newer' },
      { sessionId: 'session-older' },
    ])

    await rm(paths.indexesPath, { force: true })
    const rebuilt = await readAssistantSessionRouting(paths, {
      alias: 'newer-alias',
      conversationKeys: ['linq:user-1:thread-shared'],
    })
    expect(rebuilt.aliasSessionId).toBe('session-newer')
    expect(rebuilt.conversationKeySessionIds.get(
      'linq:user-1:thread-shared',
    )).toBe('session-newer')
    await expect(readAssistantSessionRouting(paths, {
      alias: 'older-alias',
      conversationKeys: [],
    })).resolves.toMatchObject({
      aliasSessionId: 'session-older',
    })
    await expect(readAssistantRecentSessionIds(paths, { limit: 2 }))
      .resolves.toEqual(['session-newer', 'session-older'])
  })

  it('applies recent-session limits before reading durable session files', async () => {
    const context = await createTempVaultContext('assistant-store-persistence-recent-bounded-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    await ensureAssistantState(paths)
    await readAssistantSessionRouting(paths, {
      alias: null,
      conversationKeys: [],
    })

    const newest = createSession({
      alias: 'newest-alias',
      conversationKey: 'local:newest',
      sessionId: 'session-newest',
      updatedAt: '2026-04-08T00:03:00.000Z',
    })
    const olderSessionId = 'session-older-corrupt'
    await writeAssistantSession(paths, newest)
    await synchronizeAssistantIndexes(paths, newest, null)
    await writeFile(
      resolveAssistantSessionPath(paths, olderSessionId),
      '{bad-json',
      'utf8',
    )

    await expect(listAssistantSessions(context.vaultRoot, {
      limit: 1,
    })).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'session-newest',
      }),
    ])
    await expect(listAssistantQuarantineEntriesAtPaths(paths)).resolves.toEqual([])
  })

  it('preserves valid legacy route winners when duplicate sessions claim the same keys', async () => {
    const paths = await createAssistantPaths(
      'assistant-store-persistence-legacy-route-winner-',
    )
    await ensureAssistantState(paths)
    const selected = createSession({
      alias: 'work',
      conversationKey: 'telegram:user-1:thread-shared',
      lastTurnAt: '2026-04-08T00:01:00.000Z',
      sessionId: 'session-selected',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:05:00.000Z',
    })
    const timestampWinner = createSession({
      alias: 'work',
      conversationKey: 'telegram:user-1:thread-shared',
      lastTurnAt: '2026-04-08T00:04:00.000Z',
      sessionId: 'session-timestamp-winner',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:04:00.000Z',
    })
    await writeAssistantSession(paths, selected)
    await writeAssistantSession(paths, timestampWinner)
    await writeFile(paths.indexesPath, JSON.stringify({
      version: 1,
      aliases: {
        work: selected.sessionId,
      },
      conversationKeys: {
        'telegram:user-1:thread-shared': selected.sessionId,
      },
    }), 'utf8')

    const routing = await readAssistantSessionRouting(paths, {
      alias: 'work',
      conversationKeys: ['telegram:user-1:thread-shared'],
    })
    expect(routing.aliasSessionId).toBe(selected.sessionId)
    expect(routing.conversationKeySessionIds.get(
      'telegram:user-1:thread-shared',
    )).toBe(selected.sessionId)
    await expect(access(paths.indexesPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('keeps complete migrated route winners across above-floor restore when timestamps favor another claimant', async () => {
    const paths = await createAssistantPaths(
      'assistant-store-persistence-routing-floor-source-',
    )
    await ensureAssistantState(paths)
    const selected = createSession({
      alias: 'work',
      conversationKey: 'telegram:user-1:thread-shared',
      lastTurnAt: '2026-04-08T00:01:00.000Z',
      sessionId: 'session-selected',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:05:00.000Z',
    })
    const timestampWinner = createSession({
      alias: 'work',
      conversationKey: 'telegram:user-1:thread-shared',
      lastTurnAt: '2026-04-08T00:04:00.000Z',
      sessionId: 'session-timestamp-winner',
      threadId: 'thread-shared',
      updatedAt: '2026-04-08T00:04:00.000Z',
    })
    expect(Date.parse(selected.lastTurnAt ?? '')).toBeLessThan(
      Date.parse(timestampWinner.lastTurnAt ?? ''),
    )
    await writeAssistantSession(paths, selected)
    await writeAssistantSession(paths, timestampWinner)
    await writeFile(paths.indexesPath, JSON.stringify({
      version: 1,
      aliases: {
        work: selected.sessionId,
      },
      conversationKeys: {
        'telegram:user-1:thread-shared': selected.sessionId,
      },
      recentSessions: {
        [selected.sessionId]: selected.updatedAt,
        [timestampWinner.sessionId]: timestampWinner.updatedAt,
      },
    }), 'utf8')

    await expect(readAssistantSessionRouting(paths, {
      alias: 'work',
      conversationKeys: ['telegram:user-1:thread-shared'],
    })).resolves.toMatchObject({
      aliasSessionId: selected.sessionId,
      conversationKeySessionIds: new Map([
        ['telegram:user-1:thread-shared', selected.sessionId],
      ]),
    })

    const restoredPaths = await createAssistantPaths(
      'assistant-store-persistence-routing-floor-restored-',
    )
    await ensureAssistantState(restoredPaths)
    await writeAssistantSession(restoredPaths, selected)
    await writeAssistantSession(restoredPaths, timestampWinner)
    await copyFile(
      resolveAssistantSessionRoutingDatabasePath(paths),
      resolveAssistantSessionRoutingDatabasePath(restoredPaths),
    )

    await expect(readAssistantSessionRouting(restoredPaths, {
      alias: 'work',
      conversationKeys: ['telegram:user-1:thread-shared'],
    })).resolves.toMatchObject({
      aliasSessionId: selected.sessionId,
      conversationKeySessionIds: new Map([
        ['telegram:user-1:thread-shared', selected.sessionId],
      ]),
    })
    await expect(access(restoredPaths.indexesPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('directly migrates high-cardinality legacy indexes before bounded listing', async () => {
    const context = await createTempVaultContext('assistant-store-persistence-recent-legacy-many-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    await ensureAssistantState(paths)

    const aliases: Record<string, string> = {}
    const conversationKeys: Record<string, string> = {}
    const recentSessions: Record<string, string> = {}
    for (let index = 0; index < 60; index += 1) {
      const sessionId = `session-legacy-${String(index).padStart(2, '0')}`
      const updatedAt = `2026-04-08T00:${String(index).padStart(2, '0')}:00.000Z`
      await writeAssistantSession(paths, createSession({
        alias: `legacy-${index}`,
        conversationKey: `local:legacy:${index}`,
        sessionId,
        updatedAt,
      }))
      aliases[`legacy-${index}`] = sessionId
      conversationKeys[`local:legacy:${index}`] = sessionId
      recentSessions[sessionId] = updatedAt
    }
    await writeFile(
      resolveAssistantSessionPath(paths, 'session-unrelated-corrupt'),
      '{bad-json',
      'utf8',
    )
    await writeFile(paths.indexesPath, JSON.stringify({
      version: 1,
      aliases,
      conversationKeys,
      recentSessions,
    }), 'utf8')

    await expect(listAssistantSessions(context.vaultRoot, {
      limit: 1,
    })).resolves.toEqual([
      expect.objectContaining({
        sessionId: 'session-legacy-59',
      }),
    ])

    await expect(access(paths.indexesPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readAssistantRecentSessionIds(paths, { limit: 100 }))
      .resolves.toHaveLength(50)
    await expect(readAssistantRecentSessionIds(paths, { limit: 1 }))
      .resolves.toEqual(['session-legacy-59'])
    await expect(readAssistantSessionRouting(paths, {
      alias: 'legacy-59',
      conversationKeys: ['local:legacy:59'],
    })).resolves.toMatchObject({
      aliasSessionId: 'session-legacy-59',
    })
    expect(await readdir(paths.stateDirectory)).toEqual([
      path.basename(resolveAssistantSessionRoutingDatabasePath(paths)),
    ])
    await expect(listAssistantQuarantineEntriesAtPaths(paths)).resolves.toEqual([])
  })

  it('treats corrupted session files as missing and ignores corrupted legacy sidecars for Codex sessions', async () => {
    const corruptedPaths = await createAssistantPaths(
      'assistant-store-persistence-corrupted-session-',
    )
    await ensureAssistantState(corruptedPaths)

    const corruptedSessionId = 'session-corrupt-missing'
    await writeFile(
      resolveAssistantSessionPath(corruptedPaths, corruptedSessionId),
      '{bad-session',
      'utf8',
    )

    await expect(
      readAssistantSession({
        paths: corruptedPaths,
        sessionId: corruptedSessionId,
        treatCorruptedAsMissing: true,
      }),
    ).resolves.toBeNull()
    await expect(
      readFile(resolveAssistantSessionPath(corruptedPaths, corruptedSessionId), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const sidecarPaths = await createAssistantPaths(
      'assistant-store-persistence-corrupted-sidecar-',
    )
    await ensureAssistantState(sidecarPaths)

    const session = createSession({
      sessionId: 'session-corrupt-sidecar',
    })
    await writeAssistantSession(sidecarPaths, session)
    await writeFile(
      resolveAssistantSessionSecretsPath(sidecarPaths, session.sessionId),
      '{bad-sidecar',
      'utf8',
    )

    await expect(
      readAssistantSession({
        paths: sidecarPaths,
        sessionId: session.sessionId,
        treatCorruptedAsMissing: true,
      }),
    ).resolves.toMatchObject({
      sessionId: session.sessionId,
      target: {
        adapter: 'codex-cli',
      },
    })
    await expect(
      readFile(resolveAssistantSessionPath(sidecarPaths, session.sessionId), 'utf8'),
    ).resolves.toContain('"conversationId": "session-corrupt-sidecar"')
    await expect(
      readFile(resolveAssistantSessionSecretsPath(sidecarPaths, session.sessionId), 'utf8'),
    ).resolves.toBe('{bad-sidecar')

    const quarantines = await listAssistantQuarantineEntriesAtPaths(sidecarPaths, {
      artifactKind: 'session',
    })
    expect(quarantines).toEqual([])
  })

  it('reads and writes automation state, then quarantines corrupted automation files and rebuilds defaults', async () => {
    const writePaths = await createAssistantPaths('assistant-store-persistence-automation-write-')
    await ensureAssistantState(writePaths)

    const initial = await readAutomationState(writePaths)
    expect(initial).toMatchObject({
      version: 1,
      autoReply: [],
    })

    const updated = await writeAutomationState(writePaths, {
      version: 1,
      autoReply: [
        {
          channel: 'telegram',
          enabledAt: '2026-04-08T00:05:00.000Z',
          eligibleAfter: {
            createdAt: null,
            occurredAt: '2026-04-08T00:05:00.000Z',
            inputId: 'capture-2',
            sourceKind: 'inbox-capture',
          },
        },
        {
          channel: 'linq',
          enabledAt: '2026-04-08T00:06:00.000Z',
          eligibleAfter: null,
        },
      ],
      updatedAt: '2026-04-08T00:06:00.000Z',
    })

    expect(updated).toEqual({
      version: 1,
      autoReply: [
        {
          channel: 'telegram',
          enabledAt: '2026-04-08T00:05:00.000Z',
          eligibleAfter: {
            createdAt: null,
            occurredAt: '2026-04-08T00:05:00.000Z',
            inputId: 'capture-2',
            sourceKind: 'inbox-capture',
          },
        },
        {
          channel: 'linq',
          enabledAt: '2026-04-08T00:06:00.000Z',
          eligibleAfter: null,
        },
      ],
      updatedAt: '2026-04-08T00:06:00.000Z',
    })
    expect(JSON.parse(await readFile(writePaths.automationStatePath, 'utf8'))).toEqual(updated)
    await expect(readAutomationState(writePaths)).resolves.toEqual(updated)

    const corruptedPaths = await createAssistantPaths(
      'assistant-store-persistence-automation-corrupt-',
    )
    await ensureAssistantState(corruptedPaths)
    await writeFile(corruptedPaths.automationStatePath, '{bad-automation', 'utf8')

    const rebuilt = await readAutomationState(corruptedPaths)
    expect(rebuilt).toMatchObject({
      version: 1,
      autoReply: [],
    })

    const quarantines = await listAssistantQuarantineEntriesAtPaths(corruptedPaths, {
      artifactKind: 'automation',
    })
    expect(quarantines).toHaveLength(1)
    expect(quarantines[0]).toMatchObject({
      artifactKind: 'automation',
      originalPath: corruptedPaths.automationStatePath,
    })

    const runtimeEvents = await listAssistantRuntimeEventsAtPath(
      corruptedPaths.runtimeEventsPath,
    )
    expect(runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'automation.recovered',
          component: 'automation',
          entityType: 'automation-state',
          level: 'warn',
        }),
        expect.objectContaining({
          kind: 'automation.quarantined',
          component: 'state',
          entityType: 'automation',
          level: 'warn',
        }),
      ]),
    )
  })

  it('rereads automation state when quarantine sees a concurrently repaired file', async () => {
    vi.resetModules()
    const repairedState = {
      version: 1,
      autoReply: [
        {
          channel: 'telegram',
          enabledAt: '2026-04-08T00:08:00.000Z',
          eligibleAfter: null,
        },
      ],
      updatedAt: '2026-04-08T00:09:00.000Z',
    }
    let automationStatePath = ''
    const quarantineAssistantStateFile = vi.fn(async () => {
      await writeFile(automationStatePath, JSON.stringify(repairedState), 'utf8')
      return null
    })
    vi.doMock('../src/assistant/quarantine.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/quarantine.ts')
      >('../src/assistant/quarantine.ts')
      return {
        ...actual,
        quarantineAssistantStateFile,
      }
    })
    const persistence = await import('../src/assistant/store/persistence.ts')
    const pathsModule = await import('../src/assistant/store/paths.ts')
    const context = await createTempVaultContext(
      'assistant-store-persistence-automation-repaired-',
    )
    tempRoots.push(context.parentRoot)
    const paths = pathsModule.resolveAssistantStatePaths(context.vaultRoot)
    automationStatePath = paths.automationStatePath
    await persistence.ensureAssistantState(paths)
    await writeFile(paths.automationStatePath, '{bad-automation', 'utf8')

    await expect(persistence.readAutomationState(paths)).resolves.toEqual(
      repairedState,
    )
    expect(quarantineAssistantStateFile).toHaveBeenCalledOnce()
    await expect(readFile(paths.automationStatePath, 'utf8')).resolves.toEqual(
      JSON.stringify(repairedState),
    )
  })

  it('updates automation state from the durable file instead of a stale process cache', async () => {
    const context = await createTempVaultContext('assistant-store-persistence-automation-fresh-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    await ensureAssistantState(paths)

    await readAutomationState(paths)
    await writeFile(paths.automationStatePath, JSON.stringify({
      version: 1,
      autoReply: [
        {
          channel: 'email',
          enabledAt: '2026-04-08T00:05:00.000Z',
          eligibleAfter: null,
        },
      ],
      updatedAt: '2026-04-08T00:05:00.000Z',
    }))

    const updated = await updateAssistantAutomationState(context.vaultRoot, (state) => ({
      ...state,
      autoReply: [
        ...state.autoReply,
        {
          channel: 'telegram',
          enabledAt: '2026-04-08T00:06:00.000Z',
          eligibleAfter: null,
        },
      ],
      updatedAt: '2026-04-08T00:06:00.000Z',
    }))

    expect(updated.autoReply.map((entry) => entry.channel)).toEqual(['email', 'telegram'])
  })

  it('fails closed and quarantines unsupported session records', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-legacy-session-')
    await ensureAssistantState(paths)
    const sessionId = 'session-legacy-provider'
    const sessionPath = resolveAssistantSessionPath(paths, sessionId)
    await writeFile(
      sessionPath,
      JSON.stringify({
        schema: 'murph.assistant-session.v1',
        sessionId,
        target: {
          adapter: 'unsupported-provider',
          apiKeyEnv: 'OPENAI_API_KEY',
          endpoint: 'https://api.example.com/v1',
          headers: null,
          model: 'gpt-5.4',
          presetId: null,
          providerName: 'legacy-provider',
          reasoningEffort: 'medium',
          webSearch: null,
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
        updatedAt: '2026-04-08T00:00:00.000Z',
        lastTurnAt: null,
        turnCount: 0,
      }),
      'utf8',
    )

    await expect(
      readAssistantSession({
        paths,
        sessionId,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_CORRUPTED',
      context: expect.objectContaining({
        sessionId,
      }),
    })
    const quarantines = await listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'session',
    })
    expect(quarantines).toHaveLength(1)
    await expect(readFile(quarantines[0]!.quarantinedPath, 'utf8')).resolves.toContain(
      '"adapter":"unsupported-provider"',
    )
  })

  it('uses unique quarantine payload names when basenames and timestamps collide', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T04:05:06.789Z'))
    const paths = await createAssistantPaths('assistant-store-persistence-quarantine-collision-')
    await ensureAssistantState(paths)
    const firstRoot = path.join(paths.assistantStateRoot, 'collision-one')
    const secondRoot = path.join(paths.assistantStateRoot, 'collision-two')
    await mkdir(firstRoot, { recursive: true })
    await mkdir(secondRoot, { recursive: true })
    const firstPath = path.join(firstRoot, 'session.json')
    const secondPath = path.join(secondRoot, 'session.json')
    await writeFile(firstPath, 'first corrupt payload', 'utf8')
    await writeFile(secondPath, 'second corrupt payload', 'utf8')

    const first = await quarantineAssistantStateFile({
      artifactKind: 'session',
      error: new Error('first parse failure'),
      expectedContent: 'first corrupt payload',
      filePath: firstPath,
      paths,
    })
    const second = await quarantineAssistantStateFile({
      artifactKind: 'session',
      error: new Error('second parse failure'),
      expectedContent: 'second corrupt payload',
      filePath: secondPath,
      paths,
    })

    expect(first?.quarantinedPath).toBeTruthy()
    expect(second?.quarantinedPath).toBeTruthy()
    expect(first?.quarantinedPath).not.toBe(second?.quarantinedPath)
    await expect(readFile(first!.quarantinedPath, 'utf8')).resolves.toBe(
      'first corrupt payload',
    )
    await expect(readFile(second!.quarantinedPath, 'utf8')).resolves.toBe(
      'second corrupt payload',
    )
  })

  it('skips quarantine when the source file no longer matches the failed read', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-quarantine-replaced-')
    await ensureAssistantState(paths)
    const sessionPath = resolveAssistantSessionPath(paths, 'session-repaired')
    await writeFile(sessionPath, 'corrupt session payload', 'utf8')
    await writeFile(sessionPath, JSON.stringify(createSession({
      sessionId: 'session-repaired',
    })), 'utf8')

    await expect(quarantineAssistantStateFile({
      artifactKind: 'session',
      error: new Error('parse failed before repair'),
      expectedContent: 'corrupt session payload',
      filePath: sessionPath,
      paths,
    })).resolves.toBeNull()

    await expect(readFile(sessionPath, 'utf8')).resolves.toContain('session-repaired')
    await expect(listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'session',
    })).resolves.toEqual([])
  })
})

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
}

async function assertDirectoryExists(directoryPath: string): Promise<void> {
  await access(directoryPath)
}

async function corruptRightmostAssistantRouteIndexLeaf(
  databasePath: string,
): Promise<void> {
  const database = openSqliteRuntimeDatabase(databasePath, {
    journalMode: 'DELETE',
    synchronous: 'FULL',
  })
  const damagedLeaf = database.prepare(`
    SELECT pageno AS pageNumber
    FROM dbstat
    WHERE name = 'sqlite_autoindex_assistant_session_routes_1'
      AND pagetype = 'leaf'
    ORDER BY path DESC
    LIMIT 1
  `).get() as { pageNumber: number }
  const pageSize = (database.prepare('PRAGMA page_size;').get() as {
    page_size: number
  }).page_size
  database.close()

  const bytes = await readFile(databasePath)
  bytes[(damagedLeaf.pageNumber - 1) * pageSize] = 0
  await writeFile(databasePath, bytes)
}

function createTranscriptEntry(
  kind: AssistantTranscriptEntry['kind'],
  text: string,
  createdAt: string,
): AssistantTranscriptEntry {
  return {
    schema: 'murph.assistant-transcript-entry.v1',
    kind,
    text,
    createdAt,
  }
}

function createCodexSession(input?: {
  sessionId?: string
  updatedAt?: string
}): AssistantSession {
  return parseAssistantSessionRecord({
    schema: 'murph.assistant-session.v1',
    sessionId: input?.sessionId ?? 'session-codex',
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
    alias: 'codex',
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
    updatedAt: input?.updatedAt ?? '2026-04-08T00:05:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
  })
}

function createSession(input?: {
  alias?: string | null
  conversationKey?: string | null
  createdAt?: string
  lastTurnAt?: string | null
  sessionId?: string
  threadId?: string | null
  updatedAt?: string
}): AssistantSession {
  const sessionId = input?.sessionId ?? 'session-alpha'
  const threadId = input?.threadId ?? 'thread-1'
  const conversationKey =
    input?.conversationKey === undefined
      ? 'telegram:user-1:thread-1'
      : input.conversationKey

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
    alias: input?.alias ?? 'alpha',
    binding: {
      conversationKey,
      channel: conversationKey ? 'telegram' : null,
      identityId: conversationKey ? 'user-1' : null,
      actorId: null,
      threadId: conversationKey ? threadId : null,
      threadIsDirect: conversationKey ? true : null,
      delivery: null,
    },
    createdAt: input?.createdAt ?? '2026-04-08T00:00:00.000Z',
    updatedAt: input?.updatedAt ?? '2026-04-08T00:05:00.000Z',
    lastTurnAt: input?.lastTurnAt ?? null,
    turnCount: 2,
  })
}
