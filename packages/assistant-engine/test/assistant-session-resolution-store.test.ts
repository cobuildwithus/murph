import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

import {
  createAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import { afterEach, describe, expect, it } from 'vitest'

import {
  appendAssistantTranscriptEntries,
  getAssistantSession,
  listAssistantTranscriptEntries,
  listAssistantSessions,
  resolveAssistantSession,
  resolveAssistantStatePaths,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import {
  resolveAssistantSessionPath,
  resolveAssistantSessionRoutingDatabasePath,
} from '../src/assistant/store/persistence.ts'
import { resolveLegacyAssistantConversationKey } from '../src/assistant/bindings.ts'
import {
  resolveAssistantSessionForMessage,
} from '../src/assistant/session-resolution.ts'
import { resolveAssistantExecutionPlan } from '../src/assistant/execution-plan.ts'
import {
  readCodexThreadRouteFingerprint,
} from '../src/assistant/codex-thread-route.ts'
import { createTempVaultContext } from './test-helpers.ts'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant session resolution store integration', () => {
  it('prepares only session persistence directories during creation and warm lookup', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-directories-',
    )
    cleanupPaths.push(parentRoot)
    const created = await resolveAssistantSession({
      alias: 'directory-test',
      target: createCodexTarget(),
      vault: vaultRoot,
    })
    const { paths } = created
    const persistenceDirectories = [
      paths.sessionsDirectory,
      paths.stateDirectory,
      paths.sessionSecretsDirectory,
    ]
    for (const directory of persistenceDirectories) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
      await chmod(directory, 0o755)
    }

    const resolved = await resolveAssistantSession({
      alias: 'directory-test',
      createIfMissing: false,
      vault: vaultRoot,
    })
    expect(resolved.session.sessionId).toBe(created.session.sessionId)
    expect(await getAssistantSession(vaultRoot, created.session.sessionId))
      .toEqual(resolved.session)
    for (const directory of persistenceDirectories) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
    }
    for (const directory of [
      paths.transcriptsDirectory,
      paths.outboxDirectory,
      paths.turnsDirectory,
      paths.diagnosticsDirectory,
      paths.issuesDirectory,
      paths.quarantineDirectory,
    ]) {
      await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it.each([
    'sessionsDirectory',
    'stateDirectory',
    'sessionSecretsDirectory',
  ] as const)('rejects a replaced %s before resolving or updating a session', async (directoryKey) => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-directory-symlink-',
    )
    cleanupPaths.push(parentRoot)
    const created = await resolveAssistantSession({
      alias: 'original-alias',
      target: createCodexTarget(),
      vault: vaultRoot,
    })
    const directory = created.paths[directoryKey]
    const outside = path.join(parentRoot, 'outside')
    await mkdir(outside, { mode: 0o755 })
    const outsideFile = path.join(outside, `${created.session.sessionId}.json`)
    await writeFile(outsideFile, 'must remain untouched', 'utf8')
    await rm(directory, { recursive: true })
    await symlink(outside, directory)

    await expect(resolveAssistantSession({
      alias: 'changed-alias',
      sessionId: created.session.sessionId,
      vault: vaultRoot,
    })).rejects.toThrow(/symlinks/u)
    if (directoryKey === 'sessionsDirectory') {
      await expect(getAssistantSession(vaultRoot, created.session.sessionId))
        .rejects.toThrow(/symlinks/u)
    }
    expect(await readFile(outsideFile, 'utf8')).toBe('must remain untouched')
    expect((await stat(outside)).mode & 0o777).toBe(0o755)
    expect(await readdir(outside)).toEqual([`${created.session.sessionId}.json`])
  })

  it('validates transcript storage only when diagnosing a missing session', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-missing-directory-',
    )
    cleanupPaths.push(parentRoot)
    const paths = resolveAssistantStatePaths(vaultRoot)
    const sessionId = 'session-missing'
    await appendAssistantTranscriptEntries(vaultRoot, sessionId, [{
      kind: 'user',
      text: 'Synthetic transcript retained after session removal.',
    }])
    await expect(getAssistantSession(vaultRoot, sessionId)).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_NOT_FOUND',
      context: {
        sessionExists: false,
        transcriptExists: true,
      },
    })

    const outside = path.join(parentRoot, 'outside')
    await mkdir(outside, { mode: 0o755 })
    await rm(paths.transcriptsDirectory, { recursive: true })
    await symlink(outside, paths.transcriptsDirectory)
    await expect(getAssistantSession(vaultRoot, sessionId)).rejects.toThrow(/symlinks/u)
    await expect(resolveAssistantSession({ sessionId, vault: vaultRoot }))
      .rejects.toThrow(/symlinks/u)
    expect((await stat(outside)).mode & 0o777).toBe(0o755)
  })

  it('creates private recovery directories only when routing or session corruption needs them', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-directory-recovery-',
    )
    cleanupPaths.push(parentRoot)
    const created = await resolveAssistantSession({
      alias: 'recoverable-alias',
      target: createCodexTarget(),
      vault: vaultRoot,
    })
    const { paths } = created
    const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
    await rm(databasePath)
    expect((await resolveAssistantSession({
      alias: 'recoverable-alias',
      createIfMissing: false,
      vault: vaultRoot,
    })).session.sessionId).toBe(created.session.sessionId)

    await writeFile(databasePath, 'corrupted projection', 'utf8')
    await rm(paths.journalsDirectory, { recursive: true })
    expect((await resolveAssistantSession({
      alias: 'recoverable-alias',
      createIfMissing: false,
      vault: vaultRoot,
    })).session.sessionId).toBe(created.session.sessionId)
    for (const directory of [
      paths.quarantineDirectory,
      path.join(paths.quarantineDirectory, 'indexes'),
      paths.journalsDirectory,
    ]) {
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
    }

    const sessionPath = resolveAssistantSessionPath(paths, created.session.sessionId)
    await writeFile(sessionPath, '{corrupted session', 'utf8')
    await expect(getAssistantSession(vaultRoot, created.session.sessionId))
      .rejects.toMatchObject({ code: 'ASSISTANT_SESSION_CORRUPTED' })
    await expect(stat(sessionPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(path.join(paths.quarantineDirectory, 'session'))).mode & 0o777)
      .toBe(0o700)
  })

  it('preserves conversation-key sessions before applying partial message target overrides', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-store-',
    )
    cleanupPaths.push(parentRoot)

    const sessionTarget = createCodexTarget({
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'low',
    })
    const created = await resolveAssistantSession({
      actorId: 'linq-participant',
      channel: 'linq',
      identityId: 'linq-identity',
      target: sessionTarget,
      threadId: 'linq-thread',
      threadIsDirect: true,
      vault: vaultRoot,
    })
    await saveAssistantSession(vaultRoot, {
      ...created.session,
      resumeState: {
        routeFingerprint: readCodexThreadRouteFingerprint(
          resolveAssistantExecutionPlan({
            defaults: null,
            sessionTarget,
          }).codexRoute,
        ),
        threadId: 'thread_low',
      },
    })

    const resolved = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: sessionTarget,
      defaults: null,
      message: {
        actorId: 'linq-participant',
        channel: 'linq',
        identityId: 'linq-identity',
        prompt: 'Ask about the activity.',
        reasoningEffort: 'high',
        threadId: 'linq-thread',
        threadIsDirect: true,
        vault: vaultRoot,
      },
    })

    expect(resolved.created).toBe(false)
    expect(resolved.resolutionDiagnostics).toMatchObject({
      conversationLookupMatchedScope: 'thread',
      sessionResolutionLookupSource: 'conversation-key',
    })
    expect(resolved.session.sessionId).toBe(created.session.sessionId)
    expect(resolved.session.target).toEqual(createCodexTarget({
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'high',
    }))
    expect(resolved.session.resumeState).toMatchObject({
      threadId: 'thread_low',
      threadCompatibilityFingerprint: expect.any(String),
    })

    const sessions = await listAssistantSessions(vaultRoot)
    expect(sessions.map((session) => session.sessionId)).toEqual([
      created.session.sessionId,
    ])
  })

  it('keeps automation target overrides out of durable session targets', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-turn-scoped-',
    )
    cleanupPaths.push(parentRoot)

    const sessionTarget = createCodexTarget({
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'low',
    })
    const created = await resolveAssistantSession({
      actorId: 'linq-participant',
      channel: 'linq',
      identityId: 'linq-identity',
      target: sessionTarget,
      threadId: 'linq-thread',
      threadIsDirect: true,
      vault: vaultRoot,
    })

    const resolved = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: sessionTarget,
      defaults: null,
      message: {
        actorId: 'linq-participant',
        channel: 'linq',
        identityId: 'linq-identity',
        prompt: 'Ask about the activity.',
        assistantTargetOverride: {
          reasoningEffort: 'high',
        },
        threadId: 'linq-thread',
        threadIsDirect: true,
        vault: vaultRoot,
      },
    })

    expect(resolved.created).toBe(false)
    expect(resolved.session.sessionId).toBe(created.session.sessionId)
    expect(resolved.session.target).toEqual(sessionTarget)

    const sessions = await listAssistantSessions(vaultRoot)
    expect(sessions.map((session) => session.sessionId)).toEqual([
      created.session.sessionId,
    ])
    expect(sessions[0]?.target).toEqual(sessionTarget)
  })

  it('creates automation target override sessions with the durable base target', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-turn-scoped-create-',
    )
    cleanupPaths.push(parentRoot)

    const durableTarget = createCodexTarget({
      model: 'gpt-5-session',
      modelProvider: 'vercel-ai-gateway',
      profile: 'session-profile',
      reasoningEffort: 'low',
    })

    const resolved = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: durableTarget,
      defaults: null,
      message: {
        actorId: 'linq-participant',
        channel: 'linq',
        identityId: 'linq-identity',
        prompt: 'Ask about the activity.',
        assistantTargetOverride: {
          reasoningEffort: 'high',
        },
        threadId: 'linq-thread',
        threadIsDirect: true,
        vault: vaultRoot,
      },
    })

    expect(resolved.created).toBe(true)
    expect(resolved.session.target).toEqual(durableTarget)

    const sessions = await listAssistantSessions(vaultRoot)
    expect(sessions.map((session) => session.sessionId)).toEqual([
      resolved.session.sessionId,
    ])
    expect(sessions[0]?.target).toEqual(durableTarget)
  })

  it('allows group speaker drift but starts new continuity when the audience changes', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-group-rebind-',
    )
    cleanupPaths.push(parentRoot)

    const created = await resolveAssistantSession({
      actorId: 'linq-member-a',
      channel: 'linq',
      identityId: 'linq-line',
      target: createCodexTarget(),
      threadId: 'group-thread',
      threadIsDirect: false,
      vault: vaultRoot,
    })
    expect(created.session.binding.actorId).toBe('linq-member-a')
    expect(created.session.binding.threadIsDirect).toBe(false)

    // A later message on the same group thread may update the active speaker
    // without changing the audience-scoped continuity boundary.
    const resolved = await resolveAssistantSession({
      actorId: 'linq-member-b',
      channel: 'linq',
      createIfMissing: false,
      identityId: 'linq-line',
      threadId: 'group-thread',
      threadIsDirect: false,
      vault: vaultRoot,
    })

    expect(resolved.created).toBe(false)
    expect(resolved.session.sessionId).toBe(created.session.sessionId)
    expect(resolved.resolutionDiagnostics).toMatchObject({
      conversationLookupMatchedScope: 'thread',
      sessionResolutionLookupSource: 'conversation-key',
    })
    expect(resolved.session.binding.actorId).toBe('linq-member-b')
    expect(resolved.session.binding.threadIsDirect).toBe(false)

    // Reclassification to direct starts a separate session so the group
    // transcript cannot be resumed in a private turn (or vice versa).
    const direct = await resolveAssistantSession({
      actorId: 'linq-member-b',
      channel: 'linq',
      identityId: 'linq-line',
      target: createCodexTarget(),
      threadId: 'group-thread',
      threadIsDirect: true,
      vault: vaultRoot,
    })
    expect(direct.created).toBe(true)
    expect(direct.session.sessionId).not.toBe(created.session.sessionId)

    const sessions = await listAssistantSessions(vaultRoot)
    expect(sessions.map((session) => session.sessionId).sort()).toEqual([
      created.session.sessionId,
      direct.session.sessionId,
    ].sort())
  })

  it('migrates a provably direct legacy Telegram session to the audience key once', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-legacy-direct-',
    )
    cleanupPaths.push(parentRoot)
    const locator = {
      actorId: 'telegram-member',
      channel: 'telegram',
      identityId: 'telegram-bot',
      threadId: 'telegram-thread',
      threadIsDirect: true,
    } as const
    const created = await resolveAssistantSession({
      ...locator,
      target: createCodexTarget(),
      vault: vaultRoot,
    })
    const legacyKey = resolveLegacyAssistantConversationKey(locator)
    expect(legacyKey).not.toBeNull()
    await saveAssistantSession(vaultRoot, {
      ...created.session,
      binding: {
        ...created.session.binding,
        conversationKey: legacyKey,
      },
    })

    const migrated = await resolveAssistantSession({
      ...locator,
      createIfMissing: false,
      vault: vaultRoot,
    })
    expect(migrated.created).toBe(false)
    expect(migrated.session.sessionId).toBe(created.session.sessionId)
    expect(migrated.session.binding.conversationKey).toContain('|audience:direct|')
    expect(migrated.resolutionDiagnostics).toMatchObject({
      legacyAudienceContinuity: 'migrated',
      sessionResolutionLookupSource: 'conversation-key',
    })

    const repeated = await resolveAssistantSession({
      ...locator,
      createIfMissing: false,
      vault: vaultRoot,
    })
    expect(repeated.session.sessionId).toBe(created.session.sessionId)
    expect(repeated.resolutionDiagnostics).not.toHaveProperty('legacyAudienceContinuity')
  })

  it.each([true, false])(
    'explicitly resets an unprovable legacy Linq audience (direct=%s)',
    async (threadIsDirect) => {
      const { parentRoot, vaultRoot } = await createTempVaultContext(
        `assistant-session-resolution-legacy-linq-${String(threadIsDirect)}-`,
      )
      cleanupPaths.push(parentRoot)
      const locator = {
        actorId: 'linq-member',
        channel: 'linq',
        identityId: 'linq-line',
        threadId: 'linq-thread',
        threadIsDirect,
      } as const
      const legacy = await resolveAssistantSession({
        ...locator,
        target: createCodexTarget(),
        vault: vaultRoot,
      })
      await appendAssistantTranscriptEntries(vaultRoot, legacy.session.sessionId, [
        {
          kind: 'assistant',
          text: 'legacy audience history must not cross the reset',
        },
      ])
      await saveAssistantSession(vaultRoot, {
        ...legacy.session,
        binding: {
          ...legacy.session.binding,
          conversationKey: resolveLegacyAssistantConversationKey(locator),
        },
      })

      const reset = await resolveAssistantSession({
        ...locator,
        target: createCodexTarget(),
        vault: vaultRoot,
      })
      expect(reset.created).toBe(true)
      expect(reset.session.sessionId).not.toBe(legacy.session.sessionId)
      expect(reset.resolutionDiagnostics).toMatchObject({
        legacyAudienceContinuity: 'reset',
        sessionResolutionLookupSource: 'created',
      })
      const retired = await getAssistantSession(vaultRoot, legacy.session.sessionId)
      expect(retired.binding.conversationKey).toBeNull()
      expect(retired.updatedAt).toBe(legacy.session.updatedAt)
      expect(
        await listAssistantTranscriptEntries(vaultRoot, reset.session.sessionId),
      ).toEqual([])

      const repeated = await resolveAssistantSession({
        ...locator,
        createIfMissing: false,
        vault: vaultRoot,
      })
      expect(repeated.session.sessionId).toBe(reset.session.sessionId)
    },
  )

  it('still rejects a session-id resume that retargets a bound audience unless rebind is explicitly allowed', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-session-id-guard-',
    )
    cleanupPaths.push(parentRoot)

    const created = await resolveAssistantSession({
      actorId: 'linq-member-a',
      channel: 'linq',
      identityId: 'linq-line',
      target: createCodexTarget(),
      threadId: 'group-thread',
      threadIsDirect: false,
      vault: vaultRoot,
    })

    // Resolving BY session id is an explicit resume, not a routing-boundary
    // match, so retargeting to a different audience must still fail closed
    // without allowBindingRebind.
    await expect(
      resolveAssistantSession({
        actorId: 'linq-member-b',
        channel: 'linq',
        createIfMissing: false,
        identityId: 'different-line',
        sessionId: created.session.sessionId,
        threadId: 'other-thread',
        threadIsDirect: true,
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_ROUTING_CONFLICT',
    })
  })

  it('clears inherited directness when an allowed session-id rebind changes audience without directness evidence', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-session-resolution-rebind-directness-',
    )
    cleanupPaths.push(parentRoot)

    const created = await resolveAssistantSession({
      actorId: 'direct-member',
      channel: 'telegram',
      identityId: 'telegram-line',
      target: createCodexTarget(),
      threadId: 'stored-direct-thread',
      threadIsDirect: true,
      vault: vaultRoot,
    })

    const rebound = await resolveAssistantSession({
      actorId: 'direct-member',
      allowBindingRebind: true,
      channel: 'telegram',
      createIfMissing: false,
      identityId: 'telegram-line',
      sessionId: created.session.sessionId,
      threadId: 'different-thread',
      vault: vaultRoot,
    })

    expect(rebound.session.binding).toMatchObject({
      delivery: {
        kind: 'thread',
        target: 'different-thread',
      },
      threadId: 'different-thread',
      threadIsDirect: null,
    })

    const participantScoped = await resolveAssistantSession({
      actorId: 'participant-one',
      channel: 'telegram',
      identityId: 'telegram-line-two',
      target: createCodexTarget(),
      threadIsDirect: true,
      vault: vaultRoot,
    })
    const participantRebound = await resolveAssistantSession({
      actorId: 'participant-one',
      allowBindingRebind: true,
      channel: 'telegram',
      createIfMissing: false,
      identityId: 'telegram-line-two',
      sessionId: participantScoped.session.sessionId,
      threadId: 'new-thread-from-participant-scope',
      vault: vaultRoot,
    })
    expect(participantRebound.session.binding).toMatchObject({
      threadId: 'new-thread-from-participant-scope',
      threadIsDirect: null,
    })
  })
})

function createCodexTarget(
  overrides: Partial<{
    modelProvider: string
    model: string
    profile: string
    reasoningEffort: 'high' | 'low' | 'medium'
  }> = {},
): AssistantModelTarget {
  const target = createAssistantModelTarget({
    provider: 'codex-cli',
    model: 'gpt-5-codex',
    ...overrides,
  })
  if (!target) {
    throw new Error('Expected assistant model target.')
  }

  return target
}
