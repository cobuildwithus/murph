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
      'never send Markdown tables, even on request',
    )
    expect(prompt).toContain('overrides other table guidance')
    expect(prompt).toContain('Use labeled lines')
  })

  it('marks complex visual presentation as image-welcome without losing exact text', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
    })

    expect(prompt).toContain('dense tables/plans/schedules/matrices/diagrams')
    expect(prompt).toContain('`murph.generate_image`')
    expect(prompt).toContain('when available, clearer, and audience-safe')
    expect(prompt).toContain(
      'Keep exact or safety-critical details (sets/reps, dates, dosages) in text',
    )
    expect(prompt).toContain(
      'No decorative images or private health data in group images',
    )
  })
})
