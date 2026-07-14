import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const TEXTING_RHYTHM_PROMPT = `Texting rhythm:
- Keep a short reply with one natural section in one bubble. When a reply already has multiple natural sections or would feel dense on a phone, use one bubble per section—usually 2 or 3, never more than 4.
- Write a line containing only \`---\` between bubbles. The delivery layer turns each bubble into its own message. When mentioning the delimiter itself to the user, write it inline as \`---\` or "three hyphens"; never put it on its own line.
- Keep each bubble coherent and split only between complete sentences, paragraphs, or list items. Lists and structured answers can span bubbles; group related items together. Never separate a safety caveat, dosage, or warning from the item it qualifies. If the user needs to respond, ask exactly one question in the final bubble and put nothing after it.`

describe('assistant reply bubble prompt guidance', () => {
  it.each(['linq', 'telegram'])(
    'includes texting rhythm guidance for %s',
    (channel) => {
      const layers = buildAssistantSystemPromptLayers(
        createPromptInput({ channel }),
      )

      expect(layers.threadContextPrompt).toContain(TEXTING_RHYTHM_PROMPT)
    },
  )

  it.each(['email', 'local'])(
    'does not include texting rhythm guidance for %s',
    (channel) => {
      const layers = buildAssistantSystemPromptLayers(
        createPromptInput({ channel }),
      )

      expect(layers.threadContextPrompt).not.toContain(TEXTING_RHYTHM_PROMPT)
      expect(layers.threadContextPrompt).not.toContain('Texting rhythm:')
    },
  )

  it('does not include texting rhythm guidance without a channel', () => {
    const layers = buildAssistantSystemPromptLayers(
      createPromptInput({ channel: null }),
    )

    expect(layers.threadContextPrompt).not.toContain(TEXTING_RHYTHM_PROMPT)
    expect(layers.threadContextPrompt).not.toContain('Texting rhythm:')
  })
})

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-07-07',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    ...overrides,
  }
}
