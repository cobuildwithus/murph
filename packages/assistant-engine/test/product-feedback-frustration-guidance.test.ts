import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.js'

function buildConversationPrompt(
  conversationScope: 'direct' | 'group',
): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope,
    currentLocalDate: '2026-08-11',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}

describe('proactive product frustration feedback guidance', () => {
  it.each(['direct', 'group'] as const)(
    'makes repeated Murph-owned frustration an immediate feedback trigger in %s conversations',
    (conversationScope) => {
      const prompt = buildConversationPrompt(conversationScope)

      expect(prompt).toContain('Product feedback salience:')
      expect(prompt).toContain(
        'treat it as explicit product frustration rather than merely tone, banter, or missing input',
      )
      expect(prompt).toContain(
        'silently call `murph.submit_product_feedback` exactly once with kind `frustration` when available',
      )
      expect(prompt).toContain(
        'do not wait for the member to call it feedback, ask permission, or start a separate discovery interview',
      )
      expect(prompt).toContain(
        'asking again for information or consent already supplied',
      )
      expect(prompt).toContain(
        'sending the member through a step that cannot produce the represented result',
      )
      expect(prompt).toContain(
        'Do not log generic emotion or teasing unrelated to Murph',
      )
    },
  )
})
