import { mkdir, rm, writeFile } from 'node:fs/promises'

import {
  parseAssistantSessionRecord,
  type AssistantAutomationState,
  type AssistantModelTarget,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertAssistantStateDocumentId,
  buildDefaultAssistantCronStateDocId,
  resolveAssistantStateDocumentPath,
} from '../src/assistant/state.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { resolveAssistantTranscriptPath } from '../src/assistant/store/persistence.ts'
import { createTempVaultContext } from './test-helpers.ts'

const runtimeStateMocks = vi.hoisted(() => ({
  appendAssistantTranscriptEntries: vi.fn(),
  getAssistantSession: vi.fn(),
  listAssistantSessions: vi.fn(),
  listAssistantTranscriptEntries: vi.fn(),
  resolveAssistantSession: vi.fn(),
  restoreAssistantSessionSnapshot: vi.fn(),
  saveAssistantSession: vi.fn(),
}))

const turnReceiptMocks = vi.hoisted(() => ({
  appendAssistantTurnReceiptEvent: vi.fn(),
  createAssistantTurnReceipt: vi.fn(),
  finalizeAssistantTurnReceipt: vi.fn(),
  readAssistantTurnReceipt: vi.fn(),
  updateAssistantTurnReceipt: vi.fn(),
}))

const outboxMocks = vi.hoisted(() => ({
  createAssistantOutboxIntent: vi.fn(),
  deliverAssistantOutboxMessage: vi.fn(),
  dispatchAssistantOutboxIntent: vi.fn(),
  listAssistantOutboxIntents: vi.fn(),
  readAssistantOutboxIntent: vi.fn(),
  saveAssistantOutboxIntent: vi.fn(),
}))

const statusMocks = vi.hoisted(() => ({
  getAssistantStatus: vi.fn(),
  readAssistantStatusSnapshot: vi.fn(),
  refreshAssistantStatusSnapshot: vi.fn(),
}))

const diagnosticsMocks = vi.hoisted(() => ({
  readAssistantDiagnosticsSnapshot: vi.fn(),
  recordAssistantDiagnosticEvent: vi.fn(),
}))

const turnPlanMocks = vi.hoisted(() => ({
  hasAssistantSeenFirstContact: vi.fn(),
  resolveAssistantCliAccessContext: vi.fn(),
  resolveAssistantConversationPolicy: vi.fn(),
  resolveAssistantFirstContactStateDocIds: vi.fn(),
  resolveAssistantOperatorAuthority: vi.fn(),
}))

vi.mock('../src/assistant/store.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
    '../src/assistant/store.ts',
  )

  return {
    ...actual,
    appendAssistantTranscriptEntries: runtimeStateMocks.appendAssistantTranscriptEntries,
    getAssistantSession: runtimeStateMocks.getAssistantSession,
    listAssistantSessions: runtimeStateMocks.listAssistantSessions,
    listAssistantTranscriptEntries: runtimeStateMocks.listAssistantTranscriptEntries,
    resolveAssistantSession: runtimeStateMocks.resolveAssistantSession,
    restoreAssistantSessionSnapshot: runtimeStateMocks.restoreAssistantSessionSnapshot,
    saveAssistantSession: runtimeStateMocks.saveAssistantSession,
  }
})

vi.mock('../src/assistant/turns.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/turns.ts')>(
    '../src/assistant/turns.ts',
  )

  return {
    ...actual,
    appendAssistantTurnReceiptEvent: turnReceiptMocks.appendAssistantTurnReceiptEvent,
    createAssistantTurnReceipt: turnReceiptMocks.createAssistantTurnReceipt,
    finalizeAssistantTurnReceipt: turnReceiptMocks.finalizeAssistantTurnReceipt,
    readAssistantTurnReceipt: turnReceiptMocks.readAssistantTurnReceipt,
    updateAssistantTurnReceipt: turnReceiptMocks.updateAssistantTurnReceipt,
  }
})

