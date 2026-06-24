import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from '@murphai/hosted-execution/cli-runtime-bridge'

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
  buildCodexTurnExecutionPlan: vi.fn(),
  buildCodexTurnAttemptPlan: vi.fn(),
  recordAssistantRuntimeIssueInputsBestEffort: vi.fn(),
  recordCodexAttemptFailed: vi.fn(),
  recordCodexAttemptStarted: vi.fn(),
  recordCodexAttemptSucceeded: vi.fn(),
  recordCodexPlan: vi.fn(),
}))

vi.mock('../src/assistant/codex-runtime.js', () => ({
  executeCodexAssistantTurnAttemptFromInput: (input: {
    providerConfig: unknown
    turn: Record<string, unknown>
  }) => providerMocks.executeCodexAssistantTurnAttemptFromInput({
    ...input.turn,
    providerConfig: input.providerConfig,
  }),
  resolveCodexAssistantTargetCapabilities:
    providerMocks.resolveCodexAssistantTargetCapabilities,
  resolveCodexAssistantCapabilities:
    providerMocks.resolveCodexAssistantCapabilities,
  resolveCodexAssistantLabel: providerMocks.resolveCodexAssistantLabel,
  resolveCodexStaticModels: providerMocks.resolveCodexStaticModels,
}))

vi.mock('../src/assistant/codex-turn/planning.js', () => ({
  buildCodexTurnExecutionPlan:
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan,
  buildCodexTurnAttemptPlan:
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan,
}))

vi.mock('../src/assistant/codex-turn/attempt-observability.js', () => ({
  recordCodexAttemptFailed: providerTurnRunnerMocks.recordCodexAttemptFailed,
  recordCodexAttemptStarted: providerTurnRunnerMocks.recordCodexAttemptStarted,
  recordCodexAttemptSucceeded:
    providerTurnRunnerMocks.recordCodexAttemptSucceeded,
  recordCodexPlan: providerTurnRunnerMocks.recordCodexPlan,
}))

