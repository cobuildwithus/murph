import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createAssistantModelTarget,
  createDefaultLocalAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'

const sessionResolutionMocks = vi.hoisted(() => ({
  resolveAssistantSession: vi.fn(),
}))

vi.mock('../src/assistant/store.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
    '../src/assistant/store.ts',
  )

  return {
    ...actual,
    resolveAssistantSession: sessionResolutionMocks.resolveAssistantSession,
  }
})

import {
  buildResolveAssistantSessionInput,
  resolveAssistantSessionForMessage,
  resolveAssistantSessionTarget,
} from '../src/assistant/session-resolution.ts'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from '../src/assistant/service-contracts.ts'

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

function createOperatorDefaults(
  overrides: Partial<AssistantOperatorDefaults> = {},
): AssistantOperatorDefaults {
  return {
    backend: null,
    identityId: null,
    selfDeliveryTargets: null,
    ...overrides,
  }
}

function expectAssistantTarget(
  target: AssistantModelTarget | null,
): AssistantModelTarget {
  if (!target) {
    throw new Error('Expected assistant model target.')
  }

  return target
}

function createOpenAiTarget(
  overrides: Partial<{
    apiKeyEnv: string
    baseUrl: string
    model: string
    providerName: string
    reasoningEffort: string
    headers: Record<string, string>
  }> = {},
): AssistantModelTarget {
  return expectAssistantTarget(createAssistantModelTarget({
    provider: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://gateway.example.com/v1',
    model: 'gpt-5-mini',
    providerName: 'Example Gateway',
    reasoningEffort: 'high',
    headers: {
      'x-trace-id': 'trace-123',
    },
    ...overrides,
  }))
}

function createCodexTarget(
  overrides: Partial<{
    approvalPolicy: 'never' | 'on-request' | 'untrusted'
    codexHome: string
    model: string
    oss: boolean
    profile: string
    reasoningEffort: 'high' | 'low' | 'medium'
    sandbox: 'danger-full-access' | 'read-only' | 'workspace-write'
  }> = {},
): AssistantModelTarget {
  return expectAssistantTarget(createAssistantModelTarget({
    provider: 'codex-cli',
    model: 'gpt-5-codex',
    ...overrides,
  }))
}

function createResolutionInput(
  overrides: Partial<AssistantSessionResolutionFields> = {},
): AssistantSessionResolutionFields {
  return {
    vault: '/tmp/assistant-session-resolution-vault',
    ...overrides,
  }
}

function createMessageInput(
  overrides: Partial<AssistantMessageInput> = {},
): AssistantMessageInput {
  return {
    prompt: 'Summarize the session state.',
    vault: '/tmp/assistant-session-resolution-vault',
    ...overrides,
  }
}

