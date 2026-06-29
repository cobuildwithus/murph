import { access, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  parseAssistantSessionRecord,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  appendAssistantRuntimeEvent,
  listAssistantRuntimeEvents,
} from '../src/assistant/runtime-events.ts'
import {
  appendTranscriptEntries,
  ensureAssistantState,
  loadAndPersistResolvedSession,
  persistResolvedSession,
  resolveAssistantSessionPath,
  resolveAssistantTranscriptPath,
  writeAssistantSession,
} from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  getKnowledgePage,
  searchKnowledgePages,
  tailKnowledgeLog,
} from '../src/knowledge/service.ts'
import { tryKillProcess } from '@murphai/runtime-state/node'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('../src/assistant/store.js')
  vi.doUnmock('../src/assistant/outbox.js')
  vi.doUnmock('../src/assistant/runtime-write-lock.js')
  vi.doUnmock('../src/assistant/automation/runtime-lock.js')
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant infra final coverage', () => {
  it('covers runtime-event wrapper entrypoints with real assistant paths', async () => {
    const paths = await createAssistantPaths('assistant-infra-runtime-events-')

    const appended = await appendAssistantRuntimeEvent({
      component: 'runtime',
      kind: 'runtime.maintenance',
      message: 'wrapper event',
      vault: path.dirname(path.dirname(path.dirname(paths.assistantStateRoot))),
    })

    await expect(
      listAssistantRuntimeEvents({
        limit: 1,
        vault: path.dirname(path.dirname(path.dirname(paths.assistantStateRoot))),
      }),
    ).resolves.toEqual([appended])
  })

  it('covers session-resolution wrappers and undefined field fallbacks', async () => {
    const resolveAssistantSession = vi.fn(async (input) => ({
      created: false,
      paths: {
        indexesDirectory: '/tmp/indexes',
        rootDirectory: '/tmp/root',
        sessionsDirectory: '/tmp/sessions',
        statusDirectory: '/tmp/status',
        transcriptsDirectory: '/tmp/transcripts',
      },
      session: createSession({
        sessionId: input.sessionId ?? 'session-alpha',
      }),
    }))

    vi.doMock('../src/assistant/store.js', async () => {
      const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
        '../src/assistant/store.ts',
      )
      return {
        ...actual,
        resolveAssistantSession,
      }
    })

    const sessionResolution = await import('../src/assistant/session-resolution.ts')

    const explicitThread = sessionResolution.buildResolveAssistantSessionInput(
      {
        model: 'gpt-5-codex',
        participantId: 'participant-1',
        provider: 'codex-cli',
        threadId: 'thread-explicit',
        vault: '/tmp/vault-session-resolution',
      },
      null,
    )
    expect(explicitThread.actorId).toBe('participant-1')
    expect(explicitThread.threadId).toBe('thread-explicit')

    const minimal = sessionResolution.buildResolveAssistantSessionInput(
      {
        model: 'gpt-5-codex',
        provider: 'codex-cli',
        vault: '/tmp/vault-session-resolution',
      },
      null,
    )
    expect(minimal).not.toHaveProperty('actorId')
    expect(minimal).not.toHaveProperty('threadId')
    expect(minimal.threadIsDirect).toBeUndefined()

    await sessionResolution.resolveAssistantSessionForMessage({
      defaults: null,
      message: {
        model: 'gpt-5-codex',
        prompt: 'Hello',
        provider: 'codex-cli',
        vault: '/tmp/vault-session-resolution',
      },
    })

    expect(resolveAssistantSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5-codex',
        provider: 'codex-cli',
        vault: '/tmp/vault-session-resolution',
      }),
    )
  })

  it('covers runtime-budget stale-lock cleanup and malformed quarantine metadata fallback', async () => {
    const paths = await createAssistantPaths('assistant-infra-runtime-budgets-')
    await ensureAssistantState(paths)

    const oldDate = new Date('2026-01-01T00:00:00.000Z')
    const maintenanceDate = new Date('2026-02-15T00:00:00.000Z')
    const nestedDirectory = path.join(paths.quarantineDirectory, 'nested')
    const payloadPath = path.join(nestedDirectory, 'budget.invalid.json')
    const metadataPath = `${payloadPath}.meta.json`
    await mkdir(nestedDirectory, {
      recursive: true,
    })
    await writeFile(payloadPath, '{"bad":true}', 'utf8')
    await writeFile(metadataPath, '{bad-metadata', 'utf8')
    await utimes(payloadPath, oldDate, oldDate)
    await utimes(metadataPath, oldDate, oldDate)

    const inspectAssistantRuntimeWriteLock = vi.fn(async () => ({
      state: 'stale' as const,
    }))
    const clearAssistantRuntimeWriteLock = vi.fn(async () => undefined)
    const inspectAssistantAutomationRunLock = vi.fn(async () => ({
      state: 'stale' as const,
    }))
    const clearAssistantAutomationRunLock = vi.fn(async () => undefined)

    vi.doMock('../src/assistant/runtime-write-lock.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/runtime-write-lock.ts')
      >('../src/assistant/runtime-write-lock.ts')
      return {
        ...actual,
        clearAssistantRuntimeWriteLock,
        inspectAssistantRuntimeWriteLock,
        withAssistantRuntimeWriteLock: vi.fn(
          async (_vault: string, run: (lockedPaths: typeof paths) => Promise<unknown>) =>
            await run(paths),
        ),
      }
    })
    vi.doMock('../src/assistant/automation/runtime-lock.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/automation/runtime-lock.ts')
      >('../src/assistant/automation/runtime-lock.ts')
      return {
        ...actual,
        clearAssistantAutomationRunLock,
        inspectAssistantAutomationRunLock,
      }
    })

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')
    const snapshot = await runtimeBudgets.runAssistantRuntimeMaintenance({
      now: maintenanceDate,
      vault: 'ignored-by-mock',
    })

    expect(snapshot.maintenance.staleLocksCleared).toBe(2)
    expect(snapshot.maintenance.staleQuarantinePruned).toBe(1)
    expect(snapshot.maintenance.notes).toContain('2 stale runtime lock(s) were cleared.')
    expect(clearAssistantRuntimeWriteLock).toHaveBeenCalledOnce()
    expect(clearAssistantAutomationRunLock).toHaveBeenCalledOnce()
    await expect(stat(payloadPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(metadataPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('covers runtime-budget recent-run short circuit, snapshot recovery, and orphan payload pruning', async () => {
    const paths = await createAssistantPaths('assistant-infra-runtime-budget-followups-')
    await ensureAssistantState(paths)

    const recentSnapshot = {
      schema: 'murph.assistant-runtime-budget.v1',
      updatedAt: '2026-02-15T00:02:00.000Z',
      caches: [],
      maintenance: {
        lastRunAt: '2026-02-15T00:02:00.000Z',
        staleLocksCleared: 0,
        staleQuarantinePruned: 0,
        notes: ['already-ran'],
      },
    }
    await writeFile(
      paths.resourceBudgetPath,
      JSON.stringify(recentSnapshot),
      'utf8',
    )

    const inspectAssistantRuntimeWriteLock = vi.fn(async () => ({
      state: 'active' as const,
    }))
    const clearAssistantRuntimeWriteLock = vi.fn(async () => undefined)
    const inspectAssistantAutomationRunLock = vi.fn(async () => ({
      state: 'active' as const,
    }))
    const clearAssistantAutomationRunLock = vi.fn(async () => undefined)

    vi.doMock('../src/assistant/runtime-write-lock.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/runtime-write-lock.ts')
      >('../src/assistant/runtime-write-lock.ts')
      return {
        ...actual,
        clearAssistantRuntimeWriteLock,
        inspectAssistantRuntimeWriteLock,
        withAssistantRuntimeWriteLock: vi.fn(
          async (_vault: string, run: (lockedPaths: typeof paths) => Promise<unknown>) =>
            await run(paths),
        ),
      }
    })
    vi.doMock('../src/assistant/automation/runtime-lock.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/automation/runtime-lock.ts')
      >('../src/assistant/automation/runtime-lock.ts')
      return {
        ...actual,
        clearAssistantAutomationRunLock,
        inspectAssistantAutomationRunLock,
      }
    })

    const runtimeBudgets = await import('../src/assistant/runtime-budgets.ts')

    await expect(
      runtimeBudgets.maybeRunAssistantRuntimeMaintenance({
        now: new Date('2026-02-15T00:05:00.000Z'),
        vault: 'ignored-by-mock',
      }),
    ).resolves.toMatchObject({
      maintenance: recentSnapshot.maintenance,
      schema: recentSnapshot.schema,
      updatedAt: recentSnapshot.updatedAt,
    })

    expect(clearAssistantRuntimeWriteLock).not.toHaveBeenCalled()
    expect(clearAssistantAutomationRunLock).not.toHaveBeenCalled()

    await writeFile(paths.resourceBudgetPath, '{bad-json', 'utf8')
    const recovered = await runtimeBudgets.readAssistantRuntimeBudgetStatus(
      'ignored-by-mock',
    )
    expect(recovered.schema).toBe('murph.assistant-runtime-budget.v1')
    expect(recovered.maintenance.lastRunAt).toBeNull()
    expect(recovered.maintenance.notes).toEqual([])

    const orphanPayloadPath = path.join(
      paths.outboxQuarantineDirectory,
      'reply.invalid.json',
    )
    await writeFile(orphanPayloadPath, '{"bad":true}', 'utf8')
    const oldDate = new Date('2026-01-01T00:00:00.000Z')
    await utimes(orphanPayloadPath, oldDate, oldDate)

    const maintenance = await runtimeBudgets.runAssistantRuntimeMaintenance({
      now: new Date('2026-02-20T00:00:00.000Z'),
      vault: 'ignored-by-mock',
    })
    expect(maintenance.maintenance.staleLocksCleared).toBe(0)
    expect(maintenance.maintenance.staleQuarantinePruned).toBe(1)
    expect(maintenance.maintenance.notes).toContain(
      '1 expired quarantine artifact(s) were removed.',
    )
    await expect(stat(orphanPayloadPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('covers persistence no-op, routing-conflict, rebind, expiry, and empty-transcript branches', async () => {
    const paths = await createAssistantPaths('assistant-infra-persistence-')
    await ensureAssistantState(paths)

    const session = createSession()
    await writeAssistantSession(paths, session)

    const transcriptPath = resolveAssistantTranscriptPath(paths, session.sessionId)
    await appendTranscriptEntries(paths, session.sessionId, [])
    await expect(access(transcriptPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const unchanged = await persistResolvedSession(paths, session, {
      alias: session.alias,
      bindingPatch: {},
      lookupSource: 'session-id',
    })
    expect(unchanged).toMatchObject({
      alias: session.alias,
      sessionId: session.sessionId,
      binding: {
        channel: 'telegram',
        identityId: 'user-1',
        threadId: 'thread-1',
        threadIsDirect: true,
      },
    })
    expect(unchanged.updatedAt).toEqual(expect.any(String))

    await expect(
      persistResolvedSession(paths, session, {
        alias: session.alias,
        bindingPatch: {
          threadId: 'thread-2',
        },
        lookupSource: 'alias',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_ROUTING_CONFLICT',
    })

    const rebound = await persistResolvedSession(paths, session, {
      allowBindingRebind: true,
      alias: session.alias,
      bindingPatch: {
        threadId: 'thread-2',
      },
      lookupSource: 'session-id',
    })
    expect(rebound.binding.threadId).toBe('thread-2')
    expect(rebound.sessionId).toBe(session.sessionId)

    await expect(
      loadAndPersistResolvedSession({
        maxSessionAgeMs: 1,
        now: new Date('2027-01-01T00:00:00.000Z'),
        paths,
        persistenceInput: {
          alias: null,
          bindingPatch: {},
          lookupSource: 'session-id',
        },
        sessionId: session.sessionId,
        skipIfExpired: true,
      }),
    ).resolves.toBeNull()

    const sessionPath = resolveAssistantSessionPath(paths, session.sessionId)
    expect(JSON.parse(await readFile(sessionPath, 'utf8'))).toMatchObject({
      conversationId: session.sessionId,
    })
  })

  it('covers knowledge-service empty-query, missing-page, and empty-log branches', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-infra-knowledge-',
    )
    tempRoots.push(parentRoot)

    await expect(
      searchKnowledgePages({
        query: '   ',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'knowledge_search_query_required',
    })

    await expect(
      getKnowledgePage({
        slug: 'missing-page',
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'knowledge_page_not_found',
    })

    await expect(
      tailKnowledgeLog(
        {
          limit: Number.NaN,
          vault: vaultRoot,
        },
        {
          readTextFile: async () => 'this markdown has no structured log headings',
        },
      ),
    ).resolves.toEqual({
      count: 0,
      entries: [],
      limit: 20,
      logPath: 'derived/knowledge/log.md',
      vault: vaultRoot,
    })
  })

  it('covers ESRCH swallow and non-ESRCH rethrow in process kill helper', () => {
    const killProcess = vi.fn()
    expect(() =>
      tryKillProcess(killProcess, 321, 'SIGTERM'),
    ).not.toThrow()
    expect(killProcess).toHaveBeenCalledWith(321, 'SIGTERM')

    expect(() =>
      tryKillProcess(
        () => {
          throw Object.assign(new Error('gone'), {
            code: 'ESRCH',
          })
        },
        123,
        'SIGTERM',
      ),
    ).not.toThrow()

    expect(() =>
      tryKillProcess(
        () => {
          throw Object.assign(new Error('permission denied'), {
            code: 'EPERM',
          })
        },
        123,
        'SIGTERM',
      ),
    ).toThrow('permission denied')

    expect(() =>
      tryKillProcess(
        () => {
          throw new Error('plain error')
        },
        123,
        'SIGTERM',
      ),
    ).toThrow('plain error')

    expect(() =>
      tryKillProcess(
        () => {
          throw 'boom'
        },
        123,
        'SIGTERM',
      ),
    ).toThrow('boom')
  })
})

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
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
    alias: input?.alias ?? 'alpha',
    binding: {
      actorId: null,
      channel: conversationKey ? 'telegram' : null,
      conversationKey,
      delivery: null,
      identityId: conversationKey ? 'user-1' : null,
      threadId: conversationKey ? threadId : null,
      threadIsDirect: conversationKey ? true : null,
    },
    createdAt: input?.createdAt ?? '2026-04-08T00:00:00.000Z',
    lastTurnAt: input?.lastTurnAt ?? null,
    resumeState: null,
    schema: 'murph.assistant-session.v1',
    sessionId,
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    turnCount: 2,
    updatedAt: input?.updatedAt ?? '2026-04-08T00:05:00.000Z',
  })
}
