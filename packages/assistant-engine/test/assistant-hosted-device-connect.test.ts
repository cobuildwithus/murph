import { describe, expect, it, vi } from 'vitest'

import {
  maybeHandleAssistantHostedDeviceConnect,
} from '../src/assistant/hosted-device-connect.js'
import type {
  AssistantExecutionContext,
} from '../src/assistant/execution-context.js'

function createHostedExecutionContext(input?: {
  issueDeviceConnectLink?: NonNullable<
    AssistantExecutionContext['hosted']
  >['issueDeviceConnectLink']
}): AssistantExecutionContext {
  return {
    hosted: {
      deviceConnectProviders: [
        { label: 'WHOOP', provider: 'whoop' },
      ],
      issueDeviceConnectLink:
        input?.issueDeviceConnectLink ??
        (async ({ provider }) => ({
          authorizationUrl: `https://connect.example.test/${provider}`,
          expiresAt: '2026-04-30T00:05:00.000Z',
          provider,
          providerLabel: 'WHOOP',
        })),
      memberId: 'member_synthetic',
      userEnvKeys: [],
    },
  }
}

describe('maybeHandleAssistantHostedDeviceConnect', () => {
  it('creates a hosted WHOOP connection link for explicit iMessage connect requests', async () => {
    const issueDeviceConnectLink = vi.fn(async ({ provider }) => ({
      authorizationUrl: `https://connect.example.test/${provider}`,
      expiresAt: '2026-04-30T00:05:00.000Z',
      provider,
      providerLabel: 'WHOOP',
    }))

    const result = await maybeHandleAssistantHostedDeviceConnect({
      channel: 'linq',
      executionContext: createHostedExecutionContext({ issueDeviceConnectLink }),
      prompt: 'Please connect my WHOOP',
    })

    expect(result).toEqual({
      kind: 'handled',
      providerActionCount: 1,
      response: [
        'Here is your WHOOP connection link:',
        'https://connect.example.test/whoop',
        '',
        'Open it to authorize the connection.',
      ].join('\n'),
    })
    expect(issueDeviceConnectLink).toHaveBeenCalledWith({
      messagingReturnTarget: 'imessage',
      provider: 'whoop',
    })
  })

  it('treats a compact onboarding provider answer as a connect request', async () => {
    const issueDeviceConnectLink = vi.fn(async ({ provider }) => ({
      authorizationUrl: `https://connect.example.test/${provider}`,
      expiresAt: '2026-04-30T00:05:00.000Z',
      provider,
      providerLabel: 'WHOOP',
    }))

    const result = await maybeHandleAssistantHostedDeviceConnect({
      channel: 'telegram',
      executionContext: createHostedExecutionContext({ issueDeviceConnectLink }),
      onboardingGuidanceInjected: true,
      prompt: 'WHOOP',
    })

    expect(result.kind).toBe('handled')
    expect(issueDeviceConnectLink).toHaveBeenCalledWith({
      messagingReturnTarget: 'telegram',
      provider: 'whoop',
    })
  })

  it('omits messaging return target when the active channel is absent or unsupported', async () => {
    const issueDeviceConnectLink = vi.fn(async ({ provider }) => ({
      authorizationUrl: `https://connect.example.test/${provider}`,
      expiresAt: '2026-04-30T00:05:00.000Z',
      provider,
      providerLabel: 'WHOOP',
    }))
    const executionContext = createHostedExecutionContext({
      issueDeviceConnectLink,
    })

    await maybeHandleAssistantHostedDeviceConnect({
      executionContext,
      prompt: 'Please connect WHOOP',
    })
    await maybeHandleAssistantHostedDeviceConnect({
      channel: 'email',
      executionContext,
      prompt: 'Please connect WHOOP',
    })

    expect(issueDeviceConnectLink).toHaveBeenNthCalledWith(1, {
      provider: 'whoop',
    })
    expect(issueDeviceConnectLink).toHaveBeenNthCalledWith(2, {
      provider: 'whoop',
    })
  })

  it('does not hijack general provider mentions', async () => {
    const issueDeviceConnectLink = vi.fn()

    await expect(maybeHandleAssistantHostedDeviceConnect({
      channel: 'linq',
      executionContext: createHostedExecutionContext({ issueDeviceConnectLink }),
      prompt: 'What does WHOOP measure during sleep?',
    })).resolves.toEqual({ kind: 'not_applicable' })
    expect(issueDeviceConnectLink).not.toHaveBeenCalled()
  })

  it('does not hijack sync status or integration information questions', async () => {
    const issueDeviceConnectLink = vi.fn()
    const executionContext = createHostedExecutionContext({
      issueDeviceConnectLink,
    })

    await expect(maybeHandleAssistantHostedDeviceConnect({
      channel: 'linq',
      executionContext,
      prompt: 'Did WHOOP sync last night?',
    })).resolves.toEqual({ kind: 'not_applicable' })
    await expect(maybeHandleAssistantHostedDeviceConnect({
      channel: 'linq',
      executionContext,
      prompt: 'How does the WHOOP integration work?',
    })).resolves.toEqual({ kind: 'not_applicable' })
    await expect(maybeHandleAssistantHostedDeviceConnect({
      channel: 'linq',
      executionContext,
      prompt: 'Does WHOOP connect to Apple Health?',
    })).resolves.toEqual({ kind: 'not_applicable' })
    expect(issueDeviceConnectLink).not.toHaveBeenCalled()
  })

  it('does not hijack experiment setup requests that mention a provider', async () => {
    const issueDeviceConnectLink = vi.fn()

    await expect(maybeHandleAssistantHostedDeviceConnect({
      channel: 'linq',
      executionContext: createHostedExecutionContext({ issueDeviceConnectLink }),
      prompt: 'Can you set up a sleep experiment using WHOOP?',
    })).resolves.toEqual({ kind: 'not_applicable' })
    expect(issueDeviceConnectLink).not.toHaveBeenCalled()
  })

  it('keeps helper failures user-facing and privacy-bounded', async () => {
    const issueDeviceConnectLink = vi.fn(async () => {
      throw new Error('backend details should not leak')
    })

    const result = await maybeHandleAssistantHostedDeviceConnect({
      channel: 'linq',
      executionContext: createHostedExecutionContext({ issueDeviceConnectLink }),
      prompt: 'Connect WHOOP',
    })

    expect(result).toEqual({
      kind: 'handled',
      providerActionCount: 1,
      response:
        "I couldn't create the WHOOP connection link right now. Please try again shortly.",
    })
  })

  it('bounds unsupported provider requests to configured providers', async () => {
    const issueDeviceConnectLink = vi.fn()

    const result = await maybeHandleAssistantHostedDeviceConnect({
      channel: 'linq',
      executionContext: createHostedExecutionContext({ issueDeviceConnectLink }),
      prompt: 'Can you connect my Fitbit?',
    })

    expect(result).toEqual({
      kind: 'handled',
      providerActionCount: 0,
      response:
        'Fitbit connection links are not configured in this route right now. I can create links for WHOOP.',
    })
    expect(issueDeviceConnectLink).not.toHaveBeenCalled()
  })

  it('does not call a configured provider helper for mixed unsupported-provider connect targets', async () => {
    const issueDeviceConnectLink = vi.fn()

    const result = await maybeHandleAssistantHostedDeviceConnect({
      channel: 'linq',
      executionContext: createHostedExecutionContext({ issueDeviceConnectLink }),
      prompt: 'Can you connect my Fitbit instead of WHOOP?',
    })

    expect(result).toEqual({
      kind: 'handled',
      providerActionCount: 0,
      response:
        'Fitbit connection links are not configured in this route right now. I can create links for WHOOP.',
    })
    expect(issueDeviceConnectLink).not.toHaveBeenCalled()
  })
})