vi.mock('../src/assistant/outbox.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/outbox.ts')>(
    '../src/assistant/outbox.ts',
  )

  return {
    ...actual,
    createAssistantOutboxIntent: outboxMocks.createAssistantOutboxIntent,
    deliverAssistantOutboxMessage: outboxMocks.deliverAssistantOutboxMessage,
    dispatchAssistantOutboxIntent: outboxMocks.dispatchAssistantOutboxIntent,
    listAssistantOutboxIntents: outboxMocks.listAssistantOutboxIntents,
    readAssistantOutboxIntent: outboxMocks.readAssistantOutboxIntent,
    saveAssistantOutboxIntent: outboxMocks.saveAssistantOutboxIntent,
  }
})

vi.mock('../src/assistant/status.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/status.ts')>(
    '../src/assistant/status.ts',
  )

  return {
    ...actual,
    getAssistantStatus: statusMocks.getAssistantStatus,
    readAssistantStatusSnapshot: statusMocks.readAssistantStatusSnapshot,
    refreshAssistantStatusSnapshot: statusMocks.refreshAssistantStatusSnapshot,
  }
})

vi.mock('../src/assistant/diagnostics.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/diagnostics.ts')>(
    '../src/assistant/diagnostics.ts',
  )

  return {
    ...actual,
    readAssistantDiagnosticsSnapshot: diagnosticsMocks.readAssistantDiagnosticsSnapshot,
    recordAssistantDiagnosticEvent: diagnosticsMocks.recordAssistantDiagnosticEvent,
  }
})

vi.mock('../src/assistant-cli-access.js', () => ({
  resolveAssistantCliAccessContext: turnPlanMocks.resolveAssistantCliAccessContext,
}))

vi.mock('../src/assistant/operator-authority.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/assistant/operator-authority.ts')
  >('../src/assistant/operator-authority.ts')

  return {
    ...actual,
    resolveAssistantOperatorAuthority: turnPlanMocks.resolveAssistantOperatorAuthority,
  }
})

vi.mock('../src/assistant/conversation-policy.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/assistant/conversation-policy.ts')
  >('../src/assistant/conversation-policy.ts')

  return {
    ...actual,
    resolveAssistantConversationPolicy: turnPlanMocks.resolveAssistantConversationPolicy,
  }
})

vi.mock('../src/assistant/first-contact.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant/first-contact.ts')>(
    '../src/assistant/first-contact.ts',
  )

  return {
    ...actual,
    hasAssistantSeenFirstContact: turnPlanMocks.hasAssistantSeenFirstContact,
    resolveAssistantFirstContactStateDocIds:
      turnPlanMocks.resolveAssistantFirstContactStateDocIds,
  }
})

