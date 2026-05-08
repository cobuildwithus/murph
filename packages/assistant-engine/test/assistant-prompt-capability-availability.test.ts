import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantExecutionContext,
} from '../src/assistant/execution-context.js'
import {
  resolveAssistantPromptCapabilityAvailability,
} from '../src/assistant/provider-turn/planning.js'

describe('assistant prompt capability availability', () => {
  it('exposes hosted device-connect providers when the hosted context has configured providers', () => {
    const executionContext = normalizeAssistantExecutionContext({
      hosted: {
        deviceConnectProviders: [
          { label: 'WHOOP', provider: 'whoop' },
        ],
        issueDeviceConnectLink: async ({ provider }) => ({
          authorizationUrl: `https://connect.example.test/${provider}`,
          connectUrl: `https://connect.example.test/${provider}`,
          expiresAt: '2026-04-30T00:05:00.000Z',
          provider,
          providerLabel: 'WHOOP',
        }),
        memberId: 'member_synthetic',
        userEnvKeys: [],
      },
    })

    expect(
      resolveAssistantPromptCapabilityAvailability({ executionContext }),
    ).toEqual({
      assistantHostedDeviceConnectAvailable: true,
      assistantHostedDeviceConnectProviders: [
        { label: 'WHOOP', provider: 'whoop' },
      ],
      assistantKnowledgeToolsAvailable: false,
    })
  })

  it('keeps hosted device-connect unavailable when providers are listed without a callable helper', () => {
    const executionContext = normalizeAssistantExecutionContext({
      hosted: {
        deviceConnectProviders: [
          { label: 'WHOOP', provider: 'whoop' },
        ],
        memberId: 'member_synthetic',
        userEnvKeys: [],
      },
    })

    expect(
      resolveAssistantPromptCapabilityAvailability({ executionContext }),
    ).toEqual({
      assistantHostedDeviceConnectAvailable: false,
      assistantHostedDeviceConnectProviders: [],
      assistantKnowledgeToolsAvailable: false,
    })
  })

  it('keeps hosted device-connect unavailable without configured providers', () => {
    const executionContext = normalizeAssistantExecutionContext({
      hosted: {
        memberId: 'member_synthetic',
        userEnvKeys: [],
      },
    })

    expect(
      resolveAssistantPromptCapabilityAvailability({ executionContext }),
    ).toEqual({
      assistantHostedDeviceConnectAvailable: false,
      assistantHostedDeviceConnectProviders: [],
      assistantKnowledgeToolsAvailable: false,
    })
  })
})
