import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
  buildResolveAssistantSessionInput,
  sendAssistantMessage,
} from '../src/assistant/service.js'
import {
  addAssistantLifecycleMiddleware,
  addAssistantLifecycleObserver,
  createAssistantLifecycleHooks,
  isAssistantLifecycleMiddlewareFailure,
} from '../src/assistant/hooks.js'
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

test('sendAssistantMessage composes lifecycle middleware and emits ordered turn/provider observer events', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-hooks-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const diagnostics: string[] = []
  const middlewareOrder: string[] = []
  const observerTypes: string[] = []
  const hooks = createAssistantLifecycleHooks({
    onObserverDiagnostic(diagnostic) {
      diagnostics.push(`${diagnostic.eventType}:${diagnostic.message}`)
    },
  })

  addAssistantLifecycleMiddleware(hooks, 'beforeContextBuild', async (state) => {
    middlewareOrder.push('beforeContextBuild:1')
    return {
      ...state,
      prompt: `${state.prompt} [ctx-1]`,
    }
  })
  addAssistantLifecycleMiddleware(hooks, 'beforeContextBuild', (state) => {
    middlewareOrder.push('beforeContextBuild:2')
    return {
      ...state,
      prompt: `${state.prompt} [ctx-2]`,
    }
  })
  addAssistantLifecycleMiddleware(hooks, 'afterContextBuild', (state) => {
    middlewareOrder.push('afterContextBuild:1')
    return {
      ...state,
      systemPrompt: `${state.systemPrompt ?? ''}\nHook alpha`.trim(),
    }
  })
  addAssistantLifecycleMiddleware(hooks, 'afterContextBuild', (state) => {
    middlewareOrder.push('afterContextBuild:2')
    return {
      ...state,
      systemPrompt: `${state.systemPrompt ?? ''}\nHook beta`.trim(),
    }
  })
  addAssistantLifecycleMiddleware(hooks, 'beforeModelSend', (state) => {
    middlewareOrder.push('beforeModelSend:1')
    return {
      ...state,
      configOverrides: [...(state.configOverrides ?? []), 'hook.first=true'],
      userPrompt: `${state.userPrompt} [send-1]`,
    }
  })
  addAssistantLifecycleMiddleware(hooks, 'beforeModelSend', (state) => {
    middlewareOrder.push('beforeModelSend:2')
    return {
      ...state,
      configOverrides: [...(state.configOverrides ?? []), 'hook.second=true'],
      userPrompt: `${state.userPrompt} [send-2]`,
    }
  })
  addAssistantLifecycleMiddleware(hooks, 'afterModelReceive', (state) => {
    middlewareOrder.push('afterModelReceive:1')
    return {
      ...state,
      providerResult: {
        ...state.providerResult,
        response: `${state.providerResult.response} [recv-1]`,
      },
    }
  })
  addAssistantLifecycleMiddleware(hooks, 'afterModelReceive', (state) => {
    middlewareOrder.push('afterModelReceive:2')
    return {
      ...state,
      providerResult: {
        ...state.providerResult,
        response: `${state.providerResult.response} [recv-2]`,
      },
    }
  })

  addAssistantLifecycleObserver(hooks, (event) => {
    observerTypes.push(event.type)
  }, 'collector')
  addAssistantLifecycleObserver(hooks, (event) => {
    if (event.type === 'provider.event') {
      throw new Error('observer boom')
    }
  }, 'broken')

  serviceMocks.executeAssistantProviderTurn.mockImplementation(async (providerInput: any) => {
    providerInput.onEvent?.({
      kind: 'status',
      state: 'running',
      text: 'starting provider',
    })

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-hooked',
      response: 'raw reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:hooked',
    prompt: 'Need a hook-aware reply.',
    hooks,
  })

  const providerCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const transcript = await listAssistantTranscriptEntries(vaultRoot, result.session.sessionId)

  assert.equal(result.prompt, 'Need a hook-aware reply. [ctx-1] [ctx-2]')
  assert.equal(result.response, 'raw reply [recv-1] [recv-2]')
  assert.equal(
    providerCall?.userPrompt,
    'Need a hook-aware reply. [ctx-1] [ctx-2] [send-1] [send-2]',
  )
  assert.equal(
    providerCall?.configOverrides?.includes('hook.first=true'),
    true,
  )
  assert.equal(
    providerCall?.configOverrides?.includes('hook.second=true'),
    true,
  )
  assert.match(providerCall?.systemPrompt ?? '', /Hook alpha/u)
  assert.match(providerCall?.systemPrompt ?? '', /Hook beta/u)
  assert.deepEqual(
    transcript.map((entry) => ({
      kind: entry.kind,
      text: entry.text,
    })),
    [
      {
        kind: 'user',
        text: 'Need a hook-aware reply. [ctx-1] [ctx-2]',
      },
      {
        kind: 'assistant',
        text: 'raw reply [recv-1] [recv-2]',
      },
    ],
  )
  assert.deepEqual(middlewareOrder, [
    'beforeContextBuild:1',
    'beforeContextBuild:2',
    'afterContextBuild:1',
    'afterContextBuild:2',
    'beforeModelSend:1',
    'beforeModelSend:2',
    'afterModelReceive:1',
    'afterModelReceive:2',
  ])
  assert.deepEqual(observerTypes, [
    'turn.started',
    'context.built',
    'provider.started',
    'provider.event',
    'provider.completed',
    'turn.completed',
  ])
  assert.deepEqual(diagnostics, ['provider.event:observer boom'])
})

