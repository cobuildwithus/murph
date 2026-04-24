import { access, readFile, rm, writeFile } from 'node:fs/promises'

import {
  parseAssistantSessionRecord,
  type AssistantSession,
  type AssistantTranscriptEntry,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { listAssistantQuarantineEntriesAtPaths } from '../src/assistant/quarantine.ts'
import { listAssistantRuntimeEventsAtPath } from '../src/assistant/runtime-events.ts'
import {
  appendTranscriptEntries,
  ensureAssistantState,
  inspectAssistantSessionStorage,
  isAssistantSessionExpired,
  pruneAssistantTranscriptRetention,
  readAssistantIndexStore,
  readAssistantSession,
  readAssistantTranscriptEntries,
  readAutomationState,
  replaceTranscriptEntries,
  resolveAssistantSessionPath,
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
  it('creates assistant state directories, persists sessions with secret sidecars, and appends or replaces transcripts', async () => {
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
    await assertDirectoryExists(paths.usageDirectory)
    await assertDirectoryExists(paths.usagePendingDirectory)

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
      target: {
        headers: {
          'X-Trace': 'trace-123',
        },
      },
    })
    expect(await readFile(sessionPath, 'utf8')).not.toContain('secret-token')
    expect(JSON.parse(await readFile(secretsPath, 'utf8'))).toEqual({
      schema: 'murph.assistant-session-secrets.v1',
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      providerHeaders: {
        Authorization: 'Bearer secret-token',
        Cookie: 'session-cookie',
      },
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
      schema: 'murph.assistant-session.v1',
      sessionId: session.sessionId,
      target: session.target,
      turnCount: session.turnCount,
      updatedAt: session.updatedAt,
    })
    expect(roundTrippedSession.providerOptions).toMatchObject({
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://api.example.com/v1',
      executionDriver: 'openai-compatible',
      model: 'gpt-5.4',
      providerName: 'murph-openai',
      reasoningEffort: 'medium',
      resumeKind: null,
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

  it('leaves the previous secret sidecar committed when the main session write fails', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-sidecar-stage-')
    const session = createSession({
      sessionId: 'session-sidecar-stage',
      updatedAt: '2026-04-08T00:05:00.000Z',
    })
    await writeAssistantSession(paths, session)
    const sessionPath = resolveAssistantSessionPath(paths, session.sessionId)
    const secretsPath = resolveAssistantSessionSecretsPath(paths, session.sessionId)
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
      headers: {
        Authorization: 'Bearer rotated-secret-token',
        'X-Trace': 'trace-456',
      },
      sessionId: session.sessionId,
      updatedAt: '2026-04-08T00:06:00.000Z',
    })

    await expect(
      writeAssistantSessionWithFailure(paths, rotatedSession),
    ).rejects.toThrow('injected session write failure')

    await expect(readFile(secretsPath, 'utf8')).resolves.toBe(originalSidecar)
  })

  it('ignores stale leftover secret sidecars for non-openai sessions', async () => {
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
      }, (_, index) =>
        createTranscriptEntry(
          index % 2 === 0 ? 'user' : 'assistant',
          `entry-${index}`,
          new Date(Date.UTC(2026, 3, 8, 0, index + 1, 0)).toISOString(),
        ),
      ),
      createTranscriptEntry('error', 'recent error', '2026-04-08T03:00:00.000Z'),
    ]

    await replaceTranscriptEntries(paths, session.sessionId, transcriptEntries)

    await expect(pruneAssistantTranscriptRetention(paths)).resolves.toEqual({
      entriesTrimmed: 6,
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

  it('initializes and synchronizes the session index store across alias and conversation-key changes', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-indexes-')
    await ensureAssistantState(paths)

    await expect(readAssistantIndexStore(paths)).resolves.toEqual({
      version: 1,
      aliases: {},
      conversationKeys: {},
    })

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

    await expect(readAssistantIndexStore(paths)).resolves.toEqual({
      version: 1,
      aliases: {
        beta: 'session-index-shared',
      },
      conversationKeys: {
        'telegram:user-1:thread-2': 'session-index-shared',
      },
    })
    expect(JSON.parse(await readFile(paths.indexesPath, 'utf8'))).toEqual({
      version: 1,
      aliases: {
        beta: 'session-index-shared',
      },
      conversationKeys: {
        'telegram:user-1:thread-2': 'session-index-shared',
      },
    })
  })

  it('rebuilds corrupted index stores from durable sessions and skips corrupted sessions as missing', async () => {
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

    await expect(readAssistantIndexStore(paths)).resolves.toEqual({
      version: 1,
      aliases: {
        'good-alias': 'session-good',
      },
      conversationKeys: {
        'telegram:user-1:thread-good': 'session-good',
      },
    })

    const quarantines = await listAssistantQuarantineEntriesAtPaths(paths)
    expect(quarantines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: 'indexes',
          originalPath: paths.indexesPath,
        }),
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
          kind: 'indexes.quarantined',
        }),
        expect.objectContaining({
          kind: 'session.quarantined',
        }),
      ]),
    )
  })

  it('rebuilds missing index stores from durable sessions and prefers the newest duplicate conversation binding', async () => {
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

    await expect(readAssistantIndexStore(paths)).resolves.toEqual({
      version: 1,
      aliases: {
        'newer-alias': 'session-newer',
        'older-alias': 'session-older',
      },
      conversationKeys: {
        'linq:user-1:thread-shared': 'session-newer',
      },
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

  it('treats corrupted session files and corrupted session secret sidecars as missing when requested', async () => {
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
    ).resolves.toBeNull()
    await expect(
      readFile(resolveAssistantSessionPath(sidecarPaths, session.sessionId), 'utf8'),
    ).resolves.toContain('"sessionId": "session-corrupt-sidecar"')
    await expect(
      readFile(resolveAssistantSessionSecretsPath(sidecarPaths, session.sessionId), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const quarantines = await listAssistantQuarantineEntriesAtPaths(sidecarPaths, {
      artifactKind: 'session',
    })
    expect(quarantines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalPath: resolveAssistantSessionSecretsPath(
            sidecarPaths,
            session.sessionId,
          ),
        }),
      ]),
    )
  })

  it('reads and writes automation state, then quarantines corrupted automation files and rebuilds defaults', async () => {
    const writePaths = await createAssistantPaths('assistant-store-persistence-automation-write-')
    await ensureAssistantState(writePaths)

    const initial = await readAutomationState(writePaths)
    expect(initial).toMatchObject({
      version: 1,
      inboxScanCursor: null,
      autoReply: [],
    })

    const updated = await writeAutomationState(writePaths, {
      version: 1,
      inboxScanCursor: {
        occurredAt: '2026-04-08T00:04:00.000Z',
        captureId: 'capture-1',
      },
      autoReply: [
        {
          channel: 'telegram',
          cursor: {
            occurredAt: '2026-04-08T00:05:00.000Z',
            captureId: 'capture-2',
          },
        },
        {
          channel: 'agentmail',
          cursor: null,
        },
      ],
      updatedAt: '2026-04-08T00:06:00.000Z',
    })

    expect(updated).toEqual({
      version: 1,
      inboxScanCursor: {
        occurredAt: '2026-04-08T00:04:00.000Z',
        captureId: 'capture-1',
      },
      autoReply: [
        {
          channel: 'telegram',
          cursor: {
            occurredAt: '2026-04-08T00:05:00.000Z',
            captureId: 'capture-2',
          },
        },
        {
          channel: 'agentmail',
          cursor: null,
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
      inboxScanCursor: null,
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
})

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
}

async function assertDirectoryExists(directoryPath: string): Promise<void> {
  await access(directoryPath)
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
      model: 'gpt-5.4',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'workspace-write',
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
  headers?: Record<string, string>
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
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.example.com/v1',
      headers: input?.headers ?? {
        Authorization: 'Bearer secret-token',
        Cookie: 'session-cookie',
        'X-Trace': 'trace-123',
      },
      model: 'gpt-5.4',
      presetId: 'openai',
      providerName: 'murph-openai',
      reasoningEffort: 'medium',
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
