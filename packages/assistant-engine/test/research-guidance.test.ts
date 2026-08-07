import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
  buildAssistantResearchScoutCapabilityText,
} from '../src/assistant/model-behavior.js'

describe('assistant research guidance', () => {
  it('keeps research out of the always-resident behavior prompt', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdateMode: 'direct',
    })

    expect(prompt).not.toContain('vault-cli research')
    expect(prompt).not.toContain('Configured Exa research capability')
  })

  it('defines the configured direct-turn privacy, evidence, and stopping contract', () => {
    const prompt = buildAssistantResearchScoutCapabilityText({
      progressUpdateMode: 'direct',
    })

    expect(prompt).toContain('{"mode":"focused"}')
    expect(prompt).toContain('exact server-owned public concepts')
    expect(prompt).toContain('research payload-schema --format json')
    expect(prompt).toContain('otherwise make no Exa call')
    expect(prompt).toContain('Never send arbitrary values or question prose')
    expect(prompt).toContain('`resultIndex` maps to a returned result')
    expect(prompt).toContain('source title, web URL')
    expect(prompt).toContain('no usable current source')
    expect(prompt).toContain('do not fabricate evidence')
    expect(prompt).toContain('do not')
    expect(prompt).toContain('repeat the lookup blindly')
    expect(prompt).toContain('one short natural update')
  })

  it('preserves the stricter configured group progress threshold', () => {
    const prompt = buildAssistantResearchScoutCapabilityText({
      progressUpdateMode: 'group',
    })

    expect(prompt).toContain(
      'a research lookup alone does not justify a status message',
    )
    expect(prompt).not.toContain('one short natural update')
  })
})
