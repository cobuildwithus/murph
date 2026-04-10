import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { getEventListeners } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  applyCanonicalWriteBatch,
  initializeVault,
  isVaultError,
  listWriteOperationMetadataPaths,
  readJsonlRecords,
  updateVaultSummary,
} from '@murphai/core'
import {
  createInboxPipeline,
  openInboxRuntime,
} from '@murphai/inboxd'
import { afterEach, beforeEach, test, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  deliverAssistantMessageOverBinding: vi.fn(),
  executeAssistantProviderTurnAttempt: vi.fn(),
  executeAssistantProviderTurn: vi.fn(),
  getAssistantChannelAdapter: vi.fn(),
}))

async function readJsonlRecordsIfPresent(vaultRoot: string, relativePath: string) {
  try {
    return await readJsonlRecords({ vaultRoot, relativePath })
  } catch (error) {
    if (isVaultError(error) && error.code === 'VAULT_FILE_MISSING') {
      return []
    }

    throw error
  }
}

vi.mock('@murphai/assistant-engine/outbound-channel', async () => {
  const actual = await vi.importActual<typeof import('@murphai/assistant-engine/outbound-channel')>(
    '@murphai/assistant-engine/outbound-channel',
  )

  return {
    ...actual,
    deliverAssistantMessageOverBinding:
      serviceMocks.deliverAssistantMessageOverBinding,
  }
})

vi.mock('@murphai/assistant-engine/assistant-provider', async () => {
  const actual = await vi.importActual<typeof import('@murphai/assistant-engine/assistant-provider')>(
    '@murphai/assistant-engine/assistant-provider',
  )

  return {
    ...actual,
    executeAssistantProviderTurnAttempt:
      serviceMocks.executeAssistantProviderTurnAttempt,
    executeAssistantProviderTurn: serviceMocks.executeAssistantProviderTurn,
  }
})

vi.mock('@murphai/assistant-engine/assistant/channel-adapters', async () => {
  const actual = await vi.importActual<typeof import('@murphai/assistant-engine/assistant/channel-adapters')>(
    '@murphai/assistant-engine/assistant/channel-adapters',
  )

  return {
    ...actual,
    getAssistantChannelAdapter: (
      ...args: Parameters<typeof actual.getAssistantChannelAdapter>
    ) => {
      const implementation =
        serviceMocks.getAssistantChannelAdapter.getMockImplementation()
      if (implementation) {
        return serviceMocks.getAssistantChannelAdapter(...args)
      }

      return actual.getAssistantChannelAdapter(...args)
    },
  }
})

import {
  buildResolveAssistantSessionInput,
  sendAssistantMessage,
} from '@murphai/assistant-cli/assistant/service'
import type { AssistantToolCatalog } from '@murphai/assistant-engine/model-harness'
import { resolveAssistantStateDocumentPath } from '@murphai/assistant-engine/assistant/state'
import {
  resolveAssistantMemoryTurnContext,
} from '@murphai/assistant-engine/assistant/memory'
import {
  resolveAssistantConversationAutoReplyEligibility,
  resolveAssistantConversationPolicy,
} from '@murphai/assistant-engine/assistant/conversation-policy'
import { sanitizeAssistantOutboundReply } from '@murphai/assistant-engine/assistant/reply-sanitizer'
import {
  VAULT_ENV,
  buildAssistantProviderDefaultsPatch,
  saveAssistantOperatorDefaultsPatch,
} from '@murphai/operator-config/operator-config'
import {
  buildAssistantFailoverRoutes,
  recordAssistantFailoverRouteFailure,
} from '@murphai/assistant-engine/assistant/failover'
import {
  appendAssistantTranscriptEntries,
  listAssistantTranscriptEntries,
  resolveAssistantSession,
  resolveAssistantStatePaths,
  saveAssistantSession,
} from '@murphai/assistant-engine/assistant-state'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const cleanupPaths: string[] = []
const CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV =
  'MURPH_CANONICAL_WRITE_GUARD_RECEIPT_DIR'
const DEFAULT_CODEX_REASONING_EFFORT = 'medium'

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
  vi.restoreAllMocks()
})

beforeEach(() => {
  serviceMocks.deliverAssistantMessageOverBinding.mockReset()
  serviceMocks.executeAssistantProviderTurnAttempt.mockReset()
  serviceMocks.executeAssistantProviderTurn.mockReset()
  serviceMocks.getAssistantChannelAdapter.mockReset()
  serviceMocks.executeAssistantProviderTurnAttempt.mockImplementation(
    async (...args: Parameters<typeof serviceMocks.executeAssistantProviderTurn>) => {
      try {
        return {
          metadata: {
            executedToolCount: 0,
            rawToolEvents: [],
          },
          ok: true,
          result: await serviceMocks.executeAssistantProviderTurn(...args),
        }
      } catch (error) {
        return {
          error,
          metadata: {
            executedToolCount: 0,
            rawToolEvents: [],
          },
          ok: false,
        }
      }
    },
  )
})

async function findNewOperationMetadataPath(
  vaultRoot: string,
  existingPaths: Set<string>,
): Promise<string> {
  const operationRelativePath = (
    await listWriteOperationMetadataPaths(vaultRoot)
  ).find((relativePath) => !existingPaths.has(relativePath))
  assert.ok(operationRelativePath)
  return operationRelativePath
}

async function findGuardReceiptRoot(): Promise<string> {
  const receiptRoot = process.env[CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV]
  assert.equal(typeof receiptRoot, 'string')
  assert.ok(receiptRoot)
  return receiptRoot
}

async function writeGuardReceipt(input: {
  operationId: string
  createdAt: string
  updatedAt: string
  actions: Array<
    | {
        kind: 'delete'
        targetRelativePath: string
      }
    | {
        kind: 'jsonl_append' | 'text_write'
        targetRelativePath: string
        payload: string
      }
  >
}): Promise<void> {
  const receiptRoot = await findGuardReceiptRoot()
  const payloadDirectory = path.join(receiptRoot, input.operationId)
  await mkdir(payloadDirectory, { recursive: true })

  const actions = await Promise.all(
    input.actions.map(async (action, index) => {
      if (action.kind === 'delete') {
        return action
      }

      const payloadFileName = `${String(index).padStart(4, '0')}.${action.kind === 'text_write' ? 'txt' : 'jsonl'}`
      const payloadRelativePath = `${input.operationId}/${payloadFileName}`
      await writeFile(path.join(receiptRoot, payloadRelativePath), action.payload, 'utf8')
      return {
        kind: action.kind,
        targetRelativePath: action.targetRelativePath,
        payloadRelativePath,
        committedPayloadReceipt: {
          sha256: createHash('sha256').update(action.payload).digest('hex'),
          byteLength: Buffer.byteLength(action.payload),
        },
      }
    }),
  )

  await writeFile(
    path.join(receiptRoot, `${input.operationId}.json`),
    `${JSON.stringify(
      {
        schemaVersion: 'murph.write-operation-guard-receipt.v1',
        operationId: input.operationId,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        actions,
      },
      null,
      2,
    )}\n`,
  )
}

