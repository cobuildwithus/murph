import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { getEventListeners } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  applyCanonicalWriteBatch,
  initializeVault,
  listWriteOperationMetadataPaths,
  readJsonlRecords,
  updateVaultSummary,
} from '@murph/core'
import {
  createInboxPipeline,
  openInboxRuntime,
} from '@murph/inboxd'
import { afterEach, beforeEach, test, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  deliverAssistantMessageOverBinding: vi.fn(),
  executeAssistantProviderTurn: vi.fn(),
}))

vi.mock('../src/outbound-channel.js', async () => {
  const actual = await vi.importActual<typeof import('../src/outbound-channel.js')>(
    '../src/outbound-channel.js',
  )

  return {
    ...actual,
    deliverAssistantMessageOverBinding:
      serviceMocks.deliverAssistantMessageOverBinding,
  }
})

vi.mock('../src/assistant-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant-provider.js')>(
    '../src/assistant-provider.js',
  )

  return {
    ...actual,
    executeAssistantProviderTurn: serviceMocks.executeAssistantProviderTurn,
  }
})

import {
  CURRENT_CODEX_PROMPT_VERSION,
  buildResolveAssistantSessionInput,
  sendAssistantMessage,
} from '../src/assistant/service.js'
import {
  resolveAssistantMemoryTurnContext,
  upsertAssistantMemory,
} from '../src/assistant/memory.js'
import { resolveAssistantConversationPolicy } from '../src/assistant/conversation-policy.js'
import { sanitizeAssistantOutboundReply } from '../src/assistant/reply-sanitizer.js'
import {
  VAULT_ENV,
  saveAssistantOperatorDefaultsPatch,
} from '../src/operator-config.js'
import { buildAssistantFailoverRoutes } from '../src/assistant/failover.js'
import {
  appendAssistantTranscriptEntries,
  listAssistantTranscriptEntries,
  resolveAssistantSession,
  resolveAssistantStatePaths,
  saveAssistantSession,
} from '../src/assistant-state.js'
import { readAssistantProviderRouteRecovery } from '../src/assistant/provider-turn-recovery.js'
import {
  attachOpenAiCompatibleProviderToolExecutionState,
} from '../src/assistant/providers/openai-compatible.js'
import { VaultCliError } from '../src/vault-cli-errors.js'

const cleanupPaths: string[] = []
const CANONICAL_WRITE_GUARD_RECEIPT_DIRECTORY_ENV =
  'MURPH_CANONICAL_WRITE_GUARD_RECEIPT_DIR'

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
  serviceMocks.executeAssistantProviderTurn.mockReset()
})

function buildWorkingDirectoryKey(workingDirectory: string): string {
  return createHash('sha1').update(workingDirectory).digest('hex').slice(0, 16)
}

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

function assertBlockedAssistantResult(
  result: Awaited<ReturnType<typeof sendAssistantMessage>>,
  input?: {
    actionKind?: 'jsonl_append' | 'text_write' | null
    guardFailureCode?: string | null
    guardFailurePathPattern?: RegExp
    guardFailureReason?:
      | 'invalid_committed_payload'
      | 'invalid_write_operation_metadata'
      | null
    guardFailureTargetPath?: string | null
    paths?: string[]
    providerErrorCode?: string | null
  },
): void {
  assert.equal(result.status, 'blocked')
  assert.equal(result.response, '')
  assert.equal(result.delivery, null)
  assert.equal(result.deliveryDeferred, false)
  assert.equal(result.deliveryIntentId, null)
  assert.equal(result.deliveryError, null)
  assert.equal(result.blocked?.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
  assert.equal(result.blocked?.pathCount, input?.paths?.length ?? result.blocked?.paths.length ?? 0)
  if (input?.paths) {
    assert.deepEqual(result.blocked?.paths, input.paths)
  }
  if (input?.guardFailureReason !== undefined) {
    assert.equal(result.blocked?.guardFailureReason, input.guardFailureReason)
  }
  if (input?.guardFailureCode !== undefined) {
    assert.equal(result.blocked?.guardFailureCode, input.guardFailureCode)
  }
  if (input?.guardFailureTargetPath !== undefined) {
    assert.equal(result.blocked?.guardFailureTargetPath, input.guardFailureTargetPath)
  }
  if (input?.actionKind !== undefined) {
    assert.equal(result.blocked?.guardFailureActionKind, input.actionKind)
  }
  if (input?.providerErrorCode !== undefined) {
    assert.equal(result.blocked?.providerErrorCode, input.providerErrorCode)
  }
  if (input?.guardFailurePathPattern) {
    assert.match(result.blocked?.guardFailurePath ?? '', input.guardFailurePathPattern)
  }
}

test('buildResolveAssistantSessionInput keeps locator shaping and operator default fallbacks stable', () => {
  const defaults = {
    provider: 'codex-cli' as const,
    defaultsByProvider: {
      'codex-cli': {
        codexCommand: '/opt/bin/codex',
        model: 'gpt-5.4-mini',
        reasoningEffort: 'high',
        sandbox: 'workspace-write' as const,
        approvalPolicy: 'on-request' as const,
        profile: 'ops',
        oss: true,
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
        headers: null,
      },
    },
    identityId: 'assistant:primary',
    failoverRoutes: null,
    account: null,
    selfDeliveryTargets: null,
  }

  assert.deepEqual(
    buildResolveAssistantSessionInput(
      {
        vault: '/tmp/vault',
        alias: 'chat:bob',
        channel: 'imessage',
        participantId: 'contact:bob',
        sourceThreadId: 'thread-1',
      },
      defaults,
    ),
    {
      vault: '/tmp/vault',
      alias: 'chat:bob',
      channel: 'imessage',
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
      reasoningEffort: null,
    },
  )
})

test('sendAssistantMessage treats null provider-option inputs as fallbacks to saved operator defaults', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-provider-defaults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

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
    await saveAssistantOperatorDefaultsPatch({
      provider: 'openai-compatible',
      defaultsByProvider: {
        'openai-compatible': {
          codexCommand: null,
          model: 'gpt-oss:20b',
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKeyEnv: 'OLLAMA_API_KEY',
          providerName: 'ollama',
          headers: null,
        },
      },
    })

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

test('sendAssistantMessage gives the first provider turn direct CLI guidance, PATH access, bound memory context, and capability-aware assistant tool guidance', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

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
  const expectedUserBinDirectory = path.join(homeRoot, '.local', 'bin')
  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const expectedWorkspace = path.join(
    statePaths.assistantStateRoot,
    'workspaces',
    result?.session.sessionId ?? '',
  )
  const turnContext = resolveAssistantMemoryTurnContext(firstCall?.env)
  const stateMcpExposed =
    firstCall?.configOverrides?.some((value: string) =>
      value.includes('"assistant","state","--mcp"'),
    ) ?? false
  const memoryMcpExposed =
    firstCall?.configOverrides?.some((value: string) =>
      value.includes('"assistant","memory","--mcp"'),
    ) ?? false
  const cronMcpExposed =
    firstCall?.configOverrides?.some((value: string) =>
      value.includes('"assistant","cron","--mcp"'),
    ) ?? false

  assert.equal(firstCall?.workingDirectory, expectedWorkspace)
  assert.notEqual(firstCall?.workingDirectory, vaultRoot)
  assert.match(path.relative(vaultRoot, expectedWorkspace), /^\.\.(?:[\\/]|$)/u)
  assert.match(firstCall?.systemPrompt ?? '', /bound to one active vault/u)
  assert.match(firstCall?.systemPrompt ?? '', /isolated assistant workspace/u)
  assert.match(firstCall?.systemPrompt ?? '', /Murph philosophy:/u)
  assert.match(firstCall?.systemPrompt ?? '', /calm, observant companion/u)
  assert.match(firstCall?.systemPrompt ?? '', /Support the user's judgment; do not replace it/u)
  assert.match(firstCall?.systemPrompt ?? '', /numbers\./u)
  assert.match(firstCall?.systemPrompt ?? '', /Default to synthesis over interruption/u)
  assert.match(firstCall?.systemPrompt ?? '', /normal variation, probably noise, not worth optimizing right now/u)
  assert.match(firstCall?.systemPrompt ?? '', /Vault operator mode \(default\)/u)
  assert.match(firstCall?.systemPrompt ?? '', /Repo coding mode/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /read and follow `AGENTS\.md`, `agent-docs\/index\.md`, and `agent-docs\/PRODUCT_CONSTITUTION\.md`/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /murph chat/u)
  assert.match(firstCall?.systemPrompt ?? '', /murph run/u)
  assert.match(firstCall?.systemPrompt ?? '', /Start with the smallest relevant context/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /bump `CURRENT_CODEX_PROMPT_VERSION` so stale Codex provider sessions rotate cleanly/u,
  )
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Do not run repo tests, typechecks, coverage, coordination-ledger updates, or auto-commit workflows/u,
  )
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Only use repo coding workflows when you edit repo code\/docs or the user explicitly asks for software changes/u,
  )
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Treat capture-style requests like meal logging as explicit permission/u,
  )
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Do not edit canonical vault files such as `vault\.json`, `CORE\.md`, `ledger\/\*\*`, `bank\/\*\*`, or `raw\/\*\*` directly/u,
  )
  assert.match(
    firstCall?.systemPrompt ?? '',
    /use the matching `vault-cli` write surface so the write follows Murph's intended validation and audit path/u,
  )
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Direct Murph CLI execution is available in this session/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli <command> --help/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /meal photo, audio note, or a text-only description/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli meal add/u)
  assert.match(firstCall?.systemPrompt ?? '', /no longer requires a photo/u)
  assert.match(firstCall?.systemPrompt ?? '', /meal or drink as recurring or already known/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /"my morning drink", "usual", "same as always", or "autologged"/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli food list/u)
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli food show <id>/u)
  assert.match(firstCall?.systemPrompt ?? '', /already auto-logs daily/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /prefer updating the existing remembered food instead of inventing a separate one-off/u,
  )
  assert.match(
    firstCall?.systemPrompt ?? '',
    /ask a short disambiguating question instead of guessing/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /Older food logs may still live/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /describe what you found in user-facing terms such as meal log, journal entry, or note/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /research on a complex topic/u)
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli research <prompt>/u)
  assert.match(firstCall?.systemPrompt ?? '', /review:gpt --deep-research --send --wait/u)
  assert.match(firstCall?.systemPrompt ?? '', /10 to 60 minutes/u)
  assert.match(firstCall?.systemPrompt ?? '', /defaults the overall timeout to 40m/u)
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli deepthink <prompt>/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /assistant state (show|list|patch)/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /non-canonical runtime scratchpads/u)
  assert.match(firstCall?.systemPrompt ?? '', /search assistant memory before answering/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /consider offering one short remember suggestion/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /assistant memory .*forget/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /phrase `text` as the exact stored sentence you want committed/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /assistant cron add/u)
  assert.match(firstCall?.systemPrompt ?? '', /assistant cron preset install/u)
  assert.match(firstCall?.systemPrompt ?? '', /Prefer digest-style or summary-style automation over nagging coaching/u)
  assert.match(firstCall?.systemPrompt ?? '', /assistant run/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Do not scan the whole vault or broad CLI manifests unless the task actually requires that coverage/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /keep waiting on the tool unless it actually errors or times out/u)
  assert.match(firstCall?.systemPrompt ?? '', /`--timeout` is the normal control/u)
  assert.match(firstCall?.systemPrompt ?? '', /`--wait-timeout` is only for the uncommon case/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Cron prompts may explicitly tell you to use the research tool/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /murph/u)
  assert.equal(firstCall?.env?.[VAULT_ENV], path.resolve(vaultRoot))
  assert.equal(turnContext?.vault, path.resolve(vaultRoot))
  assert.equal(turnContext?.sourcePrompt, 'Inspect the vault with the CLI.')
  assert.equal(turnContext?.provenance.sessionId?.startsWith('asst_'), true)
  assert.match(
    await readFile(path.join(expectedWorkspace, 'README.md'), 'utf8'),
    /isolated assistant workspace/u,
  )
  assert.match(
    await readFile(path.join(expectedWorkspace, 'README.md'), 'utf8'),
    /`VAULT` environment variable/u,
  )
  if (stateMcpExposed) {
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Assistant state tools are exposed in this session/u,
    )
  } else {
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Assistant state tools are not exposed in this session, but direct Murph CLI execution is available/u,
    )
  }
  if (memoryMcpExposed) {
    assert.match(firstCall?.systemPrompt ?? '', /Assistant memory tools are exposed in this session/u)
  } else {
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Assistant memory tools are not exposed in this session, but direct Murph CLI execution is available/u,
    )
  }
  if (cronMcpExposed) {
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Scheduled assistant automation tools are exposed in this session/u,
    )
  } else {
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Scheduled assistant automation tools are not exposed in this session, but direct Murph CLI execution is available/u,
    )
  }
  assert.equal(
    Boolean(firstCall?.configOverrides?.some((value: string) => value.includes('.args=['))),
    stateMcpExposed || memoryMcpExposed || cronMcpExposed,
  )
  assert.equal(
    String(firstCall?.env?.PATH ?? '').split(path.delimiter)[0],
    expectedUserBinDirectory,
  )
  assert.doesNotMatch(
    firstCall?.systemPrompt ?? '',
    /Never include citations, source lists, footnotes/u,
  )
  assert.doesNotMatch(
    firstCall?.systemPrompt ?? '',
    /optional onboarding check-in/u,
  )
})

