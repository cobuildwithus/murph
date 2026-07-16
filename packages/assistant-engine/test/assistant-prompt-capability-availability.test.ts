import { describe, expect, it } from 'vitest'

import {
  normalizeAssistantExecutionContext,
} from '../src/assistant/execution-context.js'
import {
  resolveAssistantPromptCapabilityAvailability,
} from '../src/assistant/codex-turn/planning.js'

describe('assistant prompt capability availability', () => {
  it('exposes hosted device-connect providers when the hosted context has configured providers', () => {
    const executionContext = normalizeAssistantExecutionContext({
      hosted: {
        deviceConnectProviders: [
          { label: 'WHOOP', provider: 'whoop' },
        ],
        deviceTool: {
          request: async () => ({
            action: 'connect' as const,
            link: {
              authorizationUrl: 'https://connect.example.test/whoop',
              connectUrl: 'https://connect.example.test/whoop',
              expiresAt: '2026-04-30T00:05:00.000Z',
              provider: 'whoop',
              providerLabel: 'WHOOP',
            },
          }),
        },
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

  it('keeps hosted device-connect unavailable when providers are listed without a device port', () => {
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
