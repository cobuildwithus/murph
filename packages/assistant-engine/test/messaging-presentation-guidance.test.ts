import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.js'

describe('assistant messaging presentation guidance', () => {
  it('blocks raw Markdown tables even when a member explicitly asks for a table', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
    })

    expect(prompt).toContain(
      'no Markdown tables',
    )
    expect(prompt).toContain('use labeled lines')
  })

  it('uses a complete card alone and keeps semantic text with response media', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
    })

    expect(prompt).toContain(
      'Complete cards replace text',
    )
    expect(prompt).toContain(
      'Response media comes with concise text for order, dose, timing, cues, safety, and fallback',
    )
    expect(prompt).toContain('`murph.generate_image`')
    expect(prompt).toContain('only if no card fits and a safe image helps')
    expect(prompt).toContain(
      'Keep exact or safety-critical text',
    )
    expect(prompt).toContain(
      'No decorative/private-health group images',
    )
  })
})
