import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.js'
import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

describe('action-first browser prompt contract', () => {
  it('treats lookup as preflight for browser-backed real-world actions', () => {
    const executionText = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
    })

    expect(executionText).toContain(
      'For requested real-world browser actions (orders, bookings, changes, payments, refills, forms, portals)',
    )
    expect(executionText).toContain(
      'lookup is preflight only',
    )
    expect(executionText).toContain(
      'use a completion-capable tool when the next safe step is clear',
    )
    expect(executionText).toContain(
      'plus `appointment-scheduling` for medical check-in/intake',
    )
  })

  it('delegates point-of-risk decisions and preserves bounded recovery', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput())

    expect(prompt).toContain(
      '`computer-use` owns approval, disclosure, takeover, and bounded recovery',
    )
    expect(prompt).toContain(
      'Make reversible progress first',
    )
    expect(prompt).toContain(
      'an unresponsive control needs re-inspection',
    )
    expect(prompt).toContain(
      'one safe alternate interaction before allowed OS fallback',
    )
    expect(prompt).toContain(
      'Re-inspect after an OS action; never repeat it when state changed',
    )
    expect(prompt).toContain(
      'Refresh only with no unknown side effect and safe entered state',
    )
    expect(prompt).toContain(
      'Claim actions or completion only from runtime evidence',
    )
    expect(prompt).toContain(
      'Complete the browser task end-to-end when the user has asked you to do it and the needed information is available.',
    )
  })

  it('keeps final confirmation handoff links optional', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput())

    expect(prompt).toContain(
      'Ask the smallest concrete in-chat approval question',
    )
    expect(prompt).toContain(
      'a handoff link is optional unless takeover is required',
    )
  })

  it('includes a fresh handoff link when direct takeover is required', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput())

    expect(prompt).toContain(
      "For takeover, include the pause tool's fresh URL",
    )
    expect(prompt).toContain(
      'and one precise action',
    )
    expect(prompt).toContain(
      "For takeover, include the pause tool's fresh URL and one precise action",
    )
  })
})

function createCommonCodexPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: 'Stable CLI contract for common Codex route.',
    assistantHostedDeviceConnectAvailable: true,
    assistantHostedDeviceConnectProviders: [
      { label: 'Oura', provider: 'oura' },
      { label: 'WHOOP', provider: 'whoop' },
    ],
    assistantKnowledgeToolsAvailable: true,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-04-15',
    currentTimeZone: 'Asia/Kuala_Lumpur',
    onboardingGuidance: true,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
    ...overrides,
  }
}
