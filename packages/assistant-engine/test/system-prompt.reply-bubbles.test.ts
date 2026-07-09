import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const TEXTING_RHYTHM_PROMPT = `Texting rhythm:
- Use bubbles to make texting easier to read, not to simulate activity. If the reply has one clear job, send one bubble.
- Split into 2 short bubbles when the user would otherwise get a dense wall of text, especially answer plus multi-sentence why/context, reassurance plus next step, or explanation plus one question. Use 3 only when acknowledge/answer, brief reason, and final question are genuinely separate. Never more than 4.
- Write a line containing only \`---\` between bubbles. The delivery layer turns each bubble into its own message. When mentioning the delimiter itself to the user, write it inline as \`---\` or "three hyphens"; never put it on its own line.
- Each bubble should be one coherent chunk: one conversational move, one or two short sentences, split at sentence boundaries, never mid-thought. Lead with the answer or reaction; if the user needs to act or respond, ask exactly one question in the final bubble and put nothing after it.
- Do not split short confirmations, simple facts, or content the user needs to save, scan, follow, or reread as one unit: plans, lists, step-by-step instructions, logged data, schedules, safety caveats, dosage details, and contraindication warnings. Conversational framing can go in bubbles around it, but never separate a safety caveat or dosage/contraindication warning from the instruction it modifies.`

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
