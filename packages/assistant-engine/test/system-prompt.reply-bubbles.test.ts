import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const TEXTING_RHYTHM_PROMPT = `Texting rhythm:
- Reply like a person texting. When a reply has more than one conversational move, split it into 2-3 short bubbles, never more than 4, by writing a line containing only \`---\` between bubbles. The delivery layer turns each bubble into its own message.
- One move per bubble: acknowledge or react, answer, explain, or ask. Use one or two short sentences per bubble; split at sentence boundaries, never mid-thought.
- Lead with the answer or reaction. If the user needs to act or respond, ask exactly one question, make it the final bubble, and put nothing after it.
- A short reply stays one bubble. Never stretch a simple answer across bubbles or use bubbles as padding.
- Keep anything the user will save, follow, or reread intact in a single bubble: plans, lists, step-by-step instructions, logged data, schedules, safety caveats, dosage details, and contraindication warnings. Conversational framing can go in bubbles around it, but never separate a safety caveat or dosage/contraindication warning from the instruction it modifies.`

describe('assistant reply bubble prompt guidance', () => {
  it.each(['linq', 'telegram', 'whatsapp'])(
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