test('sendAssistantMessage reuses the same isolated provider workspace across repeated turns in one session', async () => {
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
  const expectedWorkspace = path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    'workspaces',
    first.session.sessionId,
  )

  assert.equal(second.session.sessionId, first.session.sessionId)
  assert.equal(firstCall?.workingDirectory, expectedWorkspace)
  assert.equal(secondCall?.workingDirectory, expectedWorkspace)
  assert.notEqual(firstCall?.workingDirectory, vaultRoot)
  assert.match(path.relative(vaultRoot, expectedWorkspace), /^\.\.(?:[\\/]|$)/u)
})

test('sendAssistantMessage preserves nested in-vault working directories inside the isolated workspace', async () => {
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
  const expectedWorkspaceRoot = path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    'workspaces',
    result.session.sessionId,
  )
  const expectedWorkspaceDirectory = path.join(
    expectedWorkspaceRoot,
    'notes',
    'daily',
  )

  assert.equal(firstCall?.workingDirectory, expectedWorkspaceDirectory)
  assert.equal(firstCall?.env?.[VAULT_ENV], path.resolve(vaultRoot))
  assert.equal(
    path.relative(expectedWorkspaceRoot, firstCall?.workingDirectory ?? ''),
    path.join('notes', 'daily'),
  )
  assert.match(
    await readFile(path.join(expectedWorkspaceRoot, 'README.md'), 'utf8'),
    /isolated assistant workspace/u,
  )
})

test('sendAssistantMessage cold-starts Codex again when the requested working directory changes', async () => {
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
      providerSessionId: 'thread-workspace-change-2',
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
  const expectedWorkspaceRoot = path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    'workspaces',
    first.session.sessionId,
  )

  assert.equal(firstCall?.resumeProviderSessionId, null)
  assert.equal(secondCall?.resumeProviderSessionId, null)
  assert.equal(firstCall?.workingDirectory, expectedWorkspaceRoot)
  assert.equal(
    secondCall?.workingDirectory,
    path.join(expectedWorkspaceRoot, 'notes', 'daily'),
  )
  assert.equal(
    second.session.providerBinding?.providerSessionId,
    'thread-workspace-change-2',
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

  const result = await sendAssistantMessage({
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
  const unexpectedWorkspace = path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    'workspaces',
    result.session.sessionId,
  )

  assert.equal(firstCall?.provider, 'openai-compatible')
  assert.equal(firstCall?.workingDirectory, vaultRoot)
  await assert.rejects(
    readFile(path.join(unexpectedWorkspace, 'README.md'), 'utf8'),
    /ENOENT/u,
  )
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

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:external-working-dir',
    provider: 'codex-cli',
    prompt: 'Use the external working directory.',
    workingDirectory: externalRoot,
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const unexpectedWorkspace = path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    'workspaces',
    result.session.sessionId,
  )

  assert.equal(firstCall?.provider, 'codex-cli')
  assert.equal(firstCall?.workingDirectory, externalRoot)
  assert.equal(firstCall?.env?.[VAULT_ENV], path.resolve(vaultRoot))
  await assert.rejects(
    readFile(path.join(unexpectedWorkspace, 'README.md'), 'utf8'),
    /ENOENT/u,
  )
})

