import {
  HOSTED_CLI_BRIDGE_ROUTE_GRANT_ENV,
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
} from '@murphai/hosted-execution/cli-runtime-bridge'
import { describe, expect, it } from 'vitest'

import {
  resolveHostedCodexTurnBoundary,
  type HostedCodexTurnBoundary,
} from '../src/assistant-codex/config.ts'

function requireHostedBoundary(input: Parameters<
  typeof resolveHostedCodexTurnBoundary
>[0]): HostedCodexTurnBoundary {
  const boundary = resolveHostedCodexTurnBoundary(input)
  expect(boundary).not.toBeNull()
  if (!boundary) {
    throw new Error('Expected a hosted Codex turn boundary.')
  }
  return boundary
}

describe('hosted Codex turn boundary', () => {
  it('supports a bridge-token-only turn without route authority', () => {
    const boundary = requireHostedBoundary({
      env: {
        [HOSTED_CLI_BRIDGE_TOKEN_ENV]: 'bridge-token-current',
        PATH: '/custom/bin',
      },
    })

    expect(boundary).toEqual({
      ephemeralApiKey: null,
      residentEnv: {
        PATH: '/custom/bin',
      },
      threadConfig: {
        [`shell_environment_policy.set.${HOSTED_CLI_BRIDGE_TOKEN_ENV}`]:
          'bridge-token-current',
      },
    })
  })

  it('treats a blank route grant as absent and strips it from the resident environment', () => {
    const boundary = requireHostedBoundary({
      env: {
        [HOSTED_CLI_BRIDGE_ROUTE_GRANT_ENV]: ' \t ',
        [HOSTED_CLI_BRIDGE_TOKEN_ENV]: 'bridge-token-current',
      },
    })

    expect(boundary.residentEnv).not.toHaveProperty(
      HOSTED_CLI_BRIDGE_ROUTE_GRANT_ENV,
    )
    expect(boundary.residentEnv).not.toHaveProperty(
      HOSTED_CLI_BRIDGE_TOKEN_ENV,
    )
    expect(boundary.threadConfig).toEqual({
      [`shell_environment_policy.set.${HOSTED_CLI_BRIDGE_TOKEN_ENV}`]:
        'bridge-token-current',
    })
  })

  it('projects a nonblank route grant only into the current thread configuration', () => {
    const boundary = requireHostedBoundary({
      env: {
        [HOSTED_CLI_BRIDGE_ROUTE_GRANT_ENV]: 'route-grant-current',
        [HOSTED_CLI_BRIDGE_TOKEN_ENV]: 'bridge-token-current',
      },
    })

    expect(boundary.residentEnv).toEqual({})
    expect(boundary.threadConfig).toEqual({
      [`shell_environment_policy.set.${HOSTED_CLI_BRIDGE_ROUTE_GRANT_ENV}`]:
        'route-grant-current',
      [`shell_environment_policy.set.${HOSTED_CLI_BRIDGE_TOKEN_ENV}`]:
        'bridge-token-current',
    })
  })

  it.each([
    'OPENAI_API_KEY',
    'VERCEL_AI_API_KEY',
  ] as const)(
    'supports a provider-only hosted boundary for %s without exposing it to thread config',
    (providerCredentialEnvKey) => {
      const providerCredential = `credential-for-${providerCredentialEnvKey}`
      const boundary = requireHostedBoundary({
        env: {
          [providerCredentialEnvKey]: providerCredential,
          PATH: '/custom/bin',
        },
        providerCredentialEnvKey,
      })

      expect(boundary.ephemeralApiKey).toBe(providerCredential)
      expect(boundary.residentEnv).toEqual({
        PATH: '/custom/bin',
      })
      expect(boundary.threadConfig).toEqual({})
      const serializedThreadConfig = JSON.stringify(boundary.threadConfig)
      expect(serializedThreadConfig).not.toContain(providerCredentialEnvKey)
      expect(serializedThreadConfig).not.toContain(providerCredential)
    },
  )

  it('fails closed when a provider credential hint is invalid or unavailable', () => {
    expect(() => resolveHostedCodexTurnBoundary({
      env: {},
      providerCredentialEnvKey: 'INVALID-PROVIDER-KEY',
    })).toThrow('Hosted Codex provider credential environment key is invalid.')

    expect(() => resolveHostedCodexTurnBoundary({
      env: {},
      providerCredentialEnvKey: 'OPENAI_API_KEY',
    })).toThrow('Hosted Codex provider authentication is unavailable for this turn.')
  })
})