async function waitForPredicate(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now()

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for test predicate.')
    }

    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function readAssistantStateRecord(
  vaultRoot: string,
  docId: string,
): Promise<Record<string, unknown> | null> {
  const documentPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory: resolveAssistantStatePaths(vaultRoot).stateDirectory,
    },
    docId,
  )

  try {
    return JSON.parse(await readFile(documentPath, 'utf8')) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function listAssistantStateRecordDocIds(
  vaultRoot: string,
  prefix: string,
): Promise<string[]> {
  const rootDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
  const documentIds: string[] = []

  async function visit(currentDirectory: string, segments: string[]): Promise<void> {
    let entries
    try {
      entries = await readdir(currentDirectory, {
        withFileTypes: true,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }

      throw error
    }

    for (const entry of entries) {
      const nextPath = path.join(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        await visit(nextPath, [...segments, entry.name])
        continue
      }

      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }

      const docId = [...segments, entry.name.replace(/\.json$/u, '')].join('/')
      if (docId === prefix || docId.startsWith(`${prefix}/`)) {
        documentIds.push(docId)
      }
    }
  }

  await visit(rootDirectory, [])
  return documentIds.sort()
}

test('buildResolveAssistantSessionInput keeps locator shaping and operator default fallbacks stable', () => {
  const defaults = {
    backend: {
      adapter: 'codex-cli' as const,
      model: 'gpt-5.4-mini',
      approvalPolicy: 'on-request',
      codexCommand: '/opt/bin/codex',
      oss: true,
      profile: 'ops',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
    },
    identityId: 'assistant:primary',
    failoverRoutes: null,
    account: null,
    selfDeliveryTargets: null,
  } as const

  assert.deepEqual(
    buildResolveAssistantSessionInput(
      {
        vault: '/tmp/vault',
        alias: 'chat:bob',
        channel: 'telegram',
        participantId: 'contact:bob',
        sourceThreadId: 'thread-1',
      },
      defaults,
    ),
    {
      vault: '/tmp/vault',
      alias: 'chat:bob',
      channel: 'telegram',
      identityId: 'assistant:primary',
      actorId: 'contact:bob',
      threadId: 'thread-1',
      provider: 'codex-cli',
      model: 'gpt-5.4-mini',
      maxSessionAgeMs: null,
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      oss: true,
      profile: 'ops',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      headers: null,
      reasoningEffort: 'high',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'on-request',
        codexCommand: '/opt/bin/codex',
        model: 'gpt-5.4-mini',
        oss: true,
        profile: 'ops',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
      },
    },
  )

  assert.deepEqual(
    buildResolveAssistantSessionInput(
      {
        vault: '/tmp/vault',
        actorId: 'actor:override',
        participantId: 'contact:bob',
        identityId: 'assistant:override',
        threadId: 'thread-explicit',
        sourceThreadId: 'thread-ignored',
        provider: 'codex-cli',
        model: 'gpt-oss:20b',
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: 'private',
        oss: false,
        reasoningEffort: 'low',
      },
      defaults,
    ),
    {
      vault: '/tmp/vault',
      identityId: 'assistant:override',
      actorId: 'actor:override',
      threadId: 'thread-explicit',
      provider: 'codex-cli',
      model: 'gpt-oss:20b',
      maxSessionAgeMs: null,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      oss: false,
      profile: 'private',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      headers: null,
      reasoningEffort: 'low',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: '/opt/bin/codex',
        model: 'gpt-oss:20b',
        oss: false,
        profile: 'private',
        reasoningEffort: 'low',
        sandbox: 'read-only',
      },
    },
  )

  assert.deepEqual(
    buildResolveAssistantSessionInput(
      {
        vault: '/tmp/vault',
        alias: 'chat:bob',
      },
      defaults,
    ),
    {
      vault: '/tmp/vault',
      alias: 'chat:bob',
      identityId: 'assistant:primary',
      provider: 'codex-cli',
      model: 'gpt-5.4-mini',
      maxSessionAgeMs: null,
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      oss: true,
      profile: 'ops',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      headers: null,
      reasoningEffort: 'high',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'on-request',
        codexCommand: '/opt/bin/codex',
        model: 'gpt-5.4-mini',
        oss: true,
        profile: 'ops',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
      },
    },
  )

  assert.deepEqual(
    buildResolveAssistantSessionInput(
      {
        vault: '/tmp/vault',
        sessionId: 'asst_rebind',
        allowBindingRebind: true,
        channel: 'email',
        identityId: 'sender@example.com',
        participantId: null,
        sourceThreadId: null,
        threadIsDirect: null,
      },
      defaults,
    ),
    {
      vault: '/tmp/vault',
      sessionId: 'asst_rebind',
      allowBindingRebind: true,
      channel: 'email',
      identityId: 'sender@example.com',
      actorId: null,
      threadId: null,
      provider: 'codex-cli',
      model: 'gpt-5.4-mini',
      maxSessionAgeMs: null,
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      oss: true,
      profile: 'ops',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      headers: null,
      reasoningEffort: 'high',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'on-request',
        codexCommand: '/opt/bin/codex',
        model: 'gpt-5.4-mini',
        oss: true,
        profile: 'ops',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
      },
    },
  )

  assert.deepEqual(
    buildResolveAssistantSessionInput(
      {
        vault: '/tmp/vault',
        alias: 'chat:openai',
        provider: 'openai-compatible',
        model: 'gpt-oss:20b',
        baseUrl: 'http://127.0.0.1:11434/v1',
      },
      defaults,
    ),
    {
      vault: '/tmp/vault',
      alias: 'chat:openai',
      identityId: 'assistant:primary',
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      maxSessionAgeMs: null,
      sandbox: null,
      approvalPolicy: null,
      oss: false,
      profile: null,
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: null,
      providerName: null,
      headers: null,
      reasoningEffort: 'high',
      target: {
        adapter: 'openai-compatible',
        apiKeyEnv: null,
        endpoint: 'http://127.0.0.1:11434/v1',
        headers: null,
        model: 'gpt-oss:20b',
        providerName: null,
        reasoningEffort: 'high',
      },
    },
  )

  assert.deepEqual(
    buildResolveAssistantSessionInput(
      {
        vault: '/tmp/vault',
        alias: 'chat:openai-override',
        approvalPolicy: 'never',
        profile: 'ops',
        sandbox: 'danger-full-access',
      },
      null,
      {
        adapter: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        endpoint: 'https://api.openai.com/v1',
        headers: null,
        model: 'gpt-5.4-mini',
        providerName: 'openai',
        reasoningEffort: 'medium',
      },
    ),
    {
      vault: '/tmp/vault',
      alias: 'chat:openai-override',
      provider: 'openai-compatible',
      model: 'gpt-5.4-mini',
      maxSessionAgeMs: null,
      sandbox: null,
      approvalPolicy: null,
      oss: false,
      profile: null,
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      providerName: 'openai',
      headers: null,
      reasoningEffort: 'medium',
      target: {
        adapter: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        endpoint: 'https://api.openai.com/v1',
        headers: null,
        model: 'gpt-5.4-mini',
        providerName: 'openai',
        reasoningEffort: 'medium',
      },
    },
  )

  assert.deepEqual(
    buildResolveAssistantSessionInput(
      {
        vault: '/tmp/vault',
        alias: 'chat:codex-defaults',
        provider: 'codex-cli',
      },
      null,
      {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        model: null,
        oss: false,
        profile: null,
        reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
        sandbox: 'danger-full-access',
      },
    ),
    {
      vault: '/tmp/vault',
      alias: 'chat:codex-defaults',
      provider: 'codex-cli',
      model: null,
      maxSessionAgeMs: null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      profile: null,
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      headers: null,
      reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        model: null,
        oss: false,
        profile: null,
        reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
        sandbox: 'danger-full-access',
      },
    },
  )
})

test('buildResolveAssistantSessionInput carries an explicit Codex home into the session target', () => {
  const defaults = {
    backend: {
      adapter: 'codex-cli' as const,
      model: 'gpt-5.4',
      approvalPolicy: 'never' as const,
      codexCommand: null,
      codexHome: '/tmp/codex-1',
      oss: false,
      profile: null,
      reasoningEffort: 'medium' as const,
      sandbox: 'danger-full-access' as const,
    },
    identityId: null,
    failoverRoutes: null,
    account: null,
    selfDeliveryTargets: null,
  } as const

  assert.deepEqual(
    buildResolveAssistantSessionInput(
      {
        vault: '/tmp/vault',
      },
      defaults,
    ),
    {
      vault: '/tmp/vault',
      provider: 'codex-cli',
      model: 'gpt-5.4',
      maxSessionAgeMs: null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      profile: null,
      codexHome: '/tmp/codex-1',
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      headers: null,
      reasoningEffort: 'medium',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        codexHome: '/tmp/codex-1',
        model: 'gpt-5.4',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
      },
    },
  )
})

test('buildResolveAssistantSessionInput requires an explicit provider family when no boundary target exists', () => {
  assert.throws(
    () =>
      buildResolveAssistantSessionInput(
        {
          vault: '/tmp/vault',
          model: 'gpt-5.4-mini',
          reasoningEffort: 'high',
        },
        null,
        null,
      ),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_TARGET_REQUIRED',
  )
})

test('sendAssistantMessage treats null provider-option inputs as fallbacks to saved operator defaults', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-provider-defaults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  await mkdir(path.join(vaultRoot, 'research', '2026', '03'), { recursive: true })
  await writeFile(
    path.join(vaultRoot, 'research', '2026', '03', 'sleep-note.md'),
    '# Sleep note\n\nMagnesium seemed helpful.\n',
    'utf8',
  )

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    await saveAssistantOperatorDefaultsPatch(
      buildAssistantProviderDefaultsPatch({
        defaults: null,
        provider: 'openai-compatible',
        providerConfig: {
          model: 'gpt-oss:20b',
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKeyEnv: 'OLLAMA_API_KEY',
          providerName: 'ollama',
        },
      }),
    )

    await sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'Use the saved assistant backend.',
      provider: 'openai-compatible',
      model: null,
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
    })
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(firstCall?.provider, 'openai-compatible')
  assert.equal(firstCall?.model, 'gpt-oss:20b')
  assert.equal(firstCall?.baseUrl, 'http://127.0.0.1:11434/v1')
  assert.equal(firstCall?.apiKeyEnv, 'OLLAMA_API_KEY')
  assert.equal(firstCall?.providerName, 'ollama')
})

test('sendAssistantMessage gives the first provider turn direct CLI guidance, shared PATH context, bound memory context, and capability-aware assistant tool guidance', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  let result: Awaited<ReturnType<typeof sendAssistantMessage>> | null = null

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-123',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    result = await sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'Inspect the vault with the CLI.',
    })
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const expectedSharedPathHead = String(process.env.PATH ?? '').split(path.delimiter)[0] ?? ''
  const turnContext = resolveAssistantMemoryTurnContext(firstCall?.env)

  assert.equal(firstCall?.workingDirectory, vaultRoot)
  assert.ok(firstCall?.systemPrompt)
  assert.equal(firstCall?.env?.[VAULT_ENV], path.resolve(vaultRoot))
  assert.equal(turnContext?.vault, path.resolve(vaultRoot))
  assert.equal(turnContext?.sourcePrompt, 'Inspect the vault with the CLI.')
  assert.equal(turnContext?.provenance.sessionId?.startsWith('asst_'), true)
  assert.equal(firstCall?.toolRuntime?.vault, vaultRoot)
  assert.equal(
    String(firstCall?.env?.PATH ?? '').split(path.delimiter)[0],
    expectedSharedPathHead,
  )
})

test('sendAssistantMessage reuses the same requested working directory across repeated turns in one session', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-workspace-reuse-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-workspace-1',
      response: 'first reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-workspace-1',
      response: 'second reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  const first = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:workspace-reuse',
    prompt: 'First turn.',
  })
  const second = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:workspace-reuse',
    prompt: 'Second turn.',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.equal(second.session.sessionId, first.session.sessionId)
  assert.equal(firstCall?.workingDirectory, vaultRoot)
  assert.equal(secondCall?.workingDirectory, vaultRoot)
})

test('sendAssistantMessage preserves nested in-vault working directories directly', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-nested-working-dir-'))
  const vaultRoot = path.join(parent, 'vault')
  const nestedWorkingDirectory = path.join(vaultRoot, 'notes', 'daily')
  cleanupPaths.push(parent)

  await mkdir(nestedWorkingDirectory, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-nested-working-dir',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:nested-working-dir',
    prompt: 'Use the nested working directory.',
    workingDirectory: nestedWorkingDirectory,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(result.session.sessionId.length > 0, true)
  assert.equal(firstCall?.workingDirectory, nestedWorkingDirectory)
  assert.equal(firstCall?.env?.[VAULT_ENV], path.resolve(vaultRoot))
})

test('sendAssistantMessage keeps the saved provider session when the requested working directory changes', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-working-dir-change-'))
  const vaultRoot = path.join(parent, 'vault')
  const nestedWorkingDirectory = path.join(vaultRoot, 'notes', 'daily')
  cleanupPaths.push(parent)

  await mkdir(nestedWorkingDirectory, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-workspace-change-1',
      response: 'first reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-workspace-change-1',
      response: 'second reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  const first = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:workspace-change',
    prompt: 'First turn.',
  })
  const second = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:workspace-change',
    prompt: 'Second turn.',
    workingDirectory: nestedWorkingDirectory,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.equal(firstCall?.resumeProviderSessionId, null)
  assert.equal(secondCall?.resumeProviderSessionId, 'thread-workspace-change-1')
  assert.equal(firstCall?.workingDirectory, vaultRoot)
  assert.equal(secondCall?.workingDirectory, nestedWorkingDirectory)
  assert.equal(
    second.session.providerBinding?.providerSessionId,
    'thread-workspace-change-1',
  )
})

test('sendAssistantMessage keeps the requested working directory for non-shell providers', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-nonshell-working-dir-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:nonshell-working-dir',
    provider: 'openai-compatible',
    prompt: 'Use the non-shell provider path.',
    workingDirectory: vaultRoot,
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    providerName: 'ollama',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]

  assert.equal(firstCall?.provider, 'openai-compatible')
  assert.equal(firstCall?.workingDirectory, vaultRoot)
})

