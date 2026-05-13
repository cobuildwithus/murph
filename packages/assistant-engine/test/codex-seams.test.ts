import { rm } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parseAssistantSessionRecord,
  type AssistantProviderSessionOptions,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeAssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import {
  type AssistantProviderProgressEvent,
  createAssistantProviderToolProgressEvent,
  mergeAssistantProviderActivityLabels,
  summarizeAssistantProviderActivityLabels,
} from '../src/assistant/provider-progress.ts'
import {
  annotateRecoveredCodexThreadIdForDiagnostics,
  extractRecoveredCodexThreadId,
  isAssistantProviderConnectionLostError,
  isAssistantProviderInterruptedError,
  isAssistantProviderStalledError,
} from '../src/assistant/provider-failure-diagnostics.ts'
import {
  resolveAssistantResumeStateFromProviderTurn,
} from '../src/assistant/turn-finalizer.ts'
import {
  doesAssistantResumeBindingMatchRoute,
  resolveAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding,
} from '../src/assistant/codex-resume-binding.ts'
import {
  normalizeAssistantSessionResumeState,
  readAssistantCodexRolloutRelativePath,
  readAssistantProviderResumeRouteId,
  readAssistantCodexThreadId,
  readAssistantSessionResumeState,
  serializeAssistantSessionForPersistence,
  writeAssistantProviderResumeRouteId,
  writeAssistantSessionCodexRolloutRelativePath,
  writeAssistantSessionCodexThreadId,
  writeAssistantSessionThreadInstructionsFingerprint,
} from '../src/assistant/provider-state.ts'
import {
  buildCodexThreadIdentity,
  type CodexThreadIdentity,
} from '../src/assistant/codex-thread-route.ts'
import { createAssistantRuntimeStateService } from '../src/assistant/runtime-state-service.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []
const codexThreadId = '00000000-0000-4000-8000-000000000123'
const codexRolloutRelativePath =
  `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${codexThreadId}.jsonl`

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        recursive: true,
        force: true,
      }),
    ),
  )
})

