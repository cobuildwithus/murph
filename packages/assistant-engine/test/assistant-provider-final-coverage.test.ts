import { afterEach, describe, expect, it, vi } from 'vitest'

const providerMocks = vi.hoisted(() => ({
  executeCodexAssistantTurnAttemptFromInput: vi.fn(),
  resolveCodexAssistantCapabilities: vi.fn(),
  resolveCodexAssistantTargetCapabilities: vi.fn(),
  resolveCodexAssistantLabel: vi.fn((profile) =>
    (profile.target?.kind ?? profile.provider) === 'codex-cli'
      ? 'Codex CLI'
      : 'Unsupported provider',
  ),
  resolveCodexStaticModels: vi.fn((profile) =>
    (profile.target?.kind ?? profile.provider) === 'codex-cli'
      ? [
          {
            id: 'gpt-5.4',
            label: 'GPT-5.4',
            description: 'Frontier model',
            source: 'static',
            capabilities: {
              images: true,
              pdf: false,
              reasoning: true,
              streaming: true,
              tools: true,
            },
          },
        ]
      : [],
  ),
}))

const providerTurnRunnerMocks = vi.hoisted(() => ({
  buildAssistantProviderTurnExecutionPlan: vi.fn(),
  buildCodexProviderAttemptPlan: vi.fn(),
  recordAssistantToolFailureRuntimeIssues: vi.fn(),
  recordProviderAttemptFailed: vi.fn(),
  recordProviderAttemptStarted: vi.fn(),
  recordProviderAttemptSucceeded: vi.fn(),
}))

vi.mock('../src/assistant/provider-registry.js', () => ({
  executeCodexAssistantTurnAttemptFromInput:
    providerMocks.executeCodexAssistantTurnAttemptFromInput,
  resolveCodexAssistantTargetCapabilities:
    providerMocks.resolveCodexAssistantTargetCapabilities,
  resolveCodexAssistantCapabilities:
    providerMocks.resolveCodexAssistantCapabilities,
  resolveCodexAssistantLabel: providerMocks.resolveCodexAssistantLabel,
  resolveCodexStaticModels: providerMocks.resolveCodexStaticModels,
}))

vi.mock('../src/assistant/provider-turn/planning.js', () => ({
  buildAssistantProviderTurnExecutionPlan:
    providerTurnRunnerMocks.buildAssistantProviderTurnExecutionPlan,
  buildCodexProviderAttemptPlan:
    providerTurnRunnerMocks.buildCodexProviderAttemptPlan,
}))

vi.mock('../src/assistant/provider-turn/attempt-observability.js', () => ({
  recordProviderAttemptFailed: providerTurnRunnerMocks.recordProviderAttemptFailed,
  recordProviderAttemptStarted: providerTurnRunnerMocks.recordProviderAttemptStarted,
  recordProviderAttemptSucceeded:
    providerTurnRunnerMocks.recordProviderAttemptSucceeded,
}))

vi.mock('../src/assistant/issue-reporting.js', () => ({
  recordAssistantToolFailureRuntimeIssues:
    providerTurnRunnerMocks.recordAssistantToolFailureRuntimeIssues,
}))

