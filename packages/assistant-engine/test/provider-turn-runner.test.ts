import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assistantFailoverStateSchema,
  type AssistantProviderSessionOptions,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../src/assistant/service-contracts.ts'
import type { ResolvedAssistantFailoverRoute } from '../src/assistant/failover.ts'

const runnerMocks = vi.hoisted(() => ({
  appendAssistantTranscriptEntries: vi.fn(),
  appendAssistantTurnReceiptEvent: vi.fn(),
  attachRecoveredAssistantSession: vi.fn(),
  buildAssistantActiveExperimentContextBlock: vi.fn(),
  buildAssistantSystemPrompt: vi.fn(),
  buildAssistantNotificationDecisionSystemPrompt: vi.fn(),
  buildAssistantVaultOverviewBlock: vi.fn(),
  createAssistantFoodAutoLogHooks: vi.fn(),
  createAssistantMemoryTurnContextEnv: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  createProviderTurnAssistantToolCatalog: vi.fn(),
  createNotificationTurnAssistantToolCatalog: vi.fn(),
  errorMessage: vi.fn(),
  executeAssistantProviderTurnAttempt: vi.fn(),
  getAssistantFailoverCooldownUntil: vi.fn(),
  isAssistantFailoverRouteCoolingDown: vi.fn(),
  loadVault: vi.fn(),
  listAssistantTranscriptEntries: vi.fn(),
  maybeThrowInjectedAssistantFault: vi.fn(),
  normalizeAssistantExecutionContext: vi.fn(),
  normalizeNullableString: vi.fn(),
  readAssistantFailoverState: vi.fn(),
  recordAssistantDiagnosticEvent: vi.fn(),
  recordAssistantFailoverRouteFailure: vi.fn(),
  recordAssistantFailoverRouteSuccess: vi.fn(),
  recoverAssistantSessionAfterProviderFailure: vi.fn(),
  resolveAssistantCliAccessContext: vi.fn(),
  resolveAssistantCliSurfaceBootstrapContext: vi.fn(),
  resolveAssistantProviderTargetExecutionCapabilities: vi.fn(),
  resolveAssistantProviderResumeKey: vi.fn(),
  resolveAssistantRouteResumeBinding: vi.fn(),
  shouldAttemptAssistantProviderFailover: vi.fn(),
}))

vi.mock('../src/assistant-cli-access.ts', () => ({
  resolveAssistantCliAccessContext: runnerMocks.resolveAssistantCliAccessContext,
}))

vi.mock('../src/assistant-cli-tools.ts', () => ({
  createNotificationTurnAssistantToolCatalog:
    runnerMocks.createNotificationTurnAssistantToolCatalog,
  createProviderTurnAssistantToolCatalog:
    runnerMocks.createProviderTurnAssistantToolCatalog,
}))

vi.mock('@murphai/core', () => ({
  loadVault: runnerMocks.loadVault,
}))

vi.mock('../src/assistant-provider.ts', () => ({
  executeAssistantProviderTurnAttempt:
    runnerMocks.executeAssistantProviderTurnAttempt,
  resolveAssistantProviderTargetExecutionCapabilities:
    runnerMocks.resolveAssistantProviderTargetExecutionCapabilities,
}))

vi.mock('../src/assistant/diagnostics.ts', () => ({
  recordAssistantDiagnosticEvent: runnerMocks.recordAssistantDiagnosticEvent,
}))

vi.mock('../src/assistant/execution-context.ts', () => ({
  normalizeAssistantExecutionContext: runnerMocks.normalizeAssistantExecutionContext,
}))

vi.mock('../src/assistant/system-prompt.ts', () => ({
  buildAssistantNotificationDecisionSystemPrompt:
    runnerMocks.buildAssistantNotificationDecisionSystemPrompt,
  buildAssistantSystemPrompt: runnerMocks.buildAssistantSystemPrompt,
}))

vi.mock('../src/assistant/active-experiment-context.ts', () => ({
  buildAssistantActiveExperimentContextBlock:
    runnerMocks.buildAssistantActiveExperimentContextBlock,
}))

vi.mock('../src/assistant/vault-overview.ts', () => ({
  buildAssistantVaultOverviewBlock: runnerMocks.buildAssistantVaultOverviewBlock,
}))

vi.mock('../src/assistant/shared.ts', () => ({
  errorMessage: runnerMocks.errorMessage,
  normalizeNullableString: runnerMocks.normalizeNullableString,
}))

vi.mock('../src/assistant/cli-surface-bootstrap.ts', () => ({
  resolveAssistantCliSurfaceBootstrapContext:
    runnerMocks.resolveAssistantCliSurfaceBootstrapContext,
}))

vi.mock('../src/assistant/failover.ts', () => ({
  getAssistantFailoverCooldownUntil:
    runnerMocks.getAssistantFailoverCooldownUntil,
  isAssistantFailoverRouteCoolingDown:
    runnerMocks.isAssistantFailoverRouteCoolingDown,
  readAssistantFailoverState: runnerMocks.readAssistantFailoverState,
  recordAssistantFailoverRouteFailure:
    runnerMocks.recordAssistantFailoverRouteFailure,
  recordAssistantFailoverRouteSuccess:
    runnerMocks.recordAssistantFailoverRouteSuccess,
  shouldAttemptAssistantProviderFailover:
    runnerMocks.shouldAttemptAssistantProviderFailover,
}))

vi.mock('../src/assistant/fault-injection.ts', () => ({
  maybeThrowInjectedAssistantFault: runnerMocks.maybeThrowInjectedAssistantFault,
}))

vi.mock('../src/assistant/memory/turn-context.ts', () => ({
  createAssistantMemoryTurnContextEnv:
    runnerMocks.createAssistantMemoryTurnContextEnv,
}))

vi.mock('../src/assistant/provider-turn-recovery.ts', () => ({
  attachRecoveredAssistantSession: runnerMocks.attachRecoveredAssistantSession,
  recoverAssistantSessionAfterProviderFailure:
    runnerMocks.recoverAssistantSessionAfterProviderFailure,
}))

vi.mock('../src/assistant/provider-binding.ts', () => ({
  resolveAssistantProviderResumeKey:
    runnerMocks.resolveAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding:
    runnerMocks.resolveAssistantRouteResumeBinding,
}))

vi.mock('../src/assistant/store.ts', () => ({
  appendAssistantTranscriptEntries: runnerMocks.appendAssistantTranscriptEntries,
  listAssistantTranscriptEntries: runnerMocks.listAssistantTranscriptEntries,
}))

vi.mock('../src/assistant/turns.ts', () => ({
  appendAssistantTurnReceiptEvent: runnerMocks.appendAssistantTurnReceiptEvent,
}))

vi.mock('@murphai/vault-usecases/vault-services', () => ({
  createIntegratedVaultServices: runnerMocks.createIntegratedVaultServices,
}))

vi.mock('../src/assistant/food-auto-log-hooks.ts', () => ({
  createAssistantFoodAutoLogHooks: runnerMocks.createAssistantFoodAutoLogHooks,
}))

import { executeProviderTurnWithRecovery } from '../src/assistant/provider-turn-runner.ts'