describe('assistant session resolution', () => {
  it('prefers conversation identifiers over message fields and shapes openai-compatible config', () => {
    const defaults = createOperatorDefaults({
      identityId: 'default-identity',
    })

    const result = buildResolveAssistantSessionInput(
      createResolutionInput({
        actorId: 'message-actor',
        alias: 'message-alias',
        allowBindingRebind: true,
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://gateway.example.com/v1',
        channel: 'sms',
        conversation: {
          alias: 'conversation-alias',
          channel: 'telegram',
          directness: 'group',
          identityId: 'conversation-identity',
          participantId: 'conversation-participant',
          sessionId: 'conversation-session',
          threadId: 'conversation-thread',
        },
        headers: {
          'x-trace-id': 'trace-123',
        },
        identityId: 'message-identity',
        maxSessionAgeMs: 90_000,
        model: 'gpt-5-mini',
        provider: 'openai-compatible',
        providerName: 'Example Gateway',
        reasoningEffort: 'high',
        sessionId: 'message-session',
        sourceThreadId: 'message-source-thread',
        threadId: 'message-thread',
        threadIsDirect: true,
      }),
      defaults,
    )

    expect(result).toEqual({
      vault: '/tmp/assistant-session-resolution-vault',
      sessionId: 'conversation-session',
      alias: 'conversation-alias',
      allowBindingRebind: true,
      channel: 'telegram',
      identityId: 'conversation-identity',
      actorId: 'conversation-participant',
      threadId: 'conversation-thread',
      threadIsDirect: true,
      target: createOpenAiTarget(),
      provider: 'openai-compatible',
      model: 'gpt-5-mini',
      sandbox: null,
      approvalPolicy: null,
      oss: false,
      presetId: null,
      profile: null,
      baseUrl: 'https://gateway.example.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      providerName: 'Example Gateway',
      webSearch: null,
      zeroDataRetention: null,
      headers: {
        'X-Trace-Id': 'trace-123',
      },
      reasoningEffort: 'high',
      maxSessionAgeMs: 90_000,
    })
  })

  it('derives actor, thread, directness, and codex defaults when conversation fields are absent', () => {
    const result = buildResolveAssistantSessionInput(
      createResolutionInput({
        actorId: 'message-actor',
        allowBindingRebind: false,
        conversation: {
          directness: 'group',
        },
        model: 'gpt-5-codex',
        provider: 'codex-cli',
        sourceThreadId: 'source-thread',
      }),
      createOperatorDefaults({
        identityId: 'default-identity',
      }),
    )

    expect(result).toMatchObject({
      vault: '/tmp/assistant-session-resolution-vault',
      identityId: 'default-identity',
      actorId: 'message-actor',
      threadId: 'source-thread',
      threadIsDirect: false,
      provider: 'codex-cli',
      model: 'gpt-5-codex',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      profile: null,
      headers: null,
      baseUrl: null,
      apiKeyEnv: null,
      providerName: null,
      reasoningEffort: 'medium',
      maxSessionAgeMs: null,
    })
    expect(result).not.toHaveProperty('allowBindingRebind')
    expect(result.target).toMatchObject({
      adapter: 'codex-cli',
      approvalPolicy: null,
      model: 'gpt-5-codex',
      reasoningEffort: 'medium',
      sandbox: null,
    })
  })

  it('resolves targets from boundary defaults, operator defaults, and explicit overrides in order', () => {
    const boundaryDefaultTarget = createDefaultLocalAssistantModelTarget()
    const defaultsBackend = createOpenAiTarget({
      apiKeyEnv: 'DEFAULT_OPENAI_KEY',
      baseUrl: 'https://defaults.example.com/v1',
      headers: {
        'x-default-trace': 'defaults',
      },
      model: 'gpt-5-default',
      providerName: 'Defaults Gateway',
      reasoningEffort: 'low',
    })

    expect(
      resolveAssistantSessionTarget({
        boundaryDefaultTarget,
        defaults: null,
        input: createResolutionInput(),
      }),
    ).toMatchObject({
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      model: null,
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    })

    expect(
      resolveAssistantSessionTarget({
        boundaryDefaultTarget,
        defaults: createOperatorDefaults({
          backend: defaultsBackend,
        }),
        input: createResolutionInput(),
      }),
    ).toMatchObject({
      adapter: 'openai-compatible',
      apiKeyEnv: 'DEFAULT_OPENAI_KEY',
      endpoint: 'https://defaults.example.com/v1',
      headers: {
        'X-Default-Trace': 'defaults',
      },
      model: 'gpt-5-default',
      providerName: 'Defaults Gateway',
      reasoningEffort: 'low',
    })

    expect(
      resolveAssistantSessionTarget({
        boundaryDefaultTarget,
        defaults: createOperatorDefaults({
          backend: defaultsBackend,
        }),
        input: createResolutionInput({
          model: 'gpt-5-codex-override',
          provider: 'codex-cli',
          sandbox: 'workspace-write',
        }),
      }),
    ).toEqual(createCodexTarget({
      model: 'gpt-5-codex-override',
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
    }))
  })

  it('forwards the built message-resolution input into store resolution and returns its result', async () => {
    const defaults = createOperatorDefaults({
      backend: createCodexTarget({
        model: 'gpt-5-codex-default',
      }),
      identityId: 'default-identity',
    })
    const boundaryDefaultTarget = createDefaultLocalAssistantModelTarget()
    const message = createMessageInput({
      actorId: 'message-actor',
      conversation: {
        alias: 'conversation-alias',
        channel: 'telegram',
        directness: 'direct',
        identityId: null,
        participantId: 'conversation-participant',
        sessionId: null,
        threadId: 'conversation-thread',
      },
      maxSessionAgeMs: 45_000,
    })
    const resolvedSession = {
      created: false,
      paths: {
        indexesDirectory: '/tmp/indexes',
        rootDirectory: '/tmp/root',
        sessionsDirectory: '/tmp/sessions',
        statusDirectory: '/tmp/status',
        transcriptsDirectory: '/tmp/transcripts',
      },
      session: {
        alias: 'conversation-alias',
        binding: {
          actorId: 'conversation-participant',
          channel: 'telegram',
          conversationKey: 'channel:telegram|actor:conversation-participant',
          delivery: null,
          identityId: 'default-identity',
          threadId: 'conversation-thread',
          threadIsDirect: true,
        },
        createdAt: '2026-04-08T00:00:00.000Z',
        lastTurnAt: null,
        provider: 'codex-cli',
        providerOptions: {
          approvalPolicy: 'never',
          model: 'gpt-5-codex-default',
          oss: false,
          profile: null,
          reasoningEffort: 'medium',
          sandbox: 'danger-full-access',
        },
        resumeState: null,
        schema: 'murph.assistant-session.v1',
        sessionId: 'session-123',
        target: createDefaultLocalAssistantModelTarget(),
        turnCount: 0,
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
    }
    sessionResolutionMocks.resolveAssistantSession.mockResolvedValue(resolvedSession)

    await expect(
      resolveAssistantSessionForMessage({
        boundaryDefaultTarget,
        defaults,
        message,
      }),
    ).resolves.toBe(resolvedSession)

    expect(sessionResolutionMocks.resolveAssistantSession).toHaveBeenCalledTimes(1)
    expect(sessionResolutionMocks.resolveAssistantSession).toHaveBeenCalledWith(
      buildResolveAssistantSessionInput(message, defaults, boundaryDefaultTarget),
    )
  })
})