test('sendAssistantMessage keeps an outside-vault working directory for direct-CLI providers', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-external-working-dir-'))
  const vaultRoot = path.join(parent, 'vault')
  const externalRoot = path.join(parent, 'repo')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await mkdir(externalRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-external-working-dir',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:external-working-dir',
    provider: 'codex-cli',
    prompt: 'Use the external working directory.',
    workingDirectory: externalRoot,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]

  assert.equal(firstCall?.provider, 'codex-cli')
  assert.equal(firstCall?.workingDirectory, externalRoot)
  assert.equal(firstCall?.env?.[VAULT_ENV], path.resolve(vaultRoot))
})

test('sendAssistantMessage preserves explicit danger-full-access Codex requests', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-sandbox-clamp-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-sandbox-clamp',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:sandbox-clamp',
    prompt: 'Use the vault-bound assistant lane.',
    sandbox: 'danger-full-access',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(firstCall?.sandbox, 'danger-full-access')
  assert.equal(result.session.providerOptions.sandbox, 'danger-full-access')
})

test('sendAssistantMessage serializes concurrent provider turns per vault', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-turn-lock-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  let releaseFirstTurn!: () => void
  const firstTurnGate = new Promise<void>((resolve) => {
    releaseFirstTurn = resolve
  })
  let firstTurnStarted = false
  let secondTurnStarted = false

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async (call: any) => {
    const prompt = call.userPrompt ?? call.prompt
    if (prompt === 'First turn.') {
      firstTurnStarted = true
      await firstTurnGate
      return {
        provider: 'codex-cli',
        providerSessionId: 'thread-turn-lock',
        response: 'first reply',
        stderr: '',
        stdout: '',
        rawEvents: [],
      }
    }

    secondTurnStarted = true
    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-turn-lock',
      response: 'second reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const firstTurn = sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:turn-lock:first',
    prompt: 'First turn.',
  })

  await waitForPredicate(() => firstTurnStarted)

  const secondTurn = sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:turn-lock:second',
    prompt: 'Second turn.',
  })

  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(secondTurnStarted, false)

  releaseFirstTurn()

  const [firstResult, secondResult] = await Promise.all([firstTurn, secondTurn])
  assert.equal(firstResult.response, 'first reply')
  assert.equal(secondResult.response, 'second reply')
  assert.deepEqual(
    serviceMocks.executeAssistantProviderTurn.mock.calls.map(
      ([call]) => call.userPrompt ?? call.prompt,
    ),
    ['First turn.', 'Second turn.'],
  )
})

test('sendAssistantMessage aborts while waiting for the vault turn lock', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-turn-lock-abort-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  let releaseFirstTurn!: () => void
  const firstTurnGate = new Promise<void>((resolve) => {
    releaseFirstTurn = resolve
  })
  let firstTurnStarted = false

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async (call: any) => {
    const prompt = call.userPrompt ?? call.prompt
    if (prompt === 'First turn.') {
      firstTurnStarted = true
      await firstTurnGate
    }

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-turn-lock-abort',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const firstTurn = sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:turn-lock-abort:first',
    prompt: 'First turn.',
  })

  await waitForPredicate(() => firstTurnStarted)

  const abortController = new AbortController()
  const secondTurn = sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:turn-lock-abort:second',
    prompt: 'Second turn.',
    abortSignal: abortController.signal,
  })

  await new Promise((resolve) => setTimeout(resolve, 25))
  abortController.abort()

  await assert.rejects(
    secondTurn,
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_TURN_ABORTED')
      return true
    },
  )
  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 1)

  releaseFirstTurn()
  await firstTurn
})

test('sendAssistantMessage removes the prior-turn abort listener once the queue advances', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-turn-lock-listeners-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  let releaseFirstTurn!: () => void
  const firstTurnGate = new Promise<void>((resolve) => {
    releaseFirstTurn = resolve
  })
  let firstTurnStarted = false

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async (call: any) => {
    const prompt = call.userPrompt ?? call.prompt
    if (prompt === 'First turn.') {
      firstTurnStarted = true
      await firstTurnGate
    }

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-turn-lock-listeners',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const firstTurn = sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:turn-lock-listeners:first',
    prompt: 'First turn.',
  })

  await waitForPredicate(() => firstTurnStarted)

  const abortController = new AbortController()
  const secondTurn = sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:turn-lock-listeners:second',
    prompt: 'Second turn.',
    abortSignal: abortController.signal,
  })

  await waitForPredicate(
    () => getEventListeners(abortController.signal, 'abort').length > 0,
  )

  releaseFirstTurn()
  await secondTurn
  await firstTurn

  assert.equal(getEventListeners(abortController.signal, 'abort').length, 0)
})

test('sendAssistantMessage retries after an externally held vault turn lock clears', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-turn-lock-external-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  const paths = resolveAssistantStatePaths(vaultRoot)
  const lockPath = path.join(paths.assistantStateRoot, '.locks', 'assistant-turn')
  const metadataPath = path.join(lockPath, 'owner.json')

  await mkdir(lockPath, { recursive: true })
  await writeFile(
    metadataPath,
    `${JSON.stringify({
      command: 'test-external-lock',
      pid: process.pid,
      startedAt: '2026-03-27T00:00:00.000Z',
    })}\n`,
  )

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-turn-lock-external',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const turn = sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:turn-lock:external',
    prompt: 'Retry after the external lock clears.',
  })

  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 0)

  await rm(lockPath, { recursive: true, force: true })

  const result = await turn
  assert.equal(result.response, 'assistant reply')
  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 1)
})

test('sendAssistantMessage aborts while polling for an externally held vault turn lock', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-turn-lock-external-abort-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  const paths = resolveAssistantStatePaths(vaultRoot)
  const lockPath = path.join(paths.assistantStateRoot, '.locks', 'assistant-turn')
  const metadataPath = path.join(lockPath, 'owner.json')

  await mkdir(lockPath, { recursive: true })
  await writeFile(
    metadataPath,
    `${JSON.stringify({
      command: 'test-external-lock',
      pid: process.pid,
      startedAt: '2026-03-27T00:00:00.000Z',
    })}\n`,
  )

  const abortController = new AbortController()
  const turn = sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:turn-lock:external-abort',
    prompt: 'Abort while waiting on the external lock.',
    abortSignal: abortController.signal,
  })

  await new Promise((resolve) => setTimeout(resolve, 25))
  abortController.abort()

  await assert.rejects(
    turn,
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_TURN_ABORTED')
      return true
    },
  )
  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 0)
})

test('sendAssistantMessage adds no-citations formatting guidance for outbound channel replies only', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-channel-formatting-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-outbound-formatting',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'email',
    identityId: 'assistant@example.test',
    participantId: 'person@example.test',
    sourceThreadId: 'thread-email-formatting',
    threadIsDirect: true,
    prompt: 'Reply to the latest message.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:local-formatting',
    prompt: 'Reply in the local chat UI.',
  })

  const outboundCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const localChatCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.match(
    outboundCall?.systemPrompt ?? '',
    /Do not include citations, source lists, internal paths, ledger details, raw machine timestamps, or Markdown presentation by default/u,
  )
  assert.match(
    outboundCall?.systemPrompt ?? '',
    /Reply naturally in plain conversational prose that fits the channel/u,
  )
  assert.match(
    outboundCall?.systemPrompt ?? '',
    /user-facing messaging channel, not the local terminal chat UI/u,
  )
  assert.doesNotMatch(
    localChatCall?.systemPrompt ?? '',
    /Do not include citations, source lists, internal paths, ledger details, raw machine timestamps, or Markdown presentation by default/u,
  )
  assert.doesNotMatch(
    localChatCall?.systemPrompt ?? '',
    /Do not surface raw machine timestamps such as ISO-8601 values by default/u,
  )
  assert.doesNotMatch(
    outboundCall?.systemPrompt ?? '',
    /mention relative file paths when practical/u,
  )
  assert.match(
    localChatCall?.systemPrompt ?? '',
    /mention relative file paths when practical/u,
  )
})

test('sanitizeAssistantOutboundReply strips local markdown links and vault source callouts for outbound channels', () => {
  const sanitized = sanitizeAssistantOutboundReply(
    [
      '[Source: derived/summary.md] Here is the clean answer.',
      '- From file:///tmp/private.md: The note is attached.',
      'Read [the note](file:///tmp/private.md) and [journal entry](/tmp/vault/journal/today.md).',
      'Review [sleep note](derived/reports/sleep.md) before replying.',
      'See vault/journal/2026-03-29.md for context.',
      'Inline refs like `derived/reports/sleep.md` should not leak either.',
      'From a friend: keep this line intact.',
    ].join('\n'),
    'email',
  )

  assert.equal(
    sanitized,
    [
      'Here is the clean answer.',
      '- The note is attached.',
      'Read the note and journal entry.',
      'Review sleep note before replying.',
      'See that note for context.',
      'Inline refs like that note should not leak either.',
      'From a friend: keep this line intact.',
    ].join('\n'),
  )

  assert.equal(
    sanitizeAssistantOutboundReply('Read [the note](file:///tmp/private.md).', 'local'),
    'Read [the note](file:///tmp/private.md).',
  )
  assert.equal(
    sanitizeAssistantOutboundReply('Use /help to continue.', 'email'),
    'Use /help to continue.',
  )
  assert.equal(
    sanitizeAssistantOutboundReply('See [docs](https://example.com/x/y.md) for details.', 'email'),
    'See [docs](https://example.com/x/y.md) for details.',
  )
  assert.equal(
    sanitizeAssistantOutboundReply(
      'First line.\n  From a friend: keep this line intact.',
      'email',
    ),
    'First line.\n  From a friend: keep this line intact.',
  )
})

test('resolveAssistantConversationPolicy withholds sensitive health context when explicit delivery overrides the bound private audience', () => {
  const privateBinding = {
    conversationKey: 'email:private',
    channel: 'email',
    identityId: 'assistant@example.com',
    actorId: 'person@example.com',
    threadId: 'thread-123',
    threadIsDirect: true,
    delivery: {
      channel: 'email',
      target: 'person@example.com',
      targetKind: 'email',
    },
  }

  const matchingAudience = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: 'person@example.com',
      sourceThreadId: 'thread-123',
      threadId: 'thread-123',
      threadIsDirect: true,
    },
    session: {
      binding: privateBinding,
    } as any,
  })
  assert.equal(matchingAudience.allowSensitiveHealthContext, true)

  const redirectedAudience = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: 'other@example.com',
      sourceThreadId: 'thread-123',
      threadId: 'thread-123',
      threadIsDirect: true,
    },
    session: {
      binding: privateBinding,
    } as any,
  })
  assert.equal(redirectedAudience.allowSensitiveHealthContext, false)
})

