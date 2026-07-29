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
    expect(prompt).not.toContain('AT_RISK')
  })

  it('adds nothing for normal delivery', () => {
    expect(buildAssistantLinqDeliveryPosturePrompt(null)).toBeNull()
  })
})
