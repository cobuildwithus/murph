import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildAssistantFailoverRoutes,
  getAssistantFailoverCooldownUntil,
  isAssistantFailoverRouteCoolingDown,
  readAssistantFailoverState,
  recordAssistantFailoverRouteFailure,
  recordAssistantFailoverRouteSuccess,
  shouldAttemptAssistantProviderFailover,
} from '../src/assistant/failover.ts'

const createdVaultRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, { force: true, recursive: true }),
    ),
  )
})

describe('assistant failover helpers', () => {
  it('dedupes equivalent backup routes after provider-option normalization', () => {
    const routes = buildAssistantFailoverRoutes({
      provider: 'codex-cli',
      codexCommand: 'codex-primary',
      providerOptions: {
        model: 'gpt-oss:20b',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
        profile: 'default',
        oss: false,
      },
      backups: [
        {
          name: 'ollama-a',
          provider: 'openai-compatible',
          codexCommand: null,
          model: 'gpt-oss:20b',
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKeyEnv: null,
          providerName: null,
          cooldownMs: null,
        },
        {
          name: 'ollama-b',
          provider: 'openai-compatible',
          codexCommand: null,
          model: 'gpt-oss:20b',
          reasoningEffort: null,
          sandbox: null,
          approvalPolicy: null,
          profile: null,
          oss: false,
          baseUrl: 'http://127.0.0.1:11434/v1',
          cooldownMs: null,
        },
      ],
    })

    expect(routes).toHaveLength(2)
    expect(routes[0]).toMatchObject({
      provider: 'codex-cli',
      codexCommand: 'codex-primary',
      cooldownMs: 60_000,
    })
    expect(routes[1]).toMatchObject({
      provider: 'openai-compatible',
      codexCommand: null,
      cooldownMs: 60_000,
    })
    expect(routes[1]?.providerOptions.baseUrl).toBe('http://127.0.0.1:11434/v1')
    expect(routes[1]?.providerOptions.apiKeyEnv).toBeUndefined()
    expect(routes[1]?.providerOptions.providerName).toBeUndefined()
  })

  it('records string failures and falls back to the route default cooldown when overrides are non-positive', async () => {
    const vaultRoot = await createVaultRoot()
    const [route] = buildAssistantFailoverRoutes({
      provider: 'codex-cli',
      providerOptions: {
        model: 'gpt-oss:20b',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
        profile: 'default',
        oss: false,
      },
    })

    const failedState = await recordAssistantFailoverRouteFailure({
      vault: vaultRoot,
      at: '2026-04-08T12:00:00.000Z',
      route: route!,
      cooldownMs: 0,
      error: 'string failure',
    })

    const failedRoute = failedState.routes.find((entry) => entry.routeId === route?.routeId)
    expect(failedRoute).toMatchObject({
      cooldownUntil: '2026-04-08T12:01:00.000Z',
      lastErrorCode: null,
      lastErrorMessage: 'string failure',
    })
  })

  it('persists rate-limit cooldown state and clears it after a later success', async () => {
    const vaultRoot = await createVaultRoot()
    const [route] = buildAssistantFailoverRoutes({
      provider: 'codex-cli',
      providerOptions: {
        model: 'gpt-oss:20b',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
        profile: 'default',
        oss: false,
      },
    })

    expect(route).toBeDefined()

    const failedState = await recordAssistantFailoverRouteFailure({
      vault: vaultRoot,
      at: '2026-04-08T12:00:00.000Z',
      route: route!,
      error: Object.assign(new Error('Rate limit exceeded by upstream provider.'), {
        code: 'ASSISTANT_RATE_LIMIT',
      }),
    })

    const failedRoute = failedState.routes.find((entry) => entry.routeId === route?.routeId)
    expect(failedRoute).toMatchObject({
      failureCount: 1,
      successCount: 0,
      consecutiveFailures: 1,
      lastErrorCode: 'ASSISTANT_RATE_LIMIT',
      lastErrorMessage: 'Rate limit exceeded by upstream provider.',
      cooldownUntil: '2026-04-08T12:05:00.000Z',
    })

    const persistedState = await readAssistantFailoverState(vaultRoot)
    expect(
      getAssistantFailoverCooldownUntil({
        route: route!,
        state: persistedState,
      }),
    ).toBe('2026-04-08T12:05:00.000Z')
    expect(
      isAssistantFailoverRouteCoolingDown({
        route: route!,
        state: persistedState,
        now: new Date('2026-04-08T12:04:59.000Z'),
      }),
    ).toBe(true)
    expect(
      isAssistantFailoverRouteCoolingDown({
        route: route!,
        state: persistedState,
        now: new Date('2026-04-08T12:05:00.000Z'),
      }),
    ).toBe(false)

    const recoveredState = await recordAssistantFailoverRouteSuccess({
      vault: vaultRoot,
      at: '2026-04-08T12:06:00.000Z',
      route: route!,
    })

    const recoveredRoute = recoveredState.routes.find(
      (entry) => entry.routeId === route?.routeId,
    )
    expect(recoveredRoute).toMatchObject({
      failureCount: 1,
      successCount: 1,
      consecutiveFailures: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
      cooldownUntil: null,
    })
  })

  it('allows explicit cooldown overrides and returns null for unknown route cooldown lookups', async () => {
    const vaultRoot = await createVaultRoot()
    const [route] = buildAssistantFailoverRoutes({
      provider: 'codex-cli',
      providerOptions: {
        model: 'gpt-oss:20b',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
        profile: 'default',
        oss: false,
      },
    })

    const failedState = await recordAssistantFailoverRouteFailure({
      vault: vaultRoot,
      at: '2026-04-08T12:00:00.000Z',
      route: route!,
      cooldownMs: 2_000,
      error: Object.assign(new Error('connection lost'), {
        context: {
          connectionLost: true,
        },
      }),
    })

    expect(
      getAssistantFailoverCooldownUntil({
        route: route!,
        state: failedState,
      }),
    ).toBe('2026-04-08T12:00:02.000Z')
    expect(
      getAssistantFailoverCooldownUntil({
        route: {
          ...route!,
          routeId: 'missing-route',
        },
        state: failedState,
      }),
    ).toBeNull()
  })

  it('only attempts failover for retryable or connection-loss failures', () => {
    const aborted = new AbortController()
    aborted.abort()

    expect(
      shouldAttemptAssistantProviderFailover({
        abortSignal: aborted.signal,
        error: new Error('request aborted'),
      }),
    ).toBe(false)
    expect(
      shouldAttemptAssistantProviderFailover({
        error: {
          context: {
            interrupted: true,
          },
        },
      }),
    ).toBe(false)
    expect(
      shouldAttemptAssistantProviderFailover({
        error: {
          context: {
            retryable: false,
          },
        },
      }),
    ).toBe(false)
    expect(
      shouldAttemptAssistantProviderFailover({
        error: {
          context: {
            recoverableConnectionLoss: true,
          },
        },
      }),
    ).toBe(true)
    expect(
      shouldAttemptAssistantProviderFailover({
        error: {
          context: {
            connectionLost: true,
          },
        },
      }),
    ).toBe(true)
    expect(
      shouldAttemptAssistantProviderFailover({
        error: Object.assign(new Error('prompt required'), {
          code: 'ASSISTANT_PROMPT_REQUIRED',
        }),
      }),
    ).toBe(false)
    expect(
      shouldAttemptAssistantProviderFailover({
        error: Object.assign(new Error('invalid payload'), {
          code: 'invalid_payload',
        }),
      }),
    ).toBe(false)
    expect(
      shouldAttemptAssistantProviderFailover({
        error: Object.assign(new Error('temporary upstream issue'), {
          context: {
            retryable: true,
          },
        }),
      }),
    ).toBe(true)
    expect(
      shouldAttemptAssistantProviderFailover({
        error: new Error('unexpected provider failure'),
      }),
    ).toBe(true)
  })
})

async function createVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-engine-failover-'))
  createdVaultRoots.push(vaultRoot)
  return vaultRoot
}