test('resolveAssistantConversationPolicy uses the effective audience instead of the historical binding when deciding sensitive health context exposure', () => {
  const historicallySharedBinding = {
    conversationKey: 'email:shared',
    channel: 'email',
    identityId: 'assistant@example.com',
    actorId: 'person@example.com',
    threadId: 'thread-group',
    threadIsDirect: false,
    delivery: {
      channel: 'email',
      target: 'person@example.com',
      targetKind: 'email',
    },
  }

  const directOverrideAudience = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: 'person@example.com',
      sourceThreadId: 'thread-private',
      threadId: 'thread-private',
      threadIsDirect: true,
    },
    session: {
      binding: historicallySharedBinding,
    } as any,
  })
  assert.equal(directOverrideAudience.allowSensitiveHealthContext, true)

  const directOverrideToDifferentAudience = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: 'other@example.com',
      sourceThreadId: 'thread-private',
      threadId: 'thread-private',
      threadIsDirect: true,
    },
    session: {
      binding: historicallySharedBinding,
    } as any,
  })
  assert.equal(directOverrideToDifferentAudience.allowSensitiveHealthContext, false)
})

test('resolveAssistantConversationPolicy infers a private explicit delivery target even when stored thread directness is stale', () => {
  const historicallySharedBinding = {
    conversationKey: 'email:shared',
    channel: 'email',
    identityId: 'assistant@example.com',
    actorId: 'person@example.com',
    threadId: 'thread-group',
    threadIsDirect: false,
    delivery: {
      channel: 'email',
      target: 'person@example.com',
      targetKind: 'email',
      kind: 'participant',
    },
  }

  const directOverrideAudience = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: 'person@example.com',
      sourceThreadId: 'thread-private',
      threadId: 'thread-private',
    },
    session: {
      binding: historicallySharedBinding,
    } as any,
  })
  assert.equal(directOverrideAudience.audience.threadIsDirect, false)
  assert.equal(directOverrideAudience.audience.effectiveThreadIsDirect, true)
  assert.equal(directOverrideAudience.allowSensitiveHealthContext, true)

  const redirectedAudience = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: 'other@example.com',
      sourceThreadId: 'thread-private',
      threadId: 'thread-private',
    },
    session: {
      binding: historicallySharedBinding,
    } as any,
  })
  assert.equal(redirectedAudience.allowSensitiveHealthContext, false)
})

test('resolveAssistantConversationPolicy infers a private bound participant delivery audience even when stored thread directness is stale', () => {
  const staleBinding = {
    conversationKey: 'email:participant-target',
    channel: 'email',
    identityId: 'assistant@example.com',
    actorId: 'person@example.com',
    threadId: 'thread-group',
    threadIsDirect: false,
    delivery: {
      channel: 'email',
      target: 'person@example.com',
      targetKind: 'email',
      kind: 'participant',
    },
  }

  const policy = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: null,
      sourceThreadId: 'thread-private',
      threadId: 'thread-private',
    },
    session: {
      binding: staleBinding,
    } as any,
  })

  assert.equal(policy.audience.threadIsDirect, false)
  assert.equal(policy.audience.effectiveThreadIsDirect, true)
  assert.equal(policy.allowSensitiveHealthContext, true)
})

test('resolveAssistantConversationPolicy normalizes accepted inbound operator authority for messaging turns', () => {
  const binding = {
    conversationKey: 'telegram:direct',
    channel: 'telegram',
    identityId: 'telegram-bot',
    actorId: 'telegram-user',
    threadId: 'telegram-thread',
    threadIsDirect: true,
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread',
      targetKind: 'thread',
      kind: 'thread',
    },
  }

  const defaultPolicy = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: null,
      sourceThreadId: 'telegram-thread',
      threadId: 'telegram-thread',
      threadIsDirect: true,
    },
    session: {
      binding,
    } as any,
  })
  assert.equal(defaultPolicy.operatorAuthority, 'direct-operator')

  const acceptedInboundPolicy = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: null,
      operatorAuthority: 'accepted-inbound-message',
      sourceThreadId: 'telegram-thread',
      threadId: 'telegram-thread',
      threadIsDirect: true,
    },
    session: {
      binding,
    } as any,
  })
  assert.equal(acceptedInboundPolicy.operatorAuthority, 'accepted-inbound-message')
  assert.equal(
    resolveAssistantConversationAutoReplyEligibility({
      audience: acceptedInboundPolicy.audience,
      operatorAuthority: acceptedInboundPolicy.operatorAuthority,
    }),
    true,
  )

  const invalidAuthorityPolicy = resolveAssistantConversationPolicy({
    message: {
      deliverResponse: true,
      deliveryReplyToMessageId: null,
      deliveryTarget: null,
      operatorAuthority: 'bogus-authority' as any,
      sourceThreadId: 'telegram-thread',
      threadId: 'telegram-thread',
      threadIsDirect: true,
    },
    session: {
      binding,
    } as any,
  })
  assert.equal(invalidAuthorityPolicy.operatorAuthority, 'direct-operator')
})


test('sendAssistantMessage writes a system receipt for provider and delivery milestones', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-receipts-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-receipt-1',
    response: 'Assistant reply.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: '+15551234567',
      targetKind: 'participant',
      sentAt: '2026-03-26T01:10:00.000Z',
      messageLength: 'Assistant reply.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_receipt_1',
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: '+15551234567',
    prompt: 'Send a quick check-in.',
    deliverResponse: true,
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const receiptFiles = await readdir(statePaths.turnsDirectory)
  assert.equal(receiptFiles.length, 1)
  const receipt = JSON.parse(
    await readFile(
      path.join(statePaths.turnsDirectory, receiptFiles[0]!),
      'utf8',
    ),
  ) as {
    deliveryDisposition: string
    deliveryIntentId: string | null
    responsePreview: string | null
    status: string
    timeline: Array<{ kind: string }>
  }

  assert.equal(receipt.status, 'completed')
  assert.equal(receipt.deliveryDisposition, 'sent')
  assert.equal(typeof receipt.deliveryIntentId, 'string')
  assert.match(
    receipt.responsePreview ?? '',
    /^\[redacted \d+ chars sha256:[0-9a-f]{12}\]$/,
  )
  assert.notEqual(receipt.responsePreview, 'Assistant reply.')
  assert.equal(
    receipt.timeline.some((event) => event.kind === 'provider.attempt.started'),
    true,
  )
  assert.equal(
    receipt.timeline.some((event) => event.kind === 'provider.attempt.succeeded'),
    true,
  )
  assert.equal(
    receipt.timeline.some((event) => event.kind === 'delivery.sent'),
    true,
  )
  assert.equal(
    receipt.timeline.some((event) => event.kind === 'turn.completed'),
    true,
  )
})

test('sendAssistantMessage starts and stops typing around provider execution for immediate messaging replies', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-typing-indicator-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const lifecycle: string[] = []
  serviceMocks.getAssistantChannelAdapter.mockImplementation(() => ({
    startTypingIndicator: async (input: {
      bindingDelivery: { target: string } | null
      explicitTarget: string | null
      identityId: string | null
    }) => {
      lifecycle.push(
        `start:${input.bindingDelivery?.target ?? 'null'}:${input.explicitTarget ?? 'null'}:${input.identityId ?? 'null'}`,
      )
      return {
        stop: async () => {
          lifecycle.push('stop')
        },
      }
    },
  }))
  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    lifecycle.push('provider')
    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-typing-1',
      response: 'Typing reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread-typing',
      targetKind: 'thread',
      sentAt: '2026-04-04T04:00:00.000Z',
      messageLength: 'Typing reply.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_telegram_typing',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-typing',
    sourceThreadId: 'telegram-thread-typing',
    threadIsDirect: true,
    prompt: 'say hello',
    deliverResponse: true,
  })

  assert.deepEqual(lifecycle, [
    'start:telegram-thread-typing:null:null',
    'provider',
    'stop',
  ])
})

test('sendAssistantMessage skips typing indicators for queue-only deliveries', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-typing-queue-only-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.getAssistantChannelAdapter.mockImplementation(() => ({
    startTypingIndicator: async () => {
      assert.fail('queue-only delivery should not start a typing indicator')
    },
  }))
  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-typing-queued',
    response: 'Queued reply.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-queued',
    sourceThreadId: 'telegram-thread-queued',
    threadIsDirect: true,
    prompt: 'queue this',
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
  })

  assert.equal(serviceMocks.getAssistantChannelAdapter.mock.calls.length, 0)
})

test('sendAssistantMessage ignores typing indicator start failures', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-typing-start-failure-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.getAssistantChannelAdapter.mockImplementation(() => ({
    startTypingIndicator: async () => {
      throw new Error('typing start failed')
    },
  }))
  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-typing-start-failure',
    response: 'Start failure reply.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread-start-failure',
      targetKind: 'thread',
      sentAt: '2026-04-04T04:00:00.000Z',
      messageLength: 'Start failure reply.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_telegram_typing_start_failure',
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-start-failure',
    sourceThreadId: 'telegram-thread-start-failure',
    threadIsDirect: true,
    prompt: 'say hello despite typing failure',
    deliverResponse: true,
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.response, 'Start failure reply.')
  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 1)
})

test('sendAssistantMessage ignores typing indicator stop failures', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-typing-stop-failure-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const lifecycle: string[] = []
  serviceMocks.getAssistantChannelAdapter.mockImplementation(() => ({
    startTypingIndicator: async () => {
      lifecycle.push('start')
      return {
        stop: async () => {
          lifecycle.push('stop')
          throw new Error('typing stop failed')
        },
      }
    },
  }))
  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    lifecycle.push('provider')
    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-typing-stop-failure',
      response: 'Stop failure reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread-stop-failure',
      targetKind: 'thread',
      sentAt: '2026-04-04T04:00:00.000Z',
      messageLength: 'Stop failure reply.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_telegram_typing_stop_failure',
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-stop-failure',
    sourceThreadId: 'telegram-thread-stop-failure',
    threadIsDirect: true,
    prompt: 'say hello and ignore stop failure',
    deliverResponse: true,
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.response, 'Stop failure reply.')
  assert.deepEqual(lifecycle, ['start', 'provider', 'stop'])
})