vi.mock('../src/assistant/issue-reporting.js', () => ({
  recordAssistantRuntimeIssueInputsBestEffort:
    providerTurnRunnerMocks.recordAssistantRuntimeIssueInputsBestEffort,
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
import type { AssistantCodexContinuation } from '../src/assistant/active-turn-input-journal.ts'
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
import { executeCodexTurnWithRecovery } from '../src/assistant/codex-turn-runner.ts'
import type {
  AssistantCodexAttemptPlan,
  AssistantCodexTurnExecutionPlan,
  AssistantRouteTurnPlan,
} from '../src/assistant/codex-turn/planning.ts'
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
  providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockReset()
  providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockReset()
  providerTurnRunnerMocks.recordAssistantRuntimeIssueInputsBestEffort.mockReset()
  providerTurnRunnerMocks.recordCodexAttemptFailed.mockReset()
  providerTurnRunnerMocks.recordCodexAttemptStarted.mockReset()
  providerTurnRunnerMocks.recordCodexAttemptSucceeded.mockReset()
  providerTurnRunnerMocks.recordCodexPlan.mockReset()
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

function createRoutePlanningDiagnostics(): AssistantRouteTurnPlan['planningDiagnostics'] {
  return {
    assistantContextSnapshotElapsedMs: null,
    cliBootstrapElapsedMs: null,
    dynamicToolCount: 0,
    messageReactionsAvailable: false,
    primarySystemPromptElapsedMs: null,
    reactionDynamicToolAvailable: false,
    routePlanningElapsedMs: 0,
    routePlanningMeasuredElapsedMs: 0,
    routePlanningSlowestStage: null,
    routePlanningSlowestStageElapsedMs: null,
    routePlanningUnaccountedElapsedMs: 0,
    routeResumeBindingElapsedMs: null,
    routeTargetCapabilitiesElapsedMs: null,
    shouldPrepareBootstrapContext: false,
    supportedExperimentProtocolsElapsedMs: null,
  }
}

async function createHostedCodexFlexCatalog(input: {
  model: string
}): Promise<{
  cleanup(): Promise<void>
  env: NodeJS.ProcessEnv
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'murph-codex-flex-catalog-'))
  const catalogPath = path.join(directory, 'codex-model-catalog.openai-flex.json')
  await writeFile(
    catalogPath,
    `${JSON.stringify({
      models: [
        {
          slug: input.model,
          service_tiers: [
            {
              id: 'flex',
              name: 'Flex',
            },
          ],
        },
      ],
    })}\n`,
    'utf8',
  )

  return {
    cleanup: async () => {
      await rm(directory, { force: true, recursive: true })
    },
    env: {
      [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: catalogPath,
    },
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
    codexResume: null,
    codexTarget: target,
    conversationId: input?.sessionId ?? 'session-test',
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions,
    resumeState: null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: input?.sessionId ?? 'session-test',
    target,
    turnCount: 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}

function createSharedPlan(): AssistantTurnSharedPlan {
  return {
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
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
    codexThreadId: 'provider-session-1',
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
      runtimeIssueInputs: [],
    },
    ok: true,
    result,
  }
}

describe('Codex model catalog', () => {
  it('uses Codex default as the first chat-model option', () => {
    expect(DEFAULT_CODEX_CHAT_MODEL_OPTIONS).toEqual([
      {
        value: '',
        description: 'Use the model configured by Codex.',
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
        value: '',
        description: 'Use the model configured by Codex.',
      },
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

  it('keeps Codex default selected when no model is explicitly configured', () => {
    providerMocks.resolveCodexAssistantLabel.mockReturnValue('Codex CLI')
    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.resolveCodexStaticModels.mockReturnValue([
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
    ])

    const catalog = resolveCodexModelCatalog({
      currentModel: null,
      provider: 'codex-cli',
    })

    expect(catalog.selectedModel).toBeNull()
    expect(catalog.modelOptions[0]).toEqual({
      value: '',
      description: 'Use the model configured by Codex.',
    })
    expect(catalog.modelOptions[1]).toEqual({
      value: 'gpt-5.4',
      description: 'Frontier model',
    })
    expect(catalog.reasoningOptions).toEqual(DEFAULT_CODEX_REASONING_OPTIONS)
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

  it('drops unsupported rich user parts and keeps flex for supported hosted OpenAI routes', async () => {
    const flexCatalog = await createHostedCodexFlexCatalog({ model: 'gpt-5.5' })
    const route = createRoute({
      providerOptions: {
        model: 'gpt-5.5',
        modelProvider: 'hosted-openai',
      },
    })
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const upstreamAbort = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const input = {
      abortSignal: upstreamAbort.signal,
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
      serviceTier: 'flex',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: {
        hosted: {
          memberId: 'member-flex-openai',
          userEnvKeys: [],
        },
      },
      input,
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        threadScope: 'session-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-04-29',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-1',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: flexCatalog.env,
        developerInstructions: null,
        dynamicTools: [],
        diagnosticsPolicy: {
          environment: 'local',
          privateIssueCaptureEnabled: false,
          surface: null,
        },
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: null,
        turnContextPrompt: null,
        workingDirectory: '/work',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    try {
      await executeCodexTurnWithRecovery({
        input,
        plan: createSharedPlan(),
        providerRequestOrdinal: 1,
        resolvedSession: session,
        route,
        turnCreatedAt: '2026-04-29T00:00:00.000Z',
        turnId: 'turn-1',
      })
    } finally {
      await flexCatalog.cleanup()
    }

    expect(
      providerMocks.executeCodexAssistantTurnAttemptFromInput,
    ).toHaveBeenCalledTimes(1)
    const providerInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
    expect(providerInput?.serviceTier).toBe('flex')
    expect(timeoutSpy).toHaveBeenCalledWith(600_000)
    expect(providerInput?.abortSignal).not.toBe(upstreamAbort.signal)
    expect(providerInput?.abortSignal?.aborted).toBe(false)
    upstreamAbort.abort()
    expect(providerInput?.abortSignal?.aborted).toBe(true)
    expect(
      providerInput?.userMessageContent,
    ).toEqual([
      {
        image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        mediaType: 'image/png',
        type: 'image',
      },
    ])
    expect(providerTurnRunnerMocks.recordCodexPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        codexContinuation: 'explicit-structured-history',
        providerRequestOrdinal: 1,
        resumeCodexThreadIdPresent: false,
        route,
        sessionId: session.sessionId,
        turnId: 'turn-1',
        vault: '/vaults/test',
      }),
    )
  })

  it('forwards voice memo delivery availability for deliverable Linq and Telegram replies', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })

    const scenarios = [
      {
        audience: {
          bindingDelivery: { kind: 'thread', target: 'linq-thread' },
          channel: 'linq',
          explicitTarget: null,
        },
        deliverResponse: true,
        expectedChannel: 'linq',
        name: 'deliverable Linq thread',
      },
      {
        audience: {
          bindingDelivery: { kind: 'thread', target: 'linq-thread' },
          channel: 'linq',
          explicitTarget: 'linq-thread',
        },
        deliverResponse: true,
        expectedChannel: 'linq',
        name: 'deliverable Linq current-thread explicit target',
      },
      {
        audience: {
          bindingDelivery: null,
          channel: 'linq',
          explicitTarget: 'linq-thread-explicit',
        },
        deliverResponse: true,
        expectedChannel: null,
        name: 'Linq explicit target without thread binding',
      },
      {
        audience: {
          bindingDelivery: { kind: 'thread', target: 'linq-thread' },
          channel: 'linq',
          explicitTarget: 'linq-thread-explicit',
        },
        deliverResponse: true,
        expectedChannel: null,
        name: 'Linq thread binding with explicit target override',
      },
      {
        audience: {
          bindingDelivery: { kind: 'participant', target: 'linq-participant' },
          channel: 'linq',
          explicitTarget: null,
        },
        deliverResponse: true,
        expectedChannel: null,
        name: 'Linq participant binding',
      },
      {
        audience: {
          bindingDelivery: { kind: 'thread', target: 'telegram-thread' },
          channel: 'telegram',
          explicitTarget: null,
        },
        deliverResponse: true,
        expectedChannel: 'telegram',
        name: 'deliverable Telegram thread',
      },
      {
        audience: {
          bindingDelivery: null,
          channel: 'telegram',
          explicitTarget: 'telegram-thread-explicit',
        },
        deliverResponse: true,
        expectedChannel: 'telegram',
        name: 'deliverable Telegram explicit target',
      },
      {
        audience: {
          bindingDelivery: null,
          channel: 'telegram',
          explicitTarget: null,
        },
        deliverResponse: true,
        expectedChannel: null,
        name: 'Telegram without target',
      },
      {
        audience: {
          bindingDelivery: { kind: 'thread', target: 'linq-thread' },
          channel: 'linq',
          explicitTarget: null,
        },
        deliverResponse: false,
        expectedChannel: null,
        name: 'delivery disabled',
      },
    ] as const

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })

    for (const scenario of scenarios) {
      const input = {
        deliverResponse: scenario.deliverResponse,
        prompt: `Run ${scenario.name}.`,
        vault: '/vaults/test',
      } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
      const sharedPlan = createSharedPlan()
      sharedPlan.conversationPolicy.audience.bindingDelivery =
        scenario.audience.bindingDelivery
      sharedPlan.conversationPolicy.audience.channel = scenario.audience.channel
      sharedPlan.conversationPolicy.audience.explicitTarget =
        scenario.audience.explicitTarget

      providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValueOnce(
        createProviderAttemptResult(),
      )
      providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValueOnce({
        activeTurnSteering: null,
        executionContext: {
          hosted: null,
        },
        input,
        profile: {
          promptProfile: 'conversation',
          toolProfile: 'provider-turn',
          threadScope: 'session-thread',
        },
        promptTimeContext: {
          currentLocalDate: '2026-04-29',
          currentTimeZone: 'UTC',
        },
        route,
        sharedPlan,
        turnId: `turn-${scenario.name.replaceAll(' ', '-')}`,
      } satisfies AssistantCodexTurnExecutionPlan)
      providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValueOnce({
        attemptCount: 1,
        route,
        routePlan: {
          assistantContractFingerprint:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          assistantCliContract: null,
          cliEnv: {},
          developerInstructions: null,
          dynamicTools: [],
          diagnosticsPolicy: {
            environment: 'local',
            privateIssueCaptureEnabled: false,
            surface: null,
          },
          onboardingGuidanceInjected: false,
          codexContinuation: {
            kind: 'explicit-structured-history',
          } satisfies AssistantCodexContinuation,
          planningDiagnostics: createRoutePlanningDiagnostics(),
          promptCacheMetadata: null,
          resume: null,
          sessionContext: undefined,
          systemPrompt: null,
          turnContextPrompt: null,
          workingDirectory: '/work',
        } satisfies AssistantRouteTurnPlan,
        session,
      } satisfies AssistantCodexAttemptPlan)

      const outcome = await executeCodexTurnWithRecovery({
        input,
        plan: sharedPlan,
        resolvedSession: session,
        route,
        turnCreatedAt: '2026-04-29T00:00:00.000Z',
        turnId: `turn-${scenario.name.replaceAll(' ', '-')}`,
      })

      expect(outcome.kind).toBe('succeeded')
      const providerInput =
        providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls.at(-1)?.[0]
      expect(providerInput?.voiceMemoDeliveryChannel).toBe(scenario.expectedChannel)
    }
  })

  it('forwards message reaction availability from auto-reply targets to Codex', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const scenarios = [
      {
        channel: 'linq',
        deliveryMessageReactionsAvailable: true,
        deliveryReplyToMessageId: 'linq-message-1',
        expected: true,
        name: 'iMessage Linq reply target',
        target: 'linq-chat-1',
      },
      {
        channel: 'linq',
        deliveryMessageReactionsAvailable: false,
        deliveryReplyToMessageId: 'linq-message-1',
        expected: false,
        name: 'non-iMessage Linq reply target',
        target: 'linq-chat-1',
      },
      {
        channel: 'linq',
        deliveryMessageReactionsAvailable: true,
        deliveryReplyToMessageId: null,
        expected: false,
        name: 'Linq target without message id',
        target: 'linq-chat-1',
      },
      {
        channel: 'telegram',
        deliveryReplyToMessageId: 'telegram-message-1',
        expected: true,
        name: 'ordinary Telegram reply target',
        target: 'telegram-thread-1',
      },
      {
        channel: 'telegram',
        deliveryReplyToMessageId: null,
        expected: false,
        name: 'Telegram target without message id',
        target: 'telegram-thread-1',
      },
      {
        channel: 'telegram',
        deliveryReplyToMessageId: 'telegram-business-message-1',
        expected: false,
        name: 'Telegram Business reply target',
        target: 'telegram-thread-1:business:biz-42',
      },
    ] as const

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })

    for (const scenario of scenarios) {
      const input = {
        channel: scenario.channel,
        deliverResponse: true,
        ...(scenario.channel === 'linq'
          ? {
              deliveryMessageReactionsAvailable:
                scenario.deliveryMessageReactionsAvailable,
            }
          : {}),
        ...(scenario.deliveryReplyToMessageId === null
          ? {}
          : { deliveryReplyToMessageId: scenario.deliveryReplyToMessageId }),
        prompt: `Run ${scenario.name}.`,
        turnTrigger: 'automation-auto-reply',
        vault: '/vaults/test',
      } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
      const sharedPlan = createSharedPlan()
      sharedPlan.conversationPolicy.audience.channel = scenario.channel
      sharedPlan.conversationPolicy.audience.explicitTarget = scenario.target
      sharedPlan.conversationPolicy.audience.threadId = scenario.target

      providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValueOnce(
        createProviderAttemptResult(),
      )
      providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValueOnce({
        activeTurnSteering: null,
        executionContext: {
          hosted: null,
        },
        input,
        profile: {
          promptProfile: 'conversation',
          toolProfile: 'provider-turn',
          threadScope: 'session-thread',
        },
        promptTimeContext: {
          currentLocalDate: '2026-04-29',
          currentTimeZone: 'UTC',
        },
        route,
        sharedPlan,
        turnId: `turn-reaction-${scenario.name.replaceAll(' ', '-')}`,
      } satisfies AssistantCodexTurnExecutionPlan)
      providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValueOnce({
        attemptCount: 1,
        route,
        routePlan: {
          assistantContractFingerprint:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          assistantCliContract: null,
          cliEnv: {},
          developerInstructions: null,
          dynamicTools: [],
          diagnosticsPolicy: {
            environment: 'local',
            privateIssueCaptureEnabled: false,
            surface: null,
          },
          onboardingGuidanceInjected: false,
          codexContinuation: {
            kind: 'explicit-structured-history',
          } satisfies AssistantCodexContinuation,
          planningDiagnostics: {
            ...createRoutePlanningDiagnostics(),
            dynamicToolCount: scenario.expected ? 6 : 5,
            messageReactionsAvailable: scenario.expected,
            reactionDynamicToolAvailable: scenario.expected,
          },
          promptCacheMetadata: null,
          resume: null,
          sessionContext: undefined,
          systemPrompt: null,
          turnContextPrompt: null,
          workingDirectory: '/work',
        } satisfies AssistantRouteTurnPlan,
        session,
      } satisfies AssistantCodexAttemptPlan)

      const outcome = await executeCodexTurnWithRecovery({
        input,
        plan: sharedPlan,
        resolvedSession: session,
        route,
        turnCreatedAt: '2026-04-29T00:00:00.000Z',
        turnId: `turn-reaction-${scenario.name.replaceAll(' ', '-')}`,
      })

      expect(outcome.kind).toBe('succeeded')
      const providerInput =
        providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls.at(-1)?.[0]
      expect(providerInput?.allowMessageReactions).toBe(scenario.expected)
    }
  })

  it('does not wait for runtime issue recording on a successful turn', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const input = {
      prompt: 'Run the turn.',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
    const runtimeIssueInput = {
      component: 'assistant.codex-action',
      details: {
        actionKind: 'command.execution',
        durationMsBucket: 'lt_1s',
        exitCode: 1,
        outputBytesBucket: '0',
      },
      errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
      issueKind: 'tool_error' as const,
      operation: 'command.execution',
      phase: 'provider_turn' as const,
      severity: 'warning' as const,
      summary: 'Codex command execution failed during provider turn.',
    }
    const providerAttempt = createProviderAttemptResult()
    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue({
      ...providerAttempt,
      metadata: {
        ...providerAttempt.metadata,
        runtimeIssueInputs: [runtimeIssueInput],
      },
    })
    providerTurnRunnerMocks.recordAssistantRuntimeIssueInputsBestEffort.mockReturnValue(
      new Promise(() => undefined),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: {
        hosted: {
          memberId: 'member-runtime-issue',
          userEnvKeys: [],
        },
      },
      input,
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        threadScope: 'session-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-04-29',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-runtime-issue',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        developerInstructions: null,
        dynamicTools: [],
        diagnosticsPolicy: {
          environment: 'local',
          privateIssueCaptureEnabled: true,
          surface: null,
        },
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: null,
        turnContextPrompt: null,
        workingDirectory: '/work',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    const outcome = await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-04-29T00:00:00.000Z',
      turnId: 'turn-runtime-issue',
    })

    expect(outcome.kind).toBe('succeeded')
    expect(
      providerTurnRunnerMocks.recordAssistantRuntimeIssueInputsBestEffort,
    ).toHaveBeenCalledWith({
      issues: [runtimeIssueInput],
      policy: {
        environment: 'local',
        privateIssueCaptureEnabled: true,
        surface: null,
      },
      vault: '/vaults/test',
    })
  })

  it('records a terminal provider runtime issue when a Codex attempt fails', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const input = {
      prompt: 'Run the turn.',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
    const providerError = Object.assign(new Error('Codex failed.'), {
      code: 'ASSISTANT_CODEX_FAILED',
    })
    const failedProviderAttempt: AssistantProviderTurnAttemptResult = {
      codexThreadId: 'thread-terminal-provider-failure',
      error: providerError,
      metadata: {
        activityLabels: ['Run Command'],
        executedToolCount: 0,
        providerActionCount: 3,
        rawToolEvents: [],
        runtimeIssueInputs: [],
      },
      ok: false,
      providerRequestOutcome: 'failed',
      providerTurnId: 'turn-terminal-provider-failure',
      rawEvents: [
        { event: 'item.started' },
        { event: 'item.completed' },
      ],
      usage: null,
    }

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      failedProviderAttempt,
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: {
        hosted: {
          memberId: 'member-terminal-provider-failure',
          userEnvKeys: [],
        },
      },
      input,
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        threadScope: 'session-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-04-29',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-terminal-provider-failure',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        developerInstructions: null,
        dynamicTools: [],
        diagnosticsPolicy: {
          environment: 'hosted',
          privateIssueCaptureEnabled: true,
          surface: 'linq',
        },
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: null,
        turnContextPrompt: null,
        workingDirectory: '/work',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    const outcome = await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      providerRequestOrdinal: 1,
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-04-29T00:00:00.000Z',
      turnId: 'turn-terminal-provider-failure',
    })

    expect(outcome).toMatchObject({
      kind: 'failed_terminal',
      codexThreadId: 'thread-terminal-provider-failure',
      providerRequestOutcome: 'failed',
      providerTurnId: 'turn-terminal-provider-failure',
    })
    expect(
      providerTurnRunnerMocks.recordAssistantRuntimeIssueInputsBestEffort,
    ).toHaveBeenNthCalledWith(1, {
      issues: [],
      policy: {
        environment: 'hosted',
        privateIssueCaptureEnabled: true,
        surface: 'linq',
      },
      vault: '/vaults/test',
    })
    expect(
      providerTurnRunnerMocks.recordAssistantRuntimeIssueInputsBestEffort,
    ).toHaveBeenNthCalledWith(2, {
      issues: [
        {
          component: 'assistant.codex-provider',
          details: {
            providerActionCount: 3,
            providerRequestOutcome: 'failed',
            rawEventCountBucket: '2_5',
          },
          errorCode: 'ASSISTANT_CODEX_FAILED',
          issueKind: 'tool_error',
          operation: 'codex-cli',
          phase: 'provider_turn',
          severity: 'error',
          summary: 'Codex provider turn failed.',
        },
      ],
      policy: {
        environment: 'hosted',
        privateIssueCaptureEnabled: true,
        surface: 'linq',
      },
      vault: '/vaults/test',
    })
  })

  it('drops flex service tier for hosted OpenAI routes without catalog evidence', async () => {
    const route = createRoute({
      providerOptions: {
        model: 'gpt-5.5',
        modelProvider: 'hosted-openai',
      },
    })
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const upstreamAbort = new AbortController()
    const input = {
      abortSignal: upstreamAbort.signal,
      prompt: 'Run scheduled check-in.',
      serviceTier: 'flex',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: {
        hosted: {
          memberId: 'member-flex-openai-no-catalog',
          userEnvKeys: [],
        },
      },
      input,
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        threadScope: 'session-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-04-29',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-1',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        developerInstructions: null,
        dynamicTools: [],
        diagnosticsPolicy: {
          environment: 'local',
          privateIssueCaptureEnabled: false,
          surface: null,
        },
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: null,
        turnContextPrompt: null,
        workingDirectory: '/work',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      providerRequestOrdinal: 1,
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-04-29T00:00:00.000Z',
      turnId: 'turn-1',
    })

    const providerInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
    expect(providerInput?.serviceTier).toBeNull()
    expect(providerInput?.abortSignal).toBe(upstreamAbort.signal)
  })

  it('drops flex service tier for hosted routes on unsupported model providers', async () => {
    const route = createRoute({
      providerOptions: {
        model: 'gpt-5.5',
        modelProvider: 'vercel-ai-gateway',
      },
    })
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const upstreamAbort = new AbortController()
    const input = {
      abortSignal: upstreamAbort.signal,
      prompt: 'Run scheduled check-in.',
      serviceTier: 'flex',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text', 'image'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: {
        hosted: {
          memberId: 'member-flex-gateway',
          userEnvKeys: [],
        },
      },
      input,
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        threadScope: 'session-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-04-29',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-1',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        developerInstructions: null,
        dynamicTools: [],
        diagnosticsPolicy: {
          environment: 'local',
          privateIssueCaptureEnabled: false,
          surface: null,
        },
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: null,
        turnContextPrompt: null,
        workingDirectory: '/work',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      providerRequestOrdinal: 1,
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-04-29T00:00:00.000Z',
      turnId: 'turn-1',
    })

    const providerInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
    expect(providerInput?.serviceTier).toBeNull()
    expect(providerInput?.abortSignal).toBe(upstreamAbort.signal)
  })

  it('passes hosted device-connect requests through the Codex provider', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      sessionId: 'session-hosted-device-connect',
    })
    const issueDeviceConnectLink = vi.fn(
      async () => ({
        authorizationUrl: 'https://connect.example.test/whoop',
        connectUrl: 'https://connect.example.test/whoop',
        expiresAt: '2026-04-30T00:05:00.000Z',
        provider: 'whoop' as const,
        providerLabel: 'WHOOP',
      }),
    )
    const input = {
      channel: 'linq',
      executionContext: {
        hosted: {
          deviceConnectProviders: [
            { label: 'WHOOP', provider: 'whoop' },
          ],
          issueDeviceConnectLink,
          memberId: 'member_synthetic',
          userEnvKeys: [],
        },
      },
      prompt: 'Please connect my WHOOP',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']

    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: input.executionContext,
      input,
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        threadScope: 'session-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-04-30',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-hosted-device-connect',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        developerInstructions: null,
        dynamicTools: [],
        diagnosticsPolicy: {
          environment: 'hosted',
          privateIssueCaptureEnabled: false,
          surface: 'linq',
        },
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: null,
        turnContextPrompt: null,
        workingDirectory: '/work',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    const outcome = await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-04-30T00:00:00.000Z',
      turnId: 'turn-hosted-device-connect',
    })

    expect(outcome.kind).toBe('succeeded')
    if (outcome.kind !== 'succeeded') {
      throw new Error('Expected Codex provider handling to succeed.')
    }
    expect(outcome.providerTurn.response).toBe('provider response')
    expect(outcome.providerTurn.nonReplayableProviderWork).toBe(false)
    expect(issueDeviceConnectLink).not.toHaveBeenCalled()
    expect(providerMocks.executeCodexAssistantTurnAttemptFromInput).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: 'Please connect my WHOOP',
      }),
    )
    expect(
      providerTurnRunnerMocks.recordCodexAttemptSucceeded,
    ).toHaveBeenCalledWith(expect.objectContaining({
      activityLabels: [],
    }))
  })
})
