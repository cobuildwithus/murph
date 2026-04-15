import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createVersionedJsonStateEnvelope } from '@murphai/runtime-state/node'
import {
  assistantAskResultSchema,
  assistantDiagnosticsSnapshotSchema,
  assistantFailoverStateSchema,
  assistantQuarantineSummarySchema,
  assistantRuntimeBudgetSnapshotSchema,
  assistantStatusAutomationSchema,
  assistantStatusOutboxSummarySchema,
  assistantStatusResultSchema,
  assistantStatusRunLockSchema,
  assistantTurnReceiptSchema,
  parseAssistantSessionRecord,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeAssistantAskResultForReturn } from '../src/assistant/service-result.ts'
import {
  getAssistantStatus,
  getAssistantStatusLocal,
  readAssistantStatusSnapshot,
  refreshAssistantStatusSnapshot,
  refreshAssistantStatusSnapshotLocal,
} from '../src/assistant/status.ts'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const statusMocks = vi.hoisted(() => ({
  appendAssistantRuntimeEventAtPaths: vi.fn(),
  buildAssistantOutboxSummary: vi.fn(),
  ensureAssistantState: vi.fn(),
  inspectAssistantAutomationRunLock: vi.fn(),
  listRecentAssistantTurnReceipts: vi.fn(),
  listRecentAssistantTurnReceiptsForSession: vi.fn(),
  quarantineAssistantStateFile: vi.fn(),
  readAssistantDiagnosticsSnapshot: vi.fn(),
  readAssistantFailoverState: vi.fn(),
  readAssistantRuntimeBudgetStatus: vi.fn(),
  readAutomationState: vi.fn(),
  summarizeAssistantQuarantines: vi.fn(),
  withAssistantRuntimeWriteLock: vi.fn(),
  writeJsonFileAtomic: vi.fn(),
}))

vi.mock('../src/assistant/outbox.ts', () => ({
  buildAssistantOutboxSummary: statusMocks.buildAssistantOutboxSummary,
}))

vi.mock('../src/assistant/diagnostics.ts', () => ({
  readAssistantDiagnosticsSnapshot: statusMocks.readAssistantDiagnosticsSnapshot,
}))

vi.mock('../src/assistant/failover.ts', () => ({
  readAssistantFailoverState: statusMocks.readAssistantFailoverState,
}))

vi.mock('../src/assistant/automation/runtime-lock.ts', () => ({
  inspectAssistantAutomationRunLock: statusMocks.inspectAssistantAutomationRunLock,
}))

vi.mock('../src/assistant/quarantine.ts', () => ({
  quarantineAssistantStateFile: statusMocks.quarantineAssistantStateFile,
  summarizeAssistantQuarantines: statusMocks.summarizeAssistantQuarantines,
}))

vi.mock('../src/assistant/runtime-budgets.ts', () => ({
  readAssistantRuntimeBudgetStatus: statusMocks.readAssistantRuntimeBudgetStatus,
}))

vi.mock('../src/assistant/runtime-events.ts', () => ({
  appendAssistantRuntimeEventAtPaths: statusMocks.appendAssistantRuntimeEventAtPaths,
}))

vi.mock('../src/assistant/runtime-write-lock.ts', () => ({
  withAssistantRuntimeWriteLock: statusMocks.withAssistantRuntimeWriteLock,
}))

vi.mock('../src/assistant/store/persistence.ts', () => ({
  ensureAssistantState: statusMocks.ensureAssistantState,
  readAutomationState: statusMocks.readAutomationState,
}))

vi.mock('../src/assistant/turns.ts', () => ({
  listRecentAssistantTurnReceipts: statusMocks.listRecentAssistantTurnReceipts,
  listRecentAssistantTurnReceiptsForSession:
    statusMocks.listRecentAssistantTurnReceiptsForSession,
}))

vi.mock('../src/assistant/shared.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/shared.ts')>(
    '../src/assistant/shared.ts',
  )
  return {
    ...actual,
    writeJsonFileAtomic: statusMocks.writeJsonFileAtomic,
  }
})

const tempRoots: string[] = []