import { createAssistantRuntimeStateService } from '../src/assistant/runtime-state-service.ts'
import { resolveAssistantTurnSharedPlan } from '../src/assistant/turn-plan.ts'

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant store seam', () => {
  it('creates sessions, resolves them by alias and conversation key, and lists them newest-first', async () => {
    const store = await loadActualStore()
    const vaultRoot = await createVaultRoot('assistant-store-runtime-resolution-')

    const older = await store.resolveAssistantSession({
      actorId: 'user-1',
      alias: 'alpha',
      channel: 'telegram',
      identityId: 'identity-1',
      now: new Date('2026-04-08T00:00:00.000Z'),
      target: createTarget(),
      threadId: 'thread-1',
      threadIsDirect: true,
      vault: vaultRoot,
    })
    const newer = await store.resolveAssistantSession({
      actorId: 'user-2',
      alias: 'beta',
      channel: 'telegram',
      identityId: 'identity-2',
      now: new Date('2026-04-08T00:05:00.000Z'),
      target: createTarget({
        model: 'gpt-5',
      }),
      threadId: 'thread-2',
      threadIsDirect: false,
      vault: vaultRoot,
    })

    expect(older.created).toBe(true)
    expect(newer.created).toBe(true)

    await expect(
      store.resolveAssistantSession({
        alias: ' alpha ',
        createIfMissing: false,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      created: false,
      session: {
        sessionId: older.session.sessionId,
      },
    })

    await expect(
      store.resolveAssistantSession({
        actorId: 'user-2',
        channel: 'telegram',
        createIfMissing: false,
        identityId: 'identity-2',
        threadId: 'thread-2',
        threadIsDirect: false,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      created: false,
      session: {
        sessionId: newer.session.sessionId,
      },
    })

    const paths = resolveAssistantStatePaths(vaultRoot)
    await mkdir(`${paths.sessionsDirectory}/nested`, {
      recursive: true,
    })
    await writeFile(`${paths.sessionsDirectory}/notes.txt`, 'ignored', 'utf8')
    await writeFile(`${paths.sessionsDirectory}/broken.json`, '{bad-json', 'utf8')

    await expect(store.listAssistantSessions(vaultRoot)).resolves.toMatchObject([
      {
        sessionId: newer.session.sessionId,
      },
      {
        sessionId: older.session.sessionId,
      },
    ])
    await expect(
      store.getAssistantSession(vaultRoot, newer.session.sessionId),
    ).resolves.toMatchObject({
      sessionId: newer.session.sessionId,
    })
  })

  it('reports detailed not-found diagnostics for explicit session ids and distinguishes helper errors', async () => {
    const store = await loadActualStore()
    const vaultRoot = await createVaultRoot('assistant-store-runtime-missing-')
    const missingSessionId = 'asst_missing_session'
    const transcriptPath = resolveAssistantTranscriptPath(
      resolveAssistantStatePaths(vaultRoot),
      missingSessionId,
    )

    await mkdir(resolveAssistantStatePaths(vaultRoot).transcriptsDirectory, {
      recursive: true,
    })
    await writeFile(
      transcriptPath,
      '{"schema":"murph.assistant-transcript-entry.v1","kind":"user","text":"hello","createdAt":"2026-04-08T00:00:00.000Z"}\n',
      'utf8',
    )

    const missingSessionError = await store.resolveAssistantSession({
      createIfMissing: false,
      sessionId: missingSessionId,
      vault: vaultRoot,
    }).catch((error) => error)

    expect(store.isAssistantSessionNotFoundError(missingSessionError)).toBe(true)
    expect(missingSessionError).toMatchObject({
      code: 'ASSISTANT_SESSION_NOT_FOUND',
      context: {
        sessionExists: false,
        transcriptExists: true,
      },
    })
    expect(String(missingSessionError.message)).toContain('local assistant state is out of sync')
    expect(store.isAssistantSessionNotFoundError(new Error('nope'))).toBe(false)

    const genericNotFound = await store.resolveAssistantSession({
      alias: 'unknown-alias',
      createIfMissing: false,
      vault: vaultRoot,
    }).catch((error) => error)

    expect(genericNotFound).toMatchObject({
      code: 'ASSISTANT_SESSION_NOT_FOUND',
    })
    expect(String(genericNotFound.message)).toContain(
      'Assistant session could not be resolved from the supplied identifiers.',
    )
  })

  it('creates default codex-backed sessions and round-trips transcript and automation state snapshots', async () => {
    const store = await loadActualStore()
    const vaultRoot = await createVaultRoot('assistant-store-runtime-snapshots-')

    const defaultTargetSession = await store.resolveAssistantSession({
      alias: 'missing-target',
      vault: vaultRoot,
    })
    expect(defaultTargetSession).toMatchObject({
      created: true,
      session: {
        alias: 'missing-target',
        provider: 'codex-cli',
        target: {
          adapter: 'codex-cli',
        },
      },
    })

    const created = await store.resolveAssistantSession({
      actorId: 'user-1',
      alias: 'gamma',
      channel: 'telegram',
      identityId: 'identity-3',
      target: createTarget(),
      threadId: 'thread-3',
      threadIsDirect: true,
      vault: vaultRoot,
    })

    const restoredSession = {
      ...created.session,
      alias: 'gamma-restored',
      updatedAt: '2026-04-08T00:10:00.000Z',
    }
    await expect(
      store.restoreAssistantSessionSnapshot({
        session: restoredSession,
        transcriptEntries: [
          {
            kind: 'user',
            text: 'First prompt',
          },
        ],
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      alias: 'gamma-restored',
    })

    const appendedEntries = await store.appendAssistantTranscriptEntries(
      vaultRoot,
      created.session.sessionId,
      [
        {
          createdAt: null,
          kind: 'assistant',
          text: 'Follow-up reply',
        },
      ],
    )
    expect(appendedEntries).toHaveLength(1)
    expect(appendedEntries[0]?.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u,
    )
    await expect(
      store.appendAssistantTranscriptEntries(vaultRoot, created.session.sessionId, []),
    ).resolves.toEqual([])

    const savedSession = await store.saveAssistantSession(vaultRoot, {
      ...restoredSession,
      alias: 'gamma-saved',
      updatedAt: '2026-04-08T00:11:00.000Z',
    })
    expect(savedSession.alias).toBe('gamma-saved')

    await expect(store.readAssistantAutomationState(vaultRoot)).resolves.toMatchObject({
      autoReplyBacklogChannels: [],
      autoReplyChannels: [],
      autoReplyPrimed: true,
      autoReplyScanCursor: null,
      inboxScanCursor: null,
      version: 2,
    })

    const updatedAutomationState: AssistantAutomationState = {
      autoReplyBacklogChannels: ['telegram'],
      autoReplyChannels: ['telegram'],
      autoReplyPrimed: true,
      autoReplyScanCursor: {
        captureId: 'capture-auto-reply',
        occurredAt: '2026-04-08T00:11:00.000Z',
      },
      inboxScanCursor: {
        captureId: 'capture-inbox',
        occurredAt: '2026-04-08T00:10:00.000Z',
      },
      updatedAt: '2026-04-08T00:11:00.000Z',
      version: 2,
    }

    await expect(
      store.saveAssistantAutomationState(vaultRoot, updatedAutomationState),
    ).resolves.toEqual(updatedAutomationState)
    await expect(store.readAssistantAutomationState(vaultRoot)).resolves.toEqual(
      updatedAutomationState,
    )
  })
})

describe('assistant state document helpers', () => {
  it('normalizes valid document ids and rejects unsafe segments', () => {
    expect(assertAssistantStateDocumentId(' cron/job.alpha ', 'jobId')).toBe('cron/job.alpha')
    expect(buildDefaultAssistantCronStateDocId('daily-check')).toBe('cron/daily-check')
    expect(
      resolveAssistantStateDocumentPath(
        {
          stateDirectory: '/runtime/assistant/state',
        },
        'cron/daily-check',
      ),
    ).toBe('/runtime/assistant/state/cron/daily-check.json')

    for (const invalidValue of ['', '  ', '.', '..', 'cron/../escape', 'cron/bad*value']) {
      expect(() => assertAssistantStateDocumentId(invalidValue, 'docId')).toThrowError(
        expect.objectContaining({
          code: 'ASSISTANT_STATE_INVALID_DOC_ID',
        }),
      )
    }
  })
})

describe('assistant runtime state service', () => {
  it('binds the vault into every delegated store, outbox, status, diagnostics, and turn helper', async () => {
    const vault = '/tmp/runtime-state-service-vault'
    const session = createSession({
      alias: 'runtime-service',
      sessionId: 'asst_runtime_service',
    })
    const statusSnapshot = {
      ok: true,
    }
    const diagnosticSnapshot = {
      diagnostics: [],
    }
    const outboxIntent = {
      intentId: 'intent-1',
    }
    const turnReceipt = {
      turnId: 'turn-1',
    }
    const transcriptEntries = [
      {
        createdAt: '2026-04-08T00:00:00.000Z',
        kind: 'user',
        schema: 'murph.assistant-transcript-entry.v1',
        text: 'hello',
      },
    ]

    runtimeStateMocks.getAssistantSession.mockResolvedValue(session)
    runtimeStateMocks.listAssistantSessions.mockResolvedValue([session])
    runtimeStateMocks.resolveAssistantSession.mockResolvedValue({
      created: false,
      paths: resolveAssistantStatePaths(vault),
      session,
    })
    runtimeStateMocks.restoreAssistantSessionSnapshot.mockResolvedValue(session)
    runtimeStateMocks.saveAssistantSession.mockResolvedValue(session)
    runtimeStateMocks.appendAssistantTranscriptEntries.mockResolvedValue(transcriptEntries)
    runtimeStateMocks.listAssistantTranscriptEntries.mockResolvedValue(transcriptEntries)
    diagnosticsMocks.readAssistantDiagnosticsSnapshot.mockResolvedValue(diagnosticSnapshot)
    diagnosticsMocks.recordAssistantDiagnosticEvent.mockResolvedValue(undefined)
    outboxMocks.createAssistantOutboxIntent.mockResolvedValue(outboxIntent)
    outboxMocks.deliverAssistantOutboxMessage.mockResolvedValue({
      delivery: null,
      intent: null,
    })
    outboxMocks.dispatchAssistantOutboxIntent.mockResolvedValue({
      delivered: false,
      intent: null,
    })
    outboxMocks.listAssistantOutboxIntents.mockResolvedValue([outboxIntent])
    outboxMocks.readAssistantOutboxIntent.mockResolvedValue(outboxIntent)
    outboxMocks.saveAssistantOutboxIntent.mockResolvedValue(outboxIntent)
    statusMocks.getAssistantStatus.mockResolvedValue(statusSnapshot)
    statusMocks.readAssistantStatusSnapshot.mockResolvedValue(statusSnapshot)
    statusMocks.refreshAssistantStatusSnapshot.mockResolvedValue(statusSnapshot)
    turnReceiptMocks.appendAssistantTurnReceiptEvent.mockResolvedValue(undefined)
    turnReceiptMocks.createAssistantTurnReceipt.mockResolvedValue(turnReceipt)
    turnReceiptMocks.finalizeAssistantTurnReceipt.mockResolvedValue(turnReceipt)
    turnReceiptMocks.readAssistantTurnReceipt.mockResolvedValue(turnReceipt)
    turnReceiptMocks.updateAssistantTurnReceipt.mockResolvedValue(turnReceipt)

    const service = createAssistantRuntimeStateService(vault)

    await expect(service.diagnostics.readSnapshot()).resolves.toBe(diagnosticSnapshot)
    await expect(
      service.diagnostics.recordEvent({
        component: 'assistant',
        entityId: 'turn-1',
        entityType: 'turn',
        level: 'info',
        message: 'diagnostic',
      }),
    ).resolves.toBeUndefined()
    await expect(
      service.outbox.createIntent({
        payload: {
          text: 'hello',
        },
        sessionId: session.sessionId,
      } as never),
    ).resolves.toBe(outboxIntent)
    await expect(
      service.outbox.deliverMessage({
        channel: 'telegram',
        payload: {
          text: 'hello',
        },
      } as never),
    ).resolves.toEqual({
      delivery: null,
      intent: null,
    })
    await expect(
      service.outbox.dispatchIntent({
        intentId: 'intent-1',
      }),
    ).resolves.toEqual({
      delivered: false,
      intent: null,
    })
    await expect(service.outbox.listIntents()).resolves.toEqual([outboxIntent])
    await expect(service.outbox.readIntent('intent-1')).resolves.toBe(outboxIntent)
    await expect(service.outbox.saveIntent(outboxIntent as never)).resolves.toBe(outboxIntent)
    await expect(service.sessions.get(session.sessionId)).resolves.toBe(session)
    await expect(service.sessions.list()).resolves.toEqual([session])
    await expect(
      service.sessions.resolve({
        alias: 'runtime-service',
      }),
    ).resolves.toMatchObject({
      session: {
        sessionId: session.sessionId,
      },
    })
    await expect(
      service.sessions.restoreSnapshot({
        session,
        transcriptEntries: [],
      }),
    ).resolves.toBe(session)
    await expect(service.sessions.save(session)).resolves.toBe(session)
    await expect(service.status.get()).resolves.toBe(statusSnapshot)
    await expect(
      service.status.get({
        includeDiagnostics: true,
      } as never),
    ).resolves.toBe(statusSnapshot)
    await expect(service.status.readSnapshot()).resolves.toBe(statusSnapshot)
    await expect(service.status.refreshSnapshot()).resolves.toBe(statusSnapshot)
    await expect(
      service.transcripts.append(session.sessionId, [
        {
          kind: 'user',
          text: 'hello',
        },
      ]),
    ).resolves.toEqual(transcriptEntries)
    await expect(service.transcripts.list(session.sessionId)).resolves.toEqual(
      transcriptEntries,
    )
    await expect(
      service.turns.appendEvent({
        event: {
          kind: 'accepted',
        },
        turnId: 'turn-1',
      } as never),
    ).resolves.toBeUndefined()
    await expect(
      service.turns.createReceipt({
        actionClass: 'analysis',
        sessionId: session.sessionId,
        trigger: 'manual-ask',
        turnId: 'turn-1',
      } as never),
    ).resolves.toBe(turnReceipt)
    await expect(
      service.turns.finalizeReceipt({
        status: 'completed',
        turnId: 'turn-1',
      } as never),
    ).resolves.toBe(turnReceipt)
    await expect(service.turns.readReceipt('turn-1')).resolves.toBe(turnReceipt)
    await expect(
      service.turns.updateReceipt({
        turnId: 'turn-1',
      } as never),
    ).resolves.toBe(turnReceipt)

    expect(diagnosticsMocks.recordAssistantDiagnosticEvent).toHaveBeenCalledWith({
      component: 'assistant',
      entityId: 'turn-1',
      entityType: 'turn',
      level: 'info',
      message: 'diagnostic',
      vault,
    })
    expect(outboxMocks.dispatchAssistantOutboxIntent).toHaveBeenCalledWith({
      intentId: 'intent-1',
      vault,
    })
    expect(runtimeStateMocks.resolveAssistantSession).toHaveBeenCalledWith({
      alias: 'runtime-service',
      vault,
    })
    expect(statusMocks.getAssistantStatus).toHaveBeenNthCalledWith(1, {
      vault,
    })
    expect(statusMocks.getAssistantStatus).toHaveBeenNthCalledWith(2, {
      includeDiagnostics: true,
      vault,
    })
    expect(turnReceiptMocks.updateAssistantTurnReceipt).toHaveBeenCalledWith({
      turnId: 'turn-1',
      vault,
    })
  })
})

describe('assistant turn shared plan', () => {
  it('uses vault defaults when first-turn check-ins are disabled', async () => {
    const cliAccess = {
      env: {},
      rawCommand: 'vault-cli' as const,
      setupCommand: 'murph' as const,
    }

    turnPlanMocks.resolveAssistantCliAccessContext.mockReturnValue(cliAccess)
    turnPlanMocks.resolveAssistantConversationPolicy.mockReturnValue({
      allowSensitiveHealthContext: false,
      audience: {
        actorId: 'bound-actor',
        bindingDelivery: null,
        channel: 'telegram',
        deliveryPolicy: 'binding-target-only',
        effectiveThreadIsDirect: true,
        explicitTarget: null,
        identityId: 'bound-identity',
        replyToMessageId: null,
        threadId: 'bound-thread',
        threadIsDirect: true,
      },
      operatorAuthority: 'direct-operator',
    })
    turnPlanMocks.resolveAssistantOperatorAuthority.mockReturnValue('direct-operator')

    const plan = await resolveAssistantTurnSharedPlan(
      {
        prompt: 'hello',
        vault: '/tmp/turn-plan-vault',
      },
      {
        created: false,
        paths: resolveAssistantStatePaths('/tmp/turn-plan-vault'),
        session: createSession(),
      },
    )

    expect(plan).toEqual({
      allowSensitiveHealthContext: false,
      cliAccess,
      conversationPolicy: {
        allowSensitiveHealthContext: false,
        audience: {
          actorId: 'bound-actor',
          bindingDelivery: null,
          channel: 'telegram',
          deliveryPolicy: 'binding-target-only',
          effectiveThreadIsDirect: true,
          explicitTarget: null,
          identityId: 'bound-identity',
          replyToMessageId: null,
          threadId: 'bound-thread',
          threadIsDirect: true,
        },
        operatorAuthority: 'direct-operator',
      },
      firstTurnCheckInEligible: false,
      firstTurnCheckInStateDocIds: [],
      operatorAuthority: 'direct-operator',
      persistUserPromptOnFailure: true,
      requestedWorkingDirectory: '/tmp/turn-plan-vault',
    })
    expect(turnPlanMocks.resolveAssistantFirstContactStateDocIds).not.toHaveBeenCalled()
    expect(turnPlanMocks.hasAssistantSeenFirstContact).not.toHaveBeenCalled()
  })

  it('derives first-turn check-in doc ids from the conversation policy audience and session binding fallbacks', async () => {
    turnPlanMocks.resolveAssistantCliAccessContext.mockReturnValue({
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    })
    turnPlanMocks.resolveAssistantConversationPolicy.mockReturnValue({
      allowSensitiveHealthContext: true,
      audience: {
        actorId: null,
        bindingDelivery: null,
        channel: null,
        deliveryPolicy: 'explicit-target-override',
        effectiveThreadIsDirect: true,
        explicitTarget: 'bound-actor',
        identityId: null,
        replyToMessageId: 'message-1',
        threadId: null,
        threadIsDirect: null,
      },
      operatorAuthority: 'accepted-inbound-message',
    })
    turnPlanMocks.resolveAssistantFirstContactStateDocIds.mockReturnValue([
      'onboarding/first-contact/doc-1',
    ])
    turnPlanMocks.resolveAssistantOperatorAuthority.mockReturnValue(
      'accepted-inbound-message',
    )
    turnPlanMocks.hasAssistantSeenFirstContact.mockResolvedValueOnce(false)
    turnPlanMocks.hasAssistantSeenFirstContact.mockResolvedValueOnce(true)

    const resolved = {
      created: false,
      paths: resolveAssistantStatePaths('/tmp/turn-plan-vault'),
      session: createSession({
        actorId: 'bound-actor',
        alias: 'turn-plan',
        channel: 'telegram',
        identityId: 'bound-identity',
        sessionId: 'asst_turn_plan_binding',
        threadId: 'bound-thread',
        threadIsDirect: true,
      }),
    }

    const eligiblePlan = await resolveAssistantTurnSharedPlan(
      {
        includeFirstTurnCheckIn: true,
        operatorAuthority: 'accepted-inbound-message',
        persistUserPromptOnFailure: false,
        prompt: 'hello',
        vault: '/tmp/turn-plan-vault',
        workingDirectory: '/tmp/turn-plan-workdir',
      },
      resolved,
    )
    const repeatPlan = await resolveAssistantTurnSharedPlan(
      {
        includeFirstTurnCheckIn: true,
        prompt: 'hello again',
        vault: '/tmp/turn-plan-vault',
      },
      resolved,
    )

    expect(turnPlanMocks.resolveAssistantFirstContactStateDocIds).toHaveBeenNthCalledWith(1, {
      actorId: 'bound-actor',
      channel: 'telegram',
      identityId: 'bound-identity',
      threadId: 'bound-thread',
      threadIsDirect: true,
    })
    expect(turnPlanMocks.hasAssistantSeenFirstContact).toHaveBeenNthCalledWith(1, {
      docIds: ['onboarding/first-contact/doc-1'],
      vault: '/tmp/turn-plan-vault',
    })
    expect(eligiblePlan.firstTurnCheckInEligible).toBe(true)
    expect(eligiblePlan.firstTurnCheckInStateDocIds).toEqual([
      'onboarding/first-contact/doc-1',
    ])
    expect(eligiblePlan.operatorAuthority).toBe('accepted-inbound-message')
    expect(eligiblePlan.persistUserPromptOnFailure).toBe(false)
    expect(eligiblePlan.requestedWorkingDirectory).toBe('/tmp/turn-plan-workdir')
    expect(repeatPlan.firstTurnCheckInEligible).toBe(false)
  })

  it('treats first-turn check-ins as ineligible when no first-contact doc ids can be derived', async () => {
    turnPlanMocks.resolveAssistantCliAccessContext.mockReturnValue({
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    })
    turnPlanMocks.resolveAssistantConversationPolicy.mockReturnValue({
      allowSensitiveHealthContext: false,
      audience: {
        actorId: null,
        bindingDelivery: null,
        channel: null,
        deliveryPolicy: 'binding-target-only',
        effectiveThreadIsDirect: true,
        explicitTarget: null,
        identityId: null,
        replyToMessageId: null,
        threadId: null,
        threadIsDirect: null,
      },
      operatorAuthority: 'direct-operator',
    })
    turnPlanMocks.resolveAssistantFirstContactStateDocIds.mockReturnValue([])
    turnPlanMocks.resolveAssistantOperatorAuthority.mockReturnValue('direct-operator')

    const plan = await resolveAssistantTurnSharedPlan(
      {
        includeFirstTurnCheckIn: true,
        prompt: 'hello',
        vault: '/tmp/turn-plan-vault',
      },
      {
        created: false,
        paths: resolveAssistantStatePaths('/tmp/turn-plan-vault'),
        session: parseAssistantSessionRecord({
          alias: 'local',
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
          resumeState: null,
          schema: 'murph.assistant-session.v4',
          sessionId: 'asst_turn_plan_local',
          target: createTarget(),
          turnCount: 0,
          updatedAt: '2026-04-08T00:00:00.000Z',
        }),
      },
    )

    expect(turnPlanMocks.resolveAssistantFirstContactStateDocIds).toHaveBeenCalledWith({
      actorId: null,
      channel: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    })
    expect(turnPlanMocks.hasAssistantSeenFirstContact).not.toHaveBeenCalled()
    expect(plan.firstTurnCheckInEligible).toBe(false)
    expect(plan.firstTurnCheckInStateDocIds).toEqual([])
  })
})

async function createVaultRoot(prefix: string): Promise<string> {
  const context = await createTempVaultContext(prefix)
  cleanupPaths.push(context.parentRoot)
  return context.vaultRoot
}

function createTarget(
  overrides: Partial<{
    apiKeyEnv: string
    baseUrl: string
    model: string
    providerName: string
  }> = {},
): AssistantModelTarget {
  const target = createAssistantModelTarget({
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://gateway.example.com/v1',
    model: 'gpt-5-mini',
    provider: 'openai-compatible',
    providerName: 'Example Gateway',
    ...overrides,
  })

  if (!target) {
    throw new Error('Expected assistant target.')
  }

  return target
}

function createSession(
  overrides: Partial<{
    actorId: string | null
    alias: string | null
    channel: string | null
    createdAt: string
    identityId: string | null
    sessionId: string
    target: AssistantModelTarget
    threadId: string | null
    threadIsDirect: boolean | null
    updatedAt: string
  }> = {},
): AssistantSession {
  return parseAssistantSessionRecord({
    alias: overrides.alias ?? 'alpha',
    binding: {
      actorId: overrides.actorId ?? 'user-1',
      channel: overrides.channel ?? 'telegram',
      conversationKey: 'telegram:bound-identity:bound-thread',
      delivery: null,
      identityId: overrides.identityId ?? 'bound-identity',
      threadId: overrides.threadId ?? 'bound-thread',
      threadIsDirect: overrides.threadIsDirect ?? true,
    },
    createdAt: overrides.createdAt ?? '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    resumeState: null,
    schema: 'murph.assistant-session.v4',
    sessionId: overrides.sessionId ?? 'asst_store_runtime',
    target: overrides.target ?? createTarget(),
    turnCount: 0,
    updatedAt: overrides.updatedAt ?? '2026-04-08T00:00:00.000Z',
  })
}

async function loadActualStore() {
  return vi.importActual<typeof import('../src/assistant/store.ts')>(
    '../src/assistant/store.ts',
  )
}