test('sendAssistantMessage treats lifecycle middleware failures as fatal', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-hook-failure-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const hooks = createAssistantLifecycleHooks()
  addAssistantLifecycleMiddleware(hooks, 'beforeContextBuild', () => {
    throw new Error('hook blocked')
  }, 'blocking-hook')

  await assert.rejects(
    () =>
      sendAssistantMessage({
        vault: vaultRoot,
        prompt: 'This should fail.',
        hooks,
      }),
    (error: any) => {
      assert.equal(isAssistantLifecycleMiddlewareFailure(error), true)
      assert.equal(error.message, 'hook blocked')
      return true
    },
  )

  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 0)
})

test('sendAssistantMessage gives the first provider turn direct CLI guidance, PATH access, bound memory context, and MCP-backed memory tools', async () => {
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

  assert.equal(firstCall?.workingDirectory, vaultRoot)
  assert.match(firstCall?.systemPrompt ?? '', /Start with the smallest relevant context/u)
  assert.match(
    firstCall?.systemPrompt ?? '',
    /treat that as a vault operation rather than a coding task/u,
  )
  assert.match(
    firstCall?.systemPrompt ?? '',
    /Do not run repo tests, typechecks, coverage, coordination-ledger updates, or auto-commit workflows/u,
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
  assert.match(firstCall?.systemPrompt ?? '', /native Codex MCP tools/u)
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
  assert.equal(
    firstCall?.configOverrides?.some((value: string) => value.includes('.args=[')),
    true,
  )
  assert.equal(
    firstCall?.configOverrides?.some((value: string) =>
      value.includes('"assistant","memory","--mcp"'),
    ),
    true,
  )
  assert.equal(
    firstCall?.configOverrides?.some((value: string) =>
      value.includes('"assistant","cron","--mcp"'),
    ),
    true,
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

test('sendAssistantMessage replays transcript continuations plus the hot tail for compacted OpenAI-compatible sessions', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-compacted-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot, {
    recursive: true,
  })
  cleanupPaths.push(parent)

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'fresh reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:compacted',
    provider: 'openai-compatible',
    model: 'gpt-oss:20b',
    baseUrl: 'http://127.0.0.1:11434/v1',
  })

  await appendAssistantTranscriptEntries(
    vaultRoot,
    resolved.session.sessionId,
    Array.from({
      length: 45,
    }).flatMap((_, index) => [
      {
        kind: 'user' as const,
        text: `question ${index + 1}`,
      },
      {
        kind: 'assistant' as const,
        text: `answer ${index + 1}`,
      },
    ]),
  )

  await sendAssistantMessage({
    vault: vaultRoot,
    sessionId: resolved.session.sessionId,
    provider: 'openai-compatible',
    model: 'gpt-oss:20b',
    baseUrl: 'http://127.0.0.1:11434/v1',
    prompt: 'new question',
  })

  const providerCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(providerCall?.conversationMessages?.length, 21)
  assert.match(
    providerCall?.conversationMessages?.[0]?.content ?? '',
    /non-canonical working memory only/u,
  )
  assert.deepEqual(providerCall?.conversationMessages?.[1], {
    role: 'user',
    content: 'question 36',
  })
  assert.deepEqual(
    providerCall?.conversationMessages?.slice(-2),
    [
      {
        role: 'user',
        content: 'question 45',
      },
      {
        role: 'assistant',
        content: 'answer 45',
      },
    ],
  )
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

test('sendAssistantMessage ignores malformed continuation sidecars and still completes the turn', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-bad-continuation-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:continuation-bad',
    provider: 'openai-compatible',
    model: 'gpt-4.1-mini',
    baseUrl: 'https://gateway.example.test/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  })
  const paths = resolveAssistantStatePaths(vaultRoot)
  await writeFile(
    path.join(paths.transcriptContinuationsDirectory, `${created.session.sessionId}.json`),
    '{"schema":"broken"',
    'utf8',
  )

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'Recovered without the bad sidecar.',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const decisions: Array<{ action: string; reason: string }> = []
  const result = await sendAssistantMessage({
    vault: vaultRoot,
    sessionId: created.session.sessionId,
    provider: 'openai-compatible',
    model: 'gpt-4.1-mini',
    baseUrl: 'https://gateway.example.test/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    prompt: 'Keep going.',
    onFallbackDecision(decision) {
      decisions.push({
        action: decision.action,
        reason: decision.reason,
      })
    },
  })

  assert.equal(result.response, 'Recovered without the bad sidecar.')
  assert.deepEqual(decisions, [
    {
      action: 'skip',
      reason: 'malformed-continuation',
    },
  ])
  const providerCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.doesNotMatch(providerCall?.systemPrompt ?? '', /Transcript continuation summary:/u)
})

test('sendAssistantMessage retries once with reduced context after an oversized-context provider failure', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-oversized-context-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  const created = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'chat:oversized-context',
    provider: 'openai-compatible',
    model: 'gpt-4.1-mini',
    baseUrl: 'https://gateway.example.test/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  })
  const paths = resolveAssistantStatePaths(vaultRoot)
  await writeFile(
    path.join(paths.transcriptsDirectory, `${created.session.sessionId}.jsonl`),
    [
      JSON.stringify({
        schema: 'healthybob.assistant-transcript-entry.v1',
        kind: 'user',
        text: 'Earlier question',
        createdAt: '2026-03-20T10:00:00.000Z',
      }),
      JSON.stringify({
        schema: 'healthybob.assistant-transcript-entry.v1',
        kind: 'assistant',
        text: 'Earlier answer',
        createdAt: '2026-03-20T10:00:01.000Z',
      }),
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    path.join(paths.transcriptContinuationsDirectory, `${created.session.sessionId}.json`),
    `${JSON.stringify(
      {
        schema: 'healthybob.assistant-transcript-continuation.v1',
        sessionId: created.session.sessionId,
        updatedAt: '2026-03-20T10:01:00.000Z',
        sourceEntryCount: 20,
        sourceStartAt: '2026-03-20T08:00:00.000Z',
        sourceEndAt: '2026-03-20T10:00:01.000Z',
        notice: 'Assistant transcript continuations are non-canonical working memory only.',
        summaryBullets: ['Earlier summary bullet'],
        openLoops: ['Follow up on breakfast timing'],
        representativeExcerpts: [
          {
            createdAt: '2026-03-20T09:59:00.000Z',
            kind: 'assistant',
            text: 'Representative earlier note.',
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  serviceMocks.executeAssistantProviderTurn
    .mockRejectedValueOnce(
      new VaultCliError(
        'ASSISTANT_CONTEXT_TOO_LARGE',
        'Maximum context length exceeded for this provider request.',
      ),
    )
    .mockResolvedValueOnce({
      provider: 'openai-compatible',
      providerSessionId: null,
      response: 'Recovered after reducing the context.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  const decisions: Array<{ action: string; reason: string }> = []
  const result = await sendAssistantMessage({
    vault: vaultRoot,
    sessionId: created.session.sessionId,
    provider: 'openai-compatible',
    model: 'gpt-4.1-mini',
    baseUrl: 'https://gateway.example.test/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    prompt: 'Summarize where we left off.',
    onFallbackDecision(decision) {
      decisions.push({
        action: decision.action,
        reason: decision.reason,
      })
    },
  })

  assert.equal(result.response, 'Recovered after reducing the context.')
  assert.equal(serviceMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.deepEqual(decisions, [
    {
      action: 'retry-context',
      reason: 'oversized-context',
    },
  ])

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.equal(firstCall?.conversationMessages?.length, 2)
  assert.match(firstCall?.systemPrompt ?? '', /Transcript continuation summary:/u)
  assert.equal(secondCall?.conversationMessages, undefined)
  assert.doesNotMatch(secondCall?.systemPrompt ?? '', /Transcript continuation summary:/u)
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