beforeEach(() => {
  statusMocks.readAutomationState.mockReset().mockResolvedValue(
    assistantStatusAutomationSchema.parse({
      inboxScanCursor: null,
      autoReply: [],
      updatedAt: '2026-04-08T00:00:00.000Z',
    }),
  )
  statusMocks.inspectAssistantAutomationRunLock.mockReset().mockResolvedValue(
    assistantStatusRunLockSchema.parse({
      state: 'unlocked',
      pid: null,
      startedAt: null,
      mode: null,
      command: null,
      reason: null,
    }),
  )
  statusMocks.buildAssistantOutboxSummary.mockReset().mockResolvedValue(
    assistantStatusOutboxSummarySchema.parse({
      total: 0,
      pending: 0,
      sending: 0,
      retryable: 0,
      sent: 0,
      failed: 0,
      abandoned: 0,
      oldestPendingAt: null,
      nextAttemptAt: null,
    }),
  )
  statusMocks.readAssistantDiagnosticsSnapshot.mockReset().mockResolvedValue(
    assistantDiagnosticsSnapshotSchema.parse({
      schema: 'murph.assistant-diagnostics.v1',
      updatedAt: '2026-04-08T00:00:00.000Z',
      lastEventAt: null,
      lastErrorAt: null,
      counters: {
        turnsStarted: 0,
        turnsCompleted: 0,
        turnsDeferred: 0,
        turnsFailed: 0,
        providerAttempts: 0,
        providerFailures: 0,
        providerFailovers: 0,
        deliveriesQueued: 0,
        deliveriesSent: 0,
        deliveriesFailed: 0,
        deliveriesRetryable: 0,
        outboxDrains: 0,
        outboxRetries: 0,
        automationScans: 0,
      },
      recentWarnings: [],
    }),
  )
  statusMocks.readAssistantFailoverState.mockReset().mockResolvedValue(
    assistantFailoverStateSchema.parse({
      schema: 'murph.assistant-failover-state.v1',
      updatedAt: '2026-04-08T00:00:00.000Z',
      routes: [],
    }),
  )
  statusMocks.readAssistantRuntimeBudgetStatus.mockReset().mockResolvedValue(
    assistantRuntimeBudgetSnapshotSchema.parse({
      schema: 'murph.assistant-runtime-budget.v1',
      updatedAt: '2026-04-08T00:00:00.000Z',
      caches: [],
      maintenance: {
        lastRunAt: null,
        staleQuarantinePruned: 0,
        staleLocksCleared: 0,
        notes: [],
      },
    }),
  )
  statusMocks.listRecentAssistantTurnReceipts.mockReset().mockResolvedValue([])
  statusMocks.listRecentAssistantTurnReceiptsForSession.mockReset().mockResolvedValue([])
  statusMocks.summarizeAssistantQuarantines.mockReset().mockResolvedValue(
    assistantQuarantineSummarySchema.parse({
      total: 0,
      byKind: {},
      recent: [],
    }),
  )
  statusMocks.quarantineAssistantStateFile.mockReset().mockResolvedValue(null)
  statusMocks.ensureAssistantState.mockReset().mockResolvedValue(undefined)
  statusMocks.writeJsonFileAtomic.mockReset().mockResolvedValue(undefined)
  statusMocks.appendAssistantRuntimeEventAtPaths.mockReset().mockResolvedValue(undefined)
  statusMocks.withAssistantRuntimeWriteLock
    .mockReset()
    .mockImplementation(async (vault: string, action: (paths: AssistantStatePaths) => unknown) =>
      await action(resolveAssistantStatePaths(vault)),
    )
  vi.useRealTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant status', () => {
  it('builds warning output and uses the session-scoped receipt reader with a clamped limit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T09:10:11.000Z'))

    const { parentRoot, vaultRoot } = await createTempVaultContext('assistant-status-')
    tempRoots.push(parentRoot)
    const paths = resolveAssistantStatePaths(vaultRoot)
    const diagnosticsWarnings = [
      'diagnostic-1',
      'diagnostic-2',
      'diagnostic-3',
      'diagnostic-4',
      'diagnostic-5',
      'diagnostic-6',
      'diagnostic-7',
      'diagnostic-8',
      'diagnostic-9',
    ]

    statusMocks.inspectAssistantAutomationRunLock.mockResolvedValue(
      assistantStatusRunLockSchema.parse({
        state: 'stale',
        pid: 42,
        startedAt: '2026-04-08T08:00:00.000Z',
        mode: 'continuous',
        command: 'murph assistant run',
        reason: 'heartbeat expired',
      }),
    )
    statusMocks.buildAssistantOutboxSummary.mockResolvedValue(
      assistantStatusOutboxSummarySchema.parse({
        total: 4,
        pending: 0,
        sending: 0,
        retryable: 2,
        sent: 0,
        failed: 1,
        abandoned: 1,
        oldestPendingAt: null,
        nextAttemptAt: '2026-04-08T09:11:00.000Z',
      }),
    )
    statusMocks.readAssistantDiagnosticsSnapshot.mockResolvedValue(
      assistantDiagnosticsSnapshotSchema.parse({
        schema: 'murph.assistant-diagnostics.v1',
        updatedAt: '2026-04-08T09:00:00.000Z',
        lastEventAt: '2026-04-08T09:05:00.000Z',
        lastErrorAt: '2026-04-08T09:06:00.000Z',
        counters: {
          turnsStarted: 1,
          turnsCompleted: 1,
          turnsDeferred: 0,
          turnsFailed: 1,
          providerAttempts: 2,
          providerFailures: 1,
          providerFailovers: 1,
          deliveriesQueued: 1,
          deliveriesSent: 0,
          deliveriesFailed: 1,
          deliveriesRetryable: 1,
          outboxDrains: 1,
          outboxRetries: 1,
          automationScans: 3,
        },
        recentWarnings: diagnosticsWarnings,
      }),
    )
    statusMocks.readAssistantFailoverState.mockResolvedValue(
      assistantFailoverStateSchema.parse({
        schema: 'murph.assistant-failover-state.v1',
        updatedAt: '2026-04-08T09:00:00.000Z',
        routes: [
          {
            routeId: 'route-openai',
            label: 'OpenAI',
            provider: 'openai-compatible',
            model: 'gpt-5.4',
            failureCount: 1,
            successCount: 0,
            consecutiveFailures: 1,
            lastFailureAt: '2026-04-08T09:01:00.000Z',
            lastErrorCode: 'RATE_LIMIT',
            lastErrorMessage: 'rate limited',
            cooldownUntil: '2026-04-08T09:30:00.000Z',
          },
          {
            routeId: 'route-codex',
            label: 'Codex',
            provider: 'codex-cli',
            model: 'gpt-5.4',
            failureCount: 0,
            successCount: 1,
            consecutiveFailures: 0,
            lastFailureAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            cooldownUntil: null,
          },
        ],
      }),
    )
    statusMocks.summarizeAssistantQuarantines.mockResolvedValue(
      assistantQuarantineSummarySchema.parse({
        total: 3,
        byKind: {
          status: 1,
          'turn-receipt': 2,
        },
        recent: [],
      }),
    )
    statusMocks.listRecentAssistantTurnReceiptsForSession.mockResolvedValue([
      assistantTurnReceiptSchema.parse({
        schema: 'murph.assistant-turn-receipt.v1',
        turnId: 'turn-1',
        sessionId: 'session-123',
        provider: 'openai-compatible',
        providerModel: 'gpt-5.4',
        promptPreview: 'hi',
        responsePreview: 'hello',
        status: 'completed',
        deliveryRequested: false,
        deliveryDisposition: 'not-requested',
        deliveryIntentId: null,
        startedAt: '2026-04-08T09:00:00.000Z',
        updatedAt: '2026-04-08T09:00:30.000Z',
        completedAt: '2026-04-08T09:00:30.000Z',
        lastError: null,
        timeline: [],
      }),
    ])

    const status = await getAssistantStatusLocal({
      vault: vaultRoot,
      sessionId: '  session-123  ',
      limit: 200.8,
    })

    const expectedWarnings = [
      ...diagnosticsWarnings,
      'assistant automation lock is stale: heartbeat expired',
      '1 assistant outbox intent(s) failed permanently',
      '2 assistant outbox intent(s) are waiting for retry',
      '3 assistant runtime artifact(s) were quarantined for repair',
      '1 provider failover route(s) are cooling down',
    ].slice(-12)

    expect(status.vault).toBe(paths.absoluteVaultRoot)
    expect(status.generatedAt).toBe('2026-04-08T09:10:11.000Z')
    expect(status.warnings).toEqual(expectedWarnings)
    expect(status.recentTurns).toHaveLength(1)
    expect(statusMocks.listRecentAssistantTurnReceiptsForSession).toHaveBeenCalledWith(
      vaultRoot,
      'session-123',
      50,
    )
    expect(statusMocks.listRecentAssistantTurnReceipts).not.toHaveBeenCalled()
  })

  it('falls back to the unscoped receipt reader and default turn limit', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext('assistant-status-default-')
    tempRoots.push(parentRoot)

    await getAssistantStatus(vaultRoot)
    await getAssistantStatusLocal({
      vault: vaultRoot,
      sessionId: '   ',
      limit: Number.NaN,
    })

    expect(statusMocks.listRecentAssistantTurnReceipts).toHaveBeenNthCalledWith(
      1,
      vaultRoot,
      10,
    )
    expect(statusMocks.listRecentAssistantTurnReceipts).toHaveBeenNthCalledWith(
      2,
      vaultRoot,
      10,
    )
    expect(statusMocks.listRecentAssistantTurnReceiptsForSession).not.toHaveBeenCalled()
  })

  it('refreshes the snapshot under the write lock and swallows runtime-event append failures', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T13:14:15.000Z'))

    const { parentRoot, vaultRoot } = await createTempVaultContext('assistant-status-refresh-')
    tempRoots.push(parentRoot)
    const paths = resolveAssistantStatePaths(vaultRoot)

    statusMocks.buildAssistantOutboxSummary.mockResolvedValue(
      assistantStatusOutboxSummarySchema.parse({
        total: 2,
        pending: 1,
        sending: 0,
        retryable: 0,
        sent: 1,
        failed: 0,
        abandoned: 0,
        oldestPendingAt: '2026-04-08T13:00:00.000Z',
        nextAttemptAt: '2026-04-08T13:20:00.000Z',
      }),
    )
    statusMocks.readAssistantDiagnosticsSnapshot.mockResolvedValue(
      assistantDiagnosticsSnapshotSchema.parse({
        schema: 'murph.assistant-diagnostics.v1',
        updatedAt: '2026-04-08T13:00:00.000Z',
        lastEventAt: '2026-04-08T13:01:00.000Z',
        lastErrorAt: null,
        counters: {
          turnsStarted: 2,
          turnsCompleted: 2,
          turnsDeferred: 0,
          turnsFailed: 0,
          providerAttempts: 2,
          providerFailures: 0,
          providerFailovers: 0,
          deliveriesQueued: 1,
          deliveriesSent: 1,
          deliveriesFailed: 0,
          deliveriesRetryable: 0,
          outboxDrains: 1,
          outboxRetries: 0,
          automationScans: 2,
        },
        recentWarnings: ['diagnostic warning'],
      }),
    )
    statusMocks.summarizeAssistantQuarantines.mockResolvedValue(
      assistantQuarantineSummarySchema.parse({
        total: 2,
        byKind: {
          status: 2,
        },
        recent: [],
      }),
    )
    statusMocks.appendAssistantRuntimeEventAtPaths.mockRejectedValue(
      new Error('runtime event write failed'),
    )

    const status = await refreshAssistantStatusSnapshot(vaultRoot)

    expect(statusMocks.withAssistantRuntimeWriteLock).toHaveBeenCalledWith(
      vaultRoot,
      expect.any(Function),
    )
    expect(statusMocks.writeJsonFileAtomic).toHaveBeenCalledWith(
      paths.statusPath,
      createVersionedJsonStateEnvelope({
        schema: 'murph.assistant-status-snapshot.v1',
        schemaVersion: 1,
        value: status,
      }),
    )
    expect(statusMocks.appendAssistantRuntimeEventAtPaths).toHaveBeenCalledWith(paths, {
      at: '2026-04-08T13:14:15.000Z',
      component: 'status',
      entityId: 'assistant-status',
      entityType: 'status-snapshot',
      kind: 'status.snapshot.refreshed',
      level: 'info',
      message: 'Assistant status snapshot was refreshed.',
      data: {
        warningCount: 2,
        quarantineCount: 2,
      },
    })
    await expect(refreshAssistantStatusSnapshotLocal(vaultRoot)).resolves.toMatchObject({
      generatedAt: '2026-04-08T13:14:15.000Z',
    })
  })

  it('reads stored snapshots from disk and returns null when the snapshot is missing', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext('assistant-status-read-')
    tempRoots.push(parentRoot)
    const paths = resolveAssistantStatePaths(vaultRoot)
    const snapshot = makeStatusSnapshot(paths)

    await mkdir(path.dirname(paths.statusPath), {
      recursive: true,
    })
    await writeFile(
      paths.statusPath,
      JSON.stringify(
        createVersionedJsonStateEnvelope({
          schema: 'murph.assistant-status-snapshot.v1',
          schemaVersion: 1,
          value: snapshot,
        }),
      ),
      'utf8',
    )

    await expect(readAssistantStatusSnapshot(vaultRoot)).resolves.toEqual(snapshot)

    const { parentRoot: missingParentRoot, vaultRoot: missingVaultRoot } =
      await createTempVaultContext('assistant-status-missing-')
    tempRoots.push(missingParentRoot)

    await expect(readAssistantStatusSnapshot(missingVaultRoot)).resolves.toBeNull()
    expect(statusMocks.quarantineAssistantStateFile).not.toHaveBeenCalled()
  })

  it('quarantines corrupt snapshots and returns null', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext('assistant-status-corrupt-')
    tempRoots.push(parentRoot)
    const paths = resolveAssistantStatePaths(vaultRoot)

    await mkdir(path.dirname(paths.statusPath), {
      recursive: true,
    })
    await writeFile(paths.statusPath, '{"schema":"broken"', 'utf8')

    await expect(readAssistantStatusSnapshot(vaultRoot)).resolves.toBeNull()
    expect(statusMocks.quarantineAssistantStateFile).toHaveBeenCalledTimes(1)
    expect(statusMocks.quarantineAssistantStateFile).toHaveBeenCalledWith({
      artifactKind: 'status',
      error: expect.any(SyntaxError),
      filePath: paths.statusPath,
      paths,
    })
  })
})