test('sendAssistantMessage clamps vault-bound danger-full-access requests back to workspace-write', async () => {
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
  assert.equal(firstCall?.sandbox, 'workspace-write')
  assert.equal(result.session.providerOptions.sandbox, 'workspace-write')
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
    /Never include citations, source lists, footnotes, bracketed references/u,
  )
  assert.match(
    outboundCall?.systemPrompt ?? '',
    /Do not mention internal vault paths, ledger filenames, JSONL files/u,
  )
  assert.match(
    outboundCall?.systemPrompt ?? '',
    /Do not surface raw machine timestamps such as ISO-8601 values by default/u,
  )
  assert.match(
    outboundCall?.systemPrompt ?? '',
    /user-facing messaging channel, not the local terminal chat UI/u,
  )
  assert.doesNotMatch(
    localChatCall?.systemPrompt ?? '',
    /Never include citations, source lists, footnotes, bracketed references/u,
  )
  assert.doesNotMatch(
    localChatCall?.systemPrompt ?? '',
    /Do not mention internal vault paths, ledger filenames, JSONL files/u,
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
      channel: 'imessage',
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
    channel: 'imessage',
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
  assert.equal(receipt.responsePreview, 'Assistant reply.')
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

test('sendAssistantMessage replays the local transcript for OpenAI-compatible sessions and keeps provider session ids local-only', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-openai-compatible-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

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
      {
        provider: 'codex-cli',
      },
      homeRoot,
    )

    const first = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:openai-compatible',
      enableFirstTurnOnboarding: true,
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      prompt: 'first question',
    })

    const second = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:openai-compatible',
      enableFirstTurnOnboarding: true,
      prompt: 'second question',
    })

    const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

    assert.equal(firstCall?.resumeProviderSessionId, null)
    assert.equal(secondCall?.resumeProviderSessionId, null)
    assert.equal(secondCall?.provider, 'openai-compatible')
    assert.match(firstCall?.systemPrompt ?? '', /You are Murph/u)
    assert.match(secondCall?.systemPrompt ?? '', /You are Murph/u)
    assert.match(firstCall?.systemPrompt ?? '', /Assistant state tools are exposed in this session/u)
    assert.match(firstCall?.systemPrompt ?? '', /Assistant memory tools are exposed in this session/u)
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Scheduled assistant automation tools are exposed in this session/u,
    )
    assert.match(
      firstCall?.systemPrompt ?? '',
      /does not expose direct CLI execution/u,
    )
    assert.doesNotMatch(
      firstCall?.systemPrompt ?? '',
      /does not expose Murph assistant-memory tools or direct shell access/u,
    )
    assert.doesNotMatch(
      firstCall?.systemPrompt ?? '',
      /does not expose Murph cron tools or direct shell access/u,
    )
    assert.equal(firstCall?.toolRuntime?.vault, vaultRoot)
    assert.equal(typeof firstCall?.toolRuntime?.requestId, 'string')
    assert.equal(secondCall?.toolRuntime?.vault, vaultRoot)
    assert.equal(typeof secondCall?.toolRuntime?.requestId, 'string')
    assert.match(firstCall?.systemPrompt ?? '', /optional onboarding check-in/u)
    assert.match(firstCall?.systemPrompt ?? '', /what tone or response style they want/u)
    assert.match(firstCall?.systemPrompt ?? '', /whether they want to give you a name/u)
    assert.match(firstCall?.systemPrompt ?? '', /what goals they want help with/u)
    assert.doesNotMatch(secondCall?.systemPrompt ?? '', /optional onboarding check-in/u)
    assert.equal(firstCall?.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(secondCall?.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(firstCall?.model, 'gpt-oss:20b')
    assert.equal(secondCall?.model, 'gpt-oss:20b')
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

test('sendAssistantMessage rotates stale Codex provider sessions after a prompt-version change while keeping local transcript continuity', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-codex-prompt-version-'))
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
  const expectedWorkingDirectory = path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    'workspaces',
    resolved.session.sessionId,
  )
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
        codexCli: {
          promptVersion: '2026-03-20.1',
        },
        resumeRouteId: primaryRoute!.routeId,
        resumeWorkspaceKey: buildWorkingDirectoryKey(expectedWorkingDirectory),
      },
    },
    updatedAt: '2026-03-26T00:00:00.000Z',
    lastTurnAt: '2026-03-26T00:00:00.000Z',
    turnCount: 2,
  })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-fresh-codex',
    response: 'Fresh reply.',
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
  assert.equal(call?.resumeProviderSessionId, null)
  assert.match(
    call?.continuityContext ?? '',
    /Recent local conversation transcript from this same Murph session/u,
  )
  assert.match(call?.continuityContext ?? '', /User: Old question about dinner\./u)
  assert.match(call?.continuityContext ?? '', /Assistant: Old answer about dinner\./u)
  assert.match(
    call?.continuityContext ?? '',
    /bootstrapping the fresh Codex provider session/u,
  )
  assert.equal(
    result.session.providerBinding?.providerSessionId,
    'thread-fresh-codex',
  )
  assert.equal(
    result.session.providerBinding?.providerState?.codexCli?.promptVersion,
    CURRENT_CODEX_PROMPT_VERSION,
  )
  assert.equal(result.session.turnCount, 3)
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
        codexCli: null,
        resumeRouteId: null,
        resumeWorkspaceKey: null,
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

test('sendAssistantMessage cold-starts when a saved provider binding is missing explicit resume workspace metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-legacy-workspace-binding-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:legacy-workspace-binding',
    provider: 'codex-cli',
  })
  const expectedWorkingDirectory = path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    'workspaces',
    resolved.session.sessionId,
  )
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
        codexCli: null,
        resumeRouteId: primaryRoute!.routeId,
        resumeWorkspaceKey: null,
      },
    },
    updatedAt: '2026-03-26T00:00:00.000Z',
    lastTurnAt: '2026-03-26T00:00:00.000Z',
    turnCount: 0,
  })

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-fresh-after-legacy-workspace-binding',
    response: 'Fresh reply.',
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
  assert.equal(call?.resumeProviderSessionId, null)
  assert.equal(call?.workingDirectory, expectedWorkingDirectory)
  assert.equal(
    result.session.providerBinding?.providerSessionId,
    'thread-fresh-after-legacy-workspace-binding',
  )
})

test('sendAssistantMessage onboarding persists answered slots and asks only for missing items in later new sessions', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-onboarding-partial-'))
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
    enableFirstTurnOnboarding: true,
    prompt: 'Call me Chris.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:onboarding-two',
    enableFirstTurnOnboarding: true,
    prompt: 'What should you know about me already?',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.match(firstCall?.systemPrompt ?? '', /Known onboarding answers/u)
  assert.match(firstCall?.systemPrompt ?? '', /Name: Call the user Chris\./u)
  assert.match(firstCall?.systemPrompt ?? '', /what tone or response style they want/u)
  assert.match(firstCall?.systemPrompt ?? '', /what goals they want help with/u)
  assert.doesNotMatch(
    firstCall?.systemPrompt ?? '',
    /whether they want to give you a name/u,
  )
  assert.match(secondCall?.systemPrompt ?? '', /Name: Call the user Chris\./u)
  assert.doesNotMatch(
    secondCall?.systemPrompt ?? '',
    /what tone or response style they want/u,
  )
  assert.match(secondCall?.systemPrompt ?? '', /what goals they want help with/u)
  assert.doesNotMatch(
    secondCall?.systemPrompt ?? '',
    /whether they want to give you a name/u,
  )
})

test('sendAssistantMessage suppresses onboarding once name, tone, and goals are already answered', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-onboarding-complete-'))
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
    alias: 'chat:onboarding-complete-one',
    enableFirstTurnOnboarding: true,
    prompt:
      'Call me Chris. Keep answers concise. I want help with training and cholesterol.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:onboarding-complete-two',
    enableFirstTurnOnboarding: true,
    prompt: 'What should you remember across sessions?',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.doesNotMatch(firstCall?.systemPrompt ?? '', /optional onboarding check-in/u)
  assert.doesNotMatch(secondCall?.systemPrompt ?? '', /optional onboarding check-in/u)
})

