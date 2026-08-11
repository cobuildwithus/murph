import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from '@murphai/hosted-execution/env'
import {
  MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE,
  MURPH_MEMBER_MEMORY_MAINTENANCE_PERMISSION_PROFILE,
  MURPH_MEMBER_READ_PERMISSION_PROFILE,
} from '@murphai/hosted-execution/assistant-permissions'

const EXPECTED_NATIVE_CAPABILITIES_RESTRICTED_THREAD_CONFIG = {
  'features.apps': false,
  'features.browser_use': false,
  'features.enable_mcp_apps': false,
  'features.multi_agent': false,
  'features.multi_agent_v2': false,
  'features.plugins': false,
  'features.shell_tool': false,
  'features.standalone_web_search': false,
  'features.tool_suggest': false,
  'features.web_search_request': false,
  'memories.generate_memories': false,
  'memories.use_memories': false,
  web_search: 'disabled',
} as const
const EXPECTED_NATIVE_CAPABILITIES_RESTRICTED_CODEX_CONFIG_OVERRIDES = [
  'features.shell_tool=true',
  'features.apps=true',
  'memories.use_memories=true',
  'web_search="live"',
  'memories.generate_memories=false',
  'web_search="disabled"',
  'features.web_search_request=false',
  'features.standalone_web_search=false',
  'features.apps=false',
  'features.enable_mcp_apps=false',
  'features.browser_use=false',
  'features.plugins=false',
  'features.multi_agent=false',
  'features.multi_agent_v2=false',
  'features.tool_suggest=false',
  'memories.use_memories=false',
  'features.shell_tool=false',
] as const

const providerMocks = vi.hoisted(() => ({
  executeCodexAssistantTurnAttemptFromInput: vi.fn(),
  resolveCodexAssistantCapabilities: vi.fn(),
  resolveCodexAssistantTargetCapabilities: vi.fn(),
  resolveCodexAssistantLabel: vi.fn(() => 'Codex CLI'),
  resolveCodexStaticModels: vi.fn(() => [
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
  ]),
}))

const providerTurnRunnerMocks = vi.hoisted(() => ({
  buildCodexTurnExecutionPlan: vi.fn(),
  buildCodexTurnAttemptPlan: vi.fn(),
  recordAssistantRuntimeIssueInputsBestEffort: vi.fn(),
  recordCodexAttemptFailed: vi.fn(),
}))

const storeMocks = vi.hoisted(() => ({
  appendAssistantTranscriptEntries: vi.fn(() => Promise.resolve([])),
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
}))

vi.mock('../src/assistant/issue-reporting.js', () => ({
  recordAssistantRuntimeIssueInputsBestEffort:
    providerTurnRunnerMocks.recordAssistantRuntimeIssueInputsBestEffort,
}))

vi.mock('../src/assistant/store.js', async () => ({
  ...(await vi.importActual<typeof import('../src/assistant/store.js')>(
    '../src/assistant/store.js',
  )),
  appendAssistantTranscriptEntries: storeMocks.appendAssistantTranscriptEntries,
}))