describe('assistant service-result seam', () => {
  it('normalizes ask results for return by redacting session secrets', () => {
    const result = normalizeAssistantAskResultForReturn({
      vault: '/tmp/assistant-vault',
      status: 'completed',
      prompt: 'Hello',
      response: 'Hi there',
      session: parseAssistantSessionRecord({
        schema: 'murph.assistant-session.v1',
        sessionId: 'session-service-result',
        target: {
          adapter: 'openai-compatible',
          apiKeyEnv: 'OPENAI_API_KEY',
          endpoint: 'https://api.example.com/v1',
          headers: {
            Authorization: 'Bearer target-secret',
            'X-Trace': 'trace-target',
          },
          model: 'gpt-5.4',
          providerName: 'murph-openai',
          reasoningEffort: 'medium',
        },
        resumeState: {
          providerSessionId: 'provider-session-1',
          resumeRouteId: 'route-1',
        },
        alias: 'service-result',
        binding: {
          conversationKey: null,
          actorId: null,
          channel: 'telegram',
          delivery: null,
          identityId: null,
          threadId: 'thread-1',
          threadIsDirect: true,
        },
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
        lastTurnAt: null,
        turnCount: 1,
      }),
      delivery: null,
      deliveryDeferred: false,
      deliveryIntentId: null,
      deliveryError: null,
    })

    expect(assistantAskResultSchema.parse(result)).toEqual(result)
    expect(result.session.target).toMatchObject({
      adapter: 'openai-compatible',
      headers: {
        Authorization: '[REDACTED]',
        'X-Trace': 'trace-target',
      },
    })
    expect(result.session.providerOptions.headers).toEqual({
      Authorization: '[REDACTED]',
      'X-Trace': 'trace-target',
    })
    expect(result.session.providerBinding?.providerOptions.headers).toEqual({
      Authorization: '[REDACTED]',
      'X-Trace': 'trace-target',
    })
  })
})

