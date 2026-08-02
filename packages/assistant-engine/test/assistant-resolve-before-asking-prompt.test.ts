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
  it('uses permitted sources for objective blockers in verified direct and group turns', () => {
    for (const conversationScope of ['direct', 'group'] as const) {
      const prompt = buildPrompt(conversationScope)

      expect(prompt).toContain(
        'Do not turn a retrievable objective detail into user homework.',
      )
      expect(prompt).toContain(
        'use the conversation and the narrowest source or tool already authorized for this audience and task',
      )
      expect(prompt).toContain(
        'Ask only when permitted sources cannot produce one sufficiently reliable answer',
      )
      expect(prompt).toContain(
        'Never broaden a lookup beyond the task, invent a match, treat retrieved data as consent, or expose private-source information across audience boundaries.',
      )
    }
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
