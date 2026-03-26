import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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

test('sendAssistantMessage gives the first provider turn direct CLI guidance, PATH access, bound memory context, and capability-aware assistant tool guidance', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-123',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    await sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'Inspect the vault with the CLI.',
    })
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const expectedUserBinDirectory = path.join(homeRoot, '.local', 'bin')
  const turnContext = resolveAssistantMemoryTurnContext(firstCall?.env)
  const memoryMcpExposed =
    firstCall?.configOverrides?.some((value: string) =>
      value.includes('"assistant","memory","--mcp"'),
    ) ?? false
  const cronMcpExposed =
    firstCall?.configOverrides?.some((value: string) =>
      value.includes('"assistant","cron","--mcp"'),
    ) ?? false

  assert.equal(firstCall?.workingDirectory, vaultRoot)
  assert.match(firstCall?.systemPrompt ?? '', /bound to one active vault/u)
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
    memoryMcpExposed || cronMcpExposed,
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
