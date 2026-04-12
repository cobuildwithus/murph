import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, test as baseTest, vi } from 'vitest'

import { resolveAssistantStatePaths } from '@murphai/runtime-state/node'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

const test = baseTest.sequential

const runtimeMocks = vi.hoisted(() => ({
  auditAssistantStatePermissions: vi.fn(),
}))

vi.mock('@murphai/assistant-engine/assistant-runtime', async () => {
  return {
    auditAssistantStatePermissions: runtimeMocks.auditAssistantStatePermissions,
    isMissingFileError(error: unknown) {
      return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
    },
  }
})

import { inspectAndRepairAssistantStateSecrecy } from '../src/assistant/doctor-security.ts'

const BASE_SESSION: AssistantSession = {
  schema: 'murph.assistant-session.v1',
  sessionId: 'session-security-demo',
  target: {
    adapter: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpoint: 'http://127.0.0.1:11434/v1',
    headers: {
      Authorization: 'Bearer secret-token-12345678',
      'X-Workspace': 'murph',
    },
    model: null,
    presetId: null,
    providerName: 'ollama',
    reasoningEffort: null,
    webSearch: null,
  },
  resumeState: null,
  provider: 'openai-compatible',
  providerOptions: {
    continuityFingerprint: 'fingerprint-doctor-security',
    model: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    executionDriver: 'openai-compatible',
    providerName: 'ollama',
    resumeKind: null,
    headers: {
      Authorization: 'Bearer secret-token-12345678',
      'X-Workspace': 'murph',
    },
  },
  providerBinding: null,
  alias: 'chat:security',
  binding: {
    conversationKey: 'chat:security',
    channel: 'local',
    identityId: null,
    actorId: null,
    threadId: null,
    threadIsDirect: true,
    delivery: null,
  },
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  lastTurnAt: null,
  turnCount: 1,
}

function toPersistedSessionFile(session: AssistantSession) {
  return {
    schema: session.schema,
    sessionId: session.sessionId,
    target: session.target,
    resumeState: session.resumeState,
    alias: session.alias,
    binding: session.binding,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastTurnAt: session.lastTurnAt,
    turnCount: session.turnCount,
  }
}

let tempRoots: string[] = []

beforeEach(() => {
  tempRoots = []
  runtimeMocks.auditAssistantStatePermissions.mockReset()
})

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { force: true, recursive: true })),
  )
})