test('sendAssistantMessage asks for optional name and tone only once even when later new sessions still need onboarding', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-onboarding-optional-once-'))
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
    alias: 'chat:onboarding-name-once-one',
    enableFirstTurnOnboarding: true,
    prompt: 'first question',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:onboarding-name-once-two',
    enableFirstTurnOnboarding: true,
    prompt: 'second question',
  })

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.match(firstCall?.systemPrompt ?? '', /whether they want to give you a name/u)
  assert.match(firstCall?.systemPrompt ?? '', /what tone or response style they want/u)
  assert.match(firstCall?.systemPrompt ?? '', /what goals they want help with/u)
  assert.doesNotMatch(
    secondCall?.systemPrompt ?? '',
    /whether they want to give you a name/u,
  )
  assert.doesNotMatch(
    secondCall?.systemPrompt ?? '',
    /what tone or response style they want/u,
  )
  assert.match(secondCall?.systemPrompt ?? '', /what goals they want help with/u)
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

function requireTurnContext(env: NodeJS.ProcessEnv | undefined) {
  const turnContext = resolveAssistantMemoryTurnContext(env)
  if (!turnContext) {
    throw new Error('Expected assistant memory turn context on the provider turn.')
  }

  return turnContext
}

test('sendAssistantMessage loads only explicit assistant-written core memory into fresh sessions', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockImplementationOnce(async (input: { env?: NodeJS.ProcessEnv }) => {
      const turnContext = requireTurnContext(input.env)

      await Promise.all([
        upsertAssistantMemory({
          vault: vaultRoot,
          text: 'Call me Chris.',
          scope: 'both',
          section: 'Identity',
          turnContext,
        }),
        upsertAssistantMemory({
          vault: vaultRoot,
          text: 'Keep answers concise.',
          scope: 'long-term',
          section: 'Standing instructions',
          turnContext,
        }),
      ])

      return {
        provider: 'codex-cli',
        providerSessionId: 'thread-memory-1',
        response: 'Noted.',
        stderr: '',
        stdout: '',
        rawEvents: [],
      }
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-memory-2',
      response: 'I remember.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:one',
    prompt: 'Call me Chris. Going forward, keep answers concise.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:two',
    prompt: 'What should you remember across sessions?',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.match(longTermMemory, /Call the user Chris\./u)
  assert.match(longTermMemory, /keep answers concise\./iu)
  assert.match(secondCall?.systemPrompt ?? '', /Core assistant memory:/u)
  assert.match(secondCall?.systemPrompt ?? '', /Call the user Chris\./u)
  assert.match(secondCall?.systemPrompt ?? '', /keep answers concise\./iu)
  assert.doesNotMatch(secondCall?.systemPrompt ?? '', /Recent daily assistant memory/u)
})

test('sendAssistantMessage no longer auto-persists memory without explicit assistant upserts', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-no-auto-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-no-auto-1',
      response: 'I can do that.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-no-auto-2',
      response: 'There is nothing stored yet.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:no-auto-one',
    prompt: 'Call me Chris. Going forward, keep answers concise.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:no-auto-two',
    prompt: 'What should you remember?',
  })

  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.doesNotMatch(secondCall?.systemPrompt ?? '', /Core assistant memory:/u)
})

test('sendAssistantMessage bootstraps only the latest mutable long-term memory written through assistant memory upserts', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-upsert-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockImplementationOnce(async (input: { env?: NodeJS.ProcessEnv }) => {
      const turnContext = requireTurnContext(input.env)

      await Promise.all([
        upsertAssistantMemory({
          vault: vaultRoot,
          text: 'Call me Chris.',
          scope: 'both',
          section: 'Identity',
          turnContext,
        }),
        upsertAssistantMemory({
          vault: vaultRoot,
          text: 'Keep answers concise.',
          scope: 'long-term',
          section: 'Standing instructions',
          turnContext,
        }),
        upsertAssistantMemory({
          vault: vaultRoot,
          text: 'Use imperial units.',
          scope: 'long-term',
          section: 'Preferences',
          turnContext,
        }),
      ])

      return {
        provider: 'codex-cli',
        providerSessionId: 'thread-upsert-1',
        response: 'Noted.',
        stderr: '',
        stdout: '',
        rawEvents: [],
      }
    })
    .mockImplementationOnce(async (input: { env?: NodeJS.ProcessEnv }) => {
      const turnContext = requireTurnContext(input.env)

      await Promise.all([
        upsertAssistantMemory({
          vault: vaultRoot,
          text: 'Call me Alex.',
          scope: 'both',
          section: 'Identity',
          turnContext,
        }),
        upsertAssistantMemory({
          vault: vaultRoot,
          text: 'Keep answers detailed.',
          scope: 'long-term',
          section: 'Standing instructions',
          turnContext,
        }),
        upsertAssistantMemory({
          vault: vaultRoot,
          text: 'Use metric units.',
          scope: 'long-term',
          section: 'Preferences',
          turnContext,
        }),
      ])

      return {
        provider: 'codex-cli',
        providerSessionId: 'thread-upsert-2',
        response: 'Updated.',
        stderr: '',
        stdout: '',
        rawEvents: [],
      }
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-upsert-3',
      response: 'I remember the latest preferences.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:upsert-one',
    prompt: 'Call me Chris. Going forward, keep answers concise. Use imperial units.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:upsert-two',
    prompt:
      'Actually, call me Alex from now on. From now on, keep answers detailed. Use metric units.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:upsert-three',
    prompt: 'What should you remember across sessions now?',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const thirdCall = serviceMocks.executeAssistantProviderTurn.mock.calls[2]?.[0]

  assert.match(longTermMemory, /Call the user Alex\./u)
  assert.doesNotMatch(longTermMemory, /Call the user Chris\./u)
  assert.match(longTermMemory, /keep answers detailed\./iu)
  assert.doesNotMatch(longTermMemory, /keep answers concise\./iu)
  assert.match(longTermMemory, /Use metric units\./u)
  assert.doesNotMatch(longTermMemory, /Use imperial units\./u)
  assert.match(thirdCall?.systemPrompt ?? '', /Call the user Alex\./u)
  assert.doesNotMatch(thirdCall?.systemPrompt ?? '', /Call the user Chris\./u)
  assert.match(thirdCall?.systemPrompt ?? '', /keep answers detailed\./iu)
  assert.doesNotMatch(thirdCall?.systemPrompt ?? '', /keep answers concise\./iu)
  assert.match(thirdCall?.systemPrompt ?? '', /Use metric units\./u)
  assert.doesNotMatch(thirdCall?.systemPrompt ?? '', /Use imperial units\./u)
})

test('sendAssistantMessage can persist selected health context into assistant memory for private future sessions', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-sensitive-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockImplementationOnce(async (input: { env?: NodeJS.ProcessEnv }) => {
      await upsertAssistantMemory({
        vault: vaultRoot,
        text: "User's blood pressure is 120 over 80.",
        scope: 'both',
        section: 'Health context',
        turnContext: requireTurnContext(input.env),
      })

      return {
        provider: 'codex-cli',
        providerSessionId: 'thread-sensitive-1',
        response: 'Noted.',
        stderr: '',
        stdout: '',
        rawEvents: [],
      }
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-sensitive-2',
      response: 'I remember.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:health-one',
    prompt: 'Remember that my blood pressure is 120 over 80.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:health-two',
    prompt: 'What health context should carry into future chats?',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.match(longTermMemory, /## Health context/u)
  assert.match(longTermMemory, /User's blood pressure is 120 over 80\./u)
  assert.match(secondCall?.systemPrompt ?? '', /Core assistant memory:/u)
  assert.match(secondCall?.systemPrompt ?? '', /User's blood pressure is 120 over 80\./u)
})

test('sendAssistantMessage blocks health-memory upserts in non-private assistant contexts', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-group-health-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockImplementationOnce(async (input: { env?: NodeJS.ProcessEnv }) => {
      await assert.rejects(
        upsertAssistantMemory({
          vault: vaultRoot,
          text: 'User has diabetes.',
          scope: 'long-term',
          section: 'Health context',
          turnContext: requireTurnContext(input.env),
        }),
        /private assistant contexts/u,
      )

      return {
        provider: 'codex-cli',
        providerSessionId: 'thread-group-health-1',
        response: 'I should not store that here.',
        stderr: '',
        stdout: '',
        rawEvents: [],
      }
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-group-health-2',
      response: 'No private health memory is available here.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:group-health-one',
    channel: 'imessage',
    participantId: 'contact:group',
    sourceThreadId: 'thread-group',
    threadIsDirect: false,
    prompt: 'Remember that I have diabetes.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:group-health-two',
    channel: 'imessage',
    participantId: 'contact:group',
    sourceThreadId: 'thread-group-2',
    threadIsDirect: false,
    prompt: 'What private health context is available?',
  })

  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.doesNotMatch(secondCall?.systemPrompt ?? '', /Health context/u)
})


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

test('sendAssistantMessage recreates a missing local session from the live session snapshot and retries the turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-session-restore-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:restore',
  })
  const expectedWorkingDirectory = path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    'workspaces',
    created.session.sessionId,
  )
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
        codexCli: null,
        resumeRouteId: primaryRoute!.routeId,
        resumeWorkspaceKey: buildWorkingDirectoryKey(expectedWorkingDirectory),
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

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-live-1',
    response: 'Recovered.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    prompt: 'Keep going.',
    sessionId: hydrated.sessionId,
    sessionSnapshot: hydrated,
  })

  assert.equal(result.session.sessionId, hydrated.sessionId)
  assert.equal(result.session.providerBinding?.providerSessionId, 'thread-live-1')
  assert.equal(result.session.turnCount, 2)

  const persisted = await resolveAssistantSession({
    vault: vaultRoot,
    sessionId: hydrated.sessionId,
    createIfMissing: false,
  })
  assert.equal(persisted.session.sessionId, hydrated.sessionId)
  assert.equal(persisted.session.turnCount, 2)

  const transcript = await listAssistantTranscriptEntries(vaultRoot, hydrated.sessionId)
  assert.deepEqual(
    transcript.map((entry) => ({
      kind: entry.kind,
      text: entry.text,
    })),
    [
      {
        kind: 'user',
        text: 'Keep going.',
      },
      {
        kind: 'assistant',
        text: 'Recovered.',
      },
    ],
  )

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(firstCall?.resumeProviderSessionId, 'thread-live-1')
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

  assert.equal(resolved.session.providerBinding?.providerSessionId ?? null, null)
  assert.equal(resolved.session.turnCount, 0)
  const recovery = await readAssistantProviderRouteRecovery(
    vaultRoot,
    resolved.session.sessionId,
  )
  assert.equal(
    recovery?.routes[0]?.providerSessionId,
    'thread-resume-1',
  )

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