describe('executeProviderTurnWithRecovery', () => {
  const toolCatalog = {
    hasTool: vi.fn<(toolName: string) => boolean>(),
    listTools: vi.fn(),
  }
  const notificationToolCatalog = {
    hasTool: vi.fn<(toolName: string) => boolean>(),
    listTools: vi.fn(),
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T14:30:00.000Z'))
    runnerMocks.appendAssistantTranscriptEntries.mockReset().mockResolvedValue([])
    runnerMocks.appendAssistantTurnReceiptEvent.mockReset().mockResolvedValue(undefined)
    runnerMocks.attachRecoveredAssistantSession.mockReset()
    runnerMocks.buildAssistantNotificationDecisionSystemPrompt
      .mockReset()
      .mockImplementation((input: {
        channel: string | null
        currentLocalDate: string
        currentTimeZone: string
        vaultOverview?: string | null
      }) =>
        `notification:${input.channel ?? 'none'}:${input.currentLocalDate}:${input.currentTimeZone}:${input.vaultOverview ?? 'no-overview'}`,
      )
    runnerMocks.buildAssistantSystemPrompt
      .mockReset()
      .mockImplementation((input: {
        channel: string | null
        onboardingGuidance: boolean
        assistantCliContract: string | null
        vaultOverview?: string | null
      }) =>
        `prompt:${input.channel ?? 'none'}:${input.onboardingGuidance ? 'first' : 'later'}:${input.assistantCliContract ?? 'no-bootstrap'}:${input.vaultOverview ?? 'no-overview'}`,
      )
    runnerMocks.buildAssistantActiveExperimentContextBlock
      .mockReset()
      .mockResolvedValue(null)
    runnerMocks.buildAssistantVaultOverviewBlock
      .mockReset()
      .mockResolvedValue('Vault overview for navigation only:\n- Canonical coverage includes 1 meal event.')
    runnerMocks.createAssistantFoodAutoLogHooks.mockReset().mockReturnValue({
      kind: 'food-hooks',
    })
    runnerMocks.createAssistantMemoryTurnContextEnv
      .mockReset()
      .mockReturnValue({
        MEMORY_CONTEXT: 'enabled',
      })
    runnerMocks.createIntegratedVaultServices.mockReset().mockReturnValue({
      kind: 'vault-services',
    })
    toolCatalog.hasTool.mockReset().mockReturnValue(true)
    toolCatalog.listTools.mockReset().mockReturnValue([
      { name: 'vault.cli.run' },
      { name: 'assistant.knowledge.list' },
      { name: 'assistant.knowledge.search' },
      { name: 'assistant.knowledge.get' },
      { name: 'assistant.knowledge.lint' },
      { name: 'assistant.knowledge.upsert' },
      { name: 'assistant.knowledge.rebuildIndex' },
      { name: 'murph.device.connect' },
    ])
    notificationToolCatalog.hasTool.mockReset().mockReturnValue(true)
    notificationToolCatalog.listTools.mockReset().mockReturnValue([])
    runnerMocks.createProviderTurnAssistantToolCatalog
      .mockReset()
      .mockReturnValue(toolCatalog)
    runnerMocks.createNotificationTurnAssistantToolCatalog
      .mockReset()
      .mockReturnValue(notificationToolCatalog)
    runnerMocks.errorMessage
      .mockReset()
      .mockImplementation((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      )
    runnerMocks.normalizeNullableString
      .mockReset()
      .mockImplementation((value: string | null | undefined) => {
        if (typeof value !== 'string') {
          return null
        }

        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
      })
    runnerMocks.executeAssistantProviderTurnAttempt.mockReset()
    runnerMocks.getAssistantFailoverCooldownUntil.mockReset().mockReturnValue(null)
    runnerMocks.isAssistantFailoverRouteCoolingDown.mockReset().mockReturnValue(false)
    runnerMocks.loadVault.mockReset().mockResolvedValue({
      metadata: {
        timezone: 'America/Los_Angeles',
      },
    })
    runnerMocks.listAssistantTranscriptEntries.mockReset().mockResolvedValue([])
    runnerMocks.maybeThrowInjectedAssistantFault.mockReset()
    runnerMocks.normalizeAssistantExecutionContext
      .mockReset()
      .mockImplementation((value: unknown) => value ?? null)
    runnerMocks.readAssistantFailoverState
      .mockReset()
      .mockResolvedValue(createFailoverState())
    runnerMocks.recordAssistantDiagnosticEvent
      .mockReset()
      .mockResolvedValue(undefined)
    runnerMocks.recordAssistantFailoverRouteFailure
      .mockReset()
      .mockResolvedValue(createFailoverState())
    runnerMocks.recordAssistantFailoverRouteSuccess
      .mockReset()
      .mockResolvedValue(createFailoverState())
    runnerMocks.recoverAssistantSessionAfterProviderFailure
      .mockReset()
      .mockResolvedValue(null)
    runnerMocks.resolveAssistantCliAccessContext.mockReset()
    runnerMocks.resolveAssistantCliSurfaceBootstrapContext
      .mockReset()
      .mockResolvedValue('cli-bootstrap')
    runnerMocks.resolveAssistantProviderTargetExecutionCapabilities
      .mockReset()
      .mockReturnValue({
        murphCommandSurface: 'bound-tools',
        supportsNativeResume: false,
        supportsToolRuntime: true,
      })
    runnerMocks.resolveAssistantProviderResumeKey
      .mockReset()
      .mockReturnValue(null)
    runnerMocks.resolveAssistantRouteResumeBinding
      .mockReset()
      .mockReturnValue(null)
    runnerMocks.shouldAttemptAssistantProviderFailover
      .mockReset()
      .mockReturnValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('skips a cooling primary route, injects bootstrap context, and succeeds on the backup route', async () => {
    const primaryRoute = createRoute({
      label: 'Primary',
      routeId: 'route-primary',
    })
    const backupRoute = createRoute({
      label: 'Backup',
      routeId: 'route-backup',
    })
    const session = createAssistantSession()

    runnerMocks.isAssistantFailoverRouteCoolingDown.mockImplementation(
      ({ route }: { route: ResolvedAssistantFailoverRoute }) =>
        route.routeId === primaryRoute.routeId,
    )
    runnerMocks.listAssistantTranscriptEntries.mockResolvedValue([
      {
        kind: 'system',
        text: 'ignore me',
      },
      {
        kind: 'assistant',
        text: 'Earlier answer',
      },
      {
        kind: 'user',
        text: 'Current prompt',
      },
    ])
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        activityLabels: ['calendar'],
        providerSessionId: 'provider-session-backup',
        response: 'Recovered answer',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        channel: 'chat',
        prompt: 'Current prompt',
      }),
      plan: createTurnPlan({
        allowSensitiveHealthContext: true,
        onboardingGuidanceOpen: true,
      }),
      resolvedSession: session,
      routes: [primaryRoute, backupRoute],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-bootstrap-success',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
      providerTurn: {
        attemptCount: 1,
        onboardingGuidanceInjected: true,
        route: backupRoute,
        session,
        workingDirectory: '/tmp/provider-turn-runner-tests',
      },
    })
    expect(runnerMocks.resolveAssistantCliSurfaceBootstrapContext).toHaveBeenCalledWith({
      cliEnv: {
        CLI_TOKEN: 'test-cli-token',
      },
      executionContext: null,
      sessionId: session.sessionId,
      vault: '/tmp/test-vault',
      workingDirectory: '/tmp/provider-turn-runner-tests',
    })
    expect(runnerMocks.loadVault).toHaveBeenCalledWith({
      vaultRoot: '/tmp/test-vault',
    })
    expect(runnerMocks.createProviderTurnAssistantToolCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        cliEnv: {
          CLI_TOKEN: 'test-cli-token',
          MEMORY_CONTEXT: 'enabled',
        },
        operatorAuthority: 'direct-operator',
        sessionBinding: session.binding,
      }),
    )
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantCliContract: 'cli-bootstrap',
        assistantCommandAccessMode: 'bound-tools',
        assistantHealthCommonsAccessMode: 'bound-tools',
        assistantHostedDeviceConnectAvailable: true,
        assistantKnowledgeToolsAvailable: true,
        assistantToolNameAliases: expect.objectContaining({
          'vault.cli.run': 'vault_cli_run',
        }),
        channel: 'chat',
        currentLocalDate: '2026-04-08',
        currentTimeZone: 'America/Los_Angeles',
        onboardingGuidance: true,
        modelBehaviorProfile: 'default',
        turnTrigger: null,
        vaultOverview:
          'Vault overview for navigation only:\n- Canonical coverage includes 1 meal event.',
      }),
    )
    expect(runnerMocks.buildAssistantVaultOverviewBlock).toHaveBeenCalledWith(
      '/tmp/test-vault',
    )
    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationMessages: [
          {
            content: 'Earlier answer',
            role: 'assistant',
          },
        ],
        env: {
          CLI_TOKEN: 'test-cli-token',
          MEMORY_CONTEXT: 'enabled',
        },
        provider: backupRoute.provider,
        resumeProviderSessionId: null,
        sessionContext: {
          binding: session.binding,
        },
        systemPrompt:
          'prompt:chat:first:cli-bootstrap:Vault overview for navigation only:\n- Canonical coverage includes 1 meal event.',
        workingDirectory: '/tmp/provider-turn-runner-tests',
      }),
    )
    expect(extractReceiptKinds()).toEqual([
      'provider.failover.applied',
      'provider.attempt.started',
      'provider.attempt.succeeded',
    ])
    expect(runnerMocks.recordAssistantDiagnosticEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'provider.failover.applied',
        level: 'warn',
      }),
    )
  })

  it('keeps Health Commons native tools visible when the generic CLI executor is unavailable', async () => {
    const route = createRoute({
      routeId: 'route-health-commons-native-only',
    })
    const session = createAssistantSession()
    const healthCommonsToolNames = new Set([
      'healthCommons.search',
      'healthCommons.get',
      'healthCommons.listProtocols',
      'healthCommons.listSources',
    ])

    toolCatalog.hasTool.mockImplementation((toolName) =>
      healthCommonsToolNames.has(toolName),
    )
    toolCatalog.listTools.mockReturnValue(
      [...healthCommonsToolNames].map((name) => ({ name })),
    )
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-health-commons-native-only',
        response: 'Health Commons answer',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'What Health Commons protocols are available?',
      }),
      plan: createTurnPlan({
        allowSensitiveHealthContext: true,
        onboardingGuidanceOpen: false,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-health-commons-native-only',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
    })
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantCommandAccessMode: 'none',
        assistantHealthCommonsAccessMode: 'bound-tools',
        assistantHostedDeviceConnectAvailable: false,
        assistantKnowledgeToolsAvailable: false,
      }),
    )
  })

  it('passes the GPT-5 agentic model behavior profile into conversation prompts for GPT-5 routes', async () => {
    const route = createRoute({
      providerOptions: {
        model: 'openai/gpt-5.4',
      },
      routeId: 'route-gpt5',
    })

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-gpt5',
        response: 'GPT-5 route answer',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        channel: 'chat',
        prompt: 'Log this symptom',
      }),
      plan: createTurnPlan({
        allowSensitiveHealthContext: true,
        onboardingGuidanceOpen: false,
      }),
      resolvedSession: createAssistantSession(),
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-gpt5-profile',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
    })
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        modelBehaviorProfile: 'gpt5-agentic',
      }),
    )
  })

  it('uses the notification-decision profile, notification tool catalog, and disabled native resume for notification turns', async () => {
    const onTraceEvent = vi.fn()
    const route = createRoute({
      routeId: 'route-notification',
      providerOptions: {
        gatewayOnlyProviders: ['azure'],
        model: 'openai/gpt-5.4',
        providerName: 'vercel-ai-gateway',
        resumeKind: 'openai-response-id',
        zeroDataRetention: true,
      },
    })
    const session = createAssistantSession({
      providerSessionId: 'provider-session-notification',
      resumeRouteId: 'route-notification',
      turnCount: 2,
    })

    runnerMocks.resolveAssistantProviderTargetExecutionCapabilities.mockReturnValue({
      murphCommandSurface: 'bound-tools',
      supportsNativeResume: true,
      supportsToolRuntime: true,
    })
    notificationToolCatalog.listTools.mockReturnValue([
      { name: 'healthCommons.search' },
      { name: 'healthCommons.get' },
    ])
    runnerMocks.resolveAssistantRouteResumeBinding.mockReturnValue(
      session.resumeState,
    )
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-notification',
        response: '{"kind":"skip","privateSummary":"No notification needed."}',
      }),
    )
    runnerMocks.buildAssistantActiveExperimentContextBlock.mockResolvedValueOnce(
      'Active experiment context for navigation only:\n- Sauna RHR (`sauna-rhr`, exp_test): started 2026-04-01.',
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        channel: 'chat',
        executionContext: {
          hosted: {
            memberId: 'member_123',
            userEnvKeys: [],
          },
        },
        onTraceEvent,
        prompt: 'Check the notification decision.',
        turnTrigger: 'automation-cron',
      }),
      plan: createTurnPlan({
        allowSensitiveHealthContext: true,
        onboardingGuidanceOpen: true,
      }),
      profile: {
        nativeResumePolicy: 'disabled',
        promptProfile: 'notification-decision',
        toolProfile: 'notification-turn',
      },
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-notification-profile',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        route,
      },
    })
    expect(runnerMocks.createProviderTurnAssistantToolCatalog).not.toHaveBeenCalled()
    expect(runnerMocks.createNotificationTurnAssistantToolCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        cliEnv: {
          CLI_TOKEN: 'test-cli-token',
          MEMORY_CONTEXT: 'enabled',
        },
      }),
    )
    expect(runnerMocks.buildAssistantSystemPrompt).not.toHaveBeenCalled()
    expect(runnerMocks.buildAssistantNotificationDecisionSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        activeExperimentContext:
          'Active experiment context for navigation only:\n- Sauna RHR (`sauna-rhr`, exp_test): started 2026-04-01.',
        allowSensitiveHealthContext: true,
        assistantHealthCommonsAccessMode: 'bound-tools',
        assistantToolNameAliases: expect.objectContaining({
          'healthCommons.search': 'healthCommons_search',
        }),
        channel: 'chat',
        currentLocalDate: '2026-04-08',
        currentTimeZone: 'America/Los_Angeles',
        vaultOverview:
          'Vault overview for navigation only:\n- Canonical coverage includes 1 meal event.',
      }),
    )
    expect(runnerMocks.resolveAssistantCliSurfaceBootstrapContext).not.toHaveBeenCalled()
    expect(runnerMocks.resolveAssistantProviderResumeKey).not.toHaveBeenCalled()
    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeProviderSessionId: null,
        systemPrompt:
          'notification:chat:2026-04-08:America/Los_Angeles:Vault overview for navigation only:\n- Canonical coverage includes 1 meal event.',
      }),
    )
    expect(onTraceEvent.mock.invocationCallOrder[0]).toBeLessThan(
      runnerMocks.executeAssistantProviderTurnAttempt.mock.invocationCallOrder[0],
    )
    expect(onTraceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: null,
        rawEvent: expect.objectContaining({
          gatewayOnlyProviderCount: 1,
          gatewayOnlyProviders: ['azure'],
          providerModel: 'openai/gpt-5.4',
          providerName: 'vercel-ai-gateway',
          promptProfile: 'notification-decision',
          schema: 'murph.assistant-provider-request-debug.v1',
          systemPromptHash: expect.any(String),
          systemPromptLength: expect.any(Number),
          turnTrigger: 'automation-cron',
          type: 'assistant.provider.request.debug',
          userPromptHash: expect.any(String),
          userPromptLength: 'Check the notification decision.'.length,
          zeroDataRetention: true,
        }),
        updates: [
          {
            kind: 'status',
            text: 'Hosted notification provider request summary captured.',
          },
        ],
      }),
    )
  })

  it('merges plan-scoped cli env into the provider tool catalog env', async () => {
    const route = createRoute({
      routeId: 'route-merge-cli-env',
    })
    const session = createAssistantSession()

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-merge-cli-env',
        response: 'Merged answer',
      }),
    )

    await executeProviderTurnWithRecovery({
      input: createMessageInput({
        channel: 'chat',
        prompt: 'Use the tool',
      }),
      plan: createTurnPlan({
        cliAccessEnv: {
          CLI_TOKEN: 'test-cli-token',
          PLAN_ONLY_VAR: 'plan-value',
        },
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-merge-cli-env',
    })

    expect(runnerMocks.createProviderTurnAssistantToolCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        cliEnv: {
          CLI_TOKEN: 'test-cli-token',
          MEMORY_CONTEXT: 'enabled',
          PLAN_ONLY_VAR: 'plan-value',
        },
      }),
    )
  })

  it('replays the latest 100 transcript messages when bootstrap context is required', async () => {
    const route = createRoute({
      routeId: 'route-bootstrap-replay-limit',
    })
    const session = createAssistantSession()

    runnerMocks.listAssistantTranscriptEntries.mockResolvedValue(
      Array.from({ length: 105 }, (_, index) => ({
        kind: index % 2 === 0 ? 'assistant' : 'user',
        text: `Message ${index + 1}`,
      })),
    )
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-bootstrap-limit',
        response: 'Replay window applied',
      }),
    )

    await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Newest prompt',
      }),
      plan: createTurnPlan({
        onboardingGuidanceOpen: true,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-bootstrap-replay-limit',
    })

    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationMessages: expect.arrayContaining([
          {
            content: 'Message 6',
            role: 'user',
          },
          {
            content: 'Message 105',
            role: 'assistant',
          },
        ]),
      }),
    )
    expect(
      runnerMocks.executeAssistantProviderTurnAttempt.mock.calls[0]?.[0]
        ?.conversationMessages,
    ).toHaveLength(100)
  })

  it('reuses openai response ids without replaying transcript history when bootstrap context is not required', async () => {
    const session = createAssistantSession({
      providerSessionId: 'provider-session-primary',
      resumeRouteId: 'route-primary',
      turnCount: 3,
    })
    const route = createRoute({
      providerOptions: {
        resumeKind: 'openai-response-id',
      },
      routeId: 'route-primary',
    })

    runnerMocks.resolveAssistantProviderTargetExecutionCapabilities.mockReturnValue({
      murphCommandSurface: 'direct-cli',
      requestFormat: 'messages',
      supportsNativeResume: true,
      supportsToolRuntime: false,
    })
    runnerMocks.resolveAssistantRouteResumeBinding.mockReturnValue(
      session.resumeState,
    )
    runnerMocks.resolveAssistantProviderResumeKey.mockReturnValue(
      'provider-session-primary',
    )
    runnerMocks.buildAssistantActiveExperimentContextBlock.mockResolvedValueOnce(
      'Active experiment context for navigation only:\n- Sauna RHR (`sauna-rhr`, exp_test): started 2026-04-01.',
    )
    toolCatalog.hasTool.mockReturnValue(false)
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-primary',
        response: 'Resumed answer',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Current prompt',
      }),
      plan: createTurnPlan({
        allowSensitiveHealthContext: true,
        onboardingGuidanceOpen: false,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-native-resume',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
      providerTurn: {
        attemptCount: 1,
        onboardingGuidanceInjected: false,
      },
    })
    expect(runnerMocks.resolveAssistantCliSurfaceBootstrapContext).not.toHaveBeenCalled()
    expect(runnerMocks.loadVault).toHaveBeenCalledWith({
      vaultRoot: '/tmp/test-vault',
    })
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantCliContract: null,
        assistantCommandAccessMode: 'direct-cli',
        assistantHealthCommonsAccessMode: 'direct-cli',
        assistantHostedDeviceConnectAvailable: false,
        assistantKnowledgeToolsAvailable: false,
        currentLocalDate: '2026-04-08',
        currentTimeZone: 'America/Los_Angeles',
        onboardingGuidance: false,
        activeExperimentContext:
          'Active experiment context for navigation only:\n- Sauna RHR (`sauna-rhr`, exp_test): started 2026-04-01.',
        vaultOverview: null,
      }),
    )
    expect(runnerMocks.buildAssistantVaultOverviewBlock).not.toHaveBeenCalled()
    expect(runnerMocks.buildAssistantActiveExperimentContextBlock).toHaveBeenCalledWith(
      '/tmp/test-vault',
    )
    expect(runnerMocks.listAssistantTranscriptEntries).not.toHaveBeenCalled()
    expect(toolCatalog.hasTool).not.toHaveBeenCalled()
    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationMessages: undefined,
        resumeProviderSessionId: 'provider-session-primary',
        sessionContext: undefined,
        systemPrompt: 'prompt:none:later:no-bootstrap:no-overview',
      }),
    )
  })

  it('does not resolve active experiment context when sensitive context is disallowed', async () => {
    const route = createRoute({
      routeId: 'route-private-context-gated',
    })
    const session = createAssistantSession()

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-gated',
        response: 'Gated answer',
      }),
    )

    await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'What am I working on?',
      }),
      plan: createTurnPlan({
        allowSensitiveHealthContext: false,
        onboardingGuidanceOpen: true,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-active-experiment-context-gated',
    })

    expect(runnerMocks.buildAssistantActiveExperimentContextBlock).not.toHaveBeenCalled()
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        activeExperimentContext: null,
        allowSensitiveHealthContext: false,
      }),
    )
  })

  it('keeps bootstrap context and transcript available for flat-prompt resume fallback', async () => {
    const session = createAssistantSession({
      providerSessionId: 'provider-session-primary',
      resumeRouteId: 'route-primary',
      turnCount: 3,
    })
    const route = createRoute({
      providerOptions: {
        resumeKind: 'codex-thread',
      },
      routeId: 'route-primary',
    })

    runnerMocks.resolveAssistantProviderTargetExecutionCapabilities.mockReturnValue({
      murphCommandSurface: 'direct-cli',
      requestFormat: 'flat-prompt',
      supportsNativeResume: true,
      supportsToolRuntime: false,
    })
    runnerMocks.resolveAssistantRouteResumeBinding.mockReturnValue(
      session.resumeState,
    )
    runnerMocks.resolveAssistantProviderResumeKey.mockReturnValue(
      'provider-session-primary',
    )
    runnerMocks.listAssistantTranscriptEntries.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        kind: index % 2 === 0 ? 'assistant' : 'user',
        text: `Resume message ${index + 1}`,
      })),
    )
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-primary',
        response: 'Resumed answer',
      }),
    )

    await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Current prompt',
      }),
      plan: createTurnPlan({
        onboardingGuidanceOpen: false,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-native-resume-codex-tail',
    })

    expect(runnerMocks.listAssistantTranscriptEntries).toHaveBeenCalledWith(
      '/tmp/test-vault',
      session.sessionId,
    )
    expect(runnerMocks.resolveAssistantCliSurfaceBootstrapContext).toHaveBeenCalled()
    expect(runnerMocks.buildAssistantVaultOverviewBlock).toHaveBeenCalledWith(
      '/tmp/test-vault',
    )
    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationMessages: expect.arrayContaining([
          {
            content: 'Resume message 6',
            role: 'user',
          },
          {
            content: 'Resume message 25',
            role: 'assistant',
          },
        ]),
        resumeProviderSessionId: 'provider-session-primary',
        sessionContext: {
          binding: session.binding,
        },
        systemPrompt:
          'prompt:none:later:cli-bootstrap:Vault overview for navigation only:\n- Canonical coverage includes 1 meal event.',
      }),
    )
    expect(
      runnerMocks.executeAssistantProviderTurnAttempt.mock.calls.at(-1)?.[0]
        ?.conversationMessages,
    ).toHaveLength(25)
  })

  it('preserves native resume and skips bootstrap overlays while still injecting onboarding guidance', async () => {
    const session = createAssistantSession({
      providerSessionId: 'provider-session-primary',
      resumeRouteId: 'route-primary',
      turnCount: 1,
    })
    const route = createRoute({
      providerOptions: {
        resumeKind: 'openai-response-id',
      },
      routeId: 'route-primary',
    })

    runnerMocks.resolveAssistantProviderTargetExecutionCapabilities.mockReturnValue({
      murphCommandSurface: 'direct-cli',
      requestFormat: 'messages',
      supportsNativeResume: true,
      supportsToolRuntime: false,
    })
    runnerMocks.resolveAssistantRouteResumeBinding.mockReturnValue(
      session.resumeState,
    )
    runnerMocks.resolveAssistantProviderResumeKey.mockReturnValue(
      'provider-session-primary',
    )
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-primary',
        response: 'Onboarding answer',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Yea!',
      }),
      plan: createTurnPlan({
        onboardingGuidanceOpen: true,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-onboarding-overrides-native-resume',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
      },
    })
    expect(runnerMocks.resolveAssistantCliSurfaceBootstrapContext).not.toHaveBeenCalled()
    expect(runnerMocks.buildAssistantVaultOverviewBlock).not.toHaveBeenCalled()
    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeProviderSessionId: 'provider-session-primary',
        systemPrompt: 'prompt:none:first:no-bootstrap:no-overview',
      }),
    )
  })

  it('settles a narrow onboarding completion fallback when no command surface is available', async () => {
    const route = createRoute({
      routeId: 'route-no-command-surface',
    })
    const session = createAssistantSession()

    runnerMocks.resolveAssistantProviderTargetExecutionCapabilities.mockReturnValue({
      murphCommandSurface: 'bound-tools',
      requestFormat: 'messages',
      supportsNativeResume: false,
      supportsToolRuntime: false,
    })
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: null,
        response: 'Sleep debt summary',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Can you help me understand my sleep debt?',
      }),
      plan: createTurnPlan({
        onboardingGuidanceOpen: true,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-no-command-onboarding-fallback',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
      providerTurn: {
        onboardingCompletionFallbackReason: 'concrete_request',
        onboardingGuidanceInjected: true,
      },
    })
    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        toolRuntime: null,
      }),
    )
  })

  it('keeps onboarding open for broad context answers when no command surface is available', async () => {
    const route = createRoute({
      routeId: 'route-no-command-surface',
    })
    const session = createAssistantSession()

    runnerMocks.resolveAssistantProviderTargetExecutionCapabilities.mockReturnValue({
      murphCommandSurface: 'bound-tools',
      requestFormat: 'messages',
      supportsNativeResume: false,
      supportsToolRuntime: false,
    })
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: null,
        response: 'Got it. You can send rough sleep notes as they happen.',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Trying to sleep better',
      }),
      plan: createTurnPlan({
        onboardingGuidanceOpen: true,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-no-command-onboarding-context',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
      providerTurn: {
        onboardingCompletionFallbackReason: null,
        onboardingGuidanceInjected: true,
      },
    })
  })

  it('passes automation-cron turn trigger into the system prompt builder', async () => {
    const route = createRoute({
      label: 'Primary',
      routeId: 'route-primary',
    })
    const session = createAssistantSession()

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: null,
        response: 'Scheduled answer',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        channel: 'chat',
        prompt: 'Send the reminder',
        turnTrigger: 'automation-cron',
      }),
      plan: createTurnPlan({
        allowSensitiveHealthContext: true,
        onboardingGuidanceOpen: false,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-automation-cron',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
    })
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        turnTrigger: 'automation-cron',
      }),
    )
  })

  it('treats credential-like provider headers as member-auth and skips delegated Vercel billing', async () => {
    const route = createRoute({
      routeId: 'route-header-auth-gateway',
      providerOptions: {
        apiKeyEnv: null,
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        headers: {
          'X-Api-Key': 'member-secret-header',
        },
        model: 'openai/gpt-5.4',
        presetId: 'vercel-ai-gateway',
        providerName: 'vercel-ai-gateway',
      },
    })
    const session = createAssistantSession()

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-header-auth',
        response: 'Header auth answer',
      }),
    )

    await executeProviderTurnWithRecovery({
      input: createMessageInput({
        executionContext: {
          hosted: {
            memberId: 'member_123',
            stripeCustomerId: 'cus_123',
            userEnvKeys: [],
          },
        },
        prompt: 'Use the header-auth gateway route',
      }),
      plan: createTurnPlan({
        cliAccessEnv: {
          CLI_TOKEN: 'test-cli-token',
          HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: 'rk_test_123',
          HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: 'true',
        },
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-header-auth-gateway',
    })

    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        usageAttribution: expect.objectContaining({
          credentialSource: 'member',
          gatewayTags: expect.arrayContaining(['credential:member']),
          stripeCustomerId: 'cus_123',
          stripeMeterSource: 'murph',
        }),
      }),
    )
  })

  it('treats blank configured user env overrides as platform-funded gateway usage', async () => {
    const route = createRoute({
      routeId: 'route-blank-user-key-gateway',
      providerOptions: {
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        model: 'openai/gpt-5.4',
        presetId: 'vercel-ai-gateway',
        providerName: 'vercel-ai-gateway',
      },
    })
    const session = createAssistantSession()

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-blank-user-key',
        response: 'Gateway answer',
      }),
    )

    await executeProviderTurnWithRecovery({
      input: createMessageInput({
        executionContext: {
          hosted: {
            memberId: 'member_123',
            stripeCustomerId: 'cus_123',
            userEnvKeys: ['OPENAI_API_KEY'],
          },
        },
        prompt: 'Use the gateway with a blank hosted override',
      }),
      plan: createTurnPlan({
        cliAccessEnv: {
          CLI_TOKEN: 'test-cli-token',
          HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: 'rk_test_123',
          HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: 'true',
          OPENAI_API_KEY: '   ',
        },
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-blank-user-key-gateway',
    })

    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        usageAttribution: expect.objectContaining({
          credentialSource: 'platform',
          gatewayTags: expect.arrayContaining(['credential:platform']),
          stripeCustomerId: 'cus_123',
          stripeMeterSource: 'vercel-ai-gateway',
        }),
      }),
    )
  })

  it('keeps the turn moving when the vault overview helper fails', async () => {
    const route = createRoute({
      routeId: 'route-bootstrap-overview-failure',
    })
    const session = createAssistantSession()

    runnerMocks.buildAssistantVaultOverviewBlock.mockRejectedValueOnce(
      new Error('overview failed'),
    )
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-bootstrap',
        response: 'Bootstrap answer',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        channel: 'chat',
        prompt: 'What is already in here?',
      }),
      plan: createTurnPlan({
        onboardingGuidanceOpen: true,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-bootstrap-overview-failure',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
      providerTurn: {
        attemptCount: 1,
        route,
      },
    })
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultOverview: null,
      }),
    )
    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'prompt:chat:first:cli-bootstrap:no-overview',
      }),
    )
  })

  it('keeps the turn moving when active experiment context cannot be read', async () => {
    const route = createRoute({
      routeId: 'route-active-experiment-context-failure',
    })
    const session = createAssistantSession()

    runnerMocks.buildAssistantActiveExperimentContextBlock.mockRejectedValueOnce(
      new Error('active context failed'),
    )
    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createSuccessfulAttemptResult({
        providerSessionId: 'provider-session-active-context',
        response: 'Active context fallback answer',
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        channel: 'chat',
        prompt: 'What is active?',
      }),
      plan: createTurnPlan({
        allowSensitiveHealthContext: true,
        onboardingGuidanceOpen: true,
      }),
      resolvedSession: session,
      routes: [route],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-active-context-failure',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
    })
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        activeExperimentContext: null,
      }),
    )
  })

  it('records a retryable failure, starts cooldown, and fails over to the next route', async () => {
    const primaryRoute = createRoute({
      label: 'Primary',
      routeId: 'route-primary',
    })
    const backupRoute = createRoute({
      label: 'Backup',
      routeId: 'route-backup',
    })
    const session = createAssistantSession()
    const recoveredSession = createAssistantSession({
      providerSessionId: 'provider-session-recovered',
      resumeRouteId: 'route-primary',
      updatedAt: '2026-04-08T00:01:00.000Z',
    })
    const rateLimitError = createError('rate limited', 'RATE_LIMIT')

    runnerMocks.executeAssistantProviderTurnAttempt
      .mockResolvedValueOnce(
        createFailedAttemptResult({
          activityLabels: ['calendar'],
          error: rateLimitError,
          executedToolCount: 0,
        }),
      )
      .mockResolvedValueOnce(
        createSuccessfulAttemptResult({
          providerSessionId: 'provider-session-backup',
          response: 'Backup answer',
        }),
      )
    runnerMocks.recoverAssistantSessionAfterProviderFailure.mockResolvedValue(
      recoveredSession,
    )
    runnerMocks.recordAssistantFailoverRouteFailure.mockResolvedValue(
      createFailoverState({
        routeId: primaryRoute.routeId,
        cooldownUntil: '2026-04-08T00:05:00.000Z',
      }),
    )
    runnerMocks.getAssistantFailoverCooldownUntil.mockReturnValue(
      '2026-04-08T00:05:00.000Z',
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Retry this',
      }),
      plan: createTurnPlan({}),
      resolvedSession: session,
      routes: [primaryRoute, backupRoute],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-failover-retry',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
      providerTurn: {
        attemptCount: 2,
        route: backupRoute,
        session: recoveredSession,
      },
    })
    expect(runnerMocks.recoverAssistantSessionAfterProviderFailure).toHaveBeenCalledWith({
      error: rateLimitError,
      routeId: primaryRoute.routeId,
      session,
      vault: '/tmp/test-vault',
    })
    expect(runnerMocks.attachRecoveredAssistantSession).toHaveBeenCalledWith(
      rateLimitError,
      recoveredSession,
    )
    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionContext: {
          binding: recoveredSession.binding,
        },
      }),
    )
    expect(extractReceiptKinds()).toEqual([
      'provider.attempt.started',
      'provider.attempt.failed',
      'provider.cooldown.started',
      'provider.failover.applied',
      'provider.attempt.started',
      'provider.attempt.succeeded',
    ])
    expect(runnerMocks.recordAssistantDiagnosticEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'RATE_LIMIT',
        kind: 'provider.failover.applied',
        level: 'warn',
      }),
    )
  })

  it('fails over after image-view-only Codex traffic when providerActionCount stays zero', async () => {
    const primaryRoute = createRoute({
      label: 'Primary',
      routeId: 'route-primary',
    })
    const backupRoute = createRoute({
      label: 'Backup',
      routeId: 'route-backup',
    })
    const imageViewOnlyError = createError(
      'codex connection lost after image view',
      'ASSISTANT_CODEX_CONNECTION_LOST',
      {
        connectionLost: true,
        providerActionCount: 0,
        recoverableConnectionLoss: true,
        retryable: true,
      },
    )

    runnerMocks.executeAssistantProviderTurnAttempt
      .mockResolvedValueOnce(
        createFailedAttemptResult({
          error: imageViewOnlyError,
          executedToolCount: 0,
          providerActionCount: 0,
        }),
      )
      .mockResolvedValueOnce(
        createSuccessfulAttemptResult({
          providerSessionId: 'provider-session-backup',
          response: 'Backup answer after image view',
        }),
      )
    runnerMocks.recordAssistantFailoverRouteFailure.mockResolvedValue(
      createFailoverState({
        routeId: primaryRoute.routeId,
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Retry the Codex route',
      }),
      plan: createTurnPlan({}),
      resolvedSession: createAssistantSession(),
      routes: [primaryRoute, backupRoute],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-image-view-failover',
    })

    expect(outcome).toMatchObject({
      kind: 'succeeded',
      providerTurn: {
        attemptCount: 2,
        response: 'Backup answer after image view',
        route: backupRoute,
      },
    })
    expect(extractReceiptKinds()).toEqual([
      'provider.attempt.started',
      'provider.attempt.failed',
      'provider.failover.applied',
      'provider.attempt.started',
      'provider.attempt.succeeded',
    ])
  })

  it('returns a recovered session on terminal failures when bound tools already executed', async () => {
    const primaryRoute = createRoute({
      label: 'Primary',
      routeId: 'route-primary',
    })
    const backupRoute = createRoute({
      label: 'Backup',
      routeId: 'route-backup',
    })
    const recoveredSession = createAssistantSession({
      providerSessionId: 'provider-session-recovered',
      resumeRouteId: 'route-primary',
      updatedAt: '2026-04-08T00:02:00.000Z',
    })
    const toolError = createError('tool run failed', 'TOOL_FAILURE')

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createFailedAttemptResult({
        error: toolError,
        executedToolCount: 1,
        rawToolEvents: [
          {
            type: 'assistant.tool.failed',
            mode: 'apply',
            tool: 'vault.cli.run',
            input: {
              command: 'experiment update',
            },
            errorCode: 'TOOL_FAILURE',
            errorMessage: 'CLI schema rejected payload.',
          },
        ],
      }),
    )
    runnerMocks.recoverAssistantSessionAfterProviderFailure.mockResolvedValue(
      recoveredSession,
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Use the tool',
      }),
      plan: createTurnPlan({}),
      resolvedSession: createAssistantSession(),
      routes: [primaryRoute, backupRoute],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-terminal-recovery',
    })

    expect(outcome).toEqual({
      kind: 'failed_terminal',
      error: toolError,
      route: primaryRoute,
      session: recoveredSession,
    })
    expect(runnerMocks.recordAssistantFailoverRouteFailure).toHaveBeenCalledTimes(1)
    expect(extractReceiptKinds()).toEqual([
      'provider.attempt.started',
      'provider.attempt.failed',
    ])
    expect(runnerMocks.recordAssistantDiagnosticEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'provider.failover.applied',
      }),
    )
    expect(runnerMocks.appendAssistantTranscriptEntries).toHaveBeenCalledWith(
      '/tmp/test-vault',
      recoveredSession.sessionId,
      [
        expect.objectContaining({
          kind: 'error',
          text: expect.stringContaining('Tool vault.cli.run failed in apply mode'),
        }),
        expect.objectContaining({
          kind: 'error',
          text: expect.stringContaining('Provider route Primary failed'),
        }),
      ],
    )
  })

  it('returns a recovered session on terminal failures when Codex app-server actions already executed', async () => {
    const primaryRoute = createRoute({
      label: 'Primary',
      routeId: 'route-primary',
    })
    const backupRoute = createRoute({
      label: 'Backup',
      routeId: 'route-backup',
    })
    const recoveredSession = createAssistantSession({
      providerSessionId: 'provider-session-recovered',
      resumeRouteId: 'route-primary',
      updatedAt: '2026-04-08T00:03:00.000Z',
    })
    const appServerError = createError('app-server action failed', 'APP_SERVER_FAILURE')

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createFailedAttemptResult({
        error: appServerError,
        executedToolCount: 0,
        providerActionCount: 1,
      }),
    )
    runnerMocks.recoverAssistantSessionAfterProviderFailure.mockResolvedValue(
      recoveredSession,
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Use the app-server action',
      }),
      plan: createTurnPlan({}),
      resolvedSession: createAssistantSession(),
      routes: [primaryRoute, backupRoute],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-terminal-app-server-action',
    })

    expect(outcome).toEqual({
      kind: 'failed_terminal',
      error: appServerError,
      route: primaryRoute,
      session: recoveredSession,
    })
    expect(runnerMocks.recordAssistantFailoverRouteFailure).toHaveBeenCalledTimes(1)
    expect(extractReceiptKinds()).toEqual([
      'provider.attempt.started',
      'provider.attempt.failed',
    ])
    expect(runnerMocks.recordAssistantDiagnosticEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'provider.failover.applied',
      }),
    )
  })

  it('does not fail over when the provider error reports started provider work', async () => {
    const primaryRoute = createRoute({
      label: 'Primary',
      routeId: 'route-primary',
    })
    const backupRoute = createRoute({
      label: 'Backup',
      routeId: 'route-backup',
    })
    const recoveredSession = createAssistantSession({
      providerSessionId: 'provider-session-recovered',
      resumeRouteId: 'route-primary',
      updatedAt: '2026-04-08T00:04:00.000Z',
    })
    const providerWorkError = createError('provider work already started', 'UPSTREAM_FAILED', {
      providerActionCount: 1,
      retryable: true,
    })

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createFailedAttemptResult({
        error: providerWorkError,
        executedToolCount: 0,
        providerActionCount: 0,
      }),
    )
    runnerMocks.recoverAssistantSessionAfterProviderFailure.mockResolvedValue(
      recoveredSession,
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Retry the started provider route',
      }),
      plan: createTurnPlan({}),
      resolvedSession: createAssistantSession(),
      routes: [primaryRoute, backupRoute],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-provider-context-action',
    })

    expect(outcome).toEqual({
      kind: 'failed_terminal',
      error: providerWorkError,
      route: primaryRoute,
      session: recoveredSession,
    })
    expect(extractReceiptKinds()).toEqual([
      'provider.attempt.started',
      'provider.attempt.failed',
    ])
    expect(runnerMocks.recordAssistantDiagnosticEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'provider.failover.applied',
      }),
    )
  })

  it('keeps provider-native OpenAI-compatible action failures terminal instead of failing over', async () => {
    const primaryRoute = createRoute({
      label: 'Primary',
      providerOptions: {
        baseUrl: 'https://api.openai.com/v1',
        presetId: 'openai',
        providerName: 'OpenAI',
        webSearch: 'provider',
      },
      routeId: 'route-primary',
    })
    const backupRoute = createRoute({
      label: 'Backup',
      routeId: 'route-backup',
    })
    const session = createAssistantSession()
    const providerNativeActionError = createError(
      'provider-native web search failed',
      'ASSISTANT_PROVIDER_TIMEOUT',
    )

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createFailedAttemptResult({
        error: providerNativeActionError,
        executedToolCount: 0,
        providerActionCount: 1,
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Retry the provider-native search route',
      }),
      plan: createTurnPlan({}),
      resolvedSession: session,
      routes: [primaryRoute, backupRoute],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-provider-native-action-terminal',
    })

    expect(outcome).toEqual({
      kind: 'failed_terminal',
      error: providerNativeActionError,
      route: primaryRoute,
      session,
    })
    expect(runnerMocks.recordAssistantFailoverRouteFailure).toHaveBeenCalledTimes(1)
    expect(extractReceiptKinds()).toEqual([
      'provider.attempt.started',
      'provider.attempt.failed',
    ])
    expect(runnerMocks.recordAssistantDiagnosticEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'provider.failover.applied',
      }),
    )
  })

  it('fails cleanly when no provider routes are available', async () => {
    const session = createAssistantSession()

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'No routes',
      }),
      plan: createTurnPlan({}),
      resolvedSession: session,
      routes: [],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-no-routes',
    })

    expect(outcome.kind).toBe('failed_terminal')
    if (outcome.kind !== 'failed_terminal') {
      throw new Error('Expected provider turn recovery to fail terminally.')
    }
    expect(outcome.session).toBe(session)
    expect(outcome.error).toBeInstanceOf(Error)
    expect((outcome.error as Error).message).toBe(
      'Assistant provider routes were exhausted before any attempt completed.',
    )
    expect(runnerMocks.executeAssistantProviderTurnAttempt).not.toHaveBeenCalled()
  })

  it('attaches failover exhaustion context when retries consume the only unique route id', async () => {
    const duplicatePrimary = createRoute({
      label: 'Duplicate Primary',
      routeId: 'route-duplicate',
    })
    const exhaustedError = new Error('retry me')
    Object.assign(exhaustedError, {
      code: 'RATE_LIMIT',
      context: {
        requestId: 'req-123',
      },
    })

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createFailedAttemptResult({
        error: exhaustedError,
        executedToolCount: 0,
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Exhaust the duplicates',
      }),
      plan: createTurnPlan({}),
      resolvedSession: createAssistantSession(),
      routes: [duplicatePrimary, duplicatePrimary],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-failover-exhausted-object',
    })

    expect(outcome).toEqual({
      kind: 'failed_terminal',
      error: exhaustedError,
      route: duplicatePrimary,
      session: createAssistantSession(),
    })
    expect(exhaustedError).toMatchObject({
      context: {
        requestId: 'req-123',
        failoverExhausted: true,
        attemptedRouteIds: ['route-duplicate', 'route-duplicate'],
        attemptedRouteLabels: ['Duplicate Primary', 'Duplicate Primary'],
      },
    })
  })

  it('wraps non-object exhaustion failures in a terminal error', async () => {
    const duplicatePrimary = createRoute({
      label: 'Duplicate Primary',
      routeId: 'route-duplicate',
    })

    runnerMocks.executeAssistantProviderTurnAttempt.mockResolvedValue(
      createFailedAttemptResult({
        error: 'retry me',
        executedToolCount: 0,
      }),
    )

    const outcome = await executeProviderTurnWithRecovery({
      input: createMessageInput({
        prompt: 'Exhaust the duplicates',
      }),
      plan: createTurnPlan({}),
      resolvedSession: createAssistantSession(),
      routes: [duplicatePrimary, duplicatePrimary],
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnId: 'turn-failover-exhausted-primitive',
    })

    expect(outcome.kind).toBe('failed_terminal')
    if (outcome.kind !== 'failed_terminal') {
      throw new Error('Expected provider turn recovery to fail terminally.')
    }
    expect(outcome.error).toBeInstanceOf(Error)
    expect((outcome.error as Error).message).toBe(
      'Assistant provider routes were exhausted.',
    )
    expect((outcome.error as Error).cause).toBe('retry me')
  })
})