test('inspectAndRepairAssistantStateSecrecy counts inline secrets, malformed sidecars, and orphan sidecars', async () => {
  runtimeMocks.auditAssistantStatePermissions.mockResolvedValueOnce({
    incorrectEntries: 2,
    issues: [],
    repairedEntries: 1,
    scannedDirectories: 3,
    scannedFiles: 5,
    scannedOtherEntries: 0,
  })

  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'assistant-doctor-security-'))
  tempRoots.push(vaultRoot)
  const paths = resolveAssistantStatePaths(vaultRoot)

  await mkdir(paths.sessionsDirectory, { recursive: true })
  await mkdir(paths.sessionSecretsDirectory, { recursive: true })

  await writeFile(
    path.join(paths.sessionsDirectory, `${BASE_SESSION.sessionId}.json`),
    JSON.stringify(toPersistedSessionFile(BASE_SESSION)),
    'utf8',
  )
  await writeFile(
    path.join(paths.sessionsDirectory, 'broken.json'),
    '{not-json',
    'utf8',
  )

  await writeFile(
    path.join(paths.sessionSecretsDirectory, `${BASE_SESSION.sessionId}.json`),
    JSON.stringify({
      providerBindingHeaders: null,
      providerHeaders: {
        Authorization: 'Bearer sidecar-token-12345678',
      },
      schema: 'murph.assistant-session-secrets.v1',
      sessionId: BASE_SESSION.sessionId,
      updatedAt: BASE_SESSION.updatedAt,
    }),
    'utf8',
  )
  await writeFile(
    path.join(paths.sessionSecretsDirectory, 'session-orphan.json'),
    JSON.stringify({
      providerBindingHeaders: null,
      providerHeaders: {
        Authorization: 'Bearer orphan-token-12345678',
      },
      schema: 'murph.assistant-session-secrets.v1',
      sessionId: 'session-orphan',
      updatedAt: BASE_SESSION.updatedAt,
    }),
    'utf8',
  )
  await writeFile(
    path.join(paths.sessionSecretsDirectory, 'session-mismatch.json'),
    JSON.stringify({
      providerBindingHeaders: null,
      providerHeaders: null,
      schema: 'murph.assistant-session-secrets.v1',
      sessionId: 'different-session',
      updatedAt: BASE_SESSION.updatedAt,
    }),
    'utf8',
  )
  await writeFile(
    path.join(paths.sessionSecretsDirectory, 'session-invalid.json'),
    '{broken',
    'utf8',
  )

  const result = await inspectAndRepairAssistantStateSecrecy(paths, {
    repair: true,
  })

  assert.deepEqual(result, {
    malformedSessionSecretSidecars: 2,
    orphanSessionSecretSidecars: 1,
    permissionAudit: {
      incorrectEntries: 2,
      issues: [],
      repairedEntries: 1,
      scannedDirectories: 3,
      scannedFiles: 5,
      scannedOtherEntries: 0,
    },
    sessionFilesScanned: 1,
    sessionInlineSecretFiles: 1,
    sessionInlineSecretHeaders: 1,
    sessionSecretSidecarFiles: 4,
  })

  assert.deepEqual(runtimeMocks.auditAssistantStatePermissions.mock.calls[0]?.[0], {
    repair: true,
    rootPath: paths.assistantStateRoot,
  })
})

test('inspectAndRepairAssistantStateSecrecy tolerates missing assistant state directories', async () => {
  runtimeMocks.auditAssistantStatePermissions.mockResolvedValueOnce({
    incorrectEntries: 0,
    issues: [],
    repairedEntries: 0,
    scannedDirectories: 0,
    scannedFiles: 0,
    scannedOtherEntries: 0,
  })

  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'assistant-doctor-security-empty-'))
  tempRoots.push(vaultRoot)
  const paths = resolveAssistantStatePaths(vaultRoot)

  const result = await inspectAndRepairAssistantStateSecrecy(paths)

  assert.deepEqual(result, {
    malformedSessionSecretSidecars: 0,
    orphanSessionSecretSidecars: 0,
    permissionAudit: {
      incorrectEntries: 0,
      issues: [],
      repairedEntries: 0,
      scannedDirectories: 0,
      scannedFiles: 0,
      scannedOtherEntries: 0,
    },
    sessionFilesScanned: 0,
    sessionInlineSecretFiles: 0,
    sessionInlineSecretHeaders: 0,
    sessionSecretSidecarFiles: 0,
  })
})

test('inspectAndRepairAssistantStateSecrecy ignores non-json files and surfaces unexpected directory failures', async () => {
  runtimeMocks.auditAssistantStatePermissions.mockResolvedValueOnce({
    incorrectEntries: 0,
    issues: [],
    repairedEntries: 0,
    scannedDirectories: 0,
    scannedFiles: 0,
    scannedOtherEntries: 0,
  })

  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'assistant-doctor-security-extra-'))
  tempRoots.push(vaultRoot)
  const paths = resolveAssistantStatePaths(vaultRoot)

  await mkdir(paths.sessionsDirectory, { recursive: true })
  await mkdir(path.dirname(paths.sessionSecretsDirectory), { recursive: true })
  await writeFile(path.join(paths.sessionsDirectory, 'note.txt'), 'ignore me', 'utf8')
  await writeFile(paths.sessionSecretsDirectory, 'not-a-directory', 'utf8')

  await assert.rejects(() => inspectAndRepairAssistantStateSecrecy(paths))
})
