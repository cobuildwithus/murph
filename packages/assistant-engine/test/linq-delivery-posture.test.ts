import { describe, expect, it } from 'vitest'

import {
  buildAssistantLinqDeliveryPosturePrompt,
} from '../src/assistant/linq-delivery-posture.js'

describe('buildAssistantLinqDeliveryPosturePrompt', () => {
  it('renders bounded private guidance without exposing provider internals', () => {
    const prompt = buildAssistantLinqDeliveryPosturePrompt('recover')
    expect(prompt).toContain('Private delivery context')
    expect(prompt).toContain('one concise, specific message')
    expect(prompt).toContain('Do not demand ritualized replies')
    expect(prompt).not.toContain('unanswered reminder')
    expect(prompt).not.toContain('fold')
    expect(prompt).not.toContain('AT_RISK')
  })

  it('renders cautious guidance without recovery-only engagement advice', () => {
    const prompt = buildAssistantLinqDeliveryPosturePrompt('cautious')
    expect(prompt).toContain('Private delivery context')
    expect(prompt).toContain('weaker recent reputation or delivery signals')
    expect(prompt).toContain('avoid unnecessary extra outbound')
    expect(prompt).toContain('do not invent a cause for the provider status')
    expect(prompt).not.toContain('weak recent engagement signals')
    expect(prompt).not.toContain('ritualized replies')
  })

  it('adds nothing for normal delivery', () => {
    expect(buildAssistantLinqDeliveryPosturePrompt(null)).toBeNull()
  })
})