test('sendAssistantMessage does not resume a recovered provider session after the working directory changes', async () => {
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
      providerSessionId: 'thread-fresh-workdir',
      response: 'Started fresh.',
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
  const recovery = await readAssistantProviderRouteRecovery(
    vaultRoot,
    resolved.session.sessionId,
  )
  assert.equal(
    recovery?.routes[0]?.providerSessionId,
    'thread-recover-default-workdir',
  )

  const retried = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:recoverable-workdir-change',
    prompt: 'retry somewhere else',
    workingDirectory: alternateWorkingDirectory,
  })

  assert.equal(retried.session.providerBinding?.providerSessionId, 'thread-fresh-workdir')
  assert.equal(
    serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.resumeProviderSessionId,
    null,
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

test('sendAssistantMessage rolls back unauthorized direct canonical vault edits and fails the turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-guard-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const metadataPath = path.join(vaultRoot, 'vault.json')
  const beforeMetadata = await readFile(metadataPath, 'utf8')

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          schemaVersion: 'broken',
        },
        null,
        2,
      )}\n`,
    )

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-direct-write',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-guard',
    prompt: 'Inspect the vault.',
  })

  assertBlockedAssistantResult(result, {
    paths: ['vault.json'],
  })

  assert.equal(await readFile(metadataPath, 'utf8'), beforeMetadata)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-guard',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerBinding?.providerSessionId ?? null, null)
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
        auditId?: string
        envelopePath: string
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
    eventId: string
    auditId?: string
    envelopePath: string
  }

  const eventRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: 'ledger/events/2026/2026-03.jsonl',
  })
  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: 'audit/2026/2026-03.jsonl',
  })
  assert.equal(eventRecords.filter((record) => record.id === persisted.eventId).length, 1)
  assert.equal(auditRecords.filter((record) => record.id === persisted.auditId).length, 1)
  assert.match(persisted.envelopePath, /^raw\/inbox\/telegram\/bot\/2026\/03\/cap_/u)
})

test('sendAssistantMessage preserves canonical writes from operations staged before the guard snapshot and committed during the provider turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-staged-before-snapshot-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/guard-staged-before-snapshot.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const committedContent = '# Guarded staged-before-snapshot write\n'
  const operationId = 'op_guard_staged_before_snapshot'
  const metadataRelativePath = `.runtime/operations/${operationId}.json`
  const metadataPath = path.join(vaultRoot, metadataRelativePath)

  await mkdir(path.dirname(metadataPath), { recursive: true })
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        schemaVersion: 'murph.write-operation.v1',
        operationId,
        operationType: 'assistant_guard_staged_before_snapshot_test',
        summary: 'Commit a pre-staged canonical write during the guarded provider turn',
        status: 'staged',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
        occurredAt: '2026-03-27T00:00:00.000Z',
        actions: [
          {
            kind: 'text_write',
            state: 'staged',
            targetRelativePath,
            stageRelativePath: `.runtime/operations/${operationId}/payloads/0000.txt`,
            overwrite: true,
            allowExistingMatch: false,
            allowRaw: false,
          },
        ],
      },
      null,
      2,
    )}\n`,
  )

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await writeFile(targetPath, committedContent)
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          schemaVersion: 'murph.write-operation.v1',
          operationId,
          operationType: 'assistant_guard_staged_before_snapshot_test',
          summary: 'Commit a pre-staged canonical write during the guarded provider turn',
          status: 'committed',
          createdAt: '2026-03-27T00:00:00.000Z',
          updatedAt: '2026-03-27T00:00:01.000Z',
          occurredAt: '2026-03-27T00:00:00.000Z',
          actions: [
            {
              kind: 'text_write',
              state: 'applied',
              targetRelativePath,
              stageRelativePath: `.runtime/operations/${operationId}/payloads/0000.txt`,
              overwrite: true,
              allowExistingMatch: false,
              allowRaw: false,
              committedPayloadReceipt: {
                sha256: createHash('sha256').update(committedContent).digest('hex'),
                byteLength: Buffer.byteLength(committedContent),
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
    await writeGuardReceipt({
      operationId,
      createdAt: '2026-03-27T00:00:00.000Z',
      updatedAt: '2026-03-27T00:00:01.000Z',
      actions: [
        {
          kind: 'text_write',
          targetRelativePath,
          payload: committedContent,
        },
      ],
    })

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-prestaged-write',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-prestaged-write',
    prompt: 'Commit the pre-staged canonical write.',
  })

  assert.equal(result.response, 'assistant reply')
  assert.equal(result.session.turnCount, 1)
  assert.equal(await readFile(targetPath, 'utf8'), committedContent)
})