test('sendAssistantMessage replays the local transcript for OpenAI-compatible sessions and keeps provider session ids local-only', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-openai-compatible-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'openai-compatible',
      providerSessionId: null,
      response: 'first reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'openai-compatible',
      providerSessionId: null,
      response: 'second reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  try {
    await saveAssistantOperatorDefaultsPatch(
      { backend: null },
      homeRoot,
    )

    const first = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:openai-compatible',
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      prompt: 'first question',
    })

    const second = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:openai-compatible',
      prompt: 'second question',
    })

    const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

    assert.equal(firstCall?.resumeProviderSessionId, null)
    assert.equal(secondCall?.resumeProviderSessionId, null)
    assert.equal(secondCall?.provider, 'openai-compatible')
    assert.ok(firstCall?.systemPrompt)
    assert.ok(secondCall?.systemPrompt)
    assert.equal(firstCall?.toolRuntime?.vault, vaultRoot)
    assert.equal(typeof firstCall?.toolRuntime?.requestId, 'string')
    assert.equal(secondCall?.toolRuntime?.vault, vaultRoot)
    assert.equal(typeof secondCall?.toolRuntime?.requestId, 'string')
    assert.equal(firstCall?.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(secondCall?.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(firstCall?.model, 'gpt-oss:20b')
    assert.equal(secondCall?.model, 'gpt-oss:20b')
    const firstToolCatalog = firstCall?.toolRuntime?.toolCatalog as
      | AssistantToolCatalog
      | undefined
    assert.equal(firstToolCatalog?.hasTool('vault.cli.run'), true)
    assert.deepEqual(secondCall?.conversationMessages, [
      {
        role: 'user',
        content: 'first question',
      },
      {
        role: 'assistant',
        content: 'first reply',
      },
    ])
    assert.equal(first.session.providerBinding?.providerSessionId ?? null, null)
    assert.equal(second.session.providerBinding?.providerSessionId ?? null, null)
    assert.equal(second.session.providerOptions.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(second.session.providerOptions.model, 'gpt-oss:20b')

    const transcript = await listAssistantTranscriptEntries(
      vaultRoot,
      second.session.sessionId,
    )
    assert.deepEqual(
      transcript.map((entry) => ({
        kind: entry.kind,
        text: entry.text,
      })),
      [
        {
          kind: 'user',
          text: 'first question',
        },
        {
          kind: 'assistant',
          text: 'first reply',
        },
        {
          kind: 'user',
          text: 'second question',
        },
        {
          kind: 'assistant',
          text: 'second reply',
        },
      ],
    )
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage gives OpenAI-compatible auto-reply turns the CLI-first Murph tool catalog', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-openai-auto-reply-tools-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'auto-reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:auto-reply-tools',
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      prompt: 'Can you follow up?',
      turnTrigger: 'automation-auto-reply',
    })

    const providerCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    const toolCatalog = providerCall?.toolRuntime?.toolCatalog as
      | AssistantToolCatalog
      | undefined

    assert.equal(providerCall?.provider, 'openai-compatible')
    assert.equal('capabilityRegistry' in (providerCall?.toolRuntime ?? {}), false)
    assert.equal(toolCatalog?.hasTool('vault.cli.run'), true)
    assert.equal(toolCatalog?.hasTool('vault.fs.readText'), true)
    assert.equal(toolCatalog?.hasTool('assistant.state.show'), false)
    assert.equal(toolCatalog?.hasTool('assistant.memory.search'), false)
    assert.equal(toolCatalog?.hasTool('assistant.memory.get'), false)
    assert.equal(toolCatalog?.hasTool('assistant.memory.file.read'), false)
    assert.equal(toolCatalog?.hasTool('assistant.memory.file.append'), false)
    assert.equal(toolCatalog?.hasTool('assistant.memory.file.write'), false)
    assert.equal(toolCatalog?.hasTool('assistant.memory.upsert'), false)
    assert.equal(toolCatalog?.hasTool('assistant.memory.forget'), false)
    assert.equal(toolCatalog?.hasTool('assistant.knowledge.search'), true)
    assert.equal(toolCatalog?.hasTool('assistant.knowledge.get'), true)
    assert.equal(toolCatalog?.hasTool('assistant.knowledge.list'), true)
    assert.equal(toolCatalog?.hasTool('assistant.knowledge.upsert'), true)
    assert.equal(toolCatalog?.hasTool('assistant.knowledge.lint'), true)
    assert.equal(toolCatalog?.hasTool('assistant.knowledge.rebuildIndex'), true)
    assert.equal(toolCatalog?.hasTool('assistant.cron.status'), false)
    assert.equal(toolCatalog?.hasTool('assistant.selfTarget.list'), false)
    assert.equal(toolCatalog?.hasTool('vault.show'), false)
    assert.equal(toolCatalog?.hasTool('vault.journal.append'), false)
    assert.ok(providerCall?.systemPrompt)
    assert.doesNotMatch(providerCall?.systemPrompt ?? '', /murph\.device\.connect/u)
    assert.match(
      providerCall?.systemPrompt ?? '',
      /For wiki work, prefer the dedicated knowledge surface for this route over generic CLI execution/u,
    )
    assert.match(
      providerCall?.systemPrompt ?? '',
      /Use `vault\.cli\.run` as the canonical Murph runtime surface for this bound vault/u,
    )
    assert.match(
      providerCall?.systemPrompt ?? '',
      /The assistant is responsible for compiling and maintaining the wiki over time/u,
    )
    assert.match(
      providerCall?.systemPrompt ?? '',
      /For wiki tasks, read `derived\/knowledge\/index\.md` first, then one to three targeted pages/u,
    )
    assert.match(
      providerCall?.systemPrompt ?? '',
      /Use targeted local file reads only when the CLI\/query surface does not expose the needed detail/u,
    )
    assert.doesNotMatch(
      providerCall?.systemPrompt ?? '',
      /assistant\.knowledge\.(search|upsert)/u,
    )

    const toolResults = await toolCatalog!.executeCalls({
      mode: 'apply',
      calls: [
        {
          tool: 'vault.cli.run',
          input: {
            args: ['assistant', 'session', 'list'],
          },
        },
        {
          tool: 'vault.cli.run',
          input: {
            args: ['assistant', 'session', 'show', result.session.sessionId],
          },
        },
        {
          tool: 'vault.cli.run',
          input: {
            args: ['journal', 'append', '2026-03-31', '--text', 'Auto-reply mutation proof.'],
          },
        },
      ],
    })
    assert.deepEqual(toolResults.map((entry) => entry.status), ['succeeded', 'succeeded', 'succeeded'])
    const listedSessions = (toolResults[0]?.result as {
      json?: { sessions?: Array<{ sessionId?: string }> }
    } | undefined)?.json?.sessions
    const shownSession = (toolResults[1]?.result as {
      json?: { session?: { sessionId?: string } }
    } | undefined)?.json?.session
    assert.ok(listedSessions?.some((session) => session.sessionId === result.session.sessionId))
    assert.equal(shownSession?.sessionId, result.session.sessionId)

    const journalRelativePath = (toolResults[2]?.result as {
      json?: { journalPath?: string }
    } | undefined)?.json?.journalPath
    assert.equal(typeof journalRelativePath, 'string')
    const journalMarkdown = await readFile(
      path.isAbsolute(journalRelativePath as string)
        ? (journalRelativePath as string)
        : path.join(vaultRoot, journalRelativePath as string),
      'utf8',
    )
    assert.match(journalMarkdown, /Auto-reply mutation proof\./u)
    assert.equal(result.response, 'auto-reply')
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage carries the provider-turn bound tool catalog into hosted tool runtime and prompt gating', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-hosted-device-connect-registry-'),
  )
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'hosted auto-reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:hosted-device-connect-tools',
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      prompt: 'Can you help me connect WHOOP?',
      executionContext: {
        hosted: {
          issueDeviceConnectLink: async ({ provider }) => ({
            authorizationUrl: `https://provider.example.test/${provider}`,
            expiresAt: '2026-04-06T00:00:00.000Z',
            provider,
            providerLabel: 'WHOOP',
          }),
          memberId: 'member_123',
          userEnvKeys: [],
        },
      },
    })

    const providerCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    const toolCatalog = providerCall?.toolRuntime?.toolCatalog as
      | AssistantToolCatalog
      | undefined

    assert.equal(providerCall?.provider, 'openai-compatible')
    assert.equal('capabilityRegistry' in (providerCall?.toolRuntime ?? {}), false)
    assert.equal(toolCatalog?.hasTool('vault.cli.run'), true)
    assert.equal(toolCatalog?.hasTool('murph.device.connect'), true)
    assert.match(providerCall?.systemPrompt ?? '', /use `murph\.device\.connect` first/iu)
    assert.equal(result.response, 'hosted auto-reply')
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage keeps murph.device.connect out of the prompt when the hosted provider does not support tool runtime', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-hosted-device-connect-codex-'),
  )
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-hosted-codex',
    response: 'codex hosted auto-reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:hosted-device-connect-codex',
      provider: 'codex-cli',
      prompt: 'Can you help me connect WHOOP?',
      executionContext: {
        hosted: {
          issueDeviceConnectLink: async ({ provider }) => ({
            authorizationUrl: `https://provider.example.test/${provider}`,
            expiresAt: '2026-04-06T00:00:00.000Z',
            provider,
            providerLabel: 'WHOOP',
          }),
          memberId: 'member_123',
          userEnvKeys: [],
        },
      },
    })

    const providerCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    const toolCatalog = providerCall?.toolRuntime?.toolCatalog as
      | AssistantToolCatalog
      | undefined

    assert.equal(providerCall?.provider, 'codex-cli')
    assert.equal(toolCatalog?.hasTool('murph.device.connect'), true)
    assert.doesNotMatch(providerCall?.systemPrompt ?? '', /murph\.device\.connect/u)
    assert.doesNotMatch(
      providerCall?.systemPrompt ?? '',
      /assistant\.knowledge\.(search|upsert)/u,
    )
    assert.match(
      providerCall?.systemPrompt ?? '',
      /For wiki work, use `vault-cli knowledge \.\.\.` directly in this turn/u,
    )
    assert.match(
      providerCall?.systemPrompt ?? '',
      /The assistant is responsible for compiling and maintaining the wiki over time/u,
    )
    assert.match(
      providerCall?.systemPrompt ?? '',
      /Update an existing matching page instead of creating a near-duplicate/u,
    )
    assert.match(
      providerCall?.systemPrompt ?? '',
      /Use targeted local file reads only when the CLI\/query surface does not expose the needed detail/u,
    )
    assert.equal(result.response, 'codex hosted auto-reply')
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage lets Codex auto-reply turns use the full Murph runtime surface', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-codex-auto-reply-tools-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-codex-auto-reply',
    response: 'auto-reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:codex-auto-reply-tools',
      provider: 'codex-cli',
      prompt: 'Can you follow up?',
      turnTrigger: 'automation-auto-reply',
    })

    const providerCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]

    assert.equal(providerCall?.provider, 'codex-cli')
    assert.equal(providerCall?.toolRuntime?.vault, vaultRoot)
    assert.ok(providerCall?.systemPrompt)
    assert.equal(result.response, 'auto-reply')
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage resumes a saved Codex provider session by route', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-codex-route-resume-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:codex-version',
    provider: 'codex-cli',
  })
  await appendAssistantTranscriptEntries(vaultRoot, resolved.session.sessionId, [
    {
      kind: 'user',
      text: 'Old question about dinner.',
    },
    {
      kind: 'assistant',
      text: 'Old answer about dinner.',
    },
  ])
  const [primaryRoute] = buildAssistantFailoverRoutes({
    provider: 'codex-cli',
    providerOptions: resolved.session.providerOptions,
    defaults: null,
    codexCommand: null,
  })
  await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'codex-cli',
    providerBinding: {
      provider: 'codex-cli',
      providerSessionId: 'thread-stale-codex',
      providerOptions: resolved.session.providerOptions,
      providerState: {
        resumeRouteId: primaryRoute!.routeId,
      },
    },
    updatedAt: '2026-03-26T00:00:00.000Z',
    lastTurnAt: '2026-03-26T00:00:00.000Z',
    turnCount: 2,
  })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-stale-codex',
    response: 'Resumed reply.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:codex-version',
    prompt: 'What should I eat tonight?',
  })

  const call = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(call?.resumeProviderSessionId, 'thread-stale-codex')
  assert.equal(call?.continuityContext ?? '', '')
  assert.equal(
    result.session.providerBinding?.providerSessionId,
    'thread-stale-codex',
  )
  assert.equal(result.session.providerBinding?.providerState?.resumeRouteId, primaryRoute!.routeId)
  assert.equal(result.session.turnCount, 3)
})

