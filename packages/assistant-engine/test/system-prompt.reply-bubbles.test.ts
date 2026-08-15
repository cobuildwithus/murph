import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const TEXTING_RHYTHM_PROMPT = `Texting rhythm:
- Keep a short reply with one natural section in one bubble. When a reply already has multiple natural sections or would feel dense on a phone, use one bubble per section—usually 2 or 3, never more than 4.
- Write a line containing only \`---\` between bubbles. The delivery layer turns each bubble into its own message. When mentioning the delimiter itself to the user, write it inline as \`---\` or "three hyphens"; never put it on its own line.
- Keep each bubble coherent and split only between complete sentences, paragraphs, or list items. Lists and structured answers can span bubbles; group related items together. Never separate a safety caveat, dosage, or warning from the item it qualifies. If the user needs to respond, ask exactly one question in the final bubble and put no text or later bubble after it. An owning skill may still require attached response media to accompany that final bubble.`

const GROUP_TEXTING_RHYTHM_PROMPT = `Group texting rhythm:
- Send an ordinary group reply as one text bubble. Keep any needed paragraphs or list items inside that one message.
- Never use a line containing only \`---\` to split a group reply into consecutive messages. Tool-owned media or effects the room explicitly requested may still accompany the one text reply.`

describe('assistant reply bubble prompt guidance', () => {
  it.each(['linq', 'telegram'])(
    'includes texting rhythm guidance for %s',
    (channel) => {
      const layers = buildAssistantSystemPromptLayers(
        createPromptInput({ channel }),
      )

      expect(layers.threadContextPrompt).toContain(TEXTING_RHYTHM_PROMPT)
      expect(layers.threadContextPrompt).toContain(
        "use the current channel's available presentation",
      )
      expect(layers.threadContextPrompt).toContain(
        'A semantic card that carries the complete answer replaces final text.',
      )
      if (channel === 'telegram') {
        expect(layers.threadContextPrompt).toContain(
          'A private Telegram movement routine keeps its exercise-routine card when the member repeats it or improves its layout',
        )
        expect(layers.threadContextPrompt).toContain(
          'Text styling is not a Rich Message.',
        )
        expect(layers.threadContextPrompt).toContain(
          'use it only for a complete structured guide, checklist, detailed comparison, or multi-section summary',
        )
        expect(layers.threadContextPrompt).toContain(
          'Keep short or simple replies as text.',
        )
        expect(layers.threadContextPrompt).toContain(
          'Nutrition, compact-table, tracked-workout, and catalog exercise content must use its owning card',
        )
        expect(layers.threadContextPrompt).toContain(
          'If the owning card cannot attach, use ordinary text, never generic rich content',
        )
      } else {
        expect(layers.threadContextPrompt).not.toContain(
          'Telegram rich-content tool',
        )
      }
      expect(layers.threadContextPrompt).toContain(
        'Response media accompanies concise semantic text; do not recreate its visual content as long prose.',
      )
      expect(layers.threadContextPrompt).not.toContain('response media alone')
      expect(layers.threadContextPrompt).toContain(
        'If no owned presentation fits, send concise text.',
      )
      expect(layers.threadContextPrompt).toContain(
        'Telegram and iMessage have different capabilities',
      )
      expect(layers.threadContextPrompt).toContain(
        'bordered or striped tables, expandable details, slideshows, collages, and embedded media',
      )
      expect(layers.threadContextPrompt).toContain(
        'Messages-extension cards, provider static card layouts, and ordered response media',
      )
      expect(layers.prompt).toContain('murph.send_progress_update')
      expect(layers.prompt).toContain(
        'including every `---` bubble',
      )
    },
  )

  it('does not demand a private exercise card in Telegram groups', () => {
    const layers = buildAssistantSystemPromptLayers(
      createPromptInput({ channel: 'telegram', conversationScope: 'group' }),
    )

    expect(layers.threadContextPrompt).not.toContain(
      'keeps its exercise-routine card',
    )
    expect(layers.threadContextPrompt).not.toContain(
      'Telegram rich-content tool',
    )
    expect(layers.threadContextPrompt).toContain(
      'If no owned presentation fits, send concise text.',
    )
  })

  it.each(['linq', 'telegram'])(
    'uses one bubble and sparse progress guidance for %s groups',
    (channel) => {
      const layers = buildAssistantSystemPromptLayers(
        createPromptInput({ channel, conversationScope: 'group' }),
      )

      expect(layers.threadContextPrompt).toContain(GROUP_TEXTING_RHYTHM_PROMPT)
      expect(layers.threadContextPrompt).not.toContain(TEXTING_RHYTHM_PROMPT)
      expect(layers.prompt).toContain('murph.send_progress_update')
      expect(layers.prompt).toContain(
        '`murph.select_reply_target` annotates the one eventual group response',
      )
      expect(layers.prompt).not.toContain('including every `---` bubble')
      expect(layers.prompt).toContain(
        'use `murph.send_progress_update` much more sparingly than in a direct conversation',
      )
      expect(layers.prompt).toContain(
        'Skip group progress for challenge setup, the next setup question, permission offers, routine standings reads, and short tool sequences.',
      )
      expect(layers.prompt).not.toContain('Do not leave the member silent')
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