test('sendAssistantMessage restores the committed canonical content when a provider tampers with the same file after an audited write', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-tamper-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const metadataPath = path.join(vaultRoot, 'vault.json')
  const corePath = path.join(vaultRoot, 'CORE.md')

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await updateVaultSummary({
      vaultRoot,
      title: 'Legit Guarded Title',
    })
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          schemaVersion: 'broken-again',
        },
        null,
        2,
      )}\n`,
    )
    await writeFile(corePath, 'Tampered after write.\n')

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-tamper',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-tamper',
    prompt: 'Inspect the vault.',
  })

  assertBlockedAssistantResult(result, {
    paths: ['CORE.md', 'vault.json'],
  })

  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  assert.equal(metadata.title, 'Legit Guarded Title')
})

test('sendAssistantMessage blocks on malformed write-operation metadata and still rolls back later direct tampering', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-canonical-bad-operation-metadata-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/guard-corrupted-metadata.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const committedContent = '# Guarded metadata corruption\n'

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    const existingOperationPaths = new Set(
      await listWriteOperationMetadataPaths(vaultRoot),
    )
    await applyCanonicalWriteBatch({
      vaultRoot,
      operationType: 'assistant_guard_bad_metadata_test',
      summary: 'Write guarded metadata corruption target',
      textWrites: [
        {
          relativePath: targetRelativePath,
          content: committedContent,
        },
      ],
    })

    const operationRelativePath = await findNewOperationMetadataPath(
      vaultRoot,
      existingOperationPaths,
    )
    const operationPath = path.join(vaultRoot, operationRelativePath)
    const operation = JSON.parse(await readFile(operationPath, 'utf8')) as Record<string, unknown>
    operation.schemaVersion = 'broken-write-operation'
    await writeFile(
      operationPath,
      `${JSON.stringify(operation, null, 2)}\n`,
    )
    await writeFile(targetPath, 'tampered-after-corruption\n')

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-bad-operation-metadata',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-bad-operation-metadata',
    prompt: 'Update the vault title.',
  })

  assertBlockedAssistantResult(result, {
    guardFailureReason: 'invalid_write_operation_metadata',
    guardFailureCode: 'OPERATION_INVALID',
    guardFailurePathPattern: /^\.runtime\/operations\/op_/u,
    paths: [targetRelativePath],
  })

  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-bad-operation-metadata',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerBinding?.providerSessionId ?? null, null)
})

test('sendAssistantMessage blocks on invalid write-operation action states and still rolls back later direct tampering', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-canonical-bad-operation-state-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/guard-corrupted-action-state.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const committedContent = '# Guarded invalid action state\n'

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    const existingOperationPaths = new Set(
      await listWriteOperationMetadataPaths(vaultRoot),
    )
    await applyCanonicalWriteBatch({
      vaultRoot,
      operationType: 'assistant_guard_bad_action_state_test',
      summary: 'Write guarded invalid action state target',
      textWrites: [
        {
          relativePath: targetRelativePath,
          content: committedContent,
        },
      ],
    })

    const operationRelativePath = await findNewOperationMetadataPath(
      vaultRoot,
      existingOperationPaths,
    )
    const operationPath = path.join(vaultRoot, operationRelativePath)
    const operation = JSON.parse(await readFile(operationPath, 'utf8')) as {
      actions?: Array<Record<string, unknown>>
    }
    assert.ok(Array.isArray(operation.actions))
    operation.actions?.forEach((action) => {
      if (action.kind === 'text_write' && action.targetRelativePath === targetRelativePath) {
        action.state = 'unknown'
      }
    })
    await writeFile(operationPath, `${JSON.stringify(operation, null, 2)}\n`)
    await writeFile(targetPath, 'tampered-after-corruption\n')

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-bad-action-state',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-bad-action-state',
    prompt: 'Update the vault title.',
  })

  assertBlockedAssistantResult(result, {
    guardFailureReason: 'invalid_write_operation_metadata',
    guardFailureCode: 'OPERATION_INVALID',
    guardFailurePathPattern: /^\.runtime\/operations\/op_/u,
    paths: [targetRelativePath],
  })

  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-bad-action-state',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerBinding?.providerSessionId ?? null, null)
})

test('sendAssistantMessage blocks when committed payload receipt metadata is missing', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-canonical-missing-committed-payload-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/guard-missing-payload.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const committedContent = '# Guarded missing payload corruption\n'

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    const existingOperationPaths = new Set(
      await listWriteOperationMetadataPaths(vaultRoot),
    )
    await applyCanonicalWriteBatch({
      vaultRoot,
      operationType: 'assistant_guard_missing_payload_test',
      summary: 'Write guarded missing payload target',
      textWrites: [
        {
          relativePath: targetRelativePath,
          content: committedContent,
        },
      ],
    })

    const operationRelativePath = await findNewOperationMetadataPath(
      vaultRoot,
      existingOperationPaths,
    )
    const operationPath = path.join(vaultRoot, operationRelativePath)
    const operation = JSON.parse(await readFile(operationPath, 'utf8')) as {
      actions?: Array<Record<string, unknown>>
    }
    assert.ok(Array.isArray(operation.actions))
    operation.actions?.forEach((action) => {
      if (action.kind === 'text_write' && action.targetRelativePath === targetRelativePath) {
        delete action.committedPayloadReceipt
      }
    })
    await writeFile(operationPath, `${JSON.stringify(operation, null, 2)}\n`)

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-missing-committed-payload',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-missing-committed-payload',
    prompt: 'Update the vault title.',
  })

  assertBlockedAssistantResult(result, {
    guardFailureCode: 'OPERATION_INVALID',
    guardFailureReason: 'invalid_write_operation_metadata',
    guardFailureTargetPath: null,
    guardFailurePathPattern: /^\.runtime\/operations\/op_/u,
    paths: [targetRelativePath],
  })

  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-missing-committed-payload',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerBinding?.providerSessionId ?? null, null)
})

test('sendAssistantMessage blocks when the trusted guard payload copy is missing', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-canonical-missing-guard-receipt-payload-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/guard-noncanonical-payload.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const committedContent = '# Guarded noncanonical payload corruption\n'

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    const existingOperationPaths = new Set(
      await listWriteOperationMetadataPaths(vaultRoot),
    )
    await applyCanonicalWriteBatch({
      vaultRoot,
      operationType: 'assistant_guard_noncanonical_payload_test',
      summary: 'Write guarded noncanonical payload target',
      textWrites: [
        {
          relativePath: targetRelativePath,
          content: committedContent,
        },
      ],
    })

    const operationRelativePath = await findNewOperationMetadataPath(
      vaultRoot,
      existingOperationPaths,
    )
    const operation = JSON.parse(
      await readFile(path.join(vaultRoot, operationRelativePath), 'utf8'),
    ) as {
      operationId: string
    }
    const receiptRoot = await findGuardReceiptRoot()
    const receiptPath = path.join(receiptRoot, `${operation.operationId}.json`)
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as {
      actions?: Array<Record<string, unknown>>
    }
    const payloadRelativePath = receipt.actions?.find(
      (action) =>
        action.kind === 'text_write' &&
        action.targetRelativePath === targetRelativePath &&
        typeof action.payloadRelativePath === 'string',
    )?.payloadRelativePath
    assert.equal(typeof payloadRelativePath, 'string')
    await rm(path.join(receiptRoot, payloadRelativePath as string), { force: true })
    await writeFile(targetPath, 'tampered-after-noncanonical-payload\n')

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-missing-guard-receipt-payload',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-missing-guard-receipt-payload',
    prompt: 'Update the vault title.',
  })

  assertBlockedAssistantResult(result, {
    actionKind: 'text_write',
    guardFailureReason: 'invalid_committed_payload',
    guardFailureTargetPath: targetRelativePath,
    guardFailurePathPattern: /^\.runtime\/operations\/op_/u,
    paths: [targetRelativePath],
  })

  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-missing-guard-receipt-payload',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerBinding?.providerSessionId ?? null, null)
})

test('sendAssistantMessage blocks when the trusted guard payload copy no longer matches its receipt digest', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-canonical-mismatched-guard-receipt-payload-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/guard-binary-payload.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const committedContent = '# Guarded binary payload corruption\n'

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    const existingOperationPaths = new Set(
      await listWriteOperationMetadataPaths(vaultRoot),
    )
    await applyCanonicalWriteBatch({
      vaultRoot,
      operationType: 'assistant_guard_binary_payload_test',
      summary: 'Write guarded binary payload target',
      textWrites: [
        {
          relativePath: targetRelativePath,
          content: committedContent,
        },
      ],
    })

    const operationRelativePath = await findNewOperationMetadataPath(
      vaultRoot,
      existingOperationPaths,
    )
    const operation = JSON.parse(
      await readFile(path.join(vaultRoot, operationRelativePath), 'utf8'),
    ) as {
      operationId: string
    }
    const receiptRoot = await findGuardReceiptRoot()
    const receiptPath = path.join(receiptRoot, `${operation.operationId}.json`)
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as {
      actions?: Array<Record<string, unknown>>
    }
    const payloadRelativePath = receipt.actions?.find(
      (action) =>
        action.kind === 'text_write' &&
        action.targetRelativePath === targetRelativePath &&
        typeof action.payloadRelativePath === 'string',
    )?.payloadRelativePath
    assert.equal(typeof payloadRelativePath, 'string')
    await writeFile(
      path.join(receiptRoot, payloadRelativePath as string),
      'tampered-receipt-copy\n',
      'utf8',
    )

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-mismatched-guard-receipt-payload',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-mismatched-guard-receipt-payload',
    prompt: 'Update the vault title.',
  })

  assertBlockedAssistantResult(result, {
    actionKind: 'text_write',
    guardFailureReason: 'invalid_committed_payload',
    guardFailureTargetPath: targetRelativePath,
    guardFailurePathPattern: /^\.runtime\/operations\/op_/u,
    paths: [targetRelativePath],
  })

  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-mismatched-guard-receipt-payload',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerBinding?.providerSessionId ?? null, null)
})

test('sendAssistantMessage blocks rogue guard receipts that have no matching operation metadata file', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-rogue-guard-receipt-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/rogue-receipt-target.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const operationId = 'op_fake_guard_receipt_without_metadata'

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, 'provider direct write\n', 'utf8')
    await writeGuardReceipt({
      operationId,
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:01.000Z',
      actions: [
        {
          kind: 'text_write',
          targetRelativePath,
          payload: 'provider direct write\n',
        },
      ],
    })

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-rogue-guard-receipt',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:rogue-guard-receipt',
    prompt: 'Try to authorize a direct write with a rogue guard receipt.',
  })

  assertBlockedAssistantResult(result, {
    guardFailureReason: 'invalid_write_operation_metadata',
    guardFailurePathPattern: /^op_fake_guard_receipt_without_metadata\.json$/u,
    paths: [targetRelativePath],
  })
  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)
})

test('sendAssistantMessage blocks brand-new fake committed metadata from authorizing direct bank writes', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-fake-committed-metadata-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/fake-provider-write.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const operationId = 'op_fake_provider_write'
  const metadataPath = path.join(vaultRoot, `.runtime/operations/${operationId}.json`)

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await mkdir(path.dirname(metadataPath), { recursive: true })
    await writeFile(targetPath, 'provider direct write\n')
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          schemaVersion: 'murph.write-operation.v1',
          operationId,
          operationType: 'assistant_guard_fake_metadata_test',
          summary: 'Synthetic committed metadata should not authorize writes.',
          status: 'committed',
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:01.000Z',
          occurredAt: '2026-03-28T00:00:00.000Z',
          actions: [
            {
              kind: 'text_write',
              state: 'applied',
              targetRelativePath,
              stageRelativePath: `.runtime/operations/${operationId}/payloads/0000.txt`,
              overwrite: true,
              allowExistingMatch: false,
              allowRaw: false,
              committedPayloadReceipt: {
                sha256: createHash('sha256').update('provider direct write\n').digest('hex'),
                byteLength: Buffer.byteLength('provider direct write\n'),
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    )

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

  assertBlockedAssistantResult(result, {
    guardFailureReason: 'invalid_write_operation_metadata',
    guardFailureTargetPath: null,
    guardFailurePathPattern: /^\.runtime\/operations\/op_fake_provider_write\.json$/u,
    paths: [targetRelativePath],
  })
  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)
})

test('sendAssistantMessage does not create raw files from smuggled protected target paths in fake metadata', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-smuggled-target-path-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const smuggledTargetPath = 'bank/../raw/evil.md'
  const rawTargetPath = path.join(vaultRoot, 'raw', 'evil.md')
  const operationId = 'op_fake_smuggled_target'
  const metadataPath = path.join(vaultRoot, `.runtime/operations/${operationId}.json`)

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await mkdir(path.dirname(metadataPath), { recursive: true })
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          schemaVersion: 'murph.write-operation.v1',
          operationId,
          operationType: 'assistant_guard_smuggled_target_test',
          summary: 'Smuggled target paths must not be normalized into raw writes.',
          status: 'committed',
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:01.000Z',
          occurredAt: '2026-03-28T00:00:00.000Z',
          actions: [
            {
              kind: 'text_write',
              state: 'applied',
              targetRelativePath: smuggledTargetPath,
              stageRelativePath: `.runtime/operations/${operationId}/payloads/0000.txt`,
              overwrite: true,
              allowExistingMatch: false,
              allowRaw: false,
              committedPayloadReceipt: {
                sha256: createHash('sha256').update('smuggled\n').digest('hex'),
                byteLength: Buffer.byteLength('smuggled\n'),
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    )

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-smuggled-target-path',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:smuggled-target-path',
    prompt: 'Use fake metadata to smuggle a raw write.',
  })

  assertBlockedAssistantResult(result, {
    guardFailureCode: 'OPERATION_INVALID',
    guardFailureReason: 'invalid_write_operation_metadata',
    guardFailurePathPattern: /^\.runtime\/operations\/op_fake_smuggled_target\.json$/u,
    paths: [],
  })
  await assert.rejects(readFile(rawTargetPath, 'utf8'), /ENOENT/u)
})

test('sendAssistantMessage ignores attacker-controlled stage paths when committed payload receipts are absent', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-stage-path-without-receipt-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/stage-path-should-not-authorize.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const attackerPayloadRelativePath = 'raw/inbox/captures/cap_fake/attachments/1/evil.txt'
  const attackerPayloadPath = path.join(vaultRoot, attackerPayloadRelativePath)
  const operationId = 'op_fake_stage_path_without_receipt'
  const metadataPath = path.join(vaultRoot, `.runtime/operations/${operationId}.json`)

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await mkdir(path.dirname(attackerPayloadPath), { recursive: true })
    await mkdir(path.dirname(metadataPath), { recursive: true })
    await writeFile(attackerPayloadPath, 'attacker-controlled payload\n', 'utf8')
    await writeFile(targetPath, 'provider direct write\n', 'utf8')
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          schemaVersion: 'murph.write-operation.v1',
          operationId,
          operationType: 'assistant_guard_stage_path_without_receipt_test',
          summary: 'Missing receipts must not fall back to stageRelativePath.',
          status: 'committed',
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:01.000Z',
          occurredAt: '2026-03-28T00:00:00.000Z',
          actions: [
            {
              kind: 'text_write',
              state: 'applied',
              targetRelativePath,
              stageRelativePath: attackerPayloadRelativePath,
              overwrite: true,
              allowExistingMatch: false,
              allowRaw: false,
            },
          ],
        },
        null,
        2,
      )}\n`,
    )

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-stage-path-without-receipt',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:stage-path-without-receipt',
    prompt: 'Try to preserve a direct write with fake stage metadata.',
  })

  assertBlockedAssistantResult(result, {
    guardFailureCode: 'OPERATION_INVALID',
    guardFailureReason: 'invalid_write_operation_metadata',
    guardFailurePathPattern: /^\.runtime\/operations\/op_fake_stage_path_without_receipt\.json$/u,
    paths: [targetRelativePath],
  })
  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)
  assert.equal(await readFile(attackerPayloadPath, 'utf8'), 'attacker-controlled payload\n')
})

