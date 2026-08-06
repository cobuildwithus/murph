import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.js'

describe('assistant research guidance', () => {
  it('makes the existing Exa-backed scout an ordinary focused research capability', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdateMode: 'direct',
    })

    expect(prompt).toContain('`vault-cli research scout`')
    expect(prompt).toContain('interactive and scheduled turns')
    expect(prompt).toContain('{"question":"..."}')
    expect(prompt).toContain('`--input -` on stdin')
    expect(prompt).toContain('`--input @file.json`')
    expect(prompt).toContain('Let me pull the latest research on that.')
    expect(prompt).toContain(
      'Strip names or details that identify the member or another private person',
    )
    expect(prompt).toContain(
      'Preserve public study titles, researcher names, institutions, and other public entities',
    )
    expect(prompt).toContain('Distinguish established evidence from early or conflicting evidence')
    expect(prompt).not.toContain('always run research')
  })

  it('preserves the stricter progress threshold in groups', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdateMode: 'group',
    })

    expect(prompt).toContain('`vault-cli research scout`')
    expect(prompt).toContain(
      'a research lookup alone does not justify a status message',
    )
    expect(prompt).not.toContain(
      'Let me pull the latest research on that.',
    )
  })
})
