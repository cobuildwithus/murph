import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  AssistantDeliveryError,
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  buildDailyFoodCronExpression,
  buildDailyFoodCronJobName,
  buildDailyFoodCronPrompt,
  buildDailyFoodSchedule,
} from '@murphai/vault-usecases/records'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveAssistantConversationAutoReplyEligibility,
  resolveAssistantConversationPolicy,
  shouldExposeSensitiveHealthContext,
} from '../src/assistant/conversation-policy.ts'
import {
  hasAssistantSeenFirstContact,
  markAssistantFirstContactSeen,
  resolveAssistantFirstContactStateDocIds,
} from '../src/assistant/first-contact.ts'
import { ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE } from '../src/assistant/first-contact-welcome.ts'
import {
  assertAssistantMemoryTurnContextVault,
  createAssistantMemoryTurnContextEnv,
  resolveAssistantMemoryTurnContext,
} from '../src/assistant/memory/turn-context.ts'
import {
  ASSISTANT_OPERATOR_AUTHORITY_VALUES,
  isAcceptedInboundMessageOperatorAuthority,
  isAssistantOperatorAuthority,
  resolveAcceptedInboundMessageOperatorAuthority,
  resolveAssistantOperatorAuthority,
} from '../src/assistant/operator-authority.ts'
import {
  buildFailedAssistantPromptAttemptText,
  extractAssistantAutoReplyFailedPromptText,
} from '../src/assistant/prompt-attempts.ts'
import {
  buildOutboundReplyFormattingGuidance,
  isAssistantOutboundReplyChannel,
  isAssistantSourceReference,
  looksLikeAssistantSourceReferenceClause,
  sanitizeAssistantOutboundReply,
  stripAssistantSourceCalloutPrefix,
  stripInlineAssistantSourceReferences,
} from '../src/assistant/reply-sanitizer.ts'
import {
  maybeRunAssistantRuntimeMaintenance,
  readAssistantRuntimeBudgetStatus,
  runAssistantRuntimeMaintenance,
} from '../src/assistant/runtime-budgets.ts'
import {
  createEmptyAssistantDiagnosticsCounters,
  readAssistantDiagnosticsSnapshot,
  recordAssistantDiagnosticEvent,
} from '../src/assistant/diagnostics.ts'
import { resolveAssistantExecutionPlan } from '../src/assistant/execution-plan.ts'
import {
  consumeInjectedAssistantFault,
  hasInjectedAssistantFault,
  maybeThrowInjectedAssistantFault,
  resetInjectedAssistantFaults,
} from '../src/assistant/fault-injection.ts'
import { createAssistantRuntimeCache } from '../src/assistant/runtime-cache.ts'
import {
  resolveAssistantStateDocumentPath,
} from '../src/assistant/state.ts'
import {
  resolveAssistantStatePaths,
} from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.doUnmock('../src/assistant/store.js')
  vi.doUnmock('../src/assistant/turn-lock.js')
  vi.doUnmock('../src/assistant/runtime-state-service.js')
  vi.doUnmock('../src/assistant/runtime-events.js')
  vi.doUnmock('../src/assistant/session-resolution.js')
  vi.doUnmock('../src/assistant/first-contact.js')
  vi.doUnmock('../src/assistant/quarantine.js')
  vi.doUnmock('../src/assistant/cron.js')
  vi.doUnmock('../src/assistant/delivery-service.js')
  vi.doUnmock('../src/assistant/store.js')
  vi.doUnmock('@murphai/operator-config/operator-config')
  vi.doUnmock('@murphai/operator-config/assistant/provider-config')
  vi.doUnmock('@murphai/vault-usecases/runtime')
  resetInjectedAssistantFaults()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant product small seams', () => {
  it('resolves conversation audiences, directness, sensitivity, and auto-reply eligibility', () => {
    const explicitOverride = resolveAssistantConversationPolicy({
      message: {
        deliverResponse: true,
        deliveryReplyToMessageId: 'reply-1',
        deliveryTarget: 'actor-1',
        operatorAuthority: 'accepted-inbound-message',
        sourceThreadId: null,
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: 'actor-1',
          channel: 'email',
          delivery: {
            kind: 'participant',
            target: 'actor-1',
          },
          identityId: 'identity-1',
          threadId: 'thread-1',
          threadIsDirect: true,
        },
      },
    })

    expect(explicitOverride.audience).toMatchObject({
      deliveryPolicy: 'explicit-target-override',
      effectiveThreadIsDirect: true,
      replyToMessageId: 'reply-1',
      threadId: 'thread-1',
      threadIsDirect: true,
    })
    expect(explicitOverride.allowSensitiveHealthContext).toBe(true)
    expect(explicitOverride.operatorAuthority).toBe('accepted-inbound-message')
    expect(
      resolveAssistantConversationAutoReplyEligibility(explicitOverride),
    ).toBe(true)

    const publicAudience = resolveAssistantConversationPolicy({
      message: {
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: 'group-thread',
        operatorAuthority: 'accepted-inbound-message',
        sourceThreadId: 'group-thread',
        threadId: null,
        threadIsDirect: false,
      },
      session: {
        binding: {
          actorId: 'actor-1',
          channel: 'telegram',
          delivery: null,
          identityId: 'identity-1',
          threadId: 'group-thread',
          threadIsDirect: false,
        },
      },
    })

    expect(publicAudience.allowSensitiveHealthContext).toBe(false)
    expect(
      resolveAssistantConversationAutoReplyEligibility(publicAudience),
    ).toBe(false)

    expect(
      resolveAssistantConversationAutoReplyEligibility({
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
      }),
    ).toBe(true)

    expect(
      shouldExposeSensitiveHealthContext({
        actorId: null,
        bindingDelivery: null,
        channel: 'local',
        deliveryPolicy: 'explicit-target-override',
        effectiveThreadIsDirect: false,
        explicitTarget: 'public-thread',
        identityId: null,
        replyToMessageId: null,
        threadId: 'thread-1',
        threadIsDirect: false,
      }),
    ).toBe(true)

    const bindingTargetOnly = resolveAssistantConversationPolicy({
      message: {
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: null,
        operatorAuthority: 'accepted-inbound-message',
        sourceThreadId: null,
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: ' actor-2 ',
          channel: ' email ',
          delivery: {
            kind: 'participant',
            target: 'actor-2',
          },
          identityId: 'identity-2',
          threadId: null,
          threadIsDirect: null,
        },
      },
    })
    expect(bindingTargetOnly.audience.deliveryPolicy).toBe('binding-target-only')
    expect(bindingTargetOnly.audience.effectiveThreadIsDirect).toBe(true)
    expect(
      resolveAssistantConversationAutoReplyEligibility(bindingTargetOnly),
    ).toBe(true)

    const threadTargetAudience = resolveAssistantConversationPolicy({
      message: {
        deliverResponse: true,
        deliveryReplyToMessageId: null,
        deliveryTarget: null,
        operatorAuthority: 'accepted-inbound-message',
        sourceThreadId: null,
        threadId: null,
        threadIsDirect: null,
      },
      session: {
        binding: {
          actorId: 'actor-3',
          channel: 'telegram',
          delivery: {
            kind: 'thread',
            target: 'thread-3',
          },
          identityId: 'identity-3',
          threadId: 'thread-3',
          threadIsDirect: false,
        },
      },
    })
    expect(threadTargetAudience.audience.effectiveThreadIsDirect).toBe(false)

    expect(
      shouldExposeSensitiveHealthContext({
        actorId: 'actor-4',
        bindingDelivery: {
          kind: 'participant',
          target: 'actor-4',
        },
        channel: 'email',
        deliveryPolicy: 'explicit-target-override',
        effectiveThreadIsDirect: true,
        explicitTarget: 'outsider',
        identityId: 'identity-4',
        replyToMessageId: null,
        threadId: 'thread-4',
        threadIsDirect: true,
      }),
    ).toBe(false)
    expect(
      shouldExposeSensitiveHealthContext({
        actorId: 'actor-4',
        bindingDelivery: {
          kind: 'participant',
          target: 'actor-4',
        },
        channel: 'email',
        deliveryPolicy: 'explicit-target-override',
        effectiveThreadIsDirect: true,
        explicitTarget: '   ',
        identityId: 'identity-4',
        replyToMessageId: null,
        threadId: 'thread-4',
        threadIsDirect: true,
      }),
    ).toBe(false)
  })

  it('hashes first-contact doc ids, skips indirect actor ids, and persists seen markers', async () => {
    const directIds = resolveAssistantFirstContactStateDocIds({
      actorId: ' actor-1 ',
      channel: ' email ',
      identityId: ' identity-1 ',
      threadId: ' thread-1 ',
      threadIsDirect: true,
    })
    expect(directIds).toHaveLength(2)
    expect(directIds.every((value) => value.startsWith('onboarding/first-contact/'))).toBe(
      true,
    )

    expect(
      resolveAssistantFirstContactStateDocIds({
        actorId: 'actor-1',
        channel: 'email',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: false,
      }),
    ).toHaveLength(1)
    expect(
      resolveAssistantFirstContactStateDocIds({
        actorId: 'actor-1',
        channel: '   ',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
      }),
    ).toEqual([])

    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-first-contact-small-seams-',
    )
    tempRoots.push(parentRoot)

    expect(
      await hasAssistantSeenFirstContact({
        docIds: directIds,
        vault: vaultRoot,
      }),
    ).toBe(false)

    await markAssistantFirstContactSeen({
      docIds: [directIds[0], directIds[0], '  ', directIds[1]].filter(
        (value) => value.length > 0,
      ),
      seenAt: '2026-04-08T00:00:00.000Z',
      vault: vaultRoot,
    })

    expect(
      await hasAssistantSeenFirstContact({
        docIds: directIds,
        vault: vaultRoot,
      }),
    ).toBe(true)

    const malformedDocId = resolveAssistantFirstContactStateDocIds({
      actorId: 'actor-2',
      channel: 'email',
      identityId: 'identity-2',
      threadId: null,
      threadIsDirect: true,
    })[0]
    const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
    const malformedPath = resolveAssistantStateDocumentPath(
      {
        stateDirectory,
      },
      malformedDocId,
    )
    await mkdir(path.dirname(malformedPath), {
      recursive: true,
    })
    await writeFile(malformedPath, '{"broken":', 'utf8')

    expect(
      await hasAssistantSeenFirstContact({
        docIds: [malformedDocId],
        vault: vaultRoot,
      }),
    ).toBe(false)
  })

  it('creates and resolves memory turn env bindings and rejects vault mismatches', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-memory-turn-context-',
    )
    tempRoots.push(parentRoot)

    const env = createAssistantMemoryTurnContextEnv({
      allowSensitiveHealthContext: true,
      sessionId: 'session-1',
      sourcePrompt: 'How am I doing?',
      turnId: 'turn-1',
      vault: path.join(vaultRoot, '..', 'vault'),
    })

    expect(resolveAssistantMemoryTurnContext(env)).toEqual({
      allowSensitiveHealthContext: true,
      provenance: {
        sessionId: 'session-1',
        turnId: 'turn-1',
        writtenBy: 'assistant',
      },
      sourcePrompt: 'How am I doing?',
      vault: vaultRoot,
    })
    expect(
      resolveAssistantMemoryTurnContext({
        ...env,
        ASSISTANT_MEMORY_BOUND_SOURCE_PROMPT: '   ',
      }),
    ).toBeNull()

    expect(() =>
      assertAssistantMemoryTurnContextVault(
        resolveAssistantMemoryTurnContext(env)!,
        path.join(parentRoot, 'other-vault'),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'ASSISTANT_MEMORY_TURN_VAULT_MISMATCH',
      }),
    )
  })

  it('normalizes assistant operator authority values', () => {
    expect(ASSISTANT_OPERATOR_AUTHORITY_VALUES).toEqual([
      'direct-operator',
      'accepted-inbound-message',
    ])
    expect(isAssistantOperatorAuthority('direct-operator')).toBe(true)
    expect(isAssistantOperatorAuthority('user')).toBe(false)
    expect(resolveAssistantOperatorAuthority('not-valid')).toBe('direct-operator')
    expect(resolveAcceptedInboundMessageOperatorAuthority()).toBe(
      'accepted-inbound-message',
    )
    expect(
      isAcceptedInboundMessageOperatorAuthority('accepted-inbound-message'),
    ).toBe(true)
  })

  it('extracts failed auto-reply prompts and persists deduplicated failure entries', async () => {
    const appendAssistantTranscriptEntries = vi.fn().mockResolvedValue(undefined)
    const listAssistantTranscriptEntries = vi.fn()
    const promptModule = await loadPromptAttemptsModule({
      appendAssistantTranscriptEntries,
      listAssistantTranscriptEntries,
    })

    expect(
      extractAssistantAutoReplyFailedPromptText(
        [
          'Capture 1:',
          'Reply context:',
          'quoted',
          '',
          'Message text:',
          'first message',
          '',
          'Capture 2:',
          'Message text:',
          'second message',
        ].join('\n'),
      ),
    ).toBe('first message\n\nsecond message')
    expect(
      buildFailedAssistantPromptAttemptText({
        prompt: 'plain prompt',
        turnTrigger: 'manual-ask',
      }),
    ).toBe('Failed assistant prompt attempt [manual-ask]: plain prompt')

    await promptModule.persistFailedAssistantPromptAttempt({
      persistUserPromptOnFailure: true,
      prompt: 'ignored',
      session: createAssistantSession(),
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnTrigger: 'manual-ask',
      vault: '/tmp/test-vault',
    })
    expect(listAssistantTranscriptEntries).not.toHaveBeenCalled()
    expect(appendAssistantTranscriptEntries).not.toHaveBeenCalled()

    listAssistantTranscriptEntries.mockResolvedValueOnce([
      {
        kind: 'error',
        text: 'Failed assistant prompt attempt [manual-ask]: duplicate',
      },
    ])
    await promptModule.persistFailedAssistantPromptAttempt({
      persistUserPromptOnFailure: false,
      prompt: 'duplicate',
      session: createAssistantSession(),
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnTrigger: 'manual-ask',
      vault: '/tmp/test-vault',
    })
    expect(appendAssistantTranscriptEntries).not.toHaveBeenCalled()

    listAssistantTranscriptEntries.mockResolvedValueOnce([])
    await promptModule.persistFailedAssistantPromptAttempt({
      persistUserPromptOnFailure: false,
      prompt: 'Capture 1:\nMessage text:\nqueued reply',
      session: createAssistantSession({
        sessionId: 'session-2',
      }),
      turnCreatedAt: '2026-04-08T00:00:00.000Z',
      turnTrigger: 'automation-auto-reply',
      vault: '/tmp/test-vault',
    })
    expect(appendAssistantTranscriptEntries).toHaveBeenCalledWith(
      '/tmp/test-vault',
      'session-2',
      [
        {
          kind: 'error',
          text:
            'Failed assistant prompt attempt [automation-auto-reply]: queued reply',
          createdAt: '2026-04-08T00:00:00.000Z',
        },
      ],
    )
  })

  it('sanitizes user-facing replies while preserving non-source content', () => {
    expect(isAssistantOutboundReplyChannel('email')).toBe(true)
    expect(isAssistantOutboundReplyChannel('local')).toBe(false)
    expect(buildOutboundReplyFormattingGuidance('local')).toBeNull()
    expect(buildOutboundReplyFormattingGuidance('telegram')).toContain(
      'do not include internal source callouts',
    )

    expect(stripAssistantSourceCalloutPrefix('From vault/notes.md: hello')).toBe(
      'hello',
    )
    expect(stripAssistantSourceCalloutPrefix('From teammate: hello')).toBe(
      'From teammate: hello',
    )
    expect(stripInlineAssistantSourceReferences('See /tmp/test.json and vault/notes.md')).toBe(
      'See that note and that note',
    )
    expect(
      looksLikeAssistantSourceReferenceClause('Sources: vault/notes.md, raw/input.json'),
    ).toBe(true)
    expect(isAssistantSourceReference('https://example.com/docs')).toBe(false)
    expect(isAssistantSourceReference('vault/notes.md')).toBe(true)

    expect(
      sanitizeAssistantOutboundReply(
        [
          'See [plan](vault/notes.md).',
          'From vault/notes.md: hello',
          'Reference /tmp/test.json',
        ].join('\n'),
        'email',
      ),
    ).toBe(['See plan.', 'hello'].join('\n'))
    expect(
      sanitizeAssistantOutboundReply('Leave [vault](vault/notes.md) alone', 'local'),
    ).toBe('Leave [vault](vault/notes.md) alone')

    expect(
      stripAssistantSourceCalloutPrefix('- From `vault/notes.md`: hello'),
    ).toBe('- hello')
    expect(
      stripInlineAssistantSourceReferences(
        'See file://vault/notes.md, derived/index.md, and https://example.com/docs.',
      ),
    ).toBe('See that note, and https://example.com/docs.')
    expect(looksLikeAssistantSourceReferenceClause('Sources: teammate summary')).toBe(false)
    expect(isAssistantSourceReference('notes.md#L12')).toBe(true)
    expect(isAssistantSourceReference('[Source: vault/notes.md]')).toBe(true)

    expect(
      sanitizeAssistantOutboundReply(
        [
          'Keep [docs](https://example.com/docs).',
          '[Sources: vault/notes.md] hello',
          'See file://vault/notes.md and research/plan.md',
        ].join('\n'),
        'telegram',
      ),
    ).toBe(['Keep [docs](https://example.com/docs).', 'hello'].join('\n'))
  })

  it('builds execution plans from explicit targets and rejects missing targets', async () => {
    const { createDefaultLocalAssistantModelTarget } = await import(
      '@murphai/operator-config/assistant-backend'
    )
    const plan = resolveAssistantExecutionPlan({
      defaults: null,
      resumeState: {
        providerSessionId: 'provider-session-1',
        resumeRouteId: 'route-primary',
      },
      sessionTarget: createDefaultLocalAssistantModelTarget(),
    })

    expect(plan.primaryTarget.adapter).toBeTruthy()
    expect(plan.resumeState).toEqual({
      providerSessionId: 'provider-session-1',
      resumeRouteId: 'route-primary',
    })
    expect(plan.routes).toHaveLength(1)

    expect(() =>
      resolveAssistantExecutionPlan({
        defaults: null,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'ASSISTANT_TARGET_REQUIRED',
      }),
    )
  })

  it('records diagnostics, trims warnings, and recovers malformed snapshots', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-diagnostics-small-seams-',
    )
    tempRoots.push(parentRoot)

    expect(createEmptyAssistantDiagnosticsCounters()).toEqual({
      automationScans: 0,
      deliveriesFailed: 0,
      deliveriesQueued: 0,
      deliveriesRetryable: 0,
      deliveriesSent: 0,
      outboxDrains: 0,
      outboxRetries: 0,
      providerAttempts: 0,
      providerFailovers: 0,
      providerFailures: 0,
      turnsCompleted: 0,
      turnsDeferred: 0,
      turnsFailed: 0,
      turnsStarted: 0,
    })

    expect(await readAssistantDiagnosticsSnapshot(vaultRoot)).toMatchObject({
      lastErrorAt: null,
      lastEventAt: null,
      recentWarnings: [],
      schema: 'murph.assistant-diagnostics.v1',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })

    for (let index = 0; index < 14; index += 1) {
      await recordAssistantDiagnosticEvent({
        at: `2026-04-08T00:00:${String(index).padStart(2, '0')}.000Z`,
        component: 'assistant',
        counterDeltas: {
          turnsStarted: 1,
          turnsFailed: index === 13 ? 1 : 0,
        },
        kind: 'turn.warned',
        level: index === 13 ? 'error' : 'warn',
        message: `warning-${index}`,
        vault: vaultRoot,
      })
    }

    const snapshot = await readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(snapshot.counters.turnsStarted).toBe(14)
    expect(snapshot.counters.turnsFailed).toBe(1)
    expect(snapshot.recentWarnings).toHaveLength(12)
    expect(snapshot.recentWarnings[0]).toContain('warning-2')
    expect(snapshot.lastErrorAt).toBe('2026-04-08T00:00:13.000Z')

    const paths = resolveAssistantStatePaths(vaultRoot)
    await writeFile(paths.diagnosticSnapshotPath, '{"broken":', 'utf8')

    const recovered = await readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(recovered.schema).toBe('murph.assistant-diagnostics.v1')
    expect(recovered.updatedAt).not.toBe('1970-01-01T00:00:00.000Z')
    expect(JSON.parse(await readFile(paths.diagnosticSnapshotPath, 'utf8'))).toMatchObject({
      schema: 'murph.assistant-diagnostics.v1',
    })
  })

  it('saves diagnostics snapshots and swallows runtime-event/quarantine failures', async () => {
    const appendAssistantRuntimeEventAtPaths = vi
      .fn()
      .mockRejectedValue(new Error('runtime-events-offline'))
    const quarantineAssistantStateFile = vi
      .fn()
      .mockRejectedValue(new Error('quarantine-offline'))
    vi.doMock('../src/assistant/runtime-events.js', () => ({
      appendAssistantRuntimeEventAtPaths,
    }))
    vi.doMock('../src/assistant/quarantine.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/quarantine.ts')
      >('../src/assistant/quarantine.ts')
      return {
        ...actual,
        quarantineAssistantStateFile,
      }
    })
    const diagnosticsModule = await import('../src/assistant/diagnostics.ts')

    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-diagnostics-mocked-side-effects-',
    )
    tempRoots.push(parentRoot)

    const saved = await diagnosticsModule.saveAssistantDiagnosticsSnapshot(vaultRoot, {
      counters: createEmptyAssistantDiagnosticsCounters(),
      lastErrorAt: null,
      lastEventAt: null,
      recentWarnings: ['keep-existing-warning'],
      schema: 'murph.assistant-diagnostics.v1',
      updatedAt: '2026-04-08T00:00:00.000Z',
    })
    expect(saved.recentWarnings).toEqual(['keep-existing-warning'])

    const event = await diagnosticsModule.recordAssistantDiagnosticEvent({
      at: '2026-04-08T00:00:01.000Z',
      component: 'assistant',
      kind: 'turn.started',
      message: 'plain info event',
      vault: vaultRoot,
    })
    expect(event.dataJson).toBeNull()

    const snapshot = await diagnosticsModule.readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(snapshot.counters).toEqual(createEmptyAssistantDiagnosticsCounters())
    expect(snapshot.recentWarnings).toEqual(['keep-existing-warning'])

    const paths = resolveAssistantStatePaths(vaultRoot)
    await writeFile(paths.diagnosticSnapshotPath, '{"broken":', 'utf8')

    const recovered = await diagnosticsModule.readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(recovered.schema).toBe('murph.assistant-diagnostics.v1')
    expect(quarantineAssistantStateFile).toHaveBeenCalledOnce()
    expect(appendAssistantRuntimeEventAtPaths).toHaveBeenCalled()
  })

  it('injects assistant faults once or always and marks retryable faults', () => {
    const onceEnv = {
      ASSISTANT_FAULTS: 'provider,automation:weird-mode',
    }
    expect(hasInjectedAssistantFault('provider', onceEnv)).toBe(true)
    expect(consumeInjectedAssistantFault('provider', onceEnv)).toBe(true)
    expect(consumeInjectedAssistantFault('provider', onceEnv)).toBe(false)
    expect(consumeInjectedAssistantFault('automation', onceEnv)).toBe(true)
    expect(consumeInjectedAssistantFault('automation', onceEnv)).toBe(false)

    const alwaysEnv = {
      ASSISTANT_FAULTS: 'delivery:always',
    }
    expect(consumeInjectedAssistantFault('delivery', alwaysEnv)).toBe(true)
    expect(consumeInjectedAssistantFault('delivery', alwaysEnv)).toBe(true)

    expect(() =>
      maybeThrowInjectedAssistantFault({
        component: 'provider-turn',
        env: {
          ASSISTANT_FAULTS: 'provider',
        },
        fault: 'provider',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'ASSISTANT_FAULT_INJECTED',
        context: expect.objectContaining({
          component: 'provider-turn',
          fault: 'provider',
          injected: true,
          retryable: true,
        }),
      }),
    )
    expect(() =>
      maybeThrowInjectedAssistantFault({
        code: 'CUSTOM_FAULT',
        component: 'status',
        env: {
          ASSISTANT_FAULTS: 'status',
        },
        fault: 'status',
        message: 'custom status failure',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'CUSTOM_FAULT',
        context: expect.objectContaining({
          retryable: false,
        }),
        message: 'custom status failure',
      }),
    )

    resetInjectedAssistantFaults()
    expect(consumeInjectedAssistantFault('provider', onceEnv)).toBe(true)
    expect(hasInjectedAssistantFault('missing', {})).toBe(false)
  })

  it('reads default runtime budgets, prunes expired cache/quarantine state, and skips too-frequent maintenance', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-runtime-budget-small-seams-',
    )
    tempRoots.push(parentRoot)

    const initial = await readAssistantRuntimeBudgetStatus(vaultRoot)
    expect(initial).toMatchObject({
      maintenance: {
        lastRunAt: null,
        notes: [],
        staleLocksCleared: 0,
        staleQuarantinePruned: 0,
      },
      schema: 'murph.assistant-runtime-budget.v1',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })

    const paths = resolveAssistantStatePaths(vaultRoot)
    await mkdir(paths.quarantineDirectory, {
      recursive: true,
    })
    await mkdir(paths.outboxQuarantineDirectory, {
      recursive: true,
    })

    const oldDate = new Date('2026-01-01T00:00:00.000Z')
    const maintenanceDate = new Date('2026-02-10T00:00:00.000Z')
    const pairPayloadPath = path.join(paths.quarantineDirectory, 'budget.invalid.json')
    const pairMetadataPath = `${pairPayloadPath}.meta.json`
    const orphanPayloadPath = path.join(
      paths.outboxQuarantineDirectory,
      'orphan.invalid.json',
    )
    await writeFile(pairPayloadPath, '{"bad":true}', 'utf8')
    await writeFile(
      pairMetadataPath,
      JSON.stringify({
        schema: 'murph.assistant-quarantine-entry.v1',
        artifactKind: 'runtime-budget',
        quarantineId: 'quarantine-1',
        quarantinedAt: oldDate.toISOString(),
        quarantinedPath: pairPayloadPath,
        sourcePath: paths.resourceBudgetPath,
      }),
      'utf8',
    )
    await writeFile(orphanPayloadPath, '{"bad":true}', 'utf8')
    await utimes(pairPayloadPath, oldDate, oldDate)
    await utimes(pairMetadataPath, oldDate, oldDate)
    await utimes(orphanPayloadPath, oldDate, oldDate)

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-09T23:59:50.000Z'))
    const cache = createAssistantRuntimeCache<string, string>({
      maxEntries: 2,
      name: 'small-seams-runtime-budget',
      ttlMs: 5,
    })
    cache.set('alpha', 'one')
    vi.advanceTimersByTime(10)

    const maintained = await runAssistantRuntimeMaintenance({
      now: maintenanceDate,
      vault: vaultRoot,
    })

    expect(maintained.maintenance.lastRunAt).toBe('2026-02-10T00:00:00.000Z')
    expect(maintained.maintenance.staleQuarantinePruned).toBe(2)
    expect(maintained.maintenance.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expired runtime cache'),
        '2 expired quarantine artifact(s) were removed.',
      ]),
    )
    await expect(stat(pairPayloadPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(pairMetadataPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(orphanPayloadPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const skipped = await maybeRunAssistantRuntimeMaintenance({
      now: new Date('2026-02-10T00:01:00.000Z'),
      vault: vaultRoot,
    })
    expect(skipped.updatedAt).toBe(maintained.updatedAt)

    await writeFile(paths.resourceBudgetPath, '{"broken":', 'utf8')
    const recovered = await readAssistantRuntimeBudgetStatus(vaultRoot)
    expect(recovered.schema).toBe('murph.assistant-runtime-budget.v1')
  })

  it('handles first-contact welcome delivery reasons with narrow mocked state services', async () => {
    const sessions = {
      resolve: vi.fn(),
      save: vi.fn(),
    }
    const transcripts = {
      append: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(),
    }
    const turns = {
      createReceipt: vi.fn(),
      readReceipt: vi.fn(),
    }
    const outbox = {
      createIntent: vi.fn(),
      deliverMessage: vi.fn(),
    }
    const status = {
      refreshSnapshot: vi.fn().mockResolvedValue(undefined),
    }
    const hasAssistantSeenFirstContactMock = vi.fn()
    const markAssistantFirstContactSeenMock = vi.fn().mockResolvedValue(undefined)
    const resolveAssistantFirstContactStateDocIdsMock = vi
      .fn()
      .mockReturnValue(['onboarding/first-contact/doc-1'])
    const finalizeAssistantTurnFromDeliveryOutcomeMock = vi
      .fn()
      .mockResolvedValue(undefined)

    const welcomeModule = await loadFirstContactWelcomeModule({
      createAssistantRuntimeStateService: () => ({
        outbox,
        sessions,
        status,
        transcripts,
        turns,
      }),
      finalizeAssistantTurnFromDeliveryOutcome:
        finalizeAssistantTurnFromDeliveryOutcomeMock,
      firstContact: {
        hasAssistantSeenFirstContact: hasAssistantSeenFirstContactMock,
        markAssistantFirstContactSeen: markAssistantFirstContactSeenMock,
        resolveAssistantFirstContactStateDocIds:
          resolveAssistantFirstContactStateDocIdsMock,
      },
    })

    const baseSession = createAssistantSession({
      binding: {
        actorId: 'actor-1',
        channel: 'email',
        conversationKey: 'conversation-1',
        delivery: {
          kind: 'participant',
          target: 'actor-1',
        },
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
      },
      sessionId: 'session-welcome',
      turnCount: 0,
    })

    sessions.resolve.mockResolvedValueOnce({
      session: baseSession,
    })
    hasAssistantSeenFirstContactMock.mockResolvedValueOnce(true)
    await expect(
      welcomeModule.queueAssistantFirstContactWelcomeLocal({
        channel: 'email',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
        vault: '/tmp/test-vault',
      }),
    ).resolves.toEqual({
      reason: 'already-seen',
      session: baseSession,
      turnId: null,
    })

    sessions.resolve.mockResolvedValueOnce({
      session: baseSession,
    })
    hasAssistantSeenFirstContactMock.mockResolvedValueOnce(false)
    transcripts.list.mockResolvedValueOnce([])
    turns.readReceipt.mockResolvedValueOnce(null)
    turns.createReceipt.mockResolvedValueOnce({
      turnId: 'turn-receipt-1',
    })
    outbox.createIntent.mockResolvedValueOnce({
      createdAt: '2026-04-08T00:00:00.000Z',
      intentId: 'intent-1',
    })
    sessions.save.mockResolvedValueOnce({
      ...baseSession,
      lastTurnAt: '2026-04-08T00:00:00.000Z',
      turnCount: 1,
      updatedAt: '2026-04-08T00:00:00.000Z',
    })

    await expect(
      welcomeModule.queueAssistantFirstContactWelcomeLocal({
        channel: 'email',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
        vault: '/tmp/test-vault',
      }),
    ).resolves.toMatchObject({
      reason: 'queued',
      turnId: 'turn-receipt-1',
    })
    expect(transcripts.append).toHaveBeenCalledWith('session-welcome', [
      {
        createdAt: '2026-04-08T00:00:00.000Z',
        kind: 'assistant',
        text: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
      },
    ])
    expect(markAssistantFirstContactSeenMock).toHaveBeenCalled()
    expect(status.refreshSnapshot).toHaveBeenCalled()

    const existingSession = createAssistantSession({
      sessionId: 'session-existing',
      turnCount: 2,
    })
    sessions.resolve.mockResolvedValueOnce({
      session: existingSession,
    })
    hasAssistantSeenFirstContactMock.mockResolvedValueOnce(false)
    transcripts.list.mockResolvedValueOnce([])

    await expect(
      welcomeModule.sendAssistantFirstContactWelcomeLocal({
        channel: 'email',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
        vault: '/tmp/test-vault',
      }),
    ).resolves.toEqual({
      reason: 'existing-session',
      session: existingSession,
      turnId: null,
    })

    sessions.resolve.mockResolvedValueOnce({
      session: baseSession,
    })
    hasAssistantSeenFirstContactMock.mockResolvedValueOnce(false)
    transcripts.list.mockResolvedValueOnce([
      {
        kind: 'assistant',
        text: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
      },
    ])
    sessions.save.mockResolvedValueOnce({
      ...baseSession,
      lastTurnAt: '2026-04-08T00:00:30.000Z',
      turnCount: 1,
      updatedAt: '2026-04-08T00:00:30.000Z',
    })

    await expect(
      welcomeModule.sendAssistantFirstContactWelcomeLocal({
        channel: 'email',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
        vault: '/tmp/test-vault',
      }),
    ).resolves.toMatchObject({
      reason: 'already-seen',
      turnId: expect.stringMatching(/^turn_first_contact_/u),
    })

    sessions.resolve.mockResolvedValueOnce({
      session: baseSession,
    })
    hasAssistantSeenFirstContactMock.mockResolvedValueOnce(false)
    transcripts.list.mockResolvedValueOnce([])
    turns.readReceipt.mockResolvedValueOnce({
      turnId: 'turn-receipt-2',
    })
    outbox.deliverMessage.mockResolvedValueOnce({
      delivery: {
        messageId: 'message-1',
        sentAt: '2026-04-08T00:05:00.000Z',
        target: 'actor-1',
      },
      intent: {
        intentId: 'intent-2',
      },
      kind: 'sent',
    })
    sessions.save.mockResolvedValueOnce({
      ...baseSession,
      lastTurnAt: '2026-04-08T00:05:00.000Z',
      turnCount: 1,
      updatedAt: '2026-04-08T00:05:00.000Z',
    })

    await expect(
      welcomeModule.sendAssistantFirstContactWelcomeLocal({
        channel: 'email',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
        vault: '/tmp/test-vault',
      }),
    ).resolves.toMatchObject({
      reason: 'sent',
      turnId: 'turn-receipt-2',
    })
    expect(finalizeAssistantTurnFromDeliveryOutcomeMock).toHaveBeenCalled()

    sessions.resolve.mockResolvedValueOnce({
      session: baseSession,
    })
    hasAssistantSeenFirstContactMock.mockResolvedValueOnce(false)
    transcripts.list.mockResolvedValueOnce([])
    turns.readReceipt.mockResolvedValueOnce({
      turnId: 'turn-receipt-3',
    })
    outbox.deliverMessage.mockResolvedValueOnce({
      deliveryError: null,
      kind: 'failed',
    })

    await expect(
      welcomeModule.sendAssistantFirstContactWelcomeLocal({
        channel: 'email',
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: true,
        vault: '/tmp/test-vault',
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_DELIVERY_FAILED',
    })
  })

  it('reconciles recurring food auto-log jobs across remove, reuse, and recreate paths', async () => {
    const listAssistantCronJobs = vi.fn()
    const removeAssistantCronJob = vi.fn().mockResolvedValue(undefined)
    const addAssistantCronJob = vi.fn()
    const loadVault = vi.fn()
    const loadRuntimeModule = vi.fn().mockResolvedValue({
      loadVault,
    })
    const foodHooksModule = await loadFoodAutoLogHooksModule({
      addAssistantCronJob,
      listAssistantCronJobs,
      loadRuntimeModule,
      removeAssistantCronJob,
    })
    const hooks = foodHooksModule.createAssistantFoodAutoLogHooks()

    listAssistantCronJobs.mockResolvedValueOnce([
      {
        foodAutoLog: {
          foodId: 'food-1',
        },
        jobId: 'job-remove',
        name: 'old-job',
        prompt: 'old-prompt',
        schedule: {
          kind: 'cron',
          expression: '0 6 * * *',
        },
        state: {
          nextRunAt: null,
        },
      },
      {
        foodAutoLog: {
          foodId: 'food-other',
        },
        jobId: 'job-other',
        name: 'other-job',
        prompt: 'other-prompt',
        schedule: {
          kind: 'cron',
          expression: '0 7 * * *',
        },
        state: {
          nextRunAt: null,
        },
      },
    ])
    await expect(
      hooks.syncRecurringFood({
        food: {
          autoLogDaily: null,
          foodId: 'food-1',
          slug: 'banana',
          title: 'Banana',
        },
        vault: '/tmp/test-vault',
      }),
    ).resolves.toBeNull()
    expect(removeAssistantCronJob).toHaveBeenCalledWith('/tmp/test-vault', 'job-remove')

    loadVault.mockResolvedValueOnce({
      metadata: {
        timezone: null,
      },
    })
    listAssistantCronJobs.mockResolvedValueOnce([
      {
        foodAutoLog: {
          foodId: 'food-1',
        },
        jobId: 'job-keep-daily',
        name: buildDailyFoodCronJobName('banana'),
        prompt: buildDailyFoodCronPrompt('Banana'),
        schedule: {
          kind: 'dailyLocal',
          localTime: '07:30',
          timeZone: 'UTC',
        },
        state: {
          nextRunAt: '2026-04-09T07:30:00.000Z',
        },
      },
    ])
    await expect(
      hooks.syncRecurringFood({
        food: {
          autoLogDaily: {
            time: '07:30',
          },
          foodId: 'food-1',
          slug: 'banana',
          title: 'Banana',
        },
        vault: '/tmp/test-vault',
      }),
    ).resolves.toMatchObject({
      jobId: 'job-keep-daily',
    })

    loadVault.mockResolvedValueOnce({
      metadata: {
        timezone: 'Australia/Sydney',
      },
    })
    listAssistantCronJobs.mockResolvedValueOnce([
      {
        foodAutoLog: {
          foodId: 'food-1',
        },
        jobId: 'job-keep-cron',
        name: buildDailyFoodCronJobName('banana'),
        prompt: buildDailyFoodCronPrompt('Banana'),
        schedule: {
          expression: buildDailyFoodCronExpression('08:15'),
          kind: 'cron',
        },
        state: {
          nextRunAt: '2026-04-09T08:15:00.000Z',
        },
      },
    ])
    await expect(
      hooks.syncRecurringFood({
        food: {
          autoLogDaily: {
            time: '08:15',
          },
          foodId: 'food-1',
          slug: 'banana',
          title: 'Banana',
        },
        vault: '/tmp/test-vault',
      }),
    ).resolves.toMatchObject({
      jobId: 'job-keep-cron',
    })

    loadVault.mockResolvedValueOnce({
      metadata: {
        timezone: 'Australia/Sydney',
      },
    })
    listAssistantCronJobs.mockResolvedValueOnce([
      {
        foodAutoLog: {
          foodId: 'food-1',
        },
        jobId: 'job-recreate-1',
        name: 'stale',
        prompt: 'stale',
        schedule: {
          kind: 'dailyLocal',
          localTime: '07:00',
          timeZone: 'UTC',
        },
        state: {
          nextRunAt: null,
        },
      },
      {
        foodAutoLog: {
          foodId: 'food-1',
        },
        jobId: 'job-recreate-2',
        name: buildDailyFoodCronJobName('banana'),
        prompt: buildDailyFoodCronPrompt('Banana'),
        schedule: {
          kind: 'dailyLocal',
          localTime: '09:00',
          timeZone: 'Australia/Sydney',
        },
        state: {
          nextRunAt: null,
        },
      },
    ])
    addAssistantCronJob.mockResolvedValueOnce({
      jobId: 'job-new',
      name: buildDailyFoodCronJobName('banana'),
      state: {
        nextRunAt: null,
      },
    })
    await expect(
      hooks.syncRecurringFood({
        food: {
          autoLogDaily: {
            time: '09:30',
          },
          foodId: 'food-1',
          slug: 'banana',
          title: 'Banana',
        },
        vault: '/tmp/test-vault',
      }),
    ).resolves.toMatchObject({
      jobId: 'job-new',
    })
    expect(removeAssistantCronJob).toHaveBeenCalledWith(
      '/tmp/test-vault',
      'job-recreate-1',
    )
    expect(removeAssistantCronJob).toHaveBeenCalledWith(
      '/tmp/test-vault',
      'job-recreate-2',
    )
    expect(addAssistantCronJob).toHaveBeenCalledWith({
      foodAutoLog: {
        foodId: 'food-1',
      },
      name: buildDailyFoodCronJobName('banana'),
      prompt: buildDailyFoodCronPrompt('Banana'),
      schedule: buildDailyFoodSchedule('09:30', 'Australia/Sydney'),
      vault: '/tmp/test-vault',
    })
  })

  it('delegates local-service conversation open and option updates through the existing store helpers', async () => {
    const resolveAssistantSessionMock = vi.fn()
    const saveAssistantSessionMock = vi.fn()
    const buildResolveAssistantSessionInputMock = vi
      .fn()
      .mockReturnValue({
        channel: 'email',
        sessionId: 'session-service',
        vault: '/tmp/test-vault',
      })

    vi.doMock('../src/assistant/store.js', async () => {
      const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
        '../src/assistant/store.ts',
      )
      return {
        ...actual,
        resolveAssistantSession: resolveAssistantSessionMock,
        saveAssistantSession: saveAssistantSessionMock,
      }
    })
    vi.doMock('../src/assistant/session-resolution.js', async () => {
      const actual = await vi.importActual<
        typeof import('../src/assistant/session-resolution.ts')
      >('../src/assistant/session-resolution.ts')
      return {
        ...actual,
        buildResolveAssistantSessionInput: buildResolveAssistantSessionInputMock,
      }
    })
    vi.doMock('@murphai/operator-config/operator-config', async () => {
      const actual = await vi.importActual<
        typeof import('@murphai/operator-config/operator-config')
      >('@murphai/operator-config/operator-config')
      return {
        ...actual,
        resolveAssistantOperatorDefaults: vi.fn().mockResolvedValue(null),
      }
    })

    const localService = await import('../src/assistant/local-service.ts')
    const session = createAssistantSession({
      sessionId: 'session-service',
    })

    resolveAssistantSessionMock.mockResolvedValueOnce({
      session,
    })
    await localService.openAssistantConversationLocal({
      channel: 'email',
      vault: '/tmp/test-vault',
    })
    expect(buildResolveAssistantSessionInputMock).toHaveBeenCalled()
    expect(resolveAssistantSessionMock).toHaveBeenCalledWith({
      channel: 'email',
      sessionId: 'session-service',
      vault: '/tmp/test-vault',
    })

    resolveAssistantSessionMock.mockResolvedValueOnce({
      session,
    })
    saveAssistantSessionMock.mockResolvedValueOnce({
      ...session,
      providerOptions: {
        ...session.providerOptions,
        model: 'gpt-4.1-mini',
      },
    })
    await localService.updateAssistantSessionOptionsLocal({
      providerOptions: {
        model: 'gpt-4.1-mini',
      },
      sessionId: session.sessionId,
      vault: '/tmp/test-vault',
    })
    expect(saveAssistantSessionMock).toHaveBeenCalledWith(
      '/tmp/test-vault',
      expect.objectContaining({
        providerOptions: expect.objectContaining({
          model: 'gpt-4.1-mini',
        }),
        sessionId: 'session-service',
      }),
    )
  })
})

