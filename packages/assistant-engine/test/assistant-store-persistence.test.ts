import { access, readFile, rm, writeFile } from 'node:fs/promises'

import {
  parseAssistantSessionRecord,
  type AssistantSession,
  type AssistantTranscriptEntry,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { listAssistantQuarantineEntriesAtPaths } from '../src/assistant/quarantine.ts'
import { listAssistantRuntimeEventsAtPath } from '../src/assistant/runtime-events.ts'
import {
  appendTranscriptEntries,
  ensureAssistantState,
  inspectAssistantSessionStorage,
  isAssistantSessionExpired,
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
      providerBindingHeaders: null,
      providerHeaders: {
        Authorization: 'Bearer secret-token',
        Cookie: 'session-cookie',
      },
    })
    await expect(
      readAssistantSession({
        paths,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(session)

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

  it('initializes and synchronizes the session index store across alias and conversation-key changes', async () => {
    const paths = await createAssistantPaths('assistant-store-persistence-indexes-')
    await ensureAssistantState(paths)

    await expect(readAssistantIndexStore(paths)).resolves.toEqual({
      version: 2,
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
      version: 2,
      aliases: {
        beta: 'session-index-shared',
      },
      conversationKeys: {
        'telegram:user-1:thread-2': 'session-index-shared',
      },
    })
    expect(JSON.parse(await readFile(paths.indexesPath, 'utf8'))).toEqual({
      version: 2,
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
      version: 2,
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
    schema: 'murph.assistant-session.v4',
    sessionId,
    target: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.example.com/v1',
      headers: {
        Authorization: 'Bearer secret-token',
        Cookie: 'session-cookie',
        'X-Trace': 'trace-123',
      },
      model: 'gpt-5.4',
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