function extractReceiptKinds(): string[] {
  return runnerMocks.appendAssistantTurnReceiptEvent.mock.calls.map((call) => {
    const event = call[0]
    if (
      !event ||
      typeof event !== 'object' ||
      !('kind' in event) ||
      typeof event.kind !== 'string'
    ) {
      throw new Error('Expected receipt event kind to be present.')
    }

    return event.kind
  })
}

function createFailedAttemptResult(input: {
  activityLabels?: readonly string[]
  error: unknown
  executedToolCount: number
  providerActionCount?: number
  rawToolEvents?: readonly unknown[]
}) {
  return {
    metadata: {
      activityLabels: input.activityLabels ?? [],
      executedToolCount: input.executedToolCount,
      providerActionCount: input.providerActionCount ?? 0,
      rawToolEvents: input.rawToolEvents ?? [],
    },
    ok: false as const,
    error: input.error,
  }
}

function createSuccessfulAttemptResult(input: {
  activityLabels?: readonly string[]
  providerSessionId: string | null
  response: string
}) {
  return {
    metadata: {
      activityLabels: input.activityLabels ?? [],
      executedToolCount: 0,
      providerActionCount: 0,
      rawToolEvents: [],
    },
    ok: true as const,
    result: {
      provider: 'openai-compatible',
      providerSessionId: input.providerSessionId,
      rawEvents: [],
      response: input.response,
      stderr: '',
      stdout: '',
      usage: null,
    },
  }
}

