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
  attachRecoveredAssistantSession,
  extractRecoveredProviderSessionId,
  extractRecoveredAssistantSession,
  isAssistantProviderConnectionLostError,
  isAssistantProviderInterruptedError,
  isAssistantProviderStalledError,
  recoverAssistantSessionAfterProviderFailure,
} from '../src/assistant/provider-turn-recovery.ts'
import {
  resolveAssistantResumeStateFromProviderTurn,
} from '../src/assistant/turn-finalizer.ts'
import {
  doesAssistantResumeBindingMatchRoute,
  resolveAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding,
} from '../src/assistant/provider-binding.ts'
import {
  normalizeAssistantSessionResumeState,
  readAssistantCodexRolloutRelativePath,
  readAssistantProviderResumeRouteId,
  readAssistantProviderSessionId,
  readAssistantSessionResumeState,
  serializeAssistantSessionForPersistence,
  writeAssistantProviderResumeRouteId,
  writeAssistantSessionCodexRolloutRelativePath,
  writeAssistantSessionProviderSessionId,
  writeAssistantSessionThreadInstructionsFingerprint,
} from '../src/assistant/provider-state.ts'
import {
  buildCodexThreadIdentity,
  type CodexThreadIdentity,
} from '../src/assistant/provider-route.ts'
import { createAssistantRuntimeStateService } from '../src/assistant/runtime-state-service.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []
const threadInstructionsFingerprint =
  `thread-instructions-v1:${'a'.repeat(64)}:${'b'.repeat(64)}`
const nextThreadInstructionsFingerprint =
  `thread-instructions-v1:${'c'.repeat(64)}:${'d'.repeat(64)}`
const codexProviderSessionId = '00000000-0000-4000-8000-000000000123'
const codexRolloutRelativePath =
  `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${codexProviderSessionId}.jsonl`

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

