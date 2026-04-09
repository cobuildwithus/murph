import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assistantFailoverStateSchema,
  type AssistantProviderSessionOptions,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantMessageInput } from '../src/assistant/service-contracts.ts'
import type { ResolvedAssistantFailoverRoute } from '../src/assistant/failover.ts'

const runnerMocks = vi.hoisted(() => ({
  appendAssistantTurnReceiptEvent: vi.fn(),
  attachRecoveredAssistantSession: vi.fn(),
  buildAssistantSystemPrompt: vi.fn(),
  buildAssistantVaultOverviewBlock: vi.fn(),
  createAssistantFoodAutoLogHooks: vi.fn(),
  createAssistantMemoryTurnContextEnv: vi.fn(),
  createIntegratedVaultServices: vi.fn(),
  createProviderTurnAssistantToolCatalog: vi.fn(),
  errorMessage: vi.fn(),
  executeAssistantProviderTurnAttempt: vi.fn(),
  getAssistantFailoverCooldownUntil: vi.fn(),
  isAssistantFailoverRouteCoolingDown: vi.fn(),
  loadVault: vi.fn(),
  listAssistantTranscriptEntries: vi.fn(),
  maybeThrowInjectedAssistantFault: vi.fn(),
  normalizeAssistantExecutionContext: vi.fn(),
  readAssistantFailoverState: vi.fn(),
  readAssistantProviderBinding: vi.fn(),
  recordAssistantDiagnosticEvent: vi.fn(),
  recordAssistantFailoverRouteFailure: vi.fn(),
  recordAssistantFailoverRouteSuccess: vi.fn(),
  recoverAssistantSessionAfterProviderFailure: vi.fn(),
  resolveAssistantCliAccessContext: vi.fn(),
  resolveAssistantCliSurfaceBootstrapContext: vi.fn(),
  resolveAssistantProviderExecutionCapabilities: vi.fn(),
  resolveAssistantProviderResumeKey: vi.fn(),
  resolveAssistantRouteResumeBinding: vi.fn(),
  shouldAttemptAssistantProviderFailover: vi.fn(),
}))

vi.mock('../src/assistant-cli-access.ts', () => ({
  resolveAssistantCliAccessContext: runnerMocks.resolveAssistantCliAccessContext,
}))

vi.mock('../src/assistant-cli-tools.ts', () => ({
  createProviderTurnAssistantToolCatalog:
    runnerMocks.createProviderTurnAssistantToolCatalog,
}))

vi.mock('@murphai/core', () => ({
  loadVault: runnerMocks.loadVault,
}))

vi.mock('../src/assistant-provider.ts', () => ({
  executeAssistantProviderTurnAttempt:
    runnerMocks.executeAssistantProviderTurnAttempt,
  resolveAssistantProviderExecutionCapabilities:
    runnerMocks.resolveAssistantProviderExecutionCapabilities,
}))

vi.mock('../src/assistant/diagnostics.ts', () => ({
  recordAssistantDiagnosticEvent: runnerMocks.recordAssistantDiagnosticEvent,
}))

vi.mock('../src/assistant/execution-context.ts', () => ({
  normalizeAssistantExecutionContext: runnerMocks.normalizeAssistantExecutionContext,
}))

vi.mock('../src/assistant/system-prompt.ts', () => ({
  buildAssistantSystemPrompt: runnerMocks.buildAssistantSystemPrompt,
}))

vi.mock('../src/assistant/vault-overview.ts', () => ({
  buildAssistantVaultOverviewBlock: runnerMocks.buildAssistantVaultOverviewBlock,
}))