test('sendAssistantMessage injects and persists a CLI surface bootstrap contract on cold start', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-cli-bootstrap-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-bootstrap-codex',
    response: 'Fresh reply.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:cli-bootstrap',
    prompt: 'What can you do from the CLI here?',
  })

  const call = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(call?.continuityContext, null)
  assert.match(
    call?.systemPrompt ?? '',
    /Use `vault-cli` directly as the canonical Murph runtime surface in this privileged local route\./u,
  )

  const snapshot = await readAssistantStateRecord(
    vaultRoot,
    `sessions/${result.session.sessionId}/cli-surface-bootstrap`,
  )
  assert.equal(snapshot !== null, true)
  assert.equal(typeof snapshot?.contract, 'string')
  assert.equal(
    (call?.systemPrompt ?? '').includes(String(snapshot?.contract ?? '')),
    true,
  )
})

test('sendAssistantMessage cold-starts when a saved provider binding is missing explicit resume route metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-legacy-binding-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:legacy-binding',
    provider: 'codex-cli',
  })
  await appendAssistantTranscriptEntries(vaultRoot, resolved.session.sessionId, [
    {
      kind: 'user',
      text: 'Old question about lunch.',
    },
    {
      kind: 'assistant',
      text: 'Old answer about lunch.',
    },
  ])
  await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'codex-cli',
    providerBinding: {
      provider: 'codex-cli',
      providerSessionId: 'thread-legacy-binding',
      providerOptions: resolved.session.providerOptions,
      providerState: {
        resumeRouteId: null,
      },
    },
    updatedAt: '2026-03-26T00:00:00.000Z',
    lastTurnAt: '2026-03-26T00:00:00.000Z',
    turnCount: 2,
  })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-fresh-after-legacy-binding',
    response: 'Fresh reply.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:legacy-binding',
    prompt: 'What should I eat today?',
  })

  const call = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(call?.resumeProviderSessionId, null)
  assert.equal(
    result.session.providerBinding?.providerSessionId,
    'thread-fresh-after-legacy-binding',
  )
})

test('sendAssistantMessage resumes when a saved provider binding still has matching route metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-legacy-resume-binding-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:legacy-workspace-binding',
    provider: 'codex-cli',
  })
  const [primaryRoute] = buildAssistantFailoverRoutes({
    provider: 'codex-cli',
    providerOptions: resolved.session.providerOptions,
    defaults: null,
    codexCommand: null,
  })
  await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'codex-cli',
    providerBinding: {
      provider: 'codex-cli',
      providerSessionId: 'thread-legacy-workspace-binding',
      providerOptions: resolved.session.providerOptions,
      providerState: {
        resumeRouteId: primaryRoute!.routeId,
      },
    },
    updatedAt: '2026-03-26T00:00:00.000Z',
    lastTurnAt: '2026-03-26T00:00:00.000Z',
    turnCount: 0,
  })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-legacy-workspace-binding',
    response: 'Resumed reply.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:legacy-workspace-binding',
    prompt: 'What should I eat today?',
  })

  const call = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(call?.resumeProviderSessionId, 'thread-legacy-workspace-binding')
  assert.equal(call?.workingDirectory, vaultRoot)
  assert.equal(
    result.session.providerBinding?.providerSessionId,
    'thread-legacy-workspace-binding',
  )
})

test('sendAssistantMessage does not auto-persist identity or preference memory from ordinary user prompts', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-no-auto-memory-partial-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-1',
      response: 'Noted.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-2',
      response: 'What should I remember?',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:onboarding-one',
    prompt: 'Call me Chris.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:onboarding-two',
    prompt: 'What should you know about me already?',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.doesNotMatch(firstCall?.systemPrompt ?? '', /Known onboarding answers/u)
  assert.doesNotMatch(firstCall?.systemPrompt ?? '', /Call the user Chris\./u)
  assert.doesNotMatch(secondCall?.systemPrompt ?? '', /Known onboarding answers/u)
  assert.doesNotMatch(secondCall?.systemPrompt ?? '', /Call the user Chris\./u)
  assert.doesNotMatch(secondCall?.systemPrompt ?? '', /Core assistant memory:/u)
})

test('sendAssistantMessage injects the first-chat check-in only for an opted-in first turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-first-chat-check-in-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-complete-1',
      response: 'Noted.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-complete-2',
      response: 'I remember.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:first-check-in',
    includeFirstTurnCheckIn: true,
    prompt:
      'Call me Chris. Keep answers concise. I want help with training and cholesterol.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:first-check-in',
    includeFirstTurnCheckIn: true,
    prompt: 'What should you remember across sessions?',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

})

test('sendAssistantMessage injects the first-chat check-in for each later opted-in new session', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-first-chat-repeat-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-name-1',
      response: 'First reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-name-2',
      response: 'Second reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:first-check-in-one',
    includeFirstTurnCheckIn: true,
    prompt: 'first question',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:first-check-in-two',
    includeFirstTurnCheckIn: true,
    prompt: 'second question',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

})

test('sendAssistantMessage injects the first-chat check-in for first-turn messaging replies', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-first-message-check-in-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-telegram-first-contact',
    response: 'Hello there.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread-1',
      targetKind: 'thread',
      sentAt: '2026-04-02T03:15:00.000Z',
      messageLength: 'Hello there.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_telegram_first_contact',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-1',
    sourceThreadId: 'telegram-thread-1',
    threadIsDirect: true,
    prompt: 'hello sir',
    includeFirstTurnCheckIn: true,
    deliverResponse: true,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
})

test('sendAssistantMessage does not inject the first-chat check-in for proactive first-turn messaging deliveries without explicit opt-in', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-proactive-message-no-check-in-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-proactive-message',
    response: 'Checking in.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread-proactive',
      targetKind: 'thread',
      sentAt: '2026-04-02T03:15:30.000Z',
      messageLength: 'Checking in.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_telegram_proactive',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-proactive',
    sourceThreadId: 'telegram-thread-proactive',
    threadIsDirect: true,
    prompt: 'Send a quick hello.',
    deliverResponse: true,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
})

test('sendAssistantMessage injects the first-chat check-in only on the first messaging reply turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-message-first-turn-only-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-repeat',
      response: 'First reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-repeat',
      response: 'Second reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread-repeat',
      targetKind: 'thread',
      sentAt: '2026-04-02T03:15:45.000Z',
      messageLength: 'First reply.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_telegram_repeat',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-repeat',
    sourceThreadId: 'telegram-thread-repeat',
    threadIsDirect: true,
    prompt: 'hello again',
    includeFirstTurnCheckIn: true,
    deliverResponse: true,
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-repeat',
    sourceThreadId: 'telegram-thread-repeat',
    threadIsDirect: true,
    prompt: 'another follow-up',
    includeFirstTurnCheckIn: true,
    deliverResponse: true,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
})

test('sendAssistantMessage injects the first-chat check-in only for the first ever identifiable messaging contact', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-message-first-ever-check-in-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-first-ever-1',
      response: 'First reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
      firstTurnCheckInInjected: true,
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-first-ever-2',
      response: 'Second reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread-first-ever',
      targetKind: 'thread',
      sentAt: '2026-04-04T03:15:45.000Z',
      messageLength: 'First reply.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_telegram_first_ever',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-first-ever',
    sourceThreadId: 'telegram-thread-first-ever-1',
    threadIsDirect: true,
    prompt: 'first hello',
    includeFirstTurnCheckIn: true,
    deliverResponse: true,
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-first-ever',
    sourceThreadId: 'telegram-thread-first-ever-2',
    threadIsDirect: true,
    prompt: 'second hello',
    includeFirstTurnCheckIn: true,
    deliverResponse: true,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  const firstContactDocs = await listAssistantStateRecordDocIds(
    vaultRoot,
    'onboarding/first-contact',
  )
  assert.equal(firstContactDocs.length, 2)
  for (const firstContactDoc of firstContactDocs) {
    const firstContactState = await readAssistantStateRecord(vaultRoot, firstContactDoc)
    assert.equal(firstContactState !== null, true)
  }
})

test('sendAssistantMessage does not burn first-contact onboarding for queue-only deliveries', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-message-queue-only-check-in-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-queue-only-1',
      response: 'Queued first reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
      firstTurnCheckInInjected: true,
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-queue-only-2',
      response: 'Queued second reply.',
      stderr: '',
      stdout: '',
      rawEvents: [],
      firstTurnCheckInInjected: true,
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-queue-only',
    sourceThreadId: 'telegram-thread-queue-only-1',
    threadIsDirect: true,
    prompt: 'first hello',
    includeFirstTurnCheckIn: true,
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-queue-only',
    sourceThreadId: 'telegram-thread-queue-only-2',
    threadIsDirect: true,
    prompt: 'second hello',
    includeFirstTurnCheckIn: true,
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  const firstContactDocs = await listAssistantStateRecordDocIds(
    vaultRoot,
    'onboarding/first-contact',
  )
  assert.equal(firstContactDocs.length, 0)
})

test('sendAssistantMessage does not inject the first-chat check-in when a messaging thread resumes a saved provider session', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-message-resume-no-check-in-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-resume',
    sourceThreadId: 'telegram-thread-resume',
    threadIsDirect: true,
    provider: 'codex-cli',
  })
  const [primaryRoute] = buildAssistantFailoverRoutes({
    provider: 'codex-cli',
    providerOptions: resolved.session.providerOptions,
    defaults: null,
    codexCommand: null,
  })
  await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'codex-cli',
    providerBinding: {
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-resume',
      providerOptions: resolved.session.providerOptions,
      providerState: {
        resumeRouteId: primaryRoute!.routeId,
      },
    },
    updatedAt: '2026-04-02T03:17:00.000Z',
    lastTurnAt: '2026-04-02T03:17:00.000Z',
    turnCount: 0,
  })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-telegram-resume',
    response: 'Resumed reply.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread-resume',
      targetKind: 'thread',
      sentAt: '2026-04-02T03:17:30.000Z',
      messageLength: 'Resumed reply.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_telegram_resume',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-resume',
    sourceThreadId: 'telegram-thread-resume',
    threadIsDirect: true,
    prompt: 'picking this back up',
    includeFirstTurnCheckIn: true,
    deliverResponse: true,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(firstCall?.resumeProviderSessionId, 'thread-telegram-resume')
})