describe('assistant provider seam helpers', () => {
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
      providerSessionId: 'provider_session_alpha',
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
    ).toEqual(previousResumeState)

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

  it('recovers and persists a replacement provider session after connection loss', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-assistant-provider-recovery-',
    )
    cleanupPaths.push(parentRoot)

    const session = createAssistantSession({
      providerSessionId: 'provider_session_old',
      resumeRouteId: 'route-primary',
    })
    const error = {
      context: {
        connectionLost: true,
        providerSessionId: ' provider_session_new ',
      },
    }

    const recovered = await recoverAssistantSessionAfterProviderFailure({
      error,
      routeId: 'route-recovered',
      session,
      vault: vaultRoot,
    })

    expect(recovered).not.toBeNull()
    expect(readAssistantProviderSessionId(recovered!)).toBe('provider_session_new')
    expect(readAssistantProviderResumeRouteId(recovered!)).toBe('route-recovered')
    expect(recovered?.updatedAt).not.toBe(session.updatedAt)

    const persisted = await createAssistantRuntimeStateService(vaultRoot).sessions.get(
      session.sessionId,
    )
    expect(readAssistantProviderSessionId(persisted)).toBe('provider_session_new')
    expect(readAssistantProviderResumeRouteId(persisted)).toBe('route-recovered')
    expect(persisted?.resumeState).toEqual({
      providerSessionId: 'provider_session_new',
      resumeRouteId: 'route-recovered',
    })
  })

  it('attaches normalized recovered sessions to provider errors and ignores non-recoverable states', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'murph-assistant-provider-recovery-skip-',
    )
    cleanupPaths.push(parentRoot)

    const session = createAssistantSession({
      providerSessionId: 'provider_session_current',
      resumeRouteId: 'route-primary',
    })
    const skipped = await recoverAssistantSessionAfterProviderFailure({
      error: {
        context: {
          providerSessionId: 'provider_session_current',
          recoverableConnectionLoss: true,
        },
      },
      routeId: 'route-recovered',
      session,
      vault: vaultRoot,
    })

    expect(skipped).toBeNull()

    const error = {
      context: {
        connectionLost: true,
        providerSessionId: 'provider_session_recovered',
        requestId: 'req_123',
      },
    }
    const recoveredSession = createAssistantSession({
      providerSessionId: 'provider_session_recovered',
      resumeRouteId: 'route-recovered',
    })

    attachRecoveredAssistantSession(error, recoveredSession)

    expect(error.context.requestId).toBe('req_123')
    expect(extractRecoveredAssistantSession(error)).toEqual(
      parseAssistantSessionRecord(serializeAssistantSessionForPersistence(recoveredSession)),
    )
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
        providerSessionId: '   ',
        resumeRouteId: ' route-primary ',
      }),
    ).toBeNull()

    const persisted = serializeAssistantSessionForPersistence({
      ...createAssistantSession(),
      resumeState: {
        codexRolloutRelativePath: ` ${codexRolloutRelativePath} `,
        providerSessionId: codexProviderSessionId,
        resumeRouteId: 'route-resume',
        threadInstructionsFingerprint,
      },
    })
    expect(persisted.resumeState).toEqual({
      codexRolloutRelativePath,
      providerSessionId: codexProviderSessionId,
      resumeRouteId: 'route-resume',
      threadInstructionsFingerprint,
    })
    expect(readAssistantCodexRolloutRelativePath(persisted)).toBe(codexRolloutRelativePath)

    expect(normalizeAssistantSessionResumeState(null)).toBeNull()
    expect(readAssistantSessionResumeState(null)).toBeNull()
    expect(readAssistantSessionResumeState({})).toBeNull()
    expect(writeAssistantProviderResumeRouteId(null, null)).toBeNull()
    expect(writeAssistantSessionProviderSessionId(null, null)).toBeNull()
    expect(
      writeAssistantProviderResumeRouteId(
        writeAssistantSessionProviderSessionId(null, null),
        'route-only',
      ),
    ).toBeNull()
    expect(
      writeAssistantSessionThreadInstructionsFingerprint(
        {
          codexRolloutRelativePath,
          providerSessionId: codexProviderSessionId,
          resumeRouteId: 'route-resume',
        },
        ` ${nextThreadInstructionsFingerprint} `,
      ),
    ).toEqual({
      codexRolloutRelativePath,
      providerSessionId: codexProviderSessionId,
      resumeRouteId: 'route-resume',
      threadInstructionsFingerprint: nextThreadInstructionsFingerprint,
    })
    expect(
      writeAssistantSessionCodexRolloutRelativePath(
        {
          providerSessionId: codexProviderSessionId,
          resumeRouteId: 'route-resume',
        },
        codexRolloutRelativePath,
      ),
    ).toEqual({
      codexRolloutRelativePath,
      providerSessionId: codexProviderSessionId,
      resumeRouteId: 'route-resume',
    })
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        codexRolloutRelativePath,
        providerSessionId: codexProviderSessionId,
        routeId: 'route-resume',
        threadInstructionsFingerprint,
      }),
    ).toEqual({
      codexRolloutRelativePath,
      providerSessionId: codexProviderSessionId,
      resumeRouteId: 'route-resume',
      threadInstructionsFingerprint,
    })

    const missingTargetSession = createAssistantSession()
    Reflect.set(missingTargetSession, 'target', null)
    expect(() => serializeAssistantSessionForPersistence(missingTargetSession)).toThrow(
      'Assistant session target is required.',
    )
  })

  it('classifies provider failure helpers', () => {
    const error = {
      context: {
        connectionLost: true,
        interrupted: true,
        providerSessionId: ' provider_session_recovered ',
        providerStalled: true,
      },
    }

    expect(extractRecoveredProviderSessionId(error)).toBe('provider_session_recovered')
    expect(isAssistantProviderConnectionLostError(error)).toBe(true)
    expect(isAssistantProviderInterruptedError(error)).toBe(true)
    expect(isAssistantProviderStalledError(error)).toBe(true)
    expect(extractRecoveredProviderSessionId({ context: { providerSessionId: '   ' } })).toBeNull()
    expect(extractRecoveredAssistantSession(null)).toBeNull()
    expect(extractRecoveredAssistantSession({ context: { assistantSession: 'bad' } })).toBeNull()
    expect(
      extractRecoveredAssistantSession({
        context: {
          assistantSession: {
            sessionId: 'missing-required-fields',
          },
        },
      }),
    ).toBeNull()
  })

  it('rejects route drift even when unrelated provider options stay compatible', () => {
    const resumeState = {
      providerSessionId: 'provider_session_alpha',
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
          providerSessionId: 'provider_session_beta',
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
          providerSessionId: 'provider_session_alpha',
          resumeRouteId: '   ',
        },
        route: createRoute(),
      }),
    ).toBe(false)

    expect(
      resolveAssistantRouteResumeBinding({
        route: createRoute(),
        sessionResumeState: {
          providerSessionId: 'provider_session_alpha',
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
  return {
    codexCommand: null,
    label: 'primary',
    provider: 'codex-cli',
    providerOptions: createProviderOptions(input?.providerOptions),
    routeId: input?.routeId ?? 'route-primary',
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
  providerSessionId?: string | null
  resumeRouteId?: string | null
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
    sessionId: 'session_provider_seam_test',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: 'gpt-5.5',
      modelProvider: null,
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
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
    updatedAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
    provider: 'codex-cli',
    providerOptions: createProviderOptions(),
  }
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