import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type {
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
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
import {
  MURPH_GROUP_ROOM_MODEL_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import { MURPH_GENERATE_SONG_TOOL } from '../src/assistant-codex/dynamic-tools/generate-song.ts'
import {
  MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
} from '../src/assistant/managed-automations.ts'
import {
  MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
} from '../src/assistant/onboarding-goal-checkin-automation.ts'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.ts'
import type {
  AssistantActiveTurnLiveProviderSteering,
} from '../src/assistant/turn-input.ts'
import type {
  AssistantProviderTurnAttemptResult,
  AssistantProviderTurnExecutionResult,
} from '../src/assistant/providers/types.ts'
import type {
  AssistantHostedImageCompletionEffectRestriction,
  AssistantTurnSharedPlan,
} from '../src/assistant/service-contracts.ts'

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
  storeMocks.appendAssistantTranscriptEntries
    .mockReset()
    .mockImplementation(() => Promise.resolve([]))
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
    messageTargetingAvailable: false,
    messageTargetDynamicToolsAvailable: false,
    primarySystemPromptElapsedMs: null,
    routePlanningElapsedMs: 0,
    routePlanningMeasuredElapsedMs: 0,
    routePlanningSlowestStage: null,
    routePlanningSlowestStageElapsedMs: null,
    routePlanningUnaccountedElapsedMs: 0,
    routeResumeBindingElapsedMs: null,
    routeTargetCapabilitiesElapsedMs: null,
    shouldPrepareBootstrapContext: false,
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

function createGroupEmailSharedPlan(): AssistantTurnSharedPlan {
  const plan = createSharedPlan()
  return {
    ...plan,
    conversationPolicy: {
      ...plan.conversationPolicy,
      audience: {
        ...plan.conversationPolicy.audience,
        channel: 'email',
        effectiveThreadIsDirect: false,
        threadId: 'group-email-thread',
        threadIsDirect: false,
      },
    },
  }
}

function createProviderAttemptResult(): AssistantProviderTurnAttemptResult {
  const result: AssistantProviderTurnExecutionResult = {
    provider: 'codex-cli',
    codexThreadId: 'provider-session-1',
    rawEvents: [],
    response: 'provider response',
    responseDeliveryContextOrdinal: 0,
    stderr: '',
    stdout: '',
    transcriptResponse: 'provider response',
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

    const profile = resolveCodexAssistantProfile({
      provider: 'codex-cli',
    })
    expect(profile).toMatchObject({
      target: {
        model: null,
        modelProvider: null,
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

  it('propagates a singular response card through the provider turn result', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const input = {
      prompt: 'Render the already computed nutrition card.',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
    const card: AssistantResponseCard = {
      kind: 'daily_nutrition',
      localDate: '2026-07-28',
      mealCount: 3,
      totals: {
        calories: { total: 1_490.25, mealCount: 3 },
        proteinGrams: { total: 94.5, mealCount: 3 },
        carbsGrams: { total: 193.125, mealCount: 3 },
        fatGrams: { total: 34.75, mealCount: 3 },
      },
    }
    const providerAttempt = createProviderAttemptResult()
    if (!providerAttempt.ok) {
      throw new Error('Expected a successful provider fixture.')
    }

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue({
      ...providerAttempt,
      result: {
        ...providerAttempt.result,
        responseCard: card,
        responseMedia: null,
      },
    })
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: { hosted: null },
      input,
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        threadScope: 'session-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-28',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-response-card-propagation',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint: 'a'.repeat(64),
        assistantCliContract: null,
        cliEnv: {},
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        developerInstructions: null,
        diagnosticsPolicy: {
          environment: 'local',
          privateIssueCaptureEnabled: false,
          surface: null,
        },
        dynamicTools: [],
        onboardingGuidanceInjected: false,
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
      turnCreatedAt: '2026-07-28T00:00:00.000Z',
      turnId: 'turn-response-card-propagation',
    })

    expect(outcome.kind).toBe('succeeded')
    if (outcome.kind !== 'succeeded') {
      throw new Error('Expected a successful provider outcome.')
    }
    expect(outcome.providerTurn.responseCard).toEqual(card)
    expect(outcome.providerTurn.responseMedia).toEqual([])
  })

  it('enforces the output-only boundary at provider execution', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const input = {
      codexConfigOverrides: [
        'features.shell_tool=true',
        'features.apps=true',
      ],
      prompt: 'Format an untrusted provider result.',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
    const unsafeDynamicTools = resolveMurphDynamicTools({
      automationAvailable: true,
    })
    const unsafeHostedToolContext: AssistantHostedToolContext = {
      automationTool: { request: vi.fn() },
      computerToolsAvailable: true,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      sendVaultFile: vi.fn(async () => {
        throw new Error('Unsafe hosted context must not be reachable.')
      }),
      vaultFileSendAvailable: true,
    }
    const unsafeProgressDelivery = {
      send: vi.fn(async () => ({
        kind: 'sent' as const,
        source: 'system' as const,
      })),
    }
    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: {
        hosted: {
          materializeWorkspaceArtifacts: vi.fn(),
          memberId: 'member-system-notification',
          providerFetch: fetch,
          publicInternetFetch: fetch,
          userEnvKeys: [],
        },
      },
      hostedToolContext: unsafeHostedToolContext,
      input,
      profile: {
        promptProfile: 'system-notification',
        toolProfile: 'output-only-turn',
        threadScope: 'isolated-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-20',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      progressDelivery: unsafeProgressDelivery,
      turnId: 'turn-system-notification',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        developerInstructions: null,
        diagnosticsPolicy: {
          environment: 'local',
          privateIssueCaptureEnabled: false,
          surface: null,
        },
        dynamicTools: unsafeDynamicTools,
        environments: [{ PRIVATE_ENVIRONMENT: 'must-not-pass' }],
        onboardingGuidanceInjected: false,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: 'Output-only system prompt.',
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
      turnCreatedAt: '2026-07-20T00:00:00.000Z',
      turnId: 'turn-system-notification',
    })

    expect(outcome.kind).toBe('succeeded')
    const providerInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
    expect(providerInput?.providerConfig).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
    })
    expect(providerInput?.codexConfigOverrides).toEqual([
      'features.shell_tool=true',
      'features.apps=true',
    ])
    expect(providerInput?.codexThreadConfig).toEqual(
      EXPECTED_NATIVE_CAPABILITIES_RESTRICTED_THREAD_CONFIG,
    )
    expect(providerInput).toMatchObject({
      dynamicTools: [],
      groupConversation: false,
      environments: [],
      hostedToolContext: null,
      materializeWorkspaceArtifacts: null,
      progressDelivery: null,
      providerFetch: null,
      providerThreadEphemeral: true,
      publicInternetFetch: null,
      requireHostedPrivateImageDelivery: false,
    })
    expect(providerInput).not.toHaveProperty('processLifetime')
    expect(unsafeDynamicTools).not.toEqual([])
    expect(unsafeProgressDelivery.send).not.toHaveBeenCalled()
  })

  it('restricts native completion capabilities without removing exact hosted effects', async () => {
    const route = createRoute({
      providerOptions: {
        sandbox: 'danger-full-access',
      },
    })
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const restriction = {
      authorizedOriginAssistantInputId: `ain_${'1'.repeat(32)}`,
      completionAssistantInputId: `ain_${'2'.repeat(32)}`,
      exactMedia: [{
        alt: 'Generated completion image',
        contentType: 'image/png',
        filename: 'completion.png',
        kind: 'vault_image',
        ref: 'raw/captures/2026/08/completion/completion.png',
        sha256: 'a'.repeat(64),
        sizeBytes: 1,
        source: 'gpt-image-2',
      }],
    } satisfies AssistantHostedImageCompletionEffectRestriction
    let currentCompletionScope: typeof restriction | null = restriction
    const materializeWorkspaceArtifacts = vi.fn()
    const providerFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 })
    )
    const publicInternetFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 })
    )
    const progressDelivery = {
      send: vi.fn(async () => ({
        kind: 'sent' as const,
        source: 'system' as const,
      })),
    }
    const hostedToolContext: AssistantHostedToolContext = {
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null,
      currentHostedImageCompletionEffectScope: () => currentCompletionScope,
      currentHostedMailboxItemIds: () => [],
      sendVaultFile: vi.fn(),
      vaultFileSendAvailable: true,
    }
    const activeTurnSteering = {
      closeInputAdmission: vi.fn(),
      registerLiveProviderTurn: vi.fn(() => vi.fn()),
    } satisfies AssistantActiveTurnLiveProviderSteering
    const input = {
      codexConfigOverrides: [
        'features.shell_tool=true',
        'features.apps=true',
        'memories.use_memories=true',
        'web_search="live"',
      ],
      hostedImageCompletionEffectRestriction: restriction,
      prompt: 'Complete the trusted image turn.',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
    const dynamicTools = resolveMurphDynamicTools({
      allowFinishWithoutReply: true,
      groupAvailable: true,
      physicalNotesAvailable: true,
      vaultFileSendAvailable: true,
    })

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering,
      executionContext: {
        hosted: {
          materializeWorkspaceArtifacts,
          memberId: 'member-completion-native-authority',
          providerFetch,
          publicInternetFetch,
          userEnvKeys: [],
        },
      },
      hostedToolContext,
      input,
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        threadScope: 'session-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-08-10',
        currentTimeZone: 'UTC',
      },
      progressDelivery,
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-completion-native-authority',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint: 'a'.repeat(64),
        assistantCliContract: null,
        cliEnv: {},
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        developerInstructions: null,
        diagnosticsPolicy: {
          environment: 'hosted',
          privateIssueCaptureEnabled: false,
          surface: 'linq',
        },
        dynamicTools,
        environments: [{ PRIVATE_ENVIRONMENT: 'must-not-pass' }],
        onboardingGuidanceInjected: false,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: {
          codexThreadId: 'thread-completion-native-authority',
        },
        sessionContext: undefined,
        systemPrompt: 'Trusted completion system prompt.',
        turnContextPrompt: null,
        workingDirectory: '/work',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    const completionOutcome = await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-08-10T00:00:00.000Z',
      turnId: 'turn-completion-native-authority',
    })

    expect(completionOutcome.kind).toBe('succeeded')
    const completionProviderInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
    expect(completionProviderInput?.providerConfig).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
    })
    expect(completionProviderInput?.codexThreadConfig).toEqual(
      EXPECTED_NATIVE_CAPABILITIES_RESTRICTED_THREAD_CONFIG,
    )
    expect(completionProviderInput?.codexConfigOverrides).toEqual(
      EXPECTED_NATIVE_CAPABILITIES_RESTRICTED_CODEX_CONFIG_OVERRIDES,
    )
    expect(completionProviderInput?.activeTurnSteering).toBeNull()
    expect(completionProviderInput).toMatchObject({
      dynamicTools,
      environments: [],
      hostedToolContext,
      materializeWorkspaceArtifacts,
      progressDelivery,
      providerFetch: null,
      publicInternetFetch: null,
      requireHostedPrivateImageDelivery: true,
      resume: {
        codexThreadId: 'thread-completion-native-authority',
      },
      vaultRoot: '/vaults/test',
      workingDirectory: '/work',
    })

    currentCompletionScope = null
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockClear()
    const foregroundOutcome = await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-08-10T00:01:00.000Z',
      turnId: 'turn-current-foreground-authority',
    })

    expect(foregroundOutcome.kind).toBe('succeeded')
    const foregroundProviderInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
    expect(foregroundProviderInput?.providerConfig).toMatchObject({
      approvalPolicy: null,
      sandbox: 'danger-full-access',
    })
    expect(foregroundProviderInput?.codexThreadConfig).toBeNull()
    expect(foregroundProviderInput?.activeTurnSteering).toBe(activeTurnSteering)
    expect(foregroundProviderInput?.codexConfigOverrides).toEqual(
      input.codexConfigOverrides,
    )
    expect(foregroundProviderInput?.environments).toEqual([
      { PRIVATE_ENVIRONMENT: 'must-not-pass' },
    ])
    expect(foregroundProviderInput).toMatchObject({
      hostedToolContext,
      materializeWorkspaceArtifacts,
      progressDelivery,
      providerFetch,
      publicInternetFetch,
      requireHostedPrivateImageDelivery: true,
      resume: {
        codexThreadId: 'thread-completion-native-authority',
      },
    })
  })

  it('keeps only song generation while denying native creative-notification capabilities', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const input = {
      codexConfigOverrides: [
        'features.shell_tool=true',
        'features.apps=true',
      ],
      prompt: 'Generate one sponsor song from untrusted creative material.',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
    const unsafeProgressDelivery = {
      send: vi.fn(async () => ({
        kind: 'sent' as const,
        source: 'system' as const,
      })),
    }
    const hostedProviderFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 })
    )

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: {
        hosted: {
          materializeWorkspaceArtifacts: vi.fn(),
          memberId: 'member-creative-notification',
          providerFetch: hostedProviderFetch,
          publicInternetFetch: fetch,
          userEnvKeys: [],
        },
      },
      hostedToolContext: {
        automationTool: { request: vi.fn() },
        computerToolsAvailable: true,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        sendVaultFile: vi.fn(),
        vaultFileSendAvailable: true,
      },
      input,
      profile: {
        promptProfile: 'creative-notification',
        toolProfile: 'provider-turn',
        threadScope: 'isolated-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-20',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      progressDelivery: unsafeProgressDelivery,
      turnId: 'turn-creative-notification',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        developerInstructions: null,
        diagnosticsPolicy: {
          environment: 'hosted',
          privateIssueCaptureEnabled: false,
          surface: 'linq',
        },
        dynamicTools: [MURPH_GENERATE_SONG_TOOL],
        environments: [{ PRIVATE_ENVIRONMENT: 'must-not-pass' }],
        onboardingGuidanceInjected: false,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: 'Creative notification system prompt.',
        turnContextPrompt: null,
        voiceMemoDeliveryChannel: 'linq',
        workingDirectory: '/work',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    const outcome = await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-07-20T00:00:00.000Z',
      turnId: 'turn-creative-notification',
    })

    expect(outcome.kind).toBe('succeeded')
    const providerInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
    expect(providerInput?.providerConfig).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
    })
    expect(providerInput?.codexConfigOverrides).toEqual([
      'features.shell_tool=true',
      'features.apps=true',
    ])
    expect(providerInput?.codexThreadConfig).toEqual(
      EXPECTED_NATIVE_CAPABILITIES_RESTRICTED_THREAD_CONFIG,
    )
    expect(providerInput).toMatchObject({
      dynamicTools: [MURPH_GENERATE_SONG_TOOL],
      environments: [],
      generateSongPolicy: {
        maxAttempts: 1,
        requiredDurationSeconds: 15,
      },
      hostedToolContext: null,
      materializeWorkspaceArtifacts: null,
      progressDelivery: null,
      providerFetch: hostedProviderFetch,
      providerThreadEphemeral: true,
      publicInternetFetch: fetch,
      requireHostedPrivateImageDelivery: false,
    })
    expect(providerInput).not.toHaveProperty('processLifetime')
    expect(unsafeProgressDelivery.send).not.toHaveBeenCalled()
  })

  it('runs immutable room-model maintenance as a one-shot tool-only permission turn', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const input = {
      maintenanceProfile: 'group-room-model' as const,
      prompt: 'Refresh the group room model.',
      scheduledInvocationAuthority: {
        automationId: MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
        occurrenceAt: '2026-07-25T08:00:00.000Z',
      },
      vault: '/vaults/group',
    }

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: { hosted: null },
      hostedToolContext: null,
      input,
      profile: {
        promptProfile: 'maintenance',
        threadScope: 'isolated-thread',
        toolProfile: 'maintenance-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-25',
        currentTimeZone: 'America/New_York',
      },
      route,
      sharedPlan: createSharedPlan(),
      progressDelivery: null,
      turnId: 'turn-room-model-maintenance',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        developerInstructions: null,
        diagnosticsPolicy: {
          environment: 'hosted',
          privateIssueCaptureEnabled: false,
          surface: 'linq',
        },
        dynamicTools: [MURPH_GROUP_ROOM_MODEL_TOOL],
        onboardingGuidanceInjected: false,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: 'Room-model maintenance prompt.',
        turnContextPrompt: null,
        workingDirectory: '/vaults/group',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    const outcome = await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      profile: {
        nativeResumePolicy: 'disabled',
        promptProfile: 'maintenance',
        threadScope: 'isolated-thread',
        toolProfile: 'maintenance-turn',
      },
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-07-25T08:00:00.000Z',
      turnId: 'turn-room-model-maintenance',
    })

    expect(outcome.kind).toBe('succeeded')
    expect(
      providerMocks.executeCodexAssistantTurnAttemptFromInput,
    ).toHaveBeenCalledWith(expect.objectContaining({
      dynamicTools: [MURPH_GROUP_ROOM_MODEL_TOOL],
      groupRoomModelMaintenanceAuthorized: true,
      permissions:
        MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE,
      processLifetime: 'one-shot',
      providerThreadEphemeral: true,
      runtimeWorkspaceRoots: ['/vaults/group'],
    }))
  })

  it('keeps memory maintenance one-shot and isolated from reminder tools', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const input = {
      executionContext: {
        hosted: {
          memberId: 'member-maintenance',
          userEnvKeys: [],
        },
      },
      maintenanceProfile: 'member-memory' as const,
      prompt: 'Maintain memory.',
      scheduledInvocationAuthority: {
        automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
        occurrenceAt: '2026-07-25T08:00:00.000Z',
      },
      vault: '/vaults/member',
    }

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: input.executionContext,
      hostedToolContext: {
        computerToolsAvailable: false,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        sendVaultFile: vi.fn(),
        vaultFileSendAvailable: false,
      },
      input,
      profile: {
        promptProfile: 'maintenance',
        threadScope: 'isolated-thread',
        toolProfile: 'maintenance-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-25',
        currentTimeZone: 'America/New_York',
      },
      route,
      sharedPlan: createSharedPlan(),
      progressDelivery: null,
      turnId: 'turn-member-memory-maintenance',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        developerInstructions: null,
        diagnosticsPolicy: {
          environment: 'hosted',
          privateIssueCaptureEnabled: false,
          surface: 'linq',
        },
        dynamicTools: [],
        onboardingGuidanceInjected: false,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: 'Member memory maintenance prompt.',
        turnContextPrompt: null,
        workingDirectory: '/vaults/member',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    const outcome = await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      profile: {
        nativeResumePolicy: 'disabled',
        promptProfile: 'maintenance',
        threadScope: 'isolated-thread',
        toolProfile: 'maintenance-turn',
      },
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-07-25T08:00:00.000Z',
      turnId: 'turn-member-memory-maintenance',
    })

    expect(outcome.kind).toBe('succeeded')
    expect(
      providerMocks.executeCodexAssistantTurnAttemptFromInput,
    ).toHaveBeenCalledWith(expect.objectContaining({
      dynamicTools: [],
      permissions: MURPH_MEMBER_MEMORY_MAINTENANCE_PERMISSION_PROFILE,
      processLifetime: 'one-shot',
      providerThreadEphemeral: true,
      runtimeWorkspaceRoots: ['/vaults/member'],
    }))
  })

  it('keeps onboarding goal check-ins on a vault-readable but mutation-denied turn', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const input = {
      prompt: 'Review current goals without changing them.',
      scheduledInvocationAuthority: {
        automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
        occurrenceAt: '2026-07-25T08:00:00.000Z',
      },
      vault: '/vaults/member',
    }
    const hostedProviderFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 204 })
    )
    const unsafeProgressDelivery = {
      send: vi.fn(async () => ({
        kind: 'sent' as const,
        source: 'system' as const,
      })),
    }

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: {
        hosted: {
          materializeWorkspaceArtifacts: vi.fn(),
          memberId: 'member-goal-checkin',
          providerFetch: hostedProviderFetch,
          publicInternetFetch: fetch,
          userEnvKeys: [],
        },
      },
      hostedToolContext: {
        automationTool: { request: vi.fn() },
        computerToolsAvailable: true,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        sendVaultFile: vi.fn(),
        vaultFileSendAvailable: true,
      },
      input,
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-25',
        currentTimeZone: 'America/New_York',
      },
      route,
      sharedPlan: createSharedPlan(),
      progressDelivery: unsafeProgressDelivery,
      turnId: 'turn-onboarding-goal-checkin',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: 'Murph CLI Contract: read current vault state.',
        cliEnv: {},
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        developerInstructions: 'Immutable read-only goal check-in policy.',
        diagnosticsPolicy: {
          environment: 'hosted',
          privateIssueCaptureEnabled: false,
          surface: 'linq',
        },
        dynamicTools: [MURPH_GENERATE_SONG_TOOL],
        environments: [{ PRIVATE_ENVIRONMENT: 'must-not-pass' }],
        onboardingGuidanceInjected: false,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: {
          binding: session.binding,
        },
        systemPrompt: 'Ordinary Murph prompt plus immutable read-only policy.',
        turnContextPrompt: null,
        workingDirectory: '/vaults/member',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    const outcome = await executeCodexTurnWithRecovery({
      input,
      plan: createSharedPlan(),
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-07-25T08:00:00.000Z',
      turnId: 'turn-onboarding-goal-checkin',
    })

    expect(outcome.kind).toBe('succeeded')
    const providerInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
    expect(providerInput?.providerConfig).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'read-only',
    })
    expect(providerInput?.codexConfigOverrides).toEqual(
      expect.arrayContaining([
        'memories.generate_memories=false',
        'web_search="disabled"',
        'features.apps=false',
        'features.browser_use=false',
        'features.plugins=false',
        'features.multi_agent=false',
      ]),
    )
    expect(providerInput?.codexConfigOverrides).not.toContain(
      'features.shell_tool=false',
    )
    expect(providerInput).toMatchObject({
      dynamicTools: [],
      environments: [],
      hostedToolContext: null,
      materializeWorkspaceArtifacts: null,
      permissions: MURPH_MEMBER_READ_PERMISSION_PROFILE,
      processLifetime: 'one-shot',
      progressDelivery: null,
      providerFetch: null,
      providerThreadEphemeral: true,
      publicInternetFetch: null,
      requireHostedPrivateImageDelivery: false,
      resume: null,
      runtimeWorkspaceRoots: ['/vaults/member'],
      sessionContext: {
        binding: session.binding,
      },
    })
    expect(unsafeProgressDelivery.send).not.toHaveBeenCalled()
  })

  it('keeps group-email replies but removes ambient filesystem execution', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const sharedPlan = createGroupEmailSharedPlan()
    const input = {
      codexConfigOverrides: ['features.shell_tool=true'],
      prompt: 'Reply to the group email.',
      vault: '/vaults/group',
    }

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValue(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValue({
      activeTurnSteering: null,
      executionContext: { hosted: null },
      hostedToolContext: null,
      input,
      profile: {
        promptProfile: 'conversation',
        threadScope: 'session-thread',
        toolProfile: 'provider-turn',
      },
      promptTimeContext: {
        currentLocalDate: '2026-07-25',
        currentTimeZone: 'America/New_York',
      },
      route,
      sharedPlan,
      progressDelivery: null,
      turnId: 'turn-group-email',
    } satisfies AssistantCodexTurnExecutionPlan)
    providerTurnRunnerMocks.buildCodexTurnAttemptPlan.mockResolvedValue({
      attemptCount: 1,
      route,
      routePlan: {
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        assistantCliContract: null,
        cliEnv: {},
        codexContinuation: {
          kind: 'explicit-structured-history',
        } satisfies AssistantCodexContinuation,
        developerInstructions: null,
        diagnosticsPolicy: {
          environment: 'hosted',
          privateIssueCaptureEnabled: false,
          surface: 'email',
        },
        dynamicTools: [],
        onboardingGuidanceInjected: false,
        planningDiagnostics: createRoutePlanningDiagnostics(),
        promptCacheMetadata: null,
        resume: null,
        sessionContext: undefined,
        systemPrompt: 'Group-email prompt.',
        turnContextPrompt: null,
        workingDirectory: '/vaults/group',
      } satisfies AssistantRouteTurnPlan,
      session,
    } satisfies AssistantCodexAttemptPlan)

    const outcome = await executeCodexTurnWithRecovery({
      input,
      plan: sharedPlan,
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-07-25T08:00:00.000Z',
      turnId: 'turn-group-email',
    })

    expect(outcome.kind).toBe('succeeded')
    const providerInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls[0]?.[0]
    expect(providerInput?.providerConfig).toMatchObject({
      sandbox: 'read-only',
    })
    expect(providerInput?.codexConfigOverrides).toEqual([
      'features.shell_tool=true',
      'features.shell_tool=false',
      'features.multi_agent=false',
      'features.multi_agent_v2=false',
      'features.tool_suggest=false',
    ])
    expect(providerInput?.groupConversation).toBe(true)
  })

  it('drops unsupported rich user parts and keeps flex for supported hosted OpenAI routes', async () => {
    const providerScopeEvents: string[] = []
    const flexCatalog = await createHostedCodexFlexCatalog({ model: 'gpt-5.6-terra' })
    const route = createRoute({
      providerOptions: {
        model: 'gpt-5.6-terra',
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
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockImplementation(
      async () => {
        providerScopeEvents.push('provider')
        return createProviderAttemptResult()
      },
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
        onProviderRequestPlanned: async () => {
          providerScopeEvents.push('bound')
          return () => {
            providerScopeEvents.push('released')
          }
        },
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
    expect(providerScopeEvents).toEqual(['bound', 'provider', 'released'])
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
          voiceMemoDeliveryChannel: scenario.expectedChannel,
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

  it('forwards the accepted-message target authorizer to Codex', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
    })
    const input = {
      channel: 'telegram',
      deliverResponse: true,
      prompt: 'Run the turn.',
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
    const sharedPlan = createSharedPlan()
    const authorizeAcceptedMessageTarget = vi.fn(async () => null)

    providerMocks.resolveCodexAssistantTargetCapabilities.mockReturnValue({
      supportedUserMessageContentTypes: ['text'],
      supportsReasoningEffort: true,
    })
    providerMocks.executeCodexAssistantTurnAttemptFromInput.mockResolvedValueOnce(
      createProviderAttemptResult(),
    )
    providerTurnRunnerMocks.buildCodexTurnExecutionPlan.mockResolvedValueOnce({
      activeTurnSteering: null,
      authorizeAcceptedMessageTarget,
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
      turnId: 'turn-message-targeting',
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
      authorizeAcceptedMessageTarget,
      input,
      plan: sharedPlan,
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-04-29T00:00:00.000Z',
      turnId: 'turn-message-targeting',
    })

    expect(outcome.kind).toBe('succeeded')
    const providerInput =
      providerMocks.executeCodexAssistantTurnAttemptFromInput.mock.calls.at(-1)?.[0]
    expect(providerInput?.authorizeAcceptedMessageTarget).toBe(
      authorizeAcceptedMessageTarget,
    )
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
    const releaseProviderAcceptedInputs = vi.fn()
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
    const assistantContractFingerprint = 'a'.repeat(64)
    const codexRolloutRelativePath =
      'sessions/2026/07/14/rollout-thread-terminal-provider-failure.jsonl'
    const failedProviderAttempt: AssistantProviderTurnAttemptResult = {
      acceptedNoReplyDeliveryContextOrdinals: [0],
      codexRolloutRelativePath,
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
        assistantContractFingerprint,
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
      onProviderRequestPlanned: async () => releaseProviderAcceptedInputs,
      plan: createSharedPlan(),
      providerRequestOrdinal: 1,
      resolvedSession: session,
      route,
      turnCreatedAt: '2026-04-29T00:00:00.000Z',
      turnId: 'turn-terminal-provider-failure',
    })

    expect(outcome).toMatchObject({
      acceptedNoReplyDeliveryContextOrdinals: [0],
      assistantContractFingerprint,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      kind: 'failed_terminal',
      codexRolloutRelativePath,
      codexThreadId: 'thread-terminal-provider-failure',
      providerRequestOutcome: 'failed',
      providerTurnId: 'turn-terminal-provider-failure',
    })
    expect(releaseProviderAcceptedInputs).toHaveBeenCalledOnce()
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
    expect(storeMocks.appendAssistantTranscriptEntries).toHaveBeenCalledWith(
      '/vaults/test',
      session.sessionId,
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'error',
        }),
      ]),
    )
  })

  it('suppresses terminal provider failure transcript audit when requested', async () => {
    const route = createRoute()
    const session = createAssistantSession({
      providerOptions: route.providerOptions,
      sessionId: 'session-maintenance-exact-skip',
    })
    const input = {
      prompt: 'Run overnight memory maintenance.',
      suppressProviderFailureTranscriptAudit: true,
      vault: '/vaults/test',
    } satisfies Parameters<typeof executeCodexTurnWithRecovery>[0]['input']
    const providerError = Object.assign(new Error('Codex failed.'), {
      code: 'ASSISTANT_CODEX_FAILED',
    })
    const failedProviderAttempt: AssistantProviderTurnAttemptResult = {
      codexThreadId: 'thread-maintenance-provider-failure',
      error: providerError,
      metadata: {
        activityLabels: ['Memory Update'],
        executedToolCount: 0,
        providerActionCount: 2,
        rawToolEvents: [],
        runtimeIssueInputs: [],
      },
      ok: false,
      providerRequestOutcome: 'failed',
      providerTurnId: 'turn-maintenance-provider-failure',
      rawEvents: [
        { event: 'item.started' },
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
          memberId: 'member-maintenance-provider-failure',
          userEnvKeys: [],
        },
      },
      input,
      profile: {
        promptProfile: 'conversation',
        toolProfile: 'provider-turn',
        threadScope: 'isolated-thread',
      },
      promptTimeContext: {
        currentLocalDate: '2026-04-29',
        currentTimeZone: 'UTC',
      },
      route,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-maintenance-provider-failure',
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
      turnId: 'turn-maintenance-provider-failure',
    })

    expect(outcome).toMatchObject({
      kind: 'failed_terminal',
      codexThreadId: 'thread-maintenance-provider-failure',
      providerRequestOutcome: 'failed',
      providerTurnId: 'turn-maintenance-provider-failure',
    })
    expect(storeMocks.appendAssistantTranscriptEntries).not.toHaveBeenCalled()
    expect(providerTurnRunnerMocks.recordCodexAttemptFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.sessionId,
        turnId: 'turn-maintenance-provider-failure',
      }),
    )
  })

  it('drops flex service tier for hosted OpenAI routes without catalog evidence', async () => {
    const route = createRoute({
      providerOptions: {
        model: 'gpt-5.6-terra',
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
        model: 'gpt-5.6-terra',
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
    const deviceTool = {
      request: vi.fn(async () => ({
        action: 'connect' as const,
        link: {
          authorizationUrl: 'https://connect.example.test/whoop',
          connectUrl: 'https://connect.example.test/whoop',
          expiresAt: '2026-04-30T00:05:00.000Z',
          provider: 'whoop',
          providerLabel: 'WHOOP',
        },
      })),
    }
    const input = {
      channel: 'linq',
      executionContext: {
        hosted: {
          deviceConnectProviders: [
            { label: 'WHOOP', provider: 'whoop' },
          ],
          deviceTool,
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
    expect(deviceTool.request).not.toHaveBeenCalled()
    expect(providerMocks.executeCodexAssistantTurnAttemptFromInput).toHaveBeenCalledWith(
      expect.objectContaining({
        userPrompt: 'Please connect my WHOOP',
      }),
    )
    // Attempt observability is the runner's only receipt-writing seam, and it
    // records failures exclusively: a successful attempt must make no receipt
    // timeline write between provider success and the reply return.
    expect(providerTurnRunnerMocks.recordCodexAttemptFailed).not.toHaveBeenCalled()
  })
})