function createFailoverState(input?: {
  cooldownUntil?: string | null
  routeId?: string
}) {
  return assistantFailoverStateSchema.parse({
    schema: 'murph.assistant-failover-state.v1',
    updatedAt: '2026-04-08T00:00:00.000Z',
    routes: input?.routeId
      ? [{
          routeId: input.routeId,
          label: input.routeId,
          provider: 'openai-compatible',
          model: 'gpt-4.1',
          failureCount: 1,
          successCount: 0,
          consecutiveFailures: 1,
          lastFailureAt: '2026-04-08T00:00:00.000Z',
          lastErrorCode: 'RATE_LIMIT',
          lastErrorMessage: 'rate limited',
          cooldownUntil: input.cooldownUntil ?? null,
        }]
      : [],
  })
}

function createError(
  message: string,
  code: string,
  context?: Record<string, unknown>,
): Error & { code: string; context?: Record<string, unknown> } {
  const error = new Error(message) as Error & {
    code: string
    context?: Record<string, unknown>
  }
  error.code = code
  if (context) {
    error.context = context
  }
  return error
}

function createMessageInput(
  overrides?: Partial<AssistantMessageInput>,
): AssistantMessageInput {
  return {
    prompt: overrides?.prompt ?? 'Hello there',
    vault: '/tmp/test-vault',
    turnTrigger: overrides?.turnTrigger,
    channel: overrides?.channel ?? null,
    executionContext: overrides?.executionContext ?? null,
    codexCommand: overrides?.codexCommand,
    userMessageContent: overrides?.userMessageContent ?? null,
    onProviderEvent: overrides?.onProviderEvent ?? null,
    onTraceEvent: overrides?.onTraceEvent,
    operatorAuthority: overrides?.operatorAuthority,
    showThinkingTraces: overrides?.showThinkingTraces ?? false,
    abortSignal: overrides?.abortSignal,
  }
}

