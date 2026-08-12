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
      'No Markdown tables',
    )
    expect(prompt).toContain('use labels')
  })

  it('uses a complete card alone and keeps semantic text with response media', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
    })

    expect(prompt).toContain(
      'Cards replace text',
    )
    expect(prompt).toContain(
      'repeat or restyle routines with exercise cards',
    )
    expect(prompt).toContain('styling is not a Rich Message')
    expect(prompt).toContain(
      'Pair media with brief cues and safety',
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