test('sendAssistantMessage prefers the canonical write guard error when the provider both writes directly and throws', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-provider-error-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const metadataPath = path.join(vaultRoot, 'vault.json')
  const beforeMetadata = await readFile(metadataPath, 'utf8')

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          schemaVersion: 'broken-after-provider-error',
        },
        null,
        2,
      )}\n`,
    )

    throw new VaultCliError(
      'ASSISTANT_CODEX_FAILED',
      'Codex CLI failed after mutating the vault.',
    )
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-provider-error',
    prompt: 'Inspect the vault.',
  })

  assertBlockedAssistantResult(result, {
    paths: ['vault.json'],
    providerErrorCode: 'ASSISTANT_CODEX_FAILED',
  })

  assert.equal(await readFile(metadataPath, 'utf8'), beforeMetadata)
})

test('sendAssistantMessage keeps recovered provider sessions out of the canonical session on blocked canonical-write turns', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-recoverable-error-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const metadataPath = path.join(vaultRoot, 'vault.json')
  const beforeMetadata = await readFile(metadataPath, 'utf8')

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          schemaVersion: 'broken-after-recoverable-provider-error',
        },
        null,
        2,
      )}\n`,
    )

    throw new VaultCliError(
      'ASSISTANT_CODEX_CONNECTION_LOST',
      'Codex CLI lost its connection after mutating the vault.',
      {
        connectionLost: true,
        providerSessionId: 'thread-recover-blocked-1',
        retryable: true,
      },
    )
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-recoverable-error',
    prompt: 'Inspect the vault.',
  })

  assertBlockedAssistantResult(result, {
    paths: ['vault.json'],
    providerErrorCode: 'ASSISTANT_CODEX_CONNECTION_LOST',
  })
  assert.equal(
    result.session.providerBinding?.providerSessionId,
    'thread-recover-blocked-1',
  )
  assert.equal(await readFile(metadataPath, 'utf8'), beforeMetadata)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-recoverable-error',
  })
  assert.equal(session.session.providerBinding?.providerSessionId ?? null, null)
  assert.equal(session.session.turnCount, 0)
  const recovery = await readAssistantProviderRouteRecovery(
    vaultRoot,
    session.session.sessionId,
  )
  assert.equal(
    recovery?.routes[0]?.providerSessionId,
    'thread-recover-blocked-1',
  )

  serviceMocks.executeAssistantProviderTurn.mockResolvedValueOnce({
    provider: 'codex-cli',
    providerSessionId: 'thread-recover-blocked-1',
    response: 'Recovered safely.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const retried = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-recoverable-error',
    prompt: 'Inspect the vault safely.',
  })

  assert.equal(
    retried.session.providerBinding?.providerSessionId,
    'thread-recover-blocked-1',
  )
  assert.equal(
    serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.resumeProviderSessionId,
    'thread-recover-blocked-1',
  )
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

