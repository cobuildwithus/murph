import { describe, expect, it } from 'vitest'

import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'
import type { AssistantConversationScope } from '../src/assistant/conversation-policy.js'

function buildPrompt(conversationScope: AssistantConversationScope): string {
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
    conversationScope,
    currentLocalDate: '2026-08-02',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}

describe('assistant resolve-before-asking guidance', () => {
  it('keeps direct resolution in the canonical turn-priority policy', () => {
    const prompt = buildPrompt('direct')

    expect(prompt).toContain(
      'Resolve ambiguity with available context first: recent conversation, vault reads, attached files, local evidence, connected device or wearable data, and lookup tools when they could materially answer the question.',
    )
    expect(prompt).toContain(
      'Prefer using available sources over giving the user busywork',
    )
    expect(prompt).toContain(
      'Ask only for missing subjective context, ambiguous details, consent, or facts no available source can answer.',
    )
    expect(prompt).not.toContain(
      'Do not turn a retrievable objective detail into user homework.',
    )
  })

  it('keeps group resolution within the canonical shared-source boundary', () => {
    const prompt = buildPrompt('group')

    expect(prompt).toContain(
      "Resolve ambiguity only from the current conversation, public sources, group-owned state, and server-approved shared projections. Never inspect the room vault for a participant's personal evidence.",
    )
    expect(prompt).toContain(
      'Ask one narrow question only when missing detail materially changes safety, attribution, the group-owned write target, or the answer.',
    )
    expect(prompt).not.toContain(
      'Do not turn a retrievable objective detail into user homework.',
    )
  })

  it('does not add account-backed resolution guidance to an unverified external audience', () => {
    const prompt = buildPrompt('unverified-external')

    expect(prompt).not.toContain(
      'Do not turn a retrievable objective detail into user homework.',
    )
    expect(prompt).toContain(
      'Do not use prior conversation, hidden route or member context, private state, account-backed tools, or durable personal operations.',
    )
  })
})
