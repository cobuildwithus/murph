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
    expect(prompt).not.toContain('Configured Exa research:')
  })

  it('defines the configured direct-turn privacy, evidence, and stopping contract', () => {
    const prompt = buildAssistantResearchScoutCapabilityText({
      progressUpdateMode: 'direct',
    })

    expect(prompt).toContain('{"mode":"focused"}')
    expect(prompt).toContain('exact server-owned public concepts')
    expect(prompt).toContain('research payload-schema --format json')
    expect(prompt).toContain('not exactly representable, make no Exa call')
    expect(prompt).toContain('could not safely form the current-source lookup')
    expect(prompt).toContain('no current sources were checked')
    expect(prompt).toContain('general background, not current research')
    expect(prompt).toContain(
      'do not imply that current studies were found, checked, reviewed, or verified',
    )
    expect(prompt).toContain('Never send arbitrary values, question prose')
    expect(prompt).toContain('Use `research scout-batch` for broad discovery or automation')
    expect(prompt).toContain('never send a mode-less single-scout request')
    expect(prompt).toContain('`resultIndex` maps to a result')
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
    expect(prompt).toContain('research scout-batch')
    expect(prompt).toContain('never send a mode-less single-scout request')
    expect(prompt).not.toContain('one short natural update')
  })
})
