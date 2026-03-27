import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  applyCanonicalWriteBatch,
  initializeVault,
  listWriteOperationMetadataPaths,
  readJsonlRecords,
  updateVaultSummary,
} from '@healthybob/core'
import {
  createInboxPipeline,
  openInboxRuntime,
} from '@healthybob/inboxd'
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

vi.mock('../src/chat-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../src/chat-provider.js')>(
    '../src/chat-provider.js',
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
import {
  VAULT_ENV,
  saveAssistantOperatorDefaultsPatch,
} from '../src/operator-config.js'
import {
  appendAssistantTranscriptEntries,
  listAssistantTranscriptEntries,
  resolveAssistantSession,
  resolveAssistantStatePaths,
  saveAssistantSession,
} from '../src/assistant-state.js'
import { VaultCliError } from '../src/vault-cli-errors.js'

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
  vi.restoreAllMocks()
})

beforeEach(() => {
  serviceMocks.deliverAssistantMessageOverBinding.mockReset()
  serviceMocks.executeAssistantProviderTurn.mockReset()
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

test('buildResolveAssistantSessionInput keeps locator shaping and operator default fallbacks stable', () => {
  const defaults = {
    provider: 'codex-cli' as const,
    codexCommand: '/opt/bin/codex',
    model: 'gpt-5.4-mini',
    reasoningEffort: 'high',
    identityId: 'assistant:primary',
    sandbox: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    profile: 'ops',
    oss: true,
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
      sessionId: undefined,
      alias: 'chat:bob',
      channel: 'imessage',
      identityId: 'assistant:primary',
      actorId: 'contact:bob',
      threadId: 'thread-1',
      threadIsDirect: undefined,
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
      sessionId: undefined,
      alias: undefined,
      channel: undefined,
      identityId: 'assistant:override',
      actorId: 'actor:override',
      threadId: 'thread-explicit',
      threadIsDirect: undefined,
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
      reasoningEffort: 'low',
    },
  )
})

test('sendAssistantMessage treats null provider-option inputs as fallbacks to saved operator defaults', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-provider-defaults-'))
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
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: 'OLLAMA_API_KEY',
      providerName: 'ollama',
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-'))
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
  assert.match(firstCall?.systemPrompt ?? '', /Healthy Bob philosophy:/u)
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
  assert.match(firstCall?.systemPrompt ?? '', /healthybob chat/u)
  assert.match(firstCall?.systemPrompt ?? '', /healthybob run/u)
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
    /use the matching `vault-cli` write surface so the write follows Healthy Bob's intended validation and audit path/u,
  )
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Direct Healthy Bob CLI execution is available in this session/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli <command> --help/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /meal photo, audio note, or a text-only description/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli meal add/u)
  assert.match(firstCall?.systemPrompt ?? '', /no longer requires a photo/u)
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
  assert.match(firstCall?.systemPrompt ?? '', /assistant state show/u)
  assert.match(firstCall?.systemPrompt ?? '', /non-canonical runtime scratchpads/u)
  assert.match(firstCall?.systemPrompt ?? '', /search assistant memory before answering/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /consider offering one short remember suggestion/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /assistant memory forget/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /phrase `text` as the exact stored sentence you want committed/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /assistant cron add/u)
  assert.match(firstCall?.systemPrompt ?? '', /assistant cron preset install/u)
  assert.match(firstCall?.systemPrompt ?? '', /Prefer digest-style or summary-style automation over nagging coaching/u)
  assert.match(firstCall?.systemPrompt ?? '', /assistant run/u)
  assert.match(firstCall?.systemPrompt ?? '', /broad current-evidence scan/u)
  assert.match(firstCall?.systemPrompt ?? '', /keep waiting on the tool unless it actually errors or times out/u)
  assert.match(firstCall?.systemPrompt ?? '', /`--timeout` is the normal control/u)
  assert.match(firstCall?.systemPrompt ?? '', /`--wait-timeout` is only for the uncommon case/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Cron prompts may explicitly tell you to use the research tool/u,
  )
  assert.match(firstCall?.systemPrompt ?? '', /healthybob/u)
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
      /Assistant state MCP tools are exposed in this session/u,
    )
  } else {
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Assistant state MCP tools are not exposed in this session, but direct Healthy Bob CLI execution is available/u,
    )
  }
  if (memoryMcpExposed) {
    assert.match(firstCall?.systemPrompt ?? '', /Assistant memory MCP tools are exposed in this session/u)
  } else {
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Assistant memory MCP tools are not exposed in this session, but direct Healthy Bob CLI execution is available/u,
    )
  }
  if (cronMcpExposed) {
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Scheduled assistant automation MCP tools are exposed in this session/u,
    )
  } else {
    assert.match(
      firstCall?.systemPrompt ?? '',
      /Scheduled assistant automation MCP tools are not exposed in this session, but direct Healthy Bob CLI execution is available/u,
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-workspace-reuse-'))
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

test('sendAssistantMessage serializes concurrent provider turns per vault', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-turn-lock-'))
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

test('sendAssistantMessage adds no-citations formatting guidance for outbound channel replies only', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-channel-formatting-'))
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


test('sendAssistantMessage writes a system receipt for provider and delivery milestones', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-receipts-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-openai-compatible-'))
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
    assert.match(firstCall?.systemPrompt ?? '', /You are Healthy Bob/u)
    assert.match(secondCall?.systemPrompt ?? '', /You are Healthy Bob/u)
    assert.match(
      firstCall?.systemPrompt ?? '',
      /does not expose Healthy Bob assistant-memory tools or direct shell access/u,
    )
    assert.match(
      firstCall?.systemPrompt ?? '',
      /does not expose Healthy Bob cron tools or direct shell access/u,
    )
    assert.match(
      firstCall?.systemPrompt ?? '',
      /does not expose direct CLI execution/u,
    )
    assert.match(
      firstCall?.systemPrompt ?? '',
      /give them the exact `vault-cli \.\.\.` command to run or switch to a Codex-backed Healthy Bob chat session/u,
    )
    assert.doesNotMatch(
      firstCall?.systemPrompt ?? '',
      /Assistant memory MCP tools are exposed in this session/u,
    )
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
    assert.equal(first.session.providerSessionId, null)
    assert.equal(second.session.providerSessionId, null)
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-codex-prompt-version-'))
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
  await saveAssistantSession(vaultRoot, {
    ...resolved.session,
    provider: 'codex-cli',
    providerSessionId: 'thread-stale-codex',
    codexPromptVersion: '2026-03-20.1',
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
    /Recent local conversation transcript from this same Healthy Bob session/u,
  )
  assert.match(call?.continuityContext ?? '', /User: Old question about dinner\./u)
  assert.match(call?.continuityContext ?? '', /Assistant: Old answer about dinner\./u)
  assert.match(
    call?.continuityContext ?? '',
    /bootstrapping the fresh Codex provider session/u,
  )
  assert.equal(result.session.providerSessionId, 'thread-fresh-codex')
  assert.equal(result.session.codexPromptVersion, CURRENT_CODEX_PROMPT_VERSION)
  assert.equal(result.session.turnCount, 3)
})

test('sendAssistantMessage onboarding persists answered slots and asks only for missing items in later new sessions', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-onboarding-partial-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-onboarding-complete-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-onboarding-optional-once-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-provider-switch-'))
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
  assert.equal(resolved.session.providerSessionId, null)
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-memory-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-no-auto-memory-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-upsert-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-sensitive-memory-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-group-health-memory-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-progress-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-session-restore-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:restore',
  })
  const hydrated = await saveAssistantSession(vaultRoot, {
    ...created.session,
    providerSessionId: 'thread-live-1',
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
  assert.equal(result.session.providerSessionId, 'thread-live-1')
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

test('sendAssistantMessage preserves a recovered provider session id after a resumable provider failure', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-recoverable-error-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn.mockRejectedValue(
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

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:recoverable-error',
      prompt: 'hello',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CODEX_CONNECTION_LOST')
      assert.equal(
        error.context?.assistantSession?.providerSessionId,
        'thread-resume-1',
      )
      return true
    },
  )

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:recoverable-error',
  })

  assert.equal(resolved.session.providerSessionId, 'thread-resume-1')
  assert.equal(resolved.session.turnCount, 0)
})

test('sendAssistantMessage does not persist a recovered provider session id for non-retryable provider failures', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-nonretryable-error-'))
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

  assert.equal(resolved.session.providerSessionId, null)
  assert.equal(resolved.session.turnCount, 0)
})