test('sendAssistantMessage does not inject the first-chat check-in for cron deliveries', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cron-message-no-check-in-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-cron-message',
    response: 'Scheduled update.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  serviceMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'telegram',
      target: 'telegram-thread-cron',
      targetKind: 'thread',
      sentAt: '2026-04-02T03:16:00.000Z',
      messageLength: 'Scheduled update.'.length,
    },
    deliveryDeduplicated: false,
    outboxIntentId: 'outbox_telegram_cron',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    channel: 'telegram',
    participantId: 'telegram-user-cron',
    sourceThreadId: 'telegram-thread-cron',
    threadIsDirect: true,
    prompt: 'Daily reminder',
    deliverResponse: true,
    turnTrigger: 'automation-cron',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
})

test('sendAssistantMessage clears stale provider session ids when switching providers', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-provider-switch-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-codex-1',
      response: 'first reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'openai-compatible',
      providerSessionId: null,
      response: 'second reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:provider-switch',
    provider: 'codex-cli',
    prompt: 'first question',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:provider-switch',
    provider: 'openai-compatible',
    model: 'gpt-oss:20b',
    baseUrl: 'http://127.0.0.1:11434/v1',
    prompt: 'second question',
  })

  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.equal(secondCall?.resumeProviderSessionId, null)

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:provider-switch',
  })

  assert.equal(resolved.session.provider, 'openai-compatible')
  assert.equal(resolved.session.providerBinding?.providerSessionId ?? null, null)
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

test('sendAssistantMessage forwards provider progress callbacks to the provider turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-progress-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-progress-1',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const onProviderEvent = vi.fn()

  await sendAssistantMessage({
    vault: vaultRoot,
    prompt: 'Show me the progress plumbing.',
    onProviderEvent,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(firstCall?.onEvent, onProviderEvent)
})

test('sendAssistantMessage fails closed when the local session file disappears', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-session-restore-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:restore',
  })
  const [primaryRoute] = buildAssistantFailoverRoutes({
    provider: 'codex-cli',
    providerOptions: created.session.providerOptions,
    defaults: null,
    codexCommand: null,
  })
  const hydrated = await saveAssistantSession(vaultRoot, {
    ...created.session,
    providerBinding: {
      provider: 'codex-cli',
      providerSessionId: 'thread-live-1',
      providerOptions: created.session.providerOptions,
      providerState: {
        resumeRouteId: primaryRoute!.routeId,
      },
    },
    updatedAt: '2026-03-22T06:27:12.000Z',
    lastTurnAt: '2026-03-22T06:27:12.000Z',
    turnCount: 1,
  })
  const statePaths = resolveAssistantStatePaths(vaultRoot)

  await rm(path.join(statePaths.sessionsDirectory, `${hydrated.sessionId}.json`), {
    force: true,
  })

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'Keep going.',
      sessionId: hydrated.sessionId,
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_SESSION_NOT_FOUND')
      return true
    },
  )

  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 0)
})

test('sendAssistantMessage keeps a recovered provider session id out of the canonical session after a resumable provider failure', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-recoverable-error-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockRejectedValueOnce(
      new VaultCliError(
        'ASSISTANT_CODEX_CONNECTION_LOST',
        'Codex CLI lost its connection while waiting for the model.',
        {
          connectionLost: true,
          providerSessionId: 'thread-resume-1',
          retryable: true,
        },
      ),
    )
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-resume-1',
      response: 'Recovered.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:recoverable-error',
      prompt: 'hello',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CODEX_CONNECTION_LOST')
      assert.equal(
        error.context?.assistantSession?.providerBinding?.providerSessionId,
        'thread-resume-1',
      )
      return true
    },
  )

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:recoverable-error',
  })

  assert.equal(resolved.session.providerBinding?.providerSessionId, 'thread-resume-1')
  assert.equal(resolved.session.turnCount, 0)

  const retried = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:recoverable-error',
    prompt: 'try again',
  })

  assert.equal(retried.session.providerBinding?.providerSessionId, 'thread-resume-1')
  assert.equal(
    serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.resumeProviderSessionId,
    'thread-resume-1',
  )
})

test('sendAssistantMessage keeps resuming a recovered provider session after the working directory changes', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-recoverable-workdir-'))
  const vaultRoot = path.join(parent, 'vault')
  const alternateWorkingDirectory = path.join(parent, 'alternate-workdir')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await mkdir(alternateWorkingDirectory, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockRejectedValueOnce(
      new VaultCliError(
        'ASSISTANT_CODEX_CONNECTION_LOST',
        'Codex CLI lost its connection while waiting for the model.',
        {
          connectionLost: true,
          providerSessionId: 'thread-recover-default-workdir',
          retryable: true,
        },
      ),
    )
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-recover-default-workdir',
      response: 'Resumed safely.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:recoverable-workdir-change',
      prompt: 'hello',
    }),
    /lost its connection/u,
  )

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:recoverable-workdir-change',
  })
  assert.equal(
    resolved.session.providerBinding?.providerSessionId,
    'thread-recover-default-workdir',
  )

  const retried = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:recoverable-workdir-change',
    prompt: 'retry somewhere else',
    workingDirectory: alternateWorkingDirectory,
  })

  assert.equal(retried.session.providerBinding?.providerSessionId, 'thread-recover-default-workdir')
  assert.equal(
    serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.resumeProviderSessionId,
    'thread-recover-default-workdir',
  )
  assert.equal(
    serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.workingDirectory,
    alternateWorkingDirectory,
  )
})

test('sendAssistantMessage does not persist a recovered provider session id for non-retryable provider failures', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-nonretryable-error-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockRejectedValue(
    new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex CLI failed.',
      {
        connectionLost: false,
        providerSessionId: 'thread-should-not-stick',
        retryable: false,
      },
    ),
  )

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:nonretryable-error',
      prompt: 'hello',
    }),
    /Codex CLI failed/u,
  )

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:nonretryable-error',
  })

  assert.equal(resolved.session.providerBinding?.providerSessionId ?? null, null)
  assert.equal(resolved.session.turnCount, 0)
})

test('sendAssistantMessage allows committed audited canonical writes from core mutation paths', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-allow-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await updateVaultSummary({
      vaultRoot,
      title: 'Guarded Vault Title',
    })

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-legit-write',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-allow',
    prompt: 'Update the vault title.',
  })

  const metadata = JSON.parse(await readFile(path.join(vaultRoot, 'vault.json'), 'utf8'))
  assert.equal(metadata.title, 'Guarded Vault Title')
  assert.equal(result.response, 'assistant reply')
  assert.equal(result.session.turnCount, 1)
  assert.equal(result.session.providerBinding?.providerSessionId, 'thread-legit-write')
})

test('sendAssistantMessage allows concurrent inbox canonical writes that go through audited core write operations', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-inbox-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  let persistedCapture:
    | {
        eventId: string
        envelopePath: string
        createdAt: string
      }
    | null = null

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    const runtime = await openInboxRuntime({ vaultRoot })
    const pipeline = await createInboxPipeline({ vaultRoot, runtime })

    try {
      persistedCapture = await pipeline.processCapture({
        source: 'telegram',
        externalId: 'assistant-guarded-inbox-capture',
        accountId: 'bot',
        thread: {
          id: 'thread-guarded',
        },
        actor: {
          isSelf: false,
        },
        occurredAt: '2026-03-27T00:31:00.000Z',
        receivedAt: '2026-03-27T00:31:01.000Z',
        text: 'Guard-safe inbox capture',
        attachments: [],
        raw: {},
      })
    } finally {
      pipeline.close()
    }

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-inbox-guard',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-inbox-allow',
    prompt: 'Handle the inbound capture.',
  })

  assert.equal(result.response, 'assistant reply')
  assert.equal(result.session.turnCount, 1)
  assert.equal(result.session.providerBinding?.providerSessionId, 'thread-inbox-guard')
  assert.ok(persistedCapture)
  if (!persistedCapture) {
    throw new Error('Expected persisted inbox capture result.')
  }
  const persisted = persistedCapture as {
    createdAt: string
    eventId: string
    envelopePath: string
  }

  assert.deepEqual(
    await readJsonlRecordsIfPresent(vaultRoot, 'ledger/events/2026/2026-03.jsonl'),
    [],
  )
  const auditRecords = (await readJsonlRecordsIfPresent(
    vaultRoot,
    `audit/${persisted.createdAt.slice(0, 4)}/${persisted.createdAt.slice(0, 7)}.jsonl`,
  )) as Array<{ action?: string }>
  assert.equal(
    auditRecords.some((record) => record.action === 'intake_import'),
    false,
  )
  assert.match(persisted.envelopePath, /^raw\/inbox\/telegram\/bot\/2026\/03\/cap_/u)
})

test('sendAssistantMessage preserves direct Codex writes without a guard rollback path', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-fake-committed-metadata-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/fake-provider-write.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await writeFile(targetPath, 'provider direct write\n')

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-fake-committed-metadata',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:fake-committed-metadata',
    prompt: 'Write directly to the bank file.',
  })

  assert.equal(result.response, 'assistant reply')
  assert.equal(result.session.turnCount, 1)
  assert.equal(
    result.session.providerBinding?.providerSessionId,
    'thread-fake-committed-metadata',
  )
  assert.equal(await readFile(targetPath, 'utf8'), 'provider direct write\n')
})

test('sendAssistantMessage does not resume a failed primary Codex session on a same-provider backup route with different config', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-same-provider-failover-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockRejectedValueOnce(
      new VaultCliError(
        'ASSISTANT_CODEX_CONNECTION_LOST',
        'Codex CLI lost its connection.',
        {
          connectionLost: true,
          providerSessionId: 'thread-primary-route',
          retryable: true,
        },
      ),
    )
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-backup-route',
      response: 'Recovered on backup.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:same-provider-failover',
    prompt: 'hello',
    model: 'gpt-5.4',
    profile: 'primary',
    sandbox: 'workspace-write',
    failoverRoutes: [
      {
        name: 'backup',
        provider: 'codex-cli',
        codexCommand: null,
        model: 'gpt-5.4-mini',
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: null,
        profile: 'backup',
        oss: false,
        cooldownMs: null,
      },
    ],
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.equal(result.response, 'Recovered on backup.')
  assert.equal(firstCall?.resumeProviderSessionId, null)
  assert.equal(secondCall?.provider, 'codex-cli')
  assert.equal(secondCall?.model, 'gpt-5.4-mini')
  assert.equal(secondCall?.profile, 'backup')
  assert.equal(secondCall?.sandbox, 'read-only')
  assert.equal(secondCall?.resumeProviderSessionId, null)
  assert.equal(result.session.providerBinding?.providerSessionId, 'thread-backup-route')
})