describe('assistant Codex seam helpers', () => {
  it('stabilizes hosted Codex homes without dropping explicit local Codex home identity', () => {
    const firstHostedRoute = buildCodexThreadIdentity(
      normalizeAssistantProviderConfig({
        codexHome: '/tmp/runner-a/home/.codex-hosted',
        model: 'gpt-synthetic',
        modelProvider: 'hosted-openai',
      }),
    )
    const secondHostedRoute = buildCodexThreadIdentity(
      normalizeAssistantProviderConfig({
        codexHome: '/tmp/runner-b/home/.codex-hosted',
        model: 'gpt-synthetic',
        modelProvider: 'hosted-openai',
      }),
    )
    const firstLocalRoute = buildCodexThreadIdentity(
      normalizeAssistantProviderConfig({
        codexHome: '/tmp/local-codex-home-a',
        model: 'gpt-synthetic',
        modelProvider: 'openai',
      }),
    )
    const secondLocalRoute = buildCodexThreadIdentity(
      normalizeAssistantProviderConfig({
        codexHome: '/tmp/local-codex-home-b',
        model: 'gpt-synthetic',
        modelProvider: 'openai',
      }),
    )

    expect(secondHostedRoute.routeId).toBe(firstHostedRoute.routeId)
    expect(secondLocalRoute.routeId).not.toBe(firstLocalRoute.routeId)
  })

  it('matches resume bindings only when the stored route id matches exactly', () => {
    const previousResumeState = {
      threadId: 'provider_session_alpha',
      resumeRouteId: 'route-primary',
    }
    const rotatedRoute = createRoute({
      providerOptions: {
        codexHome: '/tmp/local-codex-home',
        continuityFingerprint: 'fingerprint-shared',
      },
      routeId: 'route-secondary',
    })

    expect(
      doesAssistantResumeBindingMatchRoute({
        resumeState: previousResumeState,
        route: createRoute({
          routeId: 'route-primary',
        }),
      }),
    ).toBe(true)
    expect(
      resolveAssistantRouteResumeBinding({
        route: createRoute({
          routeId: 'route-primary',
        }),
        sessionResumeState: previousResumeState,
      }),
    ).toEqual({
      routeFingerprint: 'route-primary',
      threadId: 'provider_session_alpha',
    })

    expect(
      doesAssistantResumeBindingMatchRoute({
        resumeState: previousResumeState,
        route: rotatedRoute,
      }),
    ).toBe(false)
    expect(
      resolveAssistantRouteResumeBinding({
        route: rotatedRoute,
        sessionResumeState: previousResumeState,
      }),
    ).toBeNull()
  })

  it('records recovered Codex thread ids without persisting failed-turn resume state', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-assistant-provider-recovery-',
    )
    cleanupPaths.push(parentRoot)

    const session = createAssistantSession({
      codexThreadId: 'provider_session_old',
      resumeRouteId: 'route-primary',
    })
    const error = {
      context: {
        connectionLost: true,
        codexThreadId: ' provider_session_new ',
      },
    }

    annotateRecoveredCodexThreadIdForDiagnostics(error)

    expect(error.context).toMatchObject({
      recoveredCodexThreadId: 'provider_session_new',
    })

    await expect(
      createAssistantRuntimeStateService(vaultRoot).sessions.get(session.sessionId),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_NOT_FOUND',
    })
  })

  it('keeps provider failure diagnostics metadata-only and ignores non-recoverable states', () => {
    const skipped = {
      context: {
        codexThreadId: 'provider_session_current',
      },
    }
    annotateRecoveredCodexThreadIdForDiagnostics(skipped)

    expect(skipped.context).not.toHaveProperty('recoveredCodexThreadId')

    const error = {
      context: {
        connectionLost: true,
        codexThreadId: 'provider_session_recovered',
        requestId: 'req_123',
      },
    }

    annotateRecoveredCodexThreadIdForDiagnostics(error)

    expect(error.context.requestId).toBe('req_123')
    expect(error.context).toMatchObject({
      recoveredCodexThreadId: 'provider_session_recovered',
    })

    const interrupted = {
      context: {
        interrupted: true,
        codexThreadId: ' provider_session_interrupted ',
      },
    }
    annotateRecoveredCodexThreadIdForDiagnostics(interrupted)

    expect(interrupted.context).toMatchObject({
      recoveredCodexThreadId: 'provider_session_interrupted',
    })
  })

  it('normalizes tool progress labels and merges unique provider activity labels', () => {
    expect(
      createAssistantProviderToolProgressEvent({
        label: '   ',
        rawEvent: {
          type: 'tool_call',
        },
        state: 'running',
        text: 'using tool',
      }),
    ).toBeNull()

    expect(
      createAssistantProviderToolProgressEvent({
        label: '  Search   Web  ',
        rawEvent: {
          type: 'tool_call',
        },
        safeText: '   ',
        state: 'running',
        text: 'using Search Web',
      }),
    ).toEqual({
      id: null,
      kind: 'tool',
      label: '  Search   Web  ',
      rawEvent: {
        type: 'tool_call',
      },
      safeLabel: 'Search Web',
      safeText: 'using Search Web',
      state: 'running',
      text: 'using Search Web',
    })

    const merged = mergeAssistantProviderActivityLabels({
      events: [
        createProgressEvent({
          kind: 'tool',
          label: ' Search Web ',
          safeLabel: 'Search Web',
        }),
        createProgressEvent({
          kind: 'command',
          label: '  Read File ',
        }),
        createProgressEvent({
          kind: 'tool',
          label: 'Search Web',
        }),
        createProgressEvent({
          kind: 'message',
          label: 'ignored',
        }),
      ],
      labels: [' Existing Label ', ''],
      maxLabels: 3,
    })

    expect(merged).toEqual(['Existing Label', 'Search Web', 'Read File'])
    expect(summarizeAssistantProviderActivityLabels([], 0)).toEqual([])
  })

  it('normalizes resumable state and only persists explicit resume state', () => {
    expect(
      normalizeAssistantSessionResumeState({
        threadId: '   ',
        resumeRouteId: ' route-primary ',
      }),
    ).toBeNull()

    const persisted = serializeAssistantSessionForPersistence({
      ...createAssistantSession(),
      resumeState: {
        rolloutRelativePath: codexRolloutRelativePath,
        routeFingerprint: 'route-resume',
        threadId: codexThreadId,
      },
    })
    expect(persisted.codexResume).toEqual({
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-resume',
      threadId: codexThreadId,
    })
    expect(readAssistantCodexRolloutRelativePath(persisted)).toBe(codexRolloutRelativePath)

    expect(normalizeAssistantSessionResumeState(null)).toBeNull()
    expect(readAssistantSessionResumeState(null)).toBeNull()
    expect(readAssistantSessionResumeState({})).toBeNull()
    expect(
      readAssistantSessionResumeState({
        codexResume: {
          routeFingerprint: 'canonical-route',
          threadId: 'canonical-thread',
        },
        resumeState: {
          routeFingerprint: 'legacy-route',
          threadId: 'legacy-thread',
        },
      }),
    ).toEqual({
      routeFingerprint: 'canonical-route',
      threadId: 'canonical-thread',
    })
    expect(writeAssistantProviderResumeRouteId(null, null)).toBeNull()
    expect(writeAssistantSessionCodexThreadId(null, null)).toBeNull()
    expect(
      writeAssistantProviderResumeRouteId(
        writeAssistantSessionCodexThreadId(null, null),
        'route-only',
      ),
    ).toBeNull()
    expect(
      writeAssistantSessionThreadInstructionsFingerprint(
        {
          rolloutRelativePath: codexRolloutRelativePath,
          routeFingerprint: 'route-resume',
          threadId: codexThreadId,
        },
        `thread-instructions-v1:${'c'.repeat(64)}:${'d'.repeat(64)}`,
      ),
    ).toEqual({
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-resume',
      threadId: codexThreadId,
    })
    expect(
      writeAssistantSessionCodexRolloutRelativePath(
        {
          routeFingerprint: 'route-resume',
          threadId: codexThreadId,
        },
        codexRolloutRelativePath,
      ),
    ).toEqual({
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-resume',
      threadId: codexThreadId,
    })
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        codexRolloutRelativePath,
        codexThreadId: codexThreadId,
        routeFingerprint: 'route-resume',
      }),
    ).toEqual({
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-resume',
      threadId: codexThreadId,
    })

    const missingTargetSession = createAssistantSession()
    Reflect.set(missingTargetSession, 'target', null)
    Reflect.set(missingTargetSession, 'codexTarget', null)
    expect(() => serializeAssistantSessionForPersistence(missingTargetSession)).toThrow(
      'Assistant conversation Codex target is required.',
    )
  })

  it('classifies provider failure helpers', () => {
    const error = {
      context: {
        connectionLost: true,
        interrupted: true,
        codexThreadId: ' provider_session_recovered ',
        providerStalled: true,
      },
    }

    expect(extractRecoveredCodexThreadId(error)).toBe('provider_session_recovered')
    expect(isAssistantProviderConnectionLostError(error)).toBe(true)
    expect(isAssistantProviderInterruptedError(error)).toBe(true)
    expect(isAssistantProviderStalledError(error)).toBe(true)
    expect(extractRecoveredCodexThreadId({ context: { codexThreadId: '   ' } })).toBeNull()
  })

  it('rejects route drift even when unrelated provider options stay compatible', () => {
    const resumeState = {
      threadId: 'provider_session_alpha',
      resumeRouteId: 'route-primary',
    }

    expect(
      resolveAssistantProviderResumeKey({
        resumeState,
      }),
    ).toBe('provider_session_alpha')

    expect(
      doesAssistantResumeBindingMatchRoute({
        resumeState,
        route: createRoute({
          providerOptions: {
            codexHome: '/tmp/codex-home-b',
            continuityFingerprint: 'fingerprint-rotated',
          },
          routeId: 'route-rotated',
        }),
      }),
    ).toBe(false)

    expect(
      doesAssistantResumeBindingMatchRoute({
        resumeState: {
          threadId: 'provider_session_beta',
          resumeRouteId: 'route-primary',
        },
        route: createRoute({
          providerOptions: {
            continuityFingerprint: 'fingerprint-shared',
          },
          routeId: 'route-headers-rotated',
        }),
      }),
    ).toBe(false)
  })

  it('rejects missing resume state and blank stored route ids', () => {
    expect(
      resolveAssistantProviderResumeKey({
        resumeState: null,
      }),
    ).toBeNull()

    expect(
      doesAssistantResumeBindingMatchRoute({
        resumeState: null,
        route: createRoute(),
      }),
    ).toBe(false)

    expect(
      doesAssistantResumeBindingMatchRoute({
        resumeState: {
          threadId: 'provider_session_alpha',
          resumeRouteId: '   ',
        },
        route: createRoute(),
      }),
    ).toBe(false)

    expect(
      resolveAssistantRouteResumeBinding({
        route: createRoute(),
        sessionResumeState: {
          threadId: 'provider_session_alpha',
          resumeRouteId: null,
        },
      }),
    ).toBeNull()
  })
})

