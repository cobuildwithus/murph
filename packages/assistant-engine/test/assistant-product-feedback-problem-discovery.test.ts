import { describe, expect, it } from 'vitest'

import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'direct',
    currentLocalDate: '2026-08-04',
    currentTimeZone: 'America/Chicago',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}

describe('assistant product feedback problem discovery', () => {
  it('discovers the user problem before logging ambiguous feedback', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      "Treat a requested feature, bug report, or workaround as evidence about the user's underlying problem",
    )
    expect(prompt).toContain(
      'If the underlying problem or desired outcome is materially unclear and one answer would change what Murph should build, ask one concise, natural follow-up question in the reply and do not call the tool yet.',
    )
    expect(prompt).toContain(
      'Ask at most one feedback-discovery question per turn',
    )
    expect(prompt).toContain(
      'never re-ask a fact already established',
    )
  })

  it('keeps clear feedback lightweight and preserves immediate help', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'When the problem and desired outcome are already clear, or the friction is Murph-observed, do not ask a feedback follow-up.',
    )
    expect(prompt).toContain(
      'Capture it silently without interrupting the workflow',
    )
    expect(prompt).toContain(
      'Still answer the immediate request or provide the best available fallback when possible.',
    )
  })
})
