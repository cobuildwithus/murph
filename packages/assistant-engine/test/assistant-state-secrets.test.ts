import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  assistantSessionSecretsSchema,
  parseAssistantSessionRecord,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as quarantineModule from '../src/assistant/quarantine.ts'
import {
  assertAssistantCronJobId,
  assertAssistantCronRunId,
  assertAssistantOutboxIntentId,
  assertAssistantSessionId,
  assertAssistantTurnId,
  resolveAssistantOpaqueStateFilePath,
} from '../src/assistant/state-ids.ts'
import { isValidAssistantOpaqueId } from '@murphai/runtime-state/assistant-ids'
import {
  extractAssistantSessionSecretsForPersistence,
  mergeAssistantSessionSecrets,
  persistAssistantSessionSecrets,
  readAssistantSessionSecrets,
  resolveAssistantSessionSecretsPath,
} from '../src/assistant/state-secrets.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

afterEach(async () => {
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('../src/assistant/quarantine.ts')
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

describe('assistant state ids', () => {
  it('normalizes valid opaque ids across the assistant runtime id helpers', () => {
    const validCases = [
      ['session', assertAssistantSessionId],
      ['turn', assertAssistantTurnId],
      ['intent', assertAssistantOutboxIntentId],
      ['cron_job', assertAssistantCronJobId],
      ['cron_run', assertAssistantCronRunId],
    ] as const

    for (const [value, assertId] of validCases) {
      expect(assertId(` ${value} `)).toBe(value)
    }

    expect(isValidAssistantOpaqueId('a'.repeat(192))).toBe(true)
    expect(isValidAssistantOpaqueId('a'.repeat(193))).toBe(false)
    expect(isValidAssistantOpaqueId('session/path')).toBe(false)
    expect(isValidAssistantOpaqueId('../session')).toBe(false)
    expect(isValidAssistantOpaqueId(null)).toBe(false)
  })

  it('keeps resolved runtime paths inside the requested directory', () => {
    const directory = path.join('/tmp', 'assistant-state-ids')

    expect(
      resolveAssistantOpaqueStateFilePath({
        directory,
        extension: '.json',
        kind: 'turn',
        value: ' turn_123 ',
      }),
    ).toBe(path.resolve(directory, 'turn_123.json'))

    expect(() =>
      resolveAssistantOpaqueStateFilePath({
        directory,
        extension: '/../../escaped.json',
        kind: 'turn',
        value: 'turn_123',
      }),
    ).toThrowError(/resolve inside the expected runtime storage directory/u)
  })

  it('reports null values in invalid opaque id errors', () => {
    expect(() => assertAssistantSessionId(null)).toThrowError(/opaque runtime ids/u)
    expect(() =>
      resolveAssistantOpaqueStateFilePath({
        directory: path.join('/tmp', 'assistant-state-ids'),
        extension: '.json',
        kind: 'cron run',
        value: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'ASSISTANT_INVALID_RUNTIME_ID',
        context: expect.objectContaining({
          kind: 'cron run',
          value: null,
        }),
      }),
    )
  })
})

describe('assistant session secret sidecars', () => {
  it('extracts secret headers into a sidecar and leaves persisted headers inline', () => {
    const session = createOpenAiSession()

    const result = extractAssistantSessionSecretsForPersistence(session)

    expect(result.migratedHeaderNames).toEqual(['Authorization', 'Cookie'])
    expect(result.persisted.target).toEqual({
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.example.com/v1',
      headers: {
        'X-Trace': 'trace-123',
      },
      model: 'gpt-5.4',
      presetId: null,
      providerName: 'murph-openai',
      reasoningEffort: 'medium',
      webSearch: null,
    })
    expect(result.secrets).toEqual({
      schema: 'murph.assistant-session-secrets.v1',
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      providerHeaders: {
        Authorization: 'Bearer secret-token',
        Cookie: 'session-cookie',
      },
    })
  })

  it('returns no sidecar data for non-openai targets and leaves merge unchanged without secrets', () => {
    const session = createCodexSession()

    const result = extractAssistantSessionSecretsForPersistence(session)

    expect(result.migratedHeaderNames).toEqual([])
    expect(result.persisted.target).toEqual(session.target)
    expect(result.secrets).toBeNull()
    expect(mergeAssistantSessionSecrets(session, null)).toBe(session)
  })

  it('leaves non-openai sessions unchanged even if a legacy secret sidecar is present', () => {
    const session = createCodexSession()
    const secrets = extractAssistantSessionSecretsForPersistence(createOpenAiSession()).secrets

    const merged = mergeAssistantSessionSecrets(session, secrets)

    expect(merged).toBe(session)
  })

  it('merges sidecar headers back into persisted sessions and provider options', () => {
    const extracted = extractAssistantSessionSecretsForPersistence(createOpenAiSession())
    const hydratedSession = parseAssistantSessionRecord(extracted.persisted)

    const merged = mergeAssistantSessionSecrets(hydratedSession, extracted.secrets)

    expect(merged.target).toMatchObject({
      adapter: 'openai-compatible',
      headers: {
        Authorization: 'Bearer secret-token',
        Cookie: 'session-cookie',
        'X-Trace': 'trace-123',
      },
    })
    expect(merged.providerOptions.headers).toEqual({
      Authorization: 'Bearer secret-token',
      Cookie: 'session-cookie',
      'X-Trace': 'trace-123',
    })
  })

  it('rejects sidecars whose embedded session identity does not match the session', () => {
    const extracted = extractAssistantSessionSecretsForPersistence(createOpenAiSession())
    const hydratedSession = parseAssistantSessionRecord(extracted.persisted)
    if (!extracted.secrets) {
      throw new Error('Expected openai-compatible session secrets.')
    }
    const mismatchedSecrets = assistantSessionSecretsSchema.parse({
      ...extracted.secrets,
      sessionId: 'session-beta',
    })

    expect(() =>
      mergeAssistantSessionSecrets(hydratedSession, mismatchedSecrets),
    ).toThrowError(
      expect.objectContaining({
        code: 'ASSISTANT_SESSION_SECRETS_MISMATCH',
      }),
    )
  })

  it('rebuilds provider binding headers from the target owner when resuming an openai session', () => {
    const session = parseAssistantSessionRecord({
      schema: 'murph.assistant-session.v1',
      sessionId: 'sess_headers_roundtrip',
      target: {
        adapter: 'openai-compatible',
        apiKeyEnv: null,
        endpoint: 'https://api.example.com/v1',
        headers: {
          'X-Trace-Id': 'trace-123',
        },
        model: 'gpt-test',
        presetId: null,
        providerName: null,
        reasoningEffort: null,
        webSearch: null,
      },
      resumeState: {
        providerSessionId: 'provider-session-123',
        resumeRouteId: 'resume-route-123',
      },
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
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z',
      lastTurnAt: null,
      turnCount: 0,
    })
    const secrets = assistantSessionSecretsSchema.parse({
      schema: 'murph.assistant-session-secrets.v1',
      sessionId: session.sessionId,
      updatedAt: session.updatedAt,
      providerHeaders: {
        'X-Upstream-Auth': 'Bearer firstsecret123',
      },
    })

    const merged = mergeAssistantSessionSecrets(session, secrets)

    expect(merged.target.adapter).toBe('openai-compatible')
    if (merged.target.adapter !== 'openai-compatible') {
      throw new Error('Expected an openai-compatible session target.')
    }
    expect(merged.target.headers).toEqual({
      'X-Trace-Id': 'trace-123',
      'X-Upstream-Auth': 'Bearer firstsecret123',
    })
    expect(merged.providerOptions.headers).toEqual({
      'X-Trace-Id': 'trace-123',
      'X-Upstream-Auth': 'Bearer firstsecret123',
    })
    expect(merged.resumeState).toEqual({
      providerSessionId: 'provider-session-123',
      resumeRouteId: 'resume-route-123',
    })
  })

  it('writes, reads, and removes secret sidecars in the session secrets directory', async () => {
    const paths = await createAssistantPaths('assistant-state-secrets-')
    const session = createOpenAiSession()
    const extracted = extractAssistantSessionSecretsForPersistence(session)
    if (!extracted.secrets) {
      throw new Error('Expected openai-compatible session secrets.')
    }
    const secretsPath = resolveAssistantSessionSecretsPath(paths, session.sessionId)

    await persistAssistantSessionSecrets({
      paths,
      secrets: extracted.secrets,
      sessionId: session.sessionId,
    })

    expect(JSON.parse(await readFile(secretsPath, 'utf8'))).toEqual(extracted.secrets)
    await expect(
      readAssistantSessionSecrets({
        paths,
        sessionId: session.sessionId,
      }),
    ).resolves.toEqual(extracted.secrets)

    await persistAssistantSessionSecrets({
      paths,
      secrets: null,
      sessionId: session.sessionId,
    })

    await expect(readFile(secretsPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(
      readAssistantSessionSecrets({
        paths,
        sessionId: session.sessionId,
      }),
    ).resolves.toBeNull()
  })

  it('quarantines valid sidecars stored under the wrong session filename', async () => {
    const paths = await createAssistantPaths('assistant-state-secrets-mismatched-')
    const session = createOpenAiSession()
    const extracted = extractAssistantSessionSecretsForPersistence(session)
    const secretsPath = resolveAssistantSessionSecretsPath(paths, session.sessionId)

    await mkdir(path.dirname(secretsPath), {
      recursive: true,
    })
    await writeFile(
      secretsPath,
      JSON.stringify({
        ...extracted.secrets,
        sessionId: 'session-beta',
      }),
      'utf8',
    )

    await expect(
      readAssistantSessionSecrets({
        paths,
        sessionId: session.sessionId,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_SECRETS_MISMATCH',
      context: expect.objectContaining({
        expectedSessionId: session.sessionId,
        sidecarSessionId: 'session-beta',
      }),
    })

    await expect(readFile(secretsPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const quarantines = await quarantineModule.listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'session',
    })
    expect(quarantines).toHaveLength(1)
    await expect(readFile(quarantines[0]!.quarantinedPath, 'utf8')).resolves.toContain(
      '"sessionId":"session-beta"',
    )
  })

  it('quarantines stale sidecars whose updatedAt no longer matches the session', async () => {
    const paths = await createAssistantPaths('assistant-state-secrets-stale-')
    const session = createOpenAiSession()
    const extracted = extractAssistantSessionSecretsForPersistence(session)
    const secretsPath = resolveAssistantSessionSecretsPath(paths, session.sessionId)
    const staleUpdatedAt = '2026-04-07T23:59:59.000Z'

    await mkdir(path.dirname(secretsPath), {
      recursive: true,
    })
    await writeFile(
      secretsPath,
      JSON.stringify({
        ...extracted.secrets,
        updatedAt: staleUpdatedAt,
      }),
      'utf8',
    )

    await expect(
      readAssistantSessionSecrets({
        paths,
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_SECRETS_MISMATCH',
      context: expect.objectContaining({
        expectedSessionId: session.sessionId,
        expectedUpdatedAt: session.updatedAt,
        sidecarUpdatedAt: staleUpdatedAt,
      }),
    })

    await expect(readFile(secretsPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const quarantines = await quarantineModule.listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'session',
    })
    expect(quarantines).toHaveLength(1)
    await expect(readFile(quarantines[0]!.quarantinedPath, 'utf8')).resolves.toContain(
      `"updatedAt":"${staleUpdatedAt}"`,
    )
  })

  it('quarantines corrupted secret sidecars and raises a targeted runtime error', async () => {
    const paths = await createAssistantPaths('assistant-state-secrets-corrupt-')
    const sessionId = 'session-corrupt'
    const secretsPath = resolveAssistantSessionSecretsPath(paths, sessionId)

    await mkdir(path.dirname(secretsPath), {
      recursive: true,
    })
    await writeFile(
      secretsPath,
      JSON.stringify({
        schema: 'murph.assistant-session-secrets.v1',
        sessionId: 42,
      }),
      'utf8',
    )

    await expect(
      readAssistantSessionSecrets({
        paths,
        sessionId,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_SECRETS_CORRUPTED',
      context: expect.objectContaining({
        filePath: secretsPath,
        sessionId,
      }),
      name: 'VaultCliError',
    })

    await expect(readFile(secretsPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const quarantines = await quarantineModule.listAssistantQuarantineEntriesAtPaths(paths, {
      artifactKind: 'session',
    })

    expect(quarantines).toHaveLength(1)
    expect(quarantines[0]).toMatchObject({
      artifactKind: 'session',
      metadataPath: `${quarantines[0]?.quarantinedPath}.meta.json`,
      originalPath: secretsPath,
    })
    await expect(readFile(quarantines[0]!.quarantinedPath, 'utf8')).resolves.toContain(
      '"sessionId":42',
    )
  })

  it('still raises the corrupted-sidecar error when quarantine persistence fails', async () => {
    const paths = await createAssistantPaths('assistant-state-secrets-corrupt-no-quarantine-')
    const sessionId = 'session-corrupt-no-quarantine'
    const secretsPath = resolveAssistantSessionSecretsPath(paths, sessionId)

    await mkdir(path.dirname(secretsPath), {
      recursive: true,
    })
    await writeFile(secretsPath, '{', 'utf8')

    vi.spyOn(quarantineModule, 'quarantineAssistantStateFile').mockRejectedValue(
      new Error('quarantine unavailable'),
    )

    await expect(
      readAssistantSessionSecrets({
        paths,
        sessionId,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_SECRETS_CORRUPTED',
      context: expect.objectContaining({
        filePath: secretsPath,
        sessionId,
      }),
      name: 'VaultCliError',
    })

    await expect(readFile(secretsPath, 'utf8')).resolves.toBe('{')
  })

  it('stringifies non-Error secret-sidecar read failures in the raised context', async () => {
    const paths = await createAssistantPaths('assistant-state-secrets-non-error-')
    const sessionId = 'session-corrupt-string-reason'

    vi.resetModules()
    vi.doMock('node:fs/promises', async () => {
      const actual =
        await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        readFile: vi.fn().mockRejectedValue('non-error read failure'),
      }
    })
    vi.doMock('../src/assistant/quarantine.ts', async () => {
      const actual =
        await vi.importActual<typeof import('../src/assistant/quarantine.ts')>(
          '../src/assistant/quarantine.ts',
        )
      return {
        ...actual,
        quarantineAssistantStateFile: vi.fn().mockResolvedValue(null),
      }
    })

    const { readAssistantSessionSecrets: readAssistantSessionSecretsWithMockedRead } =
      await import('../src/assistant/state-secrets.ts')

    await expect(
      readAssistantSessionSecretsWithMockedRead({
        paths,
        sessionId,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_SECRETS_CORRUPTED',
      context: expect.objectContaining({
        reason: 'non-error read failure',
        sessionId,
      }),
      name: 'VaultCliError',
    })
  })

  it('rejects invalid session ids when resolving secret sidecar paths', async () => {
    const paths = await createAssistantPaths('assistant-state-secrets-path-')

    expect(() => resolveAssistantSessionSecretsPath(paths, '../session')).toThrowError(
      /opaque runtime ids/u,
    )
  })
})

async function createAssistantPaths(prefix: string) {
  const context = await createTempVaultContext(prefix)
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
}

function createOpenAiSession(): AssistantSession {
  return parseAssistantSessionRecord({
    schema: 'murph.assistant-session.v1',
    sessionId: 'session-alpha',
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
    alias: 'alpha',
    binding: {
      conversationKey: 'telegram:user-1:thread-1',
      channel: 'telegram',
      identityId: 'user-1',
      actorId: null,
      threadId: 'thread-1',
      threadIsDirect: true,
      delivery: null,
    },
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:05:00.000Z',
    lastTurnAt: null,
    turnCount: 2,
  })
}

function createCodexSession(): AssistantSession {
  return parseAssistantSessionRecord({
    schema: 'murph.assistant-session.v1',
    sessionId: 'session-codex',
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
    updatedAt: '2026-04-08T00:05:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
  })
}