function createTurnPlan(input: {
  allowSensitiveHealthContext?: boolean
  onboardingGuidanceOpen?: boolean
  cliAccessEnv?: Record<string, string>
  operatorAuthority?: AssistantTurnSharedPlan['operatorAuthority']
}): AssistantTurnSharedPlan {
  const allowSensitiveHealthContext =
    input.allowSensitiveHealthContext ?? false

  return {
    allowSensitiveHealthContext,
    cliAccess: {
      env: input.cliAccessEnv ?? {
        CLI_TOKEN: 'test-cli-token',
      },
      rawCommand: 'vault-cli' as const,
      setupCommand: 'murph' as const,
    },
    conversationPolicy: {
      allowSensitiveHealthContext,
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
      operatorAuthority: input.operatorAuthority ?? 'direct-operator',
    },
    onboardingGuidanceOpen: input.onboardingGuidanceOpen ?? false,
    firstContactStateDocIds: [],
    operatorAuthority: input.operatorAuthority ?? 'direct-operator',
    persistUserPromptOnFailure: false,
    requestedWorkingDirectory: '/tmp/provider-turn-runner-tests',
  }
}

function createRoute(input?: {
  label?: string
  providerOptions?: Partial<AssistantProviderSessionOptions>
  routeId?: string
}): ResolvedAssistantFailoverRoute {
  return {
    codexCommand: null,
    cooldownMs: 60_000,
    label: input?.label ?? 'Primary',
    provider: 'openai-compatible',
    providerOptions: createProviderOptions(input?.providerOptions),
    routeId: input?.routeId ?? 'route-primary',
  }
}