vi.mock('../src/assistant/shared.ts', () => ({
  errorMessage: runnerMocks.errorMessage,
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

vi.mock('../src/assistant/provider-state.ts', () => ({
  readAssistantProviderBinding: runnerMocks.readAssistantProviderBinding,
}))

vi.mock('../src/assistant/provider-binding.ts', () => ({
  resolveAssistantProviderResumeKey:
    runnerMocks.resolveAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding:
    runnerMocks.resolveAssistantRouteResumeBinding,
}))

vi.mock('../src/assistant/store.ts', () => ({
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
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T14:30:00.000Z'))
    runnerMocks.appendAssistantTurnReceiptEvent.mockReset().mockResolvedValue(undefined)
    runnerMocks.attachRecoveredAssistantSession.mockReset()
    runnerMocks.buildAssistantSystemPrompt
      .mockReset()
      .mockImplementation((input: {
        channel: string | null
        firstTurnCheckIn: boolean
        assistantCliContract: string | null
        vaultOverview?: string | null
      }) =>
        `prompt:${input.channel ?? 'none'}:${input.firstTurnCheckIn ? 'first' : 'later'}:${input.assistantCliContract ?? 'no-bootstrap'}:${input.vaultOverview ?? 'no-overview'}`,
      )
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
    runnerMocks.createProviderTurnAssistantToolCatalog
      .mockReset()
      .mockReturnValue(toolCatalog)
    runnerMocks.errorMessage
      .mockReset()
      .mockImplementation((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      )
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
    runnerMocks.readAssistantProviderBinding
      .mockReset()
      .mockImplementation((session: AssistantSession | null | undefined) =>
        session?.providerBinding ?? null,
      )
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
    runnerMocks.resolveAssistantProviderExecutionCapabilities
      .mockReset()
      .mockReturnValue({
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
        firstTurnCheckInEligible: true,
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
        firstTurnCheckInInjected: true,
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
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantCliContract: 'cli-bootstrap',
        assistantCliExecutorAvailable: true,
        assistantCronToolsAvailable: true,
        assistantHostedDeviceConnectAvailable: true,
        assistantKnowledgeToolsAvailable: true,
        channel: 'chat',
        currentLocalDate: '2026-04-08',
        currentTimeZone: 'America/Los_Angeles',
        firstTurnCheckIn: true,
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

  it('reuses the native provider session when the active route can resume without bootstrap context', async () => {
    const session = createAssistantSession({
      providerSessionId: 'provider-session-primary',
      resumeRouteId: 'route-primary',
      turnCount: 3,
    })
    const route = createRoute({
      routeId: 'route-primary',
    })

    runnerMocks.resolveAssistantProviderExecutionCapabilities.mockReturnValue({
      supportsNativeResume: true,
      supportsToolRuntime: false,
    })
    runnerMocks.resolveAssistantRouteResumeBinding.mockReturnValue(
      session.providerBinding,
    )
    runnerMocks.resolveAssistantProviderResumeKey.mockReturnValue(
      'provider-session-primary',
    )
    toolCatalog.hasTool.mockReturnValue(false)
    runnerMocks.listAssistantTranscriptEntries.mockResolvedValue([
      {
        kind: 'assistant',
        text: 'Prior answer',
      },
      {
        kind: 'user',
        text: 'Different prompt',
      },
    ])
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
        firstTurnCheckInEligible: true,
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
        firstTurnCheckInInjected: false,
      },
    })
    expect(runnerMocks.resolveAssistantCliSurfaceBootstrapContext).not.toHaveBeenCalled()
    expect(runnerMocks.loadVault).toHaveBeenCalledWith({
      vaultRoot: '/tmp/test-vault',
    })
    expect(runnerMocks.buildAssistantSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantCliContract: null,
        assistantCliExecutorAvailable: false,
        assistantCronToolsAvailable: false,
        assistantHostedDeviceConnectAvailable: false,
        assistantKnowledgeToolsAvailable: false,
        currentLocalDate: '2026-04-08',
        currentTimeZone: 'America/Los_Angeles',
        firstTurnCheckIn: false,
        vaultOverview: null,
      }),
    )
    expect(runnerMocks.buildAssistantVaultOverviewBlock).not.toHaveBeenCalled()
    expect(toolCatalog.hasTool).not.toHaveBeenCalled()
    expect(runnerMocks.executeAssistantProviderTurnAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationMessages: [
          {
            content: 'Prior answer',
            role: 'assistant',
          },
          {
            content: 'Different prompt',
            role: 'user',
          },
        ],
        resumeProviderSessionId: 'provider-session-primary',
        sessionContext: undefined,
        systemPrompt: 'prompt:none:later:no-bootstrap:no-overview',
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
        firstTurnCheckInEligible: true,
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
    expect(outcome.error).toBeInstanceOf(Error)
    expect((outcome.error as Error).message).toBe(
      'Assistant provider routes were exhausted.',
    )
    expect((outcome.error as Error).cause).toBe('retry me')
  })
})

function extractReceiptKinds(): string[] {
  return runnerMocks.appendAssistantTurnReceiptEvent.mock.calls.map(
    ([event]: [{ kind: string }]) => event.kind,
  )
}

function createFailedAttemptResult(input: {
  activityLabels?: readonly string[]
  error: unknown
  executedToolCount: number
}) {
  return {
    metadata: {
      activityLabels: input.activityLabels ?? [],
      executedToolCount: input.executedToolCount,
      rawToolEvents: [],
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

function createError(message: string, code: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

function createMessageInput(
  overrides?: Partial<AssistantMessageInput>,
): AssistantMessageInput {
  return {
    prompt: overrides?.prompt ?? 'Hello there',
    vault: '/tmp/test-vault',
    channel: overrides?.channel ?? null,
    executionContext: overrides?.executionContext ?? null,
    codexCommand: overrides?.codexCommand,
    userMessageContent: overrides?.userMessageContent ?? null,
    onProviderEvent: overrides?.onProviderEvent ?? null,
    onTraceEvent: overrides?.onTraceEvent,
    showThinkingTraces: overrides?.showThinkingTraces ?? false,
    abortSignal: overrides?.abortSignal,
  }
}

function createTurnPlan(input: {
  allowSensitiveHealthContext?: boolean
  firstTurnCheckInEligible?: boolean
}) {
  return {
    allowSensitiveHealthContext: input.allowSensitiveHealthContext ?? false,
    cliAccess: {
      env: {
        CLI_TOKEN: 'test-cli-token',
      },
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    firstTurnCheckInEligible: input.firstTurnCheckInEligible ?? false,
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
    model: 'gpt-4.1',
    reasoningEffort: 'high',
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
    baseUrl: 'https://api.example.test/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'murph-openai',
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
    schema: 'murph.assistant-session.v4',
    sessionId: 'session_provider_turn_runner_test',
    target: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      endpoint: 'https://api.example.test/v1',
      headers: {
        Authorization: 'Bearer token',
      },
      model: 'gpt-4.1',
      providerName: 'murph-openai',
      reasoningEffort: 'high',
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
    providerBinding: resumeState
      ? {
          provider: 'openai-compatible',
          providerOptions: createProviderOptions({
            headers: {
              Authorization: 'Bearer token',
            },
          }),
          providerSessionId: resumeState.providerSessionId,
          providerState: resumeState.resumeRouteId
            ? {
                resumeRouteId: resumeState.resumeRouteId,
              }
            : null,
        }
      : null,
  }
}