async function loadPromptAttemptsModule(input: {
  appendAssistantTranscriptEntries: ReturnType<typeof vi.fn>
  listAssistantTranscriptEntries: ReturnType<typeof vi.fn>
}) {
  vi.doMock('../src/assistant/store.js', async () => {
    const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
      '../src/assistant/store.ts',
    )
    return {
      ...actual,
      appendAssistantTranscriptEntries: input.appendAssistantTranscriptEntries,
      listAssistantTranscriptEntries: input.listAssistantTranscriptEntries,
    }
  })

  return await import('../src/assistant/prompt-attempts.ts')
}

async function loadFoodAutoLogHooksModule(input: {
  addAssistantCronJob: ReturnType<typeof vi.fn>
  listAssistantCronJobs: ReturnType<typeof vi.fn>
  loadRuntimeModule: ReturnType<typeof vi.fn>
  removeAssistantCronJob: ReturnType<typeof vi.fn>
}) {
  vi.doMock('../src/assistant/cron.js', () => ({
    addAssistantCronJob: input.addAssistantCronJob,
    listAssistantCronJobs: input.listAssistantCronJobs,
    removeAssistantCronJob: input.removeAssistantCronJob,
  }))
  vi.doMock('@murphai/vault-usecases/runtime', () => ({
    loadRuntimeModule: input.loadRuntimeModule,
  }))

  return await import('../src/assistant/food-auto-log-hooks.ts')
}