test('sendAssistantMessage cold-starts when an OpenAI Responses binding is missing explicit resume route metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-openai-legacy-resume-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:openai-legacy-resume',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'openai',
    model: 'gpt-5',
  })
  await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'openai-compatible',
    providerOptions: {
      model: 'gpt-5',
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      providerName: 'openai',
    },
    providerBinding: {
      provider: 'openai-compatible',
      providerSessionId: 'resp_legacy',
      providerOptions: {
        model: 'gpt-5',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        providerName: 'openai',
      },
      providerState: null,
    },
    updatedAt: '2026-04-02T08:00:00.000Z',
    lastTurnAt: '2026-04-02T08:00:00.000Z',
    turnCount: 1,
  })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'openai-compatible',
    providerSessionId: 'resp_fresh_after_missing_route',
    response: 'Started fresh.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:openai-legacy-resume',
    prompt: 'keep going',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'openai',
    model: 'gpt-5',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(firstCall?.resumeProviderSessionId, null)
  assert.equal(
    result.session.providerBinding?.providerSessionId,
    'resp_fresh_after_missing_route',
  )
})

test('sendAssistantMessage does not reuse an OpenAI Responses session when route auth metadata changes', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-openai-route-mismatch-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:openai-route-mismatch',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    model: 'gpt-5',
  })
  await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'openai-compatible',
    providerOptions: {
      model: 'gpt-5',
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
    providerBinding: {
      provider: 'openai-compatible',
      providerSessionId: 'resp_old_route',
      providerOptions: {
        model: 'gpt-5',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
      },
      providerState: {
        resumeRouteId: 'openai-compatible:legacy-route',
      },
    },
    updatedAt: '2026-04-02T08:00:00.000Z',
    lastTurnAt: '2026-04-02T08:00:00.000Z',
    turnCount: 1,
  })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'openai-compatible',
    providerSessionId: 'resp_new_route',
    response: 'Started fresh with the new route.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:openai-route-mismatch',
    prompt: 'keep going',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'openai',
    headers: {
      'x-openai-project': 'proj_123',
    },
    model: 'gpt-5',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(firstCall?.resumeProviderSessionId, null)
  assert.equal(result.session.providerBinding?.providerSessionId, 'resp_new_route')
})

test('sendAssistantMessage does not reuse an OpenAI Responses session on a cooled-down same-provider backup route', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-openai-responses-failover-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const providerOptions = {
    model: 'gpt-5',
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'openai',
  } as const
  const failoverRoutes = [
    {
      name: 'backup',
      provider: 'openai-compatible' as const,
      codexCommand: null,
      model: 'gpt-5-mini',
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      providerName: 'openai',
      cooldownMs: null,
    },
  ] as const
  const [primaryRoute, backupRoute] = buildAssistantFailoverRoutes({
    provider: 'openai-compatible',
    providerOptions,
    defaults: null,
    codexCommand: null,
    backups: failoverRoutes,
  })
  assert.ok(primaryRoute)
  assert.ok(backupRoute)

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:openai-failover',
    provider: 'openai-compatible',
    baseUrl: providerOptions.baseUrl,
    apiKeyEnv: providerOptions.apiKeyEnv,
    providerName: providerOptions.providerName,
    model: providerOptions.model,
  })
  await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'openai-compatible',
    providerOptions,
    providerBinding: {
      provider: 'openai-compatible',
      providerSessionId: 'resp_primary_route',
      providerOptions,
      providerState: {
        resumeRouteId: primaryRoute.routeId,
      },
    },
    updatedAt: '2026-04-02T08:05:00.000Z',
    lastTurnAt: '2026-04-02T08:05:00.000Z',
    turnCount: 1,
  })
  await recordAssistantFailoverRouteFailure({
    vault: vaultRoot,
    route: primaryRoute,
    error: new Error('primary route cooling down'),
    cooldownMs: 60_000,
  })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'openai-compatible',
    providerSessionId: 'resp_backup_route',
    response: 'Recovered on backup.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:openai-failover',
    prompt: 'hello',
    provider: 'openai-compatible',
    baseUrl: providerOptions.baseUrl,
    apiKeyEnv: providerOptions.apiKeyEnv,
    providerName: providerOptions.providerName,
    model: providerOptions.model,
    failoverRoutes,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(firstCall?.provider, 'openai-compatible')
  assert.equal(firstCall?.model, backupRoute.providerOptions.model)
  assert.equal(firstCall?.resumeProviderSessionId, null)
  assert.equal(result.session.providerBinding?.providerSessionId, 'resp_backup_route')
})

test('sendAssistantMessage preserves audited protected deletes', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-delete-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/guard-delete.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)

  await applyCanonicalWriteBatch({
    vaultRoot,
    operationType: 'assistant_guard_delete_seed',
    summary: 'Seed protected delete target',
    textWrites: [
      {
        relativePath: targetRelativePath,
        content: '# Seeded file\n',
      },
    ],
  })

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await applyCanonicalWriteBatch({
      vaultRoot,
      operationType: 'assistant_guard_delete_test',
      summary: 'Delete protected bank file',
      deletes: [
        {
          relativePath: targetRelativePath,
        },
      ],
    })

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-delete',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-delete',
    prompt: 'Delete the protected bank note.',
  })

  assert.equal(result.response, 'assistant reply')
  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)
})

test('sendAssistantMessage does not fail over on interrupted provider errors that mark themselves non-retryable', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-interrupted-no-failover-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockRejectedValue(
    new VaultCliError(
      'ASSISTANT_CODEX_INTERRUPTED',
      'Codex CLI was interrupted.',
      {
        interrupted: true,
        providerSessionId: 'thread-interrupted-1',
        retryable: false,
      },
    ),
  )

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:interrupted-no-failover',
      prompt: 'hello',
      failoverRoutes: [
        {
          name: 'backup',
          provider: 'openai-compatible',
          codexCommand: null,
          model: 'gpt-oss:20b',
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          cooldownMs: null,
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKeyEnv: null,
          providerName: null,
        },
      ],
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CODEX_INTERRUPTED')
      assert.equal(
        error.context?.assistantSession?.providerBinding?.providerSessionId,
        'thread-interrupted-1',
      )
      return true
    },
  )

  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(
    serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]?.provider,
    'codex-cli',
  )
})

test('sendAssistantMessage preserves the primary provider error for tool-bound openai-compatible failover exhaustion', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-failover-exhausted-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurnAttempt
    .mockResolvedValueOnce({
      error: new VaultCliError('ASSISTANT_PRIMARY_FAILED', 'Primary route failed.', {
        retryable: true,
      }),
      metadata: {
        executedToolCount: 1,
        rawToolEvents: [
          {
            type: 'assistant.tool.started',
            tool: 'assistant.knowledge.search',
          },
        ],
      },
      ok: false,
    })
    .mockResolvedValueOnce({
      error: new VaultCliError('ASSISTANT_BACKUP_FAILED', 'Backup route failed.', {
        retryable: true,
      }),
      metadata: {
        executedToolCount: 0,
        rawToolEvents: [],
      },
      ok: false,
    })

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:failover-exhausted',
      prompt: 'hello',
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      failoverRoutes: [
        {
          name: 'backup',
          provider: 'openai-compatible',
          codexCommand: null,
          model: 'gpt-oss:7b',
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          cooldownMs: null,
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKeyEnv: null,
          providerName: null,
        },
      ],
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_PRIMARY_FAILED')
      assert.equal(error.message, 'Primary route failed.')
      assert.equal(error.message.includes('routes were exhausted'), false)
      return true
    },
  )

  assert.equal(serviceMocks.executeAssistantProviderTurnAttempt.mock.calls.length, 1)
})

test('sendAssistantMessage fails closed when openai-compatible session state disappears', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-openai-restore-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:openai-restore',
    provider: 'openai-compatible',
    model: 'gpt-oss:20b',
    baseUrl: 'http://127.0.0.1:11434/v1',
  })
  const hydrated = await saveAssistantSession(vaultRoot, {
    ...created.session,
    updatedAt: '2026-03-22T06:27:12.000Z',
    lastTurnAt: '2026-03-22T06:27:12.000Z',
    turnCount: 2,
  })
  await appendAssistantTranscriptEntries(vaultRoot, hydrated.sessionId, [
    {
      kind: 'user',
      text: 'First question',
      createdAt: '2026-03-22T06:20:00.000Z',
    },
    {
      kind: 'assistant',
      text: 'First answer',
      createdAt: '2026-03-22T06:20:05.000Z',
    },
  ])
  const statePaths = resolveAssistantStatePaths(vaultRoot)

  await rm(path.join(statePaths.sessionsDirectory, `${hydrated.sessionId}.json`), {
    force: true,
  })
  await rm(path.join(statePaths.transcriptsDirectory, `${hydrated.sessionId}.jsonl`), {
    force: true,
  })

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'Keep going.',
      sessionId: hydrated.sessionId,
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_SESSION_NOT_FOUND')
      return true
    },
  )

  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 0)
})

test('sendAssistantMessage fails closed for missing openai-compatible sessions', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-openai-restore-missing-transcript-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:openai-restore-fail',
    provider: 'openai-compatible',
    model: 'gpt-oss:20b',
    baseUrl: 'http://127.0.0.1:11434/v1',
  })
  const statePaths = resolveAssistantStatePaths(vaultRoot)

  await rm(path.join(statePaths.sessionsDirectory, `${created.session.sessionId}.json`), {
    force: true,
  })
  await rm(path.join(statePaths.transcriptsDirectory, `${created.session.sessionId}.jsonl`), {
    force: true,
  })

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'Keep going.',
      sessionId: created.session.sessionId,
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_SESSION_NOT_FOUND')
      return true
    },
  )

  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 0)
})

test('sendAssistantMessage does not accept transcript snapshot fallbacks for openai-compatible sessions', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-openai-restore-empty-transcript-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:openai-restore-empty',
    provider: 'openai-compatible',
    model: 'gpt-oss:20b',
    baseUrl: 'http://127.0.0.1:11434/v1',
  })
  const statePaths = resolveAssistantStatePaths(vaultRoot)

  await rm(path.join(statePaths.sessionsDirectory, `${created.session.sessionId}.json`), {
    force: true,
  })
  await rm(path.join(statePaths.transcriptsDirectory, `${created.session.sessionId}.jsonl`), {
    force: true,
  })

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'Keep going.',
      sessionId: created.session.sessionId,
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_SESSION_NOT_FOUND')
      return true
    },
  )

  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 0)
})
