import { rm } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import {
  parseAssistantSessionRecord,
  type AssistantProviderBinding,
  type AssistantProviderSessionOptions,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
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
  doesAssistantResumeBindingMatchRoute,
  resolveAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding,
} from '../src/assistant/provider-binding.ts'
import {
  normalizeAssistantSessionResumeState,
  readAssistantProviderResumeRouteId,
  readAssistantProviderSessionId,
  readAssistantSessionResumeState,
  serializeAssistantSessionForPersistence,
  writeAssistantProviderResumeRouteId,
  writeAssistantSessionProviderSessionId,
} from '../src/assistant/provider-state.ts'
import type { ResolvedAssistantFailoverRoute } from '../src/assistant/failover.ts'
import { createAssistantRuntimeStateService } from '../src/assistant/runtime-state-service.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

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
  it('matches resume bindings only when the stored route id matches exactly', () => {
    const previousBinding = createProviderBinding({
      providerOptions: {
        codexHome: null,
        continuityFingerprint: 'fingerprint-shared',
        headers: {
          Authorization: 'Bearer token',
          'X-Trace': '1',
        },
      },
      providerSessionId: 'provider_session_alpha',
      resumeRouteId: 'route-primary',
    })
    const rotatedRoute = createRoute({
      providerOptions: {
        codexHome: '/tmp/local-codex-home',
        continuityFingerprint: 'fingerprint-shared',
        headers: {
          'X-Trace': '1',
          Authorization: 'Bearer token',
        },
      },
      routeId: 'route-secondary',
    })

    expect(
      doesAssistantResumeBindingMatchRoute({
        binding: previousBinding,
        route: createRoute({
          providerOptions: {
            ...previousBinding.providerOptions,
            headers: {
              Authorization: 'Bearer token',
              'X-Trace': '1',
            },
          },
          routeId: 'route-primary',
        }),
      }),
    ).toBe(true)
    expect(
      resolveAssistantRouteResumeBinding({
        route: createRoute({
          providerOptions: {
            ...previousBinding.providerOptions,
            headers: {
              Authorization: 'Bearer token',
              'X-Trace': '1',
            },
          },
          routeId: 'route-primary',
        }),
        sessionBinding: previousBinding,
      }),
    ).toEqual(previousBinding)

    expect(
      doesAssistantResumeBindingMatchRoute({
        binding: previousBinding,
        route: rotatedRoute,
      }),
    ).toBe(false)
    expect(
      resolveAssistantRouteResumeBinding({
        route: rotatedRoute,
        sessionBinding: previousBinding,
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
    expect(persisted?.providerBinding).toMatchObject({
      provider: 'openai-compatible',
      providerSessionId: 'provider_session_new',
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

  it('normalizes resumable state and persists resume state from bindings when needed', () => {
    expect(
      normalizeAssistantSessionResumeState({
        providerSessionId: '   ',
        resumeRouteId: ' route-primary ',
      }),
    ).toBeNull()

    const persisted = serializeAssistantSessionForPersistence({
      ...createAssistantSession(),
      providerBinding: createProviderBinding({
        providerSessionId: 'provider_session_bound',
        resumeRouteId: 'route-bound',
      }),
      resumeState: null,
    })
    expect(persisted.resumeState).toEqual({
      providerSessionId: 'provider_session_bound',
      resumeRouteId: 'route-bound',
    })

    expect(normalizeAssistantSessionResumeState(null)).toBeNull()
    expect(readAssistantSessionResumeState(null)).toBeNull()
    expect(
      readAssistantSessionResumeState({
        providerBinding: createProviderBinding({
          providerSessionId: 'provider-session-from-binding',
          resumeRouteId: 'route-from-binding',
        }),
      }),
    ).toEqual({
      providerSessionId: 'provider-session-from-binding',
      resumeRouteId: 'route-from-binding',
    })
    expect(writeAssistantProviderResumeRouteId(null, null)).toBeNull()
    expect(writeAssistantSessionProviderSessionId(null, null)).toBeNull()
    expect(
      writeAssistantProviderResumeRouteId(
        writeAssistantSessionProviderSessionId(null, null),
        'route-only',
      ),
    ).toBeNull()

    const missingTargetSession = createAssistantSession()
    Reflect.set(missingTargetSession, 'target', null)
    expect(() => serializeAssistantSessionForPersistence(missingTargetSession)).toThrow(
      'Assistant session target is required.',
    )

    const mismatchedBindingSession = createAssistantSession()
    mismatchedBindingSession.providerBinding = {
      ...createProviderBinding({
        providerSessionId: 'provider-session-mismatch',
        resumeRouteId: 'route-mismatch',
      }),
      provider: 'codex-cli',
    }
    mismatchedBindingSession.resumeState = null
    expect(serializeAssistantSessionForPersistence(mismatchedBindingSession).resumeState).toBeNull()
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
    const binding = createProviderBinding({
      providerOptions: {
        codexHome: '/tmp/codex-home-a',
        continuityFingerprint: 'fingerprint-shared',
        headers: {},
      },
      providerSessionId: 'provider_session_alpha',
      resumeRouteId: 'route-primary',
    })

    expect(
      resolveAssistantProviderResumeKey({
        binding,
        provider: 'openai-compatible',
      }),
    ).toBe('provider_session_alpha')
    expect(
      resolveAssistantProviderResumeKey({
        binding,
        provider: 'codex-cli',
      }),
    ).toBeNull()

    expect(
      doesAssistantResumeBindingMatchRoute({
        binding,
        route: createRoute({
          providerOptions: {
            ...binding.providerOptions,
            codexHome: '/tmp/codex-home-b',
            headers: null,
            continuityFingerprint: 'fingerprint-rotated',
          },
          routeId: 'route-rotated',
        }),
      }),
    ).toBe(false)

    expect(
      doesAssistantResumeBindingMatchRoute({
        binding: createProviderBinding({
          providerOptions: {
            continuityFingerprint: 'fingerprint-shared',
            headers: {},
          },
          providerSessionId: 'provider_session_beta',
          resumeRouteId: 'route-primary',
        }),
        route: createRoute({
          providerOptions: {
            continuityFingerprint: 'fingerprint-shared',
            headers: null,
          },
          routeId: 'route-headers-rotated',
        }),
      }),
    ).toBe(false)
  })
})

function createRoute(input?: {
  providerOptions?: Partial<AssistantProviderSessionOptions>
  routeId?: string
}): ResolvedAssistantFailoverRoute {
  return {
    codexCommand: null,
    cooldownMs: 60_000,
    label: 'primary',
    provider: 'openai-compatible',
    providerOptions: createProviderOptions(input?.providerOptions),
    routeId: input?.routeId ?? 'route-primary',
  }
}

function createProviderBinding(input?: {
  providerOptions?: Partial<AssistantProviderSessionOptions>
  providerSessionId?: string | null
  resumeRouteId?: string | null
}): AssistantProviderBinding {
  return {
    provider: 'openai-compatible',
    providerOptions: createProviderOptions(input?.providerOptions),
    providerSessionId: input?.providerSessionId ?? null,
    providerState:
      input?.resumeRouteId === undefined
        ? {
            resumeRouteId: 'route-primary',
          }
        : input.resumeRouteId
          ? {
              resumeRouteId: input.resumeRouteId,
            }
          : null,
  }
}

function createProviderOptions(
  overrides?: Partial<AssistantProviderSessionOptions>,
): AssistantProviderSessionOptions {
  return {
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
    updatedAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
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