test('sendAssistantMessage rolls back unauthorized direct canonical vault edits and fails the turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-canonical-guard-'))
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

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-guard',
      prompt: 'Inspect the vault.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.deepEqual(error.context?.paths, ['vault.json'])
      return true
    },
  )

  assert.equal(await readFile(metadataPath, 'utf8'), beforeMetadata)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-guard',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerSessionId, null)
})

test('sendAssistantMessage allows committed audited canonical writes from core mutation paths', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-canonical-allow-'))
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
  assert.equal(result.session.providerSessionId, 'thread-legit-write')
})

test('sendAssistantMessage allows concurrent inbox canonical writes that go through audited core write operations', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-canonical-inbox-'))
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
  assert.equal(result.session.providerSessionId, 'thread-inbox-guard')
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-canonical-staged-before-snapshot-'))
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
        schemaVersion: 'hb.write-operation.v1',
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
          schemaVersion: 'hb.write-operation.v1',
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
              committedPayloadBase64: Buffer.from(committedContent).toString('base64'),
            },
          ],
        },
        null,
        2,
      )}\n`,
    )

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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-canonical-tamper-'))
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

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-tamper',
      prompt: 'Inspect the vault.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.deepEqual(error.context?.paths, ['CORE.md', 'vault.json'])
      return true
    },
  )

  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  assert.equal(metadata.title, 'Legit Guarded Title')
})

test('sendAssistantMessage blocks on malformed write-operation metadata and still rolls back later direct tampering', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'healthybob-assistant-service-canonical-bad-operation-metadata-'),
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

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-bad-operation-metadata',
      prompt: 'Update the vault title.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.equal(error.context?.guardFailureReason, 'invalid_write_operation_metadata')
      assert.equal(error.context?.guardFailureCode, 'OPERATION_INVALID')
      assert.match(error.context?.guardFailurePath ?? '', /^\.runtime\/operations\/op_/u)
      assert.deepEqual(error.context?.paths, [targetRelativePath])
      return true
    },
  )

  assert.equal(await readFile(targetPath, 'utf8'), committedContent)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-bad-operation-metadata',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerSessionId, null)
})

test('sendAssistantMessage blocks when committedPayloadBase64 is missing instead of being treated like no payload', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'healthybob-assistant-service-canonical-missing-committed-payload-'),
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
        delete action.committedPayloadBase64
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

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-missing-committed-payload',
      prompt: 'Update the vault title.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.equal(error.context?.guardFailureReason, 'invalid_committed_payload')
      assert.equal(error.context?.guardFailureActionKind, 'text_write')
      assert.equal(error.context?.guardFailureTargetPath, targetRelativePath)
      assert.match(error.context?.guardFailurePath ?? '', /^\.runtime\/operations\/op_/u)
      assert.deepEqual(error.context?.paths, [targetRelativePath])
      return true
    },
  )

  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-missing-committed-payload',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerSessionId, null)
})

test('sendAssistantMessage blocks on non-canonical committedPayloadBase64 and still rolls back later direct tampering', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'healthybob-assistant-service-canonical-noncanonical-payload-'),
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
    const operationPath = path.join(vaultRoot, operationRelativePath)
    const operation = JSON.parse(await readFile(operationPath, 'utf8')) as {
      actions?: Array<Record<string, unknown>>
    }
    assert.ok(Array.isArray(operation.actions))
    operation.actions?.forEach((action) => {
      if (
        action.kind === 'text_write' &&
        action.targetRelativePath === targetRelativePath &&
        typeof action.committedPayloadBase64 === 'string'
      ) {
        action.committedPayloadBase64 = action.committedPayloadBase64.endsWith('=')
          ? action.committedPayloadBase64.replace(/=+$/u, '')
          : `${action.committedPayloadBase64}\n`
      }
    })
    await writeFile(operationPath, `${JSON.stringify(operation, null, 2)}\n`)
    await writeFile(targetPath, 'tampered-after-noncanonical-payload\n')

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-noncanonical-committed-payload',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-noncanonical-committed-payload',
      prompt: 'Update the vault title.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.equal(error.context?.guardFailureReason, 'invalid_committed_payload')
      assert.equal(error.context?.guardFailureActionKind, 'text_write')
      assert.equal(error.context?.guardFailureTargetPath, targetRelativePath)
      assert.match(error.context?.guardFailurePath ?? '', /^\.runtime\/operations\/op_/u)
      assert.deepEqual(error.context?.paths, [targetRelativePath])
      return true
    },
  )

  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-noncanonical-committed-payload',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerSessionId, null)
})

test('sendAssistantMessage blocks when committedPayloadBase64 decodes to impossible non-UTF-8 write bytes', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'healthybob-assistant-service-canonical-binary-payload-'),
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
    const operationPath = path.join(vaultRoot, operationRelativePath)
    const operation = JSON.parse(await readFile(operationPath, 'utf8')) as {
      actions?: Array<Record<string, unknown>>
    }
    assert.ok(Array.isArray(operation.actions))
    operation.actions?.forEach((action) => {
      if (action.kind === 'text_write' && action.targetRelativePath === targetRelativePath) {
        action.committedPayloadBase64 = '/w=='
      }
    })
    await writeFile(operationPath, `${JSON.stringify(operation, null, 2)}\n`)

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-binary-committed-payload',
      response: 'assistant reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-binary-committed-payload',
      prompt: 'Update the vault title.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.equal(error.context?.guardFailureReason, 'invalid_committed_payload')
      assert.equal(error.context?.guardFailureActionKind, 'text_write')
      assert.equal(error.context?.guardFailureTargetPath, targetRelativePath)
      assert.match(error.context?.guardFailurePath ?? '', /^\.runtime\/operations\/op_/u)
      assert.deepEqual(error.context?.paths, [targetRelativePath])
      return true
    },
  )

  await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u)

  const session = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:canonical-binary-committed-payload',
  })
  assert.equal(session.session.turnCount, 0)
  assert.equal(session.session.providerSessionId, null)
})

test('sendAssistantMessage prefers the canonical write guard error when the provider both writes directly and throws', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-canonical-provider-error-'))
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

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-provider-error',
      prompt: 'Inspect the vault.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.equal(error.context?.providerErrorCode, 'ASSISTANT_CODEX_FAILED')
      return true
    },
  )

  assert.equal(await readFile(metadataPath, 'utf8'), beforeMetadata)
})

test('sendAssistantMessage reconstructs audited ledger appends and rolls back later shard tampering', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-canonical-append-'))
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

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-append',
      prompt: 'Append to the event ledger.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.deepEqual(error.context?.paths, [ledgerRelativePath])
      return true
    },
  )

  assert.equal(
    await readFile(ledgerPath, 'utf8'),
    '{"id":"evt_test_guard","kind":"guard-test"}\n',
  )
})

test('sendAssistantMessage preserves large audited protected text writes after later tampering', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'healthybob-assistant-service-canonical-large-text-'),
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

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-large-text',
      prompt: 'Write a large protected bank note.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.deepEqual(error.context?.paths, [targetRelativePath])
      return true
    },
  )

  assert.equal(await readFile(targetPath, 'utf8'), largeContent)
})

test('sendAssistantMessage preserves large audited protected jsonl appends after later tampering', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'healthybob-assistant-service-canonical-large-append-'),
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

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'chat:canonical-large-append',
      prompt: 'Append a large protected ledger record.',
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      assert.deepEqual(error.context?.paths, [ledgerRelativePath])
      return true
    },
  )

  assert.equal(await readFile(ledgerPath, 'utf8'), expectedAppend)
})

test('sendAssistantMessage preserves audited protected deletes', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-canonical-delete-'))
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
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-canonical-no-failover-'))
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

  await assert.rejects(
    sendAssistantMessage({
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
    }),
    (error: any) => {
      assert.equal(error.code, 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED')
      return true
    },
  )

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