function createRoute(input?: {
  providerOptions?: Partial<AssistantProviderSessionOptions>
  routeId?: string
}): CodexThreadIdentity {
  const routeFingerprint = input?.routeId ?? 'route-primary'
  return {
    codexCommand: null,
    label: 'primary',
    provider: 'codex-cli',
    providerOptions: createProviderOptions(input?.providerOptions),
    routeFingerprint,
    routeId: routeFingerprint,
  }
}

function createProviderOptions(
  overrides?: Partial<AssistantProviderSessionOptions>,
): AssistantProviderSessionOptions {
  return {
    provider: 'codex-cli',
    continuityFingerprint: 'fingerprint-default',
    executionDriver: 'codex-app-server',
    model: 'gpt-5.5',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    approvalPolicy: 'never',
    profile: null,
    oss: false,
    modelProvider: null,
    resumeKind: 'codex-thread',
    ...overrides,
  }
}

function createAssistantSession(input?: {
  codexThreadId?: string | null
  resumeRouteId?: string | null
}): AssistantSession {
  const resumeState =
    input?.codexThreadId || input?.resumeRouteId
      ? {
          routeFingerprint: input?.resumeRouteId ?? null,
          threadId: input?.codexThreadId ?? '',
        }
      : null
  const target = {
    adapter: 'codex-cli' as const,
    approvalPolicy: 'never' as const,
    codexCommand: null,
    codexHome: null,
    model: 'gpt-5.5',
    modelProvider: null,
    oss: false,
    profile: null,
    reasoningEffort: 'medium' as const,
    sandbox: 'danger-full-access' as const,
  }

  return parseAssistantSessionRecord({
    schema: 'murph.assistant-conversation.v2',
    conversationId: 'session_provider_seam_test',
    codexTarget: target,
    codexResume: resumeState,
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
    updatedAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
  })
}

function createProgressEvent(
  input: Pick<AssistantProviderProgressEvent, 'kind'> & {
    label?: string | null
    safeLabel?: string | null
  },
): AssistantProviderProgressEvent {
  return {
    id: null,
    kind: input.kind,
    label: input.label ?? null,
    rawEvent: {
      type: input.kind,
    },
    safeLabel: input.safeLabel ?? null,
    safeText: null,
    state: 'running',
    text: input.label ?? input.kind,
  }
}