import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type {
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import type { AssistantProviderContinuation } from '../src/assistant/active-turn-input-journal.ts'
import {
  DEFAULT_CODEX_CHAT_MODEL_OPTIONS,
  DEFAULT_CODEX_REASONING_OPTIONS,
  findCodexCatalogModelOptionIndex,
  findCodexCatalogReasoningOptionIndex,
  resolveCodexAssistantProfile,
  resolveCodexCatalogReasoningOptions,
  resolveCodexModelCapabilities,
  resolveCodexModelCatalog,
  resolveCodexTargetCapabilities,
} from '../src/assistant/provider-catalog.ts'
import { executeProviderTurnWithRecovery } from '../src/assistant/provider-turn-runner.ts'
import type {
  AssistantProviderAttemptPlan,
  AssistantProviderTurnExecutionPlan,
  AssistantRouteTurnPlan,
} from '../src/assistant/provider-turn/planning.ts'
import type {
  AssistantProviderTurnAttemptResult,
  AssistantProviderTurnExecutionResult,
} from '../src/assistant/providers/types.ts'
import type { AssistantTurnSharedPlan } from '../src/assistant/service-contracts.ts'

afterEach(() => {
  providerMocks.executeCodexAssistantTurnAttemptFromInput.mockReset()
  providerMocks.resolveCodexAssistantCapabilities.mockReset()
  providerMocks.resolveCodexAssistantTargetCapabilities.mockReset()
  providerMocks.resolveCodexAssistantLabel.mockReset()
  providerMocks.resolveCodexStaticModels.mockReset()
  providerTurnRunnerMocks.buildAssistantProviderTurnExecutionPlan.mockReset()
  providerTurnRunnerMocks.buildCodexProviderAttemptPlan.mockReset()
  providerTurnRunnerMocks.recordAssistantToolFailureRuntimeIssues.mockReset()
  providerTurnRunnerMocks.recordProviderAttemptFailed.mockReset()
  providerTurnRunnerMocks.recordProviderAttemptStarted.mockReset()
  providerTurnRunnerMocks.recordProviderAttemptSucceeded.mockReset()
  vi.restoreAllMocks()
})

function createProviderOptions(
  overrides?: Partial<AssistantProviderSessionOptions>,
): AssistantProviderSessionOptions {
  return {
    ...serializeAssistantProviderSessionOptions(
      normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
    ),
    ...overrides,
  }
}

function createRoute(input?: {
  providerOptions?: Partial<AssistantProviderSessionOptions>
  routeId?: string
}): {
  codexCommand: string | null
  label: string
  provider: 'codex-cli'
  providerOptions: AssistantProviderSessionOptions
  routeId: string
} {
  return {
    codexCommand: null,
    label: 'Primary',
    provider: 'codex-cli',
    providerOptions: createProviderOptions(input?.providerOptions),
    routeId: input?.routeId ?? 'route-primary',
  }
}

function createAssistantSession(input?: {
  providerOptions?: AssistantProviderSessionOptions
  sessionId?: string
}): AssistantSession {
  const providerOptions = input?.providerOptions ?? createProviderOptions()
  const target =
    createAssistantModelTarget({
      approvalPolicy: providerOptions.approvalPolicy,
      codexHome: providerOptions.codexHome ?? null,
      model: providerOptions.model,
      modelProvider: providerOptions.modelProvider ?? null,
      oss: providerOptions.oss,
      profile: providerOptions.profile,
      reasoningEffort: providerOptions.reasoningEffort ?? null,
      sandbox: providerOptions.sandbox,
      provider: 'codex-cli',
    }) ?? undefined

  if (!target) {
    throw new Error('Expected assistant session target.')
  }

  return {
    alias: null,
    binding: {
      actorId: null,
      channel: null,
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    },
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions,
    resumeState: null,
    schema: 'murph.assistant-session.v1',
    sessionId: input?.sessionId ?? 'session-test',
    target,
    turnCount: 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}

function createSharedPlan(): AssistantTurnSharedPlan {
  return {
    allowSensitiveHealthContext: false,
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
      allowSensitiveHealthContext: false,
      audience: {
        actorId: null,
        bindingDelivery: null,
        channel: null,
        deliveryPolicy: 'not-requested',
        effectiveThreadIsDirect: null,
        explicitTarget: null,
        identityId: null,
        replyToMessageId: null,
        threadId: null,
        threadIsDirect: null,
      },
      operatorAuthority: 'direct-operator',
    },
    firstContactStateDocIds: [],
    onboardingGuidanceOpen: false,
    operatorAuthority: 'direct-operator',
    persistUserPromptOnFailure: false,
    requestedWorkingDirectory: '/work',
  }
}

function createProviderAttemptResult(): AssistantProviderTurnAttemptResult {
  const result: AssistantProviderTurnExecutionResult = {
    provider: 'codex-cli',
    providerSessionId: 'provider-session-1',
    rawEvents: [],
    response: 'provider response',
    stderr: '',
    stdout: '',
    usage: null,
  }

  return {
    metadata: {
      activityLabels: [],
      executedToolCount: 0,
      providerActionCount: 0,
      rawToolEvents: [],
    },
    ok: true,
    result,
  }
}

describe('Codex model catalog', () => {
  it('maps static codex models into default chat-model options', () => {
    expect(DEFAULT_CODEX_CHAT_MODEL_OPTIONS).toEqual([
      {
        value: 'gpt-5.4',
        description: 'Frontier model',
      },
    ])
  })

  it('forwards provider capability resolution through the registry helpers', () => {
    providerMocks.resolveCodexAssistantCapabilities.mockReturnValueOnce({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValueOnce({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: false,
    })

    expect(resolveCodexModelCapabilities()).toEqual({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    expect(
      resolveCodexTargetCapabilities({
        provider: 'codex-cli',
      }),
    ).toEqual({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: false,
    })
  })

  it('normalizes provider profiles and builds model catalogs with current and static models', () => {
    providerMocks.resolveCodexAssistantLabel.mockImplementation((profile) =>
      (profile.target?.kind ?? profile.provider) === 'codex-cli'
        ? 'Codex CLI'
        : 'Unsupported provider',
    )
    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.resolveCodexStaticModels.mockImplementation((profile) =>
      (profile.target?.kind ?? profile.provider) === 'codex-cli'
        ? [
            {
              id: 'gpt-5.4',
              label: 'GPT-5.4',
              description: 'Frontier model',
              source: 'static',
              capabilities: {
                images: true,
                pdf: false,
                reasoning: true,
                streaming: true,
                tools: true,
              },
            },
          ]
        : [],
    )

    const profile = resolveCodexAssistantProfile({
      provider: 'codex-cli',
    })
    expect(profile).toMatchObject({
      target: {
        kind: 'codex-cli',
      },
      providerLabel: 'Codex CLI',
    })

    const catalog = resolveCodexModelCatalog({
      currentModel: ' custom-current ',
      currentReasoningEffort: 'high',
      provider: 'codex-cli',
    })

    expect(catalog.providerLabel).toBe('Codex CLI')
    expect(catalog.models.map((model) => model.id)).toEqual([
      'custom-current',
      'gpt-5.4',
    ])
    expect(catalog.selectedModel?.id).toBe('custom-current')
    expect(catalog.reasoningOptions).toEqual(DEFAULT_CODEX_REASONING_OPTIONS)
    expect(catalog.modelOptions).toEqual([
      {
        value: 'custom-current',
        description: 'Current Codex model.',
      },
      {
        value: 'gpt-5.4',
        description: 'Frontier model',
      },
    ])
  })

  it('finds stable fallback indexes for model and reasoning selections', () => {
    expect(
      findCodexCatalogModelOptionIndex('missing', [
        { value: 'gpt-5.4', description: 'Frontier' },
        { value: 'gpt-5.4-mini', description: 'Mini' },
      ]),
    ).toBe(0)
    expect(
      findCodexCatalogModelOptionIndex(' gpt-5.4-mini ', [
        { value: 'gpt-5.4', description: 'Frontier' },
        { value: 'gpt-5.4-mini', description: 'Mini' },
      ]),
    ).toBe(1)

    expect(findCodexCatalogReasoningOptionIndex(null, [])).toBe(0)
    expect(
      findCodexCatalogReasoningOptionIndex('missing', DEFAULT_CODEX_REASONING_OPTIONS),
    ).toBe(1)
    expect(
      findCodexCatalogReasoningOptionIndex('high', DEFAULT_CODEX_REASONING_OPTIONS),
    ).toBe(2)
  })

  it('handles empty Codex catalogs and uses the Codex current-model description branch', () => {
    providerMocks.resolveCodexAssistantLabel.mockReturnValue('Codex CLI')
    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.resolveCodexStaticModels.mockReturnValue([])

    const catalog = resolveCodexModelCatalog({
      currentModel: 'custom-codex',
      provider: 'codex-cli',
    })

    expect(catalog.models).toEqual([
      expect.objectContaining({
        id: 'custom-codex',
        description: 'Current Codex model.',
      }),
    ])
    expect(catalog.selectedModel?.id).toBe('custom-codex')
    expect(resolveCodexCatalogReasoningOptions(null)).toEqual([])
    expect(findCodexCatalogModelOptionIndex(null, [])).toBe(0)
  })

  it('drops unsupported rich user parts before invoking the Codex provider', async () => {
    const route = createRoute()
    const session = createAssistantSession()
    const input = {
      prompt: 'Summarize the attached brief.',
      userMessageContent: [
        {
          image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
          mediaType: 'image/png',
          type: 'image',
        },
        {
          data: 'JVBERi0xLjQK',
          filename: 'brief.pdf',
          mediaType: 'application/pdf',
          type: 'file',
        },
      ],
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeProviderTurnWithRecovery>[0]['input']

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildAssistantProviderTurnExecutionPlan.mockResolvedValue({
      activeTurnHistory: null,
      activeTurnSteering: null,
      executionContext: {
        hosted: null,
      },
      input,
      memoryTurnEnv: {},
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        turnContinuityPolicy: 'continuous-provider-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-04-29',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-1',
    } satisfies AssistantProviderTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexProviderAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        activeTurnMessages: undefined,
        assistantCliContract: null,
        cliEnv: {},
        continuityContext: null,
        diagnosticsPolicy: {
          environment: 'local',
          privateIssueCaptureEnabled: false,
          surface: null,
        },
        onboardingCompletionFallbackReason: null,
        onboardingGuidanceInjected: false,
        providerContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantProviderContinuation,
        promptCacheMetadata: null,
        resumeProviderSessionId: null,
        sessionContext: undefined,
        systemPrompt: null,
        workingDirectory: '/work',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantProviderAttemptPlan)

    await executeProviderTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-04-29T00:00:00.000Z',
      turnId: 'turn-1',
    })

    expect(
      providerMocks.executeCodexAssistantTurnAttemptFromInput,
    ).toHaveBeenCalledTimes(1)
    expect(
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
        ?.userMessageContent,
    ).toEqual([
      {
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        mediaType: 'image/png',
        type: 'image',
      },
    ])
  })
})