test('sendAssistantMessage reconstructs audited ledger appends and rolls back later shard tampering', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-append-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const ledgerRelativePath = 'ledger/events/2026/2026-03.jsonl'
  const ledgerPath = path.join(vaultRoot, ledgerRelativePath)

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await applyCanonicalWriteBatch({
      vaultRoot,
      operationType: 'assistant_guard_append_test',
      summary: 'Append guarded ledger shard',
      jsonlAppends: [
        {
          relativePath: ledgerRelativePath,
          record: {
            id: 'evt_test_guard',
            kind: 'guard-test',
          },
        },
      ],
    })
    await writeFile(ledgerPath, '{"tampered":true}\n')

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-jsonl-append',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-append',
    prompt: 'Append to the event ledger.',
  })

  assertBlockedAssistantResult(result, {
    paths: [ledgerRelativePath],
  })

  assert.equal(
    await readFile(ledgerPath, 'utf8'),
    '{"id":"evt_test_guard","kind":"guard-test"}\n',
  )
})

test('sendAssistantMessage preserves large audited protected text writes after later tampering', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-canonical-large-text-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const targetRelativePath = 'bank/guard-large.md'
  const targetPath = path.join(vaultRoot, targetRelativePath)
  const largeContent = `# Guarded large write\n\n${'a'.repeat(2_200_000)}\n`

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await applyCanonicalWriteBatch({
      vaultRoot,
      operationType: 'assistant_guard_large_text_test',
      summary: 'Write large protected bank note',
      textWrites: [
        {
          relativePath: targetRelativePath,
          content: largeContent,
        },
      ],
    })
    await writeFile(targetPath, 'tampered-large-text\n')

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-large-text',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-large-text',
    prompt: 'Write a large protected bank note.',
  })

  assertBlockedAssistantResult(result, {
    paths: [targetRelativePath],
  })

  assert.equal(await readFile(targetPath, 'utf8'), largeContent)
})

test('sendAssistantMessage preserves large audited protected jsonl appends after later tampering', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-service-canonical-large-append-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const ledgerRelativePath = 'ledger/events/2026/2026-04.jsonl'
  const ledgerPath = path.join(vaultRoot, ledgerRelativePath)
  const largePayload = 'b'.repeat(2_200_000)
  const expectedAppend = `${JSON.stringify({
    id: 'evt_large_guard',
    kind: 'guard-test-large',
    payload: largePayload,
  })}\n`

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async () => {
    await applyCanonicalWriteBatch({
      vaultRoot,
      operationType: 'assistant_guard_large_append_test',
      summary: 'Append large protected ledger shard',
      jsonlAppends: [
        {
          relativePath: ledgerRelativePath,
          record: {
            id: 'evt_large_guard',
            kind: 'guard-test-large',
            payload: largePayload,
          },
        },
      ],
    })
    await writeFile(ledgerPath, '{"tampered":true}\n')

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-large-append',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-large-append',
    prompt: 'Append a large protected ledger record.',
  })

  assertBlockedAssistantResult(result, {
    paths: [ledgerRelativePath],
  })

  assert.equal(await readFile(ledgerPath, 'utf8'), expectedAppend)
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

test('sendAssistantMessage does not fail over or start cooldown when the canonical write guard blocks a provider turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-service-canonical-no-failover-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })
  await initializeVault({ vaultRoot })
  const metadataPath = path.join(vaultRoot, 'vault.json')

  serviceMocks.executeAssistantProviderTurn
    .mockImplementationOnce(async () => {
      await writeFile(
        metadataPath,
        `${JSON.stringify(
          {
            schemaVersion: 'broken-again',
          },
          null,
          2,
        )}\n`,
      )

      return {
        provider: 'codex-cli',
        providerSessionId: 'thread-no-failover',
        response: 'assistant reply',
        stderr: '',
        stdout: '',
        rawEvents: [],
      }
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-primary-still-healthy',
      response: 'safe reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  const first = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-no-failover',
    prompt: 'Inspect the vault.',
    failoverRoutes: [
      {
        name: 'backup',
        provider: 'openai-compatible',
        codexCommand: null,
        model: null,
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        cooldownMs: null,
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
      },
    ],
  })

  assertBlockedAssistantResult(first, {
    paths: ['vault.json'],
  })

  const second = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:canonical-no-failover',
    prompt: 'Try again safely.',
    failoverRoutes: [
      {
        name: 'backup',
        provider: 'openai-compatible',
        codexCommand: null,
        model: null,
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        cooldownMs: null,
        baseUrl: null,
        apiKeyEnv: null,
        providerName: null,
      },
    ],
  })

  assert.equal(second.response, 'safe reply')
  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.equal(
    serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]?.provider,
    'codex-cli',
  )
  assert.equal(
    serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]?.provider,
    'codex-cli',
  )
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

  serviceMocks.executeAssistantProviderTurn
    .mockRejectedValueOnce(
      attachOpenAiCompatibleProviderToolExecutionState(
        new VaultCliError('ASSISTANT_PRIMARY_FAILED', 'Primary route failed.', {
          retryable: true,
        }),
        {
          executedToolCount: 1,
          rawEvents: [
            {
              type: 'assistant.tool.started',
              tool: 'assistant.memory.search',
            },
          ],
        },
      ),
    )
    .mockRejectedValueOnce(
      new VaultCliError('ASSISTANT_BACKUP_FAILED', 'Backup route failed.', {
        retryable: true,
      }),
    )

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

  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 1)
})

test('sendAssistantMessage restores a missing local transcript snapshot for openai-compatible sessions before retrying the turn', async () => {
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

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'Recovered.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    prompt: 'Keep going.',
    sessionId: hydrated.sessionId,
    sessionSnapshot: hydrated,
    transcriptSnapshot: [
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
    ],
  })

  assert.equal(result.session.sessionId, hydrated.sessionId)
  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.deepEqual(firstCall?.conversationMessages, [
    {
      role: 'user',
      content: 'First question',
    },
    {
      role: 'assistant',
      content: 'First answer',
    },
  ])

  const transcript = await listAssistantTranscriptEntries(vaultRoot, hydrated.sessionId)
  assert.deepEqual(
    transcript.map((entry) => ({
      kind: entry.kind,
      text: entry.text,
    })),
    [
      {
        kind: 'user',
        text: 'First question',
      },
      {
        kind: 'assistant',
        text: 'First answer',
      },
      {
        kind: 'user',
        text: 'Keep going.',
      },
      {
        kind: 'assistant',
        text: 'Recovered.',
      },
    ],
  )
})

test('sendAssistantMessage refuses session-only restore for openai-compatible sessions when the local transcript is also missing', async () => {
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
      sessionSnapshot: created.session,
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_SESSION_TRANSCRIPT_RESTORE_REQUIRED')
      return true
    },
  )

  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 0)
})

test('sendAssistantMessage accepts an explicitly empty transcript snapshot for openai-compatible session restore', async () => {
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

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'Recovered from empty transcript.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    prompt: 'Keep going.',
    sessionId: created.session.sessionId,
    sessionSnapshot: created.session,
    transcriptSnapshot: [],
  })

  assert.equal(result.session.sessionId, created.session.sessionId)
  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.deepEqual(firstCall?.conversationMessages, [])

  const transcript = await listAssistantTranscriptEntries(
    vaultRoot,
    created.session.sessionId,
  )
  assert.deepEqual(
    transcript.map((entry) => ({
      kind: entry.kind,
      text: entry.text,
    })),
    [
      {
        kind: 'user',
        text: 'Keep going.',
      },
      {
        kind: 'assistant',
        text: 'Recovered from empty transcript.',
      },
    ],
  )
})