async function loadFirstContactWelcomeModule(input: {
  createAssistantRuntimeStateService: () => {
    outbox: {
      createIntent: ReturnType<typeof vi.fn>
      deliverMessage: ReturnType<typeof vi.fn>
    }
    sessions: {
      resolve: ReturnType<typeof vi.fn>
      save: ReturnType<typeof vi.fn>
    }
    status: {
      refreshSnapshot: ReturnType<typeof vi.fn>
    }
    transcripts: {
      append: ReturnType<typeof vi.fn>
      list: ReturnType<typeof vi.fn>
    }
    turns: {
      createReceipt: ReturnType<typeof vi.fn>
      readReceipt: ReturnType<typeof vi.fn>
    }
  }
  finalizeAssistantTurnFromDeliveryOutcome: ReturnType<typeof vi.fn>
  firstContact: {
    hasAssistantSeenFirstContact: ReturnType<typeof vi.fn>
    markAssistantFirstContactSeen: ReturnType<typeof vi.fn>
    resolveAssistantFirstContactStateDocIds: ReturnType<typeof vi.fn>
  }
}) {
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: input.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/delivery-service.js', () => ({
    finalizeAssistantTurnFromDeliveryOutcome:
      input.finalizeAssistantTurnFromDeliveryOutcome,
  }))
  vi.doMock('../src/assistant/first-contact.js', () => input.firstContact)
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    buildResolveAssistantSessionInput: vi.fn().mockReturnValue({
      channel: 'email',
      sessionId: 'session-welcome',
      vault: '/tmp/test-vault',
    }),
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: vi.fn(async (lockInput: {
      run: () => Promise<unknown>
    }) => await lockInput.run()),
  }))
  vi.doMock('@murphai/operator-config/operator-config', async () => {
    const actual = await vi.importActual<
      typeof import('@murphai/operator-config/operator-config')
    >('@murphai/operator-config/operator-config')
    return {
      ...actual,
      resolveAssistantOperatorDefaults: vi.fn().mockResolvedValue(null),
    }
  })

  return await import('../src/assistant/first-contact-welcome-delivery.ts')
}

