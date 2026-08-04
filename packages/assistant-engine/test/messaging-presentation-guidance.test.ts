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
      'never emit a Markdown table, even when the user asks for a "table"',
    )
    expect(prompt).toContain(
      'overrides any generic permission to use Markdown tables when explicitly requested',
    )
    expect(prompt).toContain(
      'compact labeled list or one item per line',
    )
  })

  it('marks complex visual presentation as image-welcome without losing exact text', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
    })

    expect(prompt).toContain('dense multi-column table, workout plan, schedule')
    expect(prompt).toContain('proactively call `murph.generate_image` when available')
    expect(prompt).toContain(
      'explicitly marks image generation welcome and privacy-safe',
    )
    expect(prompt).toContain(
      'a generative image is never the sole source of truth',
    )
    expect(prompt).toContain(
      "never place a member's private health data into a group image",
    )
  })
})