function createProviderOptions(
  overrides?: Partial<AssistantProviderSessionOptions>,
): AssistantProviderSessionOptions {
  return {
    provider: 'openai-compatible',
    continuityFingerprint: 'fingerprint-default',
    executionDriver: 'openai-compatible',
    model: 'gpt-4.1',
    reasoningEffort: 'high',
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
    baseUrl: 'https://api.example.test/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'murph-openai',
    resumeKind: null,
    headers: null,
    ...overrides,
  }
}

function createAssistantSession(input?: {
  providerSessionId?: string | null
  resumeRouteId?: string | null
  turnCount?: number
  updatedAt?: string
}): AssistantSession {
  const resumeState =
    input?.providerSessionId || input?.resumeRouteId
      ? {
          providerSessionId: input?.providerSessionId ?? null,
          resumeRouteId: input?.resumeRouteId ?? null,
        }
      : null

  return {
    schema: 'murph.assistant-session.v1',
    sessionId: 'session_provider_turn_runner_test',
    target: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.example.test/v1',
      headers: {
        Authorization: 'Bearer token',
      },
      model: 'gpt-4.1',
      presetId: null,
      providerName: 'murph-openai',
      reasoningEffort: 'high',
      webSearch: null,
    },
    resumeState,
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
    updatedAt: input?.updatedAt ?? '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: input?.turnCount ?? 0,
    provider: 'openai-compatible',
    providerOptions: createProviderOptions({
      headers: {
        Authorization: 'Bearer token',
      },
    }),
  }
}