function createProviderOptions(
  overrides: Partial<AssistantProviderSessionOptions> = {},
): AssistantProviderSessionOptions {
  return {
    apiKeyEnv: 'OPENAI_API_KEY',
    approvalPolicy: null,
    baseUrl: 'https://api.example.test/v1',
    codexHome: null,
    headers: null,
    model: 'gpt-4.1',
    oss: false,
    profile: null,
    providerName: 'murph-openai',
    reasoningEffort: 'high',
    sandbox: null,
    ...overrides,
  }
}

function createAssistantSession(input?: {
  binding?: AssistantSession['binding']
  providerOptions?: AssistantProviderSessionOptions
  sessionId?: string
  target?: AssistantSession['target']
  turnCount?: number
}): AssistantSession {
  const providerOptions = input?.providerOptions ?? createProviderOptions()
  const target: AssistantSession['target'] =
    input?.target ?? {
      adapter: 'openai-compatible',
      apiKeyEnv: providerOptions.apiKeyEnv,
      endpoint: providerOptions.baseUrl,
      headers:
        providerOptions.headers === null || providerOptions.headers === undefined
          ? undefined
          : providerOptions.headers,
      model: providerOptions.model,
      providerName: providerOptions.providerName,
      reasoningEffort: providerOptions.reasoningEffort,
    }

  return {
    alias: null,
    binding: input?.binding ?? {
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
    provider: target.adapter,
    providerBinding: null,
    providerOptions,
    resumeState: null,
    schema: 'murph.assistant-session.v4',
    sessionId: input?.sessionId ?? 'session-test',
    target,
    turnCount: input?.turnCount ?? 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}

function createDeliveryError(
  overrides: Partial<AssistantDeliveryError> = {},
): AssistantDeliveryError {
  return {
    code: 'ASSISTANT_DELIVERY_FAILED',
    message: 'delivery failed',
    retryable: false,
    ...overrides,
  }
}