function makeStatusSnapshot(paths: AssistantStatePaths) {
  return assistantStatusResultSchema.parse({
    vault: paths.absoluteVaultRoot,
    stateRoot: paths.assistantStateRoot,
    statusPath: paths.statusPath,
    outboxRoot: paths.outboxDirectory,
    diagnosticsPath: paths.diagnosticSnapshotPath,
    failoverStatePath: paths.failoverStatePath,
    turnsRoot: paths.turnsDirectory,
    generatedAt: '2026-04-08T06:07:08.000Z',
    runLock: assistantStatusRunLockSchema.parse({
      state: 'active',
      pid: 123,
      startedAt: '2026-04-08T06:00:00.000Z',
      mode: 'continuous',
      command: 'murph assistant run',
      reason: null,
    }),
    automation: assistantStatusAutomationSchema.parse({
      inboxScanCursor: null,
      autoReply: [
        {
          channel: 'telegram',
          cursor: null,
        },
      ],
      updatedAt: '2026-04-08T06:00:00.000Z',
    }),
    outbox: assistantStatusOutboxSummarySchema.parse({
      total: 1,
      pending: 1,
      sending: 0,
      retryable: 0,
      sent: 0,
      failed: 0,
      abandoned: 0,
      oldestPendingAt: '2026-04-08T06:01:00.000Z',
      nextAttemptAt: '2026-04-08T06:02:00.000Z',
    }),
    diagnostics: assistantDiagnosticsSnapshotSchema.parse({
      schema: 'murph.assistant-diagnostics.v1',
      updatedAt: '2026-04-08T06:00:00.000Z',
      lastEventAt: '2026-04-08T06:01:00.000Z',
      lastErrorAt: null,
      counters: {
        turnsStarted: 1,
        turnsCompleted: 1,
        turnsDeferred: 0,
        turnsFailed: 0,
        providerAttempts: 1,
        providerFailures: 0,
        providerFailovers: 0,
        deliveriesQueued: 1,
        deliveriesSent: 0,
        deliveriesFailed: 0,
        deliveriesRetryable: 0,
        outboxDrains: 1,
        outboxRetries: 0,
        automationScans: 1,
      },
      recentWarnings: ['stored warning'],
    }),
    failover: assistantFailoverStateSchema.parse({
      schema: 'murph.assistant-failover-state.v1',
      updatedAt: '2026-04-08T06:00:00.000Z',
      routes: [],
    }),
    quarantine: assistantQuarantineSummarySchema.parse({
      total: 0,
      byKind: {},
      recent: [],
    }),
    runtimeBudget: assistantRuntimeBudgetSnapshotSchema.parse({
      schema: 'murph.assistant-runtime-budget.v1',
      updatedAt: '2026-04-08T06:00:00.000Z',
      caches: [],
      maintenance: {
        lastRunAt: null,
        staleQuarantinePruned: 0,
        staleLocksCleared: 0,
        notes: [],
      },
    }),
    recentTurns: [
      assistantTurnReceiptSchema.parse({
        schema: 'murph.assistant-turn-receipt.v1',
        turnId: 'turn-stored',
        sessionId: 'session-stored',
        provider: 'openai-compatible',
        providerModel: 'gpt-5.4',
        promptPreview: 'stored prompt',
        responsePreview: 'stored response',
        status: 'completed',
        deliveryRequested: false,
        deliveryDisposition: 'not-requested',
        deliveryIntentId: null,
        startedAt: '2026-04-08T06:00:00.000Z',
        updatedAt: '2026-04-08T06:00:01.000Z',
        completedAt: '2026-04-08T06:00:01.000Z',
        lastError: null,
        timeline: [],
      }),
    ],
    warnings: ['stored warning'],
  })
}
